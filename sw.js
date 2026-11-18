/* Apex Store service worker.
   Relative URLs throughout: the same file works at / and at /apps/store/. */

const VERSION = 'v1';
const CACHE = 'apex-store-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './play.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll fails the whole install if one file fails, so add them one by one
      // and retry once: a flaky host should not leave the shell half-cached.
      const grab = async (url) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
            return;
          } catch (err) {
            if (attempt === 1) console.warn('apex-store: precache miss', url, err && err.message);
          }
        }
      };
      await Promise.all(SHELL.map(grab));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('apex-store-') && n !== CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the Play proxy stays out of the cache
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // Images change rarely and are worth answering from cache instantly.
  // Scripts and styles are network-first, so a deploy is picked up on the next
  // load instead of a load later.
  const isImage = /\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(url.pathname);

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (isImage) {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) {
          fetch(request)
            .then((fresh) => { if (fresh && fresh.ok) cache.put(request, fresh.clone()); })
            .catch(() => {});
          return hit;
        }
      }

      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
        return Response.error();
      }
    })()
  );
});
