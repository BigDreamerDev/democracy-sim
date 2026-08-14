/* The Judicial Enforcement Act and The Creation of an Economy Act. */
import { call, ok, report, setup, passBill } from './world.mjs';
const w = await setup({ citizens: 10 });   // enough spare citizens to fill the Court
const admin = w.admin;
// The Court takes the first three office-free citizens, so the litigant must be
// someone else entirely — a Justice may not rule on a case they brought.
let plain = w.plainTok;
const cfg = (body) => call('/api/admin/config', { method: 'PUT', body, token: admin.token });

// Three citizens free of office, to sit on the Court.
const free = w.citizens.filter(c => !(c.offices || []).length && c.display_name !== 'Uzair');
const spare = w.users.filter(u => !w.citizens.find(c => c.id === u.user.id && (c.offices || []).length));

console.log('\n-- appointing the Court');
const court0 = (await call('/api/court')).d;
ok(court0.seats.length === 3, 'three seats exist');
ok(court0.seats.map(s => s.appointer).join(',') === 'house,president,people', 'one each for the House, the President and the People');
ok(court0.sitting === 0, 'and all of them empty');

const mp = w.citizens.find(c => (c.offices || []).includes('mp'));
ok((await call('/api/court/seats/1', { method: 'POST', body: { user_id: mp.id }, token: plain })).status === 403,
  'an ordinary citizen cannot fill the House seat');
ok((await call('/api/court/seats/1', { method: 'POST', body: { user_id: mp.id }, token: w.pres })).status === 403,
  'nor can the President — that seat belongs to the House');

// Article 17.11: a Justice holds no other office.
const clash = await call('/api/court/seats/1', { method: 'POST', body: { user_id: mp.id }, token: w.spk });
ok(clash.status === 400 && /no other office/i.test(clash.d.error), 'a sitting MP cannot be made a Justice without resigning');

/* The RO also plays, so one account routinely holds an office as well. Being
   the Returning Officer must never *subtract* a power the office gives you —
   testing is_admin before offices once took a sitting Speaker's own seat on the
   bench away from them. Offices first, the RO flag only ever as an extra. */
await call('/api/admin/user', { method: 'POST', body: { user_id: w.mps[0].id, is_admin: true }, token: admin.token });
const both = (await call('/api/court', { token: w.spk })).d.seats;
ok(both[0].can_appoint === true, 'a Speaker who is also the RO keeps the House seat');
ok(both[1].can_appoint === false, "but still not the President's");
ok(both[2].can_appoint === false, "and not the People's either — that one is elected");
await call('/api/admin/user', { method: 'POST', body: { user_id: w.mps[0].id, is_admin: false }, token: admin.token });

ok((await call('/api/court/seats/1', { method: 'POST', body: { user_id: free[0].id }, token: w.spk })).status === 200,
  'the Speaker fills the House seat');
ok((await call('/api/court/seats/2', { method: 'POST', body: { user_id: free[1].id }, token: w.pres })).status === 200,
  'the President fills theirs');
/* The Returning Officer records the People's seat because there is no ballot
   for it yet — and that is the whole of their part in the Court. They are not
   the House and not the President, and an RO who could fill those two seats
   would hold a majority of the bench on their own. */
/* The People's seat is elected now, not recorded. Nobody may appoint to it. */
ok((await call('/api/court/seats/3', { method: 'POST', body: { user_id: free[2].id }, token: admin.token })).status === 403,
  "the Returning Officer can no longer hand out the People's seat");
ok((await call('/api/court/seats/3', { method: 'POST', body: { user_id: free[2].id }, token: w.spk })).status === 403,
  'and neither can the Speaker');

const jel = (await call('/api/elections', { method: 'POST', body: { kind: 'justice', title: "The People's Justice" }, token: admin.token })).d;
ok(!!jel.id, "the Returning Officer calls a ballot for the People's seat instead");
await call(`/api/elections/${jel.id}/stand`, { method: 'POST', token: w.tok[free[2].display_name] });
await call(`/api/elections/${jel.id}/status`, { method: 'POST', body: { status: 'voting' }, token: admin.token });
const jcand = (await call(`/api/elections/${jel.id}`)).d.candidates[0];
for (const t of [w.spk, w.pres, ...w.T]) await call(`/api/elections/${jel.id}/vote`, { method: 'POST', body: { candidacy_id: jcand.id }, token: t });
const jres = (await call(`/api/elections/${jel.id}/status`, { method: 'POST', body: { status: 'closed' }, token: admin.token })).d;
ok(jres.seated?.length === 1, 'and the Citizens elect one');
ok(!!jres.term_ends, 'for a fixed term, like the other two');

const court = (await call('/api/court')).d;
ok(court.sitting === 3, 'the Court is full');
ok(court.seats.every(x => x.can_appoint === false),
  'and with the bench full, nobody is offered a way onto it');

const jTok = free.slice(0, 3).map(c => w.tok[c.display_name]);
plain = w.tok[free[3].display_name];              // holds no office and no seat
ok(!!plain, 'a citizen with neither office nor seat, to bring cases and trade');
ok((await call('/api/me', { token: jTok[0] })).d.offices.includes('justice'), 'a Justice holds the office of justice');
ok(!!court.seats[0].term_ends, 'and holds it for a fixed term');

console.log('\n-- a citizen brings a case');
const bill = await passBill(w, { title: 'Compulsory Gruel Act', kind: 'law', body: 'All shall eat gruel.' });
const law = (await call('/api/laws')).d.find(l => l.title === 'Compulsory Gruel Act');
ok(!!law, 'a law exists to complain about');

const bad = await call('/api/court/cases', { method: 'POST', body: { title: 'x', claim: 'y', target_kind: 'law' }, token: plain });
ok(bad.status === 400, 'a case against a law must name the law');

const c = (await call('/api/court/cases', { method: 'POST', body: {
  title: 'Gruel Act is repugnant to Article 1',
  claim: 'It compels citizens without any power to do so.',
  target_kind: 'law', target_law_id: law.id
}, token: plain })).d;
ok(!!c.ref, 'any citizen may bring a case — no leave required');

console.log('\n-- only Justices rule, and they must give reasons');
ok((await call(`/api/court/cases/${c.id}/opinion`, { method: 'POST', body: { vote: 'uphold', reason: 'no' }, token: plain })).status === 403,
  'a citizen cannot rule on their own case');
ok((await call(`/api/court/cases/${c.id}/opinion`, { method: 'POST', body: { vote: 'uphold', reason: 'because' }, token: w.spk })).status === 403,
  'nor can the Speaker');
ok((await call(`/api/court/cases/${c.id}/opinion`, { method: 'POST', body: { vote: 'uphold' }, token: jTok[0] })).status === 400,
  'a Justice must give reasons');

const first = (await call(`/api/court/cases/${c.id}/opinion`, { method: 'POST', body: { vote: 'uphold', reason: 'Article 1 grants no such power.' }, token: jTok[0] })).d;
ok(first.decided === false, 'one Justice does not decide a case');
ok((await call(`/api/court/cases/${c.id}/opinion`, { method: 'POST', body: { vote: 'dismiss', reason: 'again' }, token: jTok[0] })).status === 409,
  'and cannot vote twice');
ok((await call('/api/laws')).d.some(l => l.id === law.id), 'the law still stands');

const second = (await call(`/api/court/cases/${c.id}/opinion`, { method: 'POST', body: { vote: 'uphold', reason: 'I agree.' }, token: jTok[1] })).d;
ok(second.decided === true && second.outcome === 'upheld', 'two agreeing decide it');
ok(second.struck === law.ref, `the law is struck down (${second.struck})`);
ok(!(await call('/api/laws')).d.some(l => l.id === law.id), 'and leaves the active statute book');
ok((await call('/api/laws?all=1')).d.some(l => l.id === law.id), 'while staying readable in the archive');
const ruled = (await call(`/api/court/cases/${c.id}`)).d;
ok(/Article 1 grants no such power/.test(ruled.ruling), 'the reasons are published with the ruling');
ok((await call('/api/audit')).d.some(a => a.action === 'court.ruling'), 'and the ruling is in the public record');

console.log('\n-- the money');
await cfg({ dividend: '100', tax_free_allowance: '200', tax_rate: '0.1', tax_upper_threshold: '1000', tax_rate_upper: '0.25' });
const before = (await call('/api/economy/me', { token: plain })).d;
ok(Number(before.account.balance) === 0, 'a citizen starts with nothing');

const run1 = (await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: admin.token })).d;
ok(run1.dividend.paid === 11, `the dividend reaches every citizen (${run1.dividend.paid})`);
ok(run1.salaries.paid > 0, 'officers are paid');
const after = (await call('/api/economy/me', { token: plain })).d;
ok(Number(after.account.balance) === 100, 'an ordinary citizen holds exactly the dividend');

const again = (await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: admin.token })).d;
ok(again.dividend.paid === 0, 'a cycle cannot be paid twice');

const econ = (await call('/api/economy')).d;
ok(Number(econ.treasury) < 0, 'the Treasury runs a deficit rather than letting the floor fail');
ok(Number(econ.supply) === 0, 'and the books balance to zero — money is only ever moved, never conjured');

console.log('\n-- progressive tax');
const rich = w.tok[w.citizens.find(c => (c.offices || []).includes('president')).display_name];
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 2, tax: false }, token: admin.token });
const beforeTax = Number((await call('/api/economy/me', { token: plain })).d.account.balance);
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 3, dividend: false, salaries: false }, token: admin.token });
const afterTax = Number((await call('/api/economy/me', { token: plain })).d.account.balance);
const expected = beforeTax - Math.round(Math.max(0, beforeTax - 200) * 0.1);
ok(afterTax === expected, `tax falls only on the balance above the allowance: ${beforeTax} → ${afterTax}`);

// Someone with nothing above the allowance pays nothing at all.
const poor = w.tok[free[3].display_name];
await call('/api/economy/transfer', { method: 'POST', body: { user_id: w.citizens[1].id, amount: afterTax - 150 }, token: poor });
const low = Number((await call('/api/economy/me', { token: poor })).d.account.balance);
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 4, dividend: false, salaries: false }, token: admin.token });
ok(Number((await call('/api/economy/me', { token: poor })).d.account.balance) === low,
  `holding ${low}, below the allowance, nothing is taken`);

console.log('\n-- transfers');
const target = w.citizens.find(c => c.display_name !== w.plain.display_name && !(c.offices || []).length) || w.citizens[1];
const t1 = await call('/api/economy/transfer', { method: 'POST', body: { user_id: target.id, amount: 50 }, token: plain });
ok(t1.status === 200, 'a citizen may pay another');
ok((await call('/api/economy/transfer', { method: 'POST', body: { user_id: target.id, amount: 999999 }, token: plain })).status === 400,
  'but not money they do not have');
ok(Number((await call('/api/economy')).d.supply) === 0, 'the ledger still balances after transfers');

console.log('\n-- enterprise');
await cfg({ registration_fee: '25' });
const biz = (await call('/api/economy/businesses', { method: 'POST', body: { name: 'Gruel & Co', form: 'coop', description: 'Gruel.' }, token: plain })).d;
ok(!!biz.id, 'a citizen founds a business');
ok((await call('/api/economy/businesses', { method: 'POST', body: { name: 'gruel & co' }, token: rich })).status === 409,
  'names are unique');

const listing = (await call(`/api/economy/businesses/${biz.id}/listings`, { method: 'POST', body: { title: 'A bowl of gruel', price: 30 }, token: plain })).d;
ok(!!listing.id, 'and lists something for sale');
ok((await call('/api/economy/market')).d.some(l => l.id === listing.id), 'it appears on the market');
ok((await call(`/api/economy/listings/${listing.id}/buy`, { method: 'POST', token: plain })).status === 400,
  'the owner cannot buy from themselves');

const order = (await call(`/api/economy/listings/${listing.id}/buy`, { method: 'POST', token: rich })).d;
ok(order.status === 'escrow', 'the money is held by the state, not handed straight over');
const bizAcc = (await call(`/api/economy/businesses/${biz.id}`)).d;
ok(Number(bizAcc.balance) === 0, 'the seller has not been paid yet');

ok((await call(`/api/economy/orders/${order.id}/confirm`, { method: 'POST', token: plain })).status === 403,
  'only the buyer confirms delivery');
ok((await call(`/api/economy/orders/${order.id}/confirm`, { method: 'POST', token: rich })).status === 200, 'the buyer confirms');
ok(Number((await call(`/api/economy/businesses/${biz.id}`)).d.balance) === 30, 'and the seller is paid');
ok(Number((await call('/api/economy')).d.supply) === 0, 'books still balance');

console.log('\n-- a dispute goes to the Court');
const order2 = (await call(`/api/economy/listings/${listing.id}/buy`, { method: 'POST', token: rich })).d;
const dispute = (await call(`/api/economy/orders/${order2.id}/dispute`, { method: 'POST', body: { claim: 'No gruel arrived.' }, token: rich })).d;
ok(!!dispute.ref, `a buyer disputes and it becomes case ${dispute.ref}`);
const orders = (await call('/api/economy/orders', { token: rich })).d;
ok(orders.find(o => o.id === order2.id).status === 'disputed', 'the order is marked disputed');
ok(Number((await call(`/api/economy/businesses/${biz.id}`)).d.balance) === 30, 'and the money stays held while the Court decides');
ok((await call(`/api/court/cases/${dispute.case_id}`)).d.status === 'open', 'the case is before the Court');

console.log('\n-- declarations of interest');
ok((await call('/api/economy/declare', { method: 'POST', body: { body: 'One coop, 30 marks.' }, token: plain })).status === 200,
  'a citizen declares what they own');
ok((await call('/api/economy/declarations')).d.some(d => /coop/.test(d.body)), 'and it is public');


console.log('\n-- a Justice cannot be swapped out at will');
const seatsNow = (await call('/api/court', { token: w.spk })).d.seats;
ok(seatsNow.every(s => s.can_appoint === false), 'no seat offers an appoint button while it is filled');
const pView = (await call('/api/court', { token: w.pres })).d.seats;
ok(pView.every(s => !s.can_vacate), 'the President is offered no way to vacate any seat, including their own appointee');
const swap = await call('/api/court/seats/2', { method: 'POST', body: { user_id: free[3].id }, token: w.pres });
ok(swap.status === 400 && /fixed term/i.test(swap.d.error), 'and the server refuses the swap outright');
const notMine = await call('/api/court/seats/1/vacate', { method: 'POST', token: w.pres });
ok(notMine.status === 403, 'the President cannot vacate the House\u2019s seat either');
ok((await call('/api/court/seats/1/vacate', { method: 'POST', token: jTok[0] })).status === 200, 'but a Justice may resign their own');
const afterResign = (await call('/api/court', { token: w.spk })).d;
ok(afterResign.sitting === 2 && afterResign.seats[0].can_appoint === true, 'which frees the seat for the Speaker to fill again');

console.log('\n-- an impeached Justice leaves the bench');
const j2 = afterResign.seats[1];
const imp = (await call('/api/bills', { method: 'POST', body: {
  title: 'That a Justice be removed', kind: 'impeachment', body: 'Cause.', target_user_id: j2.user_id
}, token: w.T[0] })).d;
await call(`/api/bills/${imp.id}/second`, { method: 'POST', token: w.T[1] });
await call(`/api/bills/${imp.id}/second`, { method: 'POST', token: w.T[2] });
await call(`/api/bills/${imp.id}/table`, { method: 'POST', token: w.spk });
await call(`/api/bills/${imp.id}/division`, { method: 'POST', token: w.spk });
for (const t of w.T) await call(`/api/bills/${imp.id}/vote`, { method: 'POST', body: { vote: 'aye' }, token: t });
await call(`/api/bills/${imp.id}/close`, { method: 'POST', token: w.spk });
const bench = (await call('/api/court')).d;
ok(bench.seats[1].display_name === null, 'the seat clears rather than showing a ghost');
ok(bench.sitting === 1, 'and the Court is down to one');
report();
