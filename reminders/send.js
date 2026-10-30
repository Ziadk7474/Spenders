/* am. nexus — backup sender, run by GitHub (.github/workflows/cheque-reminders.yml).
   The main sender is the Cloudflare Worker (worker.mjs, runs every 5 minutes).
   GitHub only starts this job every few hours, so it stays quiet while the
   Cloudflare Worker is working, and takes over if the Worker stops.
   Both use the same code (worker.mjs) and the same "already sent" list in
   Firebase, so a reminder is never sent twice. */
'use strict';
const DB = (process.env.FIREBASE_DB_URL || 'https://al-madhi-ledger-default-rtdb.firebaseio.com').replace(/\/$/, '');
const AUTH = process.env.FIREBASE_AUTH ? ('?auth=' + encodeURIComponent(process.env.FIREBASE_AUTH)) : '';

async function main(){
  const { run } = await import('./worker.mjs');
  const NOW = process.env.NOW ? new Date(process.env.NOW).getTime() : Date.now();
  if(process.env.FORCE !== '1'){
    try{
      const r = await fetch(DB + '/almadhi/push.json' + AUTH + (AUTH ? '&' : '?') + 'shallow=false');
      const p = r.ok ? await r.json() : null;
      if(p && p.lastBy === 'cloudflare' && NOW - (+p.lastRun || 0) < 20 * 60e3){ console.log('Cloudflare Worker is running (last check ' + Math.round((NOW - p.lastRun) / 60e3) + ' min ago) — nothing to do.'); return; }
    }catch(e){ console.log('could not read status, running anyway:', e.message); }
  }
  const res = await run(process.env, NOW, { by:'github' });
  res.log.forEach(l => console.log(l));
  console.log('done, sent', res.sent);
}
main().catch(e => { console.error(e); process.exit(1); });
