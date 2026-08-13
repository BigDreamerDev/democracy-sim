# On your phone — install, widgets, dark mode

## Add it to the home screen

It is now an installable web app. Once it is on the home screen it opens without
browser chrome and looks like any other app.

**iOS (Safari only — Chrome on iOS cannot do this):** open the site → Share →
**Add to Home Screen**.

**Android (Chrome):** open the site → ⋮ → **Install app**, or take the "Add to
home screen" prompt when it appears.

Tell people to do this. A tab among forty tabs is a tab nobody opens; an icon on
the home screen is a country they remember they live in.

The icon is your flag — three bands and a ring of gold stars, reduced to eight
stars because nineteen turns to mush at 48 pixels.

## Widgets — read this before promising anything

**A web app cannot put a real widget on a home screen.** On iOS a widget must be
built with WidgetKit inside a native app shipped through the App Store; on
Android it needs an `AppWidgetProvider` inside an installed APK. There is no web
API for either, on any browser, and anyone who tells you otherwise is thinking of
the Windows widgets board.

What every widget system *can* do is show an image from a URL and refresh it on a
timer. So the widget is an image:

```
https://your-service.onrender.com/api/widget.svg
https://your-service.onrender.com/api/widget.svg?theme=dark
```

It shows the name of the Republic, a headline (POLL OPEN, 3 BEFORE THE HOUSE,
THE HOUSE IS QUIET), the live election if there is one, the President and Speaker,
and a line of counts. It carries your flag's colours across the top. No login, no
personal data — nothing a passer-by could not read off the front page.

### iOS — Scriptable (free), and this is the good one

Scriptable draws its own text, so nothing is scaled and nothing is blurry. It
reads `/api/widget.json` and lays the widget out natively at the phone's own
density, picking up dark mode without being told.

1. Install **Scriptable** from the App Store
2. New script → paste `republic-widget.js` → name it **Republic**
3. Change `BASE` (your Render URL) and `SITE` (your Pages URL) at the top
4. Long-press the home screen → **+** → Scriptable → choose the script

Small and medium widgets both work: small shows the President, medium shows the
President and the Speaker. It refreshes every 30 minutes, or every 10 when a poll
is open or a declaration is in force. Tapping it opens the site.

If the server is asleep the widget says so rather than going blank, and fixes
itself on the next refresh.

### iOS — no extra app

Shortcuts cannot draw a home screen widget from a URL, but it can put the daily
state in a notification. Automation → time of day → Get Contents of
`/api/digest` → Show Notification. Less pretty, no install, and arguably better:
it comes to you.

### Android

Any image-widget app works — **KWGT**, **Widgetsmith**-style apps, or any
launcher widget that takes a web image. Point it at:

```
https://your-service.onrender.com/api/widget.png
https://your-service.onrender.com/api/widget.png?theme=dark
```

That renders at 1080×510 — three device pixels per point — because a 1x image on
a phone is visibly soft. `/api/widget.svg` is still there for anything that
prefers vectors.

**The PNG needs `sharp`**, which is a large native dependency. It is required
lazily inside the endpoint, so if it is missing or fails to build you get a 503
on the widget rather than a Republic that will not boot.

### Why the image has an inset border

iOS masks a widget with its own corner radius, and Android launchers do the same.
Anything within about 24pt of a corner is simply cut away — which is why a
full-bleed flag strip lost both its ends.

So the image keeps everything inside a safe inset, and the flag is drawn as a
rounded bar rather than an edge-to-edge stripe. The background still goes edge to
edge, because the host is doing the rounding. If your widget host does **not**
clip, add `?radius=18` and the image rounds itself.

Verified by rendering the widget and masking it at 24pt: nothing of the content
is lost.

### The honest recommendation

The **home screen icon plus a badge** is worth more than any widget. Most people
check a thing because it is one tap away, not because a rectangle told them to.
Install first, widget only if someone actually asks.

## Dark mode

The button in the top bar cycles **light → dark → follow the phone**. It is
remembered, and applied before the first paint so an install opening in dark
never flashes white.

There is no dark stylesheet. The palette is derived at runtime from whatever the
Flag Act says, and dark is a branch of that derivation: **the flag keeps its hue
and loses its brightness.** The paper becomes a very dark tint of the flag's own
lightest colour rather than plain black, and every accent is re-checked for
contrast against the dark card.

For McServerLandia that means the gold `#F2A800` stays gold in dark mode — it
needs no adjustment against a dark background — while in light mode it is
darkened to `#916500` so links remain readable. The flag survives the inversion
in both directions.

Checked against four flags including deliberately awful ones (all black, pale
yellow) in both themes: body text clears 7:1 everywhere, links clear 4.5:1,
buttons clear 3:1.

## Offline

A service worker caches the shell, so the app opens instantly and shows something
sensible with no signal. It is **network-first on purpose**: a cache-first worker
would serve a stale `app.js` against a newer server, which is the most confusing
failure this project can produce. API responses are never cached — a stale
division count is worse than none.

## Files this added

| | |
|---|---|
| `docs/manifest.webmanifest` | makes it installable |
| `docs/sw.js` | offline shell |
| `docs/icons/` | six sizes, generated from the flag |
| `docs/index.html` | manifest, icons, theme bootstrap, worker registration |
| `docs/app.js` · `docs/styles.css` | dark mode |
| `server/server.js` | `GET /api/widget.svg` |

Everything except the widget endpoint is front end only. The widget needs one
Render redeploy.
