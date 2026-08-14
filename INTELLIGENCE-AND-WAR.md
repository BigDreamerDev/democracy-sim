# Intelligence and war

Two things at different stages. The **intelligence service** has its framework
built — tables, clearance, the declassification clock, the public register — and
no collection or analysis. The **war system** is not built at all; what follows
is a design argument about what would make it worth playing.

---

## 1. The intelligence service

### Why it needs a framework before it needs features

Everything else in the Republic is on the public record, and every other request
for an exception has been refused. A spy service is the one thing that cannot be
fully public and still be a spy service. So the compromise has to be drawn
before anyone is under pressure to draw it badly, and it is drawn as narrowly as
possible:

| | |
|---|---|
| **Secret** | the *body* of a report, for `declassify_after_cycles` cycles |
| **Never secret** | that the report exists · when it was filed · who filed it · what it claims to be about · its confidence and sourcing · **who read it** · what the service cost |

Three rules do the work.

**Secrecy is a delay, not a vault.** Every report declassifies itself onto the
public record on a clock. Nobody approves it and nobody can stop it. A service
whose files never open cannot be held to account for having lied in them, and a
game where the Director can bury a mistake forever is a game where nobody ever
loses an argument with the Director.

**Clearance is a row, not an office.** `intel_clearance` is the only thing that
grants sight of a sealed report. "The Prime Minister can obviously see
everything" has to be written down, which means it can be revoked, and it means
a player can look at the list and see exactly who the circle is.

**Reading is an act on the record.** `POST /api/intel/reports/:id/read` writes to
`intel_reads` as a condition of answering. It is the only endpoint in the
Republic that does. Anyone may see that the Prime Minister was briefed on
Tuesday; only the cleared may see what was said. That asymmetry is what makes
secrecy survivable here — the House can ask why you read a file even when it
cannot read it.

**The service does not exist until the House creates it by bill.** A secret
service an officer could stand up on their own authority is precisely the thing
this Republic should not have, and the bill is the only moment the Citizens get
to argue about the charter.

### Built

```
intel_service      one row: charter, declassify_after_cycles, budget, abolished_at
intel_clearance    who may read a sealed report, granted by whom, until when
intel_reports      ref, power, subject, body, confidence, sourcing, filed_by,
                   filed_cycle, declassifies_at_cycle, declassified, was_accurate
intel_reads        the open register

GET  /api/intel                      service, clearances, reports, the register
POST /api/intel/reports/:id/read     writes the audit row, then answers
```

`ctx.intel` exposes `intelService`, `isCleared` and `declassifyDue` to the rest
of the server.

### Not built, and the order I would build it

1. **The establishing bill and the Director.** An `intelligence` bill kind that
   writes `intel_service` on assent, and a Director appointed the way the Fed
   chair is — nominated by one office, confirmed by the House, removable only by
   impeachment. The Director must not be dismissable by the person they are
   reporting on.
2. **Collection as a costed action.** The service spends from its budget to task
   a power. Money leaves the Treasury and *goes somewhere* — the ledger rule
   holds here as everywhere.
3. **Reports that can be wrong.** `confidence` and `sourcing` exist already and
   are not decoration. A report that cannot be wrong is not intelligence, it is
   an oracle, and an oracle removes every interesting decision. Generate the
   body from the target power's real state, then degrade it: `low` confidence
   reports should sometimes be *false*, not merely vague.
4. **`was_accurate`, settled in public.** After declassification, compare the
   claim against what actually happened and mark it. Over a few cycles the
   service acquires a track record, and the House gets to argue about whether to
   keep funding it. That argument is the whole point of the feature.

**The thing I would refuse to build:** intelligence on *citizens*. This is a
group of nineteen friends, and a mechanic that generates secret files on the
people in the chat — even fictional ones, even as a joke — will produce a real
argument rather than a fun one. Keep it aimed outward at foreign powers. If
someone asks for domestic surveillance later, that is the moment to have the
conversation deliberately, not to have already shipped it.

---

## 2. War

### What exists

Very little, and it is honest to say so. `powers.standing` can be `at_war`.
`foreign_conflicts` records a grievance, a kind, a status, and can attach a
response bill. That is the whole of it. Declaring war currently changes a label
and a fill colour on the map.

### Why that is unsatisfying

Nothing is at stake and nothing is decided. Everything else in this Republic
works because a decision costs something and a vote settles it. War, as built,
costs nothing and settles nothing — so the moment a power declares one, the
players have nothing to *do* about it, and the map goes red while the game
carries on identically underneath.

### Six changes, in the order they would improve immersion per unit of work

**1. War is a bill, and so is peace.** Consistent with treaties, recognition and
emergencies: nothing binds the Republic without a vote. A foreign ultimatum
arrives, and the House must actually decide — accept, refuse, or ignore, with
the clock running. This is the single highest-value change and it is nearly free:
the bill machinery already exists.

**2. War has to cost money.** The one lever with real teeth already in the game.
A war levy the House must pass, or the Treasury runs a deficit it must explain.
Suddenly the Treasurer's statement to the House is *about* something, the Fed
chair has an opinion about issuing to fund it, and voting for a war means voting
for a tax. That is where the arguments will come from.

**3. Blockades hit the market, not a status field.** Korrin closing the Straits
should mean their offers vanish from the foreign market and the export cap
tightens. Players who never read the diplomacy page still feel it, because their
business stops selling. A war nobody notices except on the map is not a war.

**4. Conflicts run on the cycle clock.** A grievance escalates if unanswered:
`grievance → ultimatum → blockade → open war`, one step per cycle without a
response. This turns war from a state into a *countdown*, which is the mechanic
that actually makes people show up and argue. It also gives the LLM cabinets
something with real stakes to deliberate about.

**5. War aims, stated in advance.** The bill declaring war names what would end
it — the Straits reopened, a tariff dropped, a territory released. Then peace is
checkable rather than vibes, and the House can be held to what it said it wanted
when it voted. This also gives the losing side something to concede.

**6. Territory changes hands, and only by treaty.** The map already supports it:
`territories` is one row per shape. A peace treaty that transfers a territory is
a bill, ratified, and then the map redraws. This is the payoff that makes the
other five worth doing — something visible and permanent changes because of what
the House decided.

### What I would deliberately not add

**Combat resolution — dice, army counts, battles.** It is the first thing people
reach for and it would be the worst thing here. This game's pleasure is
nineteen people arguing about a bill; a combat system replaces politics with
arithmetic, and the winner is whoever read the formula. Keep the war political:
it costs money, it splits the House, it forces votes, and it ends in a treaty
that somebody has to defend at the next election.

**Casualties or atrocity flavour text.** Real friends, real group chat. The
system should make war feel *consequential*, not grim.

### Where to start

Items 1 and 4 together — war as a bill, and escalation on the cycle clock. That
is a couple of hundred lines against machinery that already exists, and it turns
the current label into a thing that happens *to* the players on a schedule they
have to respond to. Item 2 next, because money is the lever this game already
does better than anything else.
