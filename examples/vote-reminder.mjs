// Pings your phone through ntfy (https://ntfy.sh, free, no account) when something needs you:
// a vote to cast, a bill to sign, a deal waiting. Then once more when it's about to close.
// REALM_KEY=rlm_… NTFY_TOPIC=pick-something-unguessable node vote-reminder.mjs
const API = process.env.REALM_API || 'https://democracy-sim-thgx.onrender.com/api/v1';
const KEY = process.env.REALM_KEY;
const TOPIC = process.env.NTFY_TOPIC;
const SITE = process.env.REALM_SITE || 'https://bigdreamerdev.github.io/democracy-sim/';
const SOON = Number(process.env.REMIND_HOURS || 2) * 3600_000;
if (!KEY || !TOPIC) throw new Error('Set REALM_KEY and NTFY_TOPIC.');

const get = async (path) => {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + KEY } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
};
const push = (title, body, link, urgent) =>
  fetch('https://ntfy.sh/' + encodeURIComponent(TOPIC), {
    method: 'POST',
    body,
    headers: { Title: title, Click: link, Priority: urgent ? 'high' : 'default', Tags: urgent ? 'rotating_light' : 'ballot_box_with_ballot' }
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const told = new Set(); // "new:<key>" and "soon:<key>"
let first = true;
console.log(`Reminding ntfy topic "${TOPIC}". Leave this running.`);
for (;;) {
  try {
    const alerts = await get('/alerts');
    for (const a of alerts) {
      // on the first run, don't announce what was already waiting, unless it closes soon
      if (!told.has('new:' + a.key)) {
        told.add('new:' + a.key);
        if (!first) await push(a.label, a.title, SITE + a.href, a.urgent);
      }
      if (a.at && a.at - Date.now() < SOON && a.at > Date.now() && !told.has('soon:' + a.key)) {
        told.add('soon:' + a.key);
        const mins = Math.round((a.at - Date.now()) / 60_000);
        await push(`Closes in ${mins >= 60 ? Math.round(mins / 60) + 'h' : mins + 'm'}: ${a.label}`, a.title, SITE + a.href, true);
      }
    }
    first = false;
  } catch (e) {
    console.error(String(e.message || e));
  }
  await sleep(5 * 60_000);
}
