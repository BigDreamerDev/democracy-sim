# Setting it up

From nothing to a running Republic. Budget about half an hour the first time. Everything here is on free tiers.

You need: a GitHub account, an email address, and the group chat.

---

## What you are building

```
   GitHub Pages                 Render                    Neon
   ┌──────────────┐   HTTPS    ┌──────────────┐         ┌──────────┐
   │   docs/      │ ─────────► │   server/    │ ──────► │ Postgres │
   │  the site    │            │   the API    │         │ the state│
   └──────────────┘            └──────────────┘         └──────────┘
    free, always up             free, sleeps             free, persists
```

The site is static files and holds nothing. Every rule is enforced by the API. The database is the only thing that matters — back nothing else up.

---

## Step 1 — Get the code into your own repo

Create a new repository on GitHub. It can be public; nothing secret lives in it. Put the project files at the root so you end up with:

```
your-repo/
├── docs/          ← the site
├── server/        ← the API
├── constitution.md
├── HANDBOOK.md
├── SETUP.md
└── README.md
```

Commit and push.

> **Never commit `.env`, your database URL, or your JWT secret.** The included `.gitignore` covers the usual cases. Secrets go in Render's dashboard, never in the repo.

---

## Step 2 — The database

Go to [neon.tech](https://neon.tech), sign up, create a project. Copy the connection string it gives you — it looks like:

```
postgresql://user:password@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Keep that tab open.

**Why Neon and not Render's own Postgres:** Render's free database has historically been time-limited, and when it expires your Republic evaporates. Neon's free tier persists. If you would rather use Render's, check its current terms first — losing the statute book two months in is a bad afternoon.

You do not need to create any tables. The server builds its own schema on first boot, and re-running it is safe.

---

## Step 3 — The API on Render

Go to [render.com](https://render.com) → **New** → **Web Service** → connect your GitHub repo.

| Setting | Value |
|---|---|
| Root directory | `server` |
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Instance type | Free |

Then add environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string from step 2 |
| `JWT_SECRET` | 32+ random characters — generate, don't invent |
| `ALLOWED_ORIGINS` | leave blank for now; you fill this in at step 5 |

For the secret, run this and paste the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**The server will refuse to start if `JWT_SECRET` is missing or shorter than 24 characters.** That is deliberate: anyone who guesses that string can forge a login as any citizen, including you. Do not use a word.

Deploy. Watch the log until you see:

```
[republic] No citizens yet — the first account to register becomes admin.
[republic] ready
[republic] listening on 10000
```

Check it in a browser:

```
https://your-service.onrender.com/api/health
```

You want `{"ok":true,"at":"..."}`. If you get an error, jump to troubleshooting below.

---

## Step 4 — The site on GitHub Pages

In your repo: **Settings** → **Pages** → Source: **Deploy from a branch** → Branch `main`, folder `/docs` → Save.

Wait a minute, then edit one file — `docs/config.js`:

```js
window.API_BASE = "https://your-service.onrender.com";
```

No trailing slash. Commit. That is the only line you ever need to change.

Your site is at `https://your-username.github.io/your-repo/`.

---

## Step 5 — Lock the API to your site

Back in Render, set `ALLOWED_ORIGINS` to your Pages URL:

```
https://your-username.github.io
```

**Origin means scheme and host only — no repo path, no trailing slash.** If your site is at `https://you.github.io/republic/`, the origin is still `https://you.github.io`. The server now trims a path or slash for you if you paste the whole address, but it is worth knowing why: a browser never sends the path in its `Origin` header, so a mismatch here blocks every request from your site while `/api/health` keeps working perfectly in a tab. It is the single most confusing way this can fail.

Save; Render redeploys. The log will confirm what it accepts:

```
[republic] browser requests accepted from: https://your-username.github.io
```

---

## Step 6 — Found the state

Open your site. You will see the flag, and a sign-in card.

Register. **The first account ever created becomes admin and needs no invite code.** Use a real password — you are the one person who can reset everyone else's.

You now have a Republic of one, with a constitution and a Flag Act already in force.

---

## Step 7 — Let everyone else in

Go to **Returning officer**.

1. **Generate an invite code.** Make them one at a time and put the person's name in the "issued to" box, so you have a record of which code went to whom.
2. **Send it in a direct message.** Not the group chat. A code pasted into the chat can be claimed by whoever reads it first, and then one person has two votes.
3. They register with the code. Their account appears in **Waiting for approval**.
4. **Check the name against the group chat, then approve.** This is the real defence against sockpuppets. Take it seriously — everything else in the system assumes one account per person.

Repeat for everyone. Send them the [handbook](HANDBOOK.md).

---

## Step 8 — Set the rules

Still in **Returning officer**, under **Rules of the game**:

- **`seats`** — the constitution says a sixth of the citizens, rounded down, minimum three. Nineteen citizens gives three seats. Set it before the first election.
- **`nation_name`** and **`motto`** — the name shows in the bar and the digest.
- **`quorum`** — how many MPs must vote for a division to count. Keep it below your seat count or nothing will ever pass.
- **`seconds_required`** — how many people must back a bill before the Speaker can table it. Two is fine for a small chat.

Leave the thresholds alone at first. The House can change all of this later by passing rule bills.

---

## Step 9 — Start the clock

Under **The clock**, pick a start moment and press **Start the cycle**. Leave the date blank to start now.

From then on the server runs elections on its own: nominations, campaign days, the poll, and certification. You do not need to be awake for any of it.

If you would rather run everything by hand at first, leave the clock stopped and call elections from the Elections page.

**Your first three elections, in order:**

1. **Parliament** — everyone stands, everyone votes, the top candidates take the seats.
2. **Speaker** — only MPs may stand or vote. Needs two thirds of the House; expect it to take two ballots.
3. **President** — everyone votes.

Once all three are seated, the game runs itself.

---

## Step 10 — Check it actually works

Before you trust it with real votes:

```bash
cd server
npm install @electric-sql/pglite
npm test
```

This boots the real server against a real Postgres, five times over with a fresh empty database each time, and runs the full legislative cycle plus a suite of a player actively trying to cheat — forged tokens, spoofed voter IDs, ten concurrent ballots from one account, SQL injection, privilege escalation, sockpuppets registered mid-poll. Everything should come back green.

---

## Troubleshooting

**"The server is running but is refusing requests from this site."**
CORS. `ALLOWED_ORIGINS` does not match. Set it to exactly what the message tells you — scheme and host, nothing else — and redeploy. Check the Render log line `browser requests accepted from:` to see what the server actually parsed.

**"Cannot reach ..." on the sign-in card.**
The request never got a reply. Usual causes in order: `API_BASE` in `docs/config.js` has a typo or a trailing slash; the Render service is asleep and needs thirty seconds; the service crashed on boot — check the Render log. Open the browser console (F12) for the underlying error.

**`/api/health` works in a browser tab but the site still fails.**
That is the signature of a CORS problem, not a server problem. Typing the URL into a tab sends no `Origin` header so the server answers happily; the site sends one and the browser discards the reply. Fix `ALLOWED_ORIGINS`.

**Render log says it refused to start over `JWT_SECRET`.**
Working as intended. Set it to 32+ random characters and redeploy.

**Everything is slow the first time each day.**
Free instances sleep after inactivity. The first request wakes it, taking around thirty seconds. Either tell people to be patient, or ping `/api/health` on a schedule from a free cron service.

**Someone can't sign in and swears the password is right.**
Check whether they are still in the approval queue. Unapproved accounts get told plainly, but people skim. Failing that, reset their password from the admin page.

**"Too many attempts."**
Rate limiting. It is per IP, so everyone on the same WiFi shares a bucket. Wait a few minutes, or restart the Render service to clear it.

**A bill won't table.**
It needs `seconds_required` seconders and a sitting Speaker. Check both.

**Nothing passes.**
Check `quorum` against how many MPs actually vote. A quorum of five in a House of five means one quiet week kills everything.

---

## Backups

The database is the entire state. Neon keeps its own history, but before anything drastic — a constitutional rewrite, a big rule change — take your own:

```bash
pg_dump "your-neon-connection-string" > republic-$(date +%F).sql
```

Keep a copy somewhere that is not your laptop.

---

## Handing it over

If you want out, or want the game to be provably fair, promote someone else to admin from the citizens list. Two admins watching each other is worth more than any code, because the one thing the system cannot prevent is an admin resetting a password and voting as somebody else. Every such action is written to the public record — but a record only works if somebody reads it.


## Optional: free-only model-backed foreign governments

The diplomacy cabinet is **hard-locked to free providers**. `LLM_FREE_ONLY=true` is included as an explicit deployment declaration, but setting it to `false` does not enable paid providers in this build.

Create free-tier API keys with one or more of these providers and add them as Render server environment variables:

```text
LLM_FREE_ONLY=true

GROQ_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

The automatic fallback order is:

```text
requested free provider -> Groq -> Gemini -> OpenRouter free router
```

Default models:

```text
GROQ_FREE_MODEL=llama-3.1-8b-instant
GEMINI_FREE_MODEL=gemini-2.5-flash-lite
OPENROUTER_FREE_MODEL=openrouter/free
```

You normally do not need to set those three model variables; the values above are built in.

Free-only mode enforces these rules in code:

- OpenAI and Anthropic are rejected.
- OpenRouter accepts only `openrouter/free` or a model ID ending in `:free`.
- Groq accepts only model IDs on the build's verified free-plan allowlist.
- Gemini accepts only model IDs on the build's verified free-tier allowlist.
- Automatic fallback never crosses into a paid provider or paid OpenRouter route.
- If every configured free provider fails or reaches quota, that minister call fails and the cabinet continues/falls back according to the normal government-turn rules. It does not buy capacity.

**Account billing still matters.** The server cannot inspect whether you have separately upgraded a Groq or Gemini account to a paid billing tier. To guarantee that those providers themselves do not charge you, keep those provider projects/accounts on their free tier and do not attach billing. OpenRouter's `openrouter/free` route is explicitly zero-cost at the model-routing layer.

Never put API keys in `docs/config.js` or another browser-delivered file. They are server environment variables only.

For local development with no provider keys, use the `mock` provider. It takes no real diplomatic action and costs nothing.
