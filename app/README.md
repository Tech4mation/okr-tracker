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
- **One platform, many organizations.** Each company is an organization with its own people, settings, records, files and email log. Nobody in one organization can see or change anything in another. Everyone signs in at the same address and lands in their own organization. One email address belongs to one organization.
- **One process, no packages.** It is a single Node.js process using SQLite, with no third-party packages, so there is nothing to `npm install`. Each organization has its own database file.
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

1. **Create the CEO account.** A fresh install starts with one empty organization, named by `FIRST_ORG_NAME`. On first start the server prints a one-time link for it, `https://okr.yourcompany.com/setup?token=…`, valid for 7 days. Open it and create the account. If the link is lost, run `npm run setup-link` (Docker: `docker compose exec okr-tracker node server.js setup-link`).
2. **Add everyone.** The CEO or HR adds people in the **Directory**, either one at a time or with **Import CSV**. Set each person's line manager, because approvals, reviews and leave all follow the reporting line.
3. **Invite them.** Press **Invite** next to each person to get their link, valid for 14 days. If email is set up, the link is also emailed to them. They open it, choose a password and are in. There is no public sign-up page.

## Organizations

**Sign-up:** any company can start its own tracker from the sign-in page ("Create its tracker"). The person enters the company name, their name, work email and a password; we email a link to confirm the address, valid 24 hours. Nothing is created until they open it. Then the company exists, empty, with them as its CEO, and they are signed in. The form never says whether an address is already in use: that address's owner gets an email saying they already have an account instead. Sign-ups are limited to 5 an hour from one address and 3 emails an hour to one inbox. Sign-up needs email to be set up; `OPEN_SIGNUP=false` turns it off.

**A new company starts clean:** only its CEO, its own company name (shown in the browser tab, down the side of every page and in its emails), and no subsidiaries until it adds them. The name can be changed in **Settings → Your company**, along with an optional Monday reminder for everyone's dashboard. **Settings → Sample data** loads a made-up company of seven people with goals, standups and leave, to see the tracker filled in; it can only be loaded while the company is empty, sample people can't sign in, and **Clear sample data** removes exactly the sample and nothing anyone added themselves.

**The platform page** at `https://okr.yourcompany.com/platform` is for whoever runs the platform, not for the companies on it. Companies sign up themselves; nobody here creates or approves them. From it you:
- see every organization: its CEO, number of people, when it was created and when someone last used it;
- send a locked-out CEO a password reset link (or a fresh invite, if they never chose a password);
- pause an organization for spam or abuse (nobody in it can sign in, its email stops, nothing is deleted) and bring it back.

Platform accounts are separate from every organization's accounts, with their own sign-in, and nobody signed in to an organization can use the page. Make one with `npm run platform-owner -- you@yourcompany.com "Your Name"`, which prints a link to choose a password (valid 24 hours; running it again for the same email gives a reset link). Platform passwords need at least 10 characters, and a platform sign-in lasts 12 hours.

The same jobs can be done on the server, from the `app` folder (Docker: `docker compose exec okr-tracker node server.js <command>`):

| Command | What it does |
|---|---|
| `npm run orgs` | Lists every organization: its id, name, number of people and CEO. |
| `npm run org-create -- "Acme Ltd"` | Adds an empty organization and prints a setup link for its CEO, valid 7 days. Send it to them; whoever uses it becomes that organization's CEO. |
| `npm run setup-link -- <org-id>` | A new setup link for an organization that has no CEO yet. The id can be left out while there is only one organization. |
| `npm run reset-link -- <email>` | A password reset link for that account, in whichever organization it belongs to. |
| `npm run platform-owner -- <email> [name]` | A link for one of us to choose a password for the platform page. |

Adding an email address that another organization already uses is refused, whether it is typed in, imported or used to set up a CEO. The address frees up when its person is removed.

**Upgrading from the single-company build:** on its first start, the old `data/okr-tracker.db` and `data/files/` become the first organization, named by `FIRST_ORG_NAME`. Every record, account and open session is kept, and links already sent out still work. The old file is renamed to `okr-tracker.db.moved-to-<org-id>` rather than deleted. Stop the app before the upgrade and take a backup, as for any update.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | none | The address people use, such as `https://okr.yourcompany.com`. It is used in links and emails, and an `https` address turns on secure cookies. |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to listen on. Docker sets `0.0.0.0`. |
| `DATA_DIR` | `./data` | Where the data lives: `platform.db` (the organizations, and which one each email belongs to) and one folder per organization, `orgs/<id>/`, holding its `okr.db`, its attached documents (`files/`) and its backups (`backups/`). |
| `OPEN_SIGNUP` | `true` | Lets companies sign themselves up from the sign-in page. Set `false` to turn it off, for example on a copy one company hosts for itself. Sign-up is also off while email is not set up. |
| `FIRST_ORG_NAME` | `My organization` | Name of the organization a fresh install starts with, or that an upgraded single-company install becomes. |
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
  - It writes a consistent copy of every organization's database to its own `data/orgs/<id>/backups/`, and of `platform.db` to `data/backups/`. It is safe while the app is running. On Docker, use `docker compose exec okr-tracker node server.js backup`.
  - Attached documents are files in each `data/orgs/<id>/files/`, so copy those folders too.
  - Copy all of it off the server. A nightly cron job is enough:
    `0 2 * * * cd /opt/okr-tracker/app && sudo -u okr node --disable-warning=ExperimentalWarning server.js backup`
- **Restore one organization:**
  1. Stop the app.
  2. Replace `data/orgs/<id>/okr.db` with its backup and put back its `files/` folder.
  3. Delete any `okr.db-wal` and `okr.db-shm` files next to it.
  4. Start the app. Its people's email addresses are re-registered to it on start.
- **Update:** run `git pull`, then `sudo systemctl restart okr-tracker` (Docker: `docker compose up -d --build`). One update reaches every organization at once; each organization's database upgrades itself on start.
  - Upgrading from the v1.0 build keeps accounts, people, OKRs, standup entries and weekly gains.
  - It drops v1.0's weekly priorities and achievements, which v1.1 does not have.
  - Take a backup first.

## Security notes

- **Passwords and sessions:** passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly cookie; the server stores only their hash, and they last 30 days from last use.
- **Sign-in limits:** sign-in is limited to 10 attempts per address and email every 15 minutes. Invite and reset links are single-use and expire.
- **Organizations are kept apart.** A session cookie or link names its organization, and its token is checked against that organization's own database only. Relabelling one for another organization signs nobody in. Live updates, email, files and the CEO preview all stay inside one organization.
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
| `server.js` | Entry point, and the orgs, org-create, setup-link, reset-link, platform-owner and backup commands |
| `src/signup.js` | Companies signing themselves up, with email confirmation |
| `src/admin.js` | The platform page's API: owner sign-in, new organizations, CEO links, pausing |
| `src/platform.js` | The organizations, which one each email belongs to, and the upgrade from the single-company layout |
| `src/org.js` | One organization: its records, actions, accounts, links, files, email and live updates |
| `public/model.js` | The rules: who sees whom, progress and status, approvals, reviews, leave, hiring, onboarding. Shared by the server and the page |
| `src/actions.js` | Every change, as a named action the server checks and runs |
| `src/view.js` | What each person's browser is allowed to receive |
| `src/store.js` | Keeps the in-memory state and the database in step, all or nothing |
| `src/app.js` | HTTP server: routes each request to its organization, sign-in, live updates, static files |
| `src/http.js` | Small shared HTTP helpers |
| `src/mail.js`, `src/smtp.js` | Email alerts, the daily email, the outbox, and a small SMTP client |
| `src/db.js` | SQLite schema and upgrades |
| `src/auth.js` | Passwords, sessions, one-time links, rate limiting |
| `public/app.js`, `app.css`, `index.html` | The page (the v1.1 prototype's screens) |
| `public/platform.html`, `platform.js` | The platform page |
