/* The Treasury and the Fed.

   The properties worth holding, in the order they are asserted:

     - the Treasurer is the government's and the Fed's head is nobody's;
     - a nomination without confirmation is of no effect;
     - the President who nominated a Fed chair cannot then dismiss them;
     - no officer, however senior, can set the rate of interest;
     - whoever sets the rate of interest holds no business interest;
     - every Fed decision carries published reasons, or it is refused;
     - issuing money does not break sum(accounts.balance) = 0;
     - a licensed bank cannot lend past its reserve;
     - a failed bank costs its founder everything and its depositors the
       shortfall above the guarantee. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 10 });
const T = w.admin.token;
const cfg = b => call('/api/admin/config', { method: 'PUT', body: b, token: T });

await cfg({
  dividend: '2000', tax_rate: '0', tax_rate_upper: '0', registration_fee: '0',
  bank_charter_fee: '250', reserve_ratio: '0.2', deposit_guarantee: '500', fed_terms: '3'
});
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 1 }, token: T });

/* Four citizens who hold no office at all, so no test accidentally gives one
   person two hats and then proves that the hats do not clash. */
const free = w.citizens.filter(c => !(c.offices || []).length && c.display_name !== 'Uzair');
const [treas, fed, banker, saver] = free;
const tTok = w.tok[treas.display_name];
const fTok = w.tok[fed.display_name];
const bkTok = w.tok[banker.display_name];
const svTok = w.tok[saver.display_name];
const borrower = w.mps[1], boTok = w.T[1];

const supply = () => call('/api/economy').then(r => Number(r.d.supply));
const balOf = t => call('/api/economy/me', { token: t }).then(r => Number(r.d.account.balance));

/* --------------------------------------------------------- the Treasury */

console.log('\n-- the Treasury');

// There is no Prime Minister in the seeded world, so the President appoints.
ok((await call('/api/treasury/appoint', { method: 'POST', body: { user_id: treas.id }, token: bkTok })).status === 403,
  'an ordinary citizen cannot appoint a Treasurer');
ok((await call('/api/treasury/appoint', { method: 'POST', body: { user_id: treas.id }, token: w.spk })).status === 403,
  'nor can the Speaker');
ok((await call('/api/treasury/appoint', { method: 'POST', body: { user_id: treas.id }, token: w.pres })).status === 200,
  'the President appoints one where there is no Prime Minister');

ok((await call('/api/treasury/appoint', { method: 'POST', body: { user_id: w.mps[1].id }, token: w.pres })).status === 400,
  'Article 7.1: a sitting MP cannot also hold the Treasury');

ok((await call('/api/treasury/currency', { method: 'POST', body: { currency_name: 'Sovereign', currency_symbol: '§' }, token: bkTok })).status === 403,
  'only the Treasurer names the money');
ok((await call('/api/treasury/currency', { method: 'POST', body: { currency_name: 'Sovereign', currency_symbol: '§' }, token: tTok })).status === 200,
  'the Treasurer names the money');
ok((await call('/api/treasury')).d.currency.name === 'Sovereign', 'and the Republic calls it that');

ok((await call('/api/treasury/ownership-cap', { method: 'POST', body: { ownership_cap: 0.3 }, token: tTok })).status === 200,
  'the Treasurer fixes the ownership cap (Part 5.18)');
ok((await call('/api/treasury/ownership-cap', { method: 'POST', body: { ownership_cap: 4 }, token: tTok })).status === 400,
  'and it must be a share, not a multiple');

ok((await call('/api/treasury/statement', { method: 'POST', body: { body: 'Taken this cycle: nothing. Spent: the dividend.' }, token: tTok })).d.ref === 'T001',
  'the Treasurer reports to the House as T001');
ok((await call('/api/treasury/statement', { method: 'POST', body: { body: 'x' }, token: tTok })).status === 400,
  'a statement of one character is not a statement');

/* -------------------------------------------------------------- the Fed */

console.log('\n-- the Fed');

ok((await call('/api/fed/nominate', { method: 'POST', body: { user_id: fed.id }, token: w.spk })).status === 403,
  'the Speaker does not nominate the head of the Fed');
ok((await call('/api/fed/nominate', { method: 'POST', body: { user_id: fed.id }, token: w.pres })).status === 200,
  'the President nominates');
ok(!(await call('/api/fed')).d.chair, 'a nomination alone leaves the office empty (21.8)');
ok((await call('/api/fed/rates', { method: 'POST', body: { loan_rate: 0.9, reasons: 'because I can' }, token: fTok })).status === 403,
  'and a nominee has no powers yet');

ok((await call('/api/fed/confirm', { method: 'POST', token: bkTok })).status === 403, 'a citizen outside the House cannot confirm');
let conf = {};
for (const t of w.T) {
  conf = (await call('/api/fed/confirm', { method: 'POST', token: t })).d;
  if (conf.confirmed) break;   // the office is filled on the majority, not on the last vote
}
ok(conf.confirmed === true, `the House confirms at ${conf.needed} of ${conf.house}`);
const fedState = (await call('/api/fed')).d;
ok(fedState.chair && fedState.chair.id === fed.id, 'the office is filled');
ok(!!fedState.term_ends, 'for a fixed term of three cycles — longer than the President who chose them');

ok((await call('/api/fed/resign', { method: 'POST', token: w.pres })).status === 403,
  'the President may not dismiss the head of the Fed (21.10)');
ok((await call('/api/fed/resign', { method: 'POST', token: w.spk })).status === 403, 'nor may the Speaker');

console.log('\n-- nobody sets the rate of interest but the Fed');

ok((await call('/api/fed/rates', { method: 'POST', body: { loan_rate: 0.5, reasons: 'a president needs cheap money' }, token: w.pres })).status === 403,
  'the President cannot set the rate of interest');
ok((await call('/api/fed/rates', { method: 'POST', body: { loan_rate: 0.5, reasons: 'the House wills it' }, token: w.T[1] })).status === 403,
  'nor can a member of the House');

// A rule bill is the House trying the same thing with a vote attached.
const billed = (await call('/api/bills', {
  method: 'POST',
  body: { title: 'Interest Rate Act', kind: 'rule', body: 'loan_rate = 0.5' },
  token: w.T[0]
})).d;
ok(/loan_rate/.test(String(billed.error || '')) || billed.status === 400 || !billed.id,
  'and a rule bill cannot do it either — the rate is not legislatable');

ok((await call('/api/fed/rates', { method: 'POST', body: { loan_rate: 0.08 }, token: fTok })).status === 400,
  'the Fed itself must publish reasons (21.12)');
const rateRef = (await call('/api/fed/rates', {
  method: 'POST',
  body: { loan_rate: 0.08, deposit_rate: 0.03, reasons: 'Credit is tightening and deposits are thin.' },
  token: fTok
})).d;
ok(rateRef.ok && rateRef.ref === 'F001', 'with reasons, the Fed sets it — recorded as F001');
ok((await call('/api/fed')).d.rates.loan_rate === 0.08, 'and the rate follows');
ok((await call('/api/fed')).d.decisions[0].reasons.length > 10, 'the reasons are on the public record');

console.log('\n-- the money supply');

const before = await supply();
ok((await call('/api/fed/issue', { method: 'POST', body: { amount: 40000, reasons: 'The Treasury cannot meet the dividend.' }, token: w.pres })).status === 403,
  'the President cannot print money');
ok((await call('/api/fed/issue', { method: 'POST', body: { amount: 40000, reasons: 'The Treasury cannot meet the dividend.' }, token: fTok })).status === 200,
  'the Fed issues to the Treasury');
ok(await supply() === before, 'and the ledger still balances — sum(balance) is unchanged');
const issued = (await call('/api/fed')).d.issued;
ok(issued === 40000, 'the issue is visible as the Fed\'s own negative balance');
ok((await call('/api/fed/retire', { method: 'POST', body: { amount: 1000, reasons: 'Withdrawing what is not needed.' }, token: fTok })).status === 200,
  'and takes money back out of circulation');
ok((await call('/api/fed')).d.issued === issued - 1000, 'the supply falls');
ok(await supply() === before, 'still balanced');
ok((await call('/api/fed/retire', { method: 'POST', body: { amount: 10 ** 9, reasons: 'Retiring what was never issued.' }, token: fTok })).status === 400,
  'and the Fed cannot retire money the Treasury does not hold');

console.log('\n-- the Fed and the economy');

ok((await call('/api/economy/businesses', { method: 'POST', body: { name: 'Chair Holdings' }, token: fTok })).status === 403,
  'the head of the Fed may found no business');

/* ------------------------------------------------------- private banks */

console.log('\n-- private banks');

ok((await call('/api/banks', { method: 'POST', body: { name: 'Fed Bank', capital: 500 }, token: fTok })).status === 403,
  'nor may they own a bank they would license');
ok((await call('/api/banks', { method: 'POST', body: { name: 'Thin Bank', capital: 10 }, token: bkTok })).status === 400,
  'a bank opens with real capital or not at all');

const bank = (await call('/api/banks', { method: 'POST', body: { name: 'First Republic', capital: 1000, prospectus: 'Deposits and small loans.' }, token: bkTok })).d;
ok(bank.status === 'applied', 'a citizen applies for a licence');
ok(bank.reserves === 1000, 'the capital is paid in');
ok((await call(`/api/banks/${bank.id}/deposit`, { method: 'POST', body: { amount: 100 }, token: svTok })).status === 400,
  'an unlicensed bank takes no deposits');

ok((await call(`/api/banks/${bank.id}/licence`, { method: 'POST', body: { reasons: 'Adequately capitalised.' }, token: w.pres })).status === 403,
  'the President does not license banks');
ok((await call(`/api/banks/${bank.id}/licence`, { method: 'POST', body: {}, token: fTok })).status === 400,
  'and the Fed cannot license one without reasons');
ok((await call(`/api/banks/${bank.id}/licence`, { method: 'POST', body: { reasons: 'Adequately capitalised and the prospectus is sound.', reserve_ratio: 0.1 }, token: fTok })).d.ok,
  'the Fed licenses it, at a reserve ratio of the Fed\'s choosing');

ok((await call(`/api/banks/${bank.id}/rates`, { method: 'POST', body: { deposit_rate: 0.04, loan_rate: 0.1 }, token: svTok })).status === 403,
  'only the licensee sets its rates');
ok((await call(`/api/banks/${bank.id}/rates`, { method: 'POST', body: { deposit_rate: 0.04, loan_rate: 0.1 }, token: bkTok })).status === 200,
  'a licensed bank sets its own rates');

ok((await call(`/api/banks/${bank.id}/deposit`, { method: 'POST', body: { amount: 600 }, token: svTok })).status === 200, 'a citizen deposits 600');
let view = (await call('/api/banks', { token: svTok })).d.banks[0];
ok(view.my_deposit === 600 && view.deposits === 600, 'the deposit is recorded');
ok(view.reserves === 1600, 'and held');

// The reserve is a tenth of 600 = 60, against 1600 held. A loan of 1560 would
// leave 40 and is refused; 1500 leaves 100 and is not.
ok((await call(`/api/banks/${bank.id}/borrow`, { method: 'POST', body: { amount: 1560, cycle_no: 1 }, token: boTok })).status === 400,
  'the bank may not lend past the reserve the Fed fixed (Part 4.14)');
const loan = (await call(`/api/banks/${bank.id}/borrow`, { method: 'POST', body: { amount: 1500, cycles: 1, cycle_no: 1 }, token: boTok })).d;
ok(!!loan.id, 'and lends within it');

const owedBefore = Number(loan.outstanding);
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 2, dividend: false, salaries: false, tax: false, interest: false }, token: T });
view = (await call('/api/banks', { token: svTok })).d.banks[0];
ok(view.my_deposit === 624, `depositors earn the bank's rate (600 → ${view.my_deposit})`);
const owedAfter = (await call('/api/banks', { token: boTok })).d.banks[0].my_loans[0].outstanding;
ok(Number(owedAfter) === owedBefore + 150, `borrowers pay it (${owedBefore} → ${owedAfter})`);

await call(`/api/banks/${bank.id}/repay`, { method: 'POST', body: { loan_id: loan.id, amount: 200 }, token: boTok });
ok(Number((await call('/api/banks', { token: boTok })).d.banks[0].my_loans[0].outstanding) === Number(owedAfter) - 200,
  'repayment reduces the debt');

console.log('\n-- a bank fails');

const balBefore = await balOf(svTok);
const bankerBefore = await balOf(bkTok);
const supplyBefore = await supply();
ok((await call(`/api/banks/${bank.id}/close`, { method: 'POST', body: { reasons: 'Reserves are unsound.' }, token: bkTok })).status === 403,
  'a banker cannot close their own bank to escape it');
const closed = (await call(`/api/banks/${bank.id}/close`, { method: 'POST', body: { reasons: 'Reserves are unsound and the prospectus was not met.' }, token: fTok })).d;
ok(closed.ok, 'the Fed closes it');
ok(closed.paid === 300, `the depositor is paid ${closed.paid} out of what the bank actually had`);
ok(closed.guaranteed === 200, `and the Treasury makes them up to the guarantee (${closed.guaranteed})`);
ok(await balOf(svTok) === balBefore + 500, 'the depositor recovers 500 of the 624 they were owed — a guarantee is a cap, not a promise');
ok(await balOf(bkTok) === bankerBefore, 'the founder gets nothing back: the capital is gone');
ok((await call('/api/banks', { token: svTok })).d.banks[0].my_deposit === 0, 'and the claim is cleared');
ok((await call(`/api/banks/${bank.id}/deposit`, { method: 'POST', body: { amount: 10 }, token: svTok })).status === 400,
  'a closed bank takes nothing more');
ok(await supply() === supplyBefore, 'winding a bank up creates no money');
ok((await call('/api/banks', { token: boTok })).d.banks[0].my_loans[0].status === 'default',
  'and the debts survive the lender');
ok((await call(`/api/banks/${bank.id}/repay`, { method: 'POST', body: { loan_id: loan.id, amount: 50 }, token: boTok })).status === 200,
  'a borrower may still repay — now to the Treasury, which paid the guarantee');

/* ----------------------------------------------- the Returning Officer */

/* The RO runs the machinery and holds no office. They may set any value on the
   admin page — that is their job — but they may not seat, unseat or act as an
   officer, and the money offices are where that distinction bites hardest. */
console.log('\n-- the Returning Officer holds no office');

ok((await call('/api/admin/office', { method: 'POST', body: { user_id: w.mps[2].id, office: 'fed_chair' }, token: T })).status === 403,
  'the RO cannot seat a head of the Fed the House never confirmed');
ok((await call('/api/admin/office', { method: 'POST', body: { user_id: fed.id, office: 'fed_chair', remove: true }, token: T })).status === 403,
  'nor unseat the one it did');
ok((await call('/api/fed')).d.chair.id === fed.id, 'and the chair is still there afterwards');
ok((await call('/api/admin/office', { method: 'POST', body: { user_id: w.mps[2].id, office: 'treasurer' }, token: T })).status === 403,
  'the RO cannot appoint a Treasurer either — that is the government\'s');

ok((await call('/api/fed/rates', { method: 'POST', body: { loan_rate: 0.4, reasons: 'The Returning Officer says so.' }, token: T })).status === 403,
  'and cannot act as the Fed');
ok((await call('/api/fed/issue', { method: 'POST', body: { amount: 100, reasons: 'The Returning Officer says so.' }, token: T })).status === 403,
  'nor print money');
ok((await call('/api/treasury/currency', { method: 'POST', body: { currency_name: 'Chit', currency_symbol: 'C' }, token: T })).status === 403,
  'nor rename the money');
ok((await call('/api/treasury/statement', { method: 'POST', body: { body: 'The Returning Officer reports to the House.' }, token: T })).status === 403,
  'nor report to the House in the Treasury\'s name');
ok((await call('/api/banks', { method: 'POST', body: { name: 'RO Bank', capital: 300 }, token: T })).status === 200,
  'but the RO is a citizen and may open a bank like anyone');
ok((await call('/api/banks/3/licence', { method: 'POST', body: { reasons: 'The Returning Officer licenses their own bank.' }, token: T })).status === 403,
  'and cannot license it themselves');

// The other half of the same principle: the admin page still works.
ok((await cfg({ deposit_guarantee: '400' })).status === 200, 'the RO may still edit any value on the admin page');
ok((await call('/api/banks')).d.guarantee === 400, 'and the change takes');

console.log('\n-- salaries');
await call('/api/economy/payrun', { method: 'POST', body: { cycle_no: 3, dividend: false, tax: false, interest: false, banks: false }, token: T });
const runs = (await call('/api/economy/payruns')).d;
ok(runs.some(r => r.kind === 'salary' && r.cycle_no === 3), 'the payrun pays the two new offices with the rest');

report();
