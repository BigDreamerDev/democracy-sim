# Intelligence and defection

How the intelligence service actually works, end to end — chartering it,
earning your way up its three tiers, running an operation — and how a citizen
who defects to a foreign power stops being a name in a file and becomes a
subject of it: a cabinet minister, or a contender for a crown.

Trade, treaties, recognition, the map and running an LLM-driven cabinet are
covered elsewhere and not repeated here — see [Related](#related). This
document covers the two systems nothing else documents yet: intelligence
collection and operations, and citizenship after defection.

---

## Part 1 — the intelligence service

### The shape of it

`schema-diplomacy.sql` built a filing cabinet years before anything sat in
it: a charter, a clearance list, sealed reports that declassify on a timer, an
open register of who read what while it was sealed. `server/intelligence.js`
is what put something in the drawers.

Three ideas hold the whole system together:

**No randomness, ever.** Same rule this codebase holds for war and forex. A
mission's result is arithmetic over published numbers — the agency's
tradecraft, an asset's own experience, the budget actually committed, the
target's counter-intelligence rating — never a die roll a player was asleep
for. You can predict whether an operation will work before you order it.

**Progression is the whole design.** A freshly chartered service can only
collect: recruit a human source, run them, sweep for foreign agents working
against the Republic. Nothing at tier 1 writes a foreign power's state. Tier 2
(influence — disinformation, sabotage, turning a foreign official) opens once
the agency has actually done tier-1 work: tradecraft earned, budget actually
spent, missions actually completed — not a hidden switch the Returning Officer
flips. Tier 3 (a coup, a removal) needs an order of magnitude more of the
same, **plus an asset already in place at the target.** The game cannot go
from a fresh charter to regime change in one order, on purpose.

**Nothing here happens off the record.** Every operation writes an
`intel_operations` row whatever became of it. A blown asset and a failed sweep
are on the record exactly like a clean one — "nothing here happened" is not
how this codebase treats consequential action.

### Setting it up

**1. Charter it — this is a bill, not a console toggle.**

```
POST /api/intel/establish   { title, charter, declassify_after_cycles, budget_per_cycle }
```

Anyone who may propose a bill can file this. It becomes a `motion` bill and
goes through the ordinary lifecycle — seconders, the Speaker tables it, a
division, the President assents — same as any other bill. Only once it is
**enacted** does `intel_service` actually get created; a proposed-but-unpassed
charter does nothing.

`declassify_after_cycles` sets how long a report stays sealed before it
publishes itself onto the record. `budget_per_cycle` is the service's ordinary
running cost — separate from what a specific operation spends, which is a
budget you commit per mission (below).

**2. Grant clearance.**

```
POST /api/intel/clearance   { user_id, reason, until? }
```

Returning-Officer only — same authority that already extends to the Fed's
rates, logged the same way. **Clearance is a row in `intel_clearance`, not an
office.** The Prime Minister does not see sealed reports because they are the
Prime Minister; they see them because someone gave them a clearance row, which
can be revoked, and which the public register shows was granted even while its
reason can be redacted. No office confers it automatically.

**3. Check where the agency stands.**

```
GET /api/intel/agency
```

Public, no auth needed. Returns the service's `tradecraft`,
`committed_budget`, how many tier-1 and tier-2 missions have **succeeded**,
and the three gates below — so the House watches the gate fill in rather than
trusting a hidden number.

### The three tiers

| Tier | Name | Gate to open it | What it unlocks |
|---|---|---|---|
| 1 | Collection | open from the charter | `recruit_asset`, `run_collection`, `counter_sweep` |
| 2 | Influence | tradecraft ≥ 30, committed budget ≥ 20,000, ≥ 2 successful tier-1 missions | `disinformation`, `sabotage_trade`, `recruit_mole` |
| 3 | Escalation | tradecraft ≥ 100, committed budget ≥ 150,000, ≥ 3 successful tier-2 missions | `back_coup`, `removal` |

All three numbers in a gate must be true at once. Tradecraft alone from one
lucky mission, or budget alone from throwing money at nothing, does not open
the next tier — the gate specifically wants earned skill, real spend, **and**
completed work, together.

### The operations

```
POST /api/intel/operations   { kind, power_id, budget, asset_id?, codename?, notes? }
```

Requires clearance. `kind` must be one of the eight below — anything else is
refused before it touches a row. This is deliberate: the same allowlist
discipline `runGovernmentTurn` holds a foreign cabinet's proposals to in
`diplomacy.js` applies here, on the Republic's own side of the wire.

| Kind | Tier | Budget per point | Base difficulty | Needs an asset? | What success does |
|---|---|---|---|---|---|
| `recruit_asset` | 1 | 200 | 0 | — | a new source in place at a power |
| `run_collection` | 1 | 150 | 0 | yes | the asset gains experience (makes future missions easier) |
| `counter_sweep` | 1 | 100 | −10 | — | reads how many powers currently stand hostile; never writes a foreign row |
| `disinformation` | 2 | 300 | 20 | — | a temporary counter-intelligence penalty on the target, expiring after 3 cycles |
| `sabotage_trade` | 2 | 300 | 20 | — | cuts stock from the target's largest foreign offer |
| `recruit_mole` | 2 | 400 | 25 | — | a new asset, optionally attached to a specific foreign cabinet seat |
| `back_coup` | 3 | 2000 | 60 | **required** | the target's standing becomes `hostile`, immediately and publicly, whether or not it worked |
| `removal` | 3 | 5000 | 70 | **required** | as above, and on success the asset is marked `extracted` rather than spent |

"Budget per point" is `costUnit` — every that-many committed buys the mission's
score one more point (`floor(budget / costUnit)`). "Base difficulty" is added
to the target's own `counter_intel` rating to get the threshold your score has
to clear; `counter_sweep`'s negative difficulty is why it is the easiest
mission in the catalogue, and the only tier-1 one that needs no target at all.

**How success is decided**, all arithmetic, all published inputs:

```
threshold = op.difficulty + power.counter_intel - active_disinformation_penalty
score     = service.tradecraft + (asset.experience × 2) + floor(budget / op.costUnit)
success   = score >= threshold
```

`power.counter_intel` is a number the Returning Officer publishes and can
adjust (`PUT /api/intel/powers/:id/counter-intel`) — it is the target's
defensive rating, not a secret. Raise the budget and the score rises with it,
with no ceiling — more spend always shortens the odds, it just costs more per
point the higher `costUnit` is set for that operation kind.

**The budget is spent whether or not the mission works.** That is what
"committed" means in the tier gate — money moves for real, into the target
power's own account exactly the way tribute and procurement already move money
abroad, through `ctx.economy.settle()`. A failed operation still cost you.

**Tier 3's blowback is guaranteed, not rolled for.** A coup or a removal that
succeeds sets the target's standing to `hostile` immediately and publicly —
the House does not get to hope nobody noticed. What stays sealed, on the
ordinary declassification clock, is the report's account of *how* it was
done; the standing change itself is public the instant it happens, like any
other diplomatic fact.

### Reading the result

Every operation, success or failure, produces one `intel_operations` row (the
public register: kind, tier, target, outcome, score against threshold) and one
sealed `intel_reports` row (the account of how — declassifies automatically on
`declassify_after_cycles`, readable early only by someone with a clearance
row). Reading a sealed report is itself a public act:

```
POST /api/intel/reports/:id/read
```

writes to the open `intel_reads` register **before** it answers — so anyone
may see that the Foreign Minister read report #14 on Tuesday, even while what
it said stays sealed until it declassifies on its own.

---

## Part 2 — defection and foreign citizenship

### What renouncing actually does

```
POST /api/defection   { power_id, reasons }
```

Renunciation is immediate and public. In one step: every office the citizen
holds is vacated, the reasons are recorded, and their domestic balance is
frozen exactly where it was — not seized, not moved, just unreachable until
the House votes to let them back in. `reasons` needs an actual sentence; this
is a public act, not a checkbox.

**The Returning Officer cannot defect while holding the keys.** They run the
Republic's machinery — elections, approvals, the rules — and there is no
honest version of a foreign subject still running that. Hand the role over
first.

The route back is a bill, not an apology:

```
POST /api/defections/:id/readmit   → creates a bill
```

Somebody in the House has to move it. It is deliberately not free or
automatic — otherwise defection would be consequence-free brinkmanship rather
than a real act.

### Becoming a subject, not a footnote

This is the part that goes beyond every earlier version of defection in this
codebase: a defector doesn't just leave, they can actually **join the
government of the power they joined** — take a cabinet seat, or for a
monarchy, enter the line of succession as a real contender.

```
POST /api/diplomacy/foreign/:powerId/petition   { mode: 'cabinet' | 'succession', role?, display_name? }
```

Requires an active defection to that specific power. Two modes:

**`cabinet`** — takes a vacant seat matching `role` (or any vacant non-crown
seat if you don't name one), immediately. If nothing is vacant, the petition
queues instead of failing outright.

**`succession`** — only on a government whose archetype actually has a crown
(`arch.succession` present — see the monarchy archetypes below). Appends the
petitioner to that power's own succession line, **as data on that
government's own config, never on the shared archetype** — queuing yourself
at the Crown of Ashvale must never add a pretender to every other absolute
monarchy in the game. The response tells you your position in the line.

**Not every government takes foreigners.** `tribal_confederation` sets
`accepts_defectors: false` — the one archetype in the current catalogue that
plausibly refuses outsiders on principle. Petitioning a power like that
returns a plain refusal, not a queue.

### Playing the seat

Once seated — immediately for a cabinet role, or when your turn in the
succession line actually arrives — the seat is yours to play, not a model's:

```
POST /api/diplomacy/foreign/:powerId/agents/:agentId/act   { action_kind, payload, rationale }
```

This is the one route a human-controlled seat acts through, and it returns
the exact same shape a model's proposal does. **It goes through the identical
allowlist check `runGovernmentTurn` runs on a model's output, before anything
is written** — a person gets no more latitude than an LLM would have. If you
don't submit before the turn runs, your seat defaults to abstaining rather
than freezing the whole government's turn — an AFK human never blocks a
cabinet.

Resigning a seat is separate from rejoining the Republic:

```
POST /api/diplomacy/foreign/agents/:agentId/resign
```

This only vacates the foreign seat. It does not undo the renunciation — that
still needs a `readmit` bill.

### The crown, specifically

Three of the thirteen archetypes have a real succession mechanic, not just an
"absolute monarchy" label:

| Archetype | Crown role | Reign length | Distinct mechanic |
|---|---|---|---|
| `absolute_monarchy` | `sovereign` | 12 cycles | executive decision — the crown simply decides |
| `constitutional_monarchy` | `sovereign` | 10 cycles | a council of named roles must back the crown's chosen proposal at ≥50% weight, or it is refused however the crown wants it |
| `theocratic_monarchy` | `anointed_sovereign` | 9 cycles | `consensus` decision method — legitimacy comes from the clergy's agreement, not the crown's word alone |

**Succession is something that actually happens to the cabinet**, not a label
on a dropdown. When the current reign has run its length, the throne passes to
the next name in the line — same cabinet role, holder and system prompt
replaced — and it is written to that power's national memory so a reader of
the deliberation transcript can see the reign change, not just infer it. The
archetype's own line is a handful of named NPC heirs; a citizen who petitioned
`succession` is appended after them. When the advance reaches a citizen entry,
that seat's `user_id` is set to them — they are the monarch now, played by a
person, until their own reign ends or they resign it.

The last name in a line reigns indefinitely. Nothing here ends a monarchy on
its own, same as nothing in the war system ends a conflict on its own — a
throne with no heir left just keeps its last holder.

---

## Related

- [DIPLOMACY.md](DIPLOMACY.md) — the behavioural contract for foreign powers generally, and why it is shaped this way
- [RUNBOOK-FOREIGN-POWER.md](RUNBOOK-FOREIGN-POWER.md) — creating a power, running its turns, the full archetype table (governments, trade and treaties are covered there, not repeated here)
- [MULTI-AGENT-DIPLOMACY.md](MULTI-AGENT-DIPLOMACY.md) — the LLM cabinet model in detail
- [STRATEGIC-GOODS.md](STRATEGIC-GOODS.md) — categorised goods and foreign trade
- [REFERENCE.md](REFERENCE.md) — the rest of the system
- [../CLAUDE.md](../CLAUDE.md) — conventions and traps, before you change any of this
