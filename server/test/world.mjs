/* Shared setup. Every suite runs against a freshly booted server with an empty
   database, and builds the world it needs from nothing. No suite depends on
   another having run first, so they can run in any order or on their own. */

export const B = 'http://localhost:' + (process.env.TEST_PORT || '4321');

let fails = 0;
export const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };
export const report = () => {
  console.log(fails ? `\n${fails} FAILURES` : '\nall green');
  process.exit(fails ? 1 : 0);
};

export async function call(path, { method = 'GET', body, token, raw } = {}) {
  const r = await fetch(B + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: raw ? token : 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
}

export const PW = 'hunter22';

/* Founder, `n` approved citizens, a seated parliament, a Speaker and a President. */
export async function setup({ citizens = 7, parliament = true } = {}) {
  // 7, not 6: five take seats and one becomes President, leaving one citizen who
  // holds no office at all — which is exactly who you need to test what an
  // ordinary person can and cannot do.
  const founder = (await call('/api/auth/register', {
    method: 'POST', body: { username: 'uzair', display_name: 'Uzair', password: PW }
  })).d;

  const codes = (await call('/api/admin/invites', {
    method: 'POST', body: { count: citizens, note: 'test' }, token: founder.token
  })).d;

  for (let i = 0; i < citizens; i++) {
    await call('/api/auth/register', {
      method: 'POST',
      body: { invite: codes[i], username: 'cit' + i, display_name: 'Citizen ' + i, password: PW }
    });
  }
  for (const u of (await call('/api/admin/pending', { token: founder.token })).d) {
    await call('/api/admin/approve', { method: 'POST', body: { user_id: u.id, approve: true }, token: founder.token });
  }

  const users = [founder];
  for (let i = 0; i < citizens; i++) {
    users.push((await call('/api/auth/login', { method: 'POST', body: { username: 'cit' + i, password: PW } })).d);
  }

  const world = { admin: founder, users, tok: {} };
  for (const u of users) world.tok[u.user.display_name] = u.token;
  if (!parliament) return world;

  // A parliament, elected properly rather than appointed, so offices carry an election_id.
  const el = (await call('/api/elections', {
    method: 'POST', body: { kind: 'parliament', title: 'Founding election' }, token: founder.token
  })).d;
  for (let i = 1; i <= citizens; i++) {
    await call(`/api/elections/${el.id}/stand`, { method: 'POST', body: { statement: 'x' }, token: users[i].token });
  }
  await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'voting' }, token: founder.token });
  const cands = (await call(`/api/elections/${el.id}`, { token: founder.token })).d.candidates;
  const plan = [0, 0, 1, 1, 2, 3, 4];
  for (let i = 0; i < users.length; i++) {
    await call(`/api/elections/${el.id}/vote`, {
      method: 'POST', body: { candidacy_id: cands[plan[i % plan.length]].id }, token: users[i].token
    });
  }
  await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'closed' }, token: founder.token });

  const roll = (await call('/api/citizens')).d;
  world.mps = roll.filter(c => (c.offices || []).includes('mp'));
  world.T = world.mps.map(m => world.tok[m.display_name]);

  await call('/api/admin/office', { method: 'POST', body: { user_id: world.mps[0].id, office: 'speaker' }, token: founder.token });
  const outsider = roll.find(c => !(c.offices || []).includes('mp') && c.display_name !== 'Uzair');
  world.presUser = outsider || roll.find(c => c.display_name !== 'Uzair');
  await call('/api/admin/office', { method: 'POST', body: { user_id: world.presUser.id, office: 'president' }, token: founder.token });

  world.spk = world.T[0];
  world.pres = world.tok[world.presUser.display_name];
  // Re-read the roll AFTER the offices are handed out, or `offices` on each
  // citizen is a stale empty array and tests pick the President as their
  // "ordinary citizen".
  world.citizens = (await call('/api/citizens')).d;
  world.plain = world.citizens.find(c => !(c.offices || []).length && c.display_name !== 'Uzair');
  world.plainTok = world.plain ? world.tok[world.plain.display_name] : null;
  return world;
}

/* Push a bill all the way to enactment. Returns the bill row. */
export async function passBill(w, body, { assent = true } = {}) {
  const bill = (await call('/api/bills', { method: 'POST', body, token: w.T[0] })).d;
  await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[1] });
  await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[2] });
  await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${bill.id}/division`, { method: 'POST', token: w.spk });
  for (const t of w.T) await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
  await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: w.spk });
  if (assent) await call(`/api/bills/${bill.id}/assent`, { method: 'POST', token: w.pres });
  return bill;
}
