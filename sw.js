// am. nexus service worker — v7
// Pages, the manifest and the icons always come from the internet first, so a new
// upload (or a new logo) shows at once. The saved copy is only used when offline.
// Firebase traffic is never touched.
const CACHE = 'almadhi-v6';
const CORE = ['./', 'index.html', 'manifest.json?v=7', 'icon-192.png?v=6', 'icon-512.png?v=6', 'apple-touch-icon.png?v=6'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasedatabase.app')) return;
  // fonts / Firebase SDK from gstatic: cache-first (they never change for a given URL)
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit =>
      hit || fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; })
    )));
    return;
  }
  if (url.origin !== location.origin) return;
  // the push worker and other folders (Cheque-viewer) look after themselves
  if (url.pathname.indexOf('/Cheque-viewer/') >= 0 || url.pathname.endsWith('sw-push.js')) return;
  // everything else of ours: internet first, saved copy when offline
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
