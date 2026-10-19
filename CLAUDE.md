# CLAUDE.md — The Realm (v2)

Agent guide. Read it all before changing code; the playbooks at the bottom cover
nearly every task you will be given.

A political game for a WhatsApp group of ~19 friends. Static site on GitHub Pages
(`docs/`), Express API on Render free tier (`server/`), Postgres on Neon free tier.
Everything must stay free.

**Owner: Uzair**, username `admin`. He is the Returning Officer (RO) *and* a player.

## Working with Uzair

- Terse, direct, no preamble. Do the work, then report in a few lines.
- **Minimise testing**: run the checks below, don't write new test suites unless asked.
- **Always end with 2–4 suggested features** — short, concrete, specific to this game.
- Complete outputs. Don't leave TODOs or half-wired features.
- He works on Windows/PowerShell. If `npm` errors with "running scripts is disabled",
  tell him to use `npm.cmd` or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Commands

```
npm install                 # root: engine + web
npm run dev                 # demo at :5173 — whole game in the browser, bots play everyone else
npm run smoke               # engine: bots play 40–50 days of both scenarios, ledger must balance
npm run typecheck           # tsc over engine/, web/src/, scripts/
npm run build               # site into docs/ (rewrites docs/index.html + docs/assets only)
npm run build:demo          # single-file demo HTML into dist/

cd server && npm install
npm run dev                 # API at :4321 on in-memory PGlite; users admin/amara/bilal, password "password"
npm test                    # end-to-end on PGlite: auth, CORS, act, secrecy, ledger, clock, restart, admin
cd .. && npm run dev:online # the real UI against the local API
```

**Definition of done** for any change: `npm run typecheck`, `npm run smoke`, and
(if engine/ or server/ changed) `cd server && npm test` all pass; `npm run build`
if web/ or engine/ changed, and commit the rebuilt `docs/`.

## Architecture

```
engine/      pure TS, no I/O, no DOM, no Node APIs. Runs in the browser AND on the server.
  core.ts      W/Id types, fail()/GameError, ids, rng, transfer(), gazette(), earn/spend Influence,
               meters, cards, office lookups (hasPower, holderOf), calendar (nextAt), formatting
  politics.ts  convention, parties, elections (national top-N + countback), PM, coalitions, HOS, objectives
  proposals.ts proposal kinds and clauses, debate → vote → assent → enact, PMQs, lobbying
  offices.ts   POWERS, TEMPLATES, createOffice, appoint, grant/fine
  economy.ts   payday, tax, Reserve rate, banks, ventures
  foreign.ts   5 nations, envoys, treaties, intel, the army
  backroom.ts  cards, deals, demands, plots/coups, exile, pardons
  society.ts   press, front pages, court, crises
  clock.ts     collect() = every pending deadline; advanceTo(t) runs them in time order
  world.ts     createWorld('convention'|'running') for the demo; createLiveWorld(people) for real
  view.ts      viewFor(world, me) — the redacted copy one player may see
  migrate.ts   migrate(world) — upgrades a saved world on server boot
  index.ts     COMMANDS table; run(world, actor, cmd, args) applies one to a structuredClone
  bots.ts      demo and smoke only — never imported by the server
web/src/     Preact + Vite. main.tsx (router, tabs), store.ts, ui.tsx (shared components),
             Sidebar.tsx, DemoPanel.tsx (demo only), pages/*.tsx, styles.css
server/      app.ts (all routes), db.ts (pg or PGlite + SCHEMA), server.ts (boot/env), test.ts
docs/        GitHub Pages output. Hand-kept: config.js, icons/, manifest.webmanifest, sw.js
scripts/     smoke.ts
```

### The model

- **The whole game is one JSON object** (`W`). Every action is a named command in
  `COMMANDS`; `run()` clones the world, applies the command as `actor`, re-checks
  objectives, and returns the new world. A rule violation calls `fail('message')`,
  which throws `GameError`; the message is shown to the player verbatim, so write it
  as a friendly sentence.
- **Time is lazy.** Nothing runs on a timer inside the engine. `collect()` lists every
  deadline; `advanceTo(t)` runs each one in order with `w.now` set to its own time.
- **Randomness** comes only from `rand(w)` (seeded, stored in `w.rng`). Never `Math.random()`
  in engine code — it breaks determinism and the smoke test.

### The server (`server/app.ts`)

- Loads `v2_world` row 1 at boot (`migrate()` first), or creates it with
  `createLiveWorld` from every active, approved user.
- All writes go through `serial()` (one promise queue). `catchUp()` advances the world
  to `Date.now()` before every read and action. A `setTimeout` wakes at the next deadline.
- Saves the whole world after every change. `v2_log` gets every action (ok or error).
  `v2_snapshots` gets the world before an RO reset.
- Sends only `viewFor(world, me)`, plus `me` and `serverNow`.

### Routes

| Route | Auth | Body → reply |
|-|-|-|
| `GET /api/health` | — | `{ok, now, phase}` |
| `POST /api/login` | — | `{username, password}` → `{token, me}`. Rate-limited 10/min/IP. Adds a missing citizen. |
| `POST /api/signup` | — | `{username, display_name, password}` → `{token, me}` or `{waiting:true}`. Only if `flags.openSignup`. |
| `GET /api/state` | user | → `{world, me, serverNow}` |
| `POST /api/act` | user | `{cmd, args}` → `{world, me, serverNow}`; 400 `{error}` on GameError |
| `POST /api/password` | user | `{current, next}` → `{token}`; bumps token_version |
| `GET /api/admin/export` | RO | full unredacted world |
| `POST /api/admin/password` | RO | `{citizen}` → `{temp}`; announced in the Gazette |
| `POST /api/admin/reset` | RO | `{confirm:'RESET THE REALM'}`; snapshots first |

Auth is `Authorization: Bearer <jwt>`, JWT `{id, tv}` signed with `JWT_SECRET`, 60 days.
Citizen id = `'u' + users.id`.

### The client (`web/src/store.ts`)

- `ONLINE = !!window.API_BASE` (set by `docs/config.js`). Otherwise it is the demo:
  world in localStorage, `DemoPanel` lets one person switch player and skip time.
- Online `act()` runs the command locally for an instant result, POSTs it, then
  replaces local state with the server's reply. Polls `/api/state` every 15s.
- Pages read state with `const { world: w, me } = useStore()` and act with
  `act('cmd.name', args, 'Toast on success.')`.

## Invariants — never break these

1. **The ledger sums to zero.** Money moves only via `transfer()` (or code that writes
   both sides). The Reserve's negative balance is the money supply. Smoke and server
   tests assert it.
2. **Secrets never leave the server.** Ballots, other wallets and ledger rows, cards,
   deals, demands, plots, ambitions, objectives, intel, classified offices, the rng,
   the sign-up queue, the admin log. **Any new private field must be stripped in
   `viewFor`**, or every player can read it in devtools.
3. **The client is untrusted.** Every rule lives in the engine and is re-checked on the
   server. Hiding a button is cosmetic.
4. **Rules change only through Parliament.** The RO's powers are exactly: approve
   sign-ups, toggle `requireApproval`/`openSignup`, move the calendar, force-enact a
   stuck bill (logged), reset a password (announced), export, reset the realm.
   Don't add RO powers over game rules.
5. **Check offices before admin. Never short-circuit.** Uzair holds offices too;
   `if (admin) return` at the top of a permission check removes his office powers.
6. **The world is JSON.** No functions, classes, Dates, Maps or undefined-as-meaning.
7. **One citizen, one vote.** Votes are keyed by citizen id; ids come only from the token.

## Traps

- **Lazy deadlines**: code in a deadline must use `w.now`, never `Date.now()`, and must
  not assume it ran on time — after a Render sleep many run back to back.
- **Shape changes need `migrate()`.** The live world survives deploys. Add a field →
  add `w.field ??= default` in `engine/migrate.ts`. Steps must be idempotent.
- **`viewFor` deletes other citizens' `c:` accounts**, so client code showing someone
  else's balance gets 0. Online, show only your own (see Passport).
- **Admin ledger check** online uses `w.audit.total` (server-computed), not the local sum.
- **CORS**: an origin not in `ALLOWED_ORIGINS` gets a 403 and a "Refused origin" log line.
- **Render rootDir is `server/`** but it imports `../engine`; `render.yaml` buildFilter
  covers both. Don't add server deps to the root package.json or vice versa.
- **Engine must stay isomorphic**: no `node:` imports, no `window`/`document`.
- Intrigue (backroom, plots, leaks) is locked for `config.intrigueDelayDays` (14) after
  the realm starts running. `flags.intrigueNow` overrides, demo only.
- The Convention adopts a clause at `config.conventionThreshold` (10) votes for one
  option and has **no deadline**.

## Playbooks

**Add a player action**
1. Write the rule in the right `engine/<system>.ts`: validate with `fail('…')`, mutate `w`,
   announce with `gazette(w, kind, text, '#/route')`, move money only with `transfer()`.
2. Register it in `COMMANDS` in `engine/index.ts` as `'area.verb': (w, me, a) => …`.
3. Call it from a page: `act('area.verb', {…}, 'Done message.')`.
4. If it creates anything private, strip it in `engine/view.ts`.

**Add a deadline** — store the time on the object (`dueAt`), then add one line in
`collect()` in `engine/clock.ts`: `add(x.dueAt, () => settle(w, x))`. The settle
function must change state so the deadline doesn't fire again.

**Add a page** — component in `web/src/pages/*.tsx` using `Page`, `Sec`, `Card`, `Btn`,
`Field`, `Pick` from `ui.tsx`; route in `route()` in `main.tsx`; add its first path
segment to the right tab in `TABS`; link to it from a hub page with `LinkRow`.

**Add a world field** — default in `blank()` in `engine/world.ts`, `??=` in
`engine/migrate.ts`, redact in `view.ts` if private.

**Add a server route** — in `server/app.ts`, behind `auth` (and `admin` if RO-only);
any world change inside `serial(async () => { …; await save(); })`. Add a client helper
in `store.ts`.

**Add a DB table** — `CREATE TABLE IF NOT EXISTS` in `SCHEMA` in `server/db.ts`. Additive
only; never alter or drop v1's `users`. Tell Uzair to **snapshot Neon before deploying**.

## Git and deploy

- Never commit to `main`. Work on a branch (`v2` is the production branch until it is
  merged), push, and open a PR. `gh pr create` is blocked here; use
  `gh api repos/BigDreamerDev/democracy-sim/pulls -f title=… -f head=… -f base=main -F body=@file`.
- **Never overwrite `docs/config.js`.** It holds the real `API_BASE`
  (`https://democracy-sim-thgx.onrender.com`). `npm run build` leaves it alone; check
  `git diff --cached --name-only` doesn't list it before committing.
- Commit the rebuilt `docs/assets` and `docs/index.html` with any web/engine change —
  Pages serves `docs/` straight from the branch, there is no CI build.
- Merging to `main` deploys both: Render redeploys the API, Pages republishes `docs/`.
- Render env: `DATABASE_URL`, `JWT_SECRET` (the v1 value), `ALLOWED_ORIGINS`, `NODE_VERSION=22`.
- `.github/workflows/keepawake.yml` pings `/api/health` every 10 min, 06:00–00:59 UTC.

## Frontend design

Paper-and-ink civic look: Gloock headings, Atkinson Hyperlegible body, the seal, rubber
stamps and passport visas, teal and red accents on warm paper; full dark mode. Phone:
bottom tab bar, one column. Desktop: sidebar and wide-screen columns. Page changes use
view transitions. Use the existing CSS variables and components rather than new styles.
No generic AI look: no Inter/Roboto/system fonts, no purple gradients, no cookie-cutter
cards. Copy is plain British English, second person, short sentences.
