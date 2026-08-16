/* A citizen's career is assembled from tables that already hold the history:
   offices (inactive rows included), bills.author_id, and candidacies. Nothing
   new is tracked — this just checks the assembly and that the route is public
   read, like /api/citizens and /api/audit. */
import { call, ok, report, setup, passBill } from './world.mjs';
const w = await setup();

console.log('\n-- unknown citizen');
ok((await call('/api/citizens/999999/career')).status === 404, 'a nonexistent citizen 404s');

console.log('\n-- offices, including who is not admin, need no auth to read');
const spkId = w.mps[0].id;
const c1 = (await call(`/api/citizens/${spkId}/career`)).d;
ok(c1.offices.some(o => o.office === 'mp' && o.active), 'holds mp');
ok(c1.offices.some(o => o.office === 'speaker' && o.active), 'holds speaker');
ok(c1.offices.every(o => o.since), 'every office row carries a since');

console.log('\n-- bills authored');
const bill = await passBill(w, { title: 'Career Test Act', body: 'x' });
const c2 = (await call(`/api/citizens/${spkId}/career`)).d;
ok(c2.bills.some(b => b.id === bill.id && b.title === 'Career Test Act'), 'the bill shows up under its author');

console.log('\n-- elections contested, won and lost');
const elections = (await call('/api/elections')).d;
const founding = elections.find(e => e.title === 'Founding election');
const cands = (await call(`/api/elections/${founding.id}`)).d.candidates;
const winner = cands.find(c => w.mps.some(m => m.id === c.user_id));
const loser = cands.find(c => !w.mps.some(m => m.id === c.user_id));
ok(!!winner && !!loser, 'the founding election has both a winner and a loser to check');

const cw = (await call(`/api/citizens/${winner.user_id}/career`)).d;
ok(cw.elections.some(e => e.election_id === founding.id && e.won === true), 'a winner is marked won');

const cl = (await call(`/api/citizens/${loser.user_id}/career`)).d;
ok(cl.elections.some(e => e.election_id === founding.id && e.won === false), 'a loser is not');

report();
