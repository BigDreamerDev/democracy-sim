// Posts every new Gazette entry to a Discord channel.
// REALM_KEY=rlm_… DISCORD_WEBHOOK=https://discord.com/api/webhooks/… node discord-gazette.mjs
const API = process.env.REALM_API || 'https://democracy-sim-thgx.onrender.com/api/v1';
const KEY = process.env.REALM_KEY;
const HOOK = process.env.DISCORD_WEBHOOK;
const SITE = process.env.REALM_SITE || 'https://bigdreamerdev.github.io/democracy-sim/';
if (!KEY || !HOOK) throw new Error('Set REALM_KEY and DISCORD_WEBHOOK.');

const get = async (path) => {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + KEY } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLOURS = { law: 0x1f6f5c, election: 0x2b5ea7, government: 0x1f6f5c, scandal: 0xb3261e, crisis: 0xb3261e };

let last = (await get('/gazette?limit=1'))[0]?.id;
let version = 0;
console.log('Watching the Gazette. Latest entry:', last);
for (;;) {
  try {
    const s = await get(version ? `/state?since=${version}&wait=25` : '/state');
    version = s.version;
    const fresh = await get('/gazette?limit=100' + (last ? '&since=' + last : ''));
    if (!fresh.length) continue;
    last = fresh[0].id;
    for (const g of fresh.reverse()) {
      await fetch(HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: s.world.config.realmName + ' Gazette',
          embeds: [{ description: g.text + (g.via ? ` *(via ${g.via})*` : ''), url: g.link ? SITE + g.link : undefined, color: COLOURS[g.kind] || 0x555555, timestamp: new Date(g.at).toISOString() }]
        })
      });
      await sleep(1100); // Discord allows about one message a second per webhook
    }
  } catch (e) {
    console.error(String(e.message || e));
    await sleep(15_000);
  }
}
