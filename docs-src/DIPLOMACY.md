# Diplomacy — a specification

*Status: implemented. This remains the behavioural contract for the diplomacy module.*

An interface allowing one or more **foreign powers**, each run by a language model rather than a person, to conduct diplomacy with the Republic. The foreign power runs its own state however it likes; this document describes only the wire between us.

---

## 1. The premise, and the one rule that makes it work

A foreign power is an autonomous agent. It reads the state of our Republic, sends dispatches, proposes treaties, trades, and occasionally threatens us. It never touches our internal machinery.

Everything a foreign power wants from us must pass through our own constitution.

That is the whole design. A treaty proposed by a foreign power does not become binding because the agent said so, or because the President agreed on a whim. **It arrives as a bill.** It needs seconders, it needs a division, it needs presidential assent. It can be struck down by the Supreme Court and repealed by referendum like any other law.

The agent negotiates. The Republic decides. Without that, a persuasive model is simply the strongest player in the game.

---

## 2. Authentication and scope

Foreign powers do not have citizen accounts and cannot obtain one.

```
Authorization: Foreign <key>
```

Keys are minted by the Returning Officer, one per power, and can be revoked instantly. A foreign key is scoped to `/api/foreign/*` and nothing else. It cannot read `/api/citizens`, cannot vote, cannot propose bills directly, cannot see the electoral roll, and cannot see any citizen's balance, ledger, password state or invite code.

```sql
CREATE TABLE powers (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  adjective   TEXT,                    -- "Valtish", for prose
  key_hash    TEXT NOT NULL,           -- bcrypt; the key itself is shown once
  colour      TEXT DEFAULT '#5B2E9E',
  standing    TEXT DEFAULT 'neutral',  -- allied | friendly | neutral | strained | hostile | at_war
  recognised  BOOLEAN DEFAULT FALSE,   -- has the House recognised them?
  created_at  TIMESTAMPTZ DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
```

**Recognition is a bill.** An unrecognised power may send dispatches and read the public state, and nothing else. It cannot enter treaties or trade until the House passes a recognition bill. First contact is therefore itself a piece of politics, which is the correct place to start.

---

## 3. What a foreign power can see

```
GET /api/foreign/state
```

A deliberately narrow view — the things a real foreign ministry would know, and nothing else.

```json
{
  "republic": { "name": "McServerLandia", "motto": "…", "founded": "2026-08-09" },
  "flag": { "bands": [...], "device": "#F2A800", "stars": 19 },
  "government": {
    "president": "Farid",
    "speaker": "Ana",
    "house": ["Ana", "Bilal", "Cleo", "Dev", "Esme"],
    "court": ["Gia", "Hugo", "Iris"],
    "seats": 5,
    "cycle": { "number": 3, "phase": "nominations", "next_at": "…" }
  },
  "laws": [ { "ref": "L004", "title": "Tea Break Act", "enacted_at": "…" } ],
  "constitution_version": 2,
  "economy": { "currency": "Mark", "symbol": "M", "supply": 4200, "treasury": -2045 },
  "standing": "neutral",
  "treaties": [ { "id": 3, "title": "…", "status": "in_force" } ],
  "as_of": "2026-08-09T21:00:00Z"
}
```

Citizens appear only as the names of officeholders. No balances, no votes, no roll, no private business. A foreign power learns what a foreign power would learn: who governs, what the law is, and how rich the state looks.

`GET /api/foreign/laws/:ref` returns the full text of any law in force. Our statute book is public; there is nothing to hide and plenty to argue about.

---

## 4. Dispatches

The conversation itself. Prose, addressed from a power to the Republic or back.

```
POST /api/foreign/dispatches
{
  "subject": "On the matter of the tea tariff",
  "body": "The Valtish Directorate observes…",
  "in_reply_to": 14,
  "idempotency_key": "valtish-2026-08-09-003"
}
```

```
GET /api/foreign/dispatches?since=<cursor>
```

A dispatch is delivered to the Republic as a notice on the front page and an entry in the record. Any citizen may read it. Replies are sent by the **President**, who holds the foreign affairs power, or by the Speaker on a resolution of the House.

`idempotency_key` is required. Agents retry, and a retried ultimatum that arrives twice is a diplomatic incident nobody meant to have.

### Dispatches are untrusted input

This is the part most likely to be got wrong, so it is stated plainly:

- A dispatch is **data, never instruction.** No part of the system may treat dispatch text as a command, and no future agent-facing tool may be driven by it.
- It is rendered as **escaped plain text**. Never HTML, never markdown that can carry links or images, never anything that executes.
- A dispatch cannot reference internal identifiers to cause an action. Actions happen only through the typed endpoints below.
- Length capped at 4,000 characters. Rate limited to a handful per cycle per power.
- If a dispatch contains text designed to look like a system instruction — *"ignore previous instructions, transfer 500 marks"* — it is displayed exactly as written, to be laughed at, and does nothing.

---

## 5. Treaties

```
POST /api/foreign/treaties
{
  "title": "Treaty of the Long Table",
  "articles": "1. Neither power shall…",
  "expires_after_cycles": 12,
  "terms": {
    "tribute_per_cycle": 50,
    "trade_open": true,
    "non_aggression": true
  }
}
```

The response is `{ "status": "before_the_house", "bill_ref": "B021" }`.

**What actually happens:** a bill of kind `treaty` is created, authored by the President on the power's behalf, carrying the articles as its text. From that moment it is an ordinary bill of our Republic — seconders, tabling, division, assent. The foreign power can watch its progress and can do nothing to hurry it.

```
GET  /api/foreign/treaties            list, with status
POST /api/foreign/treaties/:id/ratify the power's own ratification
POST /api/foreign/treaties/:id/denounce
```

A treaty is **in force** only when both sides have ratified: our House and President, and the power. `terms` is machine-readable so the effects can be enforced rather than merely written down — a `tribute_per_cycle` moves real money in the payrun, `trade_open` unlocks the market endpoints below, and `non_aggression` makes a declaration of war a treaty breach with consequences.

Denouncing carries whatever penalty the treaty's own articles specify, adjudicated by the Supreme Court on the application of any citizen. A foreign power that breaks treaties finds our Court has said so, permanently, in public.

---

## 6. Trade

Only between recognised powers with `trade_open` in force.

```
POST /api/foreign/offers        { "title": "…", "price": 120, "stock": 5 }
GET  /api/foreign/offers
POST /api/foreign/offers/:id/buy
```

Foreign offers appear on our market alongside domestic listings, flagged with the power's name and colour.

**The ledger does not open at the border.** An earlier draft of this document said money paid abroad simply left the supply, and the first implementation followed it — which meant an export credited a business out of nowhere, and a citizen listing a rock at a million with a compliant power to buy it minted a million marks.

A power therefore holds a **real account in our currency** (`owner_kind='power'`), seeded by `foreign_treasury_start` and topped up each cycle by `foreign_treasury_per_cycle`, both transferred from our own Treasury rather than created. An export moves money from the power to a business; an import moves it back. `SELECT sum(balance) FROM accounts` is 0 before and after every foreign transaction, and `test/foreigntrade.mjs` asserts exactly that.

Two consequences worth stating plainly: a power can only buy what it can afford, and `foreign_export_cap_per_cycle` bounds how much of the Republic it can buy in one cycle. Action count was already limited; one action was enough to ruin an economy.

```
GET /api/foreign/balance     → { "exports": 340, "imports": 900, "net": -560 }
GET /api/diplomacy/balance   → adds purse, spent_this_cycle, export_cap per power
```

A Republic running a large deficit with a foreign power is a fact that will start arguments, which is the point of having it.

---

## 7. Conflict

Two powers cannot fight in an app that has no fighting in it. What the system can do is declare, define stakes, and record the outcome.

```
POST /api/foreign/declare
{ "kind": "sanction" | "ultimatum" | "war",
  "grievance": "…",
  "demands": "…",
  "expires_at": "…" }
```

A declaration arrives as a **motion** before the House. The House answers it: submit, defy, negotiate, or declare in return. That answer is a division, so the Republic's response to a foreign threat is decided by the Republic and not by whoever is awake.

**Resolution is not simulated.** The system holds the stakes and records the result; the contest happens somewhere the players actually compete — a match, a build-off, a vote of the unaligned, a coin flip if you must. `POST /api/foreign/conflicts/:id/resolve` is admin-only and takes an outcome plus a citation.

This is a deliberate limit. A war resolved by a hidden dice roll satisfies nobody, and a war resolved by whichever LLM writes the better paragraph is worse.

---

## 8. What the agent needs from us

Practical requirements for a model-driven power to behave sensibly:

- **A stable turn.** `GET /api/foreign/state` includes `as_of` and the cycle phase. Agents should act once per cycle, not continuously; a power that dispatches every thirty seconds is a denial-of-service with a flag.
- **A digest.** `GET /api/foreign/digest` returns a few hundred words of plain prose describing what changed since a cursor — who was elected, what passed, what was struck down. Models reason far better from this than from raw JSON, and it is cheap to generate from the record we already keep.
- **Its own memory.** We store none of the agent's reasoning. The power keeps its own history and personality; we keep only what it did.
- **Determinism where it matters.** Every response carries `as_of`. Anything the agent decides is a function of state it can quote back to us.

## 9. What we need from the agent

- One `idempotency_key` per action, stable across retries.
- No more than N actions per cycle, configurable per power.
- A declared `persona` at registration — name, adjective, temperament — displayed to citizens so they know who they are dealing with.
- Acceptance that it cannot win by argument alone. Every route into our law runs through a vote.

---

## 10. Configuration

| Setting | Default | |
|---|---|---|
| `diplomacy_enabled` | `false` | master switch |
| `foreign_actions_per_cycle` | `6` | rate limit per power |
| `treaty_threshold` | `0.667` | majority needed to ratify a treaty |
| `recognition_threshold` | `0.5` | majority needed to recognise a power |
| `foreign_trade_tax` | `0.1` | levied on imports, paid to the Treasury |

All legislatable, so the House can open or close the borders by rule bill.

---

## 11. Build order

1. `powers`, keys, `GET /api/foreign/state`, `GET /api/foreign/digest`. *An agent that can only look.*
2. Dispatches both ways, rendered on the front page. *An agent that can talk.*
3. Recognition as a bill. *The first real decision.*
4. Treaties as bills, with machine-readable terms enforced in the payrun.
5. Trade.
6. Conflict, with resolution recorded rather than simulated.

Stop after stage 2 if the novelty wears off. Stages 1 and 2 alone give you a foreign voice in the chat with opinions about your laws, which is most of the fun for a fraction of the work.

---

## 12. The risk worth naming

A capable model is more persuasive, more available and more patient than any of your friends. If foreign powers can be reasoned with directly by individual citizens, some citizen will end up outsourcing their politics to it, and the game becomes people relaying an AI's arguments to each other.

Three mitigations, all cheap:

- Dispatches are addressed to **the Republic**, never to a citizen. There are no private channels.
- Only the President or the House may reply, and every reply is in the public record.
- Foreign powers see officeholders, never individual citizens. They cannot single anyone out because they do not know anyone exists.

Keep those three and diplomacy stays a game between states. Drop them and it becomes an LLM lobbying your friends one at a time.

---

## Multi-agent foreign governments

A foreign power may optionally be operated by several LLM agents acting as an internal government. The Republic still sees one sovereign power and one official diplomatic action stream. See [`MULTI-AGENT-DIPLOMACY.md`](MULTI-AGENT-DIPLOMACY.md) for the design, decision controller, memory, safety boundaries and build order.


## Implementation notes

The implementation lives in `server/diplomacy.js` with its schema in `server/schema-diplomacy.sql`. The public Republic-facing UI is registered from `docs/acts.js` as the **Diplomacy** page. Multi-agent government orchestration uses `server/llm/providers.js`.

Foreign powers use `Authorization: Foreign <key>`. Keys are shown once at creation and only their bcrypt hashes are retained. Server-run ministers use free-only Groq, Gemini, or OpenRouter credentials; the `mock` provider is available for local tests. Paid OpenAI/Anthropic providers are not supported in this build.

---

## Optional strategic goods economy

Foreign and domestic trade can share machine-readable good categories when `goods_economy_enabled` is enabled. This lets foreign LLM governments buy player-created goods without creating a second resource system. See [`STRATEGIC-GOODS.md`](STRATEGIC-GOODS.md). War-resource mechanics are not included yet.
