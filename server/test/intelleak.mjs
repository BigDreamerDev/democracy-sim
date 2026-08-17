/* A citizen leaking a sealed intelligence report early — a real, attributed,
   consequential act, not a free information dump. Properties asserted:

     - an uncleared citizen cannot leak ANY report, cleared or not;
     - a cleared citizen CAN leak a sealed report, and it becomes public
       immediately (the same effect early declassification has);
     - leaking report A does not touch report B: a leak is scoped to the one
       report leaked, not a side door into the whole sealed register;
     - the leak is attributed by name on a public, unauthenticated register —
       the opposite of an anonymous tip;
     - a report can only be leaked once, and leaking never moves money or
       touches the intelligence tier/committed-budget numbers, unlike an
       actual operation. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 8 });
const RO = w.admin.token;

console.log('\n-- charter the service and appoint a Director');

const power = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Estary Combine', adjective: 'Estarene' }, token: RO
})).d;
const powerId = power.id || power.power?.id;
await call(`/api/intel/powers/${powerId}/counter-intel`, { method: 'PUT', body: { counter_intel: 0 }, token: RO });

const establish = await call('/api/intel/establish', {
  method: 'POST',
  body: { charter: 'The Republic stands up an intelligence service for this test.', budget_per_cycle: 5000 },
  token: w.T[0]
});
const bill = establish.d;
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${bill.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: w.spk });
await call(`/api/bills/${bill.id}/assent`, { method: 'POST', token: w.pres });

// No Prime Minister in this parliament, so the President nominates.
const directorUser = w.mps[0];
const dirTok = w.T[0];
await call('/api/intel/director/nominate', { method: 'POST', body: { user_id: directorUser.id }, token: w.pres });
for (const t of w.T) await call('/api/intel/director/confirm', { method: 'POST', body: { support: true }, token: t });
const agency = await call('/api/intel/agency');
ok(Number(agency.d.director?.id) === Number(directorUser.id), `the Director is confirmed (${agency.d.director?.id})`);

console.log('\n-- generate two sealed reports');

const op1 = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'recruit_asset', power_id: powerId, budget: 100, codename: 'HERON' }, token: dirTok
});
const op2 = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'recruit_asset', power_id: powerId, budget: 100, codename: 'LARK' }, token: dirTok
});
ok(op1.status === 200 && op2.status === 200, `two operations file, each with a sealed report (${op1.status}, ${op2.status})`);
const report1 = op1.d.report.id;
const report2 = op2.d.report.id;
ok(report1 && report2 && report1 !== report2, 'two distinct reports exist to leak');

console.log('\n-- an uncleared citizen may not leak anything');

const uncleared = w.citizens.find(c => c.display_name === 'Citizen 3');
const unclearedTok = w.tok['Citizen 3'];
const refused1 = await call(`/api/intel/reports/${report1}/leak`, { method: 'POST', token: unclearedTok });
ok(refused1.status === 403, `an uncleared citizen cannot leak report 1 (${refused1.status})`);
const refused2 = await call(`/api/intel/reports/${report2}/leak`, { method: 'POST', token: unclearedTok });
ok(refused2.status === 403, `nor report 2 — clearance is required, there is no per-report free pass (${refused2.status})`);

console.log('\n-- clearance is a row, and it gates leaking exactly as it gates reading');

const leaker = w.citizens.find(c => c.display_name === 'Citizen 5');
const leakerTok = w.tok['Citizen 5'];
const grant = await call('/api/intel/clearance', { method: 'POST', body: { user_id: leaker.id, reason: 'independent verification' }, token: RO });
ok(grant.status === 200, 'the RO grants clearance as a published row');

const before = await call('/api/intel/agency');

const leaked = await call(`/api/intel/reports/${report1}/leak`, { method: 'POST', body: { budget: 999999 }, token: leakerTok });
ok(leaked.status === 200 && Number(leaked.d.report_id) === Number(report1), `a cleared citizen may leak the report (${leaked.status})`);

console.log('\n-- leaking report 1 does not touch report 2, money, or the tier numbers');

const dashboard = await call('/api/intel');
const seen1 = (dashboard.d.reports || []).find(r => Number(r.id) === Number(report1));
const seen2 = (dashboard.d.reports || []).find(r => Number(r.id) === Number(report2));
ok(seen1 && seen1.sealed === false && !!seen1.body, 'report 1 is now public, body included, with no auth at all');
ok(seen2 && seen2.sealed === true && seen2.body === null, `report 2 stays sealed — a leak is scoped to the one report leaked (${seen2 && seen2.sealed})`);

const after = await call('/api/intel/agency');
ok(
  Number(after.d.progress?.committed_budget) === Number(before.d.progress?.committed_budget) &&
  Number(after.d.progress?.tradecraft) === Number(before.d.progress?.tradecraft),
  'leaking moved no money and earned no tradecraft — the budget field in the request was ignored, unlike an actual operation'
);

const again = await call(`/api/intel/reports/${report1}/leak`, { method: 'POST', token: leakerTok });
ok(again.status === 409, `a report already public cannot be leaked a second time (${again.status})`);

console.log('\n-- the leak is attributed, publicly, permanently — no auth required to see it');

const register = await call('/api/intel/leaks');
ok(register.status === 200, 'the leak register answers with no token');
const row = (register.d || []).find(l => Number(l.report_id) === Number(report1));
ok(!!row && row.display_name === 'Citizen 5', `the leak names who did it (${row?.display_name})`);
const missing2 = (register.d || []).find(l => Number(l.report_id) === Number(report2));
ok(!missing2, 'report 2, never leaked, has no row on the register');

report();
