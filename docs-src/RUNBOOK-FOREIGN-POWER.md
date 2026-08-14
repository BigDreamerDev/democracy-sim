# Runbook — running a foreign power

**Use this when** you want to stand up an LLM-run foreign state, run its turns, or work out why one has stopped doing anything.

**You need:** Returning Officer (admin) access, and an API key for at least one free-tier provider set in Render's environment.

---

## Before you start

| | |
|---|---|
| `diplomacy_enabled` | must be `true` in Rules of the game — it ships off |
| Provider key | `GROQ_API_KEY` or `GEMINI_API_KEY` in Render's environment |
| A sitting President | there is no one to reply to dispatches without one |
| Payrun habit | powers are funded by the payrun; skip it and trade dries up |

The build is hard-locked to free providers. `LLM_FREE_ONLY` cannot be turned off, and a paid model is never used as a fallback.

---

## 1. Create the power

Diplomacy page → **Foreign Powers** panel → create. Give it a name and an adjective (`Valtia` / `Valtish` — the adjective is used in prose).

**The API key is shown once.** Store it where the agent runner can reach it. If you lose it, rotate rather than recreate: recreating loses the power's history, standing and treaties.

At this point the power can read `/api/foreign/state` and send dispatches. It cannot trade, cannot enter treaties, and does not appear as a trading partner.

## 2. Recognise it — this is a vote, not a switch

Recognition is deliberately **not** a Returning Officer toggle. Someone who may propose bills moves recognition, and it goes through the House like anything else:

```
POST /api/diplomacy/powers/:id/recognition   → creates a bill
→ seconders → Speaker tables → division → President assents
```

Until that passes, the power stays in the waiting room. That is the intended first piece of politics, not an obstacle to route around.

## 3. Give it a government

Same panel → configure the government:

| Field | What it does |
|---|---|
| `decision_method` | `executive` (leader decides), `cabinet` (one minister one vote), `consensus` (weighted, and nothing happens below threshold) |
| `decision_threshold` | only used by `consensus`. 0.6 is a reasonable start |
| `max_rounds` | deliberation rounds, 1–4. Two is enough to see ministers change their minds |

Then create ministers. Each needs a display name, a role, a system prompt, a provider and a model. **Roles matter** — the `executive` method looks for a leader by matching `head|leader|director|president|chancellor|prime` against the role string, and falls back to the first minister if it finds none.

A cabinet of three to five with genuinely opposed briefs — a hawk, a trade minister, a finance minister — produces far better turns than five variations on "senior diplomat".

## 4. Run a turn

**Run turn** in the panel, or `POST /api/admin/foreign/powers/:id/run-turn`.

What happens, in order:

1. Every active minister is asked for **one** proposal from a fixed allow-list
2. All ministers see all proposals and vote, for `max_rounds` rounds
3. The decision method picks one — or none
4. A deterministic function executes it; no model output is ever executed directly

Check the result under **recent turns**. A turn that chose nothing is a normal outcome, not a failure — it means the cabinet did not agree.

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
Usually `consensus` with a threshold the cabinet cannot reach. Lower `decision_threshold`, or switch to `cabinet`. Check the turn detail — if proposals exist but votes are scattered, it is genuine disagreement rather than a fault.

**Some ministers never appear in the votes.**
`max_calls_per_turn` (default 8) is a hard budget across proposals *and* votes. A five-minister cabinet over two rounds needs fifteen calls and will be silently truncated — turning a cabinet vote into a partial one. Raise the budget or shrink the cabinet. This is the failure most likely to go unnoticed.

**Proposals come back but nothing executes.**
The action must be in the allow-list: `nothing`, `dispatch`, `treaty`, `ratify`, `denounce`, `offer`, `buy`, `declare`. Anything else is discarded before it reaches the database. Check the server log for provider errors.

**"Foreign trade is not open."**
Trade needs *both* recognition and an in-force treaty carrying `trade_open: true`. In force means our House enacted it **and** the power called `/ratify`.

**"…holds N and cannot pay M."**
Working as intended. The power spends from a real balance. Run the payrun to top it up, or raise `foreign_treasury_per_cycle`.

**429 on a foreign purchase.**
`foreign_export_cap_per_cycle` reached. It bounds value per cycle, not action count. Raise it if the economy can stand it.

**Provider errors in the log.**
The model name must be on the free list in `server/llm/providers.js`. Free tiers rate-limit; a failed minister is skipped and the turn continues with the rest.

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
