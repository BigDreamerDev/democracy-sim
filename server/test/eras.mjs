/* Eras are a label on history, named deliberately by the Returning Officer —
   never inferred from a constitutional bill automatically. */
import { call, ok, report, setup } from './world.mjs';
const w = await setup();

console.log('\n-- reading needs no auth');
ok((await call('/api/eras')).status === 200, 'anyone can list eras');
ok((await call('/api/eras')).d.length === 0, 'none exist yet — nothing names itself');

console.log('\n-- only the RO may name one');
ok((await call('/api/eras', { method: 'POST', body: { name: 'The First Republic' }, token: w.plainTok })).status === 403,
  'an ordinary citizen cannot');
ok((await call('/api/eras', { method: 'POST', body: { name: 'The First Republic' }, token: w.pres })).status === 403,
  'nor the President — holding an office is not being the RO');
ok((await call('/api/eras', { method: 'POST', body: { starts_cycle: 1 }, token: w.admin.token })).status === 400,
  'a name is required');

const e1 = (await call('/api/eras', {
  method: 'POST', body: { name: 'The First Republic', starts_cycle: 1, description: 'Founding to the first amendment.' },
  token: w.admin.token
})).d;
ok(e1.name === 'The First Republic' && e1.starts_cycle === 1, 'the RO can name an era');
ok(e1.created_by === w.admin.user.id, 'it records who named it');

console.log('\n-- it shows up in the list, and a second era can be added');
const e2 = (await call('/api/eras', {
  method: 'POST', body: { name: 'The Second Republic', starts_cycle: 14 }, token: w.admin.token
})).d;
const list = (await call('/api/eras')).d;
ok(list.length === 2, 'both eras are listed');
ok(list[0].starts_cycle === 14, 'newest-starting era first');
ok(list.some(e => e.id === e1.id) && list.some(e => e.id === e2.id), 'nothing was deleted or overwritten');
report();
