/* Al Madhi — cheque reminder notifications.
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
    data: { chq: d.chq || null, db: d.db || null, url: APP_URL + '#cheques' },
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
    return self.clients.openWindow(data.url || APP_URL);
  }));
});

/* the phone's push address can change (browser update, reset). Sign up again at once and
   tell the reminder service, so reminders keep coming without opening the app. */
var DB_URL = 'https://al-madhi-ledger-default-rtdb.firebaseio.com';
var PUSH_KEY = 'BB23MY9TC7NYtjiLhXlUMsZdX77Kgl-jQt3QOQxPVMdCkivHZqRE1Lh_BdIwBdWph_N7FggWa8Z_K0ThNfoZxRo';
function b64(s){ var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g,'+').replace(/_/g,'/')), u = new Uint8Array(b.length); for(var i=0;i<b.length;i++) u[i] = b.charCodeAt(i); return u; }
function hash(s){ var h = 5381; for(var i=0;i<s.length;i++) h = ((h<<5) + h + s.charCodeAt(i)) >>> 0; return 'd' + h.toString(36) + s.length.toString(36); }
self.addEventListener('pushsubscriptionchange', function(e){
  e.waitUntil((async function(){
    var old = e.oldSubscription, sub = e.newSubscription;
    if(!sub) sub = await self.registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64(PUSH_KEY) });
    var j = sub.toJSON(), id = hash(j.endpoint), rec = null;
    if(old && old.endpoint){
      var oid = hash(old.endpoint);
      try{ rec = await (await fetch(DB_URL + '/almadhi/push/subs/' + oid + '.json')).json(); }catch(err){}
      try{ await fetch(DB_URL + '/almadhi/push/subs/' + oid + '.json', { method:'PATCH', body:JSON.stringify({ off:true, movedTo:id }) }); }catch(err){}
    }
    await fetch(DB_URL + '/almadhi/push/subs/' + id + '.json', { method:'PUT', body:JSON.stringify({
      sub:j, cfg:(rec && rec.cfg) || { rules:[{ days:1, time:'09:00' }, { days:0, time:'08:30' }], overdue:true, custom:{}, tzOff:-240 },
      app:(rec && rec.app) || 'erp', at:Date.now(), renewed:true }) });
  })().catch(function(){}));
});
