/* Citizens' initiatives: signatures either force the House to take a bill up,
   or put it straight to the Republic — depending on what the House has chosen. */
import { call, ok, report, setup } from './world.mjs';
const w = await setup();
const plain = w.plainTok;
const cfg = (body) => call('/api/admin/config', { method: 'PUT', body, token: w.admin.token });
const draft = (title, extra = {}) =>
  call('/api/initiatives', { method: 'POST', body: { title, body: 'Let it be so.', ...extra }, token: plain });

console.log('\n-- mode: table (the default)');
const b1 = (await draft('Citizens Tea Act')).d;
ok(b1.status === 'petition' && b1.origin === 'initiative', 'a citizen who cannot propose a bill can still start an initiative');
ok((await call(`/api/bills/${b1.id}/table`, { method: 'POST', token: w.spk })).status === 400,
  'the Speaker cannot table it before the people have signed');

const s1 = (await call(`/api/bills/${b1.id}/sign`, { method: 'POST', token: plain })).d;
ok(s1.signed === 1 && s1.needed === 3, `one signature of ${s1.needed}`);
ok((await call(`/api/bills/${b1.id}/sign`, { method: 'POST', token: plain })).d.signed === 1, 'signing twice counts once');

let tabled = false;
for (const u of w.users) {
  const r = (await call(`/api/bills/${b1.id}/sign`, { method: 'POST', token: u.token })).d;
  if (r.tabled) { tabled = true; break; }
}
ok(tabled, 'enough signatures put it before the House on its own');
ok((await call(`/api/bills/${b1.id}`)).d.status === 'tabled', 'it is tabled without any seconders');

// the House still decides, and the President still assents
await call(`/api/bills/${b1.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${b1.id}/vote`, { method: 'POST', body: { vote: 'no' }, token: t });
const lost = (await call(`/api/bills/${b1.id}/close`, { method: 'POST', token: w.spk })).d;
ok(lost.carried === false, 'the House can still throw it out — signatures buy a hearing, not a law');

console.log('\n-- mode: enact');
await cfg({ initiative_mode: 'enact' });
const b2 = (await draft('Citizens Coffee Act')).d;
let ref = null;
for (const u of [...w.users]) {
  const r = (await call(`/api/bills/${b2.id}/sign`, { method: 'POST', token: u.token })).d;
  if (r.election_id) { ref = r.election_id; break; }
}
ok(!!ref, 'signatures open a referendum instead of tabling it');
ok((await call(`/api/bills/${b2.id}`)).d.status === 'referendum', 'the bill is with the people, not the House');

const view = (await call(`/api/elections/${ref}`, { token: plain })).d;
ok(view.initiative === true && view.bill.ref === b2.ref, 'the referendum is bound to the proposal');
ok((await call(`/api/elections/${ref}/referendum`, { method: 'POST', body: { choice: 'keep' }, token: plain })).status === 400,
  'the wording is enact or reject, not keep');
for (const u of w.users) await call(`/api/elections/${ref}/referendum`, { method: 'POST', body: { choice: 'enact' }, token: u.token });
const res = (await call(`/api/elections/${ref}/status`, { method: 'POST', body: { status: 'closed' }, token: w.admin.token })).d;
ok(res.enacted === true, `${Math.round(res.share * 100)}% for — it becomes law directly`);
ok((await call('/api/laws')).d.some(l => l.title === 'Citizens Coffee Act'), 'the law is in the statute book');
ok((await call('/api/audit')).d.some(a => a.action === 'initiative.enacted'), 'and in the public record');

console.log('\n-- a proposal the Republic does not want');
const b3 = (await draft('Citizens Gruel Act')).d;
let ref3 = null;
for (const u of w.users) {
  const r = (await call(`/api/bills/${b3.id}/sign`, { method: 'POST', token: u.token })).d;
  if (r.election_id) { ref3 = r.election_id; break; }
}
for (let i = 0; i < w.users.length; i++)
  await call(`/api/elections/${ref3}/referendum`, { method: 'POST', body: { choice: i < 4 ? 'enact' : 'reject' }, token: w.users[i].token });
const r3 = (await call(`/api/elections/${ref3}/status`, { method: 'POST', body: { status: 'closed' }, token: w.admin.token })).d;
ok(r3.enacted === false && r3.reason === 'threshold', `50% for is not the ${Math.round(r3.need * 100)}% needed`);
ok(!(await call('/api/laws')).d.some(l => l.title === 'Citizens Gruel Act'), 'it does not become law');

console.log('\n-- mode: off');
await cfg({ initiative_mode: 'off' });
ok((await draft('Nope')).status === 403, 'with initiative_mode = off, citizens cannot start one at all');
await cfg({ initiative_mode: 'table' });
ok((await draft('Back on')).d.ref !== undefined, 'and the House can switch it back on');
report();
