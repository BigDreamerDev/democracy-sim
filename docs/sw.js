/* Service worker.

   Network first, cache second — deliberately. A cache-first worker would serve
   a stale app.js against a newer server, which is the single most confusing
   failure this project can produce (GitHub Pages already caches hard enough).
   The cache exists so the shell opens instantly and says something sensible
   when there is no signal, not to avoid the network. */

const VERSION = 'republic-v5';
const SHELL = ['./', './index.html', './styles.css', './app.js', './acts.js', './money.js', './world-map.js', './world-subdivisions.js', './config.js',
               './icons/icon-192.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
