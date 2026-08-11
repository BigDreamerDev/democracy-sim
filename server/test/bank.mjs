import { call, ok, report, setup } from './world.mjs';
const w = await setup({ citizens: 10 });
const admin = w.admin, T = admin.token;
const cfg = b => call('/api/admin/config', { method: 'PUT', body: b, token: T });
await cfg({ dividend: '500', loan_ceiling: '500', deposit_rate: '0.02', loan_rate: '0.05', ownership_cap: '0.4', tax_rate: '0' });
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: T });
const a = w.tok[w.citizens[1].display_name], b = w.tok[w.citizens[2].display_name];
const bal = t => call('/api/economy/me', { token: t }).then(r => Number(r.d.account.balance));
const supply = () => call('/api/economy').then(r => Number(r.d.supply));

console.log('\n-- Part 4: the public bank');
ok((await call('/api/economy/bank/deposit', { method: 'POST', body: { amount: 300 }, token: a })).status === 200, 'a citizen deposits');
ok((await call('/api/economy/bank', { token: a })).d.deposit === 300, 'the deposit is recorded');
ok((await call('/api/economy/bank/withdraw', { method: 'POST', body: { amount: 999 }, token: a })).status === 400, 'cannot withdraw more than is held');
ok((await call('/api/economy/bank/withdraw', { method: 'POST', body: { amount: 100 }, token: a })).status === 200, 'withdraws part of it');
ok((await call('/api/economy/bank', { token: a })).d.deposit === 200, 'the balance follows');

const loan = (await call('/api/economy/bank/borrow', { method: 'POST', body: { amount: 400, cycles: 2, cycle_no: 1 }, token: b })).d;
ok(!!loan.id, 'a citizen borrows');
ok((await call('/api/economy/bank/borrow', { method: 'POST', body: { amount: 200 }, token: b })).status === 400, 'the ceiling holds');
const beforeInterest = (await call('/api/economy/bank', { token: b })).d.owed;
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 2, dividend: false, salaries: false, tax: false }, token: T });
const afterInterest = (await call('/api/economy/bank', { token: b })).d.owed;
ok(afterInterest === beforeInterest + 20, `interest accrues (${beforeInterest} → ${afterInterest})`);
ok((await call('/api/economy/bank', { token: a })).d.deposit === 204, 'and deposits earn it');

await call('/api/economy/bank/repay', { method: 'POST', body: { loan_id: loan.id, amount: 100 }, token: b });
ok((await call('/api/economy/bank', { token: b })).d.owed === afterInterest - 100, 'repayment reduces the debt');
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 5, dividend: false, salaries: false, tax: false }, token: T });
const defaulted = (await call('/api/economy/bank', { token: b })).d.loans[0];
ok(defaulted.status === 'default', 'a loan past its due cycle falls into default');
const sued = (await call(`/api/economy/bank/sue/${loan.id}`, { method: 'POST', token: T })).d;
ok(!!sued.ref, `and the default goes to the Court as ${sued.ref}`);

console.log('\n-- Part 5: the market in shares');
const biz = (await call('/api/economy/businesses', { method: 'POST', body: { name: 'Kitchen Co', form: 'coop' }, token: a })).d;
ok((await call(`/api/economy/businesses/${biz.id}/issue`, { method: 'POST', body: { qty: 100 }, token: b })).status === 403, 'outsiders cannot issue shares');
ok((await call(`/api/economy/businesses/${biz.id}/issue`, { method: 'POST', body: { qty: 100 }, token: a })).status === 200, 'the founder issues 100 shares');
ok((await call(`/api/economy/businesses/${biz.id}/issue`, { method: 'POST', body: { qty: 50 }, token: a })).status === 400, 'and cannot issue twice');
let m = (await call(`/api/economy/businesses/${biz.id}/market`, { token: a })).d;
ok(m.holders[0].qty === '100' || Number(m.holders[0].qty) === 100, 'the founder holds all of them');

ok((await call(`/api/economy/businesses/${biz.id}/order`, { method: 'POST', body: { side: 'ask', price: 10, qty: 200 }, token: a })).status === 400,
  'cannot offer shares you do not hold');
ok((await call(`/api/economy/businesses/${biz.id}/order`, { method: 'POST', body: { side: 'ask', price: 10, qty: 40 }, token: a })).d.ok, 'the founder offers 40 at 10');
const bidLow = (await call(`/api/economy/businesses/${biz.id}/order`, { method: 'POST', body: { side: 'bid', price: 5, qty: 10 }, token: b })).d;
ok(bidLow.filled === 0, 'a bid below the ask does not cross');
const supplyMid = await supply();
const bidHit = (await call(`/api/economy/businesses/${biz.id}/order`, { method: 'POST', body: { side: 'bid', price: 12, qty: 10 }, token: b })).d;
ok(bidHit.filled === 10, 'a bid at or above the ask fills');
m = (await call(`/api/economy/businesses/${biz.id}/market`, { token: b })).d;
ok(m.trades[0] && Number(m.trades[0].price) === 10, 'and trades at the resting order’s price, not the bidder’s limit');
ok(Number(m.mine) === 10, 'the buyer holds the shares');
ok(await supply() === supplyMid, 'the ledger still balances after trading');

const totalShares = m.holders.reduce((n, h) => n + Number(h.qty), 0);
ok(totalShares === 100, `shares are conserved (${totalShares} of 100)`);
ok((await call(`/api/economy/businesses/${biz.id}/order`, { method: 'POST', body: { side: 'bid', price: 12, qty: 60 }, token: b })).status === 400,
  'no citizen may bid past the ownership cap');
ok((await call(`/api/economy/orders/share/${bidLow.ok ? '' : ''}1/cancel`, { method: 'POST', token: b })).status !== 500, 'cancelling does not explode');

const div = await call(`/api/economy/businesses/${biz.id}/dividend`, { method: 'POST', body: { per_share: 1 }, token: a });
ok(div.status === 400, 'a business cannot pay a dividend it cannot afford');
report();
