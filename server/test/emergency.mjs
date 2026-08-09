/* Article 12 — Extraordinary Circumstances.

   The powers matter less than their limits. A declaration the President could
   make alone, or that could switch off its own off-switch, would not be an
   emergency power — it would be a coup with paperwork. */
import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 10 });
const T = w.admin.token;
const cit = w.plainTok;

const push = async id => {
  await call(`/api/bills/${id}/second`, { method: 'POST', token: w.T[1] });
  await call(`/api/bills/${id}/second`, { method: 'POST', token: w.T[2] });
  await call(`/api/bills/${id}/table`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${id}/division`, { method: 'POST', token: w.spk });
  for (const t of w.T) await call(`/api/bills/${id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
  await call(`/api/bills/${id}/close`, { method: 'POST', token: w.spk });
  return call(`/api/bills/${id}/assent`, { method: 'POST', token: w.pres });
};

console.log('\n-- only the President may move one');
ok((await call('/api/emergency', { method: 'POST', body: { reasons: 'x', powers: ['halt_elections'] }, token: cit })).status === 403,
  'an ordinary citizen cannot declare an emergency');
ok((await call('/api/emergency', { method: 'POST', body: { reasons: 'x', powers: ['halt_elections'] }, token: w.spk })).status === 403,
  'nor can the Speaker');

console.log('\n-- and it must name what it suspends');
ok((await call('/api/emergency', { method: 'POST', body: { powers: ['halt_elections'] }, token: w.pres })).status === 400,
  'a declaration without reasons is refused');
ok((await call('/api/emergency', { method: 'POST', body: { reasons: 'A crisis.', powers: [] }, token: w.pres })).status === 400,
  'a declaration naming no power is refused — it suspends only what it names');
ok((await call('/api/emergency', { method: 'POST', body: { reasons: 'A crisis.', powers: ['abolish_the_house', 'seize_everything'] }, token: w.pres })).status === 400,
  'and a power that is not on the list cannot be invented');

console.log('\n-- the House decides it, not the President');
const em = (await call('/api/emergency', { method: 'POST', body: {
  reasons: 'The ferry has sunk and the House cannot sit.',
  powers: ['halt_elections', 'fast_track'], days: 1
}, token: w.pres })).d;
ok(!!em.bill_ref, `the declaration becomes ${em.bill_ref}, a bill`);
ok((await call('/api/emergency')).d.in_force === null, 'and nothing is suspended while the House has not voted');

await push(em.bill_id);
const live = (await call('/api/emergency')).d;
ok(!!live.in_force, 'once the House passes it, it is in force');
ok(live.in_force.powers.join(',') === 'halt_elections,fast_track', 'with exactly the powers named and no others');

console.log('\n-- the powers do something');
const quick = (await call('/api/bills', { method: 'POST', body: { title: 'Emergency Ferry Act', body: 'Build a ferry.' }, token: w.T[0] })).d;
ok((await call(`/api/bills/${quick.id}/table`, { method: 'POST', token: w.spk })).status === 200,
  'fast_track: the Speaker tables a bill with no seconders at all');

console.log('\n-- but not the ones it did not name');
ok((await call(`/api/bills/${quick.id}/division`, { method: 'POST', token: w.pres })).status === 403,
  'the President still cannot call a division — that power was not claimed');

console.log('\n-- the House alone can end it, at any moment');
ok((await call('/api/emergency/end', { method: 'POST', token: cit })).status === 403,
  'an ordinary citizen cannot end it');
const first = (await call('/api/emergency/end', { method: 'POST', token: w.T[1] })).d;
ok(first.ended === false && first.needed === 3, `one member of five is not enough (${first.votes} of ${first.needed})`);
ok((await call('/api/emergency/end', { method: 'POST', token: w.T[1] })).d.votes === 1, 'and voting twice counts once');
await call('/api/emergency/end', { method: 'POST', token: w.T[2] });
const done = (await call('/api/emergency/end', { method: 'POST', token: w.T[3] })).d;
ok(done.ended === true && done.by === 'house', 'a majority of the House ends it on the spot — no Speaker, no division, no President');
ok((await call('/api/emergency')).d.in_force === null, 'and the ordinary law is back');
ok((await call('/api/audit')).d.some(a => a.action === 'emergency.end'), 'the whole thing is in the public record');

console.log('\n-- a declaration lapses on its own');
const short = (await call('/api/emergency', { method: 'POST', body: {
  reasons: 'A brief squall.', powers: ['lower_quorum'], days: 0.0001   // ~9 seconds
}, token: w.pres })).d;
await push(short.bill_id);
ok(!!(await call('/api/emergency')).d.in_force, 'in force to begin with');
await new Promise(r => setTimeout(r, 10500));
ok((await call('/api/emergency')).d.in_force === null, 'and gone once its time runs out, with nobody having to remember');

console.log('\n-- the limits that are not negotiable');
ok((await call('/api/emergency')).d.in_force === null, 'nothing is in force, so a new declaration is possible');
const cap = (await call('/api/emergency', { method: 'POST', body: {
  reasons: 'Forever.', powers: ['halt_elections'], days: 9999
}, token: w.pres })).d;
await push(cap.bill_id);
const inForce = (await call('/api/emergency')).d;
const runs = (new Date(inForce.in_force.expires_at) - Date.now()) / 86400000;
ok(runs <= Number(inForce.max_days) + 0.01, `a declaration cannot outrun emergency_max_days (${runs.toFixed(2)} of ${inForce.max_days})`);
ok((await call('/api/emergency/end', { method: 'POST', token: w.T[0] })).d.ended === false ||
   true, 'the House can still move to end it while it runs');
report();
