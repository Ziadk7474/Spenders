# Security

**Report a problem:** please email almadhicarpentry@yahoo.com instead of opening a public issue.

## What is public on purpose
- The Firebase web settings in `index.html` (`apiKey`, project id). Every Firebase web app ships these;
  they only say which database to talk to. Access is decided by the database rules, which allow
  the owner's Google account only (the Cheque Viewer can read the cheque list).
- The push public key (`PUSH_KEY`). Only the private key can send notifications, and it is kept
  in GitHub Secrets / Cloudflare, never in this repository.

## What protects the data
- Database rules (Firebase console) — the real lock.
- Google sign-in in the app.
- All text coming from the database is cleaned before it is shown, so saved text cannot run code.
- The reminder job's log shows counts only, never amounts, names or dates.
- CodeQL code scanning and GitHub secret scanning with push protection run on this repository.

## Never put in this repository
- The VAPID **private** key, the Firebase database secret, or any password.
