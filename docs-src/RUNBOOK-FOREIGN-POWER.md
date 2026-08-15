# Runbook — running a foreign power

**Use this when** you want to stand up an LLM-run foreign state, run its turns, or work out why one has stopped doing anything.

**You need:** Returning Officer (admin) access. An API key is optional — without one the cabinets run on the scripted mock, which plays properly.

---

## Before you start

| | |
|---|---|
| `diplomacy_enabled` | must be `true` in Rules of the game — it ships off |
| Provider key | **optional.** `GROQ_API_KEY` or `GEMINI_API_KEY` in Render's environment. Without one, cabinets are created on `mock` |
| A sitting President | there is no one to reply to dispatches without one |
| Payrun habit | powers are funded by the payrun; skip it and trade dries up |

The build is hard-locked to free providers. `LLM_FREE_ONLY` cannot be turned off, and a paid model is never used as a fallback.

---

## 1. Create the power — name, government, strength

Diplomacy page → **Create a foreign power**. Three fields: a name, a government archetype, and a rough strength. Everything else is defaulted, including the models.

The archetype is a whole government and it changes mechanics, not only prose:

| Archetype | Decides by | Actions/cycle | Under pressure | Will not |
|---|---|---|---|---|
| Military junta | weighted | 3 | escalates | sign away freedom of action; sit still on an open grievance |
| Merchant republic | cabinet | 3 | trades | vote for war; tear up an open trade agreement |
| Absolute monarchy | executive | 2 | escalates | pay tribute; withdraw a word already given |
| One-party state | executive | 2 | escalates | go to war before blockade; leave a message unanswered |
| Theocracy | consensus 0.66 | 1 | stalls | sell the holy sites; bind itself to tribute |
| Federal democracy | consensus 0.6 | 1 | stalls | declare before the dispute has escalated; tribute without a vote |
| Revolutionary council | cabinet | 3 | escalates | do nothing; inherit the old regime's tribute |
| Technocracy | weighted | 2 | measures | demand what it cannot state; act without a stated reason |

The archetype's action budget can only ever be **slower** than `foreign_actions_per_cycle`, never faster: no government type votes itself out of a limit the House set.

**The API key is shown once.** Store it where the agent runner can reach it. If you lose it, rotate rather than recreate: recreating loses the power's history, standing and treaties.

At this point the power has a cabinet, can read `/api/foreign/state` and can run turns. It cannot trade, cannot enter treaties, and does not appear as a trading partner until recognised.

## 2. Recognise it — this is a vote, not a switch

Recognition is deliberately **not** a Returning Officer toggle. Someone who may propose bills moves recognition, and it goes through the House like anything else:

```
POST /api/diplomacy/powers/:id/recognition   → creates a bill
→ seconders → Speaker tables → division → President assents
```

Until that passes, the power stays in the waiting room. That is the intended first piece of politics, not an obstacle to route around.

## 3. Adjust the government, if you want to

The archetype already installed one. Nothing below is required.

**Replace the government:** pick another archetype in the power's panel. Ministers of the same role are refreshed; ones you added by hand are left alone.

**Decision machinery by hand** (under the fold):

| Field | What it does |
|---|---|
| `decision_method` | `executive` (leader decides), `cabinet` (one minister one vote), `weighted` (by vote weight), `consensus` (weighted, and nothing happens below threshold) |
| `decision_threshold` | only used by `consensus`. 0.6 is a reasonable start. A **stalling** archetype raises its own threshold as conflict pressure rises, capped at 0.95 |
| `max_rounds` | deliberation rounds, 1–4. Two is enough to see ministers change their minds |

**Ministers by hand.** Each needs a display name, a role, a system prompt, a provider and a model. **Roles matter** — the `executive` method looks for a leader by matching `head|leader|director|president|chancellor|prime|crown|sovereign|general_secretary` against the role string, and falls back to the first minister if it finds none. The role string also decides which temperament the scripted mock plays.

**Test the model before you save it.** The panel has a *Test this model now* button; it makes one cheap call to the provider you chose, with no fallback, and tells you which of "the key is wrong", "the model is not served", "the free tier is rate-limited" or "it works" applies. Silent fallback through four providers to a generic failure was the worst diagnostic in the system and this replaces it.

A cabinet of three to five with genuinely opposed briefs — a hawk, a trade minister, a finance minister — produces far better turns than five variations on "senior diplomat". Every archetype's cabinet is already built that way.

## 4. Run a turn

**Run turn** in the panel, or `POST /api/admin/foreign/powers/:id/run-turn`.

What happens, in order:

1. Every active minister is asked for **one** proposal from a fixed allow-list
2. Anything outside the allow-list is discarded, then anything the archetype refuses is discarded, and both are reported in the turn's `result.refused`
3. All ministers see all surviving proposals and vote, for `max_rounds` rounds
4. The decision method picks one — with the archetype's posture biasing priority by conflict pressure — or none
5. The archetype's refusals are checked once more on the carried proposal
6. A deterministic function executes it; no model output is ever executed directly

**The last deliberation** is shown in the panel: what each minister proposed, who voted for it, what it weighed, what carried, and what the government refused on the way. A turn that chose nothing is a normal outcome, not a failure — and the refusal list tells you whether nobody suggested anything or everything suggested was refused.

Turns are idempotent per cycle. Running one twice returns the first turn rather than acting twice.

## 5. Verify

```
GET /api/diplomacy/powers      → standing, recognition
GET /api/diplomacy/dispatches  → the cable traffic, publicly
GET /api/diplomacy/balance     → purse, spent_this_cycle, export_cap
GET /api/admin/foreign/powers/:id/turns
```

Every state-changing action is in the public record under `foreign.*`. If you cannot find an action in the audit log, it did not happen.

---

## Troubleshooting

**The turn returns `nothing` every time.**
Read the deliberation first. If `result.refused` is full, the archetype is doing its job and you have chosen a government that will not do what you want — a theocracy will not sell you a holy site however you word it. If proposals exist but votes are scattered, it is genuine disagreement. Otherwise it is usually `consensus` with a threshold the cabinet cannot reach; lower `decision_threshold` or switch to `cabinet`. Note that a **stalling** archetype raises its own threshold as pressure rises, on purpose.

**There is no API key on this deployment.**
Then the cabinets run on `mock`, and `mock` plays: it reads the same snapshot a hosted minister reads and answers in character — an unrecognised power asks for relations, a hawk warns and then demands, a merchant proposes a commercial convention, a blocker asks for more consultation. It is deterministic, so a replayed turn decides the same way. Switch the feature on before you go looking for a key.

**Some ministers never appear in the votes.**
`max_calls_per_turn` is a hard budget across proposals *and* votes. An archetype sets it to `(ministers + 1) × 2`, which covers one full round of proposals and one of votes; a hand-built government defaults to 8. A five-minister cabinet over two rounds needs fifteen calls and will be silently truncated — turning a cabinet vote into a partial one. Raise the budget in the government's `config`, or shrink the cabinet. This is the failure most likely to go unnoticed.

**Proposals come back but nothing executes.**
The action must be in the allow-list: `nothing`, `dispatch`, `treaty`, `ratify`, `denounce`, `offer`, `buy`, `declare`. Anything else is discarded before it reaches the database. Check the server log for provider errors.

**"Foreign trade is not open."**
Trade needs *both* recognition and an in-force treaty carrying `trade_open: true`. In force means our House enacted it **and** the power called `/ratify`.

**"…holds N and cannot pay M."**
Working as intended. The power spends from a real balance. Run the payrun to top it up, or raise `foreign_treasury_per_cycle`.

**429 on a foreign purchase.**
`foreign_export_cap_per_cycle` reached. It bounds value per cycle, not action count. Raise it if the economy can stand it.

**Provider errors in the log.**
Press *Test this model now* rather than reading the log. The model name must be on the free list in `server/llm/providers.js`. Free tiers rate-limit; a failed minister is skipped and the turn continues with the rest.

---

## Rolling back

| Situation | Action |
|---|---|
| A power is behaving badly | **Deactivate its ministers.** Stops turns, keeps history and treaties |
| The key has leaked | **Rotate the key.** The old one dies immediately |
| You want it gone | **Revoke the power.** Credential dies; the record stays, as it must |
| A treaty is the problem | Denounce it, or repeal the enacting law by the ordinary route |
| The economy is distorted | Set `foreign_export_cap_per_cycle` to something small, or `foreign_treasury_per_cycle` to `0` |

**Do not delete rows to undo something.** Article 13 permits superseding, never erasing, and the public record is the only check citizens have on the Returning Officer.

Nothing here is reversible by deleting a power: treaties enacted by the House are laws of the Republic and stay laws until repealed.

---

## When to escalate to the code

- **Money supply is not zero.** `GET /api/economy` → `supply` should always be 0. If it is not, run `npm test` and expect `foreigntrade.mjs` to be red. Something is minting money; stop trading until it is found.
- **A dispatch appears to have caused an action.** It cannot by design. If it looks like it has, that is a serious bug — capture the dispatch id and the audit entries around it.
- **A power sees a citizen who holds no office.** `/api/foreign/state` exposes officeholders only. Anything else is a leak.

## Related

- [DIPLOMACY.md](DIPLOMACY.md) — the behavioural contract and why it is shaped this way
- [MULTI-AGENT-DIPLOMACY.md](MULTI-AGENT-DIPLOMACY.md) — the cabinet model in detail
- [REFERENCE.md](REFERENCE.md) — the rest of the system
- [../CLAUDE.md](../CLAUDE.md) — conventions and traps, before you change any of it
