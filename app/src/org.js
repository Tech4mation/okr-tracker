// One organization: its records in memory, the rules and actions over them, its accounts, sessions and one-time
// links, its email outbox, its attached files and its live-update channel. The platform's router (app.js) decides
// which organization a request is for; nothing in here can reach another organization's data.
import fs from 'node:fs';
import path from 'node:path';
import {createModel, EMAIL_RE, uuid, today} from '../public/model.js';
import * as A from './auth.js';
import {createStore} from './store.js';
import {createActions, Refusal, ELSEWHERE} from './actions.js';
import {viewFor} from './view.js';
import {createMailer} from './mail.js';
import {fail, HANDLED, SECURITY} from './http.js';

const SAFE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const now = () => Date.now();
const password = v => { const s = String(v || ''); if (s.length < 8) fail(400, 'Use a password of at least 8 characters.'); if (s.length > 200) fail(400, 'That password is too long.'); return s; };
// For an organization running on its own, as in some tests: no other organization holds any address.
const ALONE = {elsewhere: () => false, sync() {}};

export function createOrg({id, db, filesDir = '', transport = null, baseUrl = () => 'http://localhost', cookieSecure = false,
  registry = ALONE, needsSetup = null, log = console}) {
  const M = createModel();
  const {S} = M;
  const store = createStore(db, S);
  const clients = new Set();
  const mailer = createMailer({db, M, baseUrl, transport, log});
  const broadcast = () => { for (const res of clients) res.write('data: change\n\n'); };

  // Cookies and links carry the organization in front of the token (see platform.js).
  const tok = raw => `${id}.${raw}`;
  const startSession = (res, userId) => res.setHeader('Set-Cookie', A.sessionCookie(tok(A.createSession(db, userId)), cookieSecure));
  const hasCeo = () => !!db.prepare("SELECT 1 FROM docs WHERE col = 'people' AND json_extract(data, '$.role') = 'ceo' AND json_extract(data, '$.uid') IS NOT NULL").get();
  function setupLink(base) {
    if (hasCeo()) return null;
    db.prepare("DELETE FROM tokens WHERE kind = 'setup'").run();
    return `${base}/setup?token=${tok(A.createLinkToken(db, 'setup', null, 7))}`;
  }
  function resetLink(base, userId) {
    db.prepare("DELETE FROM tokens WHERE kind = 'reset' AND user_id = ?").run(userId);
    return `${base}/reset?token=${tok(A.createLinkToken(db, 'reset', userId, 1))}`;
  }
  function inviteLink(base, personId) {
    db.prepare("DELETE FROM tokens WHERE kind = 'invite' AND person_id = ?").run(personId);
    return `${base}/invite?token=${tok(A.createLinkToken(db, 'invite', null, 14, personId))}`;
  }

  // ---------- accounts, as the actions see them ----------
  const userByEmail = em => db.prepare('SELECT id FROM users WHERE email = ?').get(em);
  const afterCommit = [];
  const accounts = {
    // An address another organization holds can't be used here.
    elsewhere: em => registry.elsewhere(em),
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
    path: fid => path.join(filesDir, String(fid).replace(/[^a-zA-Z0-9-]/g, '')),
    remove(fid) { afterCommit.push(() => fs.rm(files.path(fid), {force: true}, () => {})); },
  };
  const {actions} = createActions(M, {notify: mailer.notify, accounts, files});
  // Data from earlier builds: new starters no longer own onboarding tasks (their tasks pass to the line
  // manager), and role requests no longer use a cost threshold for exec sign-off.
  store.run(() => {
    const fix = t => { if (t.who === 'New hire') t.who = 'Manager'; };
    S.tmpl.forEach(tp => tp.tasks.forEach(fix)); S.onb.forEach(o => o.tasks.forEach(fix));
    S.cfg.onbWho = S.cfg.onbWho.filter(x => x !== 'New hire');
    if (!S.cfg.onbWho.includes('Manager')) S.cfg.onbWho.unshift('Manager');
    if (!S.cfg.onbWho.includes('HR')) S.cfg.onbWho.unshift('HR');
    delete S.cfg.reqExec; delete S.cfg.execAt;
  });
  // Every address this organization holds, for the platform's email -> organization list.
  const emails = () => [...S.people.map(p => p.email), ...db.prepare('SELECT email FROM users').all().map(r => r.email)];
  registry.sync(emails());

  // Runs a change against the shared state; on success saves it, tells every open page and sends email.
  function change(fn) {
    afterCommit.length = 0;
    const out = store.run(fn);
    afterCommit.splice(0).forEach(f => f());
    registry.sync(emails());
    broadcast();
    mailer.flush().catch(err => log.error(err));
    return out;
  }

  // Who is asking. A CEO can preview the app as someone else in the same organization (SC-4); a preview is read-only.
  function who(req, token) {
    const account = A.sessionUser(db, token);
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
  const docFor = (c, did) => {
    const e = member(c), d = S.docs.find(x => x.id === did) || fail(404, 'That document no longer exists.');
    const owner = M.person(d.owner);
    if (!(d.owner === e.name || M.isGroup(e) || (owner && M.reportsTo(owner, e)))) fail(403, 'You can\'t open this document.');
    return {e, d};
  };

  // ---------- routes ----------
  // The router has already taken the organization off any token, so b.token here is this organization's own.
  const routes = [
    // first run: the CEO account
    ['POST', /^\/api\/setup$/, async (c, b, req, res) => {
      const t = A.findLinkToken(db, 'setup', b.token);
      if (!t || hasCeo()) fail(400, 'This setup link has expired or was already used. Ask whoever set up your organization for a new one.');
      const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = password(b.password);
      if (!name || name.length > 80) fail(400, 'Enter your name.');
      if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
      if (registry.elsewhere(email)) fail(409, ELSEWHERE);
      const existing = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
      if (existing && !(await A.checkPassword(pw, existing.pass_hash))) fail(409, 'An account with this email already exists. Enter that account\'s password to make it the CEO account.');
      const hash = existing ? null : await A.hashPassword(pw);
      const uid = change(() => {
        if (registry.elsewhere(email)) throw new Refusal(ELSEWHERE);
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
    // What an invite or reset link is for, so the page can greet the person by name.
    ['POST', /^\/api\/link$/, c => {
      const b = c.body, kind = b.kind === 'reset' ? 'reset' : 'invite', t = A.findLinkToken(db, kind, b.token);
      if (!t) fail(400, kind === 'reset' ? 'This reset link has expired or was already used. Ask HR for a new one.' : 'This invite link has expired or was already used. Ask HR for a new one.');
      if (kind === 'reset') { const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(t.user_id); return {name: u?.name || '', email: u?.email || ''}; }
      const p = S.people.find(x => x.id === t.person_id) || fail(400, 'This invite is for someone who is no longer in the directory.');
      return {name: p.name, email: p.email || ''};
    }],
    ['POST', /^\/api\/invite$/, async (c, b, req, res) => {
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
      const t = A.findLinkToken(db, 'reset', b.token) || fail(400, 'This reset link has expired or was already used. Ask HR for a new one.');
      const hash = await A.hashPassword(password(b.password));
      db.exec('BEGIN IMMEDIATE');
      try { db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash, t.user_id); A.useLinkToken(db, b.token); A.endAllSessions(db, t.user_id); db.exec('COMMIT'); }
      catch (err) { db.exec('ROLLBACK'); throw err; }
      startSession(res, t.user_id);
    }],

    // Everything the page shows, already cut down to what this person may see.
    ['GET', /^\/api\/state$/, c => {
      if (!c.account) fail(401, 'Sign in to continue.', {needsSetup: needsSetup ? needsSetup() : !hasCeo()});
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

    // Invite and password-reset links, made by HR or the CEO. Emailed when email is set up, and shown here too.
    ['POST', /^\/api\/people\/([\w-]+)\/link$/, (c, b, req, res, m) => {
      const e = groupOnly(c), p = S.people.find(x => x.id === m[1]) || fail(404, 'That person is no longer in the directory.');
      if (p.role === 'ceo' && e.role !== 'ceo') fail(403, 'Only the CEO can do that for a CEO.');
      const emailable = !!transport && EMAIL_RE.test(p.email || '');
      const sendMail = (kind, subject, text) => { if (emailable) change(() => mailer.notify(kind, [p.name], {subject, text, tab: null, key: `${kind}:${p.id}:${now()}`})); };
      if (p.uid) {
        const url = resetLink(c.base, Number(p.uid));
        sendMail('reset', 'Reset your Team OKR Tracker password', `${e.name} has sent you a link to choose a new password. It works once, within 24 hours:\n${url}\n\nIf you did not ask for this, you can ignore it; your current password still works.`);
        return {url, kind: 'reset', emailed: emailable, msg: emailable ? `Password reset link emailed to ${p.email}, valid for 24 hours.` : `Password reset link for ${p.name}, valid for 24 hours.`};
      }
      if (!EMAIL_RE.test(p.email || '')) fail(400, `Add an email address for ${p.name} first. It is what they sign in with.`);
      const url = inviteLink(c.base, p.id);
      sendMail('invite', 'You have been invited to Team OKR Tracker', `${e.name} has added you to Team OKR Tracker. Use this link to choose a password and sign in. It works once, within 14 days:\n${url}\n\nYou will sign in with this email address.`);
      return {url, kind: 'invite', emailed: emailable, msg: emailable ? `Invite emailed to ${p.email}, valid for 14 days.` : `Invite link for ${p.name}, valid for 14 days.`};
    }],

    // DX-3: a file attached to a document on someone's record, kept in this organization's own folder.
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

  return {
    id, db, M, S, store, mailer, clients, hasCeo, setupLink, resetLink, startSession, emails,
    // The account for a sign-in, if this organization has one with that email.
    login: em => db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(em) || null,
    endSession: token => A.endSession(db, token),
    // One API request for this organization. `token` is the session token from the cookie, without the organization.
    handle(req, res, {pathname, body, raw, token, base}) {
      let m = null;
      const route = routes.find(([meth, re]) => meth === req.method && (m = pathname.match(re)));
      if (!route) fail(404, 'Not found.');
      return route[2]({...who(req, token), body, raw, base}, body, req, res, m);
    },
    // Live updates: this organization's open pages hear about this organization's changes only.
    events(req, res, token) {
      if (!A.sessionUser(db, token)) fail(401, 'Sign in to continue.');
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return HANDLED;
    },
    ping() { for (const res of clients) res.write(': ping\n\n'); },
    prune() { A.pruneExpired(db); },
    // Once a minute: the daily email, then whatever is due to send.
    tick() { try { mailer.runDigest(); } catch (err) { log.error(err); } mailer.flush().catch(err => log.error(err)); },
    close() { for (const res of clients) res.end(); clients.clear(); db.close(); },
  };
}
