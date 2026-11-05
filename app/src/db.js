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
`];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const from = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = from; v < MIGRATIONS.length; v++) tx(db, () => { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); });
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
