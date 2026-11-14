// Always the latest site. Pages, config.js and anything unhashed go to the network every time, skipping the browser's
// HTTP cache (Pages tells it to keep files 10 minutes, which is what made old builds stick). Built files in assets/ have
// a hash in their name, so a cached copy can never be stale: those come from the cache first. A copy of everything is
// kept so the site still opens with no signal. The API is on another origin and always goes to the network.
const CACHE = 'realm-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// keep only the built files the newest page uses, so old builds don't pile up
async function prune(html) {
  const used = new Set([...html.matchAll(/assets\/[^"'\s)]+/g)].map((m) => new URL(m[0], self.registration.scope).href));
  if (!used.size) return;
  const c = await caches.open(CACHE);
  for (const req of await c.keys()) if (req.url.includes('/assets/') && !used.has(req.url)) await c.delete(req);
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  const url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== location.origin) return;
  const hashed = url.pathname.includes('/assets/');
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (hashed) {
      const hit = await c.match(r);
      if (hit) return hit;
    }
    try {
      const res = await fetch(r, { cache: hashed ? 'default' : 'no-store' });
      if (res.ok && res.type === 'basic') {
        const key = r.mode === 'navigate' || url.pathname.endsWith('/index.html') ? new URL('./', self.registration.scope).href : r;
        await c.put(key, res.clone());
        if (key !== r) e.waitUntil(res.clone().text().then(prune).catch(() => {}));
      }
      return res;
    } catch {
      const hit = await c.match(r, { ignoreSearch: true });
      if (hit) return hit;
      if (r.mode === 'navigate') return (await c.match(new URL('./', self.registration.scope).href)) || Response.error();
      return Response.error();
    }
  })());
});
