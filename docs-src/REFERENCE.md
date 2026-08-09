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
├── schema.sql        core tables
├── schema-acts.sql   court and economy tables
├── dev.js            local preview, in-memory database
└── test/             ten suites, each on a fresh database

docs/
├── index.html
├── config.js         API_BASE — the only file you edit after deploying
├── app.js            core UI + window.Republic hook
├── acts.js           Court and Economy pages
└── styles.css
```

`judiciary.js` and `economy.js` are mounted by name at the bottom of `server.js`. If a file is absent the server logs it and carries on, so either can be removed without touching anything else.

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

- **The ledger sums to zero.** Money is only ever moved between accounts, never created. `SELECT sum(balance) FROM accounts` is always 0 — including across foreign trade, because a foreign power holds a real account (`owner_kind='power'`) funded from our own Treasury. An export moves money from the power to a business; an import moves it back. Nothing is minted at the border.
- **Shares are conserved.** A business's holdings always total exactly `shares_issued`.

---

## 3. Data model

**Core.** `users` · `invites` · `config` · `parties` · `party_members` · `elections` · `candidacies` · `votes` · `referendum_votes` · `petitions` · `offices` · `bills` · `bill_seconds` · `bill_votes` · `bill_petitions` · `comments` · `laws` · `constitution` · `audit`

**Court.** `court_seats` · `cases` · `case_votes`

**Economy.** `accounts` · `ledger` · `businesses` · `business_members` · `listings` · `orders` · `payruns` · `declarations` · `deposits` · `loans` · `holdings` · `share_orders` · `trades`

Notes that matter:

- **`offices` is the single source of truth for who holds what.** `president`, `speaker`, `mp`, `justice`. Impeachment, the citizens list, the chamber and every permission check read this one table. `court_seats` records only who is *entitled* to fill each seat and is reconciled against `offices` on read.
- **`accounts` has six owner kinds:** `citizen`, `business`, `treasury`, `bank`, `escrow`, `power`. Escrow is separate from treasury on purpose — the Treasury runs a deficit paying the dividend, and money held for a buyer must never be caught in that.
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
| `POST /api/elections` | admin. Kinds: `parliament`, `president`, `speaker`, `referendum` |
| `POST /api/elections/:id/stand` | status must be `nominations` |
| `POST /api/elections/:id/withdraw` | refused once the poll opens |
| `POST /api/elections/:id/vote` | `{ candidacy_id }` |
| `POST /api/elections/:id/referendum` | `{ choice }` — `keep`/`reject` on a law, `enact`/`reject` on an initiative |
| `POST /api/elections/:id/status` | admin. `nominations` \| `voting` \| `closed`. Closing certifies |

### Bills

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

### Admin

`GET/POST /api/admin/invites` · `GET /api/admin/pending` · `POST /api/admin/approve` · `POST /api/admin/user` · `PUT /api/admin/config` · `POST /api/admin/office` · `POST /api/admin/dissolve` · `POST /api/admin/cycle` · `PUT /api/admin/constitution`

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

**An election.** `nominations` → `campaign` → `voting` → `closed`. Certifying vacates the previous holders and seats the winners; a parliamentary election also vacates the Speaker.

**The Speaker.** Needs two thirds of the whole House. Each failed ballot lowers the bar by `speaker_relax` votes, down to a simple majority and no lower. The counter resets once a chair has been filled.

---

## 7. Settings

Every one is editable by an admin, and every one except the two marked is changeable by the House passing a `rule` bill.

**Identity:** `nation_name` · `motto` · `flag_law_ref` · `currency_name` · `currency_symbol`

**Parliament:** `seats` · `quorum` · `seconds_required` · `pass_threshold` · `constitutional_threshold` · `veto_override` · `allow_veto_override` · `bill_proposers` · `bill_voters` · `impeachment_threshold`

**Elections:** `cycle_enabled` · `cycle_anchor` · `cycle_days` · `campaign_days` · `poll_days` · `cycle_elects` · `secret_ballot` · `enforce_term_limit` · `speaker_auto` · `speaker_threshold` · `speaker_relax` · `speaker_nomination_hours` · `speaker_poll_hours`

**Direct democracy:** `petition_share` · `referendum_threshold` · `referendum_quorum` · `referendum_days` · `initiative_mode` · `initiative_threshold`

**Court:** `justice_terms`

**Economy:** `dividend` · `salary_president` · `salary_speaker` · `salary_mp` · `salary_justice` · `tax_free_allowance` · `tax_rate` · `tax_upper_threshold` · `tax_rate_upper` · `registration_fee` · `deposit_rate` · `loan_rate` · `loan_ceiling` · `ownership_cap`

**Not legislatable, by design:** `require_approval` and `allow_open_signup`. They decide who gets an account at all, and a faction with one temporary majority could use them to admit enough sockpuppets to hold every majority afterwards. They stay with the Returning Officer. This is the one place the constitution's promise that a supermajority may change anything is not honoured.

`term_days` exists and is read by nothing. A term is one cycle.

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
- **Admins are trusted by necessity.** They can reset any password and so log in as anyone. The mitigation is that every admin action on an account is written to the public record. Appoint a second admin if you want that watched.

---

## 10. Testing

```
npm test            ten API suites, each on a fresh in-memory Postgres
npm run test:layout three frontend checks (needs jsdom)
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
| `bank` | banking and the share market |

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
