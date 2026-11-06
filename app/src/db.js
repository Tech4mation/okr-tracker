// SQLite storage, using Node's built-in driver. One file holds everything; back it up by copying it (see README).
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Each entry is one schema version. Add new versions at the end; never edit a shipped one.
const MIGRATIONS = [`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE tokens (
    token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE people (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, team TEXT NOT NULL DEFAULT '',
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL);
  CREATE TABLE okrs (
    id INTEGER PRIMARY KEY, objective TEXT NOT NULL, owner_id INTEGER, year INTEGER NOT NULL,
    created_by INTEGER, created_at INTEGER NOT NULL);
  CREATE INDEX okrs_year ON okrs(year);
  CREATE TABLE krs (
    id INTEGER PRIMARY KEY, okr_id INTEGER NOT NULL REFERENCES okrs(id) ON DELETE CASCADE, n INTEGER NOT NULL, title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0, req INTEGER NOT NULL DEFAULT 0, req_at INTEGER, req_by INTEGER, ap_by INTEGER, ap_at INTEGER);
  CREATE INDEX krs_okr ON krs(okr_id);
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, week TEXT NOT NULL, delta REAL NOT NULL, okr_id INTEGER, at INTEGER NOT NULL);
  CREATE INDEX logs_week ON logs(week);
  CREATE TABLE stand (
    id INTEGER PRIMARY KEY, week TEXT NOT NULL, owner_id INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX stand_week ON stand(week);
  CREATE TABLE ach (
    id INTEGER PRIMARY KEY, week TEXT NOT NULL, owner_id INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX ach_week ON ach(week);
  CREATE TABLE prios (
    id INTEGER PRIMARY KEY, week TEXT NOT NULL, text TEXT NOT NULL, assignee_id INTEGER NOT NULL, by_id INTEGER NOT NULL,
    status TEXT NOT NULL, outcome TEXT, pct INTEGER, feedback TEXT NOT NULL DEFAULT '', reviewed INTEGER NOT NULL DEFAULT 0,
    reviewed_at INTEGER, reviewed_by INTEGER, at INTEGER NOT NULL);
  CREATE INDEX prios_week ON prios(week);
`,
// Version 2 (PRD v1.1): every record is a JSON document in one table, keyed by collection and id, so the
// server can hold the whole picture in memory and run the shared rules over it. Accounts stay in their own
// tables. Goals, standup entries and gains from version 1 are carried over; v1.0's weekly priorities and
// achievements have no place in v1.1 and are dropped.
db => {
  db.exec(`
    CREATE TABLE docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
    CREATE TABLE outbox (
      id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, to_name TEXT NOT NULL, to_email TEXT NOT NULL,
      subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER);
    CREATE INDEX outbox_status ON outbox(status, next_at);
    ALTER TABLE tokens ADD COLUMN person_id TEXT;
  `);
  const put = db.prepare('INSERT INTO docs (col, id, data) VALUES (?, ?, ?)');
  const day = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const people = db.prepare('SELECT p.*, u.email FROM people p LEFT JOIN users u ON u.id = p.user_id').all();
  const nameOf = new Map(people.map(p => [p.id, p.name]));
  people.forEach(p => put.run('people', 'p' + p.id, JSON.stringify({id: 'p' + p.id, name: p.name, email: p.email || '', role: p.role, sub: '', team: p.team || '', mgr: null,
    title: '', joined: day(p.created_at), jd: [], contract: '', notice: '', uid: p.user_id != null ? String(p.user_id) : null})));
  const krs = db.prepare('SELECT * FROM krs ORDER BY okr_id, n, id').all();
  db.prepare('SELECT * FROM okrs ORDER BY id').all().forEach(o => {
    const owner = o.owner_id == null ? 'Company' : nameOf.get(o.owner_id);
    if (!owner) return;
    put.run('okrs', 'o' + o.id, JSON.stringify({id: 'o' + o.id, objective: o.objective, owner, sub: '', year: o.year, updates: [],
      krs: krs.filter(k => k.okr_id === o.id).map(k => ({title: k.title, pct: k.done ? 100 : 0, req: !!k.req && !k.done, reqAt: k.req_at || 0,
        apBy: nameOf.get(k.ap_by) || '', apAt: k.ap_at || 0, type: 'binary', target: 0, unit: '', cur: 0}))}));
  });
  db.prepare('SELECT * FROM stand ORDER BY id').all().forEach(x => { const owner = nameOf.get(x.owner_id); if (!owner) return;
    put.run('stand', 's' + x.id, JSON.stringify({id: 's' + x.id, week: x.week, day: x.week, owner, text: x.text, status: x.status, n: null, unit: '', okr: '', kr: null, ts: x.at})); });
  db.prepare('SELECT * FROM logs ORDER BY id').all().forEach(x => { const owner = nameOf.get(x.owner_id); if (!owner) return;
    put.run('logs', 'l' + x.id, JSON.stringify({id: 'l' + x.id, owner, week: x.week, delta: x.delta, okr: x.okr_id ? 'o' + x.okr_id : '', ts: x.at})); });
  db.exec('DROP TABLE prios; DROP TABLE ach; DROP TABLE stand; DROP TABLE logs; DROP TABLE krs; DROP TABLE okrs; DROP TABLE people;');
},
];

export const SCHEMA_V1 = MIGRATIONS[0];   // for the upgrade test

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const from = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = from; v < MIGRATIONS.length; v++) tx(db, () => {
    const m = MIGRATIONS[v];
    if (typeof m === 'function') m(db); else db.exec(m);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  });
  return db;
}

// ---------- the document store ----------
// Loads every collection into the state object, in the order rows were first written.
export function loadDocs(db, S, cols) {
  cols.forEach(c => { S[c] = []; });
  for (const r of db.prepare('SELECT col, data FROM docs ORDER BY rowid').iterate()) {
    if (r.col === 'cfg') Object.assign(S.cfg, JSON.parse(r.data));
    else if (S[r.col]) S[r.col].push(JSON.parse(r.data));
  }
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
