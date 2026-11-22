// Team OKR Tracker server: one platform, any number of organizations, each with its own data.
//   npm start                              start the server
//   npm run orgs                           list the organizations
//   npm run org-create -- "<name>"         add an empty organization and print its CEO setup link
//   npm run setup-link [-- <org-id>]       print a link to create an organization's CEO account (only while it has none)
//   npm run reset-link -- <email>          print a password-reset link for that account
//   npm run backup                         write a consistent copy of every organization's database, and the platform's
// Settings come from environment variables; see README.md.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb} from './src/db.js';
import {openPlatform, adoptLegacy} from './src/platform.js';
import {createApp} from './src/app.js';
import {createOrg} from './src/org.js';
import {createSmtpTransport} from './src/smtp.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT) || 3000;
const HOST = env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');
const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
const BASE = PUBLIC_URL || `http://localhost:${PORT}`;
const FIRST_ORG_NAME = env.FIRST_ORG_NAME || '';
const [cmd, ...args] = process.argv.slice(2);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

if (cmd) {
  const P = openPlatform(DATA_DIR);
  adoptLegacy(P, FIRST_ORG_NAME);
  const orgs = P.list();
  const die = msg => { console.error(msg); process.exit(1); };
  // An organization's runtime for one command: its database, its rules, no web server.
  const open = row => createOrg({id: row.id, db: openDb(P.dbFile(row.id)), log: {error() {}},
    registry: {elsewhere: em => { const o = P.orgOfEmail(em); return !!o && o !== row.id; }, sync: list => P.syncEmails(row.id, list)}});
  const pick = id => {
    if (id) return P.get(id) || die(`No organization with the id "${id}". Run "npm run orgs" to list them.`);
    if (orgs.length === 1) return orgs[0];
    die(`There are ${orgs.length} organizations. Name one: npm run setup-link -- <org-id>. Run "npm run orgs" to list them.`);
  };

  if (cmd === 'orgs') {
    if (!orgs.length) console.log('No organizations yet. Add one with: npm run org-create -- "<name>"');
    for (const r of orgs) {
      const o = open(r), people = o.S.people.length, ceo = o.S.people.find(p => p.role === 'ceo');
      console.log(`${r.id}  ${r.name}  (${r.status}; ${people} ${people === 1 ? 'person' : 'people'}; CEO ${ceo ? ceo.name : 'not set up yet'}; since ${new Date(r.created_at).toISOString().slice(0, 10)})`);
      o.close();
    }
  } else if (cmd === 'org-create') {
    const name = args.join(' ').trim() || die('Give the organization a name: npm run org-create -- "Acme Ltd"');
    if (orgs.some(r => r.name.toLowerCase() === name.toLowerCase())) die(`There is already an organization called ${name}.`);
    const row = P.create(name), o = open(row);
    console.log(`Created ${row.name} (${row.id}). Send its CEO this link to create their account (valid 7 days):\n${o.setupLink(BASE)}`);
    o.close();
  } else if (cmd === 'setup-link') {
    const row = pick(args[0]), o = open(row), link = o.setupLink(BASE);
    console.log(link ? `Open this link to create the CEO account for ${row.name} (valid 7 days):\n${link}` : `${row.name} already has its CEO account. Use "npm run reset-link -- <email>" if the CEO needs a new password.`);
    o.close();
  } else if (cmd === 'reset-link') {
    const em = (args[0] || '').trim().toLowerCase(), row = P.get(P.orgOfEmail(em));
    const o = row && open(row), u = o && o.login(em);
    if (!u) die(`No account with the email "${args[0] || ''}".`);
    console.log(`Password reset link for ${em} in ${row.name} (valid 24 hours):\n${o.resetLink(BASE, u.id)}`);
    o.close();
  } else if (cmd === 'backup') {
    // Consistent copies, safe to take while the server is running: each organization's into its own backups folder.
    for (const r of orgs) {
      const file = path.join(P.backupsDir(r.id), `okr-${stamp()}.db`), db = openDb(P.dbFile(r.id));
      fs.mkdirSync(path.dirname(file), {recursive: true});
      db.prepare('VACUUM INTO ?').run(file); db.close();
      console.log(`${r.name}: ${file}`);
    }
    console.log(`Platform: ${P.backup()}`);
  } else die(`Unknown command "${cmd}". Use orgs, org-create <name>, setup-link [org-id], reset-link <email> or backup.`);
  P.close();
  process.exit(0);
}

// Email (PRD section 13). Without SMTP_HOST and MAIL_FROM the app still runs; alerts stay in the app and the
// outbox records that email is not set up.
const transport = createSmtpTransport({
  host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || (env.SMTP_SECURE === 'true' ? 465 : 587), secure: env.SMTP_SECURE === 'true',
  user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.MAIL_FROM, rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
});

const server = createApp({
  dataDir: DATA_DIR,
  publicUrl: PUBLIC_URL,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : PUBLIC_URL.startsWith('https://'),
  trustProxy: env.TRUST_PROXY === 'true',
  transport,
  firstOrgName: FIRST_ORG_NAME,
});
server.listen(PORT, HOST, () => {
  const {orgs} = server.okr;
  console.log(`Team OKR Tracker listening on http://${HOST}:${PORT} (data in ${DATA_DIR}; ${orgs.size} ${orgs.size === 1 ? 'organization' : 'organizations'})`);
  console.log(transport ? `Email goes out through ${transport.describe} as ${transport.from}.` : 'Email is not set up (no SMTP_HOST / MAIL_FROM). Alerts stay in the app.');
  // A fresh install: the one organization there is waits for its CEO.
  if (orgs.size === 1) {
    const [o] = orgs.values(), link = o.setupLink(BASE);
    if (link) console.log(`No CEO account yet. Open this link to create it (valid 7 days):\n${link}`);
  }
});
const stop = () => { server.close(() => { server.okr.close(); process.exit(0); }); server.closeAllConnections(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
