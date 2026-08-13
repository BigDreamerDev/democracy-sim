# The Treasury and the Fed

Part 6 and Part 7 of the Creation of an Economy Act, and Article 21 of the
Electoral Reform Act, built.

Two money offices, on purpose. One belongs to the government and falls with it.
The other belongs to nobody and outlasts whoever filled it. Almost every design
decision below follows from keeping those two things apart.

---

## The Treasurer

| | |
|---|---|
| **Appointed by** | the Prime Minister, or the President where there is no PM |
| **Removed by** | the same person, or by resigning |
| **Term** | none — they serve at pleasure |
| **Seat** | one, under Article 7.1, like any other office |

**They may:** name the currency and its symbol; fix the ownership cap (Part
5.18); publish a statement of account to the House (Part 6.20).

**They may not:** create money (Part 6.22 — there is no endpoint, not even a
guarded one); set a rate of tax (that is the House's, on the President's
proposal, under 21.1–21.3); set the rate of interest (that is the Fed's).

The Treasury balance is allowed to be negative. The dividend is unconditional,
so it cannot be contingent on the state being solvent — a floor that switches off
in bad weather is not a floor.

## The head of the Fed

| | |
|---|---|
| **Nominated by** | the President |
| **Confirmed by** | the House, simple majority (21.8) |
| **Term** | three cycles — `fed_terms`, deliberately longer than the office that appointed it (21.9) |
| **Removed by** | impeachment at two thirds, or by resigning. **Nothing else.** |

**They may:** set the rate on deposits, the rate on loans, the borrowing ceiling
and the reserve ratio; issue money to the Treasury and retire it; license,
refuse and close banks.

**They must:** publish reasons for every one of those decisions (21.12). The
`reasons` column is NOT NULL and the endpoints refuse a short one. A decision
without a reason cannot be recorded at all.

**They may not:** hold any business interest — no membership, no shareholding,
no open order. Checked on confirmation and again whenever the sitting chair
tries to found a business or place an order. Whoever sets the price of money must
not be able to profit by it.

### What independence actually consists of

There is **no dismissal endpoint**. Not for the President who nominated them, not
for the House, not for the Prime Minister or the Speaker. The rates are out of
`LEGISLATABLE`, so a rule bill cannot reach them either — a bill setting the rate
of interest is the House instructing the Fed with a vote attached, which 21.10
forbids in terms.

The Fed is independent of the *officers*, never of the *Citizens*: a
supermajority under Article 2 may remove any officer, and may abolish the Fed
outright (21.13).

Expect the first real fight to be a chair who outlasts the President who
appointed them and will not cut rates before an election. That fight is the
feature.

---

## Money supply

The Fed creates money by paying the Treasury from its own account, which goes
negative by exactly that much. That negative balance **is** the money supply, and
it is what a central bank's balance sheet actually looks like.

Nothing is ever inserted onto a balance from nowhere, so `sum(accounts.balance)`
stays 0 and the invariant the foreign-trade suite guards is untouched.

- `/api/fed/issue` — Fed → Treasury. Supply rises.
- `/api/fed/retire` — Treasury → Fed. Supply falls, and only as far as the
  Treasury actually holds. The Fed cannot hand back what the Republic never had.

`/api/treasury` reports `circulating`: everything held by citizens, businesses
and banks. The sum of *all* accounts is always zero and tells you nothing.

---

## Banks

The public bank (economy.js, Part 4.11) is unchanged. Private banks are new.

1. **Any citizen applies** — `POST /api/banks` with a name, a prospectus and
   capital of at least `bank_charter_fee`. The capital is paid in on application.
2. **The Fed decides**, with reasons. A licence carries a reserve ratio of the
   Fed's choosing. A refusal returns the capital in full — a refusal is not a
   fine.
3. **A licensed bank sets its own rates.** That is what licensing them is for.
4. **It may not lend past its reserve** (Part 4.14). Checked against what the
   bank would hold *after* the loan, or the ratio would be advisory.
5. **It can fail.** The Fed closes it, with reasons. Then:
   - depositors are paid pro rata out of whatever the bank actually has;
   - the Treasury tops each of them up to `deposit_guarantee`;
   - **a depositor above the guarantee loses the difference**;
   - **the founder loses everything they put in**;
   - outstanding loans do not vanish. They fall into default and are repayable to
     the Treasury, which just paid the guarantee.

A guarantee is a cap, not a promise, and a bank whose owner risks nothing is a
subsidy rather than a bank. Both of those are deliberate and the test suite
asserts the exact figures.

---

## Settings

| Key | Who may change it |
|---|---|
| `currency_name`, `currency_symbol` | Treasurer (also legislatable) |
| `ownership_cap` | Treasurer (also legislatable) |
| `deposit_rate`, `loan_rate`, `loan_ceiling`, `reserve_ratio` | **the Fed alone** — not legislatable |
| `fed_terms`, `bank_charter_fee`, `deposit_guarantee` | the House, by rule bill |
| `salary_treasurer`, `salary_fed_chair` | the House, by rule bill |

The Returning Officer can still write any setting through `/api/admin/config`.
That is the pre-existing admin seam, not a new one.

---

## Endpoints

```
GET  /api/treasury                      accounts, flows, statements
POST /api/treasury/appoint              PM, or President where there is none
POST /api/treasury/dismiss              the same, or the Treasurer resigning
POST /api/treasury/currency             Treasurer
POST /api/treasury/ownership-cap        Treasurer
POST /api/treasury/statement            Treasurer

GET  /api/fed                           chair, term, rates, supply, the record
POST /api/fed/nominate                  President
POST /api/fed/confirm                   House — the office is written on the majority
POST /api/fed/refuse                    Speaker
POST /api/fed/resign                    the chair, and nobody else
POST /api/fed/rates                     chair; reasons required
POST /api/fed/issue                     chair; reasons required
POST /api/fed/retire                    chair; reasons required

GET  /api/banks                         every bank, plus your own position at each
POST /api/banks                         any citizen; capital paid in
POST /api/banks/:id/licence             Fed; reasons required
POST /api/banks/:id/refuse              Fed; reasons required, capital returned
POST /api/banks/:id/close               Fed; reasons required
POST /api/banks/:id/rates               the licensee
POST /api/banks/:id/deposit|withdraw    any citizen
POST /api/banks/:id/borrow|repay        any citizen
```

Private-bank interest runs with the rest of the payrun, as `banks` in the
`/api/economy/payrun` result. Pass `banks: false` to skip it.

---

## Tests

- `server/test/money.mjs` — 60-odd assertions, in `npm test`. The ones worth
  knowing: no officer can set the rate of interest, by endpoint or by bill; a
  nomination without confirmation is of no effect; issuing does not break
  `sum(balance) = 0`; a bank cannot lend past its reserve; a failed bank costs
  its founder everything and its depositors the shortfall above the guarantee.
- `server/test/money-view.js` — in `npm run test:layout`. Asserts the *front end*
  never offers a dismiss control for the Fed, or a rates form to anyone but its
  head.
