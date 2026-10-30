/* am. nexus — cheque reminder sender for Cloudflare Workers (free plan).
   Cloudflare runs this every 5 minutes, on time, day and night. It reads the
   cheques and each phone's reminder settings from Firebase and sends a phone
   notification at every reminder time — the app does not need to be open.

   Setup (one time, about 5 minutes) is in reminders/SETUP-CLOUDFLARE.md.
   The GitHub job (send.js) uses this same file as a backup.
   Settings it needs (Worker → Settings → Variables and Secrets):
     VAPID_PUBLIC_KEY   (text)
     VAPID_PRIVATE_KEY  (secret)
     FIREBASE_DB_URL    (text, optional — default below)
     FIREBASE_AUTH      (secret, optional — only if the database needs a login)
   Cron trigger: every 5 minutes (written as: star-slash-5 then four stars).

   It only ever writes under almadhi/push. Cheques, invoices and payments are
   read, never changed. */

const DEFAULT_DB = 'https://al-madhi-ledger-default-rtdb.firebaseio.com';
const LATE_MS = 24 * 3600e3;          // a reminder missed while the phone/service was down is still sent, up to 24 h late
const TTL = 24 * 3600;                // the push service keeps it up to 24 h if the phone is offline

export default {
  async scheduled(event, env, ctx){ ctx.waitUntil(run(env, Date.now()).catch(e => console.log('run failed', e && e.stack || e))); },
  /* open the worker's address in a browser to see that it is alive; add ?run=1 to check right now */
  async fetch(req, env){
    const u = new URL(req.url);
    if(u.searchParams.get('run') === '1'){ const r = await run(env, Date.now()); return json(r); }
    return json({ ok:true, service:'am. nexus cheque reminders', time:new Date().toISOString(), hint:'add ?run=1 to check for reminders now' });
  }
};
function json(o){ return new Response(JSON.stringify(o, null, 2), { headers:{ 'content-type':'application/json' } }); }

/* ── the job ─────────────────────────────────────────────────────────── */
export async function run(env, NOW, opts){
  opts = opts || {};
  const DB = (env.FIREBASE_DB_URL || DEFAULT_DB).replace(/\/$/, '');
  const AUTH = env.FIREBASE_AUTH ? ('?auth=' + encodeURIComponent(env.FIREBASE_AUTH)) : '';
  const http = opts.fetch || fetch;
  const get = async p => { const r = await http(DB + '/' + p + '.json' + AUTH); if(!r.ok) throw new Error('read ' + p + ' ' + r.status); return r.json(); };
  const patch = async (p, b) => { const r = await http(DB + '/' + p + '.json' + AUTH, { method:'PATCH', body:JSON.stringify(b) }); if(!r.ok) throw new Error('write ' + p + ' ' + r.status); };
  const del = p => http(DB + '/' + p + '.json' + AUTH, { method:'DELETE' });
  if(!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys missing');
  const vapid = { pub:env.VAPID_PUBLIC_KEY, priv:env.VAPID_PRIVATE_KEY, sub:'mailto:almadhicarpentry@yahoo.com' };

  const [chq, subs, fired, tests] = await Promise.all([ get('almadhi/cheques'), get('almadhi/push/subs'), get('almadhi/push/fired'), get('almadhi/push/test') ]);
  const cheques = Object.values(chq || {});
  let sent = 0; const log = [];
  for(const [id, s] of Object.entries(subs || {})){
    if(!s || !s.sub || s.off) continue;
    const cfg = s.cfg || {}, tz = cfg.tzOff == null ? -240 : cfg.tzOff, done = (fired || {})[id] || {};
    const msgs = [];
    /* a test the phone asked for from the app */
    if(tests && tests[id]){ msgs.push({ title:'Test from the reminder service', body:'Notifications reach this phone even when the app is closed. You can close this.', tag:'almadhi-test' }); }
    const due = triggers(cheques, cfg, NOW).filter(x => x.t <= NOW && NOW - x.t < LATE_MS && !done[safeKey(x.key)]);
    const seen = {}, uniq = due.filter(x => (seen[x.q.id] ? false : (seen[x.q.id] = 1)));
    if(uniq.length > 3){
      msgs.push({ title: uniq.length + ' cheques need attention · AED ' + money(uniq.reduce((a, x) => a + (+x.q.amount || 0), 0)),
        body: uniq.map(x => x.q.party).slice(0, 4).join(', ') + (uniq.length > 4 ? ' and more' : '') + '. Check the bank balance and deposit money in time if needed.', tag:'almadhi-chq-sum', ids:uniq.map(x => x.q.id) });
    } else uniq.forEach(x => msgs.push(Object.assign(message(x.q, tz, NOW), { tag:'almadhi-chq-' + x.q.id, chq:x.q.id, db:DB, ids:[x.q.id] })));
    if(!msgs.length) continue;

    let gone = false; const okIds = {}; let testOk = false;
    for(const m of msgs){
      const ids = m.ids; delete m.ids;
      try{
        const res = await sendPush(s.sub, JSON.stringify(m), vapid, http);
        if(res.status === 404 || res.status === 410){ gone = true; log.push(id + ' gone'); break; }
        if(res.status >= 400){ log.push(id + ' failed ' + res.status + ' ' + (await res.text()).slice(0, 120)); continue; }
        sent++; (ids || []).forEach(q => okIds[q] = 1); if(m.tag === 'almadhi-test') testOk = true; log.push(id + ' sent ' + m.title);
      }catch(e){ log.push(id + ' error ' + (e && e.message || e)); }
    }
    /* the phone's address no longer works: mark it, the app signs up again by itself next time it opens */
    if(gone){ await patch('almadhi/push/subs/' + id, { off:true, gone:NOW }); continue; }
    const upd = {};
    due.forEach(x => { if(okIds[x.q.id]) upd[safeKey(x.key)] = NOW; });
    Object.entries(done).forEach(([k, v]) => { if(NOW - v > 90 * 86400e3) upd[k] = null; });
    if(Object.keys(upd).length) await patch('almadhi/push/fired/' + id, upd);
    if(testOk) await del('almadhi/push/test/' + id);
  }
  await patch('almadhi/push', { lastRun:NOW, lastBy:opts.by || 'cloudflare' });
  return { ok:true, sent, log };
}

/* ── reminder times (same rules as the app) ──────────────────────────── */
const pad = n => String(n).padStart(2, '0');
const safeKey = k => k.replace(/[.#$\[\]\/]/g, '_');
const money = n => (+n || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
function at(dateStr, time, minusDays, tzOff){
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = (time || '09:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d - (minusDays || 0), hh || 0, mm || 0) + (tzOff || 0) * 60000;
}
function localToday(tzOff, NOW){ const t = new Date(NOW - (tzOff || 0) * 60000); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
function daysUntil(dateStr, tzOff, NOW){ return Math.round((Date.parse(dateStr + 'T00:00:00Z') - Date.parse(localToday(tzOff, NOW) + 'T00:00:00Z')) / 86400000); }
function dLong(s){ return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' }); }
export function triggers(cheques, cfg, NOW){
  const out = [], tz = cfg.tzOff == null ? -240 : cfg.tzOff, rules = Array.isArray(cfg.rules) ? cfg.rules : [], custom = cfg.custom || {};
  const t0 = localToday(tz, NOW);
  cheques.forEach(q => {
    if(!q || q.cleared || !q.date) return;
    const n = daysUntil(q.date, tz, NOW);
    if(n < -60) return;
    rules.forEach(r => { const t = at(q.date, r.time, +r.days || 0, tz); out.push({ t, q, key:q.id + '|r|' + t }); });
    (custom[q.id] || []).forEach(s => { const [d, tm] = String(s).split('T'); if(d && tm){ const t = at(d, tm, 0, tz); out.push({ t, q, key:q.id + '|c|' + t }); } });
    if(cfg.overdue && n < 0 && rules.length){
      const first = rules.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0];
      const t = at(t0, first.time, 0, tz); out.push({ t, q, key:q.id + '|o|' + t0 });
    }
  });
  return out;
}
export function message(q, tz, NOW){
  const n = daysUntil(q.date, tz, NOW);
  const title = (n < 0 ? 'Cheque overdue' : n === 0 ? 'Cheque due today' : n === 1 ? 'Cheque due tomorrow' : 'Cheque due in ' + n + ' days') + ' · AED ' + money(q.amount);
  const body = (q.party || '—') + ' · Cheque #' + (q.chequeNo || '—') + ' · ' + dLong(q.date) + '. Check the bank balance and deposit money in time if needed.';
  return { title, body };
}

/* ── Web Push (RFC 8291 encryption + RFC 8292 VAPID) with WebCrypto ── */
const enc = new TextEncoder();
const b64u = {
  dec(s){ s = s.replace(/-/g, '+').replace(/_/g, '/'); while(s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
  enc(u){ let s = ''; u = new Uint8Array(u); for(let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
};
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
async function hmac(key, data){ const k = await crypto.subtle.importKey('raw', key, { name:'HMAC', hash:'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }

async function vapidHeader(endpoint, v){
  const pub = b64u.dec(v.pub);
  const jwk = { kty:'EC', crv:'P-256', d:v.priv, x:b64u.enc(pub.slice(1, 33)), y:b64u.enc(pub.slice(33, 65)), ext:true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
  const head = b64u.enc(enc.encode(JSON.stringify({ typ:'JWT', alg:'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud:new URL(endpoint).origin, exp:Math.floor(Date.now() / 1000) + 12 * 3600, sub:v.sub })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, key, enc.encode(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + b64u.enc(sig) + ', k=' + v.pub;
}
export async function encrypt(payload, sub){
  const uaPub = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name:'ECDH', namedCurve:'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name:'ECDH', public:uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, secret);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey('raw', cek, { name:'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv:nonce }, k, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
export async function sendPush(sub, payload, v, http){
  const body = await encrypt(payload, sub);
  return (http || fetch)(sub.endpoint, { method:'POST', body, headers:{
    'Authorization': await vapidHeader(sub.endpoint, v),
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    'TTL': String(TTL), 'Urgency': 'high'
  } });
}
