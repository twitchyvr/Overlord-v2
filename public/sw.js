/**
 * Overlord v2 — Service Worker
 * Cache-first for static assets, network-first for API/socket.
 */
const CACHE_NAME = 'overlord-v2-cache-v2';
const STATIC_ASSETS = [
  '/', '/index.html', '/manifest.json', '/favicon.svg',
  '/ui/css/tokens.css', '/ui/css/base.css', '/ui/css/components.css',
  '/ui/css/building.css', '/ui/css/chat.css', '/ui/css/views.css',
  '/ui/css/fullpage-views.css', '/ui/css/responsive.css', '/ui/boot.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/socket.io')) return;
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((r) => {
        const c = r.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, c));
        return r;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (url.pathname.startsWith('/ui/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.json') {
    // Stale-while-revalidate: serve cached version immediately, update cache in background
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((r) => {
            cache.put(event.request, r.clone());
            return r;
          });
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
