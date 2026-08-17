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
  if (!r.ok) console.error('[DEBUG]', method, p, r.status, t.slice(0, 300));
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
  // For a bill some other route already created for us (recognition, a
  // charter) — carries an existing id through second/table/division/assent
  // rather than posting a new one via /api/bills.
  const carryBill = async (id) => {
    if (!id) return;
    await call(`/api/bills/${id}/second`, { method: 'POST', token: mpTok[1] });
    await call(`/api/bills/${id}/second`, { method: 'POST', token: mpTok[2] });
    await call(`/api/bills/${id}/table`, { method: 'POST', token: spk });
    await call(`/api/bills/${id}/division`, { method: 'POST', token: spk });
    for (const t of mpTok) await call(`/api/bills/${id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
    await call(`/api/bills/${id}/close`, { method: 'POST', token: spk });
    await call(`/api/bills/${id}/assent`, { method: 'POST', token: pres });
  };
  await pass({ title: 'Quiet Hours Act', kind: 'law', body: '## 1\nNo polls shall close between midnight and eight.' });

  const live = await call('/api/bills', { method: 'POST', body: { title: 'Tea Break Act', kind: 'law', body: '## 1\nEvery sitting shall pause for tea.' }, token: mpTok[1] });
  await call(`/api/bills/${live.id}/second`, { method: 'POST', token: mpTok[0] });
  await call(`/api/bills/${live.id}/second`, { method: 'POST', token: mpTok[2] });
  await call(`/api/bills/${live.id}/table`, { method: 'POST', token: spk });
  await call(`/api/bills/${live.id}/division`, { method: 'POST', token: spk });
  await call(`/api/bills/${live.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: mpTok[0] });
  await call(`/api/bills/${live.id}/vote`, { method: 'POST', body: { vote: 'no' }, token: mpTok[1] });
  // mpTok[3] || the last MP: the election does not always seat four or more —
  // indexing off the end of a short House produced an unauthenticated call
  // and an "undefined" bill id further down. Same fix at the Ferry Timetable
  // Act below.
  await call(`/api/bills/${live.id}/comments`, { method: 'POST', body: { body: 'Tea at four is the only civilised hour.' }, token: mpTok[3] || mpTok[mpTok.length - 1] });

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
  const forSpeaker = await call('/api/bills', { method: 'POST', body: { title: 'Ferry Timetable Act', kind: 'law', body: 'The ferry shall run hourly.' }, token: mpTok[3] || mpTok[mpTok.length - 1] });
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

  /* Five foreign powers with real territory and real archetypes, so the map
     and the diplomacy page both show a genuine world, not one generic
     government repeated. Real coastlines, invented countries: the codes below
     are shapes, and the names are the only names a player ever sees for them.
     Ashvale is a crown — the only way the preview shows succession actually
     working — and Kesh is a tribal confederation, the one archetype in the
     catalogue that plausibly refuses a defector outright. */
  await call('/api/admin/config', { method: 'PUT', body: { diplomacy_enabled: 'true', offshore_enabled: 'true' }, token: T });
  const POWERS = [
    { name: 'Valtia', adjective: 'Valtish', colour: '#3F7D5C', standing: 'allied',
      codes: ['578', '752', '246'], archetype: 'merchant_republic', recognise: true },
    { name: 'Korrin', adjective: 'Korrine', colour: '#B4543F', standing: 'hostile',
      codes: ['076', '032', '604'], archetype: 'military_junta', recognise: false, strength: 45 },
    { name: 'The Meridian League', adjective: 'Meridian', colour: '#5B2E9E', standing: 'neutral',
      codes: ['356', '586', '524'], archetype: 'federal_democracy', recognise: true },
    { name: 'Ashvale', adjective: 'Ashvale', colour: '#9C7A1E', standing: 'neutral',
      codes: ['634', '512', '784'], archetype: 'absolute_monarchy', recognise: true },
    { name: 'Kesh Confederacy', adjective: 'Keshi', colour: '#6B6B6B', standing: 'strained',
      codes: ['646', '231', '262'], archetype: 'tribal_confederation', recognise: true }
  ];
  const powerId = {};
  for (const p of POWERS) {
    const made = await call('/api/admin/foreign/powers', {
      method: 'POST',
      body: { name: p.name, adjective: p.adjective, colour: p.colour, standing: p.standing, archetype: p.archetype },
      token: T
    });
    const pid = made?.id || made?.power?.id;
    if (!pid) continue;
    powerId[p.name] = pid;
    await call(`/api/admin/foreign/powers/${pid}/territories`, { method: 'PUT', body: { codes: p.codes }, token: T });
    if (p.strength) await call(`/api/admin/foreign/powers/${pid}`, { method: 'PUT', body: { strength: p.strength }, token: T });
    // Recognition is a vote, not a Returning Officer toggle — the same House
    // stages as any other bill.
    if (p.recognise) {
      const bill = await call(`/api/diplomacy/powers/${pid}/recognition`, { method: 'POST', token: mpTok[0] });
      await carryBill(bill?.id);
    }
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

  /* A Presidential Budget for the next cycle, carried by division — it is
     tabled the moment the President proposes it, so there is no second or
     table stage, and it is decided by the House rather than sent back for
     assent. */
  const budget = await call('/api/budget/propose', {
    method: 'POST',
    body: {
      tax_free_allowance: 500, tax_rate: 0.15, tax_upper_threshold: 5000, tax_rate_upper: 0.3, import_tariff: 0.05,
      // intelligence: 20000 — the Budget activates before the operation below
      // is ordered, and activation overwrites the Service's recurring
      // appropriation from its own charter (budget.js, ENFORCED_DEPARTMENTS).
      // Underfund it here and NIGHTJAR's 15000 bounces off a 409 that looks
      // like a bug in the operation math when it is really the department
      // line running short.
      departments: { executive: 2000, legislature: 1500, judiciary: 1000, treasury: 1500, foreign_affairs: 1200, defence: 3000, intelligence: 20000 },
      rationale: 'A settled tax base to fund the Service and the standing force, rather than running both off the dividend float.'
    },
    token: pres
  });
  if (budget?.bill_id) {
    await call(`/api/bills/${budget.bill_id}/division`, { method: 'POST', token: spk });
    for (const t of mpTok) await call(`/api/bills/${budget.bill_id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
    await call(`/api/bills/${budget.bill_id}/close`, { method: 'POST', token: spk });
  }

  /* The intelligence service, chartered by motion like offshore.js's own
     inquiries and seizures — a vote instructing something into existence,
     not a console toggle. mps[2] is an ordinary backbencher, not the Speaker
     or an economic portfolio, so nothing about the Director's office clashes
     with a House seat. */
  const charter = await call('/api/intel/establish', {
    method: 'POST',
    body: {
      title: 'Establishment of an Intelligence Service',
      charter: 'A standing service to collect abroad and sweep for foreign collection at home, answerable to the House through its Director.',
      declassify_after_cycles: 2,
      budget_per_cycle: 20000
    },
    token: mpTok[0]
  });
  await carryBill(charter?.id);

  // Fund the Service, the offshore desk, and the powers' own treasuries
  // before spending against any of them — the same "payrun habit" the
  // foreign-power runbook warns a preview without it goes dry.
  await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 2 }, token: T });

  if (mps[2]) {
    await call('/api/intel/director/nominate', { method: 'POST', body: { user_id: mps[2].id }, token: pres });
    for (const t of mpTok) {
      const r = await call('/api/intel/director/confirm', { method: 'POST', token: t });
      if (r.confirmed) break;
    }
    const dirTok = tok[mps[2].display_name];
    // Clearance is a row in the register, not an office — granted to a couple
    // of citizens who hold no office at all, to show it is not tied to one.
    if (free[1]) await call('/api/intel/clearance', { method: 'POST', body: { user_id: free[1].id, reason: 'Foreign-desk briefings.' }, token: dirTok });
    if (free[4]) await call('/api/intel/clearance', { method: 'POST', body: { user_id: free[4].id, reason: 'Foreign Minister — reads the cable traffic and the sealed account of it.' }, token: dirTok });
    // A player-agent, enlisted onto the Director's own roster — separate from
    // clearance, and separate from the salary the payrun below will fund.
    if (free[1]) await call('/api/intel/agents', {
      method: 'POST',
      body: { user_id: free[1].id, role: 'field officer, Valtia desk', salary_per_cycle: 150, operation_pay: 100 },
      token: dirTok
    });

    // One operation the agency can actually run at tier 1: a source placed at
    // the one hostile power on the board. threshold = 0 + counter_intel(50);
    // score = tradecraft(0) + floor(15000/200) = 75, comfortably over — so
    // the public register and the sealed report both have a real result on
    // first load, not a fabricated one. Left under the 20000 cycle funding so
    // the counter-sweep below still has budget to spend.
    if (powerId.Korrin) {
      await call('/api/intel/operations', {
        method: 'POST',
        body: { kind: 'recruit_asset', power_id: powerId.Korrin, budget: 15000, codename: 'NIGHTJAR', notes: 'A junior clerk in Korrin\'s procurement office, recruited for cash.' },
        token: dirTok
      });
    }
    // The cheapest tier-1 mission in the catalogue, and the only one that
    // touches no foreign power's row — a domestic sweep, for contrast.
    await call('/api/intel/counter-sweep', { method: 'POST', body: { budget: 500 }, token: dirTok });
  }

  /* A defection, and what a defector can actually become abroad. free[1]
     holds no office, so nothing needs vacating first (unlike the Returning
     Officer, who cannot defect while holding the Republic's own keys — see
     CLAUDE.md). Ashvale has a crown, so this is the seed's one citizen
     genuinely queued to wear one. */
  if (free[1] && powerId.Ashvale) {
    const defTok = tok[free[1].display_name];
    await call('/api/defection', {
      method: 'POST',
      body: { power_id: powerId.Ashvale, reasons: 'Tired of the reading, and Ashvale pays better attention to its clerks.' },
      token: defTok
    });
    await call(`/api/diplomacy/foreign/${powerId.Ashvale}/petition`, { method: 'POST', body: { mode: 'succession' }, token: defTok });
  }
  /* A second defection against Kesh, which takes no foreigners — the
     petition should come back a plain refusal rather than a queue, which is
     the interesting case to have on screen. mps[3] is not the Speaker or an
     economic portfolio, so defecting costs them nothing but a House seat. */
  if (mps[3] && powerId['Kesh Confederacy']) {
    const refuseeTok = tok[mps[3].display_name];
    await call('/api/defection', {
      method: 'POST',
      body: { power_id: powerId['Kesh Confederacy'], reasons: 'Kesh offered land; the House only ever offered committee work.' },
      token: refuseeTok
    });
    await call(`/api/diplomacy/foreign/${powerId['Kesh Confederacy']}/petition`, { method: 'POST', body: { mode: 'cabinet' }, token: refuseeTok });
  }

  /* An offshore account and one forex conversion, so the money desk is not
     empty either. PEOPLE[9] already has an economic footprint (the two
     banks above), so this is the same citizen banking abroad too. */
  const offshoreTok = tok[PEOPLE[9]];
  if (offshoreTok && powerId.Valtia) {
    await call('/api/offshore/open', { method: 'POST', body: { power_id: powerId.Valtia }, token: offshoreTok });
    await call('/api/offshore/deposit', { method: 'POST', body: { power_id: powerId.Valtia, amount: 1000 }, token: offshoreTok });
    await call('/api/forex/buy', { method: 'POST', body: { power_id: powerId.Valtia, amount: 500 }, token: offshoreTok });
  }

  // An election in progress, so the ballot has something to show.
  const next = await call('/api/elections', { method: 'POST', body: { kind: 'president', title: 'Presidential election — cycle 2' }, token: T });
  for (const p of [PEOPLE[0], PEOPLE[3], PEOPLE[6]]) {
    await call(`/api/elections/${next.id}/stand`, { method: 'POST', body: { statement: `${p} for a quieter Republic.` }, token: tok[p] });
  }
  await call(`/api/elections/${next.id}/status`, { method: 'POST', body: { status: 'voting' }, token: T });
  const nc = (await call(`/api/elections/${next.id}`, { token: T })).candidates;
  for (const p of PEOPLE.slice(0, 4)) await call(`/api/elections/${next.id}/vote`, { method: 'POST', body: { candidacy_id: nc[0].id }, token: tok[p] });

  /* Re-read the roll instead of indexing `free`, which was computed before any
     office was granted. Indexing it for "somebody with no office" printed a
     name that had since become the Foreign Minister, so the preview listed the
     same person twice and had no working login for the view with no office —
     the view most players have, and the one most often broken. */
  // Defectors also carry zero offices, so they are excluded here by name —
  // otherwise the last line below could print a foreign subject's login
  // under the label "no office at all", which is not what they are anymore.
  const defectorNames = new Set([free[1]?.display_name, mps[3]?.display_name].filter(Boolean));
  const noOffice = (await call('/api/citizens')).find(
    c => !(c.offices || []).length && c.display_name !== 'Returning Officer' && !defectorNames.has(c.display_name)
  );

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
    ${(mps[2]?.display_name || '—').toLowerCase().padEnd(10)} the Director of Intelligence — clearance, operations, the sealed reports
    ${(free[1]?.display_name || '—').toLowerCase().padEnd(10)} renounced for Ashvale — queued in the line of succession to its crown
    ${(mps[3]?.display_name || '—').toLowerCase().padEnd(10)} renounced for Kesh — refused a seat, Kesh takes no foreigners
    ${(noOffice?.display_name || '—').toLowerCase().padEnd(10)} an ordinary citizen — no office at all, which is most people

  Nothing here touches your live Republic. Ctrl+C and it is gone.
────────────────────────────────────────────────────────
`);
}

console.log(`[preview] site + API on http://localhost:${PORT} — seeding…`);
seed().catch(err => console.error('[preview] seeding failed:', err));
