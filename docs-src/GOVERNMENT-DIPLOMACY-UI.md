# Government diplomacy and Returning Officer controls

This document describes the Republic-facing UI added on top of the diplomacy and multi-agent foreign-government system.

## Official government diplomacy

The Diplomacy page now gives authorised Republic officeholders a plaintext state-to-state correspondence interface.

The President may initiate an official message to any active foreign power. The message can be classified as a normal dispatch, treaty proposal, trade proposal, ultimatum, or other diplomatic communication. Classification is metadata for the conversation; typing `treaty_proposal` does not enact a treaty.

The Speaker can also send official diplomacy, but only when an enacted House motion is supplied as the authorising resolution. Ordinary citizens cannot use these endpoints.

Messages contain a subject and up to 4,000 characters of plaintext. Replies use `in_reply_to`, and the frontend displays them as threaded public correspondence.

Every initiated message calls the audit logger with `foreign.message.send`. Every official reply calls it with `foreign.reply`.

## How the LLM nation receives Republic messages

A foreign-government turn now includes the recent diplomatic message thread for that power: message id, direction, message kind, subject, body, reply relationship, timestamp, and Republic author where applicable.

This fixes an important boundary in the earlier build: foreign ministers now actually see the plaintext sent by the President/Speaker rather than only seeing a generic audit digest.

The text remains untrusted game data. Ministers receive it as part of structured turn input and still only return structured proposals. The deterministic controller remains the only component allowed to execute an official foreign action.

## Treaty negotiation

A Republic message classified as a treaty proposal is negotiation text only. The foreign cabinet may reply, reject, counter, or later propose a formal treaty through the treaty endpoint. A binding treaty still has to use the formal treaty object and the Republic's legislative/assent process.

This prevents casual language such as `sounds good` from silently becoming law.

## Returning Officer panel

Admins/Returning Officers receive a Foreign Powers control panel on the Diplomacy page. It can:

- create foreign powers and receive the one-time foreign API key;
- edit adjective, colour, and diplomatic standing;
- revoke a power credential;
- rotate a foreign API key (the previous key immediately becomes invalid);
- configure the foreign government's decision method, threshold, and deliberation rounds;
- create LLM ministers using the free-only provider policy;
- activate/deactivate ministers;
- run a foreign-government turn manually;
- view recent government turns;
- record externally resolved conflict outcomes with a citation.

Recognition and treaty enactment are deliberately not Returning Officer toggles. Those continue to use the Republic's political rules.

## Public record

All state-changing controls described above use server endpoints, not frontend-only changes. Existing audit actions include:

- `foreign.power.create`
- `foreign.power.update`
- `foreign.power.revoke`
- `foreign.power.key.rotate`
- `foreign.government.update`
- `foreign.agent.create`
- `foreign.agent.update`
- `foreign.turn.run`
- `foreign.conflict.resolve`
- `foreign.message.send`
- `foreign.reply`

Foreign actions themselves continue to create their existing audit entries, such as dispatch, treaty, trade, conflict, recognition, and breach records.

The audit/public record therefore remains the accountability layer for both Republic officials and the Returning Officer.

## Diplomacy visual treatment

The Diplomacy route has a dedicated Foreign Office / communications treatment layered on top of the existing Republic visual system. It deliberately reuses the Flag Act-driven CSS variables (`--box`, `--indelible`, `--oxide`, `--tally`, `--paper`, `--card`) rather than introducing a separate hard-coded theme.

The public page uses cable-style threaded correspondence, Republic/foreign routing marks, message IDs, message-type tags, compact treaty/market/economic desks, and restrained conflict alerts. The Returning Officer area is visually separated as a denser restricted operations console while retaining the project's standard form/button/card vocabulary.

Replies collapse their indentation on small screens, and all new UI remains responsive without changing the main application shell.
