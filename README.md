# The Realm

A political game for one group chat: a Founding Convention, a 5-seat Parliament, a Speaker, a head of state, proposals, money, a press, and a backroom of secrets that opens after two weeks. Elections every three weeks.

Free to run: GitHub Pages for the site, Render for the API, Neon for Postgres. Old Republic logins carry over.

## Try it without deploying

```
npm install
npm run dev        # http://localhost:5173, the whole game in your browser
```

## Deploy (or cut over from v1)

1. **Snapshot Neon** (Branches → Create branch from main). v2 adds tables but leaves `users` alone.
2. **Render** (existing `republic-api` service): Settings → Node 22, keep `DATABASE_URL` and `JWT_SECRET`, add `ALLOWED_ORIGINS=https://bigdreamerdev.github.io`. Start command `npm start`, root `server`.
3. **Merge** this branch into `main`. Render redeploys the API; Pages publishes `docs/`.
4. Open the site and sign in as `admin`. Every approved, active account is already a citizen. The Founding Convention is open.

`docs/config.js` holds the API address and is never rebuilt. Change it by hand only if the Render URL changes.

## Running it (Returning Officer)

**Realm → Admin**: approve sign-ups, open or close sign-ups, move the calendar, reset a forgotten password (the Gazette says you did), download a full export, or reset the realm (a snapshot is kept).

Everything else, including the rules, changes only through Parliament.

## Can players cheat?

The server holds the only full copy of the world and sends each player their own redacted view: no one else's ballot, wallet, cards, deals, plots or objectives. Every action is re-checked on the server, one at a time. Tokens are signed and versioned, and changing a password signs out every other device.

The Returning Officer plays too and can hold office, so every admin action, including starting a crisis, resetting a password or taking an export, is announced in the Gazette and kept in a public log.

What doesn't hold: the RO can reset a password and sign in as someone; that reset is public. Someone with a friend's WhatsApp has their vote.

## Security

See [SECURITY.md](SECURITY.md) for the threat model, what's been fixed, and how to switch on sign-in with Discord, Google, Microsoft or Apple.

## Build your own app

There's a public API: make a key under **You → Build your own app**, then see [API.md](API.md). [examples/minimal.html](examples/minimal.html) is a working client in one file.

## Develop

See [CLAUDE.md](CLAUDE.md).
