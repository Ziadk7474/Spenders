// Cheque Viewer — app-shell cache so the app opens instantly and works
// offline after the first successful load. Firebase requests always go
// straight to the network (never intercepted/cached here) — the cheque
// list itself is cached separately inside index.html via localStorage,
// so it's never served stale from this worker.
const CACHE = 'chq-viewer-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];

// Cache each file on its own instead of cache.addAll(). addAll is all-or-
// nothing: one missing file (a 404 on an icon, say) rejects the whole
// install and the worker never activates, so the app silently loses its
// offline mode. Caching one at a time means a missing extra is just a
// missing extra.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(url =>
        c.add(new Request(url, { cache: 'reload' }))
         .catch(err => console.warn('[sw] skipped', url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only intercept same-origin GET requests for this app's own files.
  // Firebase reads, Google Fonts, etc. are left alone and go to network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request).then(res => {
      // Don't cache error/opaque responses — otherwise a one-off 404 or a
      // captive-portal redirect gets frozen into the shell forever.
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached =>
        cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
      )
    )
  );
});
