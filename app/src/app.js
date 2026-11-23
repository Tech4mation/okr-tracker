// The HTTP app for the whole platform. Each request is routed to one organization (src/org.js):
//   - signed-in requests by the organization in their session cookie;
//   - invite, reset and setup links by the organization in their token;
//   - sign-in by the organization the email address belongs to.
// Everything after that runs against that organization's own data only. Static files and the health check
// belong to no organization.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as A from './auth.js';
import {openDb} from './db.js';
import {openPlatform, adoptLegacy, splitToken} from './platform.js';
import {createOrg} from './org.js';
import {createAdmin} from './admin.js';
import {createSignup} from './signup.js';
import {Refusal} from './actions.js';
import {HttpError, fail, HANDLED, SECURITY, MAX_JSON, MAX_FILE, send, readRaw, parseJson} from './http.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = {'/app.js': 'text/javascript', '/app.css': 'text/css', '/model.js': 'text/javascript', '/favicon.svg': 'image/svg+xml', '/platform.js': 'text/javascript'};
const PAGE_PATHS = new Set(['/', '/index.html', '/setup', '/reset', '/invite', '/signup', '/confirm']);
// The platform owners' page (admin.js). Opening it does nothing without an owner's own sign-in.
const PLATFORM_PAGES = new Set(['/platform', '/platform/setup']);
const PAUSED = 'Team OKR Tracker is paused for your organization. Nothing in it has been deleted. Ask your CEO to get in touch with us.';
// Routes whose organization comes from the link token in the body, with what to say when the link is no good.
const LINKS = {
  '/api/setup': () => 'This setup link has expired or was already used. Ask whoever set up your organization for a new one.',
  '/api/invite': () => 'This invite link has expired or was already used. Ask HR for a new one.',
  '/api/reset': () => 'This reset link has expired or was already used. Ask HR for a new one.',
  '/api/link': b => b.kind === 'reset' ? 'This reset link has expired or was already used. Ask HR for a new one.' : 'This invite link has expired or was already used. Ask HR for a new one.',
};

// dataDir holds platform.db and one folder per organization (see platform.js). firstOrgName names the organization
// made from a single-company data folder from before, or the empty one a fresh install starts with. signup lets
// companies sign themselves up (it also needs email to be set up).
export function createApp({dataDir, publicUrl = '', cookieSecure = false, trustProxy = false, transport = null, firstOrgName = '', signup: signupOn = true, log = console}) {
  const platform = openPlatform(dataDir);
  adoptLegacy(platform, firstOrgName);
  if (!platform.list().length) platform.create(firstOrgName || 'My organization');

  const loginLimit = A.rateLimiter(10, 15 * 60e3), linkLimit = A.rateLimiter(30, 15 * 60e3);
  let lastBase = publicUrl || 'http://localhost';
  const mailBase = () => publicUrl || lastBase;
  const ip = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const baseUrl = req => publicUrl || `${trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;

  // ---------- the organizations, each loaded once and kept ----------
  const orgs = new Map();
  // True until some organization has its CEO, while nobody can sign up: the page then explains how to get a setup link.
  const needsSetup = () => !signup.open() && ![...orgs.values()].some(o => o.hasCeo());
  const lastTouch = new Map();
  function load(row) {
    const id = row.id;
    const org = createOrg({
      id, db: openDb(platform.dbFile(id)), filesDir: platform.filesDir(id), transport, baseUrl: mailBase, cookieSecure, needsSetup, log,
      registry: {
        elsewhere: em => { const o = platform.orgOfEmail(em); return !!o && o !== id; },
        sync: list => { const clash = platform.syncEmails(id, list); if (clash.length) log.error(`Organization ${id} holds addresses another organization already has: ${clash.join(', ')}`); },
        // Last activity, for the platform page: written at most once a minute.
        active: () => { const t = Date.now(); if (t - (lastTouch.get(id) || 0) > 60e3) { lastTouch.set(id, t); platform.touch(id, t); } },
      },
    });
    org.name = row.name;
    org.status = row.status;
    orgs.set(id, org);
    return org;
  }
  // An organization made since start-up (for example from the command line) loads on first use.
  function org(id) {
    if (!id) return null;
    const have = orgs.get(id);
    if (have) return have;
    const row = platform.get(id);
    return row ? load(row) : null;
  }
  // Only a running organization is served; a paused one is kept but nobody can use it.
  const open = o => !!o && o.status === 'active';
  // Every organization is loaded at start, so each one's daily email goes out even if nobody has signed in yet.
  platform.list().forEach(load);
  const admin = createAdmin({platform, org, addOrg: name => load(platform.create(name)), transport, cookieSecure, loginLimit, linkLimit, ip});
  const signup = createSignup({platform, addOrg: name => load(platform.create(name)), transport, enabled: signupOn, ip, linkLimit, log});
  const fromCookie = req => { const {org: id, token} = splitToken(A.readCookie(req), platform.legacyOrg()); return {o: org(id), token}; };

  const timers = [
    setInterval(() => { orgs.forEach(o => o.prune()); platform.owners.prune(); platform.signups.prune(); }, 6 * 3600e3),
    setInterval(() => orgs.forEach(o => open(o) && o.ping()), 25e3),
    // A paused organization sends no email.
    setInterval(() => orgs.forEach(o => open(o) && o.tick()), 60e3),
  ];
  timers.forEach(t => t.unref());

  // Sign-in happens before any organization is known: the email address says which one.
  async function login(req, res, b) {
    const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (!loginLimit(ip(req) + '|' + email)) fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const o = org(platform.orgOfEmail(email)), u = o ? o.login(email) : null;
    const ok = await A.checkPassword(pw, u ? u.pass_hash : A.DUMMY_HASH);
    if (!u || !ok) fail(401, 'That email and password don\'t match.');
    if (!open(o)) fail(403, PAUSED);
    o.startSession(res, u.id);
  }

  function serveStatic(req, res, pathname) {
    const file = PAGE_PATHS.has(pathname) ? 'index.html' : PLATFORM_PAGES.has(pathname) ? 'platform.html' : STATIC[pathname] ? pathname.slice(1) : null;
    if (!file) return send(req, res, 404, 'Not found', {'Content-Type': 'text/plain; charset=utf-8', ...SECURITY});
    fs.readFile(path.join(PUBLIC, file), (err, data) => {
      if (err) return send(req, res, 500, 'Could not read the page.', {'Content-Type': 'text/plain; charset=utf-8'});
      send(req, res, 200, data, {'Content-Type': (STATIC[pathname] || 'text/html') + '; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY});
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), pathname = url.pathname;
    try {
      if (!publicUrl && req.headers.host) lastBase = baseUrl(req);
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, {error: 'Method not allowed.'});
        return serveStatic(req, res, pathname);
      }
      if (pathname === '/api/health' && req.method === 'GET') return send(req, res, 200, {ok: true});
      if (pathname === '/api/events' && req.method === 'GET') {
        const {o, token} = fromCookie(req);
        if (!open(o)) fail(401, o ? PAUSED : 'Sign in to continue.');
        return o.events(req, res, token);
      }
      // Writes must carry this header. Browsers can't add it to a cross-site request without CORS, which the app never allows.
      if (req.method !== 'GET' && req.headers['x-okr'] !== '1') fail(403, 'Missing request header.');
      const isFile = req.method === 'PUT';
      const raw = req.method === 'GET' ? Buffer.alloc(0) : await readRaw(req, isFile ? MAX_FILE : MAX_JSON);
      const body = isFile ? {} : parseJson(raw);

      if (pathname.startsWith('/api/platform/')) return send(req, res, 200, await admin.handle(req, res, {pathname, body, base: baseUrl(req)}));
      // Whether the sign-in page offers "create your company's tracker".
      if (req.method === 'GET' && pathname === '/api/signup') return send(req, res, 200, {open: signup.open()});
      if (pathname.startsWith('/api/signup')) return send(req, res, 200, await signup.handle(req, res, {pathname, body, base: baseUrl(req)}));
      if (req.method === 'POST' && pathname === '/api/login') { await login(req, res, body); return send(req, res, 200, {ok: true}); }
      if (req.method === 'POST' && pathname === '/api/logout') {
        const {o, token} = fromCookie(req);
        if (o) o.endSession(token);
        res.setHeader('Set-Cookie', A.sessionCookie(null, cookieSecure));
        return send(req, res, 200, {ok: true});
      }
      let o, token = null;
      if (req.method === 'POST' && LINKS[pathname]) {
        if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
        const t = splitToken(body.token, platform.legacyOrg());
        o = org(t.org);
        if (!o || !t.token) fail(400, LINKS[pathname](body));
        if (!open(o)) fail(403, PAUSED);
        body.token = t.token;
      } else {
        ({o, token} = fromCookie(req));
        if (!o) fail(401, 'Sign in to continue.', pathname === '/api/state' ? {needsSetup: needsSetup()} : undefined);
        if (!open(o)) fail(401, PAUSED, pathname === '/api/state' ? {needsSetup: false} : undefined);
      }
      const out = await o.handle(req, res, {pathname, body, raw, token, base: baseUrl(req)});
      if (out !== HANDLED) send(req, res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(req, res, err.status, {error: err.message, ...(err.extra || {})});
      if (err instanceof Refusal) return send(req, res, 400, {error: err.message});
      log.error(err);
      if (!res.headersSent) send(req, res, 500, {error: 'Something went wrong on the server. Try again.'});
    }
  });

  const stopTimers = () => timers.forEach(clearInterval);
  server.on('close', stopTimers);
  server.okr = {
    platform, orgs,
    org,
    // A new, empty organization, ready for its CEO's setup link.
    addOrg: name => load(platform.create(name)),
    open,
    close() { stopTimers(); orgs.forEach(o => o.close()); orgs.clear(); platform.close(); },
  };
  return server;
}
