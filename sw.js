const CACHE = 'pointages-gcc-v1.16.0-republication-1';
const ASSETS = [
  './', './index.html', './css/styles.css', './js/seed-data.js', './js/excel-export.js', './js/app.js',
  './vendor/exceljs.min.js', './manifest.webmanifest', './assets/logo-pointages-app.png', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png', './assets/favicon-32.png'
];
const ALWAYS_REFRESH = new Set([
  './', './index.html', './css/styles.css', './js/app.js', './js/seed-data.js', './js/excel-export.js'
].map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (ALWAYS_REFRESH.has(url.pathname)) {
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await cache.match(event.request, { ignoreSearch: true })) ||
          (await cache.match('./index.html'));
      }
    }
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await cache.match(event.request, { ignoreSearch: true })) ||
        (await cache.match('./index.html'));
    }
  })());
});
