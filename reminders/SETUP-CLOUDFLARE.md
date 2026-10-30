# On-time cheque reminders (Cloudflare, free) — one-time setup

GitHub only starts the reminder job every few hours, so reminders came late or only
when the app was opened. Cloudflare runs the same job **every 5 minutes, on time**,
for free. Set it up once (about 5 minutes). GitHub stays as a backup.

## 1. Make the Worker
1. Go to **dash.cloudflare.com** and sign up (free, no card needed).
2. Left menu: **Workers & Pages** → **Create** → **Create Worker** (Start with Hello World).
3. Name it `amnexus-reminders` → **Deploy**.
4. Press **Edit code**. Delete everything in the editor.
5. Open `reminders/worker.mjs` from this repo, copy **all** of it, paste it in the editor.
6. Press **Deploy**.

## 2. Add the keys
Worker → **Settings** → **Variables and Secrets** → **Add**:

| Type   | Name                | Value |
|--------|---------------------|-------|
| Text   | `VAPID_PUBLIC_KEY`  | the public key (same as in GitHub secrets) |
| Secret | `VAPID_PRIVATE_KEY` | the private key from your private setup file (never put it in GitHub files) |
| Secret | `FIREBASE_AUTH`     | only if you added FIREBASE_AUTH on GitHub too — otherwise skip |

Press **Deploy** / **Save**.

## 3. Run it every 5 minutes
Worker → **Settings** → **Triggers** → **Cron Triggers** → **Add** → type
`*/5 * * * *` → **Add**.

## 4. Check it works
Open the Worker's address with `?run=1` at the end, for example
`https://amnexus-reminders.YOURNAME.workers.dev/?run=1`
You should see `"ok": true`.

Then in the app: **More → Cheque reminders**. Phone notifications should say
**"On · arrives even when the app is closed · checked … min ago"**.
Press **Test**, close the app — a test notification arrives within 5 minutes.

## Samsung phone (important, once)
- Settings → Apps → **am. nexus** → Notifications: **Allowed**, and turn on sound/pop-up.
- Settings → Apps → **Chrome** (or Samsung Internet, whichever opened the app) → Battery → **Unrestricted**.
- Settings → Battery → Background usage limits → make sure Chrome / am. nexus is **not** in "Sleeping apps" or "Deep sleeping apps".
