# Documentation

Which document you want, and why there is more than one.

## By what you are trying to do

| I want to… | Read |
|---|---|
| Play the game | [../HANDBOOK.md](../HANDBOOK.md) |
| Deploy it from nothing | [../SETUP.md](../SETUP.md) |
| Deploy a change to a running instance | [../DEPLOY.md](../DEPLOY.md) |
| Ship from a phone or an iPad | [../PHONE.md](../PHONE.md) |
| Look at it without deploying | `cd server && npm install && npm run dev` |
| Find an endpoint, a setting, or a lifecycle | [REFERENCE.md](REFERENCE.md) |
| Understand the Treasury and the Fed | [../MONEY.md](../MONEY.md) |
| Understand diplomacy and the world map | [DIPLOMACY.md](DIPLOMACY.md), §5 of [REFERENCE.md](REFERENCE.md) |
| Run a foreign power's LLM cabinet | [MULTI-AGENT-DIPLOMACY.md](MULTI-AGENT-DIPLOMACY.md), [RUNBOOK-FOREIGN-POWER.md](RUNBOOK-FOREIGN-POWER.md) |
| Change the code | [../CLAUDE.md](../CLAUDE.md) — conventions and traps, first |
| Pick up where the last session left off | [../HANDOVER.md](../HANDOVER.md) |

Diplomacy is in this build now, forward-ported from the older tree along with
its documents. It is off until `diplomacy_enabled` is set to `true`.

## Three invariants

If any of them breaks, stop and read the tests before anything else.

**The ledger sums to zero.** `SELECT sum(balance) FROM accounts` is always `0`.
Money is moved between accounts, never created. This holds through the Fed's
issuance too: issuing pays the Treasury from the Fed's own account, which goes
negative by exactly that much. That negative balance *is* the money supply, which
is also why the sum tells you nothing about how much money exists — read
`circulating` for that. Asserted by `test/money.mjs`.

**Shares are conserved.** A business's holdings always total exactly
`shares_issued`. Asserted by `test/bank.mjs`.

**One person, one vote.** Held by database constraints, not application code.
Asserted by `test/attack.mjs`, which is the reason anyone can trust a result.

## One principle worth stating separately

**The Returning Officer runs the machinery and holds no office.** They may edit
any setting on the admin page; they may not act in an office, and they may not
seat or unseat a Treasurer or a head of the Fed, both of which have routes of
their own that mean something. §7.1 of REFERENCE.md has the detail.

## Keeping these honest

Outdated documentation is worse than none. It has already caused a real bug here
once: a document described foreign trade as opening the closed ledger, the
implementation followed it, and money was minted at the border for weeks while
REFERENCE.md asserted an invariant that was false.

When you change behaviour, change the document in the same commit, and prefer
linking over restating. Every number in these files should exist in exactly one
of them.
