// Receives the realm's webhooks, checks they're genuine, and forwards them to your phone through ntfy.
// Deploy anywhere public (Render's free tier works: start command `node webhook-receiver.mjs`), then in the game
// add https://<your-service>/realm as a webhook. Use "My alerts" for private reminders or "Gazette" for news.
// WEBHOOK_SECRET=whsec_… NTFY_TOPIC=pick-something-unguessable node webhook-receiver.mjs
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.WEBHOOK_SECRET;
const TOPIC = process.env.NTFY_TOPIC;
const SITE = process.env.REALM_SITE || 'https://bigdreamerdev.github.io/democracy-sim/';
if (!SECRET || !TOPIC) throw new Error('Set WEBHOOK_SECRET and NTFY_TOPIC.');

const genuine = (raw, header) => {
  const want = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
  return typeof header === 'string' && header.length === want.length && timingSafeEqual(Buffer.from(header), Buffer.from(want));
};
const push = (title, body, link, urgent) =>
  fetch('https://ntfy.sh/' + encodeURIComponent(TOPIC), { method: 'POST', body, headers: { Title: title, ...(link ? { Click: link } : {}), Priority: urgent ? 'high' : 'default' } });

createServer((req, res) => {
  if (req.method !== 'POST') return res.writeHead(200).end('The Realm webhook receiver is running.');
  let raw = '';
  req.on('data', (c) => (raw += c).length > 1e6 && req.destroy());
  req.on('end', async () => {
    if (!genuine(raw, req.headers['x-realm-signature'])) return res.writeHead(401).end('bad signature');
    res.writeHead(204).end(); // answer fast; the realm waits at most 5 seconds
    const e = JSON.parse(raw);
    if (e.event === 'ping') return push(e.realm, 'Webhook connected.');
    if (e.event === 'alert') for (const a of e.alerts) await push(a.label, a.title, a.url, a.urgent);
    if (e.event === 'gazette') for (const g of e.entries) await push(e.realm + ' Gazette', g.text, g.link ? SITE + g.link : undefined);
  });
}).listen(process.env.PORT || 8080, () => console.log('Listening on', process.env.PORT || 8080));
