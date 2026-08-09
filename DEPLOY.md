# Deploy this

Core Republic — elections, bills, laws, the constitution, the clock, Article 12.
No Court, no economy, no diplomacy. Those exist and can be added later without
touching any of this.

## What is new

**Article 12 — Extraordinary Circumstances.** The President can move a
declaration; the House votes on it like any bill; a majority of the House can end
it at any moment without asking the President; it lapses on its own.

**The desk.** Every officer lands on what is waiting for them, with the buttons
there. The President assents from the front page.

**Installable on a phone.** Manifest, icons from your flag, offline shell.

**Dark mode**, derived from the Flag Act rather than a second stylesheet.

## Push these

```
docs/index.html
docs/app.js
docs/styles.css
docs/manifest.webmanifest      ← new
docs/sw.js                     ← new
docs/icons/                    ← new folder
server/server.js
server/schema.sql
```

**Do not copy `docs/config.js`.** Yours holds your Render URL; mine holds a
placeholder.

Push the two `server/` files together — the emergency tables are created by
`schema.sql` on boot and `server.js` needs them. Everything is `IF NOT EXISTS`,
so redeploying is safe and your existing data is untouched.

Then hard-refresh (Ctrl/Cmd+Shift+R). Pages caches JS hard, and a stale `app.js`
looks exactly like a failed deploy.

## Article 2 — the People's power

The Constitution's most powerful mechanism had no machinery at all until now.
Two thirds of **all** citizens — not of those who turn up — may:

| | |
|---|---|
| Appoint a Speaker directly | Article 4.6, over a deadlocked House |
| Remove any officer | Article 10.5, at any time, for any reason or none |
| Dissolve the House | Article 10.6 |
| End a declaration of extraordinary circumstances | Article 12.3 |
| Resolve anything else | Article 2.3, recorded and binding on every officer under 2.5 |

It is a standing motion, not a poll: any citizen opens one, signatures gather,
and the act happens **the moment two thirds is reached**. No officer opens it,
closes it, or is asked about it — because Article 2 does not ask one. Find it
under **The People**.

`supermajority_share` (0.667) and `supermajority_days` (7) are legislatable.

## Article 7 — one seat, and the right to leave it

**7.1 was not enforced.** A sitting MP could be made President and hold both,
which also broke 5.5 by putting the President in the House's divisions. One seat
each is now checked when an office is granted and when an election is certified —
someone who wins a second office simply is not seated in it. Speaker and MP count
as **one** seat, because Article 4.1 makes the Speaker a member of the House.

**7.4 did not exist.** An officer could only be removed by somebody else, which
is not what the Constitution says. Any officer can now resign from their own
account page, at any time, giving no reason. Resigning from the House takes the
chair with it.

## Article 12, in practice

The President goes to **Article 12**, writes what the circumstances are, ticks
the powers being claimed, and picks a duration. That becomes a bill. The House
seconds, tables, divides and assents like anything else.

Powers that may be claimed:

| | |
|---|---|
| `halt_elections` | no new poll opens and the clock does not advance |
| `extend_term` | the sitting House stays past the cycle |
| `fast_track` | no seconders needed to table |
| `president_may_table` | the President takes the Speaker's business |
| `lower_quorum` | a division carries on one member |
| `close_borders` | no foreign trade or new treaties |

**Three things can never be suspended**, however a declaration is worded: the
House's power to end it, impeachment, and a poll that has already opened. An
emergency that could switch off its own off-switch is not an emergency power.

While one is in force a red banner sits above every page, naming who declared it,
what it suspends, how long is left, and how many members have moved to end it —
with the button to do so. A suspension of the ordinary law that is easy to forget
about is the dangerous kind.

`emergency_max_days` (3) caps the length. `emergency_end_share` (0.5) sets how
much of the House ends one. Both are legislatable, so the House can tighten its
own emergency rules by rule bill.

## Checking it

```
cd server
npm install
npm run dev            # localhost:4321, seeded, nothing deployed
npm test               # nine suites
npm run test:layout    # five frontend checks
```

`test/emergency.mjs` covers the limits rather than the powers: that the Speaker
cannot declare one, that an invented power is refused, that a claimed power does
not grant an unclaimed one, that one member of five cannot end it and three can,
and that a declaration lapses on its own with nobody remembering.
