/* Service worker.

   Network first, cache second — deliberately. A cache-first worker would serve
   a stale app.js against a newer server, which is the single most confusing
   failure this project can produce (GitHub Pages already caches hard enough).
   The cache exists so the shell opens instantly and says something sensible
   when there is no signal, not to avoid the network. */

const VERSION = 'republic-v6';
const SHELL = ['./', './index.html', './styles.css', './app.js', './acts.js', './money.js', './world-map.js', './config.js',
               './icons/icon-192.png', './manifest.webmanifest'];

/* Cached one at a time, and a failure is allowed. `addAll` rejects the whole
   install if any single request fails, which meant one flaky fetch left the
   worker permanently uninstalled and the offline shell silently gone — and it
   retried on every load. The subdivision geometry is deliberately not in here:
   it is fetched per territory when the map is opened, and precaching megabytes
   the session may never look at was most of what made the map feel broken. */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never cache the API. A stale division count is worse than no division count.
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
