// am. nexus service worker — v14
// Pages, the manifest and the icons come from the internet first, so a new upload shows at once.
// (Nov 26) If the internet is slow and gives nothing within 2.5 s, the saved copy opens instead and
// the new copy is saved for the next start — before, a slow connection kept the start screen (or a
// blank screen) up for as long as the internet took. Offline: the saved copy, as before.
// Firebase traffic is never touched.
const CACHE = 'almadhi-v13';   // same name on purpose: keeps the saved copy
const SLOW_MS = 2500;
const CORE = ['./', 'index.html', 'manifest.json?v=10', 'icon-192.png?v=9', 'icon-512.png?v=9', 'apple-touch-icon.png?v=6',
  // PDF / Excel tools now live on our own site (checked copies), saved so exports work offline too
  'lib/jspdf-4.2.1.umd.min.js', 'lib/jspdf.plugin.autotable-5.0.9.min.js', 'lib/xlsx-0.20.3.full.min.js'];

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
  if (/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)) return;   // live data: never touched
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
  // everything else of ours: internet first; saved copy when offline, or when the internet is too slow
  const saved = () => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}).then(() => res); }
    return res;
  });
  e.waitUntil(net.catch(() => {}));            // the fresh copy is still saved when the saved one was shown
  e.respondWith(new Promise(resolve => {
    let done = false;
    const give = r => { if (!done) { done = true; resolve(r); } };
    const t = setTimeout(() => { saved().then(hit => { if (hit) give(hit); }); }, SLOW_MS);
    net.then(res => { clearTimeout(t); give(res); },
             () => { clearTimeout(t); saved().then(hit => give(hit || Response.error())); });
  }));
});
