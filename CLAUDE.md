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
npm test             # ten suites, each on a fresh database
npm run test:layout  # three frontend checks (needs jsdom)
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
server/diplomacy.js   foreign powers, treaties, trade, conflict, multi-agent governments. Optional module.
server/schema.sql     core tables. Runs on every boot; everything IF NOT EXISTS.
server/schema-acts.sql court + economy tables. Same.
server/schema-diplomacy.sql diplomacy + foreign-government tables. Same.
docs/app.js           the SPA. Hash router, view functions, exposes window.Republic.
docs/acts.js          Court and Economy pages, registered through that hook.
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

**`offices` is the source of truth.** Impeachment and suspension write there and know nothing about `court_seats`, which must be reconciled on read or the bench shows a ghost.

---

## Things that are deliberate, not bugs

- **`require_approval` and `allow_open_signup` are not legislatable.** They decide who gets an account; a temporary majority could use them to admit sockpuppets and hold every majority afterwards. This knowingly breaks the constitution's promise that a supermajority may change anything.
- **A division does not close itself** even when every MP has voted. The Speaker declares the result. Known cost: an absent Speaker stalls the House.
- **Aye-green and no-red are not flag-derived.** They carry meaning; a red-and-green flag would make the division strip unreadable.
- **Repeal is easier than enactment.** Petition and referendum can strike a law down; enacting by initiative needs `initiative_mode = enact`, which is off by default.
- **The Treasury may go negative.** The dividend is unconditional, so it cannot be contingent on the state being solvent.
- **`term_days` does nothing.** Vestigial. A term is one cycle. Delete it if you are touching that area.

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
- `campaign/` — a candidate's speech and three drafted bills. Content, not code.

---

## If you are about to change the voting rules

Stop and check the attack suite still passes. That suite is the reason anyone can trust the results. The single most important property of this system is that a person cannot vote twice, and it is held by database constraints rather than by anything you can see while reading the code.
