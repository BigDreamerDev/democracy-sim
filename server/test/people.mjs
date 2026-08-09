import { call, ok, report, setup } from './world.mjs';
const w = await setup({ citizens: 8 });   // 9 citizens → two thirds is 6
const T = w.admin.token;
const all = w.users.map(u => u.token);

console.log('\n-- Article 2: two thirds of ALL citizens');
const d0 = (await call('/api/supermajority')).d;
ok(d0.needed === Math.ceil(d0.citizens * 0.667), `${d0.needed} of ${d0.citizens} carries`);

const pres = w.citizens.find(c => (c.offices||[]).includes('president'));
const m = (await call('/api/supermajority', { method:'POST', body:{
  kind:'remove_officer', target_user_id: pres.id, reasons:'Enough.' }, token: w.plainTok })).d;
ok(!!m.id, 'any citizen may open a motion — no officer is asked');

let carried = null;
for (const t of all) {
  const r = (await call(`/api/supermajority/${m.id}/sign`, { method:'POST', token:t })).d;
  if (r.carried) { carried = r; break; }
}
ok(!!carried, `carried at ${carried?.signatures} of ${carried?.citizens}`);
ok(!(await call('/api/citizens')).d.find(c=>c.id===pres.id).offices.length,
  'the President is removed from every office — Article 10.5');

console.log('\n-- Article 7.1: one seat each');
const mp = w.citizens.find(c => (c.offices||[]).includes('mp'));
const r = await call('/api/admin/office', { method:'POST', body:{ user_id: mp.id, office:'president' }, token:T });
ok(r.status === 400 && /7\.1/.test(r.d.error), 'a sitting MP cannot also be made President');

console.log('\n-- Article 7.4: resignation');
const mpTok = w.tok[mp.display_name];
ok((await call('/api/me/resign', { method:'POST', body:{ office:'president' }, token:mpTok })).status === 400,
  'you cannot resign an office you do not hold');
ok((await call('/api/me/resign', { method:'POST', body:{ office:'mp' }, token:mpTok })).d.ok,
  'but you may resign one you do, at any time and with no reason');
ok(!(await call('/api/citizens')).d.find(c=>c.id===mp.id).offices.includes('mp'), 'and the seat is vacant');
ok((await call('/api/admin/office', { method:'POST', body:{ user_id: mp.id, office:'president' }, token:T })).status === 200,
  'having resigned, they may take another office');
report();
