/* am. nexus — sends cheque reminders to phones, even when the app is closed.
   Runs on GitHub every 10 minutes (see .github/workflows/cheque-reminders.yml).
   Reads cheques + reminder settings from Firebase, sends a push notification
   at each reminder time, and remembers what it already sent.
   Writes only under almadhi/push — never touches cheques, invoices or payments. */
'use strict';
const webpush = require('web-push');

const DB   = (process.env.FIREBASE_DB_URL || 'https://al-madhi-ledger-default-rtdb.firebaseio.com').replace(/\/$/, '');
const AUTH = process.env.FIREBASE_AUTH ? ('?auth=' + encodeURIComponent(process.env.FIREBASE_AUTH)) : '';
const PUB  = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const NOW  = process.env.NOW ? new Date(process.env.NOW).getTime() : Date.now();
const WINDOW_MS = 3 * 3600e3;          // a reminder that is up to 3 h late is still sent once
const DRY = process.env.DRY_RUN === '1';

const pad = n => String(n).padStart(2, '0');
async function get(path){ const r = await fetch(DB + '/' + path + '.json' + AUTH); if(!r.ok) throw new Error('read ' + path + ' ' + r.status); return r.json(); }
async function patch(path, body){ if(DRY) return; const r = await fetch(DB + '/' + path + '.json' + AUTH, { method:'PATCH', body:JSON.stringify(body) }); if(!r.ok) throw new Error('write ' + path + ' ' + r.status); }
async function del(path){ if(DRY) return; await fetch(DB + '/' + path + '.json' + AUTH, { method:'DELETE' }); }
const money = n => (+n || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });

/* local wall-clock time on the user's phone → real time */
function at(dateStr, time, minusDays, tzOff){
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = (time || '09:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d - (minusDays || 0), hh || 0, mm || 0) + (tzOff || 0) * 60000;
}
function localToday(tzOff){ const t = new Date(NOW - (tzOff || 0) * 60000); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
function daysUntil(dateStr, tzOff){ return Math.round((Date.parse(dateStr + 'T00:00:00Z') - Date.parse(localToday(tzOff) + 'T00:00:00Z')) / 86400000); }
function dLong(s){ return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' }); }

function triggers(cheques, cfg){
  const out = [], tz = cfg.tzOff || -240, rules = Array.isArray(cfg.rules) ? cfg.rules : [], custom = cfg.custom || {};
  const t0 = localToday(tz);
  cheques.forEach(q => {
    if(!q || q.cleared || !q.date) return;
    const n = daysUntil(q.date, tz);
    if(n < -60) return;
    rules.forEach(r => { const t = at(q.date, r.time, +r.days || 0, tz); out.push({ t, q, key: q.id + '|r|' + t }); });
    (custom[q.id] || []).forEach(s => { const [d, tm] = String(s).split('T'); if(d && tm){ const t = at(d, tm, 0, tz); out.push({ t, q, key: q.id + '|c|' + t }); } });
    if(cfg.overdue && n < 0 && rules.length){
      const first = rules.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0];
      const t = at(t0, first.time, 0, tz); out.push({ t, q, key: q.id + '|o|' + t0 });
    }
  });
  return out;
}
function message(q, tz){
  const n = daysUntil(q.date, tz);
  const title = (n < 0 ? 'Cheque overdue' : n === 0 ? 'Cheque due today' : n === 1 ? 'Cheque due tomorrow' : 'Cheque due in ' + n + ' days') + ' · AED ' + money(q.amount);
  const body = (q.party || '—') + ' · Cheque #' + (q.chequeNo || '—') + ' · ' + dLong(q.date) + '. Check the bank balance and deposit money in time if needed.';
  return { title, body };
}
const safeKey = k => k.replace(/[.#$\[\]\/]/g, '_');

async function main(){
  if(!PUB || !PRIV){ console.error('VAPID keys missing — add them as repository secrets.'); process.exit(1); }
  webpush.setVapidDetails('mailto:almadhicarpentry@yahoo.com', PUB, PRIV);
  const [chq, subs, fired] = await Promise.all([ get('almadhi/cheques'), get('almadhi/push/subs'), get('almadhi/push/fired') ]);
  const cheques = Object.values(chq || {});
  const firedAll = fired || {};
  let sent = 0;
  for(const [id, s] of Object.entries(subs || {})){
    if(!s || !s.sub || s.off) continue;
    const cfg = s.cfg || {}, tz = cfg.tzOff || -240, done = firedAll[id] || {};
    const due = triggers(cheques, cfg).filter(x => x.t <= NOW && NOW - x.t < WINDOW_MS && !done[safeKey(x.key)]);
    if(!due.length) continue;
    const seen = {}, uniq = due.filter(x => (seen[x.q.id] ? false : (seen[x.q.id] = 1)));
    const msgs = uniq.length > 3
      ? [{ title: uniq.length + ' cheques need attention · AED ' + money(uniq.reduce((a, x) => a + (+x.q.amount || 0), 0)),
           body: uniq.map(x => x.q.party).slice(0, 4).join(', ') + (uniq.length > 4 ? ' and more' : '') + '. Check the bank balance and deposit money in time if needed.', tag:'almadhi-chq-sum' }]
      : uniq.map(x => Object.assign(message(x.q, tz), { tag:'almadhi-chq-' + x.q.id, chq:x.q.id, db:DB }));
    let gone = false, okAll = true; const okIds = {};
    for(const m of msgs){
      try{ if(!DRY) await webpush.sendNotification(s.sub, JSON.stringify(m), { TTL: 6 * 3600, urgency:'high' }); sent++; if(m.chq) okIds[m.chq] = 1; console.log('sent', id, m.title); }
      catch(err){ okAll = false; console.log('push failed', id, err.statusCode || err.message); if(err.statusCode === 404 || err.statusCode === 410){ gone = true; break; } }
    }
    if(gone){ await del('almadhi/push/subs/' + id); await del('almadhi/push/fired/' + id); continue; }
    /* only remember what really went out — a failed one is tried again on the next run */
    const upd = {}; due.forEach(x => { if(okIds[x.q.id] || (okAll && !msgs[0].chq)) upd[safeKey(x.key)] = NOW; });
    /* forget keys older than 90 days so the list never grows forever */
    Object.entries(done).forEach(([k, v]) => { if(NOW - v > 90 * 86400e3) upd[k] = null; });
    await patch('almadhi/push/fired/' + id, upd);
  }
  if(!DRY) await patch('almadhi/push', { lastRun: NOW });
  console.log('done, sent', sent);
}
if(require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { triggers, at, daysUntil, message };
