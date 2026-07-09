// Cheque Viewer — minimal app-shell cache.
// Only caches this app's own static files. Firebase requests always go straight
// to the network so the list is never served stale.
const CACHE = 'chq-viewer-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(()=>{}));
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
  // Only intercept same-origin GET requests for our own shell files.
  if(e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
