// Passwords, sessions and one-time links (CEO setup, password reset). Built on node:crypto only.
import crypto from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const DAY = 864e5;
export const SESSION_DAYS = 30;
export const COOKIE = 'okr_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, SCRYPT);
  return crypto.timingSafeEqual(got, want);
}
// Spends the same time as a real check, so a missing account can't be told apart by timing.
export const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const newToken = () => crypto.randomBytes(32).toString('base64url');
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---------- sessions (only a hash of the token is stored) ----------
export function createSession(db, userId) {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + SESSION_DAYS * DAY);
  return token;
}
export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT s.expires_at, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(token));
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); return null; }
  // Sliding expiry: anyone who uses the app at least once a fortnight stays signed in.
  if (row.expires_at - now < (SESSION_DAYS / 2) * DAY) db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + SESSION_DAYS * DAY, sha(token));
  return {id: row.id, email: row.email, name: row.name};
}
export const endSession = (db, token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
export const endAllSessions = (db, userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
export const pruneExpired = db => {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(now);
};

export function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function sessionCookie(token, secure) {
  const base = `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return token ? `${base}; Max-Age=${SESSION_DAYS * 86400}` : `${base}; Max-Age=0`;
}

// ---------- one-time links ----------
export function createLinkToken(db, kind, userId, days) {
  const token = newToken();
  db.prepare('INSERT INTO tokens (token_hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)').run(sha(token), kind, userId ?? null, Date.now() + days * DAY);
  return token;
}
export function findLinkToken(db, kind, token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?').get(sha(token), kind);
  return row && row.expires_at >= Date.now() ? row : null;
}
export const useLinkToken = (db, token) => db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(sha(token));

// ---------- brute-force protection: at most `max` attempts per key in the window ----------
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now(), h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, {n: 1, reset: now + windowMs}); if (hits.size > 10000) hits.clear(); return true; }
    h.n++;
    return h.n <= max;
  };
}
