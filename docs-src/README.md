# Documentation

Seven documents, and it is not obvious which one you want. Start here.

## By what you are trying to do

| I want to… | Read |
|---|---|
| Play the game | [../HANDBOOK.md](../HANDBOOK.md) |
| Deploy it from nothing | [../SETUP.md](../SETUP.md) |
| Add the Court or the economy to a running instance | [../INSTALL-ACTS.md](../INSTALL-ACTS.md) |
| Look at it without deploying | `cd server && npm install && npm run dev` |
| Find an endpoint, a setting, or a lifecycle | [REFERENCE.md](REFERENCE.md) |
| Change the code | [../CLAUDE.md](../CLAUDE.md) — conventions and traps, first |
| Stand up an LLM foreign power, or fix one | [RUNBOOK-FOREIGN-POWER.md](RUNBOOK-FOREIGN-POWER.md) |
| Understand why diplomacy is shaped as it is | [DIPLOMACY.md](DIPLOMACY.md) |
| Understand how a foreign cabinet decides | [MULTI-AGENT-DIPLOMACY.md](MULTI-AGENT-DIPLOMACY.md) |
| Understand the Republic-facing diplomacy UI | [GOVERNMENT-DIPLOMACY-UI.md](GOVERNMENT-DIPLOMACY-UI.md) |
| Understand strategic goods | [STRATEGIC-GOODS.md](STRATEGIC-GOODS.md) |
| Know what changed in the last consolidation | [../CONSOLIDATION.md](../CONSOLIDATION.md) |

## The four diplomacy documents, and why there are four

They answer different questions and are meant to be read in this order:

1. **DIPLOMACY.md** — the contract. *What may a foreign power do, and what may it never do?* The one rule everything else follows from: a foreign power's proposals arrive as bills, so our constitution decides, not the agent. Read this before changing anything about diplomacy.
2. **MULTI-AGENT-DIPLOMACY.md** — the cabinet. *How does a power make up its mind?* Ministers, proposal and vote rounds, decision methods.
3. **GOVERNMENT-DIPLOMACY-UI.md** — our side. *How do the President, the Speaker and the Returning Officer act?*
4. **RUNBOOK-FOREIGN-POWER.md** — operations. *How do I run one, and what do I do at 11pm when it stops working?*

`STRATEGIC-GOODS.md` is orthogonal to all four and gated behind `goods_economy_enabled`, off by default.

## Two invariants

If either breaks, stop and read the tests before anything else.

**The ledger sums to zero.** `GET /api/economy` → `supply` is always `0`, including across foreign trade. Money is moved between accounts, never created — foreign powers hold real accounts funded by transfer from our Treasury. Asserted by `test/foreigntrade.mjs`.

**One person, one vote.** Held by database constraints, not application code. Asserted by `test/attack.mjs`, which is the reason anyone can trust a result.

## Keeping these honest

Outdated documentation is worse than none. Two of these have already been wrong in ways that caused real bugs: `DIPLOMACY.md` described foreign trade as opening the closed ledger, and the implementation followed it and minted money; `REFERENCE.md` then asserted an invariant that was false for weeks.

When you change behaviour, change the document in the same commit, and prefer linking over restating. Every number in these files should exist in exactly one of them.
