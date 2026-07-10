// Cheque Viewer — app-shell cache so the app opens instantly and works
// offline after the first successful load. Firebase requests always go
// straight to the network (never intercepted/cached here) — the cheque
// list itself is cached separately inside index.html via localStorage,
// so it's never served stale from this worker.
const CACHE = 'chq-viewer-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only intercept same-origin GET requests for this app's own files.
  // Firebase reads, Google Fonts, etc. are left alone and go to network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached => cached || caches.match('./index.html'))
    )
  );
});
