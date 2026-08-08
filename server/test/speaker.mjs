/* Article 4: threshold, deadlock, and the bar falling one vote per failed ballot. */
import { call, ok, report, setup, passBill, PW } from './world.mjs';
const w = await setup();
const admin = w.admin;
const citizens = w.citizens;
const mps = w.mps;
const T = w.T;
const tok = w.tok;

for (const m of mps) await call('/api/admin/office', { method: 'POST', body: { user_id: m.id, office: 'speaker', remove: true }, token: admin.token });

// A House deliberately split 3-2 every time. Under a plurality it elects on ballot 1.
async function ballot(n) {
  const e = (await call('/api/elections', { method: 'POST', body: { kind: 'speaker', title: 'Chair ballot ' + n }, token: admin.token })).d;
  await call(`/api/elections/${e.id}/stand`, { method: 'POST', body: { statement: 'a' }, token: T[0] });
  await call(`/api/elections/${e.id}/stand`, { method: 'POST', body: { statement: 'b' }, token: T[1] });
  await call(`/api/elections/${e.id}/status`, { method: 'POST', body: { status: 'voting' }, token: admin.token });
  const c = (await call(`/api/elections/${e.id}`, { token: admin.token })).d.candidates;
  for (let i = 0; i < T.length; i++)
    await call(`/api/elections/${e.id}/vote`, { method: 'POST', body: { candidacy_id: c[i < 3 ? 0 : 1].id }, token: T[i] });
  return (await call(`/api/elections/${e.id}/status`, { method: 'POST', body: { status: 'closed' }, token: admin.token })).d;
}

console.log(`\n-- House of ${mps.length}, split 3-2 on every ballot`);
const r1 = await ballot(1);
ok(r1.failed && r1.needed === 4, `ballot 1 needs 4 of 5 — a 3-2 winner is refused`);
ok(r1.next_needed === 3, 'the House is told the next ballot needs 3');
const r2 = await ballot(2);
ok(!r2.failed && r2.seated.length === 1, 'ballot 2 seats the same 3-2 winner: the bar fell to a simple majority');
ok(r2.seated[0].votes === 3, 'seated on 3 votes');

console.log('\n-- the bar resets once a chair has been filled');
const seated = (await call('/api/state')).d.offices.find(o => o.office === 'speaker');
ok(!!seated, 'a Speaker now holds the chair');
await call('/api/admin/office', { method: 'POST', body: { user_id: seated.user_id, office: 'speaker', remove: true }, token: admin.token });

// Drop the bar by five votes a ballot: far past a simple majority, to prove the floor.
await call('/api/admin/config', { method: 'PUT', body: { speaker_relax: '5' }, token: admin.token });
const r3 = await ballot(3);
ok(r3.failed && r3.needed === 4, 'a fresh vacancy is back to 4 of 5 — past failures do not carry over');
ok(r3.next_needed === 3, 'even dropping five votes a ballot, the bar stops at a simple majority');
const r4 = await ballot(4);
ok(!r4.failed && r4.seated[0].votes === 3, 'the next ballot carries at exactly the floor, never below');
await call('/api/admin/config', { method: 'PUT', body: { speaker_relax: '1' }, token: admin.token });

console.log('\n-- the House may change its own rule');
ok((await call('/api/bills', { method: 'POST', body: { title: 'Plain majority for the chair', kind: 'rule', body: 'speaker_threshold = 0.5\nspeaker_relax = 0' }, token: T[0] })).d.ref !== undefined,
  'a rule bill may rewrite the Speaker threshold');
report();
