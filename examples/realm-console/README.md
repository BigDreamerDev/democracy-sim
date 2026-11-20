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
and, if you have defected, your whole court abroad up to the throne), **the Empire** (the Imperial Oath, to swear or refuse, and who has; the Imperial Privy Council with every great officer's prerogative: appoint, summon, seal, force through, veto, and a vote for each place held; the High Commission's provinces, levies, governors and protectorates; a governor's own decrees; the war chest, its shares, company acquisitions and director's orders; military acquisitions and forts), **life abroad in full** (the court's daily business, your home and citizenship, word from home and amnesties, a plant's real orders and the court's offer to turn you, the exile press, wanted posters, stirring up the provinces, the invasion of the homeland, and a royal child's claim to an empty throne), **the realm against its defectors** (extradition, smears, snatch squads, seizure, amnesty, and the Security Service sending someone over), **trials** (judge or defend), the Crown (proclamations, the peerage, royal progresses, triumphs, lèse-majesté and the Tower, royal weddings, estates and palaces, hunts and balls, tenants under arms, the Durbar and its coronation record), banners on Home for whatever is live (a proclamation, a triumph, a revolt, the Durbar, an invitation, an invasion), a bill writer with every clause and every limit Parliament can change
(including the wealth fund, pensions and land-for-peace), every other action under **Do anything**, and the Gazette (with a **Moments** filter for the events the site plays as ceremonies). Under the Imperial Prerogative Act the console takes the empire's porphyry and gold.
