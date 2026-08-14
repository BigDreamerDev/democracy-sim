/* Conflict as a countdown.

   A war here is not fought, it is funded — or it isn't, and you watch the
   pressure climb. What is asserted:

     - pressure moves on whether YOUR forces are supplied, not on a die roll;
     - it cannot swing more than one step in a cycle, so nothing goes from calm
       to open war overnight while everyone is asleep;
     - the same cycle never counts twice;
     - a blockade is felt by citizens who never opened the diplomacy page;
     - nothing here resolves anything — no territory, no treaty, no surrender.
       Pressure is the clock that makes the House argue. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 9 });
const T = w.admin.token;
const cfg = b => call('/api/admin/config', { method: 'PUT', body: b, token: T });
const front = () => call('/api/war/conflicts').then(r => r.d);
const payrun = (n, extra = {}) =>
  call('/api/economy/payrun', { method: 'POST', body: { cycle_no: n, ...extra }, token: T }).then(r => r.d);

await cfg({
  dividend: '4000', tax_rate: '0', tax_rate_upper: '0', registration_fee: '0',
  goods_economy_enabled: 'true', diplomacy_enabled: 'true',
  military_budget_per_cycle: '99999', strength_per_size: '4', conflict_step: '10',
  upkeep_food: '2', upkeep_energy: '1', upkeep_arms: '1', raise_cost_arms: '5'
});
await payrun(1, { upkeep: false, conflicts: false });

const power = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Korrin', adjective: 'Korrine', standing: 'hostile' }, token: T
})).d;
const pid = power.id || power.power?.id;
await call(`/api/admin/foreign/powers/${pid}`, { method: 'PATCH', body: { strength: 40 }, token: T });

/* Recognition is a bill, not a flag — so the House passes one, which is also a
   fair check that a power cannot declare anything at a Republic that has not
   acknowledged it exists. */
const recog = (await call(`/api/diplomacy/powers/${pid}/recognition`, {
  method: 'POST', body: { body: 'That Korrin be recognised.' }, token: w.T[0]
})).d;
await call(`/api/bills/${recog.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${recog.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${recog.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${recog.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${recog.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${recog.id}/close`, { method: 'POST', token: w.spk });
await call(`/api/bills/${recog.id}/assent`, { method: 'POST', body: { assent: true }, token: w.pres });

const free = w.citizens.filter(c => !(c.offices || []).length && c.display_name !== 'Uzair');
const [qm, maker] = free;
const qTok = w.tok[qm.display_name], mTok = w.tok[maker.display_name];
await call('/api/war/quartermaster/appoint', { method: 'POST', body: { user_id: qm.id }, token: w.pres });

const biz = (await call('/api/economy/businesses', {
  method: 'POST', body: { name: 'Ironworks', form: 'company', good_category: 'arms' }, token: mTok
})).d;
const arms = (await call(`/api/economy/businesses/${biz.id}/listings`, {
  method: 'POST', body: { title: 'Rifles', price: 4, stock: 900, unit: 'crate' }, token: mTok
})).d;
const farm = (await call('/api/economy/businesses', {
  method: 'POST', body: { name: 'Granary', form: 'company', good_category: 'food' }, token: w.T[1]
})).d;
const food = (await call(`/api/economy/businesses/${farm.id}/listings`, {
  method: 'POST', body: { title: 'Rations', price: 2, stock: 900, unit: 'crate' }, token: w.T[1]
})).d;

/* A grievance from the power, which is how a conflict starts. */
const fkey = (await call(`/api/admin/foreign/powers/${pid}/rotate-key`, { method: 'POST', token: T })).d.key;
// world.mjs sends the token raw when raw:true, which is how a foreign power authenticates.
const asPower = (path, body) => call(path, { method: 'POST', body, token: `Foreign ${fkey}`, raw: true });

console.log('-- a conflict opens');

const opened = await asPower('/api/foreign/declare', {
  kind: 'ultimatum', grievance: 'The Straits are closed to Korrine shipping.', idempotency_key: 'k1'
});
ok(opened.status === 200, 'the power lodges a grievance');
let f = await front();
ok(f.conflicts.length === 1, 'and it is on the front page of the war');
ok(f.conflicts[0].stage === 'grievance', 'starting at grievance');
ok(Number(f.conflicts[0].pressure) === 0, 'with no pressure yet');

console.log('\n-- an unarmed republic loses ground');

ok(f.ours === 0, 'nothing is standing, so the Republic brings nothing');
await payrun(2);
f = await front();
ok(Number(f.conflicts[0].pressure) === 10, `pressure climbs by the full step (${f.conflicts[0].pressure})`);
ok(f.conflicts[0].moving === 10, 'and is climbing at that rate');
ok(typeof f.conflicts[0].cycles_to_next === 'number', `${f.conflicts[0].cycles_to_next} cycles to ${f.conflicts[0].next_stage}`);

console.log('\n-- one step a cycle, never more');

await payrun(3);
ok(Number((await front()).conflicts[0].pressure) === 20, 'a second cycle, a second step — nothing swings overnight');
ok((await payrun(3)).conflicts?.reason || Number((await front()).conflicts[0].pressure) === 20,
  'and running the same cycle twice moves nothing');

console.log('\n-- escalation');

await payrun(4);
f = await front();
ok(f.conflicts[0].stage === 'ultimatum', `crossing 25 escalates to ${f.conflicts[0].stage}`);
await payrun(5); await payrun(6); await payrun(7);
f = await front();
ok(f.conflicts[0].stage === 'blockade', `and on to ${f.conflicts[0].stage} at ${f.conflicts[0].pressure}`);

console.log('\n-- a blockade is felt by people who never read the diplomacy page');

await asPower('/api/foreign/offers', { title: 'Korrine salt', price: 5, stock: 50, good_category: 'food', unit: 'crate', idempotency_key: 'o1' });
ok((await call('/api/diplomacy/offers')).d.filter(o => o.power_name === 'Korrin').length === 0,
  'a blockaded power\'s goods leave the market entirely');
ok((await front()).blockaded.includes(pid), 'and the blockade is named for anyone who asks');

console.log('\n-- supply turns it around');

await call(`/api/war/procure/listing/${arms.id}`, { method: 'POST', body: { units: 200 }, token: qTok });
await call(`/api/war/procure/listing/${food.id}`, { method: 'POST', body: { units: 300 }, token: qTok });
const f2 = (await call('/api/war/formations', { method: 'POST', body: { name: 'First Army', size: 20 }, token: qTok })).d;
ok(!!f2.id, 'the Republic raises twenty units and equips them');
ok((await front()).ours === 80, 'twenty fully-ready units count for 80 against their 40');

const wasAt = Number((await front()).conflicts[0].pressure);
await payrun(8);
const nowAt = Number((await front()).conflicts[0].pressure);
ok(nowAt < wasAt, `pressure falls once the Republic is stronger (${wasAt} → ${nowAt})`);
ok((await front()).conflicts[0].moving < 0, 'and is now moving the other way');

console.log('\n-- nothing here resolves anything');

ok((await call('/api/diplomacy/map')).d.powers.find(p => p.id === pid)?.territories.length === 0,
  'no territory changes hands — that is a treaty, and a treaty is a bill');
ok((await call('/api/diplomacy/treaties')).d.length === 0, 'and no treaty appears by itself');
ok((await front()).conflicts[0].status !== 'resolved', 'the conflict is still open: pressure is a clock, not a verdict');

report();
