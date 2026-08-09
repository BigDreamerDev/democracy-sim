# The Republic — handbook

How the game works, for everyone playing it. If you are the one deploying it, read [SETUP.md](SETUP.md) first.

---

## 1. The idea

A group chat runs itself as a small state. People stand for election, form parties, argue, pass laws, and occasionally get vetoed. The site holds the rules and keeps the score. It does not enforce anything outside itself — if a law says everyone must send a photo of their dinner on Sundays, the site records the law, and it is on you to honour it.

Two things make it feel real rather than like a poll bot:

- **Nothing is deleted.** Every vote, division, enactment, veto and admin action is written to a public record that cannot be edited. Repealed laws stay readable. Old constitutions stay readable.
- **Almost every rule is changeable from inside the game.** Seats, thresholds, timings, who votes on what — the House can rewrite all of it by passing a bill. The rules are a moving target, on purpose.

---

## 2. Who is who

| Role | How you get it | What it lets you do |
|---|---|---|
| **Citizen** | An invite code, then approval | Vote in elections, propose bills, second them, join or found a party, speak in debates |
| **MP** | Win a seat in a parliamentary election | Everything a citizen can do, plus vote in divisions |
| **Speaker** | Elected by the MPs, from the MPs | Table bills, call divisions, close them, move a veto override |
| **President** | Elected by all citizens | Assent to bills or veto them |
| **Returning officer** (admin) | Whoever deployed it, plus anyone they promote | Approve accounts, generate invites, call elections, appoint and remove officers, run the clock |

The House has five seats by default. Constitutionally it is meant to be a sixth of the citizens rounded down, minimum three, so adjust `seats` as the chat grows.

An officer is a citizen too. The Speaker votes in divisions like any other MP. The President is usually not an MP, but nothing stops it unless you turn on the term limit.

---

## 3. The electoral cycle

If the clock is running, everything below happens on its own.

```
day 1 ─────────── day 5 ─────── day 6 ─── day 7
nominations       campaign                 poll        → certified
(put your name    (make your               (cast       (winners seated,
 forward)          case)                    ballots)    old seats vacated)
```

- **Nominations.** Anyone eligible can put their name forward with a short statement. You can edit or withdraw it up until the poll opens.
- **Campaign.** Same as nominations, but the chat knows it is time to argue. Nominations stay open.
- **Poll.** Everyone gets one vote. It is final the moment you cast it — no changing your mind, no take-backs.
- **Certification.** The top candidates take the seats. Everyone previously seated is vacated. A parliamentary election also vacates the Speaker, since a new House chooses its own.

Timings live in `cycle_days`, `campaign_days` and `poll_days`, and the House can change them by passing a rule bill. Set `cycle_enabled` to `false` and elections only happen when an admin calls them by hand.

**The roll freezes when the poll opens.** Anyone who joins mid-poll votes in the next one, not this one.

---

## 4. Choosing a Speaker

The Speaker is not chosen by whoever gets the most votes. A candidate needs **two thirds of the whole House** — of every seat, not merely of those who voted. In a House of five that is four.

If nobody clears it, nobody becomes Speaker and the House ballots again. **Each failed ballot lowers the bar by one vote**, down to a simple majority and no further. So a House of five deadlocked 3–2 elects its Speaker on the second ballot, at three.

Once a chair has been filled, the bar goes back up to two thirds for the next vacancy. Past failures do not carry over.

While the chair is empty, no bill can be tabled and the business of the House waits. The House can still debate. Citizens can still propose. Nothing moves to a division until someone is in the chair.

---

## 5. How a bill becomes law

```
an MP proposes                  (bill_proposers — the House alone by default)
      ↓
N MPs second it                 (seconds_required, default 2 — not your own)
      ↓
Speaker tables it
      ↓
Speaker calls a division
      ↓
MPs vote aye / no / abstain     (one vote each, final; quorum must be met)
      ↓
Speaker closes the division     → carried, or lost
      ↓
President assents               → law
        or vetoes               → dead. Assent is required.
      ↓
any law may be struck down by referendum at 70%
```

**Only the House proposes, seconds and votes on bills.** If you are not an MP and want something done, ask one to move it for you, or stand at the next election. The House can hand that power to everyone with a rule bill setting `bill_proposers = citizens`.

**The President's assent is required.** A veto kills a bill outright — there is no override unless the House first passes a rule bill setting `allow_veto_override = true`. That makes the presidency the strongest office in the Republic, which is the point: the House writes the law, one elected person can refuse it, and the whole Republic can overrule them both.

A bill carries on a simple majority of aye and no votes; abstentions do not count towards either side. A tie is lost. Constitutional bills need two thirds.

If the President vetoes, the Speaker can move an override — but only if the original division already cleared the override threshold (two thirds by default). A bill that scraped through 3–2 cannot be rescued from a veto.

**Kinds of bill**

| Kind | What it does |
|---|---|
| `law` | Creates a new law in the statute book |
| `amendment` | Rewrites a law that already exists, in place |
| `repeal` | Strikes a law from the active book; it stays readable in the archive |
| `motion` | Resolves something without creating a statute — censures, no confidence, declarations |
| `constitutional` | Publishes a new version of the constitution; needs two thirds |
| `impeachment` | Removes an officer. Names a person, not a law. Carries at two thirds and takes effect at once — it never goes to the President |
| `rule` | Changes a setting of the game itself |

---

## 6. Rule bills — the House changing its own rules

Write one change per line, as `setting = value`:

```
cycle_days = 5
campaign_days = 1
seats = 7
```

If it passes and gets assent, the setting changes immediately. The bill page shows a before-and-after for each line, so people vote on the actual effect rather than a paragraph describing it. Rule bills do not enter the statute book — they are standing orders, not law.

**What can be changed this way:** seats, quorum, seconders required, every threshold, who votes on bills, secret ballot, every cycle timing, the Speaker rules, the term limit, the name and motto of the state, and which law the flag comes from.

**What cannot:** `require_approval` and `allow_open_signup`. Those decide who gets an account at all. A faction with one lucky majority could flip them, let in a pile of sockpuppets, and hold every majority afterwards — permanently. They stay with the returning officer. This is the single place where the constitution's promise that a supermajority can change anything is not honoured, and it is deliberate.

---

## 6a. The people's veto

The House makes the law; the Republic can take it back.

Open the **Statute book**, find a law in force, and press **Call a referendum**. That signs a petition. When a third of citizens have signed, the referendum opens by itself — the House is not asked and the President cannot stop it.

Everyone then votes **keep** or **reject**. If seven tenths of the votes cast are to reject, and enough people turned out for the count to mean anything, the law is repealed the moment the poll closes.

| Setting | Default | |
|---|---|---|
| `petition_share` | 0.334 | share of citizens needed to force the referendum |
| `referendum_threshold` | 0.7 | share of votes cast needed to strike the law down |
| `referendum_quorum` | 0.5 | share of citizens who must vote for it to count |
| `referendum_days` | 2 | how long the poll stays open |

All four are legislatable, so the House can make its laws harder or easier to overturn — including making itself easier to overrule.

## 6c. Citizens' initiatives

Petitions work in both directions. The one above takes a law away; this one puts one there.

Anyone — MP or not — can draft an **initiative** from the **Bills page**, in the *Start an initiative* card. It appears for every citizen, including MPs, since the point of the route is that it goes to the people rather than through the House.

Signing happens on the initiative's own page, with a bar showing how far it has to go. Open initiatives and open referendums are flagged on the front page so nobody misses one. What happens when a third of citizens have signed depends on `initiative_mode`:

| Mode | What signatures buy |
|---|---|
| `table` *(default)* | The House **must** take it up. No seconders needed — the signatures are the seconding. The House still votes and the President still has to assent, so it can still be thrown out. |
| `enact` | It goes **straight to the Republic**. At `initiative_threshold` (70%) with quorum, it becomes law directly — no House vote, no presidential assent. |
| `off` | Nothing. Citizens cannot start one. |

`table` is the default because it costs the House nothing it should keep: the people get a guaranteed hearing, and the House keeps the decision. `enact` is a genuine constitutional shift — it makes both the House and the President bypassable, so a determined 70% can legislate around them entirely. Switch it on deliberately, not by accident.

Either way the House chooses, by rule bill, which is the point.

## 6b. Impeachment

The House can remove any officer — the President, the Speaker, or one of its own. Propose a bill of kind `impeachment`, pick the officer from the list, and it runs like any other bill: seconders, tabling, division.

It carries at **two thirds** rather than a simple majority, and when it carries the officer loses every office they hold **immediately**. It does not go to the President for assent, for the obvious reason that the President would otherwise veto their own removal.

An impeached citizen stays a citizen, keeps their vote, and can stand again.

---

## 7. The flag

The flag is a law. `L001 — The Flag Act` exists from the first minute the server runs, and it defines both the flag and the colours of the Republic. The site reads it and paints itself accordingly: the bar, the buttons, the links, the seats in the chamber, the tint of the paper.

The law carries a schedule the app can read:

```
band = #006A44 1 — Emerald
band = #FFFFFF 1 — White
band = #003087 1 — Ocean
device = #F2A800 — Gold
stars = 19
```

`band` lines are top to bottom; the number after the colour is the band's depth relative to the others, so `2` is twice as deep as `1`. `device` is the colour of the star ring, `stars` is how many.

**Amend the Act and the site changes with it.** No admin action, no redeploy. The moment the President assents, the flag redraws and the palette follows.

How the colours are assigned:

- The **largest dark band** becomes the primary colour — the top bar, the chamber.
- The **device** becomes the accent — buttons, links, the seal. If there is no device, the most colourful remaining band is used instead. If nothing on the flag has any colour in it, the primary is used rather than inventing one.
- The **lightest colour** tints the paper, faintly.
- Every result is then checked for contrast and darkened until it reads. A flag of pale yellow will not produce unreadable text, and an all-black flag will not produce a black page.

You can override the automatic choice from within the law itself by adding `primary = #HEX` or `accent = #HEX` to the schedule.

Aye-green and no-red in divisions are deliberately *not* taken from the flag. Those two colours carry meaning, and a flag whose colours happened to be red and green would make the division strip unreadable.

If the Flag Act is repealed, the Republic has no flag and the site falls back to its default palette. That is allowed. A state is entitled to abolish its own flag.

---

## 8. Parties

Anyone can found a party with a name, a short code and a colour. One membership each — joining a new party leaves the old one automatically.

Parties have no mechanical power. They do not whip votes or hold seats. What they do is show: an MP's party colour fills their seat in the chamber, and candidates carry their party tag on the ballot. That turns out to be enough to make coalitions and defections feel real.

The founder is the leader and can edit the manifesto.

---

## 9. The record

Every action is logged with who did it and when: registrations, approvals, nominations, votes cast (that a vote happened, never what it was), divisions, enactments, vetoes, rule changes, password resets, suspensions, promotions to admin.

Nothing can be deleted from it. This is the main check on the returning officer, who is otherwise trusted with a lot.

The record page also has a paste-ready digest of the current state of the union — offices, open elections, live business, laws in force — with a copy button. Drop it in the chat.

---

## 10. The secret ballot

While a poll is open, nobody can see the counts, including admins. They appear when the poll closes. Turn it off with `secret_ballot = false` if you would rather watch it live.

No endpoint anywhere joins a voter to the candidate they chose. The log records that you voted, never what you voted for.

Divisions on bills work the opposite way and are public by name, as in a real parliament. If you vote against something, everyone knows.

---

## 11. Things that will come up

**Someone wins a seat and immediately goes inactive.** Remove them from the admin page and appoint a replacement, or dissolve parliament and hold a fresh election.

**A tie on the last seat.** The app flags it and seats nobody in the disputed position. Settle it however you like — coin toss, run-off, Speaker's casting vote — and appoint from the admin page. It goes in the record either way.

**A deadlocked Speaker vote.** Ballot again; the bar falls each time. If the House genuinely will not agree, a supermajority of citizens can appoint one directly under Article 4.6.

**Someone forgets their password.** Reset it from the admin page. It gives you a temporary one to send them and logs them out of every device. The reset is written to the public record, visible to everyone.

**A bill that everyone hates gets seconded anyway.** Let it go to a division and die there. The record of it failing 0–5 is funnier than blocking it.

**The first request of the day is slow.** Free hosting sleeps. Give it thirty seconds.
