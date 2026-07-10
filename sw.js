// Al Madhi PWA service worker — instant opening
const CACHE = 'almadhi-v2';
const CORE = ['./', 'index.html', 'icon-192.png?v=3', 'icon-512.png?v=3', 'icon-1024.png?v=3', 'icon-192-maskable.png?v=3', 'icon-512-maskable.png?v=3', 'manifest.json?v=3'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasedatabase.app')) return;
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.open(CACHE).then(c => c.match(e.request).then(hit =>
        hit || fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; })
      ))
    );
    return;
  }
  if (e.request.mode === 'navigate' || url.origin === location.origin) {
    e.respondWith(
      caches.open(CACHE).then(c => c.match(e.request).then(hit => {
        const net = fetch(e.request).then(res => {
          if (res && res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      }))
    );
  }
});
