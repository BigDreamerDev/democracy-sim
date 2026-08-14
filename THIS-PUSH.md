# This push

Merged onto `main` as of `70e0c8e`. `docs/config.js` is untouched;
`docs/styles.css`, `docs/app.js` and `docs/acts.js` are your versions with my
edits folded in by hand. Your Prime Minister page, the `tied` bill status and
the Speaker's casting-vote desk item are all still there.

18 server suites and 7 frontend checks. Read [MONEY.md](MONEY.md) for the
Treasury and the Fed, and §5 and §7.1 of
[docs-src/REFERENCE.md](docs-src/REFERENCE.md) for the world map and what the
Returning Officer may not do.

## Apply the schema first

`server/schema.sql` on `main` never got the Prime Minister tables, but
`server/server.js` on `main` queries them — `/api/prime-minister` and any tied
division have been throwing 500s on the live instance. This push adds those,
plus `schema-money.sql` and `schema-diplomacy.sql`. All additive and idempotent:
no column altered, no key changed. **Snapshot Neon first anyway.** The server
runs them on boot, so deploying is enough.

## Diplomacy is merged

Forward-ported from the older tree: `server/diplomacy.js`,
`server/schema-diplomacy.sql`, `server/llm/providers.js`, and its five
documents. Off until you set `diplomacy_enabled` to `true`.

The front end was already waiting — your `acts.js` had the whole Foreign Office
view and all 66 `dip-` CSS rules, and it never rendered only because the
endpoint 404'd.

**The multi-agent cabinets already existed.** `foreign_governments` sets a
decision method, a threshold and a round cap; `foreign_agents` gives each
minister a role, model and system prompt; a turn snapshots public state plus
recent memories and dispatches, every minister proposes, they vote in bounded
rounds, and a deterministic controller picks and validates one action. One turn
per power per cycle, enforced by a unique constraint. What was thin was the UI
and the model defaults, not the mechanism.

### One bug fixed on the way in

The tribute payrun debited the Treasury and wrote a ledger row to `to_id NULL`.
Money destroyed: `sum(accounts.balance)` walked negative once per cycle per
ratified treaty, for as long as the feature has existed. The power's account is
credited now. `foreigntrade.mjs` never ran a payrun, which is why it stayed green
the whole time; it runs two now and asserts the total across both.

Also: `circulating` was counting foreign holdings as domestic money, and
`schema-acts.sql` still described `owner_kind` as three kinds when the code uses
seven.

## The world map

Real coastlines, invented countries.

`docs/world-map.js` — 121KB, 173 territories, SVG paths projected at build time
from Natural Earth 110m into a 1000×500 viewBox. No projection library, no
TopoJSON client, no build step; `docs/` stays a static site.

**Standing is the fill**, allied through at war on a fixed cool-to-warm scale.
**Recognition is the border** — solid if recognised, dashed and hatched if not,
because a power is on the map because it exists, not because the House said so.
Both are fixed hexes rather than theme variables, so switching to dark mode does
not mean learning the map twice. Unclaimed land is flat and unlabelled. Click or
tab to any country for the power's card.

**Real country names never appear to a player.** They live in `TERRITORY_NAMES`
and render only in the Returning Officer's console, where somebody has to know
which shape they are handing out. `test/worldmap-view.js` asserts the leak
cannot happen — one visible "United States of America" collapses the conceit.

Territory is the Returning Officer's to draw and no officer's: nothing in the
constitution says who could give away land. Ground another power already holds is
refused with `409` rather than transferred, so redrawing a border takes two
deliberate acts. The RO console has a picker; `dev.js` seeds three powers
(Valtia allied, Korrin hostile, the Meridian League neutral) so the preview has a
world on it.

## The Foreign Minister

A new office, shaped exactly like the Treasurer: appointed by the Prime
Minister, or by the President where there is none, and dismissable by whoever
appointed them. Article 7.1 applies, and `/api/admin/office` refuses it — the
Returning Officer has no back door here either.

It holds the channel abroad and **binds nothing**. Treaties, recognition and
emergencies still arrive as bills. While the office is filled the President may
no longer send dispatches: they assent to treaties, and negotiating what you
then assent to is one person doing both halves. The President picks the channel
back up automatically whenever the office is vacant.

Card on the diplomacy page, salary in the payrun, and `dev.js` seeds one.
19 suites now — `foreignoffice.mjs` covers it.

## The intelligence service — framework only

Tables, clearance, the declassification clock and the public register are built.
Collection, analysis and the Director are not. The design argument is in
[INTELLIGENCE-AND-WAR.md](INTELLIGENCE-AND-WAR.md); the short version is that
the body of a report is sealed for a fixed number of cycles and **nothing else
about it ever is** — not that it exists, not who filed it, and not who read it.
Reading a sealed report writes an audit row as a condition of answering.

Nothing exists until the House creates the service by bill.

## What is not done

- **Recognition still has to be moved as a bill and passed** before the map shows
  a solid border. That is correct, but it means a fresh world is all dashes until
  the House votes.
- **Model providers default to `mock`.** Cabinets run and vote, but say nothing
  interesting until you configure a real provider per minister.
- **Ties in ordinary elections** are still decided by display-name order. The
  People's Justice ballot leaves the seat vacant instead; the rest do not.

## Verifying

```
cd server && npm install
npm test               # 18 suites
npm run test:layout    # 7 checks
```

`test:layout` reports 5 failures in `layout.js` alone. Those predate all of this
— the check breaks on the installed jsdom version, not on the app. The other six
pass, including the new `worldmap-view.js`.
