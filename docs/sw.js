// Network first, with the last copy kept for when there's no signal: the site opens offline and shows the realm as it
// was last seen. Only this site's own files are cached; the API is on another origin and always goes to the network.
const CACHE = 'realm-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(r);
      if (res.ok) (await caches.open(CACHE)).put(r, res.clone());
      return res;
    } catch {
      const hit = await caches.match(r, { ignoreSearch: true });
      if (hit) return hit;
      if (r.mode === 'navigate') return (await caches.match('./')) || (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
