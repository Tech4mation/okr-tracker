// The HTTP app: JSON API, live-update stream and the page's static files.
// Every permission from PRD section 6 is checked here; the page's own checks only decide which controls to show.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as R from '../public/rules.js';
import * as A from './auth.js';
import {tx} from './db.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = {'/app.js': 'text/javascript', '/app.css': 'text/css', '/rules.js': 'text/javascript', '/favicon.svg': 'image/svg+xml'};
const PAGE_PATHS = new Set(['/', '/index.html', '/setup', '/reset']);
const MAX_BODY = 64 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const now = () => Date.now();
function text(v, max, label, required = true) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) fail(400, `${label} is required.`);
  if (s.length > max) fail(400, `${label} is too long. Keep it under ${max} characters.`);
  return s;
}
const intId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const week = v => R.isWeek(v) ? v : fail(400, 'That week isn\'t valid.');

// ---------- reading data ----------
const allPeople = db => db.prepare('SELECT p.id, p.name, p.role, p.team, p.user_id, u.email FROM people p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.name COLLATE NOCASE').all();
const personOut = (p, full) => p && ({id: p.id, name: p.name, role: p.role, team: p.team, ...(full ? {email: p.email || null, hasAccount: p.user_id != null} : {})});
const krOut = k => ({id: k.id, n: k.n, title: k.title, done: !!k.done, req: !!k.req, reqAt: k.req_at, reqBy: k.req_by, apBy: k.ap_by, apAt: k.ap_at});
function okrsWhere(db, where, arg) {
  const okrs = db.prepare(`SELECT * FROM okrs WHERE ${where} ORDER BY created_at, id`).all(arg);
  const map = new Map(okrs.map(o => [o.id, {id: o.id, objective: o.objective, owner: o.owner_id ?? 'company', year: o.year, krs: []}]));
  if (okrs.length) db.prepare(`SELECT k.* FROM krs k JOIN okrs o ON o.id = k.okr_id WHERE o.${where} ORDER BY k.n, k.id`).all(arg).forEach(k => map.get(k.okr_id)?.krs.push(krOut(k)));
  return [...map.values()];
}
const okrsForYear = (db, year) => okrsWhere(db, 'year = ?', year);
const okrById = (db, id) => okrsWhere(db, 'id = ?', id)[0] || fail(404, 'That OKR no longer exists.');
const prioOut = p => ({id: p.id, week: p.week, text: p.text, assignee: p.assignee_id, by: p.by_id, status: p.status, outcome: p.outcome, pct: p.pct, feedback: p.feedback, reviewed: !!p.reviewed, at: p.at});
const signupsOut = db => db.prepare('SELECT u.id, u.name, u.email, u.created_at AS at FROM users u LEFT JOIN people p ON p.user_id = u.id WHERE p.id IS NULL ORDER BY u.created_at').all();
const needsSetup = db => !db.prepare("SELECT 1 FROM people WHERE role = 'ceo' AND user_id IS NOT NULL").get();

// ---------- one-time links ----------
export function setupLink(db, baseUrl) {
  if (!needsSetup(db)) return null;
  db.prepare("DELETE FROM tokens WHERE kind = 'setup'").run();
  return `${baseUrl}/setup?token=${A.createLinkToken(db, 'setup', null, 7)}`;
}
export function resetLink(db, baseUrl, userId) {
  db.prepare("DELETE FROM tokens WHERE kind = 'reset' AND user_id = ?").run(userId);
  return `${baseUrl}/reset?token=${A.createLinkToken(db, 'reset', userId, 1)}`;
}

export function createApp({db, publicUrl = '', cookieSecure = false, trustProxy = false, log = console}) {
  const clients = new Set();
  const loginLimit = A.rateLimiter(10, 15 * 60e3), signupLimit = A.rateLimiter(20, 60 * 60e3);
  const broadcast = () => { for (const res of clients) res.write('data: change\n\n'); };
  const ip = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const baseUrl = req => publicUrl || `${trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
  const startSession = (res, userId) => res.setHeader('Set-Cookie', A.sessionCookie(A.createSession(db, userId), cookieSecure));
  setInterval(() => A.pruneExpired(db), 6 * 3600e3).unref();
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3).unref();

  // Who is asking. A CEO can preview the app as someone else (US-1.3); everything they do is then done as that person.
  function who(req) {
    const account = A.sessionUser(db, A.readCookie(req));
    if (!account) return {account: null};
    const people = allPeople(db);
    const real = people.find(p => p.user_id === account.id) || null;
    let e = real;
    const va = intId(req.headers['x-view-as']);
    if (real && real.role === 'ceo' && va && va !== real.id) e = people.find(p => p.id === va) || real;
    return {account, people, real, e};
  }
  const member = c => {
    if (!c.account) fail(401, 'Sign in to continue.');
    if (!c.real) fail(403, 'Your account isn\'t set up yet. The CEO needs to add you first.');
    return c.e;
  };
  const writer = c => { const e = member(c); if (R.readOnly(e)) fail(403, 'HR access is read-only.'); return e; };
  const ceo = c => { const e = writer(c); if (e.role !== 'ceo') fail(403, 'Only the CEO can manage people and roles.'); return e; };
  const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || fail(404, 'That entry no longer exists.');
  const nameTaken = (name, exceptId) => !!db.prepare('SELECT 1 FROM people WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name, exceptId ?? null);
  const role = v => R.ROLES[v] ? v : fail(400, 'Choose a role: CEO, HR, Manager or Member.');

  // BR-8: an approval adds this key result's share of the owner's annual progress to this week's gain; reopening takes it back.
  function logGain(o, sign) {
    if (o.owner === 'company') return;
    const n = db.prepare('SELECT COUNT(*) AS n FROM okrs WHERE owner_id = ? AND year = ?').get(o.owner, o.year).n || 1;
    db.prepare('INSERT INTO logs (owner_id, week, delta, okr_id, at) VALUES (?, ?, ?, ?, ?)').run(o.owner, R.curWeek(), sign * R.krWeight(o) / n, o.id, now());
  }
  const approveKr = (o, kr, by) => tx(db, () => {
    if (db.prepare('UPDATE krs SET done = 1, req = 0, ap_by = ?, ap_at = ? WHERE id = ? AND done = 0').run(by.id, now(), kr.id).changes) logGain(o, 1);
  });
  const reopenKr = (o, kr) => tx(db, () => {
    if (db.prepare('UPDATE krs SET done = 0, req = 0, req_at = NULL, req_by = NULL, ap_by = NULL, ap_at = NULL WHERE id = ? AND done = 1').run(kr.id).changes) logGain(o, -1);
  });
  const krWithOkr = id => { const k = row('krs', id); const o = okrById(db, k.okr_id); return {o, kr: o.krs.find(x => x.id === k.id)}; };

  // ---------- routes ----------
  const routes = [
    // account
    ['POST', /^\/api\/setup$/, async (c, b, req, res) => {
      const t = A.findLinkToken(db, 'setup', b.token);
      if (!t || !needsSetup(db)) fail(400, 'This setup link has expired or was already used. Run "npm run setup-link" on the server for a new one.');
      const name = text(b.name, 80, 'Your name'), email = text(b.email, 200, 'Email').toLowerCase(), team = text(b.team, 60, 'Team', false);
      if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
      if (String(b.password || '').length < 8) fail(400, 'Use a password of at least 8 characters.');
      // Someone who already signed up with this email can claim the CEO account by entering that account's password.
      const existing = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
      if (existing && !(await A.checkPassword(String(b.password), existing.pass_hash)))
        fail(409, 'An account with this email already exists. Enter that account\'s password to make it the CEO account.');
      const hash = existing ? null : await A.hashPassword(b.password);
      const uid = tx(db, () => {
        const u = existing ? existing.id : Number(db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(email, name, hash, now()).lastInsertRowid);
        if (!db.prepare("UPDATE people SET role = 'ceo' WHERE user_id = ?").run(u).changes)
          db.prepare("INSERT INTO people (name, role, team, user_id, created_at) VALUES (?, 'ceo', ?, ?, ?)").run(name, team, u, now());
        db.prepare("DELETE FROM tokens WHERE kind = 'setup'").run();
        return u;
      });
      startSession(res, uid);
    }],
    ['POST', /^\/api\/signup$/, async (c, b, req, res) => {
      if (!signupLimit(ip(req))) fail(429, 'Too many sign-ups from this network. Try again in an hour.');
      const name = text(b.name, 80, 'Your name'), email = text(b.email, 200, 'Email').toLowerCase();
      if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
      if (String(b.password || '').length < 8) fail(400, 'Use a password of at least 8 characters.');
      if (String(b.password).length > 200) fail(400, 'That password is too long.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'An account with this email already exists. Sign in instead.');
      const hash = await A.hashPassword(b.password);
      const uid = Number(db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(email, name, hash, now()).lastInsertRowid);
      startSession(res, uid);
    }],
    ['POST', /^\/api\/login$/, async (c, b, req, res) => {
      const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
      if (!loginLimit(ip(req) + '|' + email)) fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
      const u = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
      const ok = await A.checkPassword(password, u ? u.pass_hash : A.DUMMY_HASH);
      if (!u || !ok) fail(401, 'That email and password don\'t match.');
      startSession(res, u.id);
    }],
    ['POST', /^\/api\/logout$/, (c, b, req, res) => {
      A.endSession(db, A.readCookie(req));
      res.setHeader('Set-Cookie', A.sessionCookie(null, cookieSecure));
    }],
    ['POST', /^\/api\/reset$/, async (c, b, req, res) => {
      const t = A.findLinkToken(db, 'reset', b.token);
      if (!t) fail(400, 'This reset link has expired or was already used. Ask the CEO for a new one.');
      if (String(b.password || '').length < 8) fail(400, 'Use a password of at least 8 characters.');
      const hash = await A.hashPassword(b.password);
      tx(db, () => { db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash, t.user_id); A.useLinkToken(db, b.token); A.endAllSessions(db, t.user_id); });
      startSession(res, t.user_id);
    }],

    // everything the page shows, already filtered to what this person may see
    ['GET', /^\/api\/state$/, (c, b, req, res, m, q) => {
      if (!c.account) fail(401, 'Sign in to continue.', {needsSetup: needsSetup(db)});
      if (!c.real) return {account: {name: c.account.name, email: c.account.email}, me: null};
      const {people, real, e} = c, wk = R.isWeek(q.get('week')) ? q.get('week') : R.curWeek(), year = new Date().getFullYear();
      const scope = R.scopeIds(e, people), full = R.isAll(e);
      const okrsAll = okrsForYear(db, year);
      const byWeek = t => db.prepare(`SELECT * FROM ${t} WHERE week = ? ORDER BY at, id`).all(wk);
      const priosAll = byWeek('prios').map(prioOut), logs = byWeek('logs');
      const board = R.boardIds(e, people).map(id => {
        const rv = priosAll.filter(p => p.assignee === id && p.reviewed);
        return {id, annual: R.avgPct(okrsAll.filter(o => o.owner === id)), gain: logs.filter(l => l.owner_id === id).reduce((s, l) => s + l.delta, 0),
          reviewed: rv.length, reviewAvg: rv.length ? rv.reduce((s, p) => s + (p.pct || 0), 0) / rv.length : 0};
      });
      return {
        week: wk, year, account: {name: c.account.name, email: c.account.email},
        real: personOut(real, true), me: personOut(e, full), people: people.map(p => personOut(p, full)),
        signups: e.role === 'ceo' ? signupsOut(db) : [],
        okrs: okrsAll.filter(o => o.owner === 'company' || scope.has(o.owner)),
        stand: byWeek('stand').filter(x => scope.has(x.owner_id)).map(x => ({id: x.id, owner: x.owner_id, text: x.text, status: x.status, at: x.at})),
        ach: byWeek('ach').filter(x => scope.has(x.owner_id)).map(x => ({id: x.id, owner: x.owner_id, text: x.text, at: x.at})),
        prios: priosAll.filter(p => scope.has(p.assignee) || p.by === e.id),
        board,
      };
    }],

    // OKRs and key results
    ['POST', /^\/api\/okrs$/, c => {
      const e = writer(c), objective = text(c.body.objective, 200, 'The objective');
      const titles = (Array.isArray(c.body.krs) ? c.body.krs : []).map(t => typeof t === 'string' ? t.trim() : '').filter(Boolean);
      if (titles.length < R.KR_MIN) fail(400, 'Add at least 2 key results.');
      if (titles.length > R.KR_MAX) fail(400, 'An OKR can have at most 20 key results.');
      if (titles.some(t => t.length > 200)) fail(400, 'Keep each key result under 200 characters.');
      const owner = c.body.owner === 'company' ? 'company' : intId(c.body.owner);
      if (!R.ownerChoices(e, c.people, true).includes(owner)) fail(403, 'You can\'t create an OKR for that person.');
      tx(db, () => {
        const id = Number(db.prepare('INSERT INTO okrs (objective, owner_id, year, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(objective, owner === 'company' ? null : owner, new Date().getFullYear(), e.id, now()).lastInsertRowid);
        const ins = db.prepare('INSERT INTO krs (okr_id, n, title) VALUES (?, ?, ?)');
        titles.forEach((t, i) => ins.run(id, i, t));
      });
    }],
    ['DELETE', /^\/api\/okrs\/(\d+)$/, (c, b, req, res, m) => {
      const e = writer(c), o = okrById(db, +m[1]);
      if (!R.canDeleteOkr(e, o)) fail(403, 'Only the owner or the CEO can delete this OKR.');
      db.prepare('DELETE FROM okrs WHERE id = ?').run(o.id);
    }],
    ['POST', /^\/api\/krs\/(\d+)\/status$/, (c, b, req, res, m) => {
      const e = writer(c), {o, kr} = krWithOkr(+m[1]);
      if (b.done === true) {
        if (R.canDirect(e, o)) return void approveKr(o, kr, e);
        if (!R.canRequest(e, o)) fail(403, 'You can\'t change this key result.');
        if (kr.done) fail(409, 'This key result is already approved.');
        if (!kr.req) db.prepare('UPDATE krs SET req = 1, req_at = ?, req_by = ? WHERE id = ?').run(now(), e.id, kr.id);
        return;
      }
      if (kr.done) { if (!R.canReopen(e)) fail(403, 'Only the CEO can reopen an approved key result.'); return void reopenKr(o, kr); }
      if (!R.canRequest(e, o) && !R.canDirect(e, o)) fail(403, 'You can\'t change this key result.');
      db.prepare('UPDATE krs SET req = 0, req_at = NULL, req_by = NULL WHERE id = ?').run(kr.id);
    }],
    ['POST', /^\/api\/krs\/(\d+)\/(approve|send-back)$/, (c, b, req, res, m) => {
      const e = writer(c), {o, kr} = krWithOkr(+m[1]);
      if (!kr.req || kr.done) fail(409, 'This request was already handled.');
      if (!R.canApprove(e, c.people.find(p => p.id === o.owner))) fail(403, 'You can\'t approve this person\'s key results.');
      if (m[2] === 'approve') approveKr(o, kr, e);
      else db.prepare('UPDATE krs SET req = 0, req_at = NULL, req_by = NULL WHERE id = ?').run(kr.id);
    }],

    // standup and achievements
    ['POST', /^\/api\/(stand|ach)$/, (c, b, req, res, m) => {
      const e = writer(c), wk = week(b.week), body = text(b.text, 300, m[1] === 'stand' ? 'The activity' : 'The achievement');
      if (m[1] === 'stand') db.prepare("INSERT INTO stand (week, owner_id, text, status, at) VALUES (?, ?, ?, 'Not done', ?)").run(wk, e.id, body, now());
      else db.prepare('INSERT INTO ach (week, owner_id, text, at) VALUES (?, ?, ?, ?)').run(wk, e.id, body, now());
    }],
    ['PATCH', /^\/api\/stand\/(\d+)$/, (c, b, req, res, m) => {
      const e = writer(c), x = row('stand', +m[1]);
      if (!R.canEditEntry(e, x.owner_id)) fail(403, 'You can only change your own activities.');
      if (!R.SSTAT.includes(b.status)) fail(400, 'Choose Not done, In progress or Done.');
      db.prepare('UPDATE stand SET status = ? WHERE id = ?').run(b.status, x.id);
    }],
    ['DELETE', /^\/api\/(stand|ach)\/(\d+)$/, (c, b, req, res, m) => {
      const e = writer(c), x = row(m[1], +m[2]);
      if (!R.canEditEntry(e, x.owner_id)) fail(403, 'You can only delete your own entries.');
      db.prepare(`DELETE FROM ${m[1]} WHERE id = ?`).run(x.id);
    }],

    // priorities and Friday review
    ['POST', /^\/api\/prios$/, c => {
      const e = writer(c), wk = week(c.body.week), body = text(c.body.text, 300, 'The priority'), assignee = intId(c.body.assignee);
      if (!R.ownerChoices(e, c.people, false).includes(assignee)) fail(403, 'You can\'t assign a priority to that person.');
      db.prepare("INSERT INTO prios (week, text, assignee_id, by_id, status, at) VALUES (?, ?, ?, ?, 'Agreed', ?)").run(wk, body, assignee, e.id, now());
    }],
    ['PATCH', /^\/api\/prios\/(\d+)$/, (c, b, req, res, m) => {
      const e = writer(c), p = prioOut(row('prios', +m[1]));
      if (!R.canEditPrio(e, p)) fail(403, 'Only the owner, the person who assigned it or the CEO can change this priority.');
      if (!R.PSTAT.includes(b.status)) fail(400, 'Choose Agreed, In progress, Done or Blocked.');
      db.prepare('UPDATE prios SET status = ? WHERE id = ?').run(b.status, p.id);
    }],
    ['DELETE', /^\/api\/prios\/(\d+)$/, (c, b, req, res, m) => {
      const e = writer(c), p = prioOut(row('prios', +m[1]));
      if (!R.canEditPrio(e, p)) fail(403, 'Only the owner, the person who assigned it or the CEO can delete this priority.');
      db.prepare('DELETE FROM prios WHERE id = ?').run(p.id);
    }],
    ['POST', /^\/api\/prios\/(\d+)\/review$/, (c, b, req, res, m) => {
      const e = writer(c), p = prioOut(row('prios', +m[1]));
      if (!R.canReview(e, p)) fail(403, 'Only the owner or the CEO can review this priority.');
      const pct = Number(b.pct), feedback = text(b.feedback, 1000, 'Feedback', false);
      // BR-10: a review needs an outcome, a percentage and written feedback.
      if (!R.OUTCOMES.includes(b.outcome) || b.pct === '' || b.pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100 || !feedback)
        fail(400, 'Add an outcome, a percentage from 0 to 100 and written feedback before saving.');
      db.prepare('UPDATE prios SET outcome = ?, pct = ?, feedback = ?, reviewed = 1, reviewed_at = ?, reviewed_by = ? WHERE id = ?').run(b.outcome, Math.round(pct), feedback, now(), e.id, p.id);
    }],

    // people administration (CEO)
    ['POST', /^\/api\/people$/, c => {
      ceo(c);
      const name = text(c.body.name, 80, 'Name'), r = role(c.body.role), team = text(c.body.team, 60, 'Team', false);
      if (nameTaken(name)) fail(409, `Someone called ${name} is already listed. Add a last name or initial to tell them apart.`);
      db.prepare('INSERT INTO people (name, role, team, created_at) VALUES (?, ?, ?, ?)').run(name, r, team, now());
    }],
    ['PATCH', /^\/api\/people\/(\d+)$/, (c, b, req, res, m) => {
      ceo(c);
      const p = row('people', +m[1]), r = role(b.role), team = text(b.team, 60, 'Team', false);
      if (p.id === c.real.id && r !== 'ceo') fail(400, 'You can\'t change your own role. Ask another CEO to do it.');
      db.prepare('UPDATE people SET role = ?, team = ? WHERE id = ?').run(r, team, p.id);
    }],
    ['DELETE', /^\/api\/people\/(\d+)$/, (c, b, req, res, m) => {
      ceo(c);
      const p = row('people', +m[1]);
      if (p.id === c.real.id) fail(400, 'You can\'t remove yourself.');
      db.prepare('DELETE FROM people WHERE id = ?').run(p.id);
    }],
    ['POST', /^\/api\/people\/(\d+)\/reset-link$/, (c, b, req, res, m) => {
      ceo(c);
      const p = row('people', +m[1]);
      if (!p.user_id) fail(400, `${p.name} hasn't created an account yet, so there's no password to reset.`);
      return {url: resetLink(db, baseUrl(req), p.user_id)};
    }],
    ['POST', /^\/api\/signups\/(\d+)\/link$/, (c, b, req, res, m) => {
      ceo(c);
      const u = row('users', +m[1]);
      if (db.prepare('SELECT 1 FROM people WHERE user_id = ?').get(u.id)) fail(409, 'This account is already linked to someone.');
      const r = role(b.role), team = text(b.team, 60, 'Team', false), pid = intId(b.person);
      if (pid) {
        const p = row('people', pid);
        if (p.user_id) fail(409, `${p.name} already has an account linked.`);
        db.prepare('UPDATE people SET user_id = ?, role = ?, team = ? WHERE id = ?').run(u.id, r, team, p.id);
      } else {
        const name = text(b.name, 80, 'Name');
        if (nameTaken(name)) fail(409, `Someone called ${name} is already listed. Link to them instead, or use a different name.`);
        db.prepare('INSERT INTO people (name, role, team, user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(name, r, team, u.id, now());
      }
    }],
    ['DELETE', /^\/api\/signups\/(\d+)$/, (c, b, req, res, m) => {
      ceo(c);
      const u = row('users', +m[1]);
      if (db.prepare('SELECT 1 FROM people WHERE user_id = ?').get(u.id)) fail(409, 'This account is linked to a person. Remove the person first.');
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }],
  ];

  // ---------- plumbing ----------
  function send(res, status, body, headers = {}) {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {ok: true});
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
    res.end(data);
  }
  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', ch => { size += ch.length; if (size > MAX_BODY) { reject(new HttpError(413, 'That request is too large.')); req.destroy(); } else chunks.push(ch); });
    req.on('end', () => {
      if (!size) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); }
      catch { reject(new HttpError(400, 'The request wasn\'t valid JSON.')); }
    });
    req.on('error', reject);
  });
  const SECURITY = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  function serveStatic(req, res, pathname) {
    const file = PAGE_PATHS.has(pathname) ? 'index.html' : STATIC[pathname] ? pathname.slice(1) : null;
    if (!file) return send(res, 404, 'Not found', {'Content-Type': 'text/plain; charset=utf-8', ...SECURITY});
    fs.readFile(path.join(PUBLIC, file), (err, data) => {
      if (err) return send(res, 500, 'Could not read the page.', {'Content-Type': 'text/plain; charset=utf-8'});
      send(res, 200, data, {'Content-Type': (STATIC[pathname] || 'text/html') + '; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY});
    });
  }
  function events(req, res, c) {
    if (!c.account) return send(res, 401, {error: 'Sign in to continue.'});
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), pathname = url.pathname;
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'Method not allowed.'});
        return serveStatic(req, res, pathname);
      }
      if (pathname === '/api/events' && req.method === 'GET') return events(req, res, who(req));
      if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, {ok: true});
      // Writes must carry this header. Browsers can't add it to a cross-site request without CORS, which the app never allows.
      if (req.method !== 'GET' && req.headers['x-okr'] !== '1') fail(403, 'Missing request header.');
      let m = null;
      const route = routes.find(([meth, re]) => meth === req.method && (m = pathname.match(re)));
      if (!route) fail(404, 'Not found.');
      const body = req.method === 'GET' ? {} : await readBody(req);
      const c = {...who(req), body};
      const out = await route[2](c, body, req, res, m, url.searchParams);
      send(res, 200, out);
      if (req.method !== 'GET') broadcast();
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, {error: err.message, ...(err.extra || {})});
      log.error(err);
      send(res, 500, {error: 'Something went wrong on the server. Try again.'});
    }
  });
}
