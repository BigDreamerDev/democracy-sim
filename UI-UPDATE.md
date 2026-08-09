# UI update — deployable now

Front end only. Nothing here needs the Court, the economy or diplomacy, so it can
go out ahead of them.

## Files to push

| File | |
|---|---|
| `docs/app.js` | the desk, in-flight buttons, skeleton loading |
| `docs/styles.css` | desk, spinner, skeletons, phone navigation |
| `docs/index.html` | the office badge in the top bar |
| `docs/acts.js` | only if you already have it — see below |

No server change. No database change. No redeploy of Render.

## What is different

**The President has a job again.** Every officer now lands on a **desk** at the
top of the Chamber: what is waiting on them, with the buttons to do it there.

- **President** — bills that have passed the House, with *Assent* and *Veto*
  inline. This was the actual complaint: the highest office in the Republic had
  a screen identical to everyone else's.
- **Speaker** — bills that have their seconders and need tabling, tabled bills
  needing a division, and open divisions to close. Nothing closes itself, so the
  Speaker is now told rather than expected to remember.
- **MPs** — open divisions they have not voted in, with *Aye / No / Abstain*
  from the front page, and the running count so far.
- **Everyone** — a poll they have not voted in, and initiatives needing names.

Nothing waiting produces a sentence saying so and what will appear there later,
rather than an empty box.

The office you hold is now printed in the top bar. It used to be inferable only
from which buttons happened to appear.

## Responsiveness

**Every action button disables while its request is in flight** and shows a
spinner. On a sleeping free instance a tap could previously do nothing visible
for thirty seconds, and the reward for tapping again was *"you have already voted
in this division"*.

**Acting from the desk redraws only the desk**, not the page — so assent, a vote
or a division lands in one request instead of a full reload.

**Loading shows a skeleton** rather than the word *Loading…*.

**Navigation moves to the bottom on phones** (≤700px), where a thumb can reach
it, with larger tap targets on buttons and ballot radios. This is a WhatsApp
group; most people will only ever see it on a phone.

## If you have not deployed the Acts

`docs/acts.js` now probes the server before registering anything: it adds the
Court, Economy and Diplomacy tabs only when those endpoints answer. A core-only
Republic shows core-only navigation, and the same build of the site works either
way. Verified against an instance with the Act modules removed — all three
return 404 and no tab appears.

If you have not got `acts.js` at all, you do not need it.

## Checking it

`npm run test:layout` covers the front end, including `test/desk.js`, which
renders the desk as President, Speaker, MP and an ordinary citizen and asserts
each sees their own business and no one else's — that the President is never
offered *Table it*, that a citizen is never offered *Assent*.

`npm run dev` seeds a bill awaiting assent and one awaiting tabling, so the
President's and Speaker's desks both have something on them the moment you sign
in as `farid` or `ana`.
