/* Collection and operations, on top of the intel_service framework.

   Three things worth proving, and nothing else — the rest is arithmetic:

     - the progression gate actually blocks a tier the agency has not earned,
       both immediately after the charter and again right at the tier-2/3
       boundary, not just "the field exists";
     - a mid-tier operation and the top-tier one both go through the same
       allowlist and audit discipline: a kind outside OPS is refused before it
       touches anything, and a kind inside it always produces an intel_operations
       row plus a sealed report, win or lose;
     - a forced failure still writes that record. "Blown" is not "nothing
       happened". */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 10 });
const T = w.admin.token;

console.log('\n-- charter the service');

const power = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Kestria', adjective: 'Kestrian' }, token: T
})).d;
const powerId = power.id || power.power?.id;

const setCI = v => call(`/api/intel/powers/${powerId}/counter-intel`, { method: 'PUT', body: { counter_intel: v }, token: T });

const establish = await call('/api/intel/establish', {
  method: 'POST',
  body: { charter: 'The Republic stands up an intelligence service to collect abroad and account for it at home.', budget_per_cycle: 5000 },
  token: w.T[0]
});
ok(establish.status === 200, `charter bill proposes (${establish.status})`);
const bill = establish.d;

await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${bill.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${bill.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${bill.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${bill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${bill.id}/close`, { method: 'POST', token: w.spk });
await call(`/api/bills/${bill.id}/assent`, { method: 'POST', token: w.pres });

const agency0 = await call('/api/intel/agency');
ok(agency0.d.service && agency0.d.service.established_bill_id === bill.id, 'the service exists once its charter is enacted');
ok(agency0.d.progress.tier === 1, `a fresh service starts at tier 1 (${agency0.d.progress.tier})`);

const director = w.mps[0];
const dirTok = w.T[0];
const clear = await call('/api/intel/clearance', { method: 'POST', body: { user_id: director.id, reason: 'runs the desk' }, token: T });
ok(clear.status === 200, `the RO can grant clearance as a published setting (${clear.status})`);

await setCI(0);

console.log('\n-- the allowlist');

const badKind = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'assassinate_for_free', power_id: powerId, budget: 1000 }, token: dirTok
});
ok(badKind.status === 400, `a kind outside OPS is refused before it touches anything (${badKind.status})`);

const uncleared = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'recruit_asset', power_id: powerId, budget: 100 }, token: w.plainTok
});
ok(uncleared.status === 403, `an uncleared citizen cannot order an operation even a valid one (${uncleared.status})`);

console.log('\n-- the gate blocks what has not been earned');

const earlyTier2 = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'disinformation', power_id: powerId, budget: 1000 }, token: dirTok
});
ok(earlyTier2.status === 403, `tier 2 is refused at tier 1, immediately after the charter (${earlyTier2.status})`);

const earlyTier3 = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'back_coup', power_id: powerId, budget: 1000 }, token: dirTok
});
ok(earlyTier3.status === 403, `tier 3 is refused at tier 1 too (${earlyTier3.status})`);

console.log('\n-- earning tier 2: tradecraft and committed budget both have to clear, not just tradecraft');

let firstAssetId = null;
for (let i = 0; i < 6; i++) {
  const r = await call('/api/intel/operations', {
    method: 'POST', body: { kind: 'recruit_asset', power_id: powerId, budget: 100, codename: `SPARROW-${i}` }, token: dirTok
  });
  if (i === 0) firstAssetId = r.d.operation.asset_id;
}
const stillTier1 = await call('/api/intel/agency');
ok(stillTier1.d.progress.tier === 1, `tradecraft up but committed_budget still short of the tier-2 gate holds it at tier 1 (${stillTier1.d.progress.tradecraft}, ${stillTier1.d.progress.committed_budget})`);

const stillBlocked = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'disinformation', power_id: powerId, budget: 1000 }, token: dirTok
});
ok(stillBlocked.status === 403, `and the operation is still refused while it is short (${stillBlocked.status})`);

await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'counter_sweep', budget: 25000 }, token: dirTok
});

const nowTier2 = await call('/api/intel/agency');
ok(nowTier2.d.progress.tier === 2, `both numbers cleared opens tier 2 (tradecraft ${nowTier2.d.progress.tradecraft}, budget ${nowTier2.d.progress.committed_budget})`);

console.log('\n-- a mid-tier operation: allowlist and audit discipline');

const disinfo = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'disinformation', power_id: powerId, budget: 13000 }, token: dirTok
});
ok(disinfo.status === 200, `a tier-2 operation now goes through (${disinfo.status})`);
ok(disinfo.d.operation.outcome === 'success', 'against a target with counter_intel 0 it succeeds');
ok(disinfo.d.report && disinfo.d.report.sealed === true, 'and files a sealed report, not a plain one');

const opsPublic = await call('/api/intel/operations');
const found = opsPublic.d.find(o => o.id === disinfo.d.operation.id);
ok(!!found, 'the operation is on the public register even though its report is sealed');
ok(found.outcome === 'success' && Number(found.budget) === 13000, 'and the register shows what it cost and what came of it');

for (let i = 0; i < 11; i++) {
  await call('/api/intel/operations', {
    method: 'POST', body: { kind: 'disinformation', power_id: powerId, budget: 13000 }, token: dirTok
  });
}

console.log('\n-- earning tier 3: a coup needs the numbers AND an asset already in place');

const nowTier3 = await call('/api/intel/agency');
ok(nowTier3.d.progress.tier === 3, `tradecraft, committed budget and completed tier-2 missions all cleared (tier ${nowTier3.d.progress.tier})`);

const coup = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'back_coup', power_id: powerId, asset_id: firstAssetId, budget: 5000 }, token: dirTok
});
ok(coup.status === 200, `tier 3 now goes through with an asset named (${coup.status})`);
ok(coup.d.operation.outcome === 'success', 'and succeeds deterministically against counter_intel 0');

const powerAfter = await call('/api/diplomacy/powers');
const kestria = (Array.isArray(powerAfter.d) ? powerAfter.d : []).find(p => p.id === powerId);
ok(kestria && kestria.standing === 'hostile', `blowback is public and immediate, not a coin flip on attribution (${kestria?.standing})`);

const noAssetCoup = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'removal', power_id: powerId, asset_id: 999999, budget: 5000 }, token: dirTok
});
ok(noAssetCoup.status === 409, `removal still refuses without a real asset in place, even at tier 3 (${noAssetCoup.status})`);

console.log('\n-- a forced failure still writes the record');

await setCI(999999);
const forcedFail = await call('/api/intel/operations', {
  method: 'POST', body: { kind: 'recruit_asset', power_id: powerId, budget: 100, codename: 'DOOMED' }, token: dirTok
});
ok(forcedFail.status === 200, `a mission that will not succeed still returns cleanly, not an error (${forcedFail.status})`);
ok(forcedFail.d.operation.outcome !== 'success', `and is recorded as anything but a success (${forcedFail.d.operation.outcome})`);
ok(forcedFail.d.report && forcedFail.d.report.sealed === true, 'with a report on file, sealed like any other');

const registerAfterFail = await call('/api/intel/operations');
const failedRow = registerAfterFail.d.find(o => o.id === forcedFail.d.operation.id);
ok(!!failedRow && failedRow.outcome !== 'success', 'and the failed mission is on the public register too, not swept away');

report();
