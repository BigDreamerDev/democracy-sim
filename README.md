# The Republic

A small parliamentary democracy for one group chat. Static front end on GitHub Pages, API on Render, Postgres anywhere.

- **[SETUP.md](SETUP.md)** — deploying it, start to finish
- **[HANDBOOK.md](HANDBOOK.md)** — how the game works, for the people playing it
- **[constitution.md](constitution.md)** — the founding document, to paste in at startup
- **[CLAUDE.md](CLAUDE.md)** — conventions, architecture and traps, for anyone (or anything) editing the code
- **[docs-src/](docs-src/README.md)** — the documentation index: reference, diplomacy, and the foreign-power runbook

Look at it without deploying: `cd server && npm install && npm run dev`.

The state has a flag, and the flag is a law. `L001 — The Flag Act` is in force from the first minute and the site takes its entire palette from it. Amend the Act and everything re-skins itself the moment the President assents.

```
republic/
├── docs/              → GitHub Pages serves this
│   ├── index.html
│   ├── config.js        ← the only file you edit after deploying
│   ├── styles.css
│   └── app.js
├── server/            → Render runs this
│   ├── server.js
│   ├── schema.sql
│   ├── package.json
│   └── test/            npm test — 22 suites, each on a fresh database
├── constitution.md      paste into the admin page at startup
├── flag.png             the flag as designed, for reference
├── render.yaml          optional Render blueprint
├── SETUP.md
└── HANDBOOK.md
```

## Deploy

**1. Database.** Create a free Postgres and copy its connection string.
[Neon](https://neon.tech) is the safe pick — the free tier doesn't expire. Render's own free Postgres works too but has historically been time-limited, so check before you rely on it.

**2. API on Render.** New → Web Service → connect this repo.

| Setting | Value |
|---|---|
| Root directory | `server` |
| Build command | `npm install` |
| Start command | `npm start` |
| `DATABASE_URL` | your Postgres connection string |
| `JWT_SECRET` | 32+ random characters — the server refuses to start without it |
| `ALLOWED_ORIGINS` | `https://you.github.io` (optional, locks the API to your Pages site) |

The schema builds itself on first boot. Hit `https://your-service.onrender.com/api/health` to confirm.

**3. Front end on GitHub Pages.** Settings → Pages → Source: `main` branch, `/docs` folder.
Then edit `docs/config.js`:

```js
window.API_BASE = "https://your-service.onrender.com";
```

Commit. Done.

**4. Found the state.** Open the site and register. The first account ever created becomes admin automatically and needs no invite code. Everyone after that needs one.

## Running it

Go to **Returning officer** (admin only):

- **Approve new accounts.** Anyone who registers waits in a queue until you check the name against the group chat. This is the main defence against one person holding two votes — take it seriously.
- **Generate invite codes** one at a time and DM them. Single-use, and the queue shows you which code each applicant used.
- **Rules of the game** — seats, thresholds, quorum, the name of the state. All live, all editable.
- **Appoint and remove** — for ties, resignations and coups.

Then: call a parliamentary election → let people stand → open the poll → close and certify. Certifying seats the winners automatically. Do a Speaker election next (only MPs can stand or vote), then a presidential one.

**Who changes the rules**

Most settings are not yours alone. Anyone can propose a bill of kind **rule**, written as one `setting = value` per line; if it passes and gets assent, the setting changes. The bill page shows the before-and-after so people vote on the actual effect, and the change goes into the record.

```
cycle_days = 5
campaign_days = 1
```

Two settings are deliberately not legislatable: `require_approval` and `allow_open_signup`. They decide who gets an account, and a faction with one temporary majority could use them to admit enough sockpuppets to hold every majority after that. They stay with the returning officer. Everything else — seats, thresholds, quorum, timings, who votes on bills, even the name of the state — is the House's to change.

**How a bill becomes law**

```
anyone proposes  →  N citizens second it  →  Speaker tables it
     →  Speaker calls a division  →  MPs vote aye / no / abstain
     →  Speaker closes it  →  President assents (or vetoes)
     →  statute book
```

A veto can be overridden by the Speaker if the original division cleared the override threshold. Bills of kind `amendment` rewrite the law they target; `repeal` strikes it from the active book but leaves it in the archive; `constitutional` publishes a new version of the constitution and needs a supermajority; `motion` resolves without entering the statute book.

## Settings

| Key | Default | What it does |
|---|---|---|
| `nation_name`, `motto` | — | Branding |
| `seats` | 5 | Seats in parliament |
| `term_days` | 14 | Term length, for your own reference |
| `seconds_required` | 2 | Seconders before the Speaker may table a bill |
| `quorum` | 3 | Votes needed for a division to count |
| `pass_threshold` | 0.5 | Ordinary bills, as a share of aye + no |
| `constitutional_threshold` | 0.667 | Constitutional amendments |
| `veto_override` | 0.667 | Override a presidential veto |
| `bill_voters` | `mps` | Set to `citizens` for direct democracy on bills |
| `secret_ballot` | `true` | Hide election counts until the poll closes |
| `allow_open_signup` | `false` | Set `true` to drop invite codes |

## Can players cheat it?

Assume every player reads the source, because the front end is public and so is this repo. Nothing in `docs/` is trusted: hiding a button hides a button, and every rule is enforced again on the server.

**Run the tests before you trust any of this.** `cd server && npm install && npm test` boots the real server against a real Postgres and runs 22 suites. `test/attack.mjs` is the one to read: it asserts against players actively trying to cheat — forged tokens, spoofed voter IDs, concurrent ballot floods, SQL injection, privilege escalation, mid-poll sockpuppets.

**What holds, and why**

| Attack | What stops it |
|---|---|
| Voting twice | `UNIQUE (election_id, voter_id)` in Postgres. Ten simultaneous requests still produce one row. |
| Voting twice in a division | `PRIMARY KEY (bill_id, user_id)`, same guarantee. |
| Voting as someone else | Identity comes only from the signed token. `voter_id` in a request body is read by nothing. |
| Forging a token | Signed with `JWT_SECRET`. The server refuses to boot if that is missing or under 24 characters, so there is no weak default to guess. |
| Reusing a stolen token | Tokens carry a version. Changing a password, or an admin resetting one, invalidates every token issued before it. |
| Guessing a password | 8 character minimum, obvious ones blocked, and lockout after 8 failed attempts on an account. |
| Making sockpuppets | Invite codes are single-use, **and** every new account waits in an approval queue you check against the group chat. |
| Registering mid-poll to vote | The electoral roll freezes the moment the poll opens. Accounts created after it are not on it. |
| Withdrawing to void ballots | Blocked once voting starts. |
| Reopening a finished election | A certified election cannot be reopened. |
| Seizing an office or rewriting the rules | Every admin, Speaker and President action is re-checked server-side against the `offices` table. |
| Reading the secret ballot | No endpoint joins voters to candidates. The log records *that* you voted, never *what*. |
| SQL injection | Every query is parameterised. |

**What does not hold, and you should know it**

- **You can cheat.** Admins bypass office checks and can reset any password, which means logging in as anyone. That is unavoidable — somebody has to run it. The mitigation is that *every* admin action on an account writes to the public record, so a reset shows up under **The record** where everyone can see it. If you want the game to feel fair, make a second person admin and let them watch you.
- **Codes pasted into the group chat are first-come-first-served.** Generate one at a time, note who it is for, and DM it. The approval queue is your backstop.
- **Rate limits are per IP and live in memory.** People sharing WiFi share a limit, and a Render restart clears them.
- **Someone who gets into a friend's WhatsApp gets their vote.** No app-side fix exists for that.

## Other guarantees

- **One party membership per citizen**, `PRIMARY KEY (user_id)` on the membership table.
- **Nothing is deleted.** Repealed laws, lost bills, old constitutions and every action taken are kept and readable under *The record*.

## Things you'll want on day one

- Render's free tier sleeps after inactivity. The first request after a quiet spell takes ~30 seconds. Tell people to wait, or ping `/api/health` on a schedule.
- **The record** page has a paste-ready digest of the current state for the group chat. Copy button, one tap.
- If someone forgets their password, reset it from the admin page — it hands you a temporary one to send them.

## Ideas the system is already shaped for

- **Votes of no confidence** — propose a `motion`, and if it carries, dissolve parliament from the admin page and call a fresh election.
- **Coalitions** — parties are cosmetic in the code but MPs' party colours show in the chamber, which is enough to make deals feel real.
- **Referendums** — create an election of kind `referendum`; the "candidates" become the options and nobody gets seated.
