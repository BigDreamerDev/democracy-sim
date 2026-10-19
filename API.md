# The Realm API

Build your own bot, dashboard or entire frontend for the realm. Your app sees exactly
what you see in the official site and can do exactly what you can do. The server
enforces every rule, so there's nothing to break.

- **Base URL:** `https://democracy-sim-thgx.onrender.com/api/v1`
- **Auth:** `Authorization: Bearer rlm_…` (a personal API key)
- **CORS:** open. Any website, local file or script may call it.
- **Format:** JSON in, JSON out.

## 1. Get a key

In the app: **You → Build your own app → Make a key**.

| Scope | Can |
|-|-|
| `read` | everything under `GET` |
| `act` | that, plus `POST /act`: vote, speak, send money, everything a player can do |

The key is shown once. You can hold 5. Revoke one at any time and it stops working
immediately. A key is not affected by changing your password.

> **Never ask anyone for their password.** If your app acts for other players, each of
> them makes their own key and pastes it into your app.

## 2. First request

```bash
curl -H "Authorization: Bearer $KEY" https://democracy-sim-thgx.onrender.com/api/v1/me
```

```json
{ "id": "u3", "name": "Bilal", "party": "pa12", "crowns": 113, "influence": 24, "approval": 55, "scope": "read", "keyName": "My bot" }
```

The free server sleeps when idle; the first request after a quiet spell can take ~30s.

## 3. Endpoints

### `GET /api/v1` — no key
What's here.

### `GET /api/v1/commands` — no key
Every action, what it does and its arguments:

```json
{ "prop.vote": { "about": "Vote on a proposal.", "args": { "prop": "id", "vote": "'aye' | 'no' | 'abstain'" } }, … }
```

### `GET /api/v1/me`
You: `id`, `name`, `party`, `crowns`, `influence`, `approval`, plus the key's `scope` and `keyName`.

### `GET /api/v1/state`
The whole world as you see it.

```json
{ "world": { … }, "me": "u3", "serverNow": 1792432800000, "version": 418 }
```

- `version` goes up every time anything in the realm changes.
- **Wait for changes (long-poll):** `GET /state?since=418&wait=25` holds the request for up
  to 25 seconds and returns as soon as the version passes 418. Loop it for near-instant updates
  without hammering the server.
- **Cheap polling:** send back the `ETag` header as `If-None-Match`; you get `304` if nothing changed.

### `GET /api/v1/gazette?since=<id>&limit=<1-100>`
The public record, newest first: `[{ id, at, kind, text, link }]`. With `since`, only entries
newer than that id. Ideal for a bot that posts news to a group chat.

### `POST /api/v1/act` — `act` key
```json
{ "cmd": "prop.vote", "args": { "prop": "p57", "vote": "aye" } }
```
Success: `{ "ok": true, "world": { … }, "me": "u3", "serverNow": …, "version": 419 }`
Refused: `400 { "ok": false, "error": "Voting opens when the debate ends." }`

Error messages are written for players. Show them as they are.

### `GET /api/v1/apps` — no key
The app directory: apps players have registered and listed.
`[{ client_id, name, description, homepage, by, users, created_at }]`

### Webhooks — any key
Rather than polling, have the realm POST to you whenever something enters the Gazette.

| | |
|-|-|
| `GET /api/v1/hooks` | your webhooks |
| `POST /api/v1/hooks` `{ url }` | add one (https only, up to 3). The reply includes `secret`, shown once. |
| `POST /api/v1/hooks/test` `{ id }` | send a `ping` now; replies `{ ok, status }` |
| `POST /api/v1/hooks/delete` `{ id }` | remove one |

You can also manage them under **You → Build your own app**. Each delivery:

```http
POST https://your-bot.example/realm
Content-Type: application/json
X-Realm-Event: gazette
X-Realm-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with your secret>

{ "event": "gazette", "realm": "The Realm", "version": 512, "sentAt": 1792432800000,
  "entries": [ { "id": "g881", "at": 1792432799000, "kind": "law", "text": "The Defence Act becomes law.", "link": "#/law/L004", "via": null } ] }
```

Entries come oldest first and are public news only (nothing secret is ever sent). Answer with
any 2xx within 5 seconds. Deliveries are not retried; after 20 failures in a row the hook
switches off until a successful test. Check the signature before trusting a delivery:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const ok = (raw, header, secret) => {
  const want = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return header?.length === want.length && timingSafeEqual(Buffer.from(header), Buffer.from(want));
};
```

## 4. Sign in with the Realm

Let other players use your app without copying keys around.

1. **Register your app** under **You → Build your own app → Apps you've made**. Give it a redirect
   address: `https://…`, or `http://localhost:…` while developing. You get a `client_id`.
2. **Send the player to the consent page:**
   ```
   https://bigdreamerdev.github.io/democracy-sim/#/authorize?app=<client_id>&scope=act&state=<random>
   ```
   `scope` is `read` or `act`. Put a random `state` in, and check it comes back unchanged.
3. They sign in (if they aren't already) and press **Allow**. They land on your redirect with the key
   in the fragment, which never reaches any server:
   ```
   https://your-app.example/callback#key=rlm_…&scope=act&state=<random>
   ```
4. Read it with `new URLSearchParams(location.hash.slice(1))`, store it, and use it as a normal key.

Signing in again replaces the old key. The player can revoke it at any time, and deleting your app
revokes every key it was given. Apps don't count towards a player's 5 personal keys.

Everything your app does through `/act` that reaches the Gazette is marked **via <your app>**,
for everyone to see.

## 5. Errors and limits

| Status | Meaning |
|-|-|
| 400 | the game said no (`error` explains), unknown action, or bad JSON |
| 401 | missing, wrong or revoked key, or the account is inactive |
| 403 | read-only key tried to act, or you're not a citizen |
| 429 | over 120 requests a minute for this key |
| 500 | a bug on our side; it's logged |

Arguments must be plain JSON: strings up to 4000 characters, lists up to 50 items.
Admin actions are never available through the API.

## 6. The world

Times are milliseconds since 1970 (UTC). Ids are strings. Citizens are `u<number>`.
Accounts are `c:<citizen id>` for people, `treasury`, `reserve`, `office:<id>`, `bank:<id>`.

| Field | What |
|-|-|
| `now`, `phase` | the realm's clock; `'convention'` then `'running'` |
| `config` | realm name, seats, head of state type and title, pay, tax, timings |
| `calendar` | weekly events: `payday`, `pmqs`, `frontpage` → `{ dow, hour }` (UTC; dow 0 = Sunday) |
| `citizens` | everyone: `name`, `party`, `approval`, `influence`, `stamps`, `titles`, `whip`. Private fields are only filled in for you. |
| `convention.clauses[]` | `id`, `q` (the question), `options[]` (strings), `votes`, `adopted` (option index or `null`) |
| `seats`, `speaker`, `pm`, `hos.holder` | who sits in the House and holds the top jobs |
| `parties` | `name`, `colour`, `leader`, `status` (`forming`/`active`/`lapsed`), `motions` |
| `elections` | `kind`, `status`, `candidates`, `closesAt`, `results`, `ballots` (others show `'•'`; yours shows your choice) |
| `proposals` | `n`, `kind`, `title`, `clauses`, `stage` (`debate` → `vote` → `passed`/`assent` → `enacted`, or `failed`/`vetoed`/`override`/`withheld`/`hos`), `debateEndsAt`, `voteEndsAt`, `speeches`, `votes` |
| `laws[]` | the statute book: `ref`, `title`, `text[]`, `summary` |
| `questions[]` | PM's Questions: `text`, `by`, `to`, `backers`, `answer` |
| `offices` | created by law: `name`, `title`, `holder`, `members`, `powers`, `budget` |
| `accounts`, `ledger` | public accounts and your own; ledger rows you're party to, plus public grants/fines/lobbying |
| `economy`, `banks`, `ventures` | rate and prices; banks (your deposits/loans only); your ventures |
| `nations`, `treaties`, `offers`, `army` | foreign affairs |
| `papers`, `stories`, `frontpages` | the press |
| `cases`, `crises`, `meters` | court, crises, and the `prosperity`/`stability` meters (0–100) |
| `cards`, `deals`, `demands`, `plots` | the backroom: only what you're allowed to see |
| `gazette[]` | newest first, up to 300. `via` names the app, if one did it. |
| `viewer` | your id |

The full shape lives in [`engine/world.ts`](engine/world.ts); the rules in [`engine/`](engine/).

## 7. Recipes

### Use the official engine for formatting
`engine/` is plain TypeScript with no dependencies. Copy it in and you get the same helpers the
official site uses:

```ts
import { nm, fmtTime, fmtLeft, bal, ca, hosTitle } from './engine/index';
fmtLeft(world, proposal.voteEndsAt); // "3h 20m"
```

You can even dry-run an action locally before sending it: `run(world, me, cmd, args)` throws
the same error the server would (where your view holds enough to tell).

### A Gazette bot (Node 18+)

```js
const KEY = process.env.REALM_KEY, BASE = 'https://democracy-sim-thgx.onrender.com/api/v1';
const get = (p) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + KEY } }).then((r) => r.json());
let last = (await get('/gazette?limit=1'))[0]?.id;
for (;;) {
  const { version } = await get('/state?since=0'); // cheap way to learn the version
  await get(`/state?since=${version}&wait=25`);   // sleeps until something happens
  const fresh = await get('/gazette?since=' + last);
  if (fresh.length) last = fresh[0].id;
  fresh.reverse().forEach((g) => console.log('📰', g.text)); // post to Discord, WhatsApp, …
}
```

### Vote with your party whip (Python)

```python
import requests
B, H = "https://democracy-sim-thgx.onrender.com/api/v1", {"Authorization": "Bearer rlm_…"}
w = requests.get(B + "/state", headers=H).json()["world"]
for p in w["proposals"].values():
    if p["stage"] == "vote" and w["viewer"] not in p["votes"]:
        r = requests.post(B + "/act", headers=H, json={"cmd": "prop.vote", "args": {"prop": p["id"], "vote": "aye"}})
        print(p["title"], r.json().get("error", "voted"))
```

### A whole frontend in one file
[`examples/minimal.html`](examples/minimal.html): open it in a browser, paste a key, and you
have a working (ugly) client in ~80 lines. Start from there.

## 8. Fair play

- Bots play by the same rules as people and are logged with the key's prefix.
- Automating your own play is fine. Flooding, or scraping someone else's key, isn't.
- Found a way to see something you shouldn't? Tell the Returning Officer rather than using it.
- The API is versioned: `/api/v1` won't change in ways that break your app. New fields and
  new actions can appear at any time, so ignore what you don't recognise.
