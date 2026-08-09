/* The House alone makes law, the President's assent is final, the people can
   strike a law down at 70%, and the House can impeach. */
import { call, ok, report, setup } from './world.mjs';
const w = await setup();
const plain = w.plainTok;

console.log('\n-- only the House may propose or second');
ok((await call('/api/bills', { method: 'POST', body: { title: 'Mine', body: 'x' }, token: plain })).status === 403,
  'an ordinary citizen cannot propose a bill');
ok((await call('/api/bills', { method: 'POST', body: { title: 'Mine', body: 'x' }, token: w.pres })).status === 403,
  'nor can the President');
const bill = (await call('/api/bills', { method: 'POST', body: { title: 'Tea Act', body: 'Tea at four.' }, token: w.T[0] })).d;
ok(!!bill.ref, 'an MP can');
ok((await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: plain })).status === 403,
  'an ordinary citizen cannot second');
ok((await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[1] })).status === 200, 'an MP can second');
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[2] });

console.log('\n-- and the House can hand that power to everyone');
await call('/api/admin/config', { method: 'PUT', body: { bill_proposers: 'citizens' }, token: w.admin.token });
ok((await call('/api/bills', { method: 'POST', body: { title: 'Now mine', body: 'x' }, token: plain })).d.ref !== undefined,
  'with bill_proposers = citizens, anyone may propose');
await call('/api/admin/config', { method: 'PUT', body: { bill_proposers: 'mps' }, token: w.admin.token });

console.log('\n-- the President has the last word');
await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${bill.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: w.spk });
await call(`/api/bills/${bill.id}/assent`, { method: 'POST', body: { veto: true }, token: w.pres });
const ov = await call(`/api/bills/${bill.id}/override`, { method: 'POST', token: w.spk });
ok(ov.status === 403, 'a unanimous House cannot override a veto');
await call('/api/admin/config', { method: 'PUT', body: { allow_veto_override: 'true' }, token: w.admin.token });
ok((await call(`/api/bills/${bill.id}/override`, { method: 'POST', token: w.spk })).d.status === 'enacted',
  'unless the House first changes the rule — then it can');
const law = (await call('/api/laws')).d.find(l => l.title === 'Tea Act');
ok(!!law, 'the law is on the books');

console.log('\n-- the people can strike it down');
const p1 = (await call(`/api/laws/${law.id}/petition`, { method: 'POST', token: plain })).d;
ok(p1.signed === 1 && p1.needed === Math.ceil(0.334 * 8) && !p1.opened, `one signature of ${p1.needed} — no referendum yet`);
let ref = null;
for (const u of w.users) {
  const r = (await call(`/api/laws/${law.id}/petition`, { method: 'POST', token: u.token })).d;
  if (r.opened) { ref = r.election_id; break; }
}
ok(!!ref, 'enough signatures opened the referendum on its own');

const all = [...w.users.map(u => u.token)];
ok((await call(`/api/elections/${ref}/referendum`, { method: 'POST', body: { choice: 'reject' }, token: all[0] })).status === 200, 'a citizen votes');
ok((await call(`/api/elections/${ref}/referendum`, { method: 'POST', body: { choice: 'keep' }, token: all[0] })).status === 409, 'and only once');

// 2 of 8 want it gone: 25%, nowhere near 70%
await call(`/api/elections/${ref}/referendum`, { method: 'POST', body: { choice: 'reject' }, token: all[1] });
for (const t of all.slice(2)) await call(`/api/elections/${ref}/referendum`, { method: 'POST', body: { choice: 'keep' }, token: t });
const r1 = (await call(`/api/elections/${ref}/status`, { method: 'POST', body: { status: 'closed' }, token: w.admin.token })).d;
ok(r1.struck === false && r1.reason === 'threshold', `25% to reject is not enough (needed ${Math.round(r1.need*100)}%)`);
ok((await call('/api/laws')).d.some(l => l.id === law.id), 'the law survives');

// now do it properly
const ref2 = (await call('/api/elections', { method: 'POST', body: { kind: 'referendum', target_law_id: law.id }, token: w.admin.token })).d;
for (const t of all) await call(`/api/elections/${ref2.id}/referendum`, { method: 'POST', body: { choice: 'reject' }, token: t });
const r2 = (await call(`/api/elections/${ref2.id}/status`, { method: 'POST', body: { status: 'closed' }, token: w.admin.token })).d;
ok(r2.struck === true, `${Math.round(r2.share*100)}% to reject strikes the law down`);
ok(!(await call('/api/laws')).d.some(l => l.id === law.id), 'the law is gone from the active statute book');
ok((await call('/api/laws?all=1')).d.some(l => l.id === law.id), 'but still readable in the archive');

console.log('\n-- impeachment');
const target = w.citizens.find(c => (c.offices || []).includes('president'));
const imp = (await call('/api/bills', { method: 'POST', body: {
  title: 'That the President be removed', kind: 'impeachment', body: 'For vetoing tea.', target_user_id: target.id
}, token: w.T[0] })).d;
ok(!!imp.ref, 'the House may move an impeachment');
ok((await call('/api/bills', { method: 'POST', body: { title: 'Bad', kind: 'impeachment', body: 'x' }, token: w.T[0] })).status === 400,
  'an impeachment must name someone');
await call(`/api/bills/${imp.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${imp.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${imp.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${imp.id}/division`, { method: 'POST', token: w.spk });
// 3 of 5 is a majority but short of two thirds
for (let i = 0; i < 5; i++) await call(`/api/bills/${imp.id}/vote`, { method: 'POST', body: { vote: i < 3 ? 'aye' : 'no' }, token: w.T[i] });
const c1 = (await call(`/api/bills/${imp.id}/close`, { method: 'POST', token: w.spk })).d;
ok(c1.carried === false, 'a simple majority does not remove an officer');
ok((await call('/api/citizens')).d.find(c => c.id === target.id).offices.includes('president'), 'the President keeps the office');

const imp2 = (await call('/api/bills', { method: 'POST', body: {
  title: 'That the President be removed, again', kind: 'impeachment', body: 'Still.', target_user_id: target.id
}, token: w.T[0] })).d;
await call(`/api/bills/${imp2.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${imp2.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${imp2.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${imp2.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${imp2.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
const c2 = (await call(`/api/bills/${imp2.id}/close`, { method: 'POST', token: w.spk })).d;
ok(c2.carried === true && c2.impeached === target.display_name, 'two thirds removes them');
ok(!(await call('/api/citizens')).d.find(c => c.id === target.id).offices.length, 'the office is vacant immediately');
ok((await call(`/api/bills/${imp2.id}`)).d.status === 'enacted', 'it never went to the President for assent');
ok((await call('/api/audit')).d.some(a => a.action === 'bill.impeach'), 'the removal is in the public record');
report();
