/* A tie for the last seat.
 *
 * The tiebreak used to be `ORDER BY votes DESC, u.display_name`, and a display
 * name is a field the candidate edits from their own account page — including
 * while the poll is open. So the seat went to whoever renamed themselves
 * earliest in the alphabet. It now goes to a run-off between exactly the
 * candidates who are level, and only when the tie actually decides a seat.
 */

import { call, ok, report, setup, PW } from './world.mjs';

const w = await setup({ citizens: 7, parliament: false });
const T = w.admin.token;

const roll = (await call('/api/citizens')).d.filter(c => c.display_name !== 'Uzair');
const tokOf = n => w.tok[n];

/* Two seats, three candidates. Two of them tie on one vote each for the second
   seat and one wins outright, so the tie decides exactly one seat. */
async function ballot({ seats, standing, votes, title }) {
  const el = (await call('/api/elections', {
    method: 'POST', body: { kind: 'parliament', title, seats }, token: T
  })).d;
  for (const p of standing)
    await call(`/api/elections/${el.id}/stand`, { method: 'POST', body: { statement: p }, token: tokOf(p) });
  await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'voting' }, token: T });
  const cands = (await call(`/api/elections/${el.id}`, { token: T })).d.candidates;
  const idOf = name => cands.find(c => c.display_name === name).id;
  for (const [voter, forWhom] of votes)
    await call(`/api/elections/${el.id}/vote`, {
      method: 'POST', body: { candidacy_id: idOf(forWhom) }, token: tokOf(voter)
    });
  const out = (await call(`/api/elections/${el.id}/status`, {
    method: 'POST', body: { status: 'closed' }, token: T
  })).d;
  return { el, out };
}

const A = roll[0].display_name, Bc = roll[1].display_name, C = roll[2].display_name;
const D = roll[3].display_name, E = roll[4].display_name, F = roll[5].display_name;

console.log('\n-- a tie that decides a seat goes to a run-off');
const first = await ballot({
  seats: 2,
  title: 'Parliament',
  standing: [A, Bc, C],
  // A wins outright on two; B and C are level on one for the remaining seat.
  votes: [[A, A], [Bc, A], [C, Bc], [D, C]]
});
ok(first.out.tie === true, 'the ballot reports a tie');
ok(first.out.runoff === true, 'and a run-off was called');
ok(first.out.seated.length === 1, `only the clear winner is seated (${first.out.seated.length})`);
ok(first.out.seated[0].name === A, `${A} took the seat that was not in doubt`);

const open = (await call('/api/elections', { token: T })).d;
const ro = open.find(x => x.runoff_of === first.el.id);
ok(!!ro, 'the run-off exists and points at the ballot that tied');
ok(ro && ro.status === 'voting', 'it is open for voting straight away — the candidates are already known');
ok(ro && Number(ro.seats) === 1, `it contests exactly the seat in doubt (${ro && ro.seats})`);

const roCands = (await call(`/api/elections/${ro.id}`, { token: T })).d.candidates.map(c => c.display_name).sort();
ok(roCands.length === 2, `only the tied candidates stand (${roCands.length})`);
ok(!roCands.includes(A), 'the candidate already seated is not in it');

console.log('\n-- renaming yourself no longer wins it');
await call('/api/me', { method: 'PUT', body: { display_name: 'AAA ' + C }, token: tokOf(C) });
const stillTwo = (await call(`/api/elections/${ro.id}`, { token: T })).d.candidates.length;
ok(stillTwo === 2, 'the run-off is unaffected by a rename');

console.log('\n-- the run-off decides it, and does not unseat anybody');
const roCand = (await call(`/api/elections/${ro.id}`, { token: T })).d.candidates;
const bId = roCand.find(c => c.user_id === roll[1].id).id;
for (const v of [A, Bc, C, D]) await call(`/api/elections/${ro.id}/vote`, {
  method: 'POST', body: { candidacy_id: bId }, token: tokOf(v)
});
const done = (await call(`/api/elections/${ro.id}/status`, {
  method: 'POST', body: { status: 'closed' }, token: T
})).d;
ok(done.seated.length === 1, `the run-off seats one member (${done.seated.length})`);
ok(done.seated[0].name === Bc, `${Bc} won it outright`);

const house = (await call('/api/citizens')).d.filter(c => (c.offices || []).includes('mp'));
ok(house.length === 2, `the House is full: both seats sat (${house.length})`);
ok(house.some(m => m.display_name === A), 'the member seated before the run-off is still sitting');
const mpSeats = (await call('/api/state')).d.offices.filter(o => o.office === 'mp').map(o => o.seat);
ok(mpSeats.length === 2, `two seats are recorded (${mpSeats.length})`);
ok(mpSeats.every(s => s !== null) && new Set(mpSeats).size === mpSeats.length,
  `no two members share a seat number (${mpSeats.join(',')})`);

console.log('\n-- a tie that decides nothing is left alone');
await call('/api/admin/office', { method: 'POST', body: { user_id: roll[0].id, office: 'mp', remove: true }, token: T });
await call('/api/admin/office', { method: 'POST', body: { user_id: roll[1].id, office: 'mp', remove: true }, token: T });
const quiet = await ballot({
  seats: 3,
  title: 'Parliament again',
  standing: [D, E, F],
  // Three candidates, three seats, all level on one vote. Everybody is seated
  // anyway, so there is nothing for a run-off to decide.
  votes: [[A, D], [Bc, E], [C, F]]
});
ok(quiet.out.tie === false, 'level candidates who are all being seated are not a tie');
ok(!quiet.out.runoff, 'so no run-off is called');
ok(quiet.out.seated.length === 3, `all three take their seats (${quiet.out.seated.length})`);

const after = (await call('/api/elections', { token: T })).d.filter(x => x.runoff_of);
ok(after.length === 1, `exactly one run-off was ever created (${after.length})`);

report();
