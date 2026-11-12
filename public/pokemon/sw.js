// Eenvoudige service worker: altijd eerst het netwerk, en bij geen verbinding de laatst bewaarde versie.
const CACHE = 'pokedex-go-v1';
const LIVE_HOST = 'raw.githubusercontent.com';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const liveJson = url.hostname === LIVE_HOST && url.pathname.endsWith('.json');
  if (!own && !liveJson) return; // afbeeldingen van andere sites laten we aan de browser over
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: own });
      if (hit) return hit;
      throw err;
    }
  })());
});
