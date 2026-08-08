/* The Speaker threshold, and bills that rewrite the rules of the game. */
import { call, ok, report, setup, passBill, PW } from './world.mjs';
const w = await setup();
const admin = w.admin;
const citizens = w.citizens;
const mps = w.mps;
const T = w.T;
const tok = w.tok;

console.log(`\n-- speaker threshold (House of ${mps.length})`);

await call('/api/admin/office', { method: 'POST', body: { user_id: mps[0].id, office: 'speaker', remove: true }, token: admin.token });
const sp = (await call('/api/elections', { method: 'POST', body: { kind: 'speaker', title: 'Speaker retest' }, token: admin.token })).d;
await call(`/api/elections/${sp.id}/stand`, { method: 'POST', body: { statement: 'a' }, token: T[0] });
await call(`/api/elections/${sp.id}/stand`, { method: 'POST', body: { statement: 'b' }, token: T[1] });
await call(`/api/elections/${sp.id}/status`, { method: 'POST', body: { status: 'voting' }, token: admin.token });
const cands = (await call(`/api/elections/${sp.id}`, { token: admin.token })).d.candidates;
// 3-2 split: a plurality, but short of two thirds
for (let i = 0; i < T.length; i++)
  await call(`/api/elections/${sp.id}/vote`, { method: 'POST', body: { candidacy_id: cands[i < 3 ? 0 : 1].id }, token: T[i] });
const res = (await call(`/api/elections/${sp.id}/status`, { method: 'POST', body: { status: 'closed' }, token: admin.token })).d;
ok(res.house === mps.length, `threshold measured against the House (${res.house}), not the whole electorate`);
ok(res.needed === Math.ceil(0.667 * mps.length), `needs ${res.needed} of ${res.house}`);
ok(res.failed === true && res.seated.length === 0, 'a 3-2 winner is refused the chair — no Speaker seated');

console.log('\n-- rule bills');
const bad = await call('/api/bills', { method: 'POST', body: { title: 'Open the doors', kind: 'rule', body: 'require_approval = false' }, token: T[0] });
ok(bad.status === 400, 'a bill cannot switch off account approval');
const bad2 = await call('/api/bills', { method: 'POST', body: { title: 'Nonsense', kind: 'rule', body: 'wibble = 3' }, token: T[0] });
ok(bad2.status === 400, 'a bill naming a setting that does not exist is refused at proposal');

const rb = (await call('/api/bills', { method: 'POST', body: { title: 'Shorten the cycle', kind: 'rule', body: 'cycle_days = 5\ncampaign_days = 1' }, token: T[0] })).d;
ok(!!rb.ref, 'valid rule bill accepted');
await call(`/api/bills/${rb.id}/second`, { method: 'POST', token: T[1] });
await call(`/api/bills/${rb.id}/second`, { method: 'POST', token: T[2] });
await call('/api/admin/office', { method: 'POST', body: { user_id: mps[0].id, office: 'speaker' }, token: admin.token });
await call(`/api/bills/${rb.id}/table`, { method: 'POST', token: T[0] });
await call(`/api/bills/${rb.id}/division`, { method: 'POST', token: T[0] });
for (const t of T) await call(`/api/bills/${rb.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${rb.id}/close`, { method: 'POST', token: T[0] });
await call(`/api/bills/${rb.id}/assent`, { method: 'POST', token: w.pres });
const cfg = (await call('/api/state')).d.config;
ok(cfg.cycle_days === '5' && cfg.campaign_days === '1', 'the enacted rule bill changed the live settings');
const rec = (await call('/api/audit')).d;
ok(rec.some(r => r.action === 'rule.change'), 'the rule change is in the public record');
ok((await call('/api/laws')).d.every(l => l.bill_id !== rb.id), 'a rule bill does not clutter the statute book');
report();
