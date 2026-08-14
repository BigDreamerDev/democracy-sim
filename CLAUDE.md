# CLAUDE.md

Working notes for Claude Code and for any future session picking this up. Read this before changing anything.

---

## What this is

A parliamentary democracy simulator for one WhatsApp group of about nineteen people. Real elections, real bills, a real statute book, a Supreme Court, and an economy. Static front end on GitHub Pages, Express API on Render, Postgres on Neon.

It is a game, but the constraints are not pretend: the people playing it will try to cheat, and the whole thing is worthless if one person can hold two votes.

## Run it before you change it

```
cd server
npm install
npm run dev          # localhost:4321, in-memory DB, seeded republic, no deploy
npm test             # fourteen suites, each on a fresh database
npm run test:layout  # six frontend checks (needs jsdom)
```

`npm run dev` prints six logins. Use them to see the same page as an MP, the President, a Justice, and someone with no office at all. The last one is the view most people have and the one most often broken.

**Always run `npm test` after changing `server/`.** Suites are cheap and have caught more real bugs in this codebase than reading has.

---

## Architecture in one page

```
server/server.js      core. Auth, config, elections, bills, laws, constitution, the clock.
                      Ends by mounting ./judiciary and ./economy, then a 404 catch-all.
server/judiciary.js   the Supreme Court. Optional module.
server/economy.js     money, tax, enterprise, bank, shares. Optional module.
server/money.js       the Treasury, the Fed, private banks. Optional; needs economy.js.
server/diplomacy.js   foreign powers, treaties, trade, conflict, multi-agent governments. Optional module.
server/schema.sql     core tables. Runs on every boot; everything IF NOT EXISTS.
server/schema-acts.sql court + economy tables. Same.
server/schema-diplomacy.sql diplomacy + foreign-government tables. Same.
server/schema-money.sql Treasury, Fed and private-bank tables. Same.
docs/app.js           the SPA. Hash router, view functions, exposes window.Republic.
docs/acts.js          Court and Economy pages, registered through that hook.
docs/money.js         Treasury and Fed pages, registered the same way.
```

Modules receive a context object (`q`, `log`, `auth`, `admin`, `wrap`, `num`, `bool`, …) rather than importing from `server.js`. A missing module file is logged and skipped, so either Act can be removed without editing core.

The front end trusts nothing and enforces nothing. Hiding a button hides a button.

---

## Conventions

- **Constraints over checks.** If a rule can live in the schema, put it there. `UNIQUE (election_id, voter_id)` cannot be raced; an `if` can.
- **Catch `23505`, don't pre-check.** Read-then-insert has a race. Insert and handle the unique violation.
- **Money is integers.** Minor units, `BIGINT`, `Math.round`. Never floats.
- **Never delete.** Repeal, supersede, mark void. Article 13 of the constitution requires it and the record is the main check on the admin.
- **Identity comes from the token only.** Never from a request body. `voter_id` in a payload is read by nothing.
- **Every state-changing action calls `log()`.** The public record is the accountability mechanism.
- **Errors are sentences.** `'You have already voted in this division. One vote each.'` — not `'DUPLICATE_VOTE'`.
- **Comments explain why, never what.** If a line needs explaining, the comment says what would break without it.

---

## Traps

Each of these has already caused a real bug here.

**A constitutional bill replaces the entire constitution.** `enact()` inserts `b.body` as the new version. An "amendment" containing only the new article deletes Articles 1–16. Constitutional bills must carry the full text, and a second one must be drafted from the first's output.

**`bigint` parameters need explicit casts.** `SET remaining = $1` plus `WHERE $1 <= 0` makes Postgres refuse with `42P08 integer versus bigint`. Write `$1::bigint` in both places. This produced 500s while the underlying trades still executed.

**Escrow is not the Treasury.** The Treasury runs a deficit paying the unconditional dividend. Money held for a buyer lives in its own `escrow` account or releasing it fails the balance check.

**The electoral roll freezes at `opened_at`.** Set once, `COALESCE`d thereafter. Reopening a poll without clearing it silently disenfranchises everyone who joined since.

**Re-anchoring the clock creates duplicate elections.** A cycle's election is identified by its `closes_at`. Set the anchor once. A future anchor is safe — cycle 0 creates nothing.

**`campaign_at` in the past closes nominations.** Standing requires status `nominations`, not `campaign`. If nominations should run to the poll, `campaign_at` must be null or equal to `opens_at`.

**UA `[hidden]` loses to any author rule.** `.stack{display:flex}` cancelled the `hidden` attribute and rendered the login and register forms at once. `[hidden]{display:none !important}` is in `styles.css` for this reason — do not remove it.

**CORS failure looks like a healthy server.** A mismatched `ALLOWED_ORIGINS` returns 200 with no `Access-Control-Allow-Origin`, so `/api/health` works in a tab while the site fails. Origins are normalised through `new URL().origin`.

**Modules mount before the schema exists.** Anything a module needs in the database must be created lazily on first use, not at mount time.

**Foreign trade must not mint money.** A foreign power holds a real account (`owner_kind='power'`), seeded and topped up by transfer from our Treasury. An earlier build credited exports from `from_id NULL`, so a citizen listing a rock at a million and a compliant power buying it created a million marks. `test/foreigntrade.mjs` asserts `sum(balance) = 0` after every foreign operation — if that suite goes red, money is being created somewhere.

**Seeding a balance is a transfer, never an insert.** The same bug in miniature: giving a new power its opening balance directly on the accounts row prints it. Debit the Treasury.

**economy.js must mount before money.js.** The Treasury and the Fed do not own
the ledger; they borrow `pay()`, `accountFor()` and the rest off `ctx.economy`,
which economy.js sets on the shared context as its last act. Reorder the mount
list and `/api/treasury` and `/api/fed` answer 503 forever.

**Issuance cannot go through `pay()`.** `pay()` refuses an overdraft, and the
Fed's account is *supposed* to be overdrawn — that negative balance is the money
supply. `issue()` in money.js writes both sides itself for that reason. It is the
one place outside a foreign seeding that does, and it still writes the ledger, so
`sum(accounts.balance)` stays 0. If you add a third, prove that sum first.

**The deposit guarantee is a cap, not a promise.** A depositor above it loses the
difference when a bank fails, and the founder loses the lot. That is deliberate
and the suite asserts the exact numbers; if you "fix" it so everyone is made
whole, you have removed the only reason anyone would care which bank they use.

**A licensed bank's interest moves no money.** Paying deposit interest raises the
depositor's *claim* without raising the bank's reserves, exactly as the public
bank already does. The shortfall is real and shows up on closure. Do not
"correct" this by crediting reserves — that mints money.

**`offices` is the source of truth.** Impeachment and suspension write there and know nothing about `court_seats`, which must be reconciled on read or the bench shows a ghost.

---

## Things that are deliberate, not bugs

- **`require_approval` and `allow_open_signup` are not legislatable.** They decide who gets an account; a temporary majority could use them to admit sockpuppets and hold every majority afterwards. This knowingly breaks the constitution's promise that a supermajority may change anything.
- **A division does not close itself** even when every MP has voted. The Speaker declares the result. Known cost: an absent Speaker stalls the House.
- **Aye-green and no-red are not flag-derived.** They carry meaning; a red-and-green flag would make the division strip unreadable.
- **Repeal is easier than enactment.** Petition and referendum can strike a law down; enacting by initiative needs `initiative_mode = enact`, which is off by default.
- **The Treasury may go negative.** The dividend is unconditional, so it cannot be contingent on the state being solvent.
- **`term_days` does nothing.** Vestigial. A term is one cycle. Delete it if you are touching that area.
- **There is no endpoint that dismisses the head of the Fed.** Not an oversight.
  Article 21.10 and 21.11: the President who nominated them cannot remove them,
  and neither can the House except by impeachment at two thirds. An appointee who
  can be dismissed is an employee. The front end hides the control too, and
  `test/money-view.js` asserts that it stays hidden — a button that appears and
  then 403s teaches players the office is removable and they merely lack the knack.
- **`deposit_rate`, `loan_rate`, `loan_ceiling` and `reserve_ratio` are not
  legislatable.** A rule bill setting the rate of interest is the House
  instructing the Fed with a vote attached, which 21.10 forbids in terms. They
  move only through `/api/fed/rates`, with published reasons. The Returning
  Officer can still set them through `/api/admin/config`, as they can every other
  setting — that is the existing admin seam, not a new one, and the tests rely on
  it. Setting a value is not holding an office; see the entry on
  `/api/admin/office` below.
- **`/api/admin/office` refuses `treasurer` and `fed_chair`.** The RO runs the
  machinery and holds no office; those two have routes of their own that mean
  something, and a second administrative door would empty them. The RO can still
  edit every *setting* on the admin page, including the Fed's rates — that is the
  existing seam, it is logged, and someone has to be able to fix a typo. On the
  Court the RO fills only the People's seat, for the same reason.
- **A `justice` election is special-cased inside `certify()` and returns early.**
  The generic path vacates every holder of the office being elected, which for
  `justice` would sweep the House's and the President's appointees out of a
  ballot they had no part in. It also breaks ties by display-name order, which
  is gameable on a seat held for a fixed term. If you touch `certify()`, the
  `justice` branch must stay above the generic seating.
- **`justiceTermEnds()` lives in server.js and is passed to judiciary.js on the
  context.** Two copies of `justice_terms x cycle_days` that disagree would only
  show up when somebody's term ended early.
- **War is supply, not manoeuvre — by the group's decision.** There are no unit
  positions, no orders, no deployment and no dice anywhere in `war.js`. If a
  future change adds randomness to readiness or an outcome, it breaks the thing
  that makes this playable asynchronously: a player who is losing must be able
  to see it coming several cycles out. Readiness moves by fixed steps only.
- **A conflict never resolves itself.** `runConflicts` moves pressure and
  escalates a stage; it does not transfer territory, sign a treaty or end a war.
  Peace is a bill, as everything else is. If a future change makes pressure
  hitting 100 do something automatic, the House has lost a decision it should
  have had.
- **Procurement and wages bypass `pay()` deliberately.** The Treasury is
  normally overdrawn from the dividend, and `pay()` refuses an overdraft, so
  `spendFromTreasury()` writes both sides itself. It still writes the ledger, so
  `sum(accounts.balance)` stays 0 — `war.mjs` asserts that across five payruns.
  What limits procurement is `military_budget_per_cycle`, never the balance.
- **Every stockpile change goes through `move()`.** It refuses to take a
  category below zero rather than clamping, and writes a signed movement row.
  Supplying an army from an empty store silently is the one bug that would make
  the whole system meaningless.
- **Bills are never deleted, only `withdrawn`.** A hole in the reference numbers
  would be worse than a withdrawn bill in the list, and the record of what was
  proposed and then pulled is part of the public record. Both editing and
  withdrawing stop the moment a division is called — after that the House is
  voting on a text and it is no longer the proposer's.
- **Editing a bill clears its seconds.** Deliberate: a signature was for the
  text that was signed, and collecting seconds then rewriting the body would be
  a bait and switch.
- **The Foreign Minister displaces the President on the channel, deliberately.**
  `requireRepublicDiplomat` refuses the President while the office is filled. If
  that ever looks like a bug and gets "fixed", the head of state is back to
  negotiating the treaties they assent to.
- **Intelligence: reading is an audit write.** `/api/intel/reports/:id/read`
  inserts into `intel_reads` before it answers, and that register is public even
  while the report is sealed. Do not add a read path that skips it — the
  register is the entire reason secrecy is tolerable here. Nothing but a row in
  `intel_clearance` grants sight of a sealed report; no office does.
- **Real country names never reach a player.** `docs/world-map.js` carries
  `TERRITORY_NAMES` for the Returning Officer's console only. Everywhere else a
  territory is called whatever the power holding it is called. One leaked
  "United States of America" on the map collapses the conceit;
  `test/worldmap-view.js` asserts the leak cannot happen.
- **The world map is precomputed.** Paths are projected at build time into a
  1000x500 viewBox and rounded to a tenth of a pixel. Do not add d3-geo or a
  TopoJSON client to the front end to "improve" it — the whole point is that
  `docs/` stays a no-build static site. Regenerate the file instead.
- **Tribute used to destroy money.** The diplomacy payrun debited the Treasury
  and wrote a ledger row with `to_id NULL`, so `sum(balance)` walked negative
  once per cycle per ratified treaty, for as long as the feature existed.
  `foreigntrade.mjs` never ran a payrun, so it stayed green throughout. It runs
  two now. Any new movement writes both sides, and any new suite that touches
  money asserts the total across a payrun, not just across a request.
- **Check offices first; `is_admin` is only ever an extra route, never a short
  circuit.** Uzair is the Returning Officer and also plays, so one account
  routinely holds an office too. `if (user.is_admin) return <something>` at the
  top of a permission check silently takes away powers the office grants —
  it did exactly that to a sitting Speaker in `mayAppoint`. Ask what office
  someone holds, then ask whether they are also the RO.
- **The Treasurer falls with the government; the Fed chair does not.** The
  Treasury is appointed by the Prime Minister, or by the President where there is
  none, and either may dismiss them. That asymmetry is the entire point of having
  two money offices instead of one.

---

## Working on it

**Frontend.** `app.js` owns the core routes and exposes a narrow `window.Republic` (`api`, `esc`, `md`, `toast`, `addRoute`, `addSubRoute`, `reload`, `state()`, `me()`). Extra pages register through it. Everything is escaped with `esc()`; there is no framework and no build step.

**Styling.** The palette is not in the stylesheet — it is read from whatever law `flag_law_ref` points at and applied as CSS variables. Amending the Flag Act re-skins the whole site. New UI should use the existing vocabulary (`.card`, `.list`/`.item`, `.tag`, `.field`, `.btn`, `.prose`) so it inherits that automatically. The Court and the bank statement have their own sections at the end of `styles.css`. Diplomacy uses the shared card/list/tag vocabulary so flag-law colours carry through automatically.

**Adding a setting.** Add to `DEFAULTS` in `server.js`, add to `LEGISLATABLE` unless it decides who gets an account, add to `CONFIG_FIELDS` and `RULE_KEYS` in `app.js`. Then the House can change it by rule bill.

**Adding an endpoint.** Wrap in `wrap()`, gate with `auth` / `admin` / `requireOffice()`, `await loadConfig()` if you read settings, `log()` anything that changes state, return a sentence on error.

**Writing a test.** Import from `./world.mjs`, call `setup()`, use `w.T` (MP tokens), `w.spk`, `w.pres`, `w.plainTok` (no office at all), `passBill()`. Add the file to `SUITES` in `test/run.js`. Each suite gets a fresh database — never depend on another suite having run.

---

## Free-only LLM diplomacy

Multi-agent foreign governments are hard-locked to free providers; `LLM_FREE_ONLY=true` documents that deployment policy. The supported hosted providers are Groq, Gemini and OpenRouter free routes; `mock` is for tests. Paid OpenAI/Anthropic configurations are rejected in free-only mode. Provider/model validation lives in `server/llm/providers.js`; do not bypass it when adding agent-management endpoints. Automatic fallback must remain free-only and must fail closed when no free provider is available.

## Where the documents live

- `constitution.md` — the founding document. Paste into the admin page to publish a version.
- `HANDBOOK.md` — how the game works, for players.
- `SETUP.md` — deployment, start to finish.
- `INSTALL-ACTS.md` — adding the Court and the economy to a running instance.
- `docs-src/REFERENCE.md` — full API and system reference.
- `docs-src/DIPLOMACY.md` — contract and implementation guide for the foreign-powers interface.
- `docs-src/MULTI-AGENT-DIPLOMACY.md` — foreign governments run by several cooperating LLM agents.
- `MONEY.md` — the Treasury and the Fed: offices, powers, and what each cannot do.
- `campaign/` — a candidate's speech and three drafted bills. Content, not code.

---

## If you are about to change the voting rules

Stop and check the attack suite still passes. That suite is the reason anyone can trust the results. The single most important property of this system is that a person cannot vote twice, and it is held by database constraints rather than by anything you can see while reading the code.
