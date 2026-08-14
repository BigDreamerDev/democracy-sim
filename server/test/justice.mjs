/* The People's Justice — Article 17.1.

   The Citizens' seat on the Court used to be a name the Returning Officer typed
   in. It is a ballot now, and the properties worth holding are the ones that
   make it a real one:

     - nobody can appoint to it, including the RO;
     - the whole Republic votes, not the House;
     - a tie leaves the seat empty rather than picking by display name, because
       display names are editable and the seat is held for a fixed term;
     - the winner cannot hold another office (17.11);
     - it cannot unseat a sitting Justice mid-term (17.3);
     - the electing does not disturb the other two seats;
     - the term actually ends, and the next ballot calls itself. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 9 });
const T = w.admin.token;
const cfg = b => call('/api/admin/config', { method: 'PUT', body: b, token: T });
const court = t => call('/api/court', { token: t }).then(r => r.d);
const seat3 = async () => (await court()).seats[2];

const free = w.citizens.filter(c => !(c.offices || []).length && c.display_name !== 'Uzair');
const [a, b, c] = free;

const callBallot = () =>
  call('/api/elections', { method: 'POST', body: { kind: 'justice', title: "The People's Justice" }, token: T })
    .then(r => r.d);
const stand = (e, tok) => call(`/api/elections/${e.id}/stand`, { method: 'POST', token: tok });
const open = e => call(`/api/elections/${e.id}/status`, { method: 'POST', body: { status: 'voting' }, token: T });
const close = e => call(`/api/elections/${e.id}/status`, { method: 'POST', body: { status: 'closed' }, token: T })
  .then(r => r.d);
const runners = async e => (await call(`/api/elections/${e.id}`)).d.candidates;
const voteFor = (e, cand, toks) =>
  Promise.all(toks.map(t => call(`/api/elections/${e.id}/vote`, { method: 'POST', body: { candidacy_id: cand.id }, token: t })));

console.log('-- nobody appoints to it');

ok((await seat3()).appointer === 'people', 'seat 3 belongs to the Citizens');
for (const [who, tok] of [['the Returning Officer', T], ['the Speaker', w.spk], ['the President', w.pres]]) {
  ok((await call('/api/court/seats/3', { method: 'POST', body: { user_id: a.id }, token: tok })).status === 403,
    `${who} cannot fill it`);
}
ok((await call('/api/court/seats/3', { method: 'POST', body: { user_id: a.id }, token: T })).d.error.includes('ballot'),
  'and the refusal says to call a ballot instead');

console.log('\n-- the whole Republic votes');

let e = await callBallot();
ok(!!e.id, 'the ballot is called');
ok((await call(`/api/elections/${e.id}`)).d.eligible === w.citizens.length,
  `every citizen is on the roll, not just the House (${w.citizens.length})`);
ok((await call(`/api/elections/${e.id}/stand`, { method: 'POST', token: w.plainTok })).status === 200,
  'any citizen may stand');

console.log('\n-- a tie leaves the seat empty');

await stand(e, w.tok[a.display_name]);
await stand(e, w.tok[b.display_name]);
await open(e);
let cands = await runners(e);
const forA = cands.find(x => x.display_name === a.display_name);
const forB = cands.find(x => x.display_name === b.display_name);
await voteFor(e, forA, [w.spk, w.pres]);
await voteFor(e, forB, [w.T[1], w.T[2]]);
let out = await close(e);
ok(out.tie === true, 'a tied ballot is declared tied');
ok(!(await seat3()).user_id, 'and the seat stays empty — no winner picked by display name');
ok(/tied/.test(out.reason || ''), 'with a reason a player can read');

console.log('\n-- electing one');

e = await callBallot();
await stand(e, w.tok[a.display_name]);
await stand(e, w.tok[b.display_name]);
await open(e);
cands = await runners(e);
await voteFor(e, cands.find(x => x.display_name === a.display_name), [w.spk, w.pres, w.T[1]]);
await voteFor(e, cands.find(x => x.display_name === b.display_name), [w.T[2]]);
out = await close(e);
ok(out.seated?.length === 1 && out.seated[0].name === a.display_name, `${a.display_name} is elected`);
const s3 = await seat3();
ok(s3.display_name === a.display_name, 'and holds seat 3');
ok(!!s3.term_ends, 'for a fixed term');
ok((await call('/api/me', { token: w.tok[a.display_name] })).d.offices.includes('justice'),
  'and holds the office of justice, so impeachment reaches them like anyone');

console.log('\n-- it disturbs nothing else');

await call('/api/court/seats/1', { method: 'POST', body: { user_id: b.id }, token: w.spk });
await call('/api/court/seats/2', { method: 'POST', body: { user_id: c.id }, token: w.pres });
ok((await court()).sitting === 3, 'the bench is full');

e = await callBallot();
await stand(e, w.plainTok);
await open(e);
out = await close(e);
ok(out.void === true, 'a ballot for a seat already filled is void');
ok((await seat3()).display_name === a.display_name, 'the sitting Justice is untouched — a term means something');
const bench = (await court()).seats;
ok(bench[0].display_name === b.display_name && bench[1].display_name === c.display_name,
  "and the House's and President's Justices are untouched too");

console.log('\n-- Article 17.11');

await call('/api/court/seats/3/vacate', { method: 'POST', token: w.tok[a.display_name] });
e = await callBallot();
await stand(e, w.T[1]);            // a sitting MP
await open(e);
cands = await runners(e);
await voteFor(e, cands[0], [w.spk, w.pres, w.T[2]]);
out = await close(e);
ok(out.seated.length === 0, 'a sitting MP who wins is not seated');
ok(/holds office/.test(out.reason || ''), 'and is told to resign it first');
ok(!(await seat3()).user_id, 'the seat stays empty rather than putting one person in two offices');

console.log('\n-- the term ends, and the next ballot calls itself');

await cfg({ justice_auto: 'false', justice_terms: '2', cycle_days: '7' });
e = await callBallot();
await stand(e, w.tok[a.display_name]);
await open(e);
cands = await runners(e);
await voteFor(e, cands[0], [w.spk, w.pres, w.T[1]]);
out = await close(e);
ok(!!out.term_ends, 'a Justice is elected with a term');
const days = Math.round((new Date(out.term_ends) - Date.now()) / 86400000);
ok(days === 14, `two cycles of seven days is a fortnight (got ${days})`);

/* Rather than a test-only way to wind the clock back, shrink the cycle so the
   next term is over in a second. The term is justice_terms x cycle_days either
   way, so this exercises the real arithmetic. */
await call('/api/court/seats/3/vacate', { method: 'POST', token: w.tok[a.display_name] });
await cfg({ cycle_days: '0.00002' });          // two cycles ~= 3.5 seconds
e = await callBallot();
await stand(e, w.tok[a.display_name]);
await open(e);
cands = await runners(e);
await voteFor(e, cands[0], [w.spk, w.pres, w.T[1]]);
await close(e);
ok(!!(await seat3()).user_id, 'a Justice sits');
await new Promise(r => setTimeout(r, 4000));
await cfg({ justice_auto: 'true' });
await call('/api/admin/tick', { method: 'POST', token: T });
ok(!(await seat3()).user_id, 'when the term runs out the seat empties itself');
ok((await court()).ballot?.status === 'nominations', 'and the next ballot is already open');

report();
