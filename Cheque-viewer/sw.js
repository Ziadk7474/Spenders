/* Al Madhi Cheque Viewer — instant opening.
   The app opens straight from the saved copy (no waiting for the internet),
   then quietly downloads the newest version for the next time you open it.
   The Firebase library and fonts are saved too, so nothing big is downloaded
   again on each open. Live cheque data still comes from Firebase every time. */
var CACHE = 'am-cheque-viewer-v8';
var CORE = ['./', './index.html', './manifest.json?v=7', './icon-192.png?v=7', './icon-512.png?v=7', './apple-touch-icon.png?v=7', './favicon-32.png?v=7'];
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(CORE.map(function(u){ return c.add(new Request(u, { cache:'reload' })).catch(function(){}); }));
  }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('am-cheque-viewer') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); })
    /* reload open windows once, so a phone that saved the broken copy (v7) shows the fixed page straight away */
    .then(function(){ return self.clients.matchAll({ type:'window' }); })
    .then(function(list){ list.forEach(function(c){ try{ c.navigate(c.url); }catch(_){} }); }));
});
function fresh(req, c){
  return fetch(req, { cache:'no-cache' }).then(function(res){ if(res && res.ok) c.put(req, res.clone()); return res; });
}
self.addEventListener('fetch', function(e){
  var r = e.request; if(r.method !== 'GET') return;
  var u = new URL(r.url);
  if(u.hostname.indexOf('firebaseio.com') >= 0 || u.hostname.indexOf('firebasedatabase.app') >= 0) return;   // live data: never cached here
  /* Firebase library + fonts: the same file never changes, keep it */
  if(u.hostname === 'www.gstatic.com' || u.hostname === 'fonts.gstatic.com' || u.hostname === 'fonts.googleapis.com'){
    e.respondWith(caches.open(CACHE).then(function(c){ return c.match(r).then(function(hit){ return hit || fetch(r).then(function(res){ if(res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }); }); }));
    return;
  }
  if(u.origin !== self.location.origin) return;
  if(u.pathname.indexOf('/m8-push/') >= 0 || /sw-push\.js$/.test(u.pathname)) return;
  /* our own files: open from the saved copy at once, refresh it in the background */
  var isPage = r.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(function(c){
    var key = isPage ? './index.html' : r;
    return c.match(key, { ignoreSearch:isPage }).then(function(hit){
      var net = fresh(isPage ? new Request('./index.html') : r, c).catch(function(){ return hit; });
      if(hit){ e.waitUntil(net.catch(function(){})); return hit; }
      return net;
    });
  }));
});
