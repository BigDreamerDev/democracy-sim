# CLAUDE.md — The Realm (v2)

A political game for a WhatsApp group of ~19 people. Static front end on GitHub
Pages (`docs/`), Express API on Render (`server/`), Postgres on Neon. All free tier.

Owner is **Uzair** (username `admin`), the Returning Officer, who also plays.

```
npm install && npm run dev          # the demo: whole game in the browser, one person plays everyone
npm run smoke                       # engine smoke test, two scenarios, ledger must balance
cd server && npm install
npm run dev                         # API on :4321, in-memory Postgres, users admin/amara/bilal pw "password"
npm test                            # server end-to-end on PGlite: auth, act, secrecy, clock, restart
cd .. && npm run dev:online         # the real UI against that local server
npm run build                       # builds into docs/ (only docs/assets and docs/index.html change)
```

## Shape

```
engine/    pure TS, no I/O. The world is one JSON object. Shared by the browser and the server.
  core.ts       types, ids, money (move), gazette, influence, meters, calendar helpers
  politics/proposals/offices/economy/foreign/backroom/society.ts   the six systems
  clock.ts      collect() lists every deadline; advanceTo(t) runs them in order
  world.ts      createWorld (demo scenarios), createLiveWorld (real accounts)
  view.ts       viewFor(world, me): what one player may see. The server only ever sends this.
  index.ts      COMMANDS table and run(world, actor, cmd, args) on a clone
  bots.ts       demo only
web/src/   Preact UI. store.ts is demo or online depending on window.API_BASE.
server/    app.ts (routes), db.ts (pg or PGlite, schema), server.ts (boot), test.ts
docs/      GitHub Pages output. config.js, icons/, manifest, sw.js are hand-kept.
```

## How the server works

- One world row (`v2_world.state`, jsonb), loaded at boot, saved after every change.
- Every write goes through one promise queue (`serial`), so requests never interleave.
- Before every read or action the world is caught up to the real clock (`catchUp`).
  A server that slept for hours replays every missed deadline in order on wake.
- `v2_log` records every action, `v2_snapshots` holds the world before a reset.
- Citizens are `'u' + users.id`. The `users` table is v1's, unchanged: bcrypt cost 10,
  JWT `{id, tv}`, `tv` = `token_version`. Bumping `token_version` signs a user out everywhere.
- Admin-only routes outside the game: `/api/admin/export`, `/api/admin/reset`, `/api/admin/password`.

## Invariants

**The ledger sums to zero.** Money only moves between accounts; the Reserve's negative
balance is the money supply. `npm run smoke` and `server/test.ts` both assert it.

**Secrets live only on the server.** Ballots, other wallets, cards, deals, plots, ambitions,
objectives, intel and classified offices are stripped in `viewFor`. Any new secret field
must be stripped there too, or every player can read it from devtools.

**The rng never leaves the server** (`viewFor` zeroes it), or draws could be predicted.

**The client is untrusted.** It runs commands locally only to show a result instantly;
the server re-runs them and its reply replaces local state.

**Rules change only through Parliament.** The RO can approve sign-ups, toggle the two
sign-up flags, move the calendar, force-enact a stuck bill (logged), reset passwords
(announced in the Gazette) and reset the realm. Nothing else.

## Traps

**Check offices before `admin`. Never short-circuit.** Uzair is the RO and plays.

**A mismatched `ALLOWED_ORIGINS` used to return 200 with no CORS header.** Now it
returns 403 with the origin named and logs it. If the site says it can't reach the
server, check Render's logs for "Refused origin".

**Deadlines are lazy.** Never write code that assumes a deadline ran "on time". It runs
when the world is next caught up, with `w.now` set to the deadline's own time.

**Don't put functions or class instances in the world.** It is JSON in, JSON out.

**Changing the world's shape needs a migration** in `server/app.ts` after load, because
the live world persists across deploys.

## Deployment

`docs/` is served by GitHub Pages from the default branch; `server/` runs on Render
(rootDir `server`, but it imports `../engine`, so the whole repo must be checked out,
which Render does). Schema is additive and idempotent and runs on boot —
**snapshot Neon before any push that changes it.**

**Never push `docs/config.js` from a local tree.** It holds the real `API_BASE`.
`npm run build` never touches it.

`.github/workflows/keepawake.yml` pings `/api/health` every 10 minutes, 07:00–01:00.

## Frontend design

Paper-and-ink civic aesthetic: Gloock headings, Atkinson Hyperlegible body, seal and
stamps, teal/red accents, light and dark. Phone gets a bottom tab bar, desktop a sidebar
and wide-screen columns. Avoid generic AI-looking UI: no Inter/Roboto, no purple
gradients, no cookie-cutter cards. Keep motion to a few high-impact moments.
