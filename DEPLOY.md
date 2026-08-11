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

## The Returning Officer no longer holds every office

Previously an admin passed every office check, so your screen offered the
Speaker's buttons, the President's, and a vote in every division at once. That is
gone. The Returning Officer administers the machinery — invites, approvals, the
rules, calling elections, appointing and removing officers — and exercises none
of the offices.

If the Speaker vanishes mid-week, the answer is to **appoint a new one** from the
admin page, not to stand in for them. An admin who can assent to their own bills
makes every result look arranged, which is the one thing this whole system exists
to avoid.

Practical effect: unless you also hold a seat, you will no longer see Table,
Call the division, Assent or Veto anywhere. Your desk will say the Republic is
not waiting on you, because it is not.

## The Prime Minister — Article 17

**The President appoints, the House confirms, the House alone removes.** That
triangle is the whole safeguard: a PM the President could dismiss would be an
employee, and one the House could not remove would be a second President.

**Assent has moved.** The Prime Minister assents to ordinary bills. The President
keeps constitutional bills and any rule bill touching the electoral system —
seats, cycle length, thresholds, quorum, who votes. So the two never hold the
same key to the same door.

With no Prime Minister in office, the President assents to everything. The
Republic does not stop legislating because an appointment has not been made.

**No confidence** is one endpoint, not a bill: any member moves it, each vote
counts as it is cast, and the office falls the moment a simple majority has
moved. No Speaker, no division, no President.

**Three refusals dissolve the House.** The Speaker declares each refusal; on the
third the seats are vacated and contested afresh, so a House that will confirm
nobody is sent back to the country rather than left to sulk.

**The casting vote went to the Speaker, not the Prime Minister.** A tied division
used to be lost silently. It now goes to the chair, by the same convention that
gives the Speaker the business of the House. Giving it to whoever assents would
let one person break a tie and then approve the result of it.

Endpoints: `GET/POST /api/prime-minister`, `/confirm`, `/refuse`,
`/no-confidence`, and `POST /api/bills/:id/casting-vote`.

**The Vice President is gone.** Succession, acting and the VP casting vote have
been removed with it.

## The Court and the economy are now in this build

`judiciary.js`, `economy.js` and `schema-acts.sql` ship here, so one deploy gets
the Supreme Court, money, tax, enterprise, banking and the share market alongside
everything else. Diplomacy is deliberately not included.

`docs/acts.js` probes the server before registering anything, so tabs appear only
for what actually answers.

## Article 2 — the People's power

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
