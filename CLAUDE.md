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

npm run copy:extract        # every player-facing string → copy/strings.json
npm run copy:apply          # write copy/edits.json into the source (the desk at #/copy does both, dev only)
```

**Definition of done** for any change: `npm run typecheck`, `npm run smoke`, and
(if engine/ or server/ changed) `cd server && npm test` all pass; `npm run build`
if web/ or engine/ changed, and commit the rebuilt `docs/`.

## Architecture

```
engine/      pure TS, no I/O, no DOM, no Node APIs. Runs in the browser AND on the server.
  core.ts      W/Id types, fail()/GameError, ids, rng, transfer(), gazette(), earn/spend Influence,
               meters, cards, office lookups (hasPower, holderOf), calendar (nextAt), formatting
  politics.ts  convention (players add options and clauses; majority settles, deadline closes), induction week,
               parties, elections (national top-N + countback), PM, coalitions, HOS, objectives
  tutorial.ts  TUTORIAL induction missions; ticked by command in run(), or by 'tutorial.visit' for reading ones
  proposals.ts proposal kinds and clauses, debate → vote → assent → enact, PMQs, lobbying
  offices.ts   POWERS, TEMPLATES, createOffice, appoint, grant/fine
  economy.ts   payday, tax, Reserve rate, banks, ventures
  foreign.ts   5 nations, envoys, treaties, intel, the army
  backroom.ts  cards, deals, demands, plots/coups, exile, pardons
  society.ts   press, front pages, court, crisis spawning and deciding
  crises.ts    CRISES and their lifecycle: spawn (weighted, no repeats), PM decide or `house` MP vote,
               timeout (last option), `then` chains queued in w.crisisQueue and fired by the clock
  clock.ts     collect() = every pending deadline; advanceTo(t) runs them in time order
  world.ts     createWorld('convention'|'running') for the demo; createLiveWorld(people) for real
  view.ts      viewFor(world, me) — the redacted copy one player may see
  migrate.ts   migrate(world) — upgrades a saved world on server boot
  alerts.ts    needs(view, me) — what needs a player now; Today, the sidebar badge and personal webhooks
  catalog.ts   CATALOG — public description of every player command and its args (served by /api/v1/commands)
  index.ts     COMMANDS table; run(world, actor, cmd, args) applies one to a structuredClone
  bots.ts      bot turns: botsAct (demo, smoke) and actBots(w, isBot) — the clock runs practice bots during induction
  streets.ts   real life, opt-in: safe zones, contracts (tag codes, claims, ghosts), bodyguard, sweeps, check-ins,
               bounties, stalls and orders (escrow), civic jobs (a bill clause `job`; `zone` adds a safe zone)
  markets.ts   betting pools on bills, elections and crises; opened and settled by those systems
  glory.ts     achievements (BADGES, from c.life counters via bump()), the daily Red Box and streaks, weekly polls,
               season awards, the Hall of Fame (w.fame, kept through induction and RO resets); afterChange()
web/src/     Preact + Vite. main.tsx (router, tabs), store.ts, ui.tsx (shared components),
             Sidebar.tsx, DemoPanel.tsx (demo only), pages/*.tsx, styles.css
server/      app.ts (first-party routes), public.ts (/api/v1 for players' own apps), db.ts (pg or PGlite + SCHEMA),
             security.ts (passwords, lockout, headers, rate limits), oauth.ts (Discord/Google/Microsoft/Apple),
             passkeys.ts (WebAuthn: v2_passkeys, routes), images.ts (photos: v2_images, JPEG-only, metadata stripped),
             server.ts (boot/env), test.ts
SECURITY.md  threat model, every finding and fix, what's accepted, and how to set up each sign-in provider
API.md       public API docs for players. examples/ holds starter kits (one-file client, WhatsApp/Discord
             Gazette bots, vote reminder, webhook receiver); keep them working when the API changes.
docs/        GitHub Pages output. Hand-kept: config.js, icons/, manifest.webmanifest, sw.js
scripts/     smoke.ts, copy.ts (the copy desk: extract strings with the TS compiler API, apply edits)
copy/        STYLE.md (the house voice), edits.json (reviewed rewording in progress)
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
- Saves the whole world after every change, coalesced in production (`saveEvery` 20 s: the first write is immediate,
  the rest of a burst becomes one trailing write; `flush()` on SIGTERM). Tests use 0. This keeps Neon's free tier alive. `v2_log` gets every action (ok or error).
  `v2_snapshots` gets the world before an RO reset.
- Sends only `viewFor(world, me)`, plus `me` and `serverNow`.

### Routes

| Route | Auth | Body → reply |
|-|-|-|
| `GET /api/health` | — | `{ok, now, phase}` |
| `POST /api/login` | — | `{username, password}` → `{token, me}`. Rate-limited 10/min/IP. Adds a missing citizen. |
| `POST /api/signup` | — | `{username, display_name, password, who?, invite?}` → `{token, me}` or `{waiting:true}`. Needs `flags.openSignup` unless `invite` is a live invitation (then no approval). `who` ("who are you in the chat") is required when approval is on; it's stored on the `pending` entry for the RO |
| `GET /api/invites/check?code=` | — | `{name}` for a live invitation |
| `GET/POST /api/admin/invites`, `/api/admin/invites/revoke` | RO | single-use 7-day links (`v2_invites`, codes stored as sha256), `{name}` or `{names:[…]}` (≤30); making and revoking are announced |
| `GET/POST /api/invites` | user | a trusted player's own invitations, from their allowance (`v2_invite_allowance`); the Gazette and `citizen.invitedBy` record who invited whom |
| `POST /api/admin/invites/allow` `{citizen, n}`, `GET /api/admin/allowances` | RO | invitation allowance 0–10; announced |
| `GET/POST /api/admin/notes`, `GET /api/admin/devices` | RO | private notes per citizen/applicant (`v2_notes`); accounts that shared a browser (`v2_devices`, from the hashed `X-Realm-Device` id the site sends). Neither is in the world |
| `POST /api/admin/duplicate` | RO | `{dup, keep}`: runs `admin.duplicate` (crowns moved, open votes struck, posts lost, citizen inactive) and switches the login off. `/api/act` refuses that command |
| `GET /api/state` | user | → `{world, me, serverNow}` |
| `POST /api/act` | user | `{cmd, args}` → `{world, me, serverNow}`; 400 `{error}` on GameError |
| `POST /api/password` | user | `{current, next}` → `{token}`; bumps token_version. `current` not needed if the account has no password yet |
| `POST /api/logout-all` | user | bumps token_version → `{token}` for this device |
| `GET /api/me/security` | user | `{username, password, lastLogin, identities[], providers[]}` |
| `GET /api/oauth/providers` | — | configured providers `[{id, name}]` |
| `POST /api/oauth/begin` | — (user for `mode:'link'`) | `{provider, mode, browser}` → `{url}` to send the browser to |
| `GET/POST /api/oauth/:p/callback` | — | provider redirects here; sits *before* the CORS check (Apple POSTs from its own origin) |
| `POST /api/oauth/finish` | — | `{flow, browser}` → `{token, me}` / `{linked}` / `{waiting}`; single-use, same browser only |
| `POST /api/oauth/unlink` | user | `{provider}`; refused if it's your last sign-in method |
| `GET /api/passkeys`, `POST /api/passkeys/register/begin` → `/finish` | user | `{flow, options}` → `{flow, response, name}`; max 10; needs an allowed `Origin` (it's the WebAuthn RP ID) |
| `POST /api/passkeys/login/begin` → `/finish` | — | `{flow, options}` → `{flow, response}` → `{token, me}`; usernameless (discoverable keys) |
| `POST /api/passkeys/rename`, `/remove` | user | `{id, name}` / `{id}`; remove refused if it's your last sign-in method |
| `GET /api/images/:id` | — | the JPEG; mounted before CORS (an `<img>` sends no Origin) |
| `POST /api/images` `{data}`, `GET /api/images`, `POST /api/images/delete` `{id}` | user | upload (base64 JPEG ≤140 KB, 25 per player) → `{id}`; an action with `args.photo` must name your own live photo |
| `POST /api/admin/images/remove` | RO | `{id, reason}`; announced |
| `GET /api/admin/export` | RO | full unredacted world |
| `POST /api/admin/password` | RO | `{citizen}` → `{temp}`; announced in the Gazette |
| `POST /api/admin/reset` | RO | `{confirm:'RESET THE REALM'}`; snapshots first |
| `GET /api/keys` | user | the caller's live API keys (no secrets) |
| `POST /api/keys` | user | `{name, scope:'read'\|'act'}` → row + `key` (shown once). Max 5. |
| `POST /api/keys/revoke` | user | `{id}` |
| `GET/POST /api/apps`, `/api/apps/update`, `/api/apps/delete` | user | register your apps (max 3); delete revokes every key it issued |
| `GET /api/apps/info?app=` | user | app details for the consent screen |
| `POST /api/authorize` | user | `{app, scope, state}` → `{redirect}` = registered redirect + `#key=…&scope=…&state=…` |
| `GET/POST /api/hooks`, `/api/hooks/delete`, `/api/hooks/test` | user | webhooks (max 3, https); `kind` `gazette` or `personal` |
| `POST /api/apps/review`, `/api/apps/unreview` | user | `{app, stars 1–5, text}`; one per player per app, not your own |
| `GET /api/admin/apps`, `POST /api/admin/apps/remove` `{app, reason}`, `/restore` | RO | take-down revokes all its keys, published |

**Public API `/api/v1/*`** (`server/public.ts`, documented for players in `API.md`):
`GET /`, `GET /commands` and `GET /apps` (directory) need no key; `GET /me`, `GET /state`
(`?since=&wait=` long-poll, ETag), `GET /gazette?since=`, `POST /act` and `/hooks*` need
`Authorization: Bearer rlm_…`.
Apps, Sign in with the Realm and webhooks live in `server/apps.ts` (tables `v2_apps`, `v2_hooks`,
`v2_api_keys.app_id`). After every save, new Gazette entries are POSTed to webhooks, signed
`X-Realm-Signature: sha256=HMAC(secret, body)`; hosts resolving to private IPs are refused (SSRF).
Gazette entries made through `/api/v1/act` get `via: <key name>` (the bot badge).
**Personal hooks** get `needs()` from `engine/alerts.ts`, computed on `viewFor(world, owner)` (never the
full world) after every save; `v2_hooks.seen` holds the alert keys already sent. If you add a new kind
of alert, give it a stable `key`. `GET /api/v1/alerts` returns the same list.
The consent page (`#/authorize`) refuses to render inside a frame (clickjacking).
Keys are stored as sha256 in `v2_api_keys`; session JWTs are refused there and keys are
refused everywhere else. CORS is `*` (no cookies exist, so nothing ambient to steal).
120 req/min/key. `act` needs scope `act` and a cmd in `CATALOG`, so `admin.*` is unreachable.

Auth is `Authorization: Bearer <jwt>`, JWT `{id, tv}` signed HS256 with `JWT_SECRET` (≥24 chars or the server won't boot), 30 days,
refreshed via the `X-Realm-Token` response header after 7. Passwords: `passwordProblem()` for every new one, bcrypt cost 12,
lockout after 5 failures (`v2_accounts`). **Never link a provider identity by email** (see SECURITY.md O6).
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
4. **Rules change only through Parliament.** The RO's powers are exactly: approve sign-ups,
   toggle `requireApproval`/`openSignup`, move the calendar, start a crisis, force-enact a stuck
   bill, reset a password, make or revoke an invitation, give a player invitations, remove a duplicate account, remove or restore a player app, add or remove a Streets safe zone, take down a
   bounty or a photo, export, reset the realm. The safe-zone, bounty and photo powers exist for real-world safety only. Don't add RO
   powers over game rules. **Every one of them goes through `adminDid()`** (engine/core.ts), which
   writes the public admin log and the Gazette. A new admin power must too.
5. **The RO is a full player** and can stand, vote and hold any office. **Check offices before
   admin. Never short-circuit.** Uzair holds offices too;
   `if (admin) return` at the top of a permission check removes his office powers.
6. **The world is JSON.** No functions, classes, Dates, Maps or undefined-as-meaning.
7. **One citizen, one vote.** Votes are keyed by citizen id; ids come only from the token or key.
8. **`/api/v1` is a public contract.** Players' apps depend on it. Add fields and commands
   freely; never rename or remove them, or change a command's args incompatibly. A breaking
   change means a new `/api/v2` alongside. Keep `API.md` and `CATALOG` in step with the code.
9. **Validate every argument in the engine.** Third-party clients send anything. `run()`
   rejects non-JSON, long strings and deep nesting; each command must still check that enums
   are one of the allowed values before storing them.
10. **Security changes get a line in SECURITY.md.** Keep the findings table true.

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
- **The Convention** settles a clause when a majority of all citizens (`conventionNeed`) back one
  option, and closes at `convention.closesAt` (3 days), when every open clause takes its leading option
  (ties → `def`). Player-tabled clauses (`kind` 'custom' or 'setting') need more Adopt than Reject.
- **Induction week**: `finishConvention` snapshots the world into `w.induction.snapshot`, then 7 days of
  practice (everything works, the backroom too; Gazette entries carry `practice: true`). `endInduction`
  restores the snapshot in place, keeping citizens' `tutorial` and Streets opt-in/codes/streak, new citizens, `pending`, `adminLog`, the Red Box, safe zones, rng
  and flags, then opens the real first election. `viewFor` never copies the snapshot. Anything that must
  survive induction has to be added to the keep-list in `endInduction`.
- **Practice bots** (`config.practiceBots`, default 4) are citizens with `bot: true`, added after the snapshot
  so they vanish at the end of induction. The clock gives them a turn every 2 hours (`induction.nextBotAt`).
- **The Streets are real life.** Keep them opt-in (`c.streets.in`), never collect locations, never let crowns
  be bought or cashed out. Tag/meet codes are secrets: strip them in `viewFor`, rotate after use. Ghosts
  (`ghostUntil`) are gated in `run()` by `isGhostOk(cmd)`; a new command ghosts may use goes in `GHOST_OK`.
- **Counters**: `tick()` also bumps `c.life` (all-time) and `c.stats` (this season, reset by `assignAmbitions`).
  Use `bump(w, id, key)` for anything an achievement, award or record should count.
- **Voting methods**: `config.voting` (single, ranked = STV/IRV, approval, borda) is copied onto each election
  as `e.method` when it opens. Ballots are an id (single) or a list (others). `config.billVoters` ('mps'|'all')
  and `config.passRule` ('cast'|'seats'|'twothirds') are copied onto each proposal (`voters`, `rule`);
  `passCheck()` in proposals.ts is the one place that decides a pass. All are chosen at the Convention.

## Playbooks

**Add a player action**
1. Write the rule in the right `engine/<system>.ts`: validate with `fail('…')`, mutate `w`,
   announce with `gazette(w, kind, text, '#/route')`, move money only with `transfer()`.
2. Register it in `COMMANDS` in `engine/index.ts` as `'area.verb': (w, me, a) => …`,
   and describe it in `CATALOG` in `engine/catalog.ts` (unless it's `admin.*`). Add it to `API.md` only if it needs explaining.
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

- Commit and push straight to `main` (Uzair's call). Pushing to `main` deploys, so run the definition-of-done
  checks first. `v2` is kept in step with `main`.
- **Never overwrite `docs/config.js`.** It holds the real `API_BASE`
  (`https://democracy-sim-1.onrender.com`). `npm run build` leaves it alone; check
  `git diff --cached --name-only` doesn't list it before committing.
- Commit the rebuilt `docs/assets` and `docs/index.html` with any web/engine change —
  Pages serves `docs/` straight from the branch, there is no CI build.
- Merging to `main` deploys both: Render redeploys the API, Pages republishes `docs/`.
- A brand-new database has no admin: set `ADMIN_USERNAME`, `ADMIN_PASSWORD` (and `ADMIN_NAME`) on Render for the first
  boot, then remove the password. Boot also prunes `v2_log` to 45 days and keeps the 5 newest snapshots.
- Render env: `DATABASE_URL`, `JWT_SECRET` (the v1 value), `ALLOWED_ORIGINS`, `NODE_VERSION=22`, `PUBLIC_URL`, and any
  `DISCORD_/GOOGLE_/MICROSOFT_/APPLE_*` sign-in settings (SECURITY.md).
- `.github/workflows/keepawake.yml` pings `/api/health` every 10 min, 06:00–00:59 UTC.

## Frontend design

Paper-and-ink civic look: Gloock headings, Atkinson Hyperlegible body, the seal, rubber
stamps and passport visas, teal and red accents on warm paper; full dark mode. Phone:
bottom tab bar, one column. Desktop: sidebar and wide-screen columns. Page changes use
view transitions. Use the existing CSS variables and components rather than new styles.
No generic AI look: no Inter/Roboto/system fonts, no purple gradients, no cookie-cutter
cards. Copy is plain British English, second person, short sentences.
