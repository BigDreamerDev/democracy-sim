# The Republic — Unity Game Design Document

**Status:** Draft v1, brainstormed and scoped from an initial engineering roadmap.
**Relationship to this repo:** A separate future product. The web app in `server/`
and `docs/` is the origin of the simulation's voice and several systems (the
flag-law palette, procedural territory naming, the intelligence/leak
discipline) but this is not a port — it's a new build informed by what the
web app already proved works with a real group of players.

---

## 1. One-line pitch

A satirical political-economy simulator you run *with your friends*, where
the comedy comes from grounded systems reacting to real decisions, not
scripted jokes — presented through a warm, cartoonish 3D world that still
takes its own numbers seriously.

---

## 2. Vision & pillars

Every design decision in this document is graded against these four pillars.
If a system doesn't serve at least one, it's a candidate to cut or defer.

1. **Systemic comedy, not scripted jokes.** The absurdity is emergent: a
   grounded simulation (Democracy 4 / Crusader Kings register) reacting to
   real player choices, wrapped in a whimsical, colorful presentation layer
   (Two Point Hospital register). Both Satirical and Serious presentation
   modes read the same underlying numbers — nothing about *outcomes* changes
   between them, only *voice*.
2. **Friend-vs-friend is the real content.** Procedural foreign nations exist
   to apply pressure and provide texture, not to be the main character. The
   biggest comedy and drama engine is the humans at the table: alliances,
   betrayals, cover-ups, and the group's own shared history. Every system is
   scored on how much player-to-player intrigue it enables, not player-to-NPC.
3. **Cooperative even when adversarial.** Betrayal is a shared story
   everyone enjoys afterward, not a tool for griefing a stranger. This
   matters more once the game reaches a wider audience than one trusted
   friend group — the social contract a friend group gets for free has to be
   designed in for strangers (moderation, session codes, soft anti-grief
   rails).
4. **Survives the vertical-slice test.** A player becomes President,
   promises tax cuts, wins, proposes an irresponsible budget, Parliament
   narrowly passes it, inflation rises, the Fed Chair raises rates,
   businesses start failing, the President blames the Fed Chair publicly, a
   newspaper finds the Treasurer owns a subsidised business, the opposition
   opens an inquiry, approval collapses, the government loses a confidence
   vote — and none of that was a scripted quest. Every phase is judged on
   whether it makes this kind of story *more* likely, not just *possible*.

---

## 3. Audience & platform

- **Primary audience at launch:** small cooperative groups (2–19+ players)
  who already know each other — Discord/friend-group play, matching the web
  app's proven use case.
- **Design target beyond launch:** wider release to groups of strangers.
  This is a hard requirement threaded through the whole document, not a
  stretch goal bolted on later — see §9.
- **Platform:** PC first (Unity 6, Netcode for GameObjects, Unity Transport,
  Multiplayer Services SDK). No mobile/console commitment in this draft.
- **Session ownership:** self-hosted by a player (host mode) at small scale;
  dedicated-server-compatible simulation from day one so a persistent
  Republic doesn't require re-architecture later.

---

## 4. Tone & presentation

### 4.1 The voice

The existing web app's "institutional personalities" already nail this and
should be treated as canon, not just inspiration:

| Institution | Voice |
|---|---|
| Treasury | Accounting denial — a deficit is always "temporarily elevated" |
| Central Bank | Terrifying calm — inflation is perpetually "transitory" |
| Foreign Ministry | Diplomatic euphemism — nothing is ever *bad*, only "complex" |
| Defence/Quartermaster | Readiness jargon, procurement-speak |
| Intelligence | Melodramatic secrecy about administrative trivia |
| Parliament | Procedural obsession — the process matters more than the outcome |
| Courts | Completely dry, deadpan seriousness, zero awareness it's funny |
| Civil Service | Bureaucracy taken to its logical, absurd conclusion |

### 4.2 Satirical vs. Serious mode

One simulation, two string tables and two presentation skins — never two
rule sets (per your own Phase 21 note: "no mechanical fork from Satirical
mode"). A `PresentationMode` flag governs:

- Text/localisation table selection (the same underlying event resolves to
  a deadpan headline in Serious mode, an absurd one in Satirical mode).
- Visual intensity (exaggerated animations, sight gags, and clutter
  accumulation are toned down but not removed in Serious mode — the world
  should still feel *alive*, just less cartoonish).
- Audio sting selection (comedic stings vs. neutral ones).

This is the mechanism that lets the game "still feel realistic to an extent
no matter what," per your direction: the numbers, causality, and consequence
chains never change, only how they're narrated and drawn.

### 4.3 Art direction

Whimsical and cartoonish (Two Point Hospital register) as the default,
built around **state-dependent environments** — the world visibly reflects
the Republic's condition without a UI panel:

- Treasury fills with visible IOU stacks during a deficit.
- Parliament's roof develops a leak if maintenance spending is cut.
- The central bank's printer runs visibly during monetary expansion.
- Intelligence HQ accumulates shredders and redaction marks.
- Government offices get conspicuously more luxurious during a corruption
  arc — the single clearest "show, don't tell" beat in the whole game.

This is the highest-leverage place to spend the "far increasing... scope,
size, and immersiveness" budget the web app fundamentally cannot offer: a
walkable, reactive world.

---

## 5. Core loop

```
Deliberate (Parliament/party/backroom) → Decide (vote/bill/budget/trade/
treaty) → Simulate (cycle tick resolves consequences) → React (media,
population, other players) → Repeat, with the political map shifted
underneath everyone.
```

The loop is identical in singleplayer and multiplayer — see §6.1. What
changes is only how many seats are filled by humans versus AI-driven
fallback behaviour.

---

## 6. Player modes & session structures

### 6.1 Singleplayer is not a separate campaign

Per your direction, singleplayer is the *same simulation* with AI filling
empty seats — not a scripted story mode. This is a major scope reduction
versus a dedicated narrative campaign (no branching authored plot, no
bespoke voiced characters) and it's the right call for a systemic-comedy
game: the vertical-slice story above should be just as producible solo
against AI ministers as it is with seven friends. A "Story Mode" toggle can
exist later as a curated *starting scenario* (a pre-seeded Republic with an
interesting starting crisis) without requiring a separate writing team or
branching-narrative engine.

### 6.2 Session formats (from your Phase 21, retained with light adjustment)

| Mode | Length | Notes |
|---|---|---|
| **Quick Republic** | 45–90 min | Fast cycles, frequent elections, smaller world, accelerated economy — the "onboarding" and party-night format |
| **Standard** | 2–4 hrs | Full loop, moderate world, normal timings — the primary format |
| **Campaign** | Multi-session | Persistent history, slower economy, political dynasties carry across sessions |
| **Persistent Republic** | Ongoing | Dedicated server, scheduled votes, players drift in and out through the week — this is the closest analogue to how your actual group already plays the web app |
| **Chaos** | Short, volatile | High scandal rate, extreme events — built for comedy, not balance |
| **Serious** | Same as Standard/Campaign | Neutral presentation only, per §4.2 — not a separate ruleset |

All six are configurations of one ruleset (cycle length, event frequency,
election frequency, starting world size), not six codepaths.

### 6.3 How the same game actually plays differently at each length

The dial that changes between formats isn't just "more time" — it changes
what kind of story the session is capable of telling.

**Quick Republic (one sitting, one arc).** Built to deliver one complete
vertical-slice story and then end. Cycles advance fast enough that a whole
electoral term fits in the session; there is deliberately room for only
1–2 elections total, so an election reads as *the* climax, not a recurring
beat. Character investment is intentionally shallow — pre-generated
citizens and parties, no character-creator depth, no legacy score, because
there's no time for the payoff. Any office nobody claims fills with AI
immediately rather than waiting, so the session never stalls on a missing
player. At session end, a "final headline" wrap-up narrates however things
stood — there's no requirement that anything actually resolved (a
Parliament mid-collapse when the timer runs out is a fine ending; that's
the story).

**Standard (one legislative term, in full).** The same shape as Quick but
unhurried: room for a real policy fight, a mid-session crisis, and an
end-game reckoning (an election or a confidence vote) without racing the
clock. This is the format the vertical-slice example in §2 is written for.

**Campaign (a dynasty, told over weeks).** The load-bearing addition here
isn't more content, it's **memory**. Past scandals stay on the public
record and can resurface; political dynasties (succession, inherited party
leadership, standing rivalries) carry across sessions; legacy score (§8)
only becomes meaningful once there's enough history for it to score.
Because players won't all remember what happened three sessions ago, each
Campaign session should open on a **"previously on The Republic" recap** —
a front-page-style summary generated by the same media engine that writes
headlines during play (§7.2). This is a new addition to the original
roadmap and a cheap one: it's the headline generator pointed at "what
changed since you were last here" instead of "what just happened."

**Persistent Republic (the spiritual successor to the web app).** This is
the format closest to how your actual group already plays today — worth
naming explicitly, since it's the one existing proof the whole design is
chasing. Real-time or long cycles, players drift in and out through the
week, and decisions can't assume everyone's present: bills and elections
need **async decision windows** (open for N real hours, not until everyone
present votes) the same way the web app already works, not a live-lobby
model. Two rules make long absence survivable rather than a soft-lock:

- **The world doesn't advance in a vacuum.** Cycles pause once the server
  has had zero connected players for a set period, so nobody comes back to
  a Republic that moved on entirely without them.
- **Absence isn't the same as vacancy.** An office-holder inactive for N
  cycles gets administered by the same Acting-office fallback your roadmap
  already specifies for a true vacancy (Phase 2) — reused, not
  reinvented — rather than being force-resigned. They can reclaim the seat
  by returning.

**Chaos.** Mechanically Quick Republic's dial turned further, not a
separate structure: shorter terms, higher scandal/event frequency. It
exists to guarantee a *funny* session even at the cost of a *coherent* one.

**Serious.** Not a length or pacing variant at all — it's the presentation
skin from §4.2 applied to whichever of the above lengths you picked.

---

## 7. Systems — kept, expanded, pruned, and new

Reorganised from your 25-phase roadmap into a design lens: what each system
is *for*, dramatically, rather than just what it contains. Full item-level
mapping is in the Appendix.

### 7.1 Keep as scoped (your roadmap already got these right)

- **Citizens & political offices** (Phase 2) — including the exclusive vs.
  compatible office-combination rules the web app already proved matter
  (Article 7.1-style logic).
- **Parliament** (Phase 3) — bills, divisions, confidence motions,
  committees. This is where a group can genuinely "spend an entire session
  just running Parliament," which is a real, observed outcome of the web
  app worth protecting.
- **Elections & parties** (Phase 4) — including coalition governments,
  whipping, defections. Player-count scaling (small games auto-combine
  portfolios) is essential and should be load-bearing from the first
  playable build, not retrofitted.
- **Budget & taxation** (Phase 5) — the primary "become the villain through
  policy, not through evil-button-pressing" engine.
- **Central bank & money** (Phase 6) — inflation, rates, QE. Same engine
  that produces your vertical-slice story's inciting incident.
- **Courts** (Phase 12) — kept dry and procedural per the existing voice,
  scoped down from a full legal-case engine (see §7.3).
- **Protest, unrest & emergencies** (Phase 20) — high-value comedic and
  dramatic fuel (a general strike over a parliamentary snack ban is exactly
  the register this game wants).
- **Game modes** (Phase 21) — as reorganised in §6.2.

### 7.2 Expand — where the "far increasing scope/immersiveness" budget goes

- **Player-to-player diplomacy, promoted to a first-class pillar.**
  Previously a subset of Phase 14 (which was written foreign-nation-first).
  Needs its own design pass covering: private backroom deals between
  players, coalition betrayal mechanics, a persistent "who owes whom"
  ledger the game deliberately never auto-resolves (Diplomacy-the-board-game
  is the reference point — the tension comes from unenforceable promises
  between real people).
- **Media & satire engine, promoted from Phase 10 to a pillar.** This is
  the game's entire authorial voice, not a feature checkbox. Needs a real
  writers'-room-style content pass: headline templates, euphemism
  generators, department-specific writing styles, dynamic name insertion —
  treated with the same priority as art direction, because for this game it
  effectively *is* art direction.
- **Scandals & evidence as a cooperative minigame** (Phase 11). Your own
  vertical-slice example is already this minigame in miniature. Expand it
  into something players can deliberately *run* on each other: gather
  evidence (public records, leaks, intelligence ops, press investigation),
  assess credibility, decide whether to leak it, watch the political
  fallout play out. This is the single highest "friendslop" system in the
  whole document — it is structurally a social-deduction game riding on top
  of the political sim.
- **Physical presence & immersion** (Phase 23, elevated). A walkable hub
  connecting Parliament / Treasury / Court / Cabinet Room / World Map Room,
  where player avatars are visible to each other between votes, react
  physically to breaking news, and can be "bumped into" for an impromptu
  backroom conversation. This is where Unity earns its place over the
  existing text UI — it should be treated as core, not late-stage polish.
- **Secret personal objectives as a standard feature**, not optional
  (Phase 22) — classic social-deduction fuel ("become President without
  anyone learning you're the Republic's biggest bootlegger").
- **Custom naming / group-authored lore** (extends Phase 25's data-driven
  approach): let players name streets, laws, holidays, and offices. Cheap
  to build (a text field + persistence), disproportionately effective at
  making a Republic feel like *this* group's Republic — matches how real
  friend groups accrete inside jokes over a long campaign, and doubles as
  the mechanism that makes wider release feel personal to strangers too.

### 7.3 Prune hard — and why

| System (roadmap phase) | Cut to | Reasoning |
|---|---|---|
| Foreign currencies & international trade (Phase 15) | A handful of abstracted relationship/trade numbers per foreign power; no independent floating-FX economy, no shipping/blockade logistics layer | This is enormous plumbing that talks almost entirely to NPCs, not friends. It doesn't feed pillar 2. Keep foreign nations as textured backdrop and pressure source, not a second economy as deep as the domestic one. |
| Military & war as unit-level sim (Phases 17–18) | War stays a **political and economic event**: who votes for it, budget strain, public support, peace terms, territorial/reparations outcomes — no formations, manpower, training, or morale sub-simulation | Your own CLAUDE.md already made exactly this call for the web app: *"War is supply, not manoeuvre... No positions, no orders, no dice."* The comedy is "Parliament accidentally declares war," not troop movement. Reintroducing a tactics layer here would be scope-creep against your own established voice. |
| Deep regional/infrastructure sim (Phase 19) | Environmental storytelling only (roof leaks, printer runs) rather than a simulated subsystem with its own balance numbers | Immersive as *presentation* (§4.3), not worth existing as a second parallel economy to tune. |
| Individual citizen simulation | Population blocs, as your own roadmap already specifies (Phase 9) | Reinforcing your own existing call, not a new cut. |
| Deep legal-sim in Courts (Phase 12) | Dry, procedural, outcome-focused — no case-law engine, no jury simulation | Matches existing tone; a legal engine complex enough to be interesting on its own terms would compete with, not serve, the political sim. |
| Eight separate map modes (Phase 13) | One map with togglable overlays, 2–3 to start (political, diplomatic, resources) | Classic scope-creep bait; add overlays later if the base map is actually used. |

### 7.4 New systems not in the original roadmap

- **Backroom/private-deal system** — see §7.2, needs its own interaction
  design (a "meet privately" flow, deal proposals that are recorded but not
  enforced, optional public exposure of a broken promise as content for the
  media engine).
- **Evidence/investigation toolkit** — see §7.2, a genuinely playable loop,
  not just a data model.
- **Custom naming/lore system** — see §7.2.
- **Moderation & anti-grief tooling** — see §9. Not present at all in the
  original roadmap, and required the moment this targets strangers.
- **"Previously on The Republic" recap** — see §6.3. Reuses the media
  engine's headline generator pointed at what changed since a player's last
  session, rather than what just happened.

---

## 8. Victory & objectives

Per your own instinct ("avoid one universal score determining the winner"):
multiple simultaneous, often-conflicting objective types running at once,
so the table's stories don't converge on one leaderboard:

- **Secret personal objectives** (standard, not optional) — e.g. become
  President, finish richest, keep inflation under a threshold, cause
  hyperinflation, pass five constitutional amendments, defect successfully,
  hold three compatible offices, build an industrial monopoly, expose
  foreign spies, cause a government collapse without being blamed for it.
- **Public party/national goals** — visible, so other players can actively
  help or sabotage them.
- **Legacy/history score** — persists across a Campaign or Persistent
  Republic, rewarding the story a player's whole run tells, not a single
  session's outcome.

No mechanical "winner" is declared game-wide by default; objectives are
personal and often mutually exclusive, which is itself a source of
friend-table conflict (pillar 2).

---

## 9. Wider-release adaptations

This is new relative to the original roadmap, required by your answer that
this should eventually leave the founding friend group.

- **Genericise the Republic's identity.** "McServerLandia" and its specific
  lore stay as *this session's* content, not hardcoded defaults. The flag
  palette derivation and territory-name generation the web app already has
  are the right foundation — extend that same procedural-identity approach
  to the Republic's own name, founding myth, and starting conditions, so a
  fresh session for strangers feels authored, not blank.
- **Real moderation tooling from day one** (your Phase 1 already lists
  server admin/moderator commands — treat this as launch-blocking, not
  optional): kick/mute/ban, session join codes with expiry, a report flow,
  and soft anti-grief rails on any system that can meaningfully hurt a
  stranger's session (e.g. rate-limiting how fast one player can move money
  or accuse another, since a trusted friend group tolerates that risk and a
  stranger lobby won't).
- **Onboarding that doesn't assume shared history.** The web app's comedy
  currently benefits from players already knowing each other; the
  Satirical-mode writing (§4.1/7.2) needs to land for a table of strangers
  too, which is why the media/satire engine is scoped as a real writing
  pass rather than a handful of one-off jokes.

---

## 10. Recommended development order

Adjusted from your original order to reflect the pruning above — the shape
is the same, the weight moves off foreign-economy depth and onto
player-to-player systems and presentation:

1. Core simulation architecture
2. Multiplayer foundation (including moderation tooling — not deferred)
3. Citizens/offices
4. Parliament
5. Elections/parties
6. Budget/tax/economy
7. Businesses + strategic goods + corruption hooks
8. Public opinion
9. **Media/satire engine + scandal/evidence minigame** (elevated ahead of
   courts/world/diplomacy — this is pillar-critical, not late dressing)
10. Player-to-player diplomacy/backroom system
11. Courts (scoped down per §7.3)
12. World generation (procedural, simplified per §7.3)
13. Diplomacy (foreign-facing layer, lighter than original roadmap)
14. Intelligence
15. War as political/economic event only (no tactics layer)
16. Infrastructure/regions as presentation only
17. Game modes
18. Physical presentation & immersion (elevated priority — start earlier
    than "only once the simulation is fun," since presence between players
    is itself part of what makes the simulation fun for this design)
19. Modding/polish

## 11. First playable target

Same spirit as your original target, with the two elevated systems folded
in early rather than left for phase 9–10 of a checklist:

- 2–8 multiplayer players, singleplayer via AI-filled seats.
- President, PM, MPs, Treasurer, Fed Chair.
- Elections, Parliament, bills.
- Presidential budget, taxes, Treasury.
- Citizen money, businesses, basic strategic goods.
- Inflation, public approval.
- Parties.
- **Basic scandals with a real evidence/leak loop**, not just a headline
  string (this is the one addition to your original first-playable list —
  it's cheap this early and it's the system most likely to prove pillar 2
  works before investing further).
- News headlines, strong satirical UI.
- Secret personal objectives.
- Save/load.
- Quick and Standard modes.

Diplomacy, intelligence, and war still wait, per your own instinct — if the
small Republic isn't fun when eight players are arguing over a budget and
accusing each other of corruption, nothing later fixes that.

---

## 12. Open questions / risks

- **Netcode complexity vs. team size.** Server-authoritative
  full-state-sync multiplayer with reconnect/late-join is a substantial
  engineering lift on its own, before any game content exists — worth a
  dedicated technical spike before committing to the full Phase 1 list.
- **Writing burden of the media/satire engine.** Elevating it to a pillar
  raises its cost accordingly; needs a real content plan (template count,
  authoring workflow, how much is procedural mad-libs vs. hand-written)
  before implementation, not just a feature list.
- **Moderation tooling scope for "wider release eventually."** How much to
  build now vs. defer is a real tradeoff — building it into the
  architecture from day one (as recommended) is cheaper than retrofitting,
  but is also work that doesn't pay off until the audience actually widens.
- **Backroom/private-deal system fairness.** Unenforced promises are the
  point, but the UX needs care so it reads as "delicious betrayal" rather
  than "the game let me get scammed with no recourse" for a stranger lobby.

---

## Appendix: Full roadmap item mapping

Legend: **K** = keep as scoped · **E** = expand (see §7.2) · **P** = prune/
simplify (see §7.3) · **N** = new, not in original roadmap · **—** =
unchanged from your original phase, no note needed.

| Original phase | Verdict | Note |
|---|---|---|
| 0. Project architecture | — | Retained as scoped |
| 1. Multiplayer foundation | E | Moderation tooling elevated to launch-blocking (§9) |
| 2. Citizens & offices | K | |
| 3. Parliament | K | |
| 4. Elections & parties | K | |
| 5. Budget & taxation | K | |
| 6. Central bank & money | K | |
| 7. Banking & personal finance | K | |
| 8. Businesses & production | E | Corruption hooks feed pillar 2 directly |
| 9. Population & public opinion | K | |
| 10. Media & satire engine | E | Promoted to pillar, §7.2 |
| 11. Scandals, evidence, investigations | E | Promoted to cooperative minigame, §7.2 |
| 12. Courts & crime | P | Dry/procedural, no case-law engine, §7.3 |
| 13. World & foreign nations | P | Map modes trimmed to 2–3, §7.3 |
| 14. Diplomacy | E | Player-to-player layer promoted; foreign-facing layer unchanged |
| 15. Foreign currencies & international trade | P | Abstracted, not a parallel economy, §7.3 |
| 16. Intelligence | K | |
| 17. Military & strategic defence | P | No unit-level sim, §7.3 |
| 18. War | P | Political/economic event only, §7.3 |
| 19. Infrastructure & regional politics | P | Presentation only, §7.3 |
| 20. Protest, unrest, emergencies | K | |
| 21. Game modes | K | Reorganised in §6.2, unchanged in substance |
| 22. Personal objectives & victory | E | Secret objectives made standard, §8 |
| 23. Physical Unity presentation | E | Priority elevated, not "later," §7.2/§4.3 |
| 24. Audio & visual satire | K | |
| 25. Modding & custom games | E | Custom naming/lore pulled forward as a v1 feature, §7.2 |
| — Backroom/private-deal system | N | §7.2 |
| — Evidence/investigation toolkit | N | §7.2 |
| — Custom naming/lore system | N | §7.2 |
| — Moderation & anti-grief tooling | N | §9 |
| — "Previously on The Republic" recap | N | §6.3 |
