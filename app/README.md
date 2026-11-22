# Team OKR Tracker

A goal-tracking and HR tool for a group of subsidiaries, built to the Team OKR Tracker PRD v1.1. It covers:
- **Goals:** OKRs with measured and monthly key results, whose progress counts itself from the daily standup.
- **Approvals:** finished key results are approved by the line manager.
- **Weekly rhythm:** the standup and the Friday review.
- **People:** performance signals, appraisals and half-yearly reviews, wellbeing check-ins and leave, hiring requests and onboarding.
- **Running it:** a staff directory, HR settings, CSV import and export, and email alerts.

The screens are the product lead's v1.1 prototype. This app gives them:
- real accounts;
- a database;
- a server that enforces who may see and change what.

How it is built:
- **One process, one file.** It is a single Node.js process with one SQLite file and no third-party packages, so there is nothing to `npm install`.
- **Sign-in:** people sign in with email and password. HR or the CEO adds them and hands them an invite link.
- **Privacy:** each browser receives only what that person may see, under PRD section 1 and the permissions matrix. Every change is re-checked on the server.
- **Live updates:** changes show up for everyone without refreshing.

`demo.html` is the first clickable demo and `_supabase-version/` an older attempt. Neither is used.

## Requirements

- Node.js 22.13 or later, or Docker.
- A subdomain (for example `okr.yourcompany.com`) and HTTPS in front of the app. An nginx example is in `deploy/nginx.conf`.
- Optional, for email alerts: an SMTP mailbox the app can send from. Google Workspace, Microsoft 365, Zoho, SES and Mailgun all work.

## Install with Docker

```sh
git clone https://github.com/Tech4mation/okr-tracker.git && cd okr-tracker/app
# edit docker-compose.yml: PUBLIC_URL, TZ and, for email, the SMTP_ settings
docker compose up -d --build
docker compose logs okr-tracker      # shows the link to create the CEO account
```

Data lives in the `okr-data` volume. The app listens on `127.0.0.1:3000`; put nginx in front of it for HTTPS.

## Install with plain Node (systemd)

```sh
sudo useradd --system --home /opt/okr-tracker --shell /usr/sbin/nologin okr
sudo git clone https://github.com/Tech4mation/okr-tracker.git /opt/okr-tracker
sudo mkdir -p /opt/okr-tracker/app/data && sudo chown -R okr:okr /opt/okr-tracker/app/data
sudo cp /opt/okr-tracker/app/deploy/okr-tracker.service /etc/systemd/system/
sudo nano /etc/systemd/system/okr-tracker.service   # set PUBLIC_URL, TZ and the SMTP_ lines
sudo systemctl daemon-reload && sudo systemctl enable --now okr-tracker
journalctl -u okr-tracker -n 20                      # shows the link to create the CEO account
```

Then set up nginx from `deploy/nginx.conf`. The live-updates stream (`/api/events`) needs buffering turned off, as that file does.

## First run

1. **Create the CEO account.** On first start the server prints a one-time link, `https://okr.yourcompany.com/setup?token=…`, valid for 7 days. Open it and create the account. If the link is lost, run `npm run setup-link` (Docker: `docker compose exec okr-tracker node server.js setup-link`).
2. **Add everyone.** The CEO or HR adds people in the **Directory**, either one at a time or with **Import CSV**. Set each person's line manager, because approvals, reviews and leave all follow the reporting line.
3. **Invite them.** Press **Invite** next to each person to get their link, valid for 14 days. If email is set up, the link is also emailed to them. They open it, choose a password and are in. There is no public sign-up page.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | none | The address people use, such as `https://okr.yourcompany.com`. It is used in links and emails, and an `https` address turns on secure cookies. |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to listen on. Docker sets `0.0.0.0`. |
| `DATA_DIR` | `./data` | Where the database file and attached documents (`files/`) live. |
| `TRUST_PROXY` | `false` | Set `true` behind nginx so sign-in rate limits see real client addresses. |
| `TZ` | server's | Timezone for weeks (Monday to Sunday), due months and the daily email. |
| `COOKIE_SECURE` | from `PUBLIC_URL` | Force secure cookies `true` or `false`. |
| `SMTP_HOST` | none | Mail server. Without it, and without `MAIL_FROM`, alerts stay in the app and the email log says so. |
| `SMTP_PORT` | `587` (`465` if secure) | Mail server port. |
| `SMTP_SECURE` | `false` | `true` for implicit TLS on port 465. On 587 the app upgrades with STARTTLS when the server offers it. |
| `SMTP_USER`, `SMTP_PASS` | none | Mailbox sign-in. |
| `MAIL_FROM` | none | The address alerts come from, such as `okr@yourcompany.com`. HR sets the sender name and reply-to address in Settings. |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `true` | Set `false` only for a mail server with a self-signed certificate. |

## Email alerts (PRD section 13)

- **What goes out:** every alert in the PRD's table is shown on the dashboard. HR chooses, per alert, whether it is also emailed straight away, collected into one daily email, or kept in the app only. The daily email goes out on weekdays at the hour set in Settings.
- **The email log:** it is in **Settings → Email log**. It shows what went out, what is waiting and what failed, and lists anyone without a valid address. HR's dashboard also flags emails that could not be delivered. **Send me a test email** checks the setup.
- **Failures:** a failed send is retried after 1, 5, 30 and 120 minutes, then marked failed.
- **Content:** emails never contain a rating, a pay figure or review text; they say what happened and link to the app.

## Day to day

- **Forgotten password:** HR or the CEO opens the Directory and presses **Reset link** next to the person, then sends them the link privately. It works once, within 24 hours. If the CEO is locked out, run `npm run reset-link -- ceo@yourcompany.com` on the server.
- **Backups:** run `npm run backup`.
  - It writes a consistent copy of the database to `data/backups/` and is safe while the app is running. On Docker, use `docker compose exec okr-tracker node server.js backup`.
  - Attached documents are files in `data/files/`, so copy that folder too.
  - Copy both off the server. A nightly cron job is enough:
    `0 2 * * * cd /opt/okr-tracker/app && sudo -u okr node --disable-warning=ExperimentalWarning server.js backup`
- **Restore:**
  1. Stop the app.
  2. Replace `data/okr-tracker.db` with the backup and put back `data/files/`.
  3. Delete any `okr-tracker.db-wal` and `okr-tracker.db-shm` files next to it.
  4. Start the app.
- **Update:** run `git pull`, then `sudo systemctl restart okr-tracker` (Docker: `docker compose up -d --build`). The database upgrades itself on start.
  - Upgrading from the v1.0 build keeps accounts, people, OKRs, standup entries and weekly gains.
  - It drops v1.0's weekly priorities and achievements, which v1.1 does not have.
  - Take a backup first.

## Security notes

- **Passwords and sessions:** passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly cookie; the server stores only their hash, and they last 30 days from last use.
- **Sign-in limits:** sign-in is limited to 10 attempts per address and email every 15 minutes. Invite and reset links are single-use and expire.
- **What each browser receives:** only what that person may see. Examples:
  - A member never receives a colleague's goals, reviews, check-ins, leave or pay.
  - A manager's review stays hidden from the person until it is shared.
  - Pay is visible to HR, the CEO and the person themselves.
- **The CEO preview** ("Viewing as") shows exactly what that person sees, and is read-only.
- **Every change is checked on the server**, including when someone calls the API directly. `test/api.test.js` covers this.
- **Attached files are always downloaded, never opened as a page**, so an uploaded file can't run in someone's browser.
- **The only outside request** the page makes is to Google Fonts. To remove it, delete the fonts `<link>` in `public/index.html`; the page falls back to system fonts.

## Development

```sh
npm run dev     # restarts on file changes; open http://localhost:3000
npm test        # API tests against the PRD rules
```

| Path | What it is |
|---|---|
| `server.js` | Entry point, and the setup-link, reset-link and backup commands |
| `public/model.js` | The rules: who sees whom, progress and status, approvals, reviews, leave, hiring, onboarding. Shared by the server and the page |
| `src/actions.js` | Every change, as a named action the server checks and runs |
| `src/view.js` | What each person's browser is allowed to receive |
| `src/store.js` | Keeps the in-memory state and the database in step, all or nothing |
| `src/app.js` | HTTP server: sign-in, invites, state, actions, documents, email log, live updates, static files |
| `src/mail.js`, `src/smtp.js` | Email alerts, the daily email, the outbox, and a small SMTP client |
| `src/db.js` | SQLite schema and upgrades |
| `src/auth.js` | Passwords, sessions, one-time links, rate limiting |
| `public/app.js`, `app.css`, `index.html` | The page (the v1.1 prototype's screens) |
