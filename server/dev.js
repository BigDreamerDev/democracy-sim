/* Local preview. No Postgres, no deploy, nothing touched on Render.

     cd server
     npm install
     npm run dev

   Boots the real server against an in-process Postgres held in memory, serves
   the site from ../docs on the same origin, and fills it with a plausible
   Republic so every page has something on it. Nothing is written to disk —
   stop it and it is gone.  */

const path = require('path');
const fs = require('fs');
const Module = require('module');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'pg') {
    return {
      Pool: class {
        async query(sql, params) {
          if (!params || !params.length) {
            const r = await db.exec(sql);
            return r[r.length - 1] || { rows: [] };
          }
          return db.query(sql, params);
        }
      }
    };
  }
  return realLoad.call(this, req, ...rest);
};

const PORT = process.env.PORT || 4321;
process.env.PORT = String(PORT);
process.env.JWT_SECRET = 'local-preview-secret-not-for-real-use-0123456789';

/* The site is served from the same origin as the API, so config.js needs no
   editing and CORS never comes into it. The static routes go on FIRST, because
   server.js finishes with a catch-all 404 and calls listen() itself. */
const realExpress = require('express');
const app = realExpress();

app.get('/config.js', (_req, res) => res.type('application/javascript').send('window.API_BASE = "";\n'));
app.use(realExpress.static(path.join(__dirname, '..', 'docs')));

// Hand the real server our app instance rather than letting it make its own.
require.cache[require.resolve('express')].exports = Object.assign(
  function () { return app; },
  realExpress
);

require('./server.js');

/* ------------------------------------------------------------------ seed */

const B = `http://localhost:${PORT}`;
const call = async (p, { method = 'GET', body, token } = {}) => {
  const r = await fetch(B + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};

const PEOPLE = ['Ana', 'Bilal', 'Cleo', 'Dev', 'Esme', 'Farid', 'Gia', 'Hugo', 'Iris', 'Jonah', 'Kira'];
const PW = 'preview123';

async function seed() {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(B + '/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }

  const admin = await call('/api/auth/register', {
    method: 'POST', body: { username: 'admin', display_name: 'Returning Officer', password: PW }
  });
  const T = admin.token;

  const codes = await call('/api/admin/invites', { method: 'POST', body: { count: PEOPLE.length }, token: T });
  for (let i = 0; i < PEOPLE.length; i++) {
    await call('/api/auth/register', {
      method: 'POST',
      body: { invite: codes[i], username: PEOPLE[i].toLowerCase(), display_name: PEOPLE[i], password: PW }
    });
  }
  for (const u of await call('/api/admin/pending', { token: T })) {
    await call('/api/admin/approve', { method: 'POST', body: { user_id: u.id, approve: true }, token: T });
  }
  const tok = {};
  for (const p of PEOPLE) {
    tok[p] = (await call('/api/auth/login', { method: 'POST', body: { username: p.toLowerCase(), password: PW } })).token;
  }

  // Two parties, so the chamber has colour in it.
  await call('/api/parties', { method: 'POST', body: { name: 'Common Ground', abbr: 'CG', colour: '#006A44', manifesto: 'The floor first.' }, token: tok.Ana });
  await call('/api/parties', { method: 'POST', body: { name: 'The Order Paper', abbr: 'OP', colour: '#003087', manifesto: 'Procedure is freedom.' }, token: tok.Dev });
  for (const p of ['Bilal', 'Cleo']) await call('/api/parties/1/join', { method: 'POST', token: tok[p] });
  for (const p of ['Esme', 'Farid']) await call('/api/parties/2/join', { method: 'POST', token: tok[p] });

  await call('/api/admin/config', { method: 'PUT', body: { seats: '5', quorum: '2', nation_name: 'McServerLandia', motto: 'Founded by group chat.', dividend: '2000', goods_economy_enabled: 'true' }, token: T });

  // A general election, run and certified.
  const el = await call('/api/elections', { method: 'POST', body: { kind: 'parliament', title: 'General election — cycle 1' }, token: T });
  for (const p of PEOPLE.slice(0, 7)) {
    await call(`/api/elections/${el.id}/stand`, { method: 'POST', body: { statement: `${p} will do the reading.` }, token: tok[p] });
  }
  await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'voting' }, token: T });
  const cands = (await call(`/api/elections/${el.id}`, { token: T })).candidates;
  /* Who votes for whom. Shorter than PEOPLE on purpose — anyone past the end of
     the plan spreads across the field, so adding a name to PEOPLE does not
     break the seed. It did once. */
  const plan = [0, 0, 0, 1, 1, 2, 3, 4, 5, 1];
  for (let i = 0; i < PEOPLE.length; i++) {
    const pick = cands[plan[i] ?? i % cands.length];
    if (!pick) continue;
    await call(`/api/elections/${el.id}/vote`, { method: 'POST', body: { candidacy_id: pick.id }, token: tok[PEOPLE[i]] });
  }
  await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'closed' }, token: T });

  const roll = await call('/api/citizens');
  const mps = roll.filter(c => (c.offices || []).includes('mp'));
  const free = roll.filter(c => !(c.offices || []).length && c.display_name !== 'Returning Officer');
  await call('/api/admin/office', { method: 'POST', body: { user_id: mps[0].id, office: 'speaker' }, token: T });
  await call('/api/admin/office', { method: 'POST', body: { user_id: free[0].id, office: 'president' }, token: T });
  const spk = tok[mps[0].display_name];
  const pres = tok[free[0].display_name];
  const mpTok = mps.map(m => tok[m.display_name]);

  // A law on the books, a bill mid-division, and an initiative gathering names.
  const pass = async (body) => {
    const b = await call('/api/bills', { method: 'POST', body, token: mpTok[0] });
    await call(`/api/bills/${b.id}/second`, { method: 'POST', token: mpTok[1] });
    await call(`/api/bills/${b.id}/second`, { method: 'POST', token: mpTok[2] });
    await call(`/api/bills/${b.id}/table`, { method: 'POST', token: spk });
    await call(`/api/bills/${b.id}/division`, { method: 'POST', token: spk });
    for (const t of mpTok) await call(`/api/bills/${b.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
    await call(`/api/bills/${b.id}/close`, { method: 'POST', token: spk });
    await call(`/api/bills/${b.id}/assent`, { method: 'POST', token: pres });
    return b;
  };
  await pass({ title: 'Quiet Hours Act', kind: 'law', body: '## 1\nNo polls shall close between midnight and eight.' });

  const live = await call('/api/bills', { method: 'POST', body: { title: 'Tea Break Act', kind: 'law', body: '## 1\nEvery sitting shall pause for tea.' }, token: mpTok[1] });
  await call(`/api/bills/${live.id}/second`, { method: 'POST', token: mpTok[0] });
  await call(`/api/bills/${live.id}/second`, { method: 'POST', token: mpTok[2] });
  await call(`/api/bills/${live.id}/table`, { method: 'POST', token: spk });
  await call(`/api/bills/${live.id}/division`, { method: 'POST', token: spk });
  await call(`/api/bills/${live.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: mpTok[0] });
  await call(`/api/bills/${live.id}/vote`, { method: 'POST', body: { vote: 'no' }, token: mpTok[1] });
  await call(`/api/bills/${live.id}/comments`, { method: 'POST', body: { body: 'Tea at four is the only civilised hour.' }, token: mpTok[3] });

  // A bill that has passed and awaits assent, so the President's desk is not
  // empty on first load — the whole point of the desk is showing an officer
  // what only they can do.
  const awaiting = await call('/api/bills', { method: 'POST', body: { title: 'Harbour Lights Act', kind: 'law', body: '## 1\nThe harbour shall be lit through the night.' }, token: mpTok[2] });
  await call(`/api/bills/${awaiting.id}/second`, { method: 'POST', token: mpTok[0] });
  await call(`/api/bills/${awaiting.id}/second`, { method: 'POST', token: mpTok[1] });
  await call(`/api/bills/${awaiting.id}/table`, { method: 'POST', token: spk });
  await call(`/api/bills/${awaiting.id}/division`, { method: 'POST', token: spk });
  for (const t of mpTok) await call(`/api/bills/${awaiting.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
  await call(`/api/bills/${awaiting.id}/close`, { method: 'POST', token: spk });

  // And one with its seconders but not yet tabled, for the Speaker's desk.
  const forSpeaker = await call('/api/bills', { method: 'POST', body: { title: 'Ferry Timetable Act', kind: 'law', body: 'The ferry shall run hourly.' }, token: mpTok[3] });
  await call(`/api/bills/${forSpeaker.id}/second`, { method: 'POST', token: mpTok[0] });
  await call(`/api/bills/${forSpeaker.id}/second`, { method: 'POST', token: mpTok[1] });

  const init = await call('/api/initiatives', { method: 'POST', body: { title: 'Citizens Music Act', kind: 'law', body: 'The Republic shall keep a shared playlist.' }, token: tok[free[1].display_name] });
  await call(`/api/bills/${init.id}/sign`, { method: 'POST', token: tok[free[1].display_name] });

  /* A Treasury and a Fed, so both pages have something on them. The Treasurer
     is appointed by the President (there is no Prime Minister here); the head
     of the Fed is nominated by the President and confirmed by the House, which
     is the only way that office can ever be filled. */
  await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: T });
  const treasurer = free[2], fedChair = free[3];
  if (treasurer) {
    await call('/api/treasury/appoint', { method: 'POST', body: { user_id: treasurer.id }, token: pres });
    await call('/api/treasury/statement', {
      method: 'POST',
      body: { body: 'Cycle 1. Taken: nothing, the House has laid no tax. Spent: the dividend, in full, to every citizen.' },
      token: tok[treasurer.display_name]
    });
  }
  if (fedChair) {
    await call('/api/fed/nominate', { method: 'POST', body: { user_id: fedChair.id }, token: pres });
    for (const t of mpTok) {
      const r = await call('/api/fed/confirm', { method: 'POST', token: t });
      if (r.confirmed) break;
    }
    const fTok = tok[fedChair.display_name];
    await call('/api/fed/issue', {
      method: 'POST',
      body: { amount: 20000, reasons: 'The Treasury cannot meet the dividend out of a nil tax take, and the dividend is unconditional.' },
      token: fTok
    });
    await call('/api/fed/rates', {
      method: 'POST',
      body: { loan_rate: 0.06, reasons: 'Borrowing is thin and nothing yet threatens the value of the Mark.' },
      token: fTok
    });
    // One bank applied and licensed, one still waiting, so the page shows both.
    const bank = await call('/api/banks', {
      method: 'POST',
      body: { name: 'Harbour Savings', capital: 800, prospectus: 'Deposits, and small loans to anyone who asks.' },
      token: tok[PEOPLE[9]]
    });
    if (bank && bank.id) {
      await call(`/api/banks/${bank.id}/licence`, {
        method: 'POST',
        body: { reasons: 'Adequately capitalised, and the prospectus is plain about what it will lend.' },
        token: fTok
      });
    }
    await call('/api/banks', {
      method: 'POST',
      body: { name: 'The Second Bank', capital: 300, prospectus: 'Higher rates, and a thinner reserve.' },
      token: tok[free[1].display_name]
    });
  }

  /* Three foreign powers with real territory, so the map has a world on it.
     Real coastlines, invented countries: the codes below are shapes, and the
     names are the only names a player ever sees for them. Standings are spread
     across the scale on purpose — a map where everyone is neutral proves
     nothing about whether the colours read. */
  await call('/api/admin/config', { method: 'PUT', body: { diplomacy_enabled: 'true' }, token: T });
  const POWERS = [
    { name: 'Valtia', adjective: 'Valtish', colour: '#3F7D5C', standing: 'allied',
      codes: ['578', '752', '246'], recognise: true },
    { name: 'Korrin', adjective: 'Korrine', colour: '#B4543F', standing: 'hostile',
      codes: ['076', '032', '604'], recognise: false, strength: 45 },
    { name: 'The Meridian League', adjective: 'Meridian', colour: '#5B2E9E', standing: 'neutral',
      codes: ['356', '586', '524'], recognise: true }
  ];
  for (const p of POWERS) {
    const made = await call('/api/admin/foreign/powers', {
      method: 'POST',
      body: { name: p.name, adjective: p.adjective, colour: p.colour, standing: p.standing },
      token: T
    });
    const pid = made?.id || made?.power?.id;
    if (!pid) continue;
    await call(`/api/admin/foreign/powers/${pid}/territories`, { method: 'PUT', body: { codes: p.codes }, token: T });
    if (p.strength) await call(`/api/admin/foreign/powers/${pid}`, { method: 'PATCH', body: { strength: p.strength }, token: T });
  }

  /* A Foreign Minister, so the channel abroad has an owner in the preview.
     free[4] holds no other office; the President appoints because the seeded
     world has no Prime Minister. */
  if (free[4]) {
    await call('/api/diplomacy/foreign-office/appoint', { method: 'POST', body: { user_id: free[4].id }, token: pres });
  }

  /* A Quartermaster with a small standing force, so the Supply page has
     something on it and the upkeep history is not empty. */
  if (free[5]) {
    await call('/api/war/quartermaster/appoint', { method: 'POST', body: { user_id: free[5].id }, token: pres });
    const qmTok = tok[free[5].display_name];
    const works = await call('/api/economy/businesses', {
      method: 'POST',
      body: { name: 'Holt & Sons Ironworks', form: 'company', description: 'Rifles, shot and shovels.', good_category: 'arms' },
      token: tok[PEOPLE[9]]
    });
    if (works?.id) {
      const lot = await call(`/api/economy/businesses/${works.id}/listings`, {
        method: 'POST', body: { title: 'Rifles, crated', price: 12, stock: 300, unit: 'crate' }, token: tok[PEOPLE[9]]
      });
      if (lot?.id) await call(`/api/war/procure/listing/${lot.id}`, { method: 'POST', body: { units: 30 }, token: qmTok });
      await call('/api/war/formations', { method: 'POST', body: { name: 'First Regiment', arm: 'army', size: 3 }, token: qmTok });
    }
  }

  // An election in progress, so the ballot has something to show.
  const next = await call('/api/elections', { method: 'POST', body: { kind: 'president', title: 'Presidential election — cycle 2' }, token: T });
  for (const p of [PEOPLE[0], PEOPLE[3], PEOPLE[6]]) {
    await call(`/api/elections/${next.id}/stand`, { method: 'POST', body: { statement: `${p} for a quieter Republic.` }, token: tok[p] });
  }
  await call(`/api/elections/${next.id}/status`, { method: 'POST', body: { status: 'voting' }, token: T });
  const nc = (await call(`/api/elections/${next.id}`, { token: T })).candidates;
  for (const p of PEOPLE.slice(0, 4)) await call(`/api/elections/${next.id}/vote`, { method: 'POST', body: { candidacy_id: nc[0].id }, token: tok[p] });

  console.log(`
────────────────────────────────────────────────────────
  Preview running:  http://localhost:${PORT}

  Sign in as any of these — password: ${PW}

    admin      the Returning Officer — sees everything
    ${mps[0].display_name.toLowerCase().padEnd(10)} the Speaker — tables bills, calls and closes divisions
    ${free[0].display_name.toLowerCase().padEnd(10)} the President — assent, veto, and Article 12
    ${mps[1].display_name.toLowerCase().padEnd(10)} an ordinary MP — votes in divisions
    ${(free[2]?.display_name || '—').toLowerCase().padEnd(10)} the Treasurer — names the money, reports to the House
    ${(free[3]?.display_name || '—').toLowerCase().padEnd(10)} the head of the Fed — rates, issuance, bank licences
    ${(free[4]?.display_name || '—').toLowerCase().padEnd(10)} the Foreign Minister — holds the channel abroad
    ${(free[5]?.display_name || '—').toLowerCase().padEnd(10)} the Quartermaster — buys equipment, keeps the forces supplied
    ${PEOPLE[9].toLowerCase().padEnd(10)} an ordinary citizen — no office at all, but owns a bank

  Nothing here touches your live Republic. Ctrl+C and it is gone.
────────────────────────────────────────────────────────
`);
}

console.log(`[preview] site + API on http://localhost:${PORT} — seeding…`);
seed().catch(err => console.error('[preview] seeding failed:', err));
