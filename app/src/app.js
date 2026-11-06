// The HTTP app: sign-in, the filtered state each person may see, the actions that change it, document files,
// email administration, live updates and the page's static files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {createModel, EMAIL_RE, uuid, today} from '../public/model.js';
import * as A from './auth.js';
import {createStore} from './store.js';
import {createActions, Refusal} from './actions.js';
import {viewFor} from './view.js';
import {createMailer} from './mail.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = {'/app.js': 'text/javascript', '/app.css': 'text/css', '/model.js': 'text/javascript', '/favicon.svg': 'image/svg+xml'};
const PAGE_PATHS = new Set(['/', '/index.html', '/setup', '/reset', '/invite']);
const MAX_JSON = 700 * 1024, MAX_FILE = 5 * 1024 * 1024;
const SAFE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const now = () => Date.now();
const password = v => { const s = String(v || ''); if (s.length < 8) fail(400, 'Use a password of at least 8 characters.'); if (s.length > 200) fail(400, 'That password is too long.'); return s; };

// ---------- one-time links (also used by the command line) ----------
const hasCeo = db => !!db.prepare("SELECT 1 FROM docs WHERE col = 'people' AND json_extract(data, '$.role') = 'ceo' AND json_extract(data, '$.uid') IS NOT NULL").get();
export function setupLink(db, baseUrl) {
  if (hasCeo(db)) return null;
  db.prepare("DELETE FROM tokens WHERE kind = 'setup'").run();
  return `${baseUrl}/setup?token=${A.createLinkToken(db, 'setup', null, 7)}`;
}
export function resetLink(db, baseUrl, userId) {
  db.prepare("DELETE FROM tokens WHERE kind = 'reset' AND user_id = ?").run(userId);
  return `${baseUrl}/reset?token=${A.createLinkToken(db, 'reset', userId, 1)}`;
}
function inviteLink(db, baseUrl, personId) {
  db.prepare("DELETE FROM tokens WHERE kind = 'invite' AND person_id = ?").run(personId);
  return `${baseUrl}/invite?token=${A.createLinkToken(db, 'invite', null, 14, personId)}`;
}

export function createApp({db, publicUrl = '', cookieSecure = false, trustProxy = false, filesDir = '', transport = null, log = console}) {
  const M = createModel();
  const {S} = M;
  const store = createStore(db, S);
  const clients = new Set();
  const loginLimit = A.rateLimiter(10, 15 * 60e3), linkLimit = A.rateLimiter(30, 15 * 60e3);
  let lastBase = publicUrl || 'http://localhost';
  const mailer = createMailer({db, M, baseUrl: () => publicUrl || lastBase, transport, log});
  const broadcast = () => { for (const res of clients) res.write('data: change\n\n'); };
  const ip = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const baseUrl = req => publicUrl || `${trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
  const startSession = (res, userId) => res.setHeader('Set-Cookie', A.sessionCookie(A.createSession(db, userId), cookieSecure));
  const timers = [
    setInterval(() => A.pruneExpired(db), 6 * 3600e3),
    setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3),
    setInterval(() => { try { mailer.runDigest(); } catch (err) { log.error(err); } mailer.flush().catch(err => log.error(err)); }, 60e3),
  ];
  timers.forEach(t => t.unref());

  // ---------- accounts, as the actions see them ----------
  const userByEmail = em => db.prepare('SELECT id FROM users WHERE email = ?').get(em);
  const afterCommit = [];
  const accounts = {
    // An account with this person's email that nobody else holds becomes theirs.
    link(p) {
      if (p.uid || !p.email) return;
      const u = userByEmail(p.email.toLowerCase());
      if (u && !S.people.some(x => x !== p && x.uid === String(u.id))) p.uid = String(u.id);
    },
    email(p, em) {
      if (!p.uid) return;
      if (!em) throw new Refusal(`${p.name} signs in with their email, so it can't be blank. Remove them instead if they have left.`);
      const u = userByEmail(em);
      if (u && String(u.id) !== p.uid) throw new Refusal('That email belongs to another account.');
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(em, Number(p.uid));
    },
    remove(p) {
      db.prepare("DELETE FROM tokens WHERE kind = 'invite' AND person_id = ?").run(p.id);
      if (p.uid) db.prepare('DELETE FROM users WHERE id = ?').run(Number(p.uid));
    },
  };
  const files = {
    path: id => path.join(filesDir, String(id).replace(/[^a-zA-Z0-9-]/g, '')),
    remove(id) { afterCommit.push(() => fs.rm(files.path(id), {force: true}, () => {})); },
  };
  const {actions} = createActions(M, {notify: mailer.notify, accounts, files});
  // Runs a change against the shared state; on success saves it, tells every open page and sends email.
  function change(fn) {
    afterCommit.length = 0;
    const out = store.run(fn);
    afterCommit.splice(0).forEach(f => f());
    broadcast();
    mailer.flush().catch(err => log.error(err));
    return out;
  }

  // Who is asking. A CEO can preview the app as someone else (SC-4); a preview is read-only.
  function who(req) {
    const account = A.sessionUser(db, A.readCookie(req));
    if (!account) return {account: null};
    const real = S.people.find(p => p.uid === String(account.id)) || null;
    let e = real;
    const va = String(req.headers['x-view-as'] || '');
    if (real && real.role === 'ceo' && va && va !== real.id) e = S.people.find(p => p.id === va) || real;
    return {account, real, e, previewing: e !== real};
  }
  const member = c => {
    if (!c.account) fail(401, 'Sign in to continue.');
    if (!c.real) fail(403, 'Your account is not in the directory yet. Ask HR to add you with this email address.');
    return c.e;
  };
  const actor = c => {
    const e = member(c);
    if (c.previewing) fail(403, `You are previewing the app as ${e.name}, which is read-only. Switch back to yourself to make changes.`);
    return e;
  };
  const groupOnly = c => { const e = actor(c); if (!M.isGroup(e)) fail(403, 'Only HR and the CEO can do that.'); return e; };
  const docFor = (c, id) => {
    const e = member(c), d = S.docs.find(x => x.id === id) || fail(404, 'That document no longer exists.');
    const owner = M.person(d.owner);
    if (!(d.owner === e.name || M.isGroup(e) || (owner && M.reportsTo(owner, e)))) fail(403, 'You can\'t open this document.');
    return {e, d};
  };

  // ---------- routes ----------
  const routes = [
    // first run: the CEO account
    ['POST', /^\/api\/setup$/, async (c, b, req, res) => {
      const t = A.findLinkToken(db, 'setup', b.token);
      if (!t || hasCeo(db)) fail(400, 'This setup link has expired or was already used. Run "npm run setup-link" on the server for a new one.');
      const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = password(b.password);
      if (!name || name.length > 80) fail(400, 'Enter your name.');
      if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
      const existing = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
      if (existing && !(await A.checkPassword(pw, existing.pass_hash))) fail(409, 'An account with this email already exists. Enter that account\'s password to make it the CEO account.');
      const hash = existing ? null : await A.hashPassword(pw);
      const uid = change(() => {
        const u = existing ? existing.id : Number(db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(email, name, hash, now()).lastInsertRowid);
        const linked = S.people.find(p => p.uid === String(u)) || S.people.find(p => (p.email || '').toLowerCase() === email);
        if (linked) Object.assign(linked, {role: 'ceo', uid: String(u), email});
        else {
          if (S.people.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Refusal(`Someone called ${name} is already in the directory. Use your full name.`);
          S.people.push({id: uuid(), name, email, role: 'ceo', sub: '', team: '', mgr: null, title: 'Chief Executive Officer', joined: today(), jd: [], contract: '', notice: '', uid: String(u)});
        }
        db.prepare("DELETE FROM tokens WHERE kind = 'setup'").run();
        return u;
      });
      startSession(res, uid);
    }],
    ['POST', /^\/api\/login$/, async (c, b, req, res) => {
      const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
      if (!loginLimit(ip(req) + '|' + email)) fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
      const u = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
      const ok = await A.checkPassword(pw, u ? u.pass_hash : A.DUMMY_HASH);
      if (!u || !ok) fail(401, 'That email and password don\'t match.');
      startSession(res, u.id);
    }],
    ['POST', /^\/api\/logout$/, (c, b, req, res) => {
      A.endSession(db, A.readCookie(req));
      res.setHeader('Set-Cookie', A.sessionCookie(null, cookieSecure));
    }],
    // What an invite or reset link is for, so the page can greet the person by name.
    ['POST', /^\/api\/link$/, (c, b, req) => {
      if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
      const kind = b.kind === 'reset' ? 'reset' : 'invite', t = A.findLinkToken(db, kind, b.token);
      if (!t) fail(400, kind === 'reset' ? 'This reset link has expired or was already used. Ask HR for a new one.' : 'This invite link has expired or was already used. Ask HR for a new one.');
      if (kind === 'reset') { const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(t.user_id); return {name: u?.name || '', email: u?.email || ''}; }
      const p = S.people.find(x => x.id === t.person_id) || fail(400, 'This invite is for someone who is no longer in the directory.');
      return {name: p.name, email: p.email || ''};
    }],
    ['POST', /^\/api\/invite$/, async (c, b, req, res) => {
      if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
      const t = A.findLinkToken(db, 'invite', b.token) || fail(400, 'This invite link has expired or was already used. Ask HR for a new one.');
      const p = S.people.find(x => x.id === t.person_id) || fail(400, 'This invite is for someone who is no longer in the directory.');
      if (p.uid) fail(409, `${p.name} already has an account. Sign in instead, or ask HR for a password reset link.`);
      if (!EMAIL_RE.test(p.email || '')) fail(400, 'Your record has no email address yet. Ask HR to add it, then send a new invite.');
      const hash = await A.hashPassword(password(b.password));
      const uid = change(() => {
        if (userByEmail(p.email.toLowerCase())) throw new Refusal('An account with this email already exists. Sign in with it instead.');
        const u = Number(db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(p.email.toLowerCase(), p.name, hash, now()).lastInsertRowid);
        p.uid = String(u);
        A.useLinkToken(db, b.token);
        return u;
      });
      startSession(res, uid);
    }],
    ['POST', /^\/api\/reset$/, async (c, b, req, res) => {
      if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
      const t = A.findLinkToken(db, 'reset', b.token) || fail(400, 'This reset link has expired or was already used. Ask HR for a new one.');
      const hash = await A.hashPassword(password(b.password));
      db.exec('BEGIN IMMEDIATE');
      try { db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash, t.user_id); A.useLinkToken(db, b.token); A.endAllSessions(db, t.user_id); db.exec('COMMIT'); }
      catch (err) { db.exec('ROLLBACK'); throw err; }
      startSession(res, t.user_id);
    }],

    // Everything the page shows, already cut down to what this person may see.
    ['GET', /^\/api\/state$/, c => {
      if (!c.account) fail(401, 'Sign in to continue.', {needsSetup: !hasCeo(db)});
      if (!c.real) return {account: {name: c.account.name, email: c.account.email}, me: null};
      const e = c.e;
      return {account: {name: c.account.name, email: c.account.email}, realId: c.real.id, effId: e.id, previewing: c.previewing,
        real: {id: c.real.id, name: c.real.name, role: c.real.role, sub: c.real.sub, team: c.real.team},
        others: c.real.role === 'ceo' ? S.people.filter(p => p.id !== c.real.id).map(p => ({id: p.id, name: p.name})) : [],
        mail: M.isGroup(c.real) && !c.previewing ? mailer.problems() : null,
        S: viewFor(M, e)};
    }],
    ['POST', /^\/api\/act$/, c => {
      const e = actor(c), fn = actions[c.body.a];
      if (!fn) fail(400, 'Unknown action.');
      const out = change(() => fn(e, c.body.args && typeof c.body.args === 'object' ? c.body.args : {}, {real: c.real}));
      return typeof out === 'string' ? {ok: true, msg: out} : {ok: true, ...out};
    }],

    // Invite and password-reset links, made by HR or the CEO and passed on by hand until email is set up.
    ['POST', /^\/api\/people\/([\w-]+)\/link$/, (c, b, req, res, m) => {
      const e = groupOnly(c), p = S.people.find(x => x.id === m[1]) || fail(404, 'That person is no longer in the directory.');
      if (p.role === 'ceo' && e.role !== 'ceo') fail(403, 'Only the CEO can do that for a CEO.');
      if (p.uid) {
        const url = resetLink(db, baseUrl(req), Number(p.uid));
        return {url, kind: 'reset', msg: `Password reset link for ${p.name}, valid for 24 hours.`};
      }
      if (!EMAIL_RE.test(p.email || '')) fail(400, `Add an email address for ${p.name} first. It is what they sign in with.`);
      const url = inviteLink(db, baseUrl(req), p.id);
      if (transport && EMAIL_RE.test(p.email)) {
        change(() => mailer.notify('invite', [p.name], {subject: 'You have been invited to Team OKR Tracker', text: `${e.name} has added you to Team OKR Tracker. Use this link to choose a password (valid 14 days):\n${url}`, tab: '', key: `invite:${p.id}:${now()}`}));
      }
      return {url, kind: 'invite', msg: `Invite link for ${p.name}, valid for 14 days.`};
    }],

    // DX-3: a file attached to a document on someone's record.
    ['PUT', /^\/api\/docs\/([\w-]+)\/file$/, async (c, b, req, res, m) => {
      const e = actor(c), {d} = docFor(c, m[1]);
      if (!(M.isGroup(e) || d.owner === e.name)) fail(403, 'Only HR or the person can attach a file.');
      if (!filesDir) fail(500, 'File storage is not set up on the server.');
      const name = String(decodeURIComponent(req.headers['x-file-name'] || 'file')).replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'file';
      const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().slice(0, 100);
      const buf = c.raw;
      if (!buf.length) fail(400, 'That file is empty.');
      fs.mkdirSync(filesDir, {recursive: true});
      const tmp = files.path(d.id) + '.' + uuid() + '.tmp';
      fs.writeFileSync(tmp, buf);
      try {
        change(() => { Object.assign(d, {file: {name, size: buf.length, type, at: now()}, at: now()}); if (d.status === 'Awaiting signature') d.status = 'On file'; });
        fs.renameSync(tmp, files.path(d.id));
      } catch (err) { fs.rmSync(tmp, {force: true}); throw err; }
      return {ok: true, msg: 'Attached ' + name + '.'};
    }],
    ['GET', /^\/api\/docs\/([\w-]+)\/file$/, (c, b, req, res, m) => {
      const {d} = docFor(c, m[1]);
      if (!d.file || !filesDir || !fs.existsSync(files.path(d.id))) fail(404, 'No file is attached to this document.');
      const type = SAFE_TYPES.has(d.file.type) ? d.file.type : 'application/octet-stream';
      res.writeHead(200, {'Content-Type': type, 'Content-Disposition': `attachment; filename="${d.file.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(d.file.name)}`,
        'Cache-Control': 'private, no-store', ...SECURITY});
      fs.createReadStream(files.path(d.id)).pipe(res);
      return HANDLED;
    }],

    // Section 13 for HR: what went out, what failed, and a test.
    ['GET', /^\/api\/mail$/, c => { groupOnly(c); return mailer.report(); }],
    ['POST', /^\/api\/mail\/test$/, async c => {
      const e = groupOnly(c);
      try { await mailer.sendTest(e); } catch (err) { fail(502, String(err.message || err)); }
      return {ok: true, msg: `Test email sent to ${e.email}.`};
    }],
  ];

  // ---------- plumbing ----------
  const HANDLED = Symbol('handled');
  function send(req, res, status, body, headers = {}) {
    let data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {ok: true});
    const h = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers};
    if (data.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { data = zlib.gzipSync(data); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
    res.writeHead(status, h);
    res.end(data);
  }
  const readRaw = (req, max) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', ch => { size += ch.length; if (size > max) { reject(new HttpError(413, max === MAX_FILE ? 'Keep files under 5 MB.' : 'That request is too large.')); req.destroy(); } else chunks.push(ch); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const parseJson = buf => {
    if (!buf.length) return {};
    try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    catch { throw new HttpError(400, 'The request wasn\'t valid JSON.'); }
  };
  const SECURITY = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  function serveStatic(req, res, pathname) {
    const file = PAGE_PATHS.has(pathname) ? 'index.html' : STATIC[pathname] ? pathname.slice(1) : null;
    if (!file) return send(req, res, 404, 'Not found', {'Content-Type': 'text/plain; charset=utf-8', ...SECURITY});
    fs.readFile(path.join(PUBLIC, file), (err, data) => {
      if (err) return send(req, res, 500, 'Could not read the page.', {'Content-Type': 'text/plain; charset=utf-8'});
      send(req, res, 200, data, {'Content-Type': (STATIC[pathname] || 'text/html') + '; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY});
    });
  }
  function events(req, res, c) {
    if (!c.account) return send(req, res, 401, {error: 'Sign in to continue.'});
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), pathname = url.pathname;
    try {
      if (!publicUrl && req.headers.host) lastBase = baseUrl(req);
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, {error: 'Method not allowed.'});
        return serveStatic(req, res, pathname);
      }
      if (pathname === '/api/events' && req.method === 'GET') return events(req, res, who(req));
      if (pathname === '/api/health' && req.method === 'GET') return send(req, res, 200, {ok: true});
      // Writes must carry this header. Browsers can't add it to a cross-site request without CORS, which the app never allows.
      if (req.method !== 'GET' && req.headers['x-okr'] !== '1') fail(403, 'Missing request header.');
      let m = null;
      const route = routes.find(([meth, re]) => meth === req.method && (m = pathname.match(re)));
      if (!route) fail(404, 'Not found.');
      const isFile = req.method === 'PUT';
      const raw = req.method === 'GET' ? Buffer.alloc(0) : await readRaw(req, isFile ? MAX_FILE : MAX_JSON);
      const body = isFile ? {} : parseJson(raw);
      const c = {...who(req), body, raw};
      const out = await route[2](c, body, req, res, m, url.searchParams);
      if (out !== HANDLED) send(req, res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(req, res, err.status, {error: err.message, ...(err.extra || {})});
      if (err instanceof Refusal) return send(req, res, 400, {error: err.message});
      log.error(err);
      if (!res.headersSent) send(req, res, 500, {error: 'Something went wrong on the server. Try again.'});
    }
  });
  server.okr = {M, S, store, mailer, close: () => timers.forEach(clearInterval)};
  server.on('close', () => timers.forEach(clearInterval));
  return server;
}
