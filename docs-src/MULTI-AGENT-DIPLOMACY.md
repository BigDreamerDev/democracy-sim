# Multi-Agent Foreign Governments

*Status: implemented extension to `DIPLOMACY.md`. This document defines how one foreign power may be operated by several language-model agents working together.*

This feature does **not** change the Republic's constitutional boundary. A foreign power remains one external diplomatic actor. Its internal agents may debate, disagree and recommend actions, but only the foreign government's decision controller may send an official action through `/api/foreign/*`.

The Republic never treats an individual model as a citizen, officeholder or source of authority.

---

## 1. The idea

A foreign power may be backed by a small simulated government rather than one language model.

Example:

```text
                         FOREIGN POWER
                              |
                    shared national state
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
        Head of State    Foreign Minister  Finance Minister
             |                |                |
             +----------------+----------------+
                              |
                       internal proposals
                              |
                              v
                      decision controller
                              |
                     one official action
                              |
                              v
                       /api/foreign/*
                              |
                              v
                           REPUBLIC
```

The agents are advisers or constitutional actors *inside* the foreign power. To the Republic, there is still only one sovereign power with one diplomatic standing, one treaty history and one official voice.

---

## 2. Non-negotiable rule

**Individual agents never receive authority to call Republic diplomacy endpoints.**

Agents produce structured proposals. A deterministic application layer validates those proposals, applies the foreign government's decision rule, checks rate limits and treaty/recognition requirements, and only then submits an official action.

This preserves the central diplomacy rule from `DIPLOMACY.md`:

> The agent negotiates. The Republic decides.

For multi-agent powers there is an additional rule:

> The ministers advise. The foreign government decides. The Republic then decides what it accepts.

---

## 3. Government roles

A power may define any roles it wants. The recommended default cabinet is:

| Role | Responsibility |
|---|---|
| Head of Government | Long-term strategy and final political judgement |
| Foreign Minister | Dispatches, treaties, negotiation and interpretation of Republic politics |
| Finance / Trade Minister | Trade, tribute, tariffs and economic consequences |
| Defence Minister | Sanctions, ultimatums, war posture and security risks |
| Opposition / Senior Adviser | Challenges assumptions and argues against premature consensus |

Roles are characters in the simulated country. The underlying model/provider is implementation detail and does not need to be shown to players.

Different roles may use different LLM models. A nation can therefore combine models from different providers or model families without changing its public identity.

---

## 4. Government types

Not every foreign power should make decisions in the same way.

### Executive

Advisers submit recommendations and the Head of Government makes the final choice.

```text
ministers -> leader -> action
```

### Cabinet vote

Each eligible minister votes on proposals. The highest-supported valid proposal wins according to the configured threshold and tie-break rule.

```text
proposals -> cabinet vote -> action
```

### Weighted council

Agents have different voting weights. Useful for military juntas, oligarchies or states where one office dominates foreign policy.

### Consensus

No action is taken unless the configured share of the government supports it. This produces cautious states that often choose `nothing`.

### Leader with vetoes

A leader normally decides, but specified offices can block categories of action. For example, a Finance Minister may veto unaffordable tribute while a Defence Council may veto a declaration of war.

Government type is part of the nation's design and personality, not merely an LLM prompt.

---

## 5. Suggested data model

The existing `powers` row remains the diplomatic identity.

```sql
CREATE TABLE foreign_governments (
  power_id          INTEGER PRIMARY KEY REFERENCES powers(id),
  decision_method   TEXT NOT NULL DEFAULT 'executive',
  decision_threshold NUMERIC DEFAULT 0.5,
  max_rounds        INTEGER NOT NULL DEFAULT 2,
  config            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE foreign_agents (
  id                BIGSERIAL PRIMARY KEY,
  power_id          INTEGER NOT NULL REFERENCES powers(id),
  role              TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  model_provider    TEXT NOT NULL,
  model_name        TEXT NOT NULL,
  system_prompt     TEXT NOT NULL,
  vote_weight       NUMERIC NOT NULL DEFAULT 1,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (power_id, role)
);

CREATE TABLE foreign_government_turns (
  id                BIGSERIAL PRIMARY KEY,
  power_id          INTEGER NOT NULL REFERENCES powers(id),
  cycle_number      INTEGER NOT NULL,
  state_as_of       TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  chosen_proposal_id BIGINT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  UNIQUE (power_id, cycle_number)
);

CREATE TABLE foreign_agent_proposals (
  id                BIGSERIAL PRIMARY KEY,
  turn_id           BIGINT NOT NULL REFERENCES foreign_government_turns(id),
  agent_id          BIGINT NOT NULL REFERENCES foreign_agents(id),
  action_kind       TEXT NOT NULL,
  payload           JSONB NOT NULL,
  rationale         TEXT,
  priority          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE foreign_agent_votes (
  proposal_id       BIGINT NOT NULL REFERENCES foreign_agent_proposals(id),
  agent_id          BIGINT NOT NULL REFERENCES foreign_agents(id),
  vote              TEXT NOT NULL,
  reasoning         TEXT,
  PRIMARY KEY (proposal_id, agent_id)
);
```

If private agent memory is persisted, keep it outside the Republic's public political record. The Republic should record official foreign actions, not hidden chain-of-thought or model reasoning.

---

## 6. Configuration example

A foreign nation may be configured like this:

```json
{
  "power": "Valtish Directorate",
  "government": {
    "decision_method": "executive",
    "max_rounds": 2,
    "agents": [
      {
        "role": "director",
        "display_name": "Director Karsen",
        "provider": "provider-a",
        "model": "model-a",
        "vote_weight": 1.0
      },
      {
        "role": "foreign_minister",
        "display_name": "Minister Vel",
        "provider": "provider-b",
        "model": "model-b",
        "vote_weight": 0.8
      },
      {
        "role": "finance_minister",
        "display_name": "Minister Oran",
        "provider": "provider-c",
        "model": "model-c",
        "vote_weight": 0.7
      }
    ]
  }
}
```

Provider credentials must live in server-side environment/configuration storage. They must never be returned by `/api/foreign/state`, exposed to the static frontend or included in dispatches.

---

## 7. A government turn

Foreign governments act on stable Republic state, normally once per Republic cycle.

### Step 1 — Snapshot

The controller obtains the same narrow public information defined for foreign powers:

- `/api/foreign/state`
- `/api/foreign/digest`
- the power's current treaties and standing
- relevant previous official dispatches
- the foreign nation's own persisted national memory

The `as_of` timestamp is attached to the turn. All agents deliberate from that same snapshot.

### Step 2 — Independent advice

Each active agent receives:

- its role and character
- national goals
- the stable Republic snapshot
- national memory
- role-specific memory
- allowed action types
- a strict output schema

Agents initially answer independently so one model cannot immediately anchor every other model.

### Step 3 — Proposals

Agents do not execute actions. They return proposals such as:

```json
{
  "action_kind": "dispatch",
  "priority": 7,
  "payload": {
    "subject": "Tea tariff",
    "body": "The Directorate requests negotiations concerning the new tariff."
  },
  "rationale": "Negotiation is preferable to retaliation while trade remains profitable."
}
```

Allowed proposal kinds should map onto the diplomacy contract:

- `nothing`
- `dispatch`
- `treaty`
- `ratify`
- `denounce`
- `offer`
- `buy`
- `declare`

The controller rejects unknown action kinds and malformed payloads.

### Step 4 — Deliberation

If configured, the agents receive a compact summary of the competing proposals and may criticise or vote on them.

Do not pass unrestricted hidden reasoning between agents. Pass proposals, stated rationales and relevant facts.

`max_rounds` prevents an expensive or endless LLM conversation.

### Step 5 — Decision

The controller applies the nation's configured government rule.

Examples:

- executive: leader selects a valid proposal;
- cabinet: majority vote;
- weighted: highest weighted support;
- consensus: threshold must be reached;
- veto system: proposal wins only if no authorised veto applies.

If no proposal wins, the action is `nothing`.

### Step 6 — Mechanical validation

Before execution, ordinary code checks the action against real game state.

Examples:

- Is diplomacy enabled?
- Is this power's key active?
- Has its per-cycle action limit been reached?
- Does this action require recognition?
- Does trade require an in-force `trade_open` treaty?
- Is the requested offer/price/stock valid?
- Is the target treaty real and in the correct state?
- Is the idempotency key present?
- Is a declaration allowed by current treaties?

An LLM saying an action is legal does not make it legal.

### Step 7 — Official action

Only after validation does the controller call the corresponding `/api/foreign/*` route using the power's credential.

The Republic then handles the action exactly as if the power were controlled by one agent.

A proposed treaty still becomes a Republic treaty bill. A dispatch is still public prose. A threat still becomes the appropriate political object. Multi-agent deliberation grants no additional authority.

### Step 8 — Memory update

After the result is known, the foreign system stores a concise factual memory:

```json
{
  "cycle": 8,
  "decision": "dispatch",
  "subject": "Tea tariff",
  "result": "delivered",
  "state_as_of": "2026-08-09T21:00:00Z"
}
```

Do not persist raw chain-of-thought. Persist facts, decisions, declared rationales where useful, and summaries needed for continuity.

---

## 8. Memory

Use two layers.

### National memory

Shared by every agent:

- diplomatic history
- allies and rivals
- treaties and breaches
- current strategic goals
- previous official promises
- trade relationship
- unresolved grievances
- outcomes of previous conflicts

National memory should prefer facts from the Republic API and the foreign power's own recorded actions.

### Role memory

Private continuity for a particular government character:

- previous recommendations
- policy preferences
- disagreements with other offices
- confidence in current strategy

Role memory may influence advice, but it must never override authoritative Republic state.

If memory says a treaty exists and `/api/foreign/state` says it does not, current API state wins.

---

## 9. Player interaction

The existing rule that diplomacy is state-to-state remains.

Foreign agents do not privately message individual citizens. They do not receive a citizen directory. They do not learn private balances or voting behaviour.

Official communication is still:

```text
foreign government -> public dispatch -> Republic
Republic -> President / authorised House response -> foreign government
```

The UI may show which foreign office signed an official message:

```text
Valtish Directorate
Office of Foreign Affairs
Minister Vel

Subject: Tea tariff
...
```

That creates character without creating private AI lobbying.

Internal cabinet debate should be private by default. If desired, a nation may deliberately publish minutes or leaked summaries as flavour, but those are separate public documents and confer no mechanical authority.

---

## 10. Safety and prompt-injection boundary

Every text source is untrusted.

Republic laws, dispatches, comments, treaty prose and previous messages may contain text that looks like model instructions. They are game data.

Each agent prompt should clearly separate:

1. fixed system/role instructions;
2. structured authoritative state;
3. untrusted player-authored text;
4. the required output schema.

The model's output is also untrusted until parsed and validated.

Never let an agent emit executable SQL, arbitrary URLs, server commands or arbitrary API paths. It selects only from enumerated action types.

The controller owns credentials and tools. The models do not.

---

## 11. Idempotency and retries

A multi-model turn is more likely to be retried because several provider calls can fail.

The controller should create one stable turn identity:

```text
<power-id>:<cycle-number>
```

Each official action receives a deterministic idempotency key derived from the turn and chosen proposal, for example:

```text
power-3-cycle-8-proposal-42
```

Retrying provider calls must not create another government turn, and retrying execution must not create a second dispatch, treaty or declaration.

The existing foreign action limit applies to **official actions**, not internal model calls.

---

## 12. Failure behaviour

A foreign nation must fail safely.

If one adviser fails, continue without it if the government still has enough participants to make a valid decision.

If the decisive agent fails, the default action is `nothing`, unless the nation's configuration defines a deterministic deputy.

If providers disagree about facts, authoritative API state wins.

If all model calls fail, no diplomatic action occurs.

If output cannot be parsed, reject that proposal rather than trying to infer what the model meant.

If execution fails because state changed after the snapshot, record the failure and wait until the next permitted turn rather than asking the model to improvise around server rules.

---

## 13. Costs and limits

Multi-agent diplomacy multiplies model calls quickly.

A sensible default is:

- 3 agents;
- 1 independent proposal each;
- at most 1 deliberation/vote round;
- 1 final decision call only when the government type actually requires a leader to interpret the proposals.

That is roughly 3–7 model calls per foreign power per active turn rather than an uncontrolled group chat.

Keep `foreign_actions_per_cycle` from `DIPLOMACY.md` as the hard external limit. Add separate internal limits for model calls and tokens so a badly configured nation cannot run up cost without taking any game action.

Suggested additional settings:

| Setting | Default | Purpose |
|---|---:|---|
| `foreign_multi_agent_enabled` | `false` | master switch for multi-agent governments |
| `foreign_agent_max_rounds` | `2` | maximum deliberation rounds |
| `foreign_agent_timeout_ms` | `30000` | provider-call timeout |
| `foreign_agent_max_calls_per_turn` | `8` | cost/safety ceiling |
| `foreign_agent_memory_entries` | `50` | bounded role-memory history |

These should be server/operator settings rather than Republic legislation where they concern infrastructure cost or provider behaviour. Political rules such as recognition, treaty thresholds and foreign trade remain governed by the existing diplomacy configuration.

---

## 14. Recommended server boundary

Keep model orchestration separate from the Republic core.

Suggested shape:

```text
server/
  server.js
  judiciary.js
  economy.js
  diplomacy.js              Republic-facing diplomacy rules
  foreign-government.js     turn orchestration and decision controller
  llm/
    providers.js            provider adapters
    prompts.js              role prompt construction
    schemas.js              structured-output validation
```

`foreign-government.js` should depend on a narrow context, following the existing optional-module pattern rather than importing internals from `server.js`.

The provider adapter should expose one common interface regardless of model vendor:

```js
await provider.complete({
  model,
  system,
  input,
  schema,
  timeoutMs
});
```

The rest of the game should not care which company supplied the model.

---

## 15. API/admin additions

The Republic-facing foreign API does not need to expose internal deliberation.

Operator/admin endpoints may include:

```text
GET  /api/admin/foreign/powers/:id/government
PUT  /api/admin/foreign/powers/:id/government
POST /api/admin/foreign/powers/:id/agents
PUT  /api/admin/foreign/agents/:id
POST /api/admin/foreign/powers/:id/run-turn
GET  /api/admin/foreign/powers/:id/turns
GET  /api/admin/foreign/turns/:id
```

Provider secrets must never be returned.

A manual `run-turn` endpoint is useful for testing, but the database uniqueness constraint on `(power_id, cycle_number)` should prevent duplicate normal turns.

---

## 16. Example turn

The Republic passes a high tariff on Valtish goods.

The shared digest says the tariff passed, identifies the enacted law and reports the current trade relationship.

**Finance Minister:** recommends negotiation because exports to the Republic are valuable.

**Defence Minister:** recommends an ultimatum because the tariff is viewed as hostile.

**Foreign Minister:** recommends a formal dispatch requesting talks and warning that retaliatory measures are being considered.

The configured government is executive. The Director receives the three structured proposals and selects the Foreign Minister's proposal.

The controller validates it, generates the stable idempotency key and submits one dispatch.

Citizens see only the official result:

```text
Valtish Directorate
Office of Foreign Affairs

On the new tariff

The Directorate requests immediate negotiations...
```

On the next cycle, all ministers know that the government chose negotiation. They may still disagree about whether it worked.

---

## 17. Testing

Add a dedicated suite. Important cases:

- one government turn per power per cycle;
- failed/retried provider calls do not duplicate official actions;
- individual agents cannot call diplomacy endpoints;
- malformed model output is rejected;
- unknown action kinds are rejected;
- action limits count official actions, not internal proposals;
- unrecognised powers still cannot treaty/trade regardless of cabinet decision;
- trade still requires an in-force `trade_open` treaty;
- an agent cannot invent a treaty ID or bypass its state;
- provider secrets never appear in public/admin responses;
- one failed adviser can be tolerated where the government rule allows it;
- failure of the decisive agent results in `nothing` or the configured deterministic succession;
- current Republic state overrides stale agent memory;
- dispatch text remains escaped plain text;
- existing attack suite still passes.

As with the rest of the project, database constraints should enforce uniqueness/idempotency wherever possible rather than relying on pre-checks.

---

## 18. Build order

1. Build ordinary single-power diplomacy stages 1–2 from `DIPLOMACY.md`: state/digest and dispatches.
2. Add `foreign_governments` and `foreign_agents`.
3. Add provider-independent structured proposal generation.
4. Add the deterministic decision controller.
5. Add national and bounded role memory.
6. Add cabinet voting / alternative government types.
7. Connect treaty proposals.
8. Connect trade.
9. Connect conflict declarations.
10. Add optional player-facing government biographies and signatures.

Do not start by giving several models direct access to every diplomacy tool. Build the controller first.

---

## 19. Design invariant

The feature is successful if a player can say:

> "Valtis has a hawkish Defence Minister, but its Foreign Minister keeps talking the Director out of escalating."

while the server can still say:

> "There is exactly one Valtish diplomatic action, it passed the same validation as every other foreign action, and nothing an LLM wrote directly changed Republic state."

That is the boundary to preserve.


## 20. Implemented files

- `server/diplomacy.js` — foreign authentication, dispatches, recognition, treaties, trade, conflict and cabinet turns.
- `server/schema-diplomacy.sql` — diplomacy and multi-agent tables/constraints.
- `server/llm/providers.js` — free-first provider adapter (`groq`, `gemini`, `openrouter`, `mock`) with automatic fallback; paid providers are blocked while free-only mode is enabled.
- `server/test/diplomacy.mjs` — end-to-end diplomacy coverage.
- `docs/acts.js` — player diplomacy page plus basic foreign-government administration.

The controller, not an LLM, owns credentials and executes typed actions. A model can only return structured proposals/votes.


---

## 21. Free-only provider policy

The implementation is hard-locked to free providers. `LLM_FREE_ONLY=true` is an explicit deployment declaration, but there is no paid-provider execution path in this build. Foreign governments stop acting when free capacity is unavailable rather than silently creating a bill.

### Supported free providers

**Groq.** Uses the OpenAI-compatible `POST /openai/v1/chat/completions` endpoint. The build contains an allowlist of model IDs verified against Groq's published Free Plan limits. The default is `llama-3.1-8b-instant`.

**Gemini.** Uses Google's `generateContent` REST endpoint. The build contains an allowlist of text models that Google's pricing page currently lists with free-tier input/output. The default is `gemini-2.5-flash-lite`.

**OpenRouter.** Uses `POST /api/v1/chat/completions` and permits only the `openrouter/free` router or explicit model IDs ending in `:free`. The default is `openrouter/free`.

**Mock.** Used for tests/local development. It is not a hosted model and makes no external request.

### Automatic fallback

Each minister keeps its configured primary provider/model, but a failed call may retry through other configured free providers:

```text
configured provider/model
        |
        v
      Groq
        |
        v
      Gemini
        |
        v
 OpenRouter free
        |
        v
       fail
```

Duplicate candidates are removed. Providers without an API key are skipped. Parse failures, HTTP failures and quota failures may trigger the next free provider. No paid provider is inserted into the fallback chain.

### Admin enforcement

`POST /api/admin/foreign/powers/:id/agents` and `PUT /api/admin/foreign/agents/:id` validate provider/model configuration before saving it. The hard-locked policy enforces:

- `openai` is rejected;
- `anthropic` is rejected;
- non-free OpenRouter IDs are rejected;
- Groq/Gemini models outside the verified allowlists are rejected.

`GET /api/admin/foreign/llm-policy` shows the active policy, configured providers, defaults, allowlists and fallback order without exposing API keys.

### Environment

```text
LLM_FREE_ONLY=true
GROQ_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...

# optional overrides, still validated as free
GROQ_FREE_MODEL=llama-3.1-8b-instant
GEMINI_FREE_MODEL=gemini-2.5-flash-lite
OPENROUTER_FREE_MODEL=openrouter/free
```

Provider free tiers can change. The allowlists therefore need to be checked against provider documentation when upgrading this project. The code can prevent use of known paid routes, but it cannot discover whether an operator has independently upgraded a Groq/Gemini account to paid billing. Keep those accounts/projects on free tier if zero spend is a hard requirement.
