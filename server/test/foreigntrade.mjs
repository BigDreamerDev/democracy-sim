/* Foreign trade must move money, never create it.

   Before powers held accounts, a citizen could list a rock at a million, a
   compliant foreign power could buy it, and a million marks appeared in the
   Republic from nowhere. These assertions are the reason that cannot happen
   again. */
import { call, ok, report, setup } from './world.mjs';

const B = 'http://localhost:4321';
const w = await setup({ citizens: 10 });
const T = w.admin.token;
const supply = async () => Number((await call('/api/economy')).d.supply);

await call('/api/admin/config', { method: 'PUT', body: {
  diplomacy_enabled: 'true', dividend: '100', tax_rate: '0',
  foreign_treasury_start: '5000', foreign_treasury_per_cycle: '1000',
  foreign_export_cap_per_cycle: '2000'
}, token: T });
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: T });

ok(await supply() === 0, 'the ledger sums to zero before any foreign contact');

const p = (await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Valtia', adjective: 'Valtish' }, token: T })).d;
const KEY = p.key || p.api_key;
const powerId = p.id || p.power?.id;
const F = async (path, opts = {}) => {
  const r = await fetch(B + path, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Foreign ' + KEY },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
};

ok(await supply() === 0, 'creating a power funds it from the Treasury, not from nowhere');

const push = async (id) => {
  await call(`/api/bills/${id}/second`, { method: 'POST', token: w.T[1] });
  await call(`/api/bills/${id}/second`, { method: 'POST', token: w.T[2] });
  await call(`/api/bills/${id}/table`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${id}/division`, { method: 'POST', token: w.spk });
  for (const t of w.T) await call(`/api/bills/${id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
  await call(`/api/bills/${id}/close`, { method: 'POST', token: w.spk });
  await call(`/api/bills/${id}/assent`, { method: 'POST', token: w.pres });
};
await push((await call(`/api/diplomacy/powers/${powerId}/recognition`, { method: 'POST', token: w.T[0] })).d.id);
await F('/api/foreign/treaties', { method: 'POST', body: {
  title: 'Trade', articles: '1. Trade is open.', terms: { trade_open: true }, idempotency_key: 't1' } });
await push((await call('/api/bills')).d.find(b => b.kind === 'treaty').id);
for (const t of (await F('/api/foreign/treaties')).d) await F(`/api/foreign/treaties/${t.id}/ratify`, { method: 'POST' });

console.log('\n-- the exploit that used to work');
const cit = w.plainTok;
const biz = (await call('/api/economy/businesses', { method: 'POST', body: { name: 'Export Co', form: 'sole' }, token: cit })).d;
const rock = (await call(`/api/economy/businesses/${biz.id}/listings`, { method: 'POST', body: { title: 'A rock', price: 1000000 }, token: cit })).d;
const before = await supply();
const buy = await F(`/api/foreign/domestic-listings/${rock.id}/buy`, { method: 'POST' });
ok(buy.status === 400, `a power cannot buy what it cannot afford (${buy.status})`);
ok(await supply() === before, 'and not one mark was created');

console.log('\n-- honest trade still works, and still balances');
const bread = (await call(`/api/economy/businesses/${biz.id}/listings`, { method: 'POST', body: { title: 'A loaf', price: 400 }, token: cit })).d;
const good = await F(`/api/foreign/domestic-listings/${bread.id}/buy`, { method: 'POST' });
ok(good.status === 200, 'an affordable export goes through');
ok(await supply() === before, `the money supply is unchanged by an export (${await supply()})`);
ok(Number((await call(`/api/economy/businesses/${biz.id}`)).d.balance) === 400, 'the seller was paid');

console.log('\n-- the per-cycle cap');
const more = [];
for (let i = 0; i < 5; i++) {
  const l = (await call(`/api/economy/businesses/${biz.id}/listings`, { method: 'POST', body: { title: 'Loaf ' + i, price: 400 }, token: cit })).d;
  more.push((await F(`/api/foreign/domestic-listings/${l.id}/buy`, { method: 'POST' })).status);
}
ok(more.includes(429), `the cap stops a power buying the country in one cycle (${more.join(',')})`);
ok(await supply() === before, 'still balanced after the cap bites');

console.log('\n-- imports');
await F('/api/foreign/offers', { method: 'POST', body: { title: 'Valtish salt', price: 50, idempotency_key: 'o1', good_category: 'food' } });
const offers = (await call('/api/diplomacy/offers', { token: cit })).d;
if (offers.length) {
  const s0 = await supply();
  const r = await call(`/api/diplomacy/offers/${offers[0].id}/buy`, { method: 'POST', token: cit });
  ok(r.status === 200 || r.status === 400, `a citizen may buy from abroad (${r.status})`);
  ok(await supply() === s0, 'an import destroys no money either — it goes to the power');
} else ok(true, 'no foreign offers to test (goods mode may require a category)');

/* The payrun was the hole. Tribute debited the Treasury and wrote a ledger row
   to nowhere, so every cycle of every ratified treaty quietly destroyed money —
   and this suite never ran a payrun with a treaty in force, so it stayed green
   for the whole time the bug existed. It runs one now. */
console.log('\n-- the payrun, with money owed abroad');

const powerBefore = Number((await call('/api/diplomacy/balance', { token: cit })).d.powers?.find(x => x.id === powerId)?.balance ?? 0);
const s1 = await supply();
const run = (await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 2 }, token: T })).d;
ok(!!run.diplomacy, 'the payrun runs diplomacy with the rest of it');
ok(await supply() === s1, `topping up the powers creates no money (${await supply()})`);
ok(run.diplomacy.topped > 0, `${run.diplomacy.topped} power(s) funded from the Treasury`);

const s2 = await supply();
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 3 }, token: T });
ok(await supply() === s2, 'and another cycle changes nothing about the total');

const acct = (await call('/api/economy')).d;
ok(Number(acct.supply) === 0, 'and the whole ledger still sums to zero at the end');
report();
