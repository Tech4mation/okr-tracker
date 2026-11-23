// The platform's own page (TPD-1889), for its owners only. Companies sign up themselves; from here the owners see
// every organization at a glance, send a locked-out CEO a link, and pause an organization (spam, abuse) or bring it back.
// Owners have their own accounts, sessions and cookie, kept apart from every organization's: an organization's
// session never opens these routes, and an owner's session never opens an organization.
import * as A from './auth.js';
import {OWNER_SESSION_HOURS} from './platform.js';
import {fail} from './http.js';

export const OWNER_COOKIE = 'okr_platform';
const ownerCookie = (token, secure) =>
  `${OWNER_COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${token ? OWNER_SESSION_HOURS * 3600 : 0}`;
const password = v => { const s = String(v || ''); if (s.length < 10) fail(400, 'Use a password of at least 10 characters.'); if (s.length > 200) fail(400, 'That password is too long.'); return s; };
const LINK_GONE = 'This link has expired or was already used. Ask for a new one (npm run platform-owner -- <email> on the server).';

export function createAdmin({platform, org, addOrg, transport, cookieSecure, loginLimit, linkLimit, ip}) {
  const owner = req => platform.owners.bySession(A.readCookie(req, OWNER_COOKIE)) || fail(401, 'Sign in to continue.');
  const row = id => platform.get(id) || fail(404, 'That organization no longer exists.');
  const summary = r => {
    const o = org(r.id), c = o && o.ceo();
    return {id: r.id, name: r.name, status: r.status, createdAt: r.created_at, lastAt: r.last_at || null, people: o ? o.S.people.length : 0,
      ceo: c ? {name: c.name, email: c.email || '', ready: !!c.uid} : null};
  };
  const linkMsg = (l, orgName) => l.kind === 'invite'
    ? (l.emailed ? `The invite for ${orgName} went to ${l.to}. It works once, within 14 days.` : `Email is not set up on the server, so send ${l.name} this link yourself. It works once, within 14 days.`)
    : (l.emailed ? `${l.name} has already chosen a password, so a password reset link went to ${l.to}. It works once, within 24 hours.` : `${l.name} has already chosen a password. Send them this reset link yourself; it works once, within 24 hours.`);

  const routes = [
    ['POST', /^\/api\/platform\/login$/, async (req, res, b) => {
      const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
      if (!loginLimit('platform|' + ip(req) + '|' + email)) fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
      const o = platform.owners.byEmail(email);
      const ok = await A.checkPassword(pw, o ? o.pass_hash : A.DUMMY_HASH);
      if (!o || !ok) fail(401, 'That email and password don\'t match.');
      res.setHeader('Set-Cookie', ownerCookie(platform.owners.startSession(o.id), cookieSecure));
      return {ok: true};
    }],
    ['POST', /^\/api\/platform\/logout$/, (req, res) => {
      platform.owners.endSession(A.readCookie(req, OWNER_COOKIE));
      res.setHeader('Set-Cookie', ownerCookie(null, cookieSecure));
      return {ok: true};
    }],
    // An owner's one-time link to choose a password, from "npm run platform-owner".
    ['POST', /^\/api\/platform\/link$/, (req, res, b) => {
      if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
      const o = platform.owners.byLink(b.token) || fail(400, LINK_GONE);
      return {email: o.email, name: o.name};
    }],
    ['POST', /^\/api\/platform\/password$/, async (req, res, b) => {
      if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
      if (!platform.owners.byLink(b.token)) fail(400, LINK_GONE);
      const o = platform.owners.setPassword(b.token, await A.hashPassword(password(b.password))) || fail(400, LINK_GONE);
      res.setHeader('Set-Cookie', ownerCookie(platform.owners.startSession(o.id), cookieSecure));
      return {ok: true};
    }],
    ['GET', /^\/api\/platform\/me$/, req => { const o = owner(req); return {owner: {name: o.name, email: o.email}}; }],

    ['GET', /^\/api\/platform\/orgs$/, req => { owner(req); return {orgs: platform.list().map(summary), mail: !!transport}; }],
    ['POST', /^\/api\/platform\/orgs\/([a-z0-9]+)\/link$/, (req, res, b, base, m) => {
      owner(req);
      const r = row(m[1]);
      if (r.status !== 'active') fail(409, `${r.name} is paused. Bring it back before sending its CEO a link.`);
      const l = org(r.id).ceoLink(base, r.name);
      return {url: l.url, kind: l.kind, emailed: l.emailed, msg: linkMsg(l, r.name)};
    }],
    // Paused: nobody in it can sign in or use a link, its email stops, and everything in it is kept.
    ['POST', /^\/api\/platform\/orgs\/([a-z0-9]+)\/(suspend|resume)$/, (req, res, b, base, m) => {
      owner(req);
      const r = row(m[1]), o = org(r.id), to = m[2] === 'suspend' ? 'suspended' : 'active';
      if (r.status === to) fail(409, to === 'suspended' ? `${r.name} is already paused.` : `${r.name} is already running.`);
      platform.setStatus(r.id, to);
      o.status = to;
      if (to === 'suspended') o.dropClients();
      return {ok: true, msg: to === 'suspended' ? `${r.name} is paused. Nobody in it can sign in, and everything in it is kept.` : `${r.name} is back. Its people can sign in again.`};
    }],
  ];

  return {
    handle(req, res, {pathname, body, base}) {
      let m = null;
      const route = routes.find(([meth, re]) => meth === req.method && (m = pathname.match(re)));
      if (!route) fail(404, 'Not found.');
      return route[2](req, res, body, base, m);
    },
  };
}
