/* am. nexus — cheque reminder notifications.
   A small service worker that only shows reminders. The app registers it on
   its own (it does not replace or touch your existing sw.js).
   Put this file in the same folder as index.html. */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

var APP_URL = new URL('./', self.registration.scope.replace(/m8-push\/?$/, '')).href;

self.addEventListener('push', function(e){
  var d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = { title:'Cheque reminder', body: e.data ? e.data.text() : '' }; }
  var opts = {
    body: d.body || '',
    tag: d.tag || 'almadhi-cheque',
    renotify: true,
    requireInteraction: true,
    icon: APP_URL + 'icon-192.png',
    badge: APP_URL + 'icon-192.png',
    vibrate: [400, 150, 400, 150, 800],
    timestamp: Date.now(),
    data: { chq: d.chq || null, db: d.db || null, url: APP_URL + 'index.html#cheques' },
    actions: d.chq ? [ { action:'clear', title:'Mark as cleared' }, { action:'open', title:'Open' } ] : [ { action:'open', title:'Open' } ]
  };
  e.waitUntil(self.registration.showNotification(d.title || 'Cheque reminder', opts));
});

self.addEventListener('notificationclick', function(e){
  var n = e.notification, data = n.data || {};
  n.close();
  if(e.action === 'clear' && data.chq && data.db){
    e.waitUntil(
      fetch(data.db + '/almadhi/cheques/' + encodeURIComponent(data.chq) + '.json', { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ cleared:true }) })
        .then(function(r){ return self.registration.showNotification(r.ok ? 'Marked as cleared' : 'Could not mark it — open the app', { body: n.body, tag: n.tag, icon: APP_URL + 'icon-192.png', silent: true }); })
        .catch(function(){ return self.registration.showNotification('No internet — open the app to mark it', { tag: n.tag, icon: APP_URL + 'icon-192.png', silent: true }); })
    );
    return;
  }
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list){
    for(var i = 0; i < list.length; i++){
      var c = list[i];
      if(c.url.indexOf(APP_URL) === 0 && 'focus' in c){ c.postMessage({ m8:'open-cheques', chq:data.chq }); return c.focus(); }
    }
    return self.clients.openWindow(data.url || (APP_URL + 'index.html'));
  }));
});
