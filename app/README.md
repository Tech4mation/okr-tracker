# Team OKR Tracker

A small web app for annual OKRs with manager approval, plus the weekly rhythm: standup, achievements, priorities, Friday review and a weekly leaderboard. Built to the Team OKR Tracker PRD v1.0 (28 Oct 2026, in the repo root).

- One Node.js process and one SQLite file. No third-party packages, so there is nothing to `npm install`.
- People sign in with email and password. The server decides what each role can see and change, as set out in PRD section 6.
- Changes show up for everyone without refreshing.

`demo.html` is the earlier clickable demo with made-up data, and `_supabase-version/` is an older attempt. Neither is used.

## Requirements

- Node.js 22.13 or later, or Docker.
- A subdomain (for example `okr.yourcompany.com`) and HTTPS in front of the app. An nginx example is in `deploy/nginx.conf`.

## Install with Docker

```sh
git clone https://github.com/Tech4mation/okr-tracker.git && cd okr-tracker/app
# edit docker-compose.yml: PUBLIC_URL and TZ
docker compose up -d --build
docker compose logs okr-tracker      # shows the link to create the CEO account
```

Data lives in the `okr-data` volume. The app listens on `127.0.0.1:3000`; put nginx in front for HTTPS.

## Install with plain Node (systemd)

```sh
sudo useradd --system --home /opt/okr-tracker --shell /usr/sbin/nologin okr
sudo git clone https://github.com/Tech4mation/okr-tracker.git /opt/okr-tracker
sudo mkdir -p /opt/okr-tracker/app/data && sudo chown -R okr:okr /opt/okr-tracker/app/data
sudo cp /opt/okr-tracker/app/deploy/okr-tracker.service /etc/systemd/system/
sudo nano /etc/systemd/system/okr-tracker.service   # set PUBLIC_URL and TZ
sudo systemctl daemon-reload && sudo systemctl enable --now okr-tracker
journalctl -u okr-tracker -n 20                      # shows the link to create the CEO account
```

pm2 works too: `PUBLIC_URL=... TRUST_PROXY=true pm2 start npm --name okr-tracker -- start`.

Then set up nginx from `deploy/nginx.conf`. The live-updates stream (`/api/events`) needs buffering turned off, as that file does.

## First run

1. On first start the server prints a one-time link: `https://okr.yourcompany.com/setup?token=…`. It's valid for 7 days. Open it and create the CEO account. Lost it? Run `npm run setup-link` (Docker: `docker compose exec okr-tracker node server.js setup-link`).
2. Everyone else goes to the site and chooses **Create an account**. They appear under **People → New sign-ins**, where the CEO links them to a role and team. Until then they see nothing.
3. Managers see everyone with the same team name, so keep team names consistent.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | none | The address people use, such as `https://okr.yourcompany.com`. It is used in setup and reset links, and an `https` address turns on secure cookies. |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to listen on. Docker sets `0.0.0.0`. |
| `DATA_DIR` | `./data` | Where the database file lives. |
| `TRUST_PROXY` | `false` | Set `true` behind nginx so sign-in rate limits see real client addresses. |
| `TZ` | server's | Timezone for weeks: Monday to Sunday, and which week an approval counts in. |
| `COOKIE_SECURE` | from `PUBLIC_URL` | Force secure cookies `true` or `false`. |

## Day to day

- **Forgotten password:** the CEO opens People and clicks **Reset link** next to the person, then sends them the link privately. It works once, within 24 hours. If the CEO is locked out, run `npm run reset-link -- ceo@yourcompany.com` on the server.
- **Backups:** run `npm run backup`. It writes a consistent copy to `data/backups/` and is safe while the app is running; on Docker, use `docker compose exec okr-tracker node server.js backup`. Copy the backups off the server. A nightly cron job is enough:
  `0 2 * * * cd /opt/okr-tracker/app && sudo -u okr node --disable-warning=ExperimentalWarning server.js backup`
- **Restore:**
  1. Stop the app.
  2. Replace `data/okr-tracker.db` with the backup.
  3. Delete any `okr-tracker.db-wal` and `okr-tracker.db-shm` files next to it.
  4. Start the app.
- **Update:** `git pull`, then `sudo systemctl restart okr-tracker` (Docker: `docker compose up -d --build`). The database schema upgrades itself on start.

## Security notes

- Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly cookie; the server stores only their hash, and they last 30 days from last use.
- Sign-in is limited to 10 attempts per address and email every 15 minutes.
- Anyone who can reach the site can create an account. It has no access until the CEO links it. The CEO can dismiss unknown sign-ups, which deletes the account.
- Every change is checked on the server against the PRD's permission table, including when someone calls the API directly. `test/api.test.js` covers this.
- The only outside request the page makes is to Google Fonts. To remove it, delete the fonts `<link>` in `public/index.html`; the page falls back to system fonts.

## Development

```sh
npm run dev     # restarts on file changes; open http://localhost:3000
npm test        # API tests against the PRD rules
```

| Path | What it is |
|---|---|
| `server.js` | Entry point and the setup-link, reset-link and backup commands |
| `src/app.js` | HTTP server: API routes, permission checks, live updates, static files |
| `src/db.js` | SQLite schema and migrations |
| `src/auth.js` | Passwords, sessions, one-time links, rate limiting |
| `public/rules.js` | Roles, visibility and permission rules, shared by the server and the page |
| `public/app.js`, `app.css`, `index.html` | The page |
