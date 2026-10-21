# The Realm

A political game for one group chat. Friends write a constitution together, stand for election, form parties
and governments, pass laws, run the economy, deal with crises and foreign powers, and plot against each other.
Some of it is played in real life.

Everything closes on its own: miss a vote and it goes ahead without you. You need about five minutes a day.

## How it plays

- **The Founding Convention.** Three days to agree the rules: the realm's name, how many seats, monarchy or
  republic, the voting system, payday, the dividend. Anyone can add options or table new clauses.
- **Induction week.** A week of practice with everything switched on, then it all resets and the first real
  election opens.
- **Parliament.** Elections every few weeks (first past the post, ranked choice, approval or Borda, as the
  Convention decided). The head of state invites a Prime Minister, who appoints ministers. MPs table bills,
  debate, vote, censure, and bring governments down. Everyone can ask questions at PMQs.
- **Money.** Crowns: a weekly dividend, pay for office, tax, a central bank, licensed banks, trade ventures
  abroad, lobbying in public, and a Treasury that quietly borrows when it runs dry.
- **The world.** Five nations with moods of their own. They offer treaties, demand tribute, impose sanctions
  and occasionally declare war. A crisis lands every week; some choices come back weeks later.
- **The press.** Anyone can start a paper. The best story of the week leads the Friday front page.
- **The backroom** (from week three). Secret cards about real players, private deals, blackmail, coups, exile.
- **Bets.** Stake crowns on bills, elections and crises. Winners split the pool. Betting on something you
  then decide yourself leaves a card that can be leaked.
- **Glory.** A daily question (the Red Box) with streaks, achievements, season awards, weekly polls, and a
  Hall of Fame that outlives every reset.

## The Streets (real life, opt-in)

Players who join can take out contracts on each other: a target, a secret "weapon" (a spoon, a sticky note,
a code word) and 72 hours to tag them in person. The target confirms with a code on their phone. Hits make
the target a ghost for two days. There's a weekly Hunt, bounties for real tasks, stalls for selling favours,
and check-ins when you meet up.

The ground rules are built in:

- Nobody who hasn't joined can be targeted, and anyone can leave at any time.
- A tag is a tap or a hand-over, nothing more. Safe zones (lessons, homes, clubs, travel) never count.
- No real money, ever. Crowns can't be bought or cashed out.
- No locations are collected. Photos are stripped of hidden data, including GPS, before they're stored.
- Whoever runs the game can add safe zones and take down bounties and photos, always in public.

## Fair play

The server keeps the only full copy of the game and sends each player just what they're allowed to see: no
one else's ballot, wallet, cards, deals, plots, contracts or bets. Every action is re-checked on the server.
The organiser plays too, so every admin action is announced in the game's Gazette and kept in a public log.
[SECURITY.md](SECURITY.md) has the full threat model and every fix.

## Build your own app

There's a public API for bots, alternative frontends and dashboards. See [API.md](API.md), and
[examples/](examples/) for starter kits: a one-file client, Gazette bots for WhatsApp and Discord, a vote
reminder and a webhook receiver.

## Try it

```
npm install
npm run dev        # http://localhost:5173: the whole game in your browser, bots play everyone else
```

## Run your own realm

It runs free: GitHub Pages for the site, Render for the API, Neon for Postgres.

1. Create a Neon database and a Render web service with root `server/`, start command `npm start`, and the
   environment variables `DATABASE_URL`, `JWT_SECRET` (24+ random characters), `ALLOWED_ORIGINS` (your
   Pages address), `PUBLIC_URL` (the Render address) and `NODE_VERSION=22`.
2. Put the Render address in `docs/config.js` as `window.API_BASE`.
3. Serve `docs/` with GitHub Pages.
4. Make the organiser's account. The server creates its tables on first boot; then add one row to `users`
   with `is_admin = true`. A password hash comes from
   `cd server && node -e "console.log(require('bcryptjs').hashSync('your password', 12))"`. Sign in, open
   **Realm → Admin**, and switch on sign-ups so everyone else can join.

Sign-in with Discord, Google, Microsoft or Apple is optional; [SECURITY.md](SECURITY.md) explains each.

## Develop

[CLAUDE.md](CLAUDE.md) is the guide to the code: the engine, the server, the invariants and how to add things.
