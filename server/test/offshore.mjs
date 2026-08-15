/* Offshore money, forex and defection.

   Two properties worth holding, in the order they are asserted:

     - a round trip through a foreign currency, ours -> theirs -> ours,
       leaves the ledger exactly balanced and nobody richer than they went in
       (the spread is a cost, not a leak, and floor/ceil rounding closes the
       arbitrage loop by arithmetic rather than by a check);
     - a defector holds no vote, no seat and no signature, even when the
       House has opened bill proposal and voting to every citizen — the case
       that used to slip past canPropose() because it never asked. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 10 });
const T = w.admin.token;
const cfg = b => call('/api/admin/config', { method: 'PUT', body: b, token: T });
const supply = () => call('/api/economy').then(r => Number(r.d.supply));
const balOf = t => call('/api/economy/me', { token: t }).then(r => Number(r.d.account.balance));

await cfg({
  dividend: '5000', tax_rate: '0', offshore_enabled: 'true',
  forex_spread: '0.03', offshore_fee: '0.05', offshore_minimum: '50'
});
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: T });

ok(await supply() === 0, 'the ledger sums to zero before any foreign contact');

const power = (await call('/api/admin/foreign/powers', {
  method: 'POST', body: { name: 'Valtia', adjective: 'Valtish' }, token: T
})).d;
const powerId = power.id || power.power?.id;

console.log('\n-- forex round trip');

const trader = w.plain, trTok = w.plainTok;
const start = await balOf(trTok);

const buy = await call('/api/forex/buy', {
  method: 'POST', body: { power_id: powerId, amount: 1000 }, token: trTok
});
ok(buy.status === 200, `buying foreign currency succeeds (${buy.status})`);
ok(await supply() === 0, 'a purchase moves money, it does not create it');

const sell = await call('/api/forex/sell', {
  method: 'POST', body: { power_id: powerId, units: buy.d.units }, token: trTok
});
ok(sell.status === 200, `selling it back succeeds (${sell.status})`);
ok(await supply() === 0, 'and selling it back does too');

const end = await balOf(trTok);
ok(end < start, `the round trip cost the spread, not nothing (${start} -> ${end})`);
ok(end >= start - 1000, 'and it did not cost more than was put in');

console.log('\n-- defection cannot vote twice or propose');

const defector = w.mps[2], defTok = w.T[2];
// w.T[2] is the defector; everybody else moves the bill this section needs.
const others = w.T.filter((_, i) => i !== 2);

// Open bill proposal and voting to every citizen: the exact case that used to
// let a renouncer through, because canPropose() never asked about defection.
await cfg({ bill_proposers: 'citizens', bill_voters: 'citizens' });

const mainBill = (await call('/api/bills', {
  method: 'POST', body: { kind: 'motion', title: 'Division test', body: 'x' }, token: others[0]
})).d;

const def = await call('/api/defection', {
  method: 'POST', body: { power_id: powerId, reasons: 'seeking better prospects abroad' }, token: defTok
});
ok(def.status === 200, `defection succeeds (${def.status})`);

const proposeAfter = await call('/api/bills', {
  method: 'POST', body: { kind: 'motion', title: 'After', body: 'x' }, token: defTok
});
ok(proposeAfter.status === 403, `a defector cannot propose even when bill_proposers is open to every citizen (${proposeAfter.status})`);

const secondAfter = await call(`/api/bills/${mainBill.id}/second`, { method: 'POST', token: defTok });
ok(secondAfter.status === 403, `nor second somebody else's bill (${secondAfter.status})`);

// Push the bill to a division with legitimate seconders and try to vote on it.
await call(`/api/bills/${mainBill.id}/second`, { method: 'POST', token: others[1] });
await call(`/api/bills/${mainBill.id}/second`, { method: 'POST', token: others[2] });
await call(`/api/bills/${mainBill.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${mainBill.id}/division`, { method: 'POST', token: w.spk });

const voteAfter = await call(`/api/bills/${mainBill.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: defTok });
ok(voteAfter.status === 403 || voteAfter.status === 400,
  `a defector holds no vote in the division (${voteAfter.status})`);

report();
