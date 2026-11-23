// The platform: which organizations exist, and which organization each email address belongs to. Every
// organization keeps its own records, accounts, sessions, links and email log in its own database file:
//   data/platform.db              this file: organizations, email -> organization
//   data/orgs/<id>/okr.db         one organization's everything
//   data/orgs/<id>/files/         its attached documents
//   data/orgs/<id>/backups/       its backups
// Session cookies and one-time links carry the organization's id in front of the token ("<id>.<token>"), so a
// request is routed to one organization and its token is then checked against that organization's file only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {openDb, tx} from './db.js';
import {newToken, sha} from './auth.js';

const MIGRATIONS = [`
  CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL);
  CREATE TABLE emails (email TEXT PRIMARY KEY COLLATE NOCASE, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE);
  CREATE INDEX emails_org ON emails(org_id);
  CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`,
// Version 2 (TPD-1889): the platform's own owners, who set up organizations. Their accounts, sessions and links
// live here, apart from every organization's. An empty pass_hash means the owner has not chosen a password yet.
`
  CREATE TABLE owners (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  CREATE TABLE owner_sessions (token_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE owner_links (token_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  ALTER TABLE orgs ADD COLUMN last_at INTEGER;
`,
// Version 3 (TPD-1897): companies sign up themselves. A sign-up waits here, holding only a hash of the password,
// until its email address is confirmed; only then is the organization created.
`
  CREATE TABLE signups (token_hash TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
    pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE INDEX signups_email ON signups(email);
`];
export const SIGNUP_HOURS = 24;
const HOUR = 3600e3;
export const OWNER_SESSION_HOURS = 12;

const ORG_ID = /^[a-z0-9]{4,32}$/;
export const isOrgId = v => typeof v === 'string' && ORG_ID.test(v);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

// "<org>.<token>" -> {org, token}. A token from before organizations existed has no dot (base64url never does)
// and belongs to the organization that was there first.
export function splitToken(v, legacyOrg) {
  const s = String(v || ''), i = s.indexOf('.');
  if (i < 0) return {org: s ? legacyOrg || null : null, token: s};
  const org = s.slice(0, i);
  return {org: isOrgId(org) ? org : null, token: s.slice(i + 1)};
}

export function openPlatform(dataDir) {
  const db = openDb(path.join(dataDir, 'platform.db'), MIGRATIONS);
  const orgDir = id => { if (!isOrgId(id)) throw new Error(`"${id}" is not an organization id.`); return path.join(dataDir, 'orgs', id); };
  const meta = {
    get: k => db.prepare('SELECT v FROM meta WHERE k = ?').get(k)?.v ?? null,
    set: (k, v) => db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, String(v)),
  };
  const get = id => isOrgId(id) ? db.prepare('SELECT * FROM orgs WHERE id = ?').get(id) || null : null;
  const newId = () => { let id; do id = crypto.randomBytes(6).toString('hex'); while (get(id)); return id; };

  const P = {
    db, dataDir, orgDir, meta, get,
    dbFile: id => path.join(orgDir(id), 'okr.db'),
    filesDir: id => path.join(orgDir(id), 'files'),
    backupsDir: id => path.join(orgDir(id), 'backups'),
    list: () => db.prepare('SELECT * FROM orgs ORDER BY created_at, id').all(),
    legacyOrg: () => meta.get('legacy_org'),

    // A new, empty organization: its folder and its database, ready for its CEO.
    create(name, {id = newId(), createdAt = Date.now()} = {}) {
      name = String(name || '').trim();
      if (!name || name.length > 80) throw new Error('Give the organization a name of up to 80 characters.');
      openDb(P.dbFile(id)).close();
      db.prepare('INSERT INTO orgs (id, name, created_at) VALUES (?, ?, ?)').run(id, name, createdAt);
      return get(id);
    },

    // Which organization an email address belongs to, if any.
    orgOfEmail: em => db.prepare('SELECT org_id FROM emails WHERE email = ?').get(String(em || '').trim().toLowerCase())?.org_id || null,
    // Records the addresses an organization now holds (its people's and its accounts'), after every change.
    // Returns the addresses another organization already held, which this one does not get.
    syncEmails(orgId, emails) {
      const want = new Set([...emails].map(e => String(e || '').trim().toLowerCase()).filter(Boolean));
      const have = new Set(db.prepare('SELECT email FROM emails WHERE org_id = ?').all(orgId).map(r => r.email.toLowerCase()));
      const clash = [];
      tx(db, () => {
        const del = db.prepare('DELETE FROM emails WHERE email = ? AND org_id = ?'), ins = db.prepare('INSERT INTO emails (email, org_id) VALUES (?, ?) ON CONFLICT (email) DO NOTHING');
        for (const e of have) if (!want.has(e)) del.run(e, orgId);
        for (const e of want) if (!have.has(e) && !ins.run(e, orgId).changes) clash.push(e);
      });
      return clash;
    },

    rename: (id, name) => db.prepare('UPDATE orgs SET name = ? WHERE id = ?').run(String(name).slice(0, 80), id),
    setStatus: (id, status) => db.prepare('UPDATE orgs SET status = ? WHERE id = ?').run(status, id),
    // When someone in the organization last used it.
    touch: (id, at = Date.now()) => db.prepare('UPDATE orgs SET last_at = ? WHERE id = ?').run(at, id),

    // ---------- sign-ups waiting for their email to be confirmed ----------
    signups: {
      // Only the newest link for an address works.
      add({company, name, email, passHash}) {
        const token = newToken(), now = Date.now();
        tx(db, () => {
          db.prepare('DELETE FROM signups WHERE email = ?').run(email);
          db.prepare('INSERT INTO signups (token_hash, company, name, email, pass_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(sha(token), company, name, email, passHash, now, now + SIGNUP_HOURS * HOUR);
        });
        return token;
      },
      byToken: token => token ? db.prepare('SELECT * FROM signups WHERE token_hash = ? AND expires_at >= ?').get(sha(token), Date.now()) || null : null,
      done: email => db.prepare('DELETE FROM signups WHERE email = ?').run(email),
      prune: () => db.prepare('DELETE FROM signups WHERE expires_at < ?').run(Date.now()),
    },

    // ---------- the platform's owners: separate accounts, sessions and links ----------
    owners: {
      // A one-time link to choose a password, valid 24 hours. Makes the owner if they don't exist yet.
      link(email, name = '') {
        email = String(email || '').trim().toLowerCase();
        let o = db.prepare('SELECT * FROM owners WHERE email = ?').get(email);
        if (!o) { db.prepare('INSERT INTO owners (email, name, created_at) VALUES (?, ?, ?)').run(email, String(name || '').trim().slice(0, 80), Date.now()); o = db.prepare('SELECT * FROM owners WHERE email = ?').get(email); }
        else if (name) db.prepare('UPDATE owners SET name = ? WHERE id = ?').run(String(name).trim().slice(0, 80), o.id);
        db.prepare('DELETE FROM owner_links WHERE owner_id = ?').run(o.id);
        const token = newToken();
        db.prepare('INSERT INTO owner_links (token_hash, owner_id, expires_at) VALUES (?, ?, ?)').run(sha(token), o.id, Date.now() + 24 * HOUR);
        return {token, existed: !!o.pass_hash};
      },
      byLink: token => token ? db.prepare('SELECT o.* FROM owner_links l JOIN owners o ON o.id = l.owner_id WHERE l.token_hash = ? AND l.expires_at >= ?').get(sha(token), Date.now()) || null : null,
      // Sets the password, uses up the link and signs out every other session of that owner.
      setPassword(token, hash) {
        const o = P.owners.byLink(token);
        if (!o) return null;
        tx(db, () => {
          db.prepare('UPDATE owners SET pass_hash = ? WHERE id = ?').run(hash, o.id);
          db.prepare('DELETE FROM owner_links WHERE owner_id = ?').run(o.id);
          db.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').run(o.id);
        });
        return o;
      },
      byEmail: email => db.prepare("SELECT * FROM owners WHERE email = ? AND pass_hash <> ''").get(String(email || '').trim().toLowerCase()) || null,
      // Sessions last 12 hours from sign-in and are not extended.
      startSession(ownerId) {
        const token = newToken();
        db.prepare('INSERT INTO owner_sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)').run(sha(token), ownerId, Date.now() + OWNER_SESSION_HOURS * HOUR);
        return token;
      },
      bySession: token => token ? db.prepare('SELECT o.id, o.email, o.name FROM owner_sessions s JOIN owners o ON o.id = s.owner_id WHERE s.token_hash = ? AND s.expires_at >= ?').get(sha(token), Date.now()) || null : null,
      endSession: token => token && db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(sha(token)),
      prune() { const now = Date.now(); db.prepare('DELETE FROM owner_sessions WHERE expires_at < ?').run(now); db.prepare('DELETE FROM owner_links WHERE expires_at < ?').run(now); },
      list: () => db.prepare("SELECT email, name, pass_hash <> '' AS ready FROM owners ORDER BY created_at").all(),
    },

    // A consistent copy of this file, safe while the app runs.
    backup() {
      const file = path.join(dataDir, 'backups', `platform-${stamp()}.db`);
      fs.mkdirSync(path.dirname(file), {recursive: true});
      db.prepare('VACUUM INTO ?').run(file);
      return file;
    },
    close: () => db.close(),
  };
  return P;
}

// The single-company layout from before organizations (data/okr-tracker.db and data/files/) becomes the first
// organization, with every record, account and session intact. The old file is renamed, not deleted, so it can
// be put back by hand. Safe to run on every start: once moved, there is nothing left to move.
export function adoptLegacy(P, name) {
  const old = path.join(P.dataDir, 'okr-tracker.db');
  let id = P.legacyOrg();
  if (!fs.existsSync(old)) return id;
  if (!id) {
    const src = openDb(old);                       // brings it to the current schema first
    const first = src.prepare('SELECT MIN(created_at) AS t FROM users').get().t || Date.now();
    id = crypto.randomBytes(6).toString('hex');
    fs.mkdirSync(P.orgDir(id), {recursive: true});
    src.prepare('VACUUM INTO ?').run(P.dbFile(id));
    src.close();
    tx(P.db, () => {
      P.db.prepare('INSERT INTO orgs (id, name, created_at) VALUES (?, ?, ?)').run(id, String(name || '').trim().slice(0, 80) || 'My organization', first);
      P.meta.set('legacy_org', id);
    });
  }
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(old + ext)) fs.renameSync(old + ext, `${old}.moved-to-${id}${ext}`);
  const files = path.join(P.dataDir, 'files');
  if (fs.existsSync(files) && !fs.existsSync(P.filesDir(id))) fs.renameSync(files, P.filesDir(id));
  return id;
}
