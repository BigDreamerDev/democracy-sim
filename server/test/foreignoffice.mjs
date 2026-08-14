/* The Foreign Minister, and the framework the intelligence service will sit on.

   The Foreign Minister is the Treasurer's shape applied to the channel abroad:
   the government's to appoint, the government's to dismiss, and holding no
   power to bind anybody. What is asserted here is mostly what the office
   *cannot* do — a minister who could commit the Republic by sending a message
   would have taken the House's power by the back door.

   The intelligence assertions are about the one exception the Republic makes to
   its own public record, and how narrow it is: the body of a report is sealed,
   for a fixed number of cycles, and nothing else about it ever is. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 9 });
const T = w.admin.token;
const office = () => call('/api/diplomacy/foreign-office').then(r => r.d);

await call('/api/admin/config', { method: 'PUT', body: { diplomacy_enabled: 'true' }, token: T });
const power = (await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Valtia', adjective: 'Valtish' }, token: T })).d;
const pid = power.id || power.power?.id;

const free = w.citizens.filter(c => !(c.offices || []).length && c.display_name !== 'Uzair');
const [minister, other] = free;
const mTok = w.tok[minister.display_name];

const send = (token, body = {}) =>
  call('/api/diplomacy/dispatches', {
    method: 'POST',
    body: { power_id: pid, subject: 'A note', body: 'The Republic sends its compliments.', ...body },
    token
  });

console.log('-- before there is a minister');

ok((await office()).minister === null, 'the office starts empty');
ok((await send(w.pres)).status === 200, 'the President holds the channel while it is');
ok((await send(w.plainTok)).status === 403, 'and an ordinary citizen never does');

console.log('\n-- appointing');

ok((await call('/api/diplomacy/foreign-office/appoint', { method: 'POST', body: { user_id: minister.id }, token: T })).status === 403,
  'the Returning Officer does not appoint a Foreign Minister');
ok((await call('/api/diplomacy/foreign-office/appoint', { method: 'POST', body: { user_id: minister.id }, token: w.spk })).status === 403,
  'nor does the Speaker');
ok((await call('/api/admin/office', { method: 'POST', body: { user_id: minister.id, office: 'foreign_minister' }, token: T })).status === 403,
  'and there is no administrative back door either');
ok((await call('/api/diplomacy/foreign-office/appoint', { method: 'POST', body: { user_id: minister.id }, token: w.pres })).status === 200,
  'the President appoints where there is no Prime Minister');
ok((await office()).minister?.display_name === minister.display_name, 'and the office is filled');

ok((await call('/api/diplomacy/foreign-office/appoint', { method: 'POST', body: { user_id: w.mps[1].id }, token: w.pres })).status === 400,
  'Article 7.1: a sitting MP cannot also take the Foreign Office');

console.log('\n-- the channel moves with the office');

ok((await send(mTok)).status === 200, 'the Foreign Minister speaks for the Republic');
const refused = await send(w.pres);
ok(refused.status === 403, 'and the President stops doing so');
ok(/assents/.test(refused.d.error || ''), 'because assenting to a treaty and negotiating it are the same person twice');

console.log('\n-- the office binds nobody');

const before = (await call('/api/bills')).d.length;
await send(mTok, { message_kind: 'treaty_proposal', subject: 'A treaty', body: 'We propose an alliance.' });
ok((await call('/api/bills')).d.length === before, 'proposing a treaty abroad enacts nothing at home');
ok((await call('/api/diplomacy/treaties')).d.length === 0, 'and creates no treaty by itself');
ok((await call('/api/diplomacy/powers')).d.find(p => p.id === pid).recognised === false,
  'a minister cannot recognise a state by talking to it');

console.log('\n-- dismissal');

ok((await call('/api/diplomacy/foreign-office/dismiss', { method: 'POST', token: w.spk })).status === 403,
  'the Speaker cannot dismiss the minister');
ok((await call('/api/diplomacy/foreign-office/dismiss', { method: 'POST', token: mTok })).status === 200,
  'but the minister may resign');
ok((await office()).minister === null, 'and the office empties');
ok((await send(w.pres)).status === 200, 'the President picks the channel back up');

/* ------------------------------------------------------- intelligence */

console.log('\n-- the intelligence service does not exist yet');

const intel = (await call('/api/intel')).d;
ok(intel.service === null, 'no service until the House creates one');
ok(intel.reports.length === 0, 'and no reports');
ok((await call('/api/intel/reports/1/read', { method: 'POST', token: w.pres })).status === 400,
  'nothing to read, and the refusal says why');

console.log('\n-- the register is public even when the files are not');

ok(Array.isArray(intel.reads), 'who read what is a public list');
ok(Array.isArray(intel.clearances), 'and so is who holds clearance');
ok(intel.cleared === false, 'holding an office is not clearance');

report();
