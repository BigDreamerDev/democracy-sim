# Building against the Republic

This is for someone writing a *separate* app — a stock ticker, a newspaper
aggregating the public record, a casino that lets citizens wager Republic
money, anything else — against this server. It assumes nothing about you
having read the rest of this codebase.

Base URL is whatever the Republic you're pointed at deploys — same host as
its front end, e.g. `https://democracy-sim-thgx.onrender.com`. Every path
below is relative to that.

## Two ways to authenticate

**No auth at all**, for reading. Everything under `/api/public/v1/` is
unauthenticated, CORS-open to any origin, and safe to poll from a browser
directly — no server-side proxy needed.

**An API key**, for anything a citizen has to delegate to you: reading their
own account, or moving their money. A citizen creates a key for you from their
account page (the "Developer / integrations" panel), and gives you the raw
value — it looks like `rk_<48 hex characters>` and is shown to them exactly
once. Send it the same way a login token goes:

```
Authorization: Bearer rk_...
```

A key is *not* a login. It authenticates as the citizen who created it, but
only for what it was scoped to do:

- Every key can read — anything a signed-in citizen could `GET`.
- A key can only make changes (any non-`GET` request) if the route it's
  hitting explicitly accepts a scope the key has. Today there is exactly one
  such scope: **`economy:pay`**, which unlocks `POST /api/economy/transfer`.
  A key without it gets a `403` on that route and on every other write route
  in the app — there is no such thing as a key that can vote, propose a bill,
  or act in an office. That's not implemented yet; it's not going to be. Those
  are a citizen's own acts, not something an app carries out for them.
- A key can carry an optional spending cap ("up to 500 per 24h"). Go over it
  and `economy:pay` requests get refused with a `400` until the window rolls
  over, regardless of what the citizen's own balance could otherwise cover.
- A citizen revokes a key from the same panel at any moment; revocation is
  immediate, not on next token refresh.
- Every payment a key makes is recorded in the Republic's public audit log
  distinctly from a citizen paying directly — the note says which app did it,
  by label. There is no private delegation here; that's the whole trust model.

A full login session (the JWT a citizen's browser holds) is not limited by any
of this — it's a citizen acting directly, not through a key, so scope
restrictions don't apply to it. Only `rk_...` bearer tokens are keys.

## `GET /api/public/v1/*`

A stable, curated mirror of state that is already public elsewhere in this
API — organised, versioned, and CORS-open for people who aren't the official
front end. It never carries a real-world place name or ISO country code: the
Republic's world map is invented geography wearing a real coastline, and that
holds everywhere this data goes, not just in the browser.

| Route | Mirrors | Notes |
|---|---|---|
| `/economy` | `/api/economy` | Treasury, money supply, dividend, tax rate, businesses |
| `/bills` | `/api/bills` | Bill status digest. Supports `?status=` |
| `/elections` | `/api/elections` | Election status digest |
| `/map` | `/api/diplomacy/map` | Opaque territory ids only. `503` if diplomacy isn't enabled |
| `/powers` | `/api/diplomacy/powers` | `503` if diplomacy isn't enabled |
| `/treaties` | `/api/diplomacy/treaties` | `503` if diplomacy isn't enabled |
| `/conflicts` | `/api/diplomacy/conflicts` | `503` if diplomacy isn't enabled |
| `/war` | `/api/war` | Stockpile, formations, readiness. `503` if the war module isn't enabled |
| `/war/conflicts` | `/api/war/conflicts` | Pressure and stage per conflict. `503` if not enabled |

Every response carries `Cache-Control: public, max-age=5` and an `ETag` — send
`If-None-Match` back and get a `304` with no body if nothing changed, so a
poller costs the server almost nothing.

## Rate limits

`/api/public/v1/*` reads: 300 requests/minute per IP — generous, because
that's the whole point of this surface. Anything that writes (a scoped key
hitting `economy:pay`) goes through the same throttles a citizen's own writes
do — tens of requests per few minutes, not hundreds. A `429` means slow down,
not that you're blocked.

## Live events: `GET /api/public/v1/events`

A Server-Sent Events stream. Connect and keep the connection open; don't
poll it.

```
Content-Type: text/event-stream

: connected

event: bill.close
data: {"action":"bill.close","detail":"B014 closed 4-1-0","at":"2026-08-15T10:04:11.203Z"}

: keep-alive

event: war.escalate
data: {"action":"war.escalate","detail":"Meridian Compact: grievance → blockade","at":"2026-08-15T10:05:02.771Z"}
```

A `: keep-alive` comment line arrives roughly every 20 seconds so a proxy
sitting between you and the server doesn't decide the connection is dead and
close it. Lines starting with `:` aren't events — ignore them the way the SSE
spec says to.

Only a curated subset of the Republic's public audit log is broadcast here —
a bill reaching a public outcome, an election being certified, a listing or
dividend changing hands, a war stage moving, a diplomatic dispatch going out.
Routine administrative actions (an account approved, a password changed, a
config value nudged) are not broadcast; read `/api/state` if you need those.

There is no reconnect logic on the server side and no missed-event replay.
A server restart drops every open connection — reconnect and carry on; you
will not have lost anything you couldn't also have re-read from the `GET`
routes above. Concurrent connections are capped; over the cap you get a `503`
instead of a connection that never receives anything.

## Three worked examples

**Read something, no auth:**

```sh
curl https://democracy-sim-thgx.onrender.com/api/public/v1/economy
```

**Create a read-only key, then use it** (you'd normally do the first half
from the account page in the browser, not curl — this is what it does under
the hood):

```sh
# as the citizen, signed in with their own JWT session
curl -X POST https://democracy-sim-thgx.onrender.com/api/me/keys \
  -H "Authorization: Bearer <citizen's own JWT>" \
  -H "Content-Type: application/json" \
  -d '{"label":"my newspaper bot"}'
# => { "key": "rk_...", "id": 7, "label": "my newspaper bot", "scopes": [], ... }
# "key" is shown exactly once. Save it now.

# as the app, from then on
curl https://democracy-sim-thgx.onrender.com/api/economy/me \
  -H "Authorization: Bearer rk_..."
```

**A scoped `economy:pay` write, with a cap:**

```sh
# citizen grants the scope and a cap of 500 every 24 hours
curl -X POST https://democracy-sim-thgx.onrender.com/api/me/keys \
  -H "Authorization: Bearer <citizen's own JWT>" \
  -H "Content-Type: application/json" \
  -d '{"label":"the casino","scopes":["economy:pay"],"cap_amount":500,"cap_window_ms":86400000}'

# the casino app settles a bet
curl -X POST https://democracy-sim-thgx.onrender.com/api/economy/transfer \
  -H "Authorization: Bearer rk_..." \
  -H "Content-Type: application/json" \
  -d '{"user_id":42,"amount":50,"note":"blackjack payout"}'
# a 7th request that would push the trailing 24h total over 500 gets a 400,
# even though the citizen's own balance could easily cover it
```
