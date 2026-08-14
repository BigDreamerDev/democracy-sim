/* Article 17 — the Prime Minister.
   The President appoints, the House confirms, the House alone removes. */
import { call, ok, report, setup } from './world.mjs';
const w = await setup({ citizens: 10 });
const spare = w.citizens.filter(c => !(c.offices || []).length);

console.log('\n-- appointment');
ok((await call('/api/prime-minister', { method: 'POST', body: { user_id: spare[0].id }, token: w.T[0] })).status === 403,
  'an MP cannot appoint a Prime Minister');
ok(!!(await call('/api/prime-minister', { method: 'POST', body: { user_id: spare[0].id }, token: w.pres })).d.id,
  'the President appoints');
ok((await call('/api/prime-minister/confirm', { method: 'POST', token: w.plainTok })).status === 403,
  'a citizen outside the House cannot confirm');
let done = null;
for (const t of w.T) { const r = (await call('/api/prime-minister/confirm', { method: 'POST', token: t })).d; if (r.confirmed) { done = r; break; } }
ok(!!done, `confirmed by a majority of the House (${done?.votes} of ${done?.needed})`);
const pmTok = w.tok[spare[0].display_name];

console.log('\n-- assent moves to the Prime Minister');
const mk = async (title, body, kind) => {
  const b = (await call('/api/bills', { method: 'POST', body: { title, body, kind }, token: w.T[0] })).d;
  await call(`/api/bills/${b.id}/second`, { method: 'POST', token: w.T[1] });
  await call(`/api/bills/${b.id}/second`, { method: 'POST', token: w.T[2] });
  await call(`/api/bills/${b.id}/table`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${b.id}/division`, { method: 'POST', token: w.spk });
  for (const t of w.T) await call(`/api/bills/${b.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
  await call(`/api/bills/${b.id}/close`, { method: 'POST', token: w.spk });
  return b;
};
const ord = await mk('Ordinary Act', 'Let it be so.', 'law');
ok((await call(`/api/bills/${ord.id}/assent`, { method: 'POST', token: w.pres })).status === 403,
  'the President may no longer assent to an ordinary bill');
ok((await call(`/api/bills/${ord.id}/assent`, { method: 'POST', token: pmTok })).d.status === 'enacted',
  'the Prime Minister does');

console.log('\n-- but the President keeps the constitutional and electoral ones');
const elec = await mk('Change the seats', 'seats = 7', 'rule');
ok((await call(`/api/bills/${elec.id}/assent`, { method: 'POST', token: pmTok })).status === 403,
  'the Prime Minister may not assent to a bill changing the electoral system');
ok((await call(`/api/bills/${elec.id}/assent`, { method: 'POST', token: w.pres })).d.status === 'enacted',
  'the President does');

console.log('\n-- the House alone removes');
ok((await call('/api/prime-minister/no-confidence', { method: 'POST', token: w.plainTok })).status === 403,
  'a citizen outside the House cannot withdraw confidence');
let fell = null;
for (const t of w.T) { const r = (await call('/api/prime-minister/no-confidence', { method: 'POST', token: t })).d; if (r.fallen) { fell = r; break; } }
ok(!!fell, `a majority of the House brings the government down (${fell?.votes} of ${fell?.needed})`);
ok((await call('/api/prime-minister')).d.prime_minister === null, 'and the office is vacant');
ok(!(await call('/api/citizens')).d.find(c => c.id === spare[0].id).offices.includes('prime_minister'),
  'they no longer hold it');

console.log('\n-- with no Prime Minister the President assents again');
const ord2 = await mk('Second Act', 'And so.', 'law');
ok((await call(`/api/bills/${ord2.id}/assent`, { method: 'POST', token: w.pres })).d.status === 'enacted',
  'the Republic does not stop legislating for want of an appointment');

console.log('\n-- the Speaker breaks a tie');
const tie = (await call('/api/bills', { method: 'POST', body: { title: 'Tied', body: 'x' }, token: w.T[0] })).d;
await call(`/api/bills/${tie.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${tie.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${tie.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${tie.id}/division`, { method: 'POST', token: w.spk });
for (let i = 0; i < 4; i++) await call(`/api/bills/${tie.id}/vote`, { method: 'POST', body: { vote: i < 2 ? 'aye' : 'no' }, token: w.T[i] });
ok((await call(`/api/bills/${tie.id}/close`, { method: 'POST', token: w.spk })).d.tied === true,
  'a 2-2 division is tied rather than silently lost');
ok((await call(`/api/bills/${tie.id}/casting-vote`, { method: 'POST', body: { vote: 'aye' }, token: w.T[1] })).status === 403,
  'only the Speaker has the casting vote');
ok((await call(`/api/bills/${tie.id}/casting-vote`, { method: 'POST', body: { vote: 'aye' }, token: w.spk })).d.carried === true,
  'and carries it');
report();
