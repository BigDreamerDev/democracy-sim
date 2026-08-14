# CLAUDE.md — the Republic

A parliamentary democracy simulator for a WhatsApp group of ~19 people, called
**McServerLandia**. Static front end on GitHub Pages (`docs/`), Express API on
Render (`server/`), Postgres on Neon.

Owner is **Uzair**, who is the Returning Officer (admin) and also plays.

Read this before changing code. **Tests have caught more real bugs here than
reading has — run them after any server change.**

```
cd server
npm install
npm run dev            # localhost:4321, seeded, nothing deployed
npm test               # 22 suites, fresh in-memory Postgres each
npm run test:layout    # 7 frontend checks (needs jsdom)
```

`test/layout.js` reports 5 failures. They predate all current work and are a
jsdom-version issue, not app breakage. Everything else must be green.

---

## Shape

```
server/
├── server.js         core: auth, bills, elections, offices, config, the clock
├── judiciary.js      the Supreme Court            (optional module)
├── diplomacy.js      foreign powers, treaties, intelligence, the map (optional)
├── economy.js        money, tax, business, bank, shares (optional)
├── money.js          the Treasury, the Fed, private banks (optional)
├── war.js            supply, procurement, upkeep, conflict pressure (optional)
├── llm/providers.js  model calls for foreign cabinets; free tiers by default
├── schema.sql            core tables
├── schema-acts.sql       court + economy tables
├── schema-money.sql      Treasury, Fed, private banks
├── schema-diplomacy.sql  powers, cabinets, territories, intelligence
├── schema-war.sql        stockpile, formations, upkeep, conflict pressure
├── dev.js            local preview, in-memory database, fully seeded
└── test/             22 API suites + 7 frontend checks

docs/
├── index.html
├── config.js         API_BASE — NEVER overwrite this from a local copy
├── app.js            core UI + window.Republic hook
├── acts.js           Court, Economy, Diplomacy pages
├── money.js          Treasury, Fed, Supply pages
├── world-map.js      precomputed SVG country paths (generated, 121KB)
└── styles.css
```

**Module mount order matters:** `judiciary`, `diplomacy`, `economy`, `money`,
`war`. `economy.js` sets `ctx.economy` as its last act and `money.js` and
`war.js` borrow the ledger primitives off it. Reorder and they answer 503.

A missing module file is logged and skipped — every one can be removed.

---

## Invariants

**`sum(accounts.balance) = 0`, always.** Money is only ever moved between
accounts. This survives Fed issuance (the Fed's own account goes negative — that
negative balance *is* the money supply), foreign trade, bank failure and army
wages. Asserted by `money.mjs`, `bank.mjs`, `foreigntrade.mjs`, `war.mjs`.

**Shares are conserved.** A business's holdings total exactly `shares_issued`.

**One person, one vote.** Held by database constraints, not application code.
Asserted by `attack.mjs`, which is why anyone can trust a result.

**Nothing binds the Republic without a bill.** Treaties, recognition, war,
peace, territory transfer, emergencies. All of them.

---

## Offices

`offices` is the single source of truth. `president`, `prime_minister`,
`speaker`, `mp`, `justice`, `treasurer`, `fed_chair`, `foreign_minister`,
`quartermaster`.

Article 7.1: one seat each, enforced everywhere.

| Office | Appointed by | Removed by |
|---|---|---|
| President, Speaker, MPs | election | election |
| Prime Minister | President, confirmed by the House | House no-confidence |
| Justices ×3 | House seat = Speaker; President's = themselves; **People's = elected ballot** | term expiry, resignation, impeachment |
| Treasurer | PM, or President if none | the appointer, or resignation |
| Foreign Minister | same | same |
| Quartermaster | same | same |
| **Head of the Fed** | President nominates, House confirms | **impeachment or resignation only** |

---

## Traps that have already caused bugs

**Check offices before `is_admin`. Never short-circuit.** Uzair is the RO *and*
plays, so one account routinely holds an office too. `if (user.is_admin) return
X` at the top of a permission check silently removes powers the office grants —
it did exactly that to a sitting Speaker in `mayAppoint`. Ask what office
someone holds, then ask whether they are also the RO.

**`/api/admin/office` refuses `treasurer`, `fed_chair`, `foreign_minister`,
`quartermaster`.** Those have routes of their own that mean something. The RO
may edit every *setting* on the admin page, including the Fed's rates — that is
logged and someone has to be able to fix a typo. Setting a value is not holding
an office.

**There is no endpoint that dismisses the head of the Fed.** Not an oversight.
An appointee who can be dismissed is an employee. The front end hides the
control too and `money-view.js` asserts it stays hidden.

**`deposit_rate`, `loan_rate`, `loan_ceiling`, `reserve_ratio` are not
legislatable.** A rule bill setting the rate of interest is the House
instructing the Fed with a vote attached.

**A constitutional bill replaces the entire constitution** — its body becomes
the whole new text.

**Issuance and procurement cannot go through `pay()`.** It refuses an overdraft
and the Treasury is normally overdrawn from the dividend. `issue()` and
`spendFromTreasury()` write both sides themselves and still write the ledger.

**Every stockpile change goes through `move()`.** It refuses to take a category
below zero rather than clamping. Supplying an army from an empty store silently
is the one bug that would make the war system meaningless.

**A conflict never resolves itself.** `runConflicts` moves pressure and
escalates a stage — no territory, no treaty, no surrender. If pressure hitting
100 ever does something automatic, the House has lost a decision it should have
had.

**War is supply, not manoeuvre — by the group's decision.** No positions, no
orders, no dice. Readiness moves by fixed steps so a losing player sees it
coming cycles out. Do not add randomness.

**Real country names never reach a player.** `TERRITORY_NAMES` in
`docs/world-map.js` is for the RO's console only. `worldmap-view.js` asserts the
leak cannot happen.

**The world map is precomputed.** Do not add d3-geo or a TopoJSON client to the
front end — `docs/` stays a no-build static site. Regenerate the file instead.

**Bills are never deleted, only `withdrawn`.** A hole in the reference numbers
is worse. Editing and withdrawing both stop the moment a division is called.

**Editing a bill clears its seconds.** A signature was for the text signed.

**Intelligence: reading is an audit write.** `/api/intel/reports/:id/read`
inserts into `intel_reads` before it answers, and that register is public even
while the report is sealed. Nothing but a row in `intel_clearance` grants sight;
no office does.

**Tribute used to destroy money.** The diplomacy payrun debited the Treasury and
wrote a ledger row with `to_id NULL` for as long as the feature existed;
`foreigntrade.mjs` never ran a payrun so it stayed green. Any new movement
writes both sides, and any new suite touching money asserts the total across a
payrun, not just across a request.

**Other sharp edges:** `bigint` params need explicit `::bigint` casts. Escrow is
a separate account from the Treasury. The electoral roll freezes at `opened_at`.
Re-anchoring the cycle clock mints duplicate elections. `campaign_at` in the past
closes nominations early. `[hidden]{display:none!important}` must stay in the
CSS. A mismatched `ALLOWED_ORIGINS` returns 200 with no CORS header, so the
server looks healthy while the site fails. A division never closes itself.
`term_days` is dead and read by nothing.

---

## Deployment

`docs/` is served by GitHub Pages; `server/` runs on Render; Neon holds the
data. Schema files run on boot and are additive and idempotent — **snapshot Neon
before any push that adds one.**

Never push `docs/config.js` from a local tree. It holds the real `API_BASE`.
