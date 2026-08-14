# The Republic — system reference

Complete documentation of how the thing works. For playing it, read [HANDBOOK.md](../HANDBOOK.md); for deploying it, [SETUP.md](../SETUP.md).

---

## 1. Shape

```
GitHub Pages ──HTTPS──> Render ──> Postgres
  docs/                 server/      the state
  (nothing trusted)     (all rules)  (the truth)
```

The front end enforces nothing. Every rule is checked again server-side, and the checks that matter are database constraints rather than code.

```
server/
├── server.js         core: auth, elections, bills, laws, constitution, the clock
├── judiciary.js      the Supreme Court        (optional module)
├── economy.js        money, tax, trade, bank, shares (optional module)
├── money.js          the Treasury, the Fed, private banks (optional module)
├── diplomacy.js      foreign powers, treaties, the world map (optional module)
├── llm/providers.js  model calls for foreign cabinets; free tiers by default
├── schema.sql        core tables
├── schema-acts.sql   court and economy tables
├── schema-money.sql  Treasury, Fed and private-bank tables
├── schema-diplomacy.sql foreign powers, cabinets, territories
├── dev.js            local preview, in-memory database
└── test/             fourteen suites, each on a fresh database

docs/
├── index.html
├── config.js         API_BASE — the only file you edit after deploying
├── app.js            core UI + window.Republic hook
├── acts.js           Court and Economy pages
├── money.js          Treasury and Fed pages
├── world-map.js      precomputed SVG country paths (see below)
└── styles.css
```

The four modules are mounted by name at the bottom of `server.js`, in the order `judiciary`, `diplomacy`, `economy`, `money`. If a file is absent the server logs it and carries on, so any of them can be removed without touching anything else — but the order matters in one direction: `money.js` borrows the ledger primitives (`pay`, `accountFor`, the Treasury and escrow accounts) off the shared context, which `economy.js` sets as its last act. Without the economy there is no currency, so the Treasury and the Fed answer `503` rather than pretending.

---

## 2. Guarantees

These are enforced by Postgres, not by application code, and cannot be raced or bypassed:

| Rule | Mechanism |
|---|---|
| One vote per citizen per election | `UNIQUE (election_id, voter_id)` |
| One vote per member per division | `PRIMARY KEY (bill_id, user_id)` |
| One vote per citizen per referendum | `PRIMARY KEY (election_id, user_id)` |
| One party membership each | `PRIMARY KEY (user_id)` |
| One signature per petition | `PRIMARY KEY (law_id, user_id)` |
| One opinion per Justice per case | `PRIMARY KEY (case_id, user_id)` |
| No negative shareholdings | `CHECK (qty >= 0)` |

And two invariants the test suites assert after every operation:

- **The ledger sums to zero.** Money is only ever moved between accounts, never created — including when the Fed issues, which pays the Treasury from the Fed's own account and drives that account negative rather than conjuring a balance. `SELECT sum(balance) FROM accounts` is always 0 — including across foreign trade, because a foreign power holds a real account (`owner_kind='power'`) funded from our own Treasury. An export moves money from the power to a business; an import moves it back. Nothing is minted at the border.
- **Shares are conserved.** A business's holdings always total exactly `shares_issued`.

---

## 3. Data model

**Core.** `users` · `invites` · `config` · `parties` · `party_members` · `elections` · `candidacies` · `votes` · `referendum_votes` · `petitions` · `offices` · `bills` · `bill_seconds` · `bill_votes` · `bill_petitions` · `comments` · `laws` · `constitution` · `audit`

**Court.** `court_seats` · `cases` · `case_votes`

**Economy.** `accounts` · `ledger` · `businesses` · `business_members` · `listings` · `orders` · `payruns` · `declarations` · `deposits` · `loans` · `holdings` · `share_orders` · `trades`

**Treasury and Fed.** `fed_nominations` · `fed_confirmations` · `fed_decisions` · `treasury_statements` · `banks` · `bank_deposits` · `bank_loans`

**Intelligence (framework only).** `intel_service` · `intel_clearance` · `intel_reports` · `intel_reads`. The body of a report is sealed for `declassify_after_cycles` cycles and nothing else about it ever is — not its existence, not who filed it, not who read it. Declassification is a clock nobody approves and nobody can stop. See [../INTELLIGENCE-AND-WAR.md](../INTELLIGENCE-AND-WAR.md).

**War (supply).** `stockpile` · `stockpile_movements` · `formations` · `upkeep_runs` · `conflict_pressure` · `conflict_log`, plus `powers.strength`. There are no unit positions, no orders and no movement: a formation has a size and a readiness, and where it is and what it is doing are things players say to each other. Every change to the stockpile is a signed movement row, so the quantity is a running total of a record — the same discipline as the ledger, for the same reason.

**Diplomacy.** `powers` · `territories` · `foreign_dispatches` · `treaties` · `foreign_offers` · `conflicts` · `foreign_memories` · `foreign_governments` · `foreign_agents` · `foreign_government_turns` · `foreign_agent_proposals` · `foreign_agent_votes`

- **A territory belongs to at most one power**, held by the primary key on `territories.code`. Two powers cannot claim the same ground and no application code checks for it. Unclaimed territory is an absent row, not a neutral power — a neutral power would need an account, a standing and a cabinet, and the map would open by lying about how many states exist.
- **A foreign power holds a real account** (`owner_kind = 'power'`), funded by transfer from the Treasury. Trade with abroad moves money; it never mints it. `circulating` on `/api/treasury` and `/api/fed` therefore excludes `power` alongside `treasury` and `fed`.

Notes that matter:

- **`offices` is the single source of truth for who holds what.** `president`, `prime_minister`, `speaker`, `mp`, `justice`, `treasurer`, `fed_chair`, `foreign_minister`.
- **The Foreign Minister holds the channel abroad and binds nothing.** Appointed by the Prime Minister, or by the President where there is none, exactly like the Treasurer. While the office is filled the President may *not* send dispatches — they assent to treaties, and negotiating what you then assent to is one person doing both halves. Treaties, recognition and emergencies still arrive as bills. Impeachment, the citizens list, the chamber and every permission check read this one table. `court_seats` records only who is *entitled* to fill each seat and is reconciled against `offices` on read.
- **`accounts` has seven owner kinds:** `citizen`, `business`, `treasury`, `fed`, `bank`, `escrow`, `power`. Escrow is separate from treasury on purpose — the Treasury runs a deficit paying the dividend, and money held for a buyer must never be caught in that. The public bank is `bank` with a null `owner_id`; a licensed private bank is `bank` with its `banks.id`.
- **The Fed's balance is the money supply, negatively.** Issuance pays the Treasury from the Fed's account, which goes below zero by exactly that much. `sum(balance)` therefore stays 0 and the ledger invariant is untouched — but it also means the sum tells you nothing about how much money exists. For that, read `circulating` on `/api/treasury` or `/api/fed`: everything held by citizens, businesses and banks.
- **`deposits` and `loans` belong to the public bank only.** Private banks have `bank_deposits` and `bank_loans`, keyed by bank. This is why `schema-money.sql` adds no column to either of the originals and needs no migration.
- **Nothing is deleted.** Repealed laws keep `repealed_at`. Failed bills keep their result. Superseded constitutions keep their version.

---

## 4. Authentication

`POST /api/auth/login` returns a JWT carrying `{ id, tv }` — the user id and a token version. `users.token_version` increments on any password change or admin reset, which invalidates every token issued before it.

```
Authorization: Bearer <token>
```

A request is authenticated only if the user is `is_active`, `approved`, and the token's `tv` matches the row. New accounts are inert until an admin approves them.

---

## 5. Endpoints

### Public

| | |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/state` | everything the front page needs: config, cycle, flag, offices, parties, open elections, live bills, stats |
| `GET /api/citizens` | the roll (approved, active only) |
| `GET /api/constitution` | current version and history |
| `GET /api/laws` | in force; `?all=1` includes repealed |
| `GET /api/flag` | parsed flag from the Flag Act |
| `GET /api/audit` | the public record, most recent 200 |
| `GET /api/digest` | plain-text state of the union, for pasting into the chat |
| `GET /api/parties` · `GET /api/elections` · `GET /api/elections/:id` · `GET /api/bills` · `GET /api/bills/:id` | |

### Account

`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/me` · `PUT /api/me` · `POST /api/me/password`

### Elections

| | |
|---|---|
| `POST /api/elections` | admin. Kinds: `parliament`, `president`, `speaker`, `justice`, `referendum` |
| `POST /api/elections/:id/stand` | status must be `nominations` |
| `POST /api/elections/:id/withdraw` | refused once the poll opens |
| `POST /api/elections/:id/vote` | `{ candidacy_id }` |
| `POST /api/elections/:id/referendum` | `{ choice }` — `keep`/`reject` on a law, `enact`/`reject` on an initiative |
| `POST /api/elections/:id/status` | admin. `nominations` \| `voting` \| `closed`. Closing certifies |

### Bills

| | |
|---|---|
| `PATCH /api/bills/:id` | the proposer, while `draft`, `tabled` or `petition`. **Clears the seconds** — a signature was for the text signed |
| `POST /api/bills/:id/withdraw` | the proposer, same window. Sets `withdrawn`; the row is kept, never deleted |


| | |
|---|---|
| `POST /api/bills` | House only by default (`bill_proposers`) |
| `POST /api/initiatives` | any citizen; starts at status `petition` |
| `POST /api/bills/:id/sign` | signatures on an initiative |
| `POST /api/bills/:id/second` | not your own |
| `POST /api/bills/:id/table` · `/division` · `/close` | Speaker |
| `POST /api/bills/:id/vote` | `{ vote: aye \| no \| abstain }` |
| `POST /api/bills/:id/assent` | President. `{ veto: true }` to refuse |
| `POST /api/bills/:id/override` | Speaker, only if `allow_veto_override` |
| `POST /api/laws/:id/petition` | sign for a referendum to strike a law |

### Court

`GET /api/court` · `POST /api/court/seats/:seat` · `POST /api/court/seats/:seat/vacate` · `POST /api/court/cases` · `GET /api/court/cases/:id` · `POST /api/court/cases/:id/opinion` · `POST /api/court/cases/:id/withdraw`

### Economy

`GET /api/economy` · `GET /api/economy/me` · `POST /api/economy/transfer` · `POST /api/economy/payrun` (admin) · `GET /api/economy/payruns` · `POST /api/economy/declare` · `GET /api/economy/declarations`

**Enterprise:** `POST /api/economy/businesses` · `GET /api/economy/businesses/:id` · `POST /api/economy/businesses/:id/listings` · `GET /api/economy/market` · `POST /api/economy/listings/:id/buy` · `GET /api/economy/orders` · `POST /api/economy/orders/:id/confirm` · `/refund` · `/dispute`

**Bank:** `GET /api/economy/bank` · `POST /api/economy/bank/deposit` · `/withdraw` · `/borrow` · `/repay` · `POST /api/economy/bank/sue/:loan`

**Shares:** `POST /api/economy/businesses/:id/issue` · `GET /api/economy/businesses/:id/market` · `POST /api/economy/businesses/:id/order` · `POST /api/economy/orders/share/:id/cancel` · `POST /api/economy/businesses/:id/dividend`

### Treasury

| | |
|---|---|
| `GET /api/treasury` | accounts, flows by kind, statements, who the Treasurer is |
| `POST /api/treasury/appoint` | Prime Minister, or the President where there is none |
| `GET /api/diplomacy/foreign-office` | who the Foreign Minister is, and who appoints them |
| `POST /api/diplomacy/foreign-office/appoint` · `/dismiss` | the same rule as the Treasury |
| `GET /api/intel` · `POST /api/intel/reports/:id/read` | framework; the read writes an audit row as a condition of answering |
| `POST /api/treasury/dismiss` | the same, or the Treasurer resigning |
| `POST /api/treasury/currency` | Treasurer. `{ currency_name, currency_symbol }` |
| `POST /api/treasury/ownership-cap` | Treasurer. Part 5.18 gives them this, not the House |
| `POST /api/treasury/statement` | Treasurer. Part 6.20 — published to the House |

### The Fed

| | |
|---|---|
| `GET /api/fed` | chair, term, rates, supply in issue, the record of decisions |
| `POST /api/fed/nominate` | President. Refused while the office is filled |
| `POST /api/fed/confirm` | House. `{ support: false }` withdraws. The office is written on the majority, not before |
| `POST /api/fed/refuse` | Speaker |
| `POST /api/fed/resign` | the chair, and nobody else |
| `POST /api/fed/rates` | chair. `deposit_rate` · `loan_rate` · `loan_ceiling` · `reserve_ratio`. **`reasons` required** |
| `POST /api/fed/issue` | chair. Fed → Treasury. **`reasons` required** |
| `POST /api/fed/retire` | chair. Treasury → Fed, and only as far as the Treasury holds. **`reasons` required** |

**Banks:** `GET /api/banks` · `POST /api/banks` (any citizen) · `POST /api/banks/:id/licence` · `/refuse` · `/close` (Fed, reasons required) · `POST /api/banks/:id/rates` (the licensee) · `/deposit` · `/withdraw` · `/borrow` · `/repay`

### The world map

| | |
|---|---|
| `GET /api/diplomacy/map` | public. Every power with its standing, recognition, colour and territory codes |
| `PUT /api/admin/foreign/powers/:id/territories` | Returning Officer. `{ codes: [] }` replaces that power's holdings |

Real coastlines, invented countries. `docs/world-map.js` holds SVG path strings for 173 territories, projected at build time from Natural Earth 110m (via `world-atlas`, ISC, © Michael Bostock) with d3-geo's Natural Earth projection into a 1000×500 viewBox. The front end therefore needs no projection library, no TopoJSON client and no build step.

Territory codes are UN M49 numbers and are deliberately opaque. Real country names live in `TERRITORY_NAMES` in the same file and appear **only** in the Returning Officer's console, where somebody has to know which shape they are handing out. No player-facing surface renders them — `test/worldmap-view.js` asserts it, because one leaked "United States of America" collapses the whole conceit.

The map shows exactly two things. **Standing is the fill**, on a fixed cool-to-warm scale from allied to at war. **Recognition is the border**: solid if the Republic has recognised the power, dashed and hatched if it has not — the power is on the map because it exists, not because the House said so. Both colours are fixed hexes rather than theme variables, so a player switching to dark mode does not have to learn the map twice.

Territory is the Returning Officer's to draw, and no officer's. Nothing in the constitution says who could give away land, so nobody can; if conquest ever becomes a move the powers can make, it arrives as a bill like everything else. A territory another power already holds is refused with `409` rather than transferred, so redrawing a border takes two deliberate acts.

### Supply and upkeep

| | |
|---|---|
| `GET /api/war` | stockpile, forecast, formations, readiness, budget, upkeep history |
| `POST /api/war/quartermaster/appoint` · `/dismiss` | Prime Minister, or the President where there is none |
| `POST /api/war/procure/listing/:id` | Quartermaster. Buys from a domestic business at the asking price |
| `POST /api/war/procure/foreign/:id` | Quartermaster. Same, abroad, and the Republic pays its own import duty |
| `POST /api/war/formations` · `/:id/disband` | Quartermaster. Raising draws `raise_cost_arms` per unit from the stockpile |

The loop: the Quartermaster buys goods into the national stockpile, upkeep draws
food, energy and arms from it every cycle in the payrun, wages are paid to the
citizenry, and readiness falls by `readiness_fall` when any category is short and
recovers by the smaller `readiness_rise` when none is. Recovery being slower than
collapse is deliberate.

Procurement writes both sides of the movement directly rather than through
`pay()`, because the Treasury is normally overdrawn from the dividend and a
republic that could only buy rifles while in surplus would never buy any. What
limits it is `military_budget_per_cycle`, which the House sets by rule bill — so
a bigger army means asking the House for a bigger number, in public.

**Conflict pressure.** `GET /api/war/conflicts`. Every cycle, after upkeep, each open conflict moves by up to `conflict_step` — proportional to the gap between the Republic's effective strength (size x readiness x `strength_per_size`) and the power's `strength`. Crossing 25, 55 and 85 escalates through `ultimatum`, `blockade` and `open_war`. Nothing is random and nothing resolves: at `blockade` and above that power's offers leave the foreign market, and peace is a treaty, which is a bill.

**Settings:** `military_budget_per_cycle` · `upkeep_food` · `upkeep_energy` · `upkeep_arms` · `upkeep_pay` · `raise_cost_arms` · `readiness_fall` · `readiness_rise` · `salary_quartermaster`

### Admin

`GET/POST /api/admin/invites` · `GET /api/admin/pending` · `POST /api/admin/approve` · `POST /api/admin/user` · `PUT /api/admin/config` · `POST /api/admin/office` · `POST /api/admin/dissolve` · `POST /api/admin/cycle` · `POST /api/admin/tick` · `PUT /api/admin/constitution`

`POST /api/admin/tick` runs the clock immediately instead of waiting up to a minute — useful because Render's free tier sleeps and a sleeping instance has no timer.

---

## 6. Lifecycles

**A bill.**

```
draft ──seconders──> tabled ──Speaker──> division ──Speaker──> passed ──President──> enacted
                                                            └──> failed          └──> vetoed ──(if allowed)──> enacted
```

**An initiative.** `petition` → signatures reach `petition_share` → under `initiative_mode = table` becomes `tabled`; under `enact` becomes `referendum` and is decided by the whole Republic at `initiative_threshold`.

**An impeachment.** Carries at `impeachment_threshold` and takes effect immediately. It never reaches the President — an officer cannot veto their own removal.

**A case.** `open` → two Justices agree → `upheld` or `dismissed`. Upholding a complaint against a law repeals it from that moment.

**A Fed appointment.** President nominates → the House confirms one by one → at a simple majority the office is written, with a term of `fed_terms` cycles. A nomination alone is of no effect (Article 21.8). After confirmation there is no route out but resignation or impeachment.

**A bank.** `applied` → the Fed licenses it with reasons, at a reserve ratio of the Fed's choosing → `licensed`. Or `refused`, and the capital is returned in full — a refusal is not a fine. A licensed bank may be `closed` by the Fed, with reasons: depositors are paid pro rata from whatever it holds, the Treasury tops each of them up to `deposit_guarantee`, anyone above that loses the difference, the founder loses their capital, and outstanding loans fall into default and become repayable to the Treasury.

**The People's Justice.** A `justice` election is the Citizens' seat on the Court, and it behaves unlike the others in four ways, each for a reason:

- it seats into `court_seats` seat 3 as well as `offices`, and touches neither of the other two seats;
- **a tie leaves the seat empty** and the ballot is run again, rather than breaking the tie by display-name order — names are user-editable and the seat is held for a fixed term;
- a winner holding any other office is not seated (Article 17.11) and the seat stays empty;
- a ballot that closes while the seat is already filled is **void**. A term that could be cut short by calling a poll would not be a term (17.3).

The term is `justice_terms` x `cycle_days` — two seven-day cycles, a fortnight, by default. Terms now actually expire: the tick retires any Justice past `term_ends`, on all three seats, and with `justice_auto` on it opens the next ballot in the same minute.

**An election.** `nominations` → `campaign` → `voting` → `closed`. Certifying vacates the previous holders and seats the winners; a parliamentary election also vacates the Speaker.

**The Speaker.** Needs two thirds of the whole House. Each failed ballot lowers the bar by `speaker_relax` votes, down to a simple majority and no lower. The counter resets once a chair has been filled.

---

## 7. Settings

Every one is editable by the Returning Officer on the admin page. That is a
separate question from who may change it *politically* — see §7.1.

**Identity:** `nation_name` · `motto` · `flag_law_ref` · `currency_name` · `currency_symbol`

**Parliament:** `seats` · `quorum` · `seconds_required` · `pass_threshold` · `constitutional_threshold` · `veto_override` · `allow_veto_override` · `bill_proposers` · `bill_voters` · `impeachment_threshold`

**Elections:** `cycle_enabled` · `cycle_anchor` · `cycle_days` · `campaign_days` · `poll_days` · `cycle_elects` · `secret_ballot` · `enforce_term_limit` · `speaker_auto` · `speaker_threshold` · `speaker_relax` · `speaker_nomination_hours` · `speaker_poll_hours`

**Direct democracy:** `petition_share` · `referendum_threshold` · `referendum_quorum` · `referendum_days` · `initiative_mode` · `initiative_threshold`

**Court:** `justice_terms` · `justice_auto` · `justice_nomination_hours` · `justice_poll_hours`

**Economy:** `dividend` · `salary_president` · `salary_speaker` · `salary_mp` · `salary_justice` · `salary_treasurer` · `salary_fed_chair` · `tax_free_allowance` · `tax_rate` · `tax_upper_threshold` · `tax_rate_upper` · `registration_fee` · `ownership_cap` · `goods_economy_enabled`

**Treasury and Fed:** `fed_terms` · `bank_charter_fee` · `deposit_guarantee`

**Not legislatable, by design:**

- `require_approval` and `allow_open_signup`. They decide who gets an account at all, and a faction with one temporary majority could use them to admit enough sockpuppets to hold every majority afterwards. They stay with the Returning Officer. This is the one place the constitution's promise that a supermajority may change anything is not honoured.
- `deposit_rate`, `loan_rate`, `loan_ceiling`, `reserve_ratio`. These are the Fed's, and Article 21.10 says in terms that neither the House, nor the President, nor the Prime Minister, nor the Speaker may set the rate of interest. A rule bill that did it would be the House instructing the Fed with a vote attached. They move through `/api/fed/rates`, with published reasons, and a supermajority of Citizens may abolish the Fed outright if they dislike the answer (21.13).

`currency_name`, `currency_symbol` and `ownership_cap` are legislatable *and* settable by the Treasurer. Both routes are real; the Treasurer's is the fast one.

`term_days` exists and is read by nothing. A term is one cycle.

## 7.1 The Returning Officer

The RO runs the machinery and holds no office. Two halves, and they are easy to
confuse:

**They may set any value on the admin page.** Every setting, including the Fed's
rates. Someone has to be able to fix a number typed wrong at two in the morning,
and every write is in the public record. This is the same seam that already lets
the RO edit thresholds and the electoral clock.

**They may not act in an office, or put anyone into one that has a route of its
own.** `/api/admin/office` covers `mp`, `speaker`, `president`, `prime_minister`
and `justice` — for ties, resignations and coups, where elections normally do the
work. It refuses `treasurer` and `fed_chair` outright: the Treasurer is the
government's to appoint, and an RO who could seat a Fed chair the House never
confirmed would have quietly taken the House's power, while one who could unseat
a confirmed chair would hold a power the constitution gives nobody. On the Court the RO
now fills **no seat at all**: the House's is the Speaker's, the President's is
their own, and the People's is elected.

The RO is still a citizen. They hold an account, take the dividend, may open a
bank — and may not license it.

---

## 8. The clock

`cycleNow()` derives everything from `cycle_anchor` and `cycle_days`. A tick runs every 60 seconds: it creates the cycle's elections if absent, moves scheduled elections between phases, certifies anything past `closes_at`, and opens a Speaker ballot when the chair is empty.

```
campaign_at = start + (cycle_days − campaign_days − poll_days)
opens_at    = start + (cycle_days − poll_days)
closes_at   = start + cycle_days
```

A cycle's election is identified by its `closes_at`. **Re-anchoring the clock with elections already running creates duplicates** unless they carry `auto = TRUE` — set the anchor once and leave it. A future anchor is safe: cycle 0 creates nothing until it passes.

Render's free tier sleeps, and a sleeping instance has no timer. Everything self-heals on the next request because the tick compares timestamps, but polls can open late. Point a cron at `/api/health` if that matters.

---

## 9. Security

- `JWT_SECRET` must be 32+ random characters. The server refuses to boot otherwise.
- `ALLOWED_ORIGINS` is normalised through `new URL().origin`, so a pasted repo path or trailing slash still works. A mismatch produces a 200 with no CORS header — the server looks healthy while the browser silently discards every response.
- Login throttled per IP and per account. Registration throttled loosely, because a group on one WiFi shares an IP; the approval queue is the real gate.
- The secret ballot is real: no endpoint joins a voter to a candidate. The record logs that you voted, never what for. Divisions are public by name, as in a real parliament.
- **Admins are trusted by necessity.** They can reset any password and so log in as anyone. The mitigation is that every admin action on an account is written to the public record. Appoint a second admin if you want that watched. What they cannot do is act in an office — see §7.1 — so the trust required of them is operational rather than political.

---

## 10. Testing

```
npm test            fourteen API suites, each on a fresh in-memory Postgres
npm run test:layout six frontend checks (needs jsdom)
npm run dev         local preview, seeded, at localhost:4321
```

| Suite | |
|---|---|
| `functional` | registration, elections, the full legislative cycle |
| `attack` | forged tokens, spoofed voter ids, concurrent ballots, injection, escalation |
| `rules` | Speaker threshold, rule bills |
| `speaker` | the relaxing two-thirds bar and its floor |
| `flag` | the Flag Act and the palette it drives |
| `powers` | who may do what |
| `houserule` | House-only bills, mandatory assent, referendums, impeachment |
| `initiative` | citizens' initiatives in both modes |
| `acts` | the Supreme Court and the economy |
| `bank` | the public bank and the share market |
| `emergency` · `people` · `pm` · `houserule` | Article 12, the citizens' supermajority, the Prime Minister, House-only bills |
| `money` | the Treasury, the Fed, private banks, and what the Returning Officer may not do |
| `justice` | the People's seat: who may not appoint to it, ties, terms, and the ballot that calls itself |
| `diplomacy` | foreign powers, dispatches, treaties, cabinets |
| `foreigntrade` | that trade with abroad moves money and never mints it, across a payrun |
| `worldmap` | territory claims, who may draw a border, and what the map may say |
| `war` | procurement, the budget, raising, upkeep, readiness, and that none of it mints money |
| `conflict` | pressure, one step a cycle, escalation, the blockade biting the market, and that nothing resolves itself |
| `billedit` | editing and withdrawing a bill, and the two windows that close |

The frontend checks under `npm run test:layout` are `layout` · `seats` ·
`billsview` · `desk` · `theme` · `money-view` · `worldmap-view`. The last asserts that the Fed page
never renders a dismissal control for anyone, and never renders the rates form to
anyone but the chair — a button that appears and then 403s teaches players the
office is removable and they merely lack the knack.

`test/world.mjs` builds a working Republic from nothing — citizens, a seated parliament, Speaker, President — so no suite depends on another.


---

## 11. Diplomacy

Diplomacy is mounted from `server/diplomacy.js`. Foreign powers authenticate with `Authorization: Foreign <key>` and cannot use citizen endpoints.

### Republic-facing

`GET /api/diplomacy/powers` · `GET /api/diplomacy/dispatches` · `GET /api/diplomacy/treaties` · `GET /api/diplomacy/offers` · `GET /api/diplomacy/conflicts` · `GET /api/diplomacy/balance` · `POST /api/diplomacy/powers/:id/recognition` · `POST /api/diplomacy/dispatches/:id/reply` · `POST /api/diplomacy/conflicts/:id/respond` · `POST /api/diplomacy/offers/:id/buy`

### Foreign powers

`GET /api/foreign/state` · `GET /api/foreign/digest` · `GET /api/foreign/laws/:ref` · `GET/POST /api/foreign/dispatches` · `GET/POST /api/foreign/treaties` · `POST /api/foreign/treaties/:id/ratify` · `POST /api/foreign/treaties/:id/denounce` · `GET/POST /api/foreign/offers` · `POST /api/foreign/domestic-listings/:id/buy` · `GET /api/foreign/balance` · `POST /api/foreign/declare`

### Admin / multi-agent governments

`GET/POST /api/admin/foreign/powers` · `GET /api/admin/foreign/llm-policy` · `PUT /api/admin/foreign/powers/:id` · `POST /api/admin/foreign/powers/:id/revoke` · `GET/PUT /api/admin/foreign/powers/:id/government` · `POST /api/admin/foreign/powers/:id/agents` · `PUT /api/admin/foreign/agents/:id` · `POST /api/admin/foreign/powers/:id/run-turn` · `GET /api/admin/foreign/powers/:id/turns` · `GET /api/admin/foreign/turns/:id` · `POST /api/admin/foreign/conflicts/:id/resolve`

Recognition and treaty proposals are ordinary Republic bills with their own configured division thresholds. Treaty effects require both Republic enactment and foreign ratification. `trade_open` enables foreign trade; `tribute_per_cycle` is applied during economy payruns. Foreign imports remove the purchase price from the domestic money supply while import tax is transferred to the Treasury; exports inject the sale price into the selling business.

Multi-agent governments have one database-constrained turn per power per Republic cycle. Ministers propose structured actions and vote in bounded deliberation rounds. The deterministic controller selects and validates one action. Provider secrets never enter model state or public responses.
