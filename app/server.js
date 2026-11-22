// Team OKR Tracker server.
//   npm start                     start the server
//   npm run setup-link            print a link to create the CEO account (only while there is no CEO)
//   npm run reset-link -- <email> print a password-reset link for that account
//   npm run backup [-- <file>]    write a consistent copy of the database (default: data/backups/)
// Settings come from environment variables; see README.md.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb} from './src/db.js';
import {createApp, setupLink, resetLink} from './src/app.js';
import {createSmtpTransport} from './src/smtp.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT) || 3000;
const HOST = env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');
const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
const BASE = PUBLIC_URL || `http://localhost:${PORT}`;

const db = openDb(path.join(DATA_DIR, 'okr-tracker.db'));
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'setup-link') {
  const link = setupLink(db, BASE);
  console.log(link ? `Open this link to create the CEO account (valid 7 days):\n${link}` : 'The CEO account already exists. Use "npm run reset-link -- <email>" if the CEO needs a new password.');
  process.exit(0);
}
if (cmd === 'reset-link') {
  const u = arg && db.prepare('SELECT id FROM users WHERE email = ?').get(arg.trim().toLowerCase());
  if (!u) { console.error(`No account with the email "${arg || ''}".`); process.exit(1); }
  console.log(`Password reset link for ${arg} (valid 24 hours):\n${resetLink(db, BASE, u.id)}`);
  process.exit(0);
}
if (cmd === 'backup') {
  // A consistent copy, safe to take while the server is running.
  const file = path.resolve(arg || path.join(DATA_DIR, 'backups', `okr-tracker-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.db`));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  if (fs.existsSync(file)) { console.error(`${file} already exists. Choose another file name.`); process.exit(1); }
  db.prepare('VACUUM INTO ?').run(file);
  console.log(`Backup written to ${file}`);
  process.exit(0);
}
if (cmd) { console.error(`Unknown command "${cmd}". Use setup-link, reset-link <email> or backup [file].`); process.exit(1); }

// Email (PRD section 13). Without SMTP_HOST and MAIL_FROM the app still runs; alerts stay in the app and the
// outbox records that email is not set up.
const transport = createSmtpTransport({
  host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || (env.SMTP_SECURE === 'true' ? 465 : 587), secure: env.SMTP_SECURE === 'true',
  user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.MAIL_FROM, rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
});

const server = createApp({
  db,
  publicUrl: PUBLIC_URL,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : PUBLIC_URL.startsWith('https://'),
  trustProxy: env.TRUST_PROXY === 'true',
  filesDir: path.join(DATA_DIR, 'files'),
  transport,
});
server.listen(PORT, HOST, () => {
  console.log(`Team OKR Tracker listening on http://${HOST}:${PORT} (data in ${DATA_DIR})`);
  console.log(transport ? `Email goes out through ${transport.describe} as ${transport.from}.` : 'Email is not set up (no SMTP_HOST / MAIL_FROM). Alerts stay in the app.');
  const link = setupLink(db, BASE);
  if (link) console.log(`No CEO account yet. Open this link to create it (valid 7 days):\n${link}`);
});
const stop = () => { server.close(() => { db.close(); process.exit(0); }); server.closeAllConnections(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
