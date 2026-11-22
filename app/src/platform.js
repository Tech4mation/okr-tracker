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

const MIGRATIONS = [`
  CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL);
  CREATE TABLE emails (email TEXT PRIMARY KEY COLLATE NOCASE, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE);
  CREATE INDEX emails_org ON emails(org_id);
  CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`];

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
