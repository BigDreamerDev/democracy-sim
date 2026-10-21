# Security

What could go wrong in the Realm, what stops it, and what's left. Written for the Returning Officer and
anyone (or any agent) changing the code. Last reviewed October 2026.

## What we're protecting, and from whom

| Asset | Why it matters |
|-|-|
| One person, one vote | The whole game is meaningless if someone can vote twice or as someone else. |
| Secrets | Ballots, wallets, cards, deals, plots, ambitions. Leaking them ruins the intrigue. |
| Accounts | A stolen account is a stolen vote and a stolen seat. |
| The world | Nobody but the rules should be able to change it. |

**Attackers we expect:** players who read the (public) source and poke at the API, friends who know each
other's habits and guess passwords, someone who borrows a phone. **Not in scope:** a well-funded attacker,
Render, Neon or GitHub themselves.

## Findings and fixes

Rated by impact for *this* game. ✓ = fixed in this review.

### Authentication

| # | Finding | Risk | Fix |
|-|-|-|-|
| A1 ✓ | Login was rate-limited per IP only. Friends on the same Wi-Fi share one IP, and a botnet has many. | High | Per-account lockout: 5 wrong passwords lock the account 15 minutes, doubling each time (max 24 h), plus the per-IP limit. Successful sign-ins reset it. (`server/security.ts`) |
| A2 ✓ | Minimum password was 8 characters with no other checks. | High | New passwords: 10–72 bytes, not a common password, not containing your username. Old passwords keep working until changed. |
| A3 ✓ | A wrong username answered faster than a wrong password, revealing which usernames exist. | Low | Unknown usernames are checked against a dummy hash, so both take the same time. |
| A4 ✓ | bcrypt cost 10 (v1). | Low | Cost 12 for new hashes; old hashes are upgraded silently at the next successful sign-in. |
| A5 ✓ | bcrypt ignores everything after 72 bytes, silently. | Low | Passwords over 72 bytes are refused instead. |
| A6 ✓ | `jwt.verify` accepted any algorithm the library supports. | Medium | Pinned to HS256. |
| A7 ✓ | Sessions lasted 60 days with no way to end them except changing your password. | Medium | 30 days, refreshed after a week of use (`X-Realm-Token`), plus **Sign out everywhere else** on the passport. |
| A8 ✓ | A weak `JWT_SECRET` would let anyone forge a session. | Critical | The server refuses to start in production with a secret under 24 characters. |
| A9 ✓ | API keys were silently ignored (rather than refused) on first-party routes. | Low | Refused with a clear message, so no app can be built around the wrong token. |

### Signing in with Discord, Google, Microsoft and Apple

| # | Design choice | Why |
|-|-|-|
| O1 | Authorization-code flow with **PKCE** (S256) for Discord, Google and Microsoft; Apple uses a short-lived signed client secret. | Stops a stolen authorization code being used by anyone else. |
| O2 | A random `state` per attempt, stored server-side, single-use, 10 minutes. | Stops cross-site request forgery on the callback. |
| O3 | An OIDC `nonce` per attempt, checked in the id_token, along with issuer, audience and expiry. | Stops replayed or mis-addressed identity tokens. |
| O4 | **Browser binding**: the site keeps a random value in `sessionStorage`; only that browser can swap the finished sign-in for a session. | Stops "login CSRF" (being silently signed in as an attacker) and makes a leaked callback URL useless. |
| O5 | The session token is never put in a URL. The callback redirects with a flow id; the site exchanges it over `POST`. | Tokens in URLs end up in history and logs. |
| O6 | **No linking by email.** A provider account only signs you in once you've linked it, while signed in with your password. | Otherwise anyone who controls an email address (or a provider that doesn't verify emails) could take over an account. |
| O7 | New accounts via a provider follow the same rules as sign-ups: only when sign-ups are open, and approval if it's required. | One person, one vote: the RO still vets everyone. |
| O8 | You can't unlink your last way to sign in. | Avoids locking yourself out. |
| O9 | Return addresses are limited to `ALLOWED_ORIGINS`. | No open redirect. |

### Passkeys

| # | Design choice | Why |
|-|-|-|
| P1 | WebAuthn via `@simplewebauthn/server` (`server/passkeys.ts`). The relying party is the site's own origin (`bigdreamerdev.github.io`), taken from the request's `Origin` and only if it's in `ALLOWED_ORIGINS`; the browser's signed `clientDataJSON` must name the same origin. | A passkey can't be used on a look-alike site, so it can't be phished. |
| P2 | User verification required (face, fingerprint or device PIN) when adding and when signing in. | A passkey is two factors in one: the device and you. |
| P3 | Challenges are random, single-use, bound to the origin (and, when adding, to the account), and expire after 5 minutes. They live in server memory. | Stops replay. A Render restart mid-ceremony just means "try again". |
| P4 | Only public keys are stored (`v2_passkeys`). The signature counter must go up, and the user handle, when sent, must match the account. | A database leak gives nothing usable; a cloned authenticator is caught where the device counts. |
| P5 | Passkeys are only added while signed in; there's no "sign up with a passkey". | Same as O6/O7: the RO still vets every citizen, and nobody can attach a key to someone else's account. |
| P6 | You can't remove your last way to sign in; unlinking a provider counts passkeys too. Max 10 per account. | Avoids locking yourself out. |

### The API and the site

| # | Finding | Risk | Fix |
|-|-|-|-|
| S1 ✓ | No security headers on API responses. | Medium | `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `no-referrer`, HSTS and `Cache-Control: no-store` (personal data must never sit in a shared cache). |
| S2 ✓ | No Content Security Policy on the site. Any injected script could read the session token. | Medium | A strict CSP in a meta tag (GitHub Pages can't send headers): scripts only from the site itself, no plugins, no foreign forms. |
| S3 ✓ | No per-account request limit on first-party routes. One script could hammer the server. | Medium | 120 requests a minute per account; 120 a minute per API key on `/api/v1`. |
| S4 ✓ | Sign-ins weren't logged. | Low | Sign-ins, failures, lockouts, links and password changes go to `v2_log` (no passwords, ever). |
| S5 | Session token in `localStorage`. | Medium | Accepted: the site has no third-party scripts, Preact escapes all player text, and the CSP blocks injected scripts. Cookies would need the API and site on one domain, which free hosting can't do. |
| S6 | Player text (speeches, names, stories) everywhere. | — | Preact escapes it. No `dangerouslySetInnerHTML` anywhere; keep it that way. Player-supplied links (app homepages) must be http(s), checked server-side. |
| S7 | Webhooks call addresses players choose. | — | https only, private and internal addresses refused, no redirects followed, 5-second timeout. |
| S8 | API keys. | — | 192 bits of randomness, stored as SHA-256, shown once, revocable, scoped read/act, never valid for admin actions. |
| S9 | Secrets in the world. | — | `viewFor` strips every secret before anything is sent; the server never sends the full world (except the announced RO export). |
| S10 | Every rule lives in the engine on the server; one queue means two requests can't race. | — | Double voting is impossible: ballots are keyed by the id in your session. |
| S11 ✓ | The Streets put the game into real life. | High | Opt-in with explicit agreement; anyone can leave at once (contracts refunded). Safe zones, a tag is a tap or hand-over only, the RO can add safe zones and take down bounties (announced). No locations are ever collected or stored. Crowns can't be bought or cashed out. |
| S12 ✓ | Tag and meet codes prove a real-life encounter. | Medium | Random 6-character codes from the seeded server rng, stripped from everyone else's view in `viewFor`, rotated after every use. A code only completes a contract its holder already has. |
| S14 ✓ | Players upload photos (stories, bounty proof). | High | The site shrinks each to a small JPEG; the server accepts only JPEG, strips every metadata block (EXIF, GPS, XMP, comments) before storing, caps size (140 KB) and count (25 a player), and only lets you attach your own photo to an action. Ids are 120 random bits. The RO can take any photo down (announced). Served with `sandbox` CSP and `nosniff`. The site's CSP now allows images from any https origin. |
| S17 ✓ | One person, several accounts. | High | Approval stays on by default and every application says who the person is in the group chat. Single-use invitation links (7 days, stored hashed, claimed atomically) let the RO keep sign-ups shut. A duplicate found later is struck out: its crowns go to the real account, its open votes are deleted, it loses every post, and its login and API keys are switched off. All announced. |
| S16 ✓ | Bootstrapping a new database needs an admin. | Medium | `ADMIN_USERNAME`/`ADMIN_PASSWORD` create one only when no admin exists, through the same password rules and bcrypt cost; the boot log says to remove the password from the environment. |
| S15 ✓ | Insider trading and the Hunt ring are secrets. | Medium | Insider-trading cards go only to the Security Service and one other player; the Hunt ring is stripped to your own target in `viewFor`. |
| S13 ✓ | Contracts, bets and orders are private by the rules. | Medium | `viewFor` sends a contract only to whoever took it out (and to its target once it's claimed), bets only to the bettor (pools are public), orders only to buyer and seller, the bodyguard's charge only to the two of them. |

### The Returning Officer

The RO can reset any password (and so sign in as anyone), take a full export, and reset the realm. That
can't be avoided, since somebody has to run the game, so every one of those actions is **announced in the Gazette and
kept in the public log**. A password reset also clears any lockout.

## What's left (known, accepted)

- **Someone with your phone, or your WhatsApp, is you.** Lock your phone.
- **Shared Wi-Fi shares an IP**, so the per-IP limits can bite a whole household; the per-account lockout
  is what really protects you.
- **Render's free tier** restarts often; rate-limit counters live in memory and reset with it. Lockouts
  are in the database and survive.
- **No two-factor login on passwords.** Add a passkey (it needs your device *and* your face, fingerprint or
  PIN) and sign in with that instead, or link a provider that has 2FA. A password, while set, still works alone.
- **Apple needs a paid Apple Developer account** (about $99 a year). The other three are free. Apple's
  button only appears once it's configured.

## Setting up the sign-in providers

Each provider needs an app registered with them, and two settings in Render. The **redirect URI** for each is
`https://<your-render-url>/api/oauth/<provider>/callback`, e.g.
`https://democracy-sim-thgx.onrender.com/api/oauth/google/callback`. Set `PUBLIC_URL` in Render to your
Render address so the server builds those URIs correctly.

| Provider | Where | Render settings |
|-|-|-|
| Discord | discord.com/developers → New Application → OAuth2. Add the redirect. Scopes: `identify email`. | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` |
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web). Add the redirect. Consent screen: External, scopes `openid email profile`. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Microsoft | entra.microsoft.com → App registrations → New. Account types: *any organisation and personal Microsoft accounts*. Platform: Web, add the redirect. Certificates & secrets → new client secret. | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| Apple | developer.apple.com (paid) → Identifiers → a Services ID with Sign in with Apple, domain = your Render host, return URL = the redirect. Keys → a key with Sign in with Apple. | `APPLE_CLIENT_ID` (the Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the .p8 contents; `\n` for newlines is fine) |

Leave a provider's settings empty and its button simply doesn't show.

## Reporting a problem

Found a way to see or do something you shouldn't? Tell the Returning Officer privately rather than using
it. It'll be fixed and you'll get the credit in the Gazette.
