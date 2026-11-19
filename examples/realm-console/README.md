# Realm Console (local)

The same console as the site's (`docs/console.html`, open it at `<site>/console.html`), run from your own PC.
Make an **act** key under **You → Build your own app**, then:

- **Windows:** double-click `start.bat`.
- **Anywhere else:** `node server.js` (Node 18+, no installs).

It opens `http://localhost:5050/`. The little server binds to `127.0.0.1` only and forwards `/proxy/*` to the API,
so your key never leaves your machine except to the realm itself. You can also open `console.html` straight from
disk; it then talks to the API directly.

Keep `console.html` here identical to `docs/console.html`: copy it across whenever the site's console changes.

## What it covers

Home (what needs you, the war, your life abroad), the House, parties and people, money, **the Exchange** (prices,
buy and sell, shareholder votes, citizens' companies, floating your own, the Register of Interests, the wealth fund),
**World & war** (the front, strategy, enlisting, war bonds, terms of peace, memorials, nations, embassies and
embargoes, provinces and garrisons, wars abroad, hostages, defectors, a government in exile, the Security Service,
and, if you have defected, your whole court abroad up to the throne), the Crown, a bill writer with every clause
(including the wealth fund, pensions and land-for-peace), every other action under **Do anything**, and the Gazette.
