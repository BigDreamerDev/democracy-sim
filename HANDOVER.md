# Handover — the Republic

Paste this into a new chat to pick up where we left off.

## What it is

A parliamentary democracy simulator for a WhatsApp group of ~19 people, called
**McServerLandia**. Static front end on GitHub Pages (`docs/`), Express API on
Render (`server/`), Postgres on Neon. Real elections, bills, statute book,
constitution, Supreme Court, economy.

Owner is **Uzair**, who is the Returning Officer (admin username `admin`) and
also plays. Travelling for a week with **only an iPad and phone** — so changes
must be paste-sized, `docs/` changes preferred over server ones, and no schema
migrations without a Neon snapshot first.

## Current state

**One build**, packaged as `republic-core.zip`. 14 test suites, all green. The
earlier branch divergence (core vs full) is resolved; diplomacy is deliberately
excluded and lives only in an older tree.

Built and tested: elections with a cycle clock · bills, laws, constitution
versions · initiatives and referendums · impeachment · Supreme Court · economy
(money, progressive tax, businesses, escrow, public bank, share market with an
order book) · **the Treasury and the Fed as offices, with currency naming,
money issuance, and licensed private banks that can fail** · Article 2 citizens' supermajority · Article 12 emergency powers ·
Prime Minister · flag-derived theming · dark mode · PWA install · widget
endpoints (`/api/widget.svg`, `.png`, `.json`) · the desk (per-office to-do list).

**Deployed to the live instance:** unclear — Uzair has been deferring pushes.
Assume the live server is older than the repo and confirm before assuming a
feature exists in production.

## Offices and who does what

| | |
|---|---|
| **President** | elected by all. Appoints the PM. Assents to constitutional and electoral bills only. Declares Article 12 emergencies. |
| **Prime Minister** | appointed by the President, confirmed by a House majority, removed by House no-confidence. Assents to ordinary bills. |
| **Speaker** | two thirds of the House, bar falling one vote per failed ballot to a simple majority. Tables bills, calls and closes divisions, **holds the casting vote on ties**. |
| **House (MPs)** | proposes, seconds, votes in divisions. `bill_proposers = mps` by default. |
| **Justices** ×3 | House seat filled by the Speaker, President's by themselves, **People's by a ballot of every Citizen**. Fixed terms (`justice_terms` x `cycle_days`, a fortnight by default) that now actually expire — the clock retires them and opens the next ballot. |
| **Treasurer** | appointed by the PM (or the President where there is none), dismissable by them. Names the currency, fixes the ownership cap, reports to the House. May not create money or set a tax. |
| **Head of the Fed** | nominated by the President, confirmed by the House, **three cycles**, removable only by impeachment. Sets the rate of interest, issues and retires money, licenses and closes banks. Publishes reasons for everything. Holds no business interest. |
| **Returning Officer** | admin. Runs invites, approvals, rules, elections, appointments. **Holds no office and cannot act in one** — deliberately removed. May edit any setting on the admin page, but `/api/admin/office` refuses `treasurer` and `fed_chair`, and on the Court they fill only the People's seat. |

Article 7.1 (one seat each) is enforced; Speaker+MP count as one seat. Article
7.4 resignation exists.

## Outstanding

1. **Election ties are still decided by display-name order** — a real bug. Display
   names are user-editable, so it is gameable. Agreed fix: leave the contested
   seat vacant and re-run. The Speaker's casting vote covers divisions, not
   elections.
2. `term_days` is a dead setting read by nothing.
3. Diplomacy (foreign LLM powers) exists in an older tree, unmerged.
4. `HANDBOOK.md` is stale — it predates the PM, the Treasury and the Fed.
   `CLAUDE.md`, `MONEY.md` and `docs-src/` are current.

## Decisions worth not relitigating

- **Treaties, recognition and emergencies arrive as bills.** Nothing binds the
  Republic without a vote.
- **`require_approval` and `allow_open_signup` are not legislatable** — a
  temporary majority could otherwise admit sockpuppets and hold every majority
  after. The one deliberate breach of "a supermajority may change anything".
- **The whip records, never compels.** Any mechanism that binds a vote destroys
  one-person-one-vote.
- **Foreign powers hold real accounts** so trade moves money rather than minting
  it. `sum(accounts.balance)` must always be 0.
- **The casting vote sits with the Speaker, not the PM**, so nobody breaks a tie
  and then assents to the result.
- **There is no way to dismiss the head of the Fed** — not by the President who
  nominated them, not by rule bill. That is the office. See `MONEY.md`.
- **A failed bank costs its founder everything**, and its depositors whatever
  they held above the guarantee. A bank nobody can lose money on is not a bank.
- **Editing a setting is not holding an office.** The RO keeps the whole admin
  page, including the Fed's rates, because someone has to be able to fix a typo
  and every write is logged. What they lost is the ability to seat or unseat a
  Treasurer or a Fed chair, and to fill the House's and President's seats on the
  Court.

## Traps that have already caused bugs

- A **constitutional bill replaces the entire constitution** — its body becomes
  the whole new text.
- `bigint` params need explicit `::bigint` casts or Postgres refuses.
- **Escrow is a separate account** from the Treasury, which runs a deficit.
- The **electoral roll freezes at `opened_at`**; reopening a poll without clearing
  it disenfranchises later joiners.
- **Re-anchoring the cycle clock mints duplicate elections.** Set the anchor once.
- `campaign_at` in the past closes nominations early.
- UA `[hidden]` loses to any author CSS rule — `[hidden]{display:none!important}`
  must stay.
- **A mismatched `ALLOWED_ORIGINS` returns 200 with no CORS header**, so the
  server looks healthy while the site fails.
- **economy.js must mount before money.js** — the Treasury and the Fed borrow the
  ledger primitives off the shared context. Reorder and both answer 503.
- **Issuing money cannot go through `pay()`**, which refuses an overdraft; the
  Fed's account is meant to be overdrawn. `issue()` writes both sides itself.
- **A division never closes itself.** The Speaker must close it before assent
  appears — this has already confused the players once.

## How to work

```
cd server
npm install
npm run dev            # localhost:4321, seeded, nothing deployed
npm test               # 14 suites, fresh DB each
npm run test:layout    # 6 frontend checks
```

Read `CLAUDE.md` before changing code, and `MONEY.md` before touching the
Treasury or the Fed. Tests have caught more real bugs here than
reading has — run them after any server change.
