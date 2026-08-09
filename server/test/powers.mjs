import { call, ok, report, setup } from './world.mjs';
const w = await setup();
const citizen = w.plainTok;   // holds no office at all
console.log(`(plain citizen: ${w.plain.display_name}; President: ${w.presUser.display_name})`);
const pres = w.pres;                            // the President
const spk = w.spk;                              // the Speaker

console.log('\n-- can a non-admin call an election?');
for (const [who, tok] of [['an ordinary citizen', citizen], ['the President', pres], ['the Speaker', spk]]) {
  const r = await call('/api/elections', { method: 'POST', body: { kind: 'referendum', title: 'Mine' }, token: tok });
  ok(r.status === 403, `${who}: refused (${r.status})`);
}
const el = (await call('/api/elections', { method: 'POST', body: { kind: 'referendum', title: 'Admin one' }, token: w.admin.token })).d;
ok(!!el.id, 'the returning officer: allowed');

console.log('\n-- can a non-admin open or close a poll?');
for (const [who, tok] of [['an ordinary citizen', citizen], ['the President', pres]]) {
  const r = await call(`/api/elections/${el.id}/status`, { method: 'POST', body: { status: 'voting' }, token: tok });
  ok(r.status === 403, `${who}: refused`);
}

console.log('\n-- what the President can do that a citizen cannot');
const bill = (await call('/api/bills', { method: 'POST', body: { title: 'B', body: 'x' }, token: w.T[0] })).d;
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[2] });
ok((await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: pres })).status === 403, 'President cannot table a bill');
ok((await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: spk })).status === 200, 'only the Speaker tables');
await call(`/api/bills/${bill.id}/division`, { method: 'POST', token: spk });
ok((await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: pres })).status === 403,
   'President has no vote in a division (not an MP)');
for (const t of w.T) await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
ok((await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: pres })).status === 403, 'President cannot close a division');
await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: spk });
ok((await call(`/api/bills/${bill.id}/assent`, { method: 'POST', token: citizen })).status === 403, 'a citizen cannot grant assent');
ok((await call(`/api/bills/${bill.id}/assent`, { method: 'POST', token: pres })).d.status === 'enacted', 'the President assents — the one power the office has');

console.log('\n-- and the President has no other power at all');
ok((await call('/api/bills', { method: 'POST', body: { title: 'P', body: 'x' }, token: pres })).status === 403, 'cannot propose a bill — that belongs to the House alone');
ok((await call('/api/admin/config', { method: 'PUT', body: { seats: '9' }, token: pres })).status === 403, 'cannot change the rules');
ok((await call('/api/admin/pending', { token: pres })).status === 403, 'cannot approve accounts');
ok((await call('/api/admin/office', { method: 'POST', body: { user_id: 2, office: 'mp' }, token: pres })).status === 403, 'cannot appoint anyone');
report();
