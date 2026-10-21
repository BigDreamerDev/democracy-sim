// Posts every new Gazette entry to a WhatsApp group, and answers "!realm" with who holds power.
//
//   npm install
//   REALM_KEY=rlm_… WHATSAPP_GROUP="Exact group name" npm start
//
// Scan the QR code with WhatsApp on your phone (Settings → Linked devices). The login is remembered in
// .wwebjs_auth/, so you only scan once. whatsapp-web.js is unofficial and drives WhatsApp Web in a hidden
// browser: run it on a spare number if you can, and keep the message rate low (this bot batches news).
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const API = process.env.REALM_API || 'https://democracy-sim-1.onrender.com/api/v1';
const KEY = process.env.REALM_KEY;
const GROUP = process.env.WHATSAPP_GROUP;
const SITE = process.env.REALM_SITE || 'https://bigdreamerdev.github.io/democracy-sim/';
if (!KEY || !GROUP) throw new Error('Set REALM_KEY and WHATSAPP_GROUP.');

const get = async (path) => {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + KEY } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const name = (w, id) => w.citizens[id]?.name || 'nobody';

const client = new Client({ authStrategy: new LocalAuth(), puppeteer: { args: ['--no-sandbox'] } });
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('message', async (m) => {
  if (m.body.trim().toLowerCase() !== '!realm') return;
  const { world: w } = await get('/state');
  const hos = w.config.hos === 'monarchy' ? w.config.hosTitle : 'President';
  const open = Object.values(w.proposals).filter((p) => p.stage === 'vote');
  await m.reply(
    [`*${w.config.realmName}*`, `${hos}: ${name(w, w.hos.holder)}`, `PM: ${name(w, w.pm)}`, `Speaker: ${name(w, w.speaker)}`, `House: ${w.seats.map((s) => name(w, s)).join(', ') || 'empty'}`,
      open.length ? `\nVoting now:\n${open.map((p) => `• ${p.title}`).join('\n')}` : '', `\n${SITE}`].filter(Boolean).join('\n')
  );
});

client.on('ready', async () => {
  const chat = (await client.getChats()).find((c) => c.isGroup && c.name === GROUP);
  if (!chat) throw new Error(`No group called "${GROUP}". Check the exact name.`);
  console.log('Posting the Gazette to', GROUP);
  let last = (await get('/gazette?limit=1'))[0]?.id;
  let version = 0;
  for (;;) {
    try {
      const s = await get(version ? `/state?since=${version}&wait=25` : '/state');
      version = s.version;
      const fresh = await get('/gazette?limit=100' + (last ? '&since=' + last : ''));
      if (!fresh.length) continue;
      last = fresh[0].id;
      // one message per burst, so a busy evening doesn't spam the group
      await sleep(20_000);
      const more = await get('/gazette?limit=100&since=' + last);
      if (more.length) last = more[0].id;
      const all = [...more, ...fresh].reverse();
      await chat.sendMessage(`📰 *${s.world.config.realmName} Gazette*\n` + all.map((g) => `• ${g.text}${g.via ? ` _(via ${g.via})_` : ''}`).join('\n'));
    } catch (e) {
      console.error(String(e.message || e));
      await sleep(15_000);
    }
  }
});

client.initialize();
