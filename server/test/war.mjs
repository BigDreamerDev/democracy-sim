/* War as logistics.

   The group's decision: buy equipment, manage supply, pay upkeep — and no troop
   movements, no deployment, no battles. So what is asserted here is the loop
   that replaces manoeuvre:

     - the state buys at the seller's price, from real businesses, with real money;
     - it cannot spend past the budget the House voted;
     - you cannot raise a formation you have not equipped;
     - upkeep draws real quantities every cycle, whether or not anyone looks;
     - short supply costs readiness, and recovery is slower than collapse;
     - none of it mints or destroys a single mark. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 9 });
const T = w.admin.token;
const cfg = b => call('/api/admin/config', { method: 'PUT', body: b, token: T });
const war = t => call('/api/war', { token: t }).then(r => r.d);
const supply = () => call('/api/economy').then(r => Number(r.d.supply));
const payrun = (n, extra = {}) =>
  call('/api/economy/payrun', { method: 'POST', body: { cycle_no: n, ...extra }, token: T }).then(r => r.d);

await cfg({
  dividend: '3000', tax_rate: '0', tax_rate_upper: '0', registration_fee: '0',
  goods_economy_enabled: 'true', military_budget_per_cycle: '1000',
  upkeep_food: '2', upkeep_energy: '1', upkeep_arms: '1', upkeep_pay: '10',
  raise_cost_arms: '5', readiness_fall: '15', readiness_rise: '5'
});
await payrun(1, { upkeep: false });

const free = w.citizens.filter(c => !(c.offices || []).length && c.display_name !== 'Uzair');
const [qm, maker, grocer] = free;
const qTok = w.tok[qm.display_name], mTok = w.tok[maker.display_name], gTok = w.tok[grocer.display_name];

console.log('-- the office');

ok((await war()).quartermaster === null, 'the Quartermaster starts vacant');
ok((await call('/api/admin/office', { method: 'POST', body: { user_id: qm.id, office: 'quartermaster' }, token: T })).status === 403,
  'and the Returning Officer has no back door into it');
ok((await call('/api/war/quartermaster/appoint', { method: 'POST', body: { user_id: qm.id }, token: w.spk })).status === 403,
  'nor does the Speaker appoint');
ok((await call('/api/war/quartermaster/appoint', { method: 'POST', body: { user_id: qm.id }, token: w.pres })).status === 200,
  'the President appoints where there is no Prime Minister');

console.log('\n-- procurement is a purchase, not a summoning');

const biz = (await call('/api/economy/businesses', {
  method: 'POST', body: { name: 'Ironworks', form: 'company', good_category: 'arms' }, token: mTok
})).d;
const arms = (await call(`/api/economy/businesses/${biz.id}/listings`, {
  method: 'POST', body: { title: 'Rifles', price: 20, stock: 200, unit: 'crate' }, token: mTok
})).d;
const rations = (await call('/api/economy/businesses', {
  method: 'POST', body: { name: 'Granary', form: 'company', good_category: 'food' }, token: gTok
})).d;
const food = (await call(`/api/economy/businesses/${rations.id}/listings`, {
  method: 'POST', body: { title: 'Rations', price: 5, stock: 400, unit: 'crate' }, token: gTok
})).d;

ok((await call(`/api/war/procure/listing/${arms.id}`, { method: 'POST', body: { units: 10 }, token: mTok })).status === 403,
  'an ordinary citizen cannot buy for the Republic');

const before = await supply();
const bizBefore = (await call(`/api/economy/businesses/${biz.id}`)).d.balance;
const buy = (await call(`/api/war/procure/listing/${arms.id}`, { method: 'POST', body: { units: 40 }, token: qTok })).d;
ok(buy.ok && buy.held === 40, 'the Quartermaster buys 40 crates of arms into the stockpile');
ok(Number((await call(`/api/economy/businesses/${biz.id}`)).d.balance) === Number(bizBefore) + 800,
  'and the maker is paid the asking price — no requisition, no state discount');
ok(await supply() === before, 'buying an army creates no money');
ok((await war()).stockpile.arms === 40, 'the store holds it');

console.log('\n-- the budget is the House\'s, and it binds');

const over = await call(`/api/war/procure/listing/${arms.id}`, { method: 'POST', body: { units: 100 }, token: qTok });
ok(over.status === 400, 'the Quartermaster cannot spend past the voted budget');
ok(/House sets it/.test(over.d.error || ''), 'and is told to go and ask for more, in public');

/* The budget is per cycle, and 800 of the 1000 is already spent on rifles.
   Raise it the way the House would before buying the rest. */
await cfg({ military_budget_per_cycle: '99999' });
await call(`/api/war/procure/listing/${food.id}`, { method: 'POST', body: { units: 60 }, token: qTok });
const energyBiz = (await call('/api/economy/businesses', {
  method: 'POST', body: { name: 'Coalfields', form: 'company', good_category: 'energy' }, token: mTok
})).d;
const fuel = (await call(`/api/economy/businesses/${energyBiz.id}/listings`, {
  method: 'POST', body: { title: 'Coal', price: 3, stock: 500, unit: 'tonne' }, token: mTok
})).d;
await call(`/api/war/procure/listing/${fuel.id}`, { method: 'POST', body: { units: 40 }, token: qTok });
const store = (await war()).stockpile;
ok(store.food === 60 && store.energy === 40 && store.arms === 40, `the store reads ${store.food} food, ${store.energy} energy, ${store.arms} arms`);

console.log('\n-- you cannot raise what you have not equipped');

const tooBig = await call('/api/war/formations', { method: 'POST', body: { name: 'The Grand Army', size: 20 }, token: qTok });
ok(tooBig.status === 400, 'raising 20 units needs 100 arms and there are 40');
ok(/stockpile/.test(tooBig.d.error || ''), 'and the refusal says so plainly');

const f = (await call('/api/war/formations', { method: 'POST', body: { name: 'First Regiment', size: 6 }, token: qTok })).d;
ok(!!f.id, 'six units are raised');
ok((await war()).stockpile.arms === 10, 'and 30 arms leave the store to equip them');
ok(Number(f.readiness) === 100, 'a newly raised formation is fully ready');

console.log('\n-- upkeep runs whether or not anyone is looking');

const s1 = await supply();
const up = (await payrun(2)).upkeep;
ok(up.size === 6, 'the payrun supplies six units of formation');
ok(up.shortfall.length === 0, 'and everything is covered this cycle');
ok((await war()).stockpile.food === 48, 'twelve rations are eaten');
ok((await war()).stockpile.energy === 34, 'six of fuel burned');
ok((await war()).stockpile.arms === 4, 'six of equipment worn out');
ok(await supply() === s1, 'and paying an army creates no money either');
ok(up.paid > 0 && up.paid <= 60, `wages of ${up.paid} are paid out to the citizenry, evenly`);

console.log('\n-- short supply costs readiness');

ok(Number((await war()).formations[0].readiness) === 100, 'still fully ready while supplied');
const short = (await payrun(3)).upkeep;
ok(short.shortfall.length > 0, `the store runs out — ${short.shortfall.join('; ')}`);
ok(Number((await war()).formations[0].readiness) === 85, 'readiness falls by the fixed step');
await payrun(4);
ok(Number((await war()).formations[0].readiness) === 70, 'and keeps falling while it is short');

console.log('\n-- and recovery is slower than collapse, on purpose');

await call(`/api/war/procure/listing/${food.id}`, { method: 'POST', body: { units: 100 }, token: qTok });
await call(`/api/war/procure/listing/${fuel.id}`, { method: 'POST', body: { units: 100 }, token: qTok });
await call(`/api/war/procure/listing/${arms.id}`, { method: 'POST', body: { units: 100 }, token: qTok });
await payrun(5);
ok(Number((await war()).formations[0].readiness) === 75, 'a supplied cycle recovers 5, against 15 lost');
ok(await supply() === s1, 'the ledger still sums to zero after all of it');

console.log('\n-- the forecast a Quartermaster actually needs');

const f2 = (await war()).forecast.find(x => x.category === 'food');
ok(f2.per_cycle === 12, 'the page states what the next cycle costs');
ok(typeof f2.cycles_covered === 'number', 'and how many cycles the store covers');

console.log('\n-- disbanding');

ok((await call(`/api/war/formations/${f.id}/disband`, { method: 'POST', token: mTok })).status === 403,
  'only the Quartermaster disbands');
ok((await call(`/api/war/formations/${f.id}/disband`, { method: 'POST', token: qTok })).status === 200, 'and may');
const after = (await payrun(6)).upkeep;
ok(after.forces === 0, 'with nothing standing, upkeep costs nothing');

report();
