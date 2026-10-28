/* Al Madhi Cheque Viewer — offline support.
   Always tries the internet first, so a new upload shows up at once.
   Falls back to the saved copy when there is no internet. */
var CACHE = 'am-cheque-viewer-v6';
var CORE = ['./', './index.html', './manifest.json?v=6', './icon-192.png?v=6', './apple-touch-icon.png?v=6'];
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(CORE).catch(function(){}); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var r = e.request;
  if(r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(function(res){
    if(res && res.ok){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(r, copy); }); }
    return res;
  }).catch(function(){
    return caches.match(r).then(function(m){ return m || (r.mode === 'navigate' ? caches.match('./index.html') : undefined); });
  }));
});
