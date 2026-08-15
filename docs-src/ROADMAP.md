# Roadmap — subdivisions, a generated world, and money that can run

Written after the transaction fixes landed. Nothing below is built. It is the
argument for what to build and in what order, so the order can be argued with
before anyone writes it.

Five strands, deliberately separated because they fail independently:

1. [The subdivision selector](#1-the-subdivision-selector) — built, bugged, diagnosed here
2. [Exporting the nation as SVG](#2-exporting-the-nation-as-svg)
3. [A generated world](#3-a-generated-world)
4. [Foreign governments people can actually set up](#4-foreign-governments-people-can-actually-set-up)
5. [Defection, offshore money and forex](#5-defection-offshore-money-and-forex)

---

## 1. The subdivision selector

### What is wrong, specifically

`docs/world-subdivisions.js` is **2.9 MB** holding **2,576 ADM1 shapes**, loaded
by `docs/index.html:93` as a **blocking script on every page load for every
user**, before `acts.js` runs. On a phone on mobile data that is the whole
experience: the shell cannot paint until it parses. This is the single largest
cause of "very bugged" and it costs nothing to fix.

Three concrete defects, in the order they bite:

**a. It is in the service worker's precache, and `addAll` is all-or-nothing.**
`docs/sw.js:10` lists `./world-subdivisions.js` in `SHELL`, and `sw.js:14` calls
`c.addAll(SHELL)`. If any one of those fetches fails — flaky signal, storage
quota, a 3 MB timeout — **the entire install rejects and the worker never
activates**. So the offline shell silently stops existing, and every load
retries the 3 MB. This is likely why it feels intermittently broken rather than
consistently slow.

**b. The codes leak the real world more completely than names would.** The file
header says it holds "geometry and opaque subdivision codes only". The codes are
ISO 3166-2: `AE-AJ`, `AF-…`, `AL-…`. `AE-AJ` is Ajman, United Arab Emirates. A
player types `Object.keys(WORLD_SUBDIVISIONS.shapes)` in the console and has the
entire real-world mapping — no name table required, because the identity is *in
the key*. This is the same invariant as `TERRITORY_NAMES`, failed harder: names
can be moved server-side, keys cannot, because the client indexes by them.

**c. Clutter is a rendering problem caused by a data problem.** 2,576 shapes at
a 1000×500 viewBox means most subdivisions are a handful of pixels. No amount of
CSS fixes that; the geometry has to be simplified per zoom level.

### The fix, in order

- [ ] **Renumber the codes.** Regenerate with opaque sequential IDs (`s0001`…),
      keeping the real ISO code only in the generator's side-table and in the
      RO-only server route. This has to happen first — everything else is
      cosmetic while the map announces itself.
- [ ] **Take it out of `SHELL`.** Precache the shell; fetch subdivisions on
      demand. If it stays precached at all, use individual `cache.put` calls
      that are allowed to fail, never `addAll`.
- [ ] **Stop loading it in `index.html`.** Load on first entry to the map view,
      `await import()` or an injected tag, with a spinner. Most sessions never
      open the map.
- [ ] **Split by territory.** One file per parent territory
      (`subdiv/<code>.json`), fetched when that territory is opened. No session
      needs all 2,576.
- [ ] **Simplify per zoom.** Two or three Douglas-Peucker passes at generation
      time; render the coarse set until the user zooms in. Fixes the clutter and
      cuts the bytes again.
- [ ] **Then** re-examine alignment. Both files already declare `1000×500`, so
      the projections agree — I suspect the alignment complaints are the clutter
      and the missing-render-while-loading, not a real projection mismatch. Worth
      confirming before anyone reprojects anything.

**Estimate:** the first three are an afternoon and fix most of the felt
bugginess. Splitting and simplification are a day of generator work.

---

## 2. Exporting the nation as SVG

Small, self-contained, and the most likely to actually get used in the group
chat — which is where this game really lives.

- [ ] `GET /api/world/export.svg` — server-side, so it cannot be forged and so
      the export is identical for everyone.
- [ ] Union of the Republic's held territories, one outline, no internal borders
      unless asked. The flag's palette from `L001`, since everything else in the
      app already re-skins from the Flag Act.
- [ ] Query parameters worth having: `?borders=1` for internal subdivision
      lines, `?labels=0`, `?scale=`, `?bg=transparent`.
- [ ] A PNG variant via the same path is tempting and should be resisted — it
      needs a rasteriser on Render. Let the browser do it: a **Download PNG**
      button that draws the SVG to a canvas client-side.
- [ ] Put the button on the map view and on the Foreign Office card.

**Watch:** the export must respect the same opacity rule as the map. Exporting
with ISO codes in `id=` attributes would leak the world into every image shared
in the chat. Strip or renumber IDs in the export.

---

## 3. A generated world

The most interesting item and the one with the most ways to go wrong. The goal:
unclaimed territory becomes plausible nations, naturally shaped, named for where
they are, sized so that some are stronger than the Republic, some weaker, and a
few comparable.

### Shape: grow, don't partition

Voronoi over random seeds gives you convex polygons that look like a diagram.
Real borders are grown and constrained. So:

- [ ] Seed `n` capitals on unclaimed territory, weighted away from each other.
- [ ] **Flood-fill outward by adjacency**, one territory at a time, each nation
      taking the cheapest neighbour available to it. Cost rises with distance
      from the capital and falls along shared coastlines — that alone produces
      the elongated coastal states and blobby interior ones that read as real.
- [ ] Stop each nation when it hits its **power budget** (below), not when it
      hits a size. Two nations of equal strength should be allowed to be very
      different sizes.
- [ ] Leave genuine gaps. A world with no unclaimed land looks generated.

### Power: budget first, territory second

Decide the *distribution* before the map, or you get a world where geography
accidentally decides politics.

- [ ] Express every power as a multiple of the Republic's current strength —
      reuse whatever `war.js` already computes for the front line, so "stronger
      than us" means the same thing on the map as it does in a conflict.
- [ ] A defensible default spread for ~8 neighbours: one at ~2.0×, two at
      ~1.3×, two at ~1.0×, two at ~0.7×, one at ~0.4×. The Republic is
      mid-table, has someone it can plausibly beat, and someone it cannot.
- [ ] Recompute the spread when the Republic's own strength moves, but **never
      retroactively** — a neighbour that got stronger because we did is a
      rubber-band and players will spot it immediately and stop caring.
- [ ] Strength should come from territory, not be pasted on it: sum the
      subdivisions' notional output. Then conquering land actually means
      something, which is the whole point of having a map.

### Names: location-based, never real

- [ ] Derive from latitude band, coastal/interior, and a syllable table per
      region, so a northern coastal state gets a northern-coastal-sounding name
      and neighbours sound related to each other.
- [ ] Hard filter against a real-place list at generation time. A generator that
      emits "Norwaya" has failed.
- [ ] Deterministic from a stored seed, so the world can be regenerated
      identically and the RO can preview before committing.
- [ ] Generate **server-side**, store the result, and only ever ship the stored
      result. A client-side generator hands every player the seed and the
      algorithm.

### Order

- [ ] Power budget and the strength function first — it is the part that decides
      whether the world is fun.
- [ ] Then growth and adjacency.
- [ ] Then naming.
- [ ] Then an RO preview screen: regenerate, look, commit. No world goes live
      unseen.

**Watch:** recognition is a bill. A generated world arrives entirely
unrecognised — all dashed borders until the House votes, which is correct but
will look broken on day one. Either seed a few recognitions or say so plainly in
the UI.

---

## 4. Foreign governments people can actually set up

**Built.** `server/llm/archetypes.js` holds the catalogue, `runGovernmentTurn`
in `server/diplomacy.js` enforces it, and `server/test/government.mjs` asserts
it — including that an invented `action_kind` writes nothing.

Right now configuring one means knowing a provider, a model ID that passes the
free-tier allowlist, and writing system prompts per agent. That is why it is
"quite useless" — the setup cost is paid before any fun is had.

### Make it work with zero configuration

- [x] **Ship archetypes.** A dropdown of complete, pre-written governments:
      *military junta*, *merchant republic*, *absolute monarchy*, *one-party
      state*, *theocracy*, *federal democracy*, *revolutionary council*,
      *technocracy*. Each one is a decision method, a cabinet of agents with
      roles and prompts, and a temperament — written once, chosen in one click.
- [x] **One button: "Create a foreign power".** Name, archetype, rough strength.
      Everything else defaulted. Model configuration should be a thing you *can*
      open, not a thing you must.
- [x] **Make `mock` genuinely playable.** Today it returns `action_kind:
      'nothing'` and says "Mock provider takes no action", so an unconfigured
      world is a dead world. A scripted temperament — belligerent powers lodge
      grievances, mercantile ones make offers — means the whole system is worth
      switching on before anyone finds an API key.
- [x] **Test the key at save time.** One cheap call, and say plainly whether it
      worked. Silent fallback through four providers to a generic failure is the
      worst possible diagnostic.
- [x] Show the last turn's deliberation in the RO console: what each agent
      proposed, how they voted, what carried. Debugging a cabinet you cannot see
      is guesswork.

### Government types should change the mechanics, not just the prompt

Otherwise it is a costume. Each archetype should set:

- who decides (`executive`, `majority`, `consensus`, `weighted`) — the machinery
  is already there in `DECISIONS`;
- how fast it can act (actions per cycle);
- what it will never do (a theocracy does not sell its holy sites; a merchant
  republic does not refuse a profitable trade);
- how it responds to pressure (a junta escalates, a federal democracy stalls).

**Watch:** prompt injection is currently handled properly —
`diplomacy.js` allowlists `action_kind` before writing anything, and the system
prompt marks player prose as untrusted. Every new archetype must go through the
same allowlist. A "creative" government that can invent an action kind is a
government players can talk into anything.

---

## 5. Defection, offshore money and forex

The most fun and the most dangerous, because all three touch the ledger — and
the ledger is the thing the whole Republic is trusted on.

**The rule for all of it: `sum(accounts.balance) = 0` survives every feature
here, or the feature does not ship.** Offshore money is money that *moved*, not
money that vanished. Now that `settle()` and `tx()` exist, there is one correct
way to write each of these.

### Offshore accounts

- [ ] A new `owner_kind` (`offshore`), owned by a citizen but held *at a foreign
      power*. Real account, real balance, in the same closed ledger.
- [ ] The point is **opacity, not disappearance**: the balance does not appear
      in the citizen's public account, and the tax payrun cannot see it.
- [ ] It must be discoverable. Intelligence already has clearance, sealed
      reports and a public read register — an intel report naming who holds what
      offshore is exactly what that machinery is for.
- [ ] Consequences need a route: a bill can seize offshore holdings; a treaty
      can compel disclosure. Otherwise it is a strictly-better account and
      everyone uses it.
- [ ] Risk: the power holding it can *keep* it. A power that has been denounced,
      blockaded or gone to war should be able to freeze what it holds. That is
      the trade-off that makes choosing a haven interesting.

### Forex

- [ ] Each power gets a currency and a rate against ours. Rates must move for
      **legible reasons** — trade balance, conflict pressure, issuance — not
      randomly. `war.js` already refuses randomness on principle and forex should
      too; a rate that moves on a die roll teaches players that nothing they do
      matters.
- [ ] Publish the inputs. A rate nobody can predict is a casino; a rate that
      responds to the Fed's issuance and the balance of trade is a lesson.
- [ ] Conversion is two `settle()` calls and a spread to the power. Never a
      single-sided write.
- [ ] Watch the arbitrage loop: A→B→A must never end with more than it started.
      A suite that runs a round trip a thousand times and asserts the total is
      the cheapest insurance available.

### Defection

- [ ] A citizen renounces and joins a foreign power. Constitutionally this is
      real: Article 1.2 ties citizenship to Group membership, so defection needs
      to be an explicit act with an explicit route, not a side effect.
- [ ] They lose the vote, the dividend, and any office **immediately** — an
      officer who defects while holding a seat is the interesting case and the
      one most likely to be exploited.
- [ ] What happens to their money is the real design question. Confiscation
      makes defection unusable; keeping everything makes it free. Somewhere in
      between: domestic holdings frozen pending a bill, offshore holdings kept.
- [ ] A route back, with a cost. Permanent exile ends a player's game, and this
      is a group of nineteen friends.
- [ ] **One person, one vote is enforced by database constraint.** Defection
      must not become a way to hold a vote in two places. Whatever is built, the
      constraint stays and `attack.mjs` grows a case.

### Order

Offshore first — it is the smallest, it reuses the intelligence machinery
already built, and it is the one that makes the Treasurer's job interesting.
Forex second. Defection last, because it needs both of the others to have any
teeth.

---

## Sequencing across all five

The subdivision fixes come first and are not negotiable: everything else in this
document renders on a map that currently takes 3 MB and a failed service worker
install to draw. After that, the SVG export is a cheap win worth shipping on its
own. The generated world is the big one and should not start until the map is
fast. The foreign-government work can proceed in parallel with any of it — it
touches nothing the others touch. The money features go last, and each one gets
a suite that asserts the total across a payrun, not just across a request.
