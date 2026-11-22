// End-to-end checks of the server against PRD v1.1, calling the HTTP API directly (no page involved).
// Each test builds on the ones before it, like a working week. Run with: npm test
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {openDb, SCHEMA_V1} from '../src/db.js';
import {createApp, setupLink} from '../src/app.js';
import {createSmtpTransport} from '../src/smtp.js';
import {curWeek, curM, curY, today} from '../public/model.js';

// A stand-in mail server that accepts everything and keeps what it was sent.
const inbox = [];
let failMail = false;
const smtp = net.createServer(sock => {
  let data = false, buf = '';
  sock.write('220 test ESMTP\r\n');
  sock.on('data', d => {
    buf += d.toString();
    if (data) {
      const end = buf.indexOf('\r\n.\r\n'); if (end < 0) return;
      inbox.push(buf.slice(0, end)); buf = buf.slice(end + 5); data = false;
      return void sock.write(failMail ? '554 rejected for the test\r\n' : '250 queued\r\n');
    }
    let i;
    while (!data && (i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^EHLO/i.test(line)) sock.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) sock.write('235 ok\r\n');
      else if (/^(MAIL|RCPT)/i.test(line)) sock.write('250 ok\r\n');
      else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); }
      else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
  sock.on('error', () => {});
});

let server, base, db, S, files;
before(async () => {
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  files = fs.mkdtempSync(path.join(os.tmpdir(), 'okr-files-'));
  db = openDb(':memory:');
  const transport = createSmtpTransport({host: '127.0.0.1', port: smtp.address().port, user: 'u', pass: 'p', from: 'okr@example.com'});
  server = createApp({db, filesDir: files, transport, log: {error() {}}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  S = server.okr.S;
});
after(() => { server.closeAllConnections(); server.close(); smtp.close(); fs.rmSync(files, {recursive: true, force: true}); });

// A signed-in browser: keeps its session cookie and can preview as someone (CEO only).
function client() {
  let cookie = '', viewAs = null;
  const call = async (method, p, body, {noHeader, raw, headers = {}} = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {...(raw ? {} : {'Content-Type': 'application/json'}), ...(noHeader ? {} : {'X-OKR': '1'}), ...(cookie ? {cookie} : {}), ...(viewAs ? {'X-View-As': viewAs} : {}), ...headers},
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return {status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text()};
  };
  return {call, get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), as: id => { viewAs = id; }};
}
const act = (c, a, args = {}) => c.post('/api/act', {a, args});
async function ok(p) { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; }
async function no(p, status = 400) { const r = await p; assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; }
const state = async c => (await ok(c.get('/api/state'))).S;
const P = name => S.people.find(p => p.name === name);
const tok = url => new URL(url).searchParams.get('token');

const ceo = client(), hr = client(), mo = client(), mia = client(), ana = client(), ben = client(), cal = client();
const W = curWeek();

test('the setup link creates the CEO account once', async () => {
  await no(ceo.get('/api/state'), 401);
  const token = tok(setupLink(db, base));
  await no(ceo.post('/api/setup', {token: 'wrong', name: 'Cleo Obi', email: 'cleo@x.co', password: 'password1'}));
  await ok(ceo.post('/api/setup', {token, name: 'Cleo Obi', email: 'cleo@x.co', password: 'password1'}));
  await no(client().post('/api/setup', {token, name: 'Eve', email: 'eve@x.co', password: 'password1'}));
  assert.equal(P('Cleo Obi').role, 'ceo');
  assert.equal(setupLink(db, base), null);
});

test('writes without the app header are refused', async () => {
  await no(ceo.call('POST', '/api/act', {a: 'person.add', args: {name: 'X', role: 'member'}}, {noHeader: true}), 403);
});

test('HR and the CEO build the directory with reporting lines (DR-1)', async () => {
  const add = (c, a) => ok(act(c, 'person.add', a));
  await add(ceo, {name: 'Hana Lee', email: 'hana@x.co', role: 'hr', sub: '', team: 'People'});
  await add(ceo, {name: 'Mo Bello', email: 'mo@x.co', role: 'manager', sub: 'NativeTalk', team: 'Growth', mgr: P('Cleo Obi').id});
  await add(ceo, {name: 'Mia Cole', email: 'mia@x.co', role: 'manager', sub: 'Connect', team: 'Product', mgr: P('Cleo Obi').id});
  await add(ceo, {name: 'Ana Ade', email: 'ana@x.co', role: 'member', sub: 'NativeTalk', team: 'Growth', mgr: P('Mo Bello').id, title: 'Writer'});
  await add(ceo, {name: 'Ben Uche', email: 'ben@x.co', role: 'member', sub: 'NativeTalk', team: 'Growth', mgr: P('Mo Bello').id});
  await add(ceo, {name: 'Cal Eze', email: 'cal@x.co', role: 'member', sub: 'Connect', team: 'Product', mgr: P('Mia Cole').id});
  await no(act(ceo, 'person.add', {name: 'ana ade', email: 'other@x.co', role: 'member'}));        // names are unique
  await no(act(ceo, 'person.add', {name: 'New One', email: 'ANA@x.co', role: 'member'}));          // so are emails
  await no(act(ceo, 'person.add', {name: 'Bad Email', email: 'not-an-email', role: 'member'}));
  await no(act(ceo, 'person.save', {id: P('Mo Bello').id, email: 'mo@x.co', role: 'manager', sub: 'NativeTalk', team: 'Growth', mgr: P('Ana Ade').id}));  // no loops
});

test('people sign in through invite links', async () => {
  const links = {};
  for (const n of ['Hana Lee', 'Mo Bello', 'Mia Cole', 'Ana Ade', 'Ben Uche', 'Cal Eze']) links[n] = (await ok(ceo.post(`/api/people/${P(n).id}/link`))).url;
  await no(ana.post('/api/people/' + P('Ben Uche').id + '/link'), 401);
  assert.equal((await ok(client().post('/api/link', {kind: 'invite', token: tok(links['Ana Ade'])}))).name, 'Ana Ade');
  for (const [c, n] of [[hr, 'Hana Lee'], [mo, 'Mo Bello'], [mia, 'Mia Cole'], [ana, 'Ana Ade'], [ben, 'Ben Uche'], [cal, 'Cal Eze']])
    await ok(c.post('/api/invite', {token: tok(links[n]), password: 'password1'}));
  await no(client().post('/api/invite', {token: tok(links['Ana Ade']), password: 'password1'}));     // used up
  await no(client().post('/api/login', {email: 'ana@x.co', password: 'wrong-one'}), 401);
  await ok(client().post('/api/login', {email: 'ana@x.co', password: 'password1'}));
  // An invite to someone who has an account turns into a password reset link.
  const reset = await ok(hr.post(`/api/people/${P('Ana Ade').id}/link`));
  assert.equal(reset.kind, 'reset'); assert.equal(reset.emailed, true);
  await no(hr.post(`/api/people/${P('Cleo Obi').id}/link`), 403);   // HR can't reset the CEO's password
  // Invites and reset links are emailed when email is set up, with the link in the body.
  await server.okr.mailer.flush();
  const body = m => Buffer.from(m.split('\r\n\r\n')[1] || '', 'base64').toString();
  const toAna = inbox.filter(m => m.includes('To: <ana@x.co>')).map(body);
  assert.ok(toAna.some(b => b.includes('/invite?token=')));
  assert.ok(toAna.some(b => b.includes('/reset?token=')));
});

test('members can not create OKRs; managers set them for their reporting line (OK-1)', async () => {
  const krs = [{title: 'Publish 12 guides', type: 'count', target: 12, unit: 'guides'}, {title: 'Launch the newsletter', type: 'binary', month: curM()},
    {title: 'Run 6 interviews every month', type: 'monthly', target: 6, unit: 'interviews'}];
  await no(act(ana, 'okr.add', {objective: 'Mine', owner: 'Ana Ade', krs}));
  await no(act(mo, 'okr.add', {objective: 'Not mine to set', owner: 'Cal Eze', krs}));
  await no(act(mo, 'okr.add', {objective: 'Too few', owner: 'Ana Ade', krs: krs.slice(0, 1)}));
  await no(act(mo, 'okr.add', {objective: 'Bad target', owner: 'Ana Ade', krs: [{title: 'x', type: 'count', target: 0}, {title: 'y'}]}));
  await ok(act(mo, 'okr.add', {objective: 'Grow organic sign-ups', owner: 'Ana Ade', krs}));
  await ok(act(mo, 'okr.add', {objective: 'Run a steady team', owner: 'Mo Bello', krs: krs.slice(0, 2)}));
  await ok(act(mia, 'okr.add', {objective: 'Ship planning', owner: 'Cal Eze', krs: krs.slice(0, 2)}));
  await ok(act(ceo, 'okr.add', {objective: 'Be the default tool', owner: 'Company', krs: krs.slice(0, 2)}));
  await ok(act(ceo, 'okr.add', {objective: 'Grow Connect partners', owner: 'Company:Connect', krs: krs.slice(0, 2)}));
  const o = S.okrs.find(x => x.objective === 'Grow organic sign-ups');
  assert.equal(o.krs[2].month, undefined);   // OK-2: a monthly target has no due month
});

test('each person receives only what they may see (SC-1, SC-2, SC-3)', async () => {
  const a = await state(ana), m = await state(mo), h = await state(hr);
  assert.deepEqual([...new Set(a.okrs.filter(o => o.owner !== 'Company').map(o => o.owner))], ['Ana Ade']);
  assert.ok(!a.okrs.some(o => o.sub === 'Connect'));                     // another subsidiary's company goal
  assert.ok(a.okrs.some(o => o.owner === 'Company' && !o.sub));
  assert.ok(m.okrs.some(o => o.owner === 'Ana Ade') && !m.okrs.some(o => o.owner === 'Cal Eze'));
  assert.ok(h.okrs.some(o => o.owner === 'Cal Eze'));
  // Pay and private details only reach those allowed to see them.
  assert.equal(a.people.find(p => p.name === 'Ben Uche').email, undefined);
  assert.equal(a.people.find(p => p.name === 'Ben Uche').salary, undefined);
  assert.equal(m.people.find(p => p.name === 'Ana Ade').email, 'ana@x.co');
  assert.equal(m.people.find(p => p.name === 'Ana Ade').salary, undefined);
  assert.equal(h.people.find(p => p.name === 'Ana Ade').salary, 0);
  // The leaderboard gets a teammate's standing, not their goals.
  assert.ok('Ben Uche' in a.board && !a.okrs.some(o => o.owner === 'Ben Uche'));
});

test('a finished key result goes to the line manager, and only them (AP-1, AP-2)', async () => {
  const o = S.okrs.find(x => x.objective === 'Grow organic sign-ups');
  await no(act(ben, 'kr.set', {id: o.id, i: 1, done: true}));           // only the owner marks it
  await ok(act(ana, 'kr.set', {id: o.id, i: 1, done: true}));
  assert.equal(o.krs[1].req, true);
  for (const c of [ben, mia, hr]) await no(act(c, 'kr.decide', {id: o.id, i: 1, ok: true}));
  await ok(act(mo, 'kr.decide', {id: o.id, i: 1, ok: true}));
  assert.equal(o.krs[1].pct, 100); assert.equal(o.krs[1].apBy, 'Mo Bello');
  assert.ok(S.logs.some(l => l.owner === 'Ana Ade' && l.week === W && l.delta > 0));
  await no(act(ana, 'kr.set', {id: o.id, i: 1, done: false}));          // only the approver side reopens
  // A manager's own key result goes to their manager, the CEO.
  const mine = S.okrs.find(x => x.objective === 'Run a steady team');
  await ok(act(mo, 'kr.set', {id: mine.id, i: 1, done: true}));
  await no(act(mo, 'kr.decide', {id: mine.id, i: 1, ok: true}));
  await ok(act(ceo, 'kr.decide', {id: mine.id, i: 1, ok: true}));
});

test('standup entries move the key results they are tied to (SU-1, SU-2, OK-4)', async () => {
  const o = S.okrs.find(x => x.objective === 'Grow organic sign-ups');
  await no(act(ben, 'stand.add', {text: 'Sneaky', n: 5, link: `${o.id}|0`}));   // only your own key results
  await ok(act(ana, 'stand.add', {text: 'Wrote guides', n: 5, unit: 'guides', link: `${o.id}|0`}));
  await ok(act(ana, 'stand.add', {text: 'Interviews', n: 4, link: `${o.id}|2`}));
  const x = S.stand.find(s => s.text === 'Wrote guides');
  assert.equal(server.okr.M.krCur(o, o.krs[0], 0), 0);                   // not Done yet, so pending
  for (const c of [ben, mo, ceo]) await no(act(c, 'stand.status', {id: x.id, status: 'Done'}));   // only the owner
  await ok(act(ana, 'stand.status', {id: x.id, status: 'Done'}));
  await ok(act(ana, 'stand.status', {id: S.stand.find(s => s.text === 'Interviews').id, status: 'Done'}));
  assert.equal(server.okr.M.krCur(o, o.krs[0], 0), 5);
  assert.equal(server.okr.M.krCur(o, o.krs[2], 2), 4);                   // the monthly figure, this month only
  assert.ok(['On track', 'At risk', 'Off track'].includes(server.okr.M.okrStatus(o)));
  await ok(act(ana, 'wnote.save', {week: W, text: 'Blocked on design.'}));
  await no(act(ana, 'wnote.save', {week: '2999-01-07', text: 'future'}));
});

test('an OKR change waits for the line manager, and moves are recorded (OK-6)', async () => {
  const o = S.okrs.find(x => x.objective === 'Grow organic sign-ups');
  const krs = o.krs.map((k, j) => ({src: j, title: k.title, month: k.month, type: k.type, target: k.target, unit: k.unit}));
  await no(act(ana, 'okr.edit', {id: o.id, objective: 'X', krs: krs.filter((_, j) => j !== 1)}));   // an approved one can't go
  await ok(act(ana, 'okr.edit', {id: o.id, objective: 'Grow organic sign-ups fast', krs}));
  assert.equal(o.objective, 'Grow organic sign-ups');
  await no(act(ana, 'okr.edit', {id: o.id, objective: 'Again', krs}));
  await no(act(mia, 'okr.decideChange', {id: o.id, ok: true}));
  await ok(act(mo, 'okr.decideChange', {id: o.id, ok: true}));
  assert.equal(o.objective, 'Grow organic sign-ups fast');
  if (curM() > 0) {
    await ok(act(mo, 'okr.add', {objective: 'Late work', owner: 'Ana Ade', krs: [{title: 'Old task', month: curM() - 1}, {title: 'Other', month: curM()}]}));
    const late = S.okrs.find(x => x.objective === 'Late work');
    await ok(act(mo, 'okr.move', {id: late.id, i: 0}));
    assert.equal(late.krs[0].month, curM());
    assert.deepEqual(late.krs[0].moves.map(m => [m.from, m.to]), [[curM() - 1, curM()]]);
  }
});

test('HR runs the review cycle; a review stays private until shared (RV-1 to RV-4)', async () => {
  await no(act(mo, 'cycle.open', {}));
  await ok(act(hr, 'cycle.open', {}));
  await no(act(mo, 'review.mgr', {name: 'Ana Ade', text: 'Early', rating: 3}));   // self-review first
  await ok(act(ana, 'review.self', {text: 'Good half.', rating: 4}));
  await no(act(mia, 'review.mgr', {name: 'Ana Ade', text: 'Not mine', rating: 3}));
  await ok(act(mo, 'review.mgr', {name: 'Ana Ade', text: 'Strong half, ready for more.', rating: 4}));
  let r = (await state(ana)).reviews.find(x => x.owner === 'Ana Ade');
  assert.equal(r.mgr.by, 'Mo Bello'); assert.equal(r.mgr.text, undefined); assert.equal(r.mgr.rating, undefined);
  assert.ok(!(await state(ben)).reviews.some(x => x.owner === 'Ana Ade'));
  assert.equal((await state(hr)).reviews.find(x => x.owner === 'Ana Ade').mgr.rating, 4);
  await no(act(ana, 'review.ack', {}));
  await no(act(hr, 'review.share', {name: 'Ana Ade'}));
  await ok(act(mo, 'review.share', {name: 'Ana Ade'}));
  r = (await state(ana)).reviews.find(x => x.owner === 'Ana Ade');
  assert.equal(r.mgr.rating, 4);
  await ok(act(ana, 'review.ack', {text: 'Agreed on next steps.'}));
  await no(act(ana, 'review.ack', {}));
});

test('leave goes to the line manager against a balance (WB-3)', async () => {
  const y = curY();
  await no(act(ana, 'leave.add', {from: `${y}-12-10`, to: `${y}-12-08`, type: 'Annual leave'}));
  await no(act(ana, 'leave.add', {from: `${y}-01-01`, to: `${y}-03-01`, type: 'Annual leave'}));   // over the allowance
  await ok(act(ana, 'leave.add', {from: `${y}-12-08`, to: `${y}-12-10`, type: 'Annual leave'}));
  await no(act(ana, 'leave.add', {from: `${y}-12-09`, to: `${y}-12-09`, type: 'Sick leave'}));     // overlaps
  const l = S.leave.find(x => x.owner === 'Ana Ade');
  for (const c of [ben, mia]) await no(act(c, 'leave.decide', {id: l.id, ok: true}));
  await ok(act(mo, 'leave.decide', {id: l.id, ok: true}));
  assert.equal(server.okr.M.leaveBal('Ana Ade', 'Annual leave'), 22);
  await ok(act(ben, 'leave.add', {from: `${y}-12-01`, to: `${y}-12-02`, type: 'Unpaid leave'}));   // no allowance, no limit
});

test('HR sends the weekly check-in and one reminder (WB-1, WB-2)', async () => {
  await no(act(ana, 'survey.send', {week: W}));
  await ok(act(hr, 'survey.send', {week: W}));
  await ok(act(ana, 'welfare.save', {week: W, workload: 4, mood: 3, note: 'Busy', enps: 9}));
  await no(act(ana, 'welfare.save', {week: W, workload: 9, mood: 3}));
  await ok(act(hr, 'survey.remind', {week: W}));
  await no(act(hr, 'survey.remind', {week: W}));
  assert.ok(!(await state(ben)).welfare.some(x => x.owner === 'Ana Ade'));
  assert.ok((await state(mo)).welfare.some(x => x.owner === 'Ana Ade'));
});

test('a role request runs through its chain and the hire starts onboarding (RQ-1 to RQ-5, ON-1, ON-2)', async () => {
  const req = {title: 'Growth Analyst', team: 'Growth', sub: 'NativeTalk', count: 1, kind: 'New headcount', etype: 'Permanent', why: 'Reporting eats two days a week.'};
  await no(act(ana, 'role.save', req));
  await no(act(mo, 'role.save', {...req, why: ''}));
  // Pay, cost centre and plan are not part of a role request, even if sent.
  await ok(act(mo, 'role.save', {...req, payMin: 100, payMax: 200, cost: 'X', budgeted: false}));
  const r = S.roles.find(x => x.title === 'Growth Analyst');
  assert.equal(r.payMax, undefined); assert.equal(r.cost, undefined); assert.equal(r.budgeted, undefined);
  assert.match(r.ref, /^REQ-\d{4}-\d{3}$/);
  assert.deepEqual(r.chain.map(s => s.role), ['Line manager', 'HR']);
  await no(act(mo, 'role.approve', {id: r.id}));
  await no(act(hr, 'role.approve', {id: r.id}));                         // not HR's step yet
  await ok(act(ceo, 'role.sendBack', {id: r.id, why: 'Add a cost centre.'}));
  assert.equal(r.status, 'Sent back');
  await ok(act(mo, 'role.save', {...req, id: r.id, cost: 'NT-01'}));
  assert.equal(r.status, 'In approval');
  await ok(act(ceo, 'role.approve', {id: r.id}));
  await ok(act(hr, 'role.approve', {id: r.id}));
  assert.equal(r.status, 'Open');
  await no(act(mo, 'role.fill', {id: r.id, how: 'Outside the company', name: 'Dee New', email: 'ana@x.co'}));   // email in use
  await ok(act(mo, 'role.fill', {id: r.id, how: 'Outside the company', name: 'Dee New', email: 'dee@x.co', start: today()}));
  assert.equal(r.status, 'Filled');
  assert.equal(P('Dee New').mgr, P('Mo Bello').id);
  const onb = S.onb.find(o => o.owner === 'Dee New');
  // The starter has no tasks of their own: every task belongs to HR or their line manager.
  assert.ok(onb.tasks.every(t => t.who === 'HR' || t.who === 'Manager'));
  const iHr = onb.tasks.findIndex(t => t.who === 'HR'), iMgr = onb.tasks.findIndex(t => t.who === 'Manager');
  await no(act(mo, 'onb.tick', {owner: 'Dee New', i: iHr}));
  await ok(act(hr, 'onb.tick', {owner: 'Dee New', i: iHr}));
  await no(act(ana, 'onb.tick', {owner: 'Dee New', i: iMgr}));
  await ok(act(mo, 'onb.tick', {owner: 'Dee New', i: iMgr}));
  // Members see nothing of hiring or onboarding.
  const a = await state(ana);
  assert.deepEqual([a.roles.length, a.onb.length], [0, 0]);
  assert.ok((await state(mo)).onb.some(o => o.owner === 'Dee New'));
  // The CEO step is off by default; Settings can add it to every request.
  await ok(act(mia, 'role.save', {...req, title: 'Partner Lead', sub: 'Connect', team: 'Product'}));
  assert.deepEqual(S.roles.find(x => x.title === 'Partner Lead').chain.map(s => s.role), ['Line manager', 'HR']);
  const c = S.cfg, from = {subs: c.subs, leave: c.leave.map(x => x.type), etypes: c.etypes, closeWhy: c.closeWhy, onbWho: c.onbWho};
  await ok(act(ceo, 'cfg.save', {cfg: {...c, execAll: 1}, from}));
  await ok(act(hr, 'role.save', {...req, title: 'People Partner', team: 'People', hm: 'Cleo Obi'}));
  const pp = S.roles.find(x => x.title === 'People Partner');
  assert.deepEqual(pp.chain.map(s => [s.role, s.state]), [['HR', 'Approved'], ['Exec sign-off', 'Pending']]);   // HR's own step clears itself
  await ok(act(ceo, 'cfg.save', {cfg: {...S.cfg, execAll: 0}, from}));
});

test('settings are HR and CEO only, and renames follow through (ST-1)', async () => {
  const c = JSON.parse(JSON.stringify(S.cfg)), from = {subs: [...c.subs], leave: c.leave.map(x => x.type), etypes: [...c.etypes], closeWhy: [...c.closeWhy], onbWho: [...c.onbWho]};
  await no(act(mo, 'cfg.save', {cfg: c, from}));
  await no(act(hr, 'cfg.save', {cfg: {...c, subs: c.subs.slice(1)}, from: {...from, subs: from.subs.slice(1)}}));   // NativeTalk is in use
  await no(act(hr, 'cfg.save', {cfg: {...c, subs: ['A', 'A', 'B']}, from}));
  await ok(act(hr, 'cfg.save', {cfg: {...c, subs: ['NativeTalk Ltd', ...c.subs.slice(1)], riskAt: 75}, from}));
  assert.equal(P('Ana Ade').sub, 'NativeTalk Ltd');
  assert.equal(S.roles.find(x => x.title === 'Growth Analyst').sub, 'NativeTalk Ltd');
  assert.equal(S.cfg.riskAt, 75);
  await no(act(hr, 'cfg.save', {cfg: {...S.cfg, behindAt: 90, riskAt: 80}, from: {...from, subs: S.cfg.subs}}));
});

test('renaming someone carries through every record; removing them ends their sign-in', async () => {
  await ok(act(hr, 'person.save', {id: P('Ana Ade').id, name: 'Ana Ade-Okon', email: 'ana@x.co', role: 'member', sub: 'NativeTalk Ltd', team: 'Growth', mgr: P('Mo Bello').id}));
  assert.ok(S.okrs.some(o => o.owner === 'Ana Ade-Okon') && !S.okrs.some(o => o.owner === 'Ana Ade'));
  assert.ok(S.reviews.some(r => r.owner === 'Ana Ade-Okon') && S.leave.some(l => l.owner === 'Ana Ade-Okon'));
  await no(act(hr, 'person.save', {id: P('Cleo Obi').id, email: 'cleo@x.co', role: 'member', sub: '', team: '', mgr: null}));   // HR can't edit the CEO
  await no(act(ceo, 'person.save', {id: P('Cleo Obi').id, email: 'cleo@x.co', role: 'member', sub: '', team: '', mgr: null}));  // nor demote yourself
  const cx = client();
  await ok(cx.post('/api/login', {email: 'cal@x.co', password: 'password1'}));
  await ok(act(hr, 'person.delete', {id: P('Cal Eze').id}));
  await no(cx.get('/api/state'), 401);
  await no(act(hr, 'person.add', {name: 'Cal Eze', email: 'cal2@x.co', role: 'member'}));               // still in past records
});

test('the CEO preview shows exactly what someone sees, read-only (SC-4)', async () => {
  ceo.as(P('Ben Uche').id);
  const s = await ok(ceo.get('/api/state'));
  assert.equal(s.previewing, true); assert.equal(s.effId, P('Ben Uche').id); assert.equal(s.realId, P('Cleo Obi').id);
  assert.ok(!s.S.okrs.some(o => o.owner === 'Ana Ade-Okon'));
  await no(act(ceo, 'stand.add', {text: 'as Ben'}), 403);
  ceo.as(null);
  mo.as(P('Ben Uche').id);                                                // ignored for anyone but the CEO
  assert.equal((await ok(mo.get('/api/state'))).effId, P('Mo Bello').id);
  mo.as(null);
});

test('HR imports people from a spreadsheet, skipping bad rows (DX-2)', async () => {
  const text = 'Name,Email,Subsidiary,Role,Team,Reports to\nZara Imp,zara@x.co,Connect,member,Product,Mia Cole\n,nobody@x.co,,,,\nBad Sub,bs@x.co,Nowhere,member,,\nYemi Imp,yemi@x.co,,manager,Ops,\nMo Bello,dup@x.co,,,,';
  await no(act(ana, 'people.import', {text}));
  const out = await ok(act(hr, 'people.import', {text}));
  assert.equal(out.added, 2); assert.equal(out.skipped.length, 3);
  assert.equal(P('Zara Imp').mgr, P('Mia Cole').id);
  assert.match((await ok(act(hr, 'people.import', {text: 'Email\nx@x.co'}))).error, /Name/);
});

test('documents carry a status and a file only the right people can open (DX-3)', async () => {
  await ok(act(hr, 'doc.add', {id: P('Ben Uche').id, name: 'Contract', type: 'Contract', status: 'Awaiting signature'}));
  const d = S.docs.find(x => x.owner === 'Ben Uche');
  await no(ana.call('PUT', `/api/docs/${d.id}/file`, null, {raw: '<script>x</script>', headers: {'Content-Type': 'text/html', 'X-File-Name': 'a.html'}}), 403);
  await ok(ben.call('PUT', `/api/docs/${d.id}/file`, null, {raw: '<script>x</script>', headers: {'Content-Type': 'text/html', 'X-File-Name': 'a.html'}}));
  assert.equal(d.status, 'On file');
  const got = await mo.get(`/api/docs/${d.id}/file`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'application/octet-stream');   // never served as a page
  assert.match(got.headers.get('content-disposition'), /attachment/);
  await no(ana.get(`/api/docs/${d.id}/file`), 403);
});

test('alerts are emailed, logged, batched daily and retried (NT-2, NT-3)', async () => {
  inbox.length = 0;
  const o = S.okrs.find(x => x.owner === 'Ana Ade-Okon' && x.krs.length === 3);
  await ok(act(ana, 'kr.set', {id: o.id, i: 0, done: true}));
  await server.okr.mailer.flush();
  const mail = inbox.find(m => m.includes('To: <mo@x.co>'));
  assert.ok(mail, 'the line manager was emailed');
  // Settings can hold an alert back for the daily email instead.
  const c = S.cfg, from = {subs: c.subs, leave: c.leave.map(x => x.type), etypes: c.etypes, closeWhy: c.closeWhy, onbWho: c.onbWho};
  await ok(act(hr, 'cfg.save', {cfg: {...c, mail: {...c.mail, modes: {...c.mail.modes, krDecided: 'off'}}}, from}));
  inbox.length = 0;
  await ok(act(mo, 'kr.decide', {id: o.id, i: 0, ok: false}));
  await server.okr.mailer.flush();
  assert.ok(!inbox.some(m => m.includes('To: <ana@x.co>')));
  // One digest per person per day, on a weekday after the set hour.
  const n = server.okr.mailer.runDigest(new Date(2026, 10, 4, 10));
  assert.ok(n > 0);
  assert.equal(server.okr.mailer.runDigest(new Date(2026, 10, 4, 11)), 0);
  assert.equal(server.okr.mailer.runDigest(new Date(2026, 10, 7, 10)), 0);   // a Saturday
  // A failed send is retried rather than lost, and HR can see it.
  failMail = true;
  await ok(act(ana, 'kr.set', {id: o.id, i: 0, done: true}));
  await server.okr.mailer.flush();
  failMail = false;
  const rep = await ok(hr.get('/api/mail'));
  assert.ok(rep.rows.some(r => r.status === 'queued' && r.attempts === 1 && /554/.test(r.error)));
  await no(ana.get('/api/mail'), 403);
  // No email ever carries a rating or review text.
  assert.ok(!inbox.some(m => /Strong half/.test(Buffer.from(m.split('\r\n\r\n')[1] || '', 'base64').toString())));
});

test('the page, its files and the security headers are served', async () => {
  for (const p of ['/', '/invite', '/app.js', '/model.js', '/app.css']) assert.equal((await fetch(base + p)).status, 200, p);
  assert.equal((await fetch(base + '/rules.js')).status, 404);
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const big = await fetch(base + '/api/state', {headers: {'accept-encoding': 'gzip', cookie: ''}});
  assert.equal(big.status, 401);
});

test('onboarding tasks from earlier builds pass from the new starter to the line manager', async () => {
  const d2 = openDb(':memory:');
  const put = (col, x) => d2.prepare('INSERT INTO docs (col, id, data) VALUES (?, ?, ?)').run(col, x.id, JSON.stringify(x));
  put('tmpl', {id: 't1', name: 'Default', sub: '', tasks: [{t: 'Meet people', who: 'New hire', off: 3}, {t: 'Contract', who: 'HR', off: -7}]});
  put('onb', {id: 'o1', owner: 'Zed', start: '2026-11-01', sub: '', from: 'Default', tasks: [{t: 'Meet people', who: 'New hire', off: 3, done: false, by: '', at: 0}]});
  put('cfg', {id: 'cfg', onbWho: ['HR', 'Manager', 'New hire'], reqExec: 1, execAt: 5});
  const s2 = createApp({db: d2, log: {error() {}}});
  const S2 = s2.okr.S;
  assert.equal(S2.tmpl[0].tasks[0].who, 'Manager');
  assert.equal(S2.onb[0].tasks[0].who, 'Manager');
  assert.deepEqual(S2.cfg.onbWho, ['HR', 'Manager']);
  assert.equal(S2.cfg.reqExec, undefined); assert.equal(S2.cfg.execAll, 0);
  // and it was saved, not just fixed in memory
  assert.equal(JSON.parse(d2.prepare("SELECT data FROM docs WHERE col = 'tmpl'").get().data).tasks[0].who, 'Manager');
  s2.okr.close();
});

test('a version 1 database is upgraded and keeps its goals', () => {
  const file = path.join(os.tmpdir(), `okr-v1-${process.pid}.db`);
  fs.rmSync(file, {force: true});
  const v1 = new DatabaseSync(file);
  v1.exec(SCHEMA_V1); v1.exec('PRAGMA user_version = 1');
  v1.prepare("INSERT INTO users (id, email, name, pass_hash, created_at) VALUES (1, 'old@x.co', 'Old Boss', 'x', 1)").run();
  v1.prepare("INSERT INTO people (id, name, role, team, user_id, created_at) VALUES (1, 'Old Boss', 'ceo', '', 1, 1), (2, 'Old Hand', 'member', 'Ops', NULL, 1)").run();
  v1.prepare('INSERT INTO okrs (id, objective, owner_id, year, created_at) VALUES (1, ?, 2, 2026, 1)').run('Keep the lights on');
  v1.prepare("INSERT INTO krs (okr_id, n, title, done, ap_by, ap_at) VALUES (1, 0, 'Fix it', 1, 1, 5), (1, 1, 'Ship it', 0, NULL, NULL)").run();
  v1.prepare("INSERT INTO prios (week, text, assignee_id, by_id, status, at) VALUES ('2026-11-02', 'x', 2, 1, 'Agreed', 1)").run();
  v1.close();
  const up = openDb(file);
  const docs = up.prepare('SELECT col, data FROM docs').all().map(r => ({col: r.col, ...JSON.parse(r.data)}));
  const okr = docs.find(d => d.col === 'okrs');
  assert.equal(okr.owner, 'Old Hand');
  assert.deepEqual(okr.krs.map(k => [k.pct, k.apBy]), [[100, 'Old Boss'], [0, '']]);
  assert.equal(docs.find(d => d.col === 'people' && d.name === 'Old Boss').uid, '1');
  assert.ok(!up.prepare("SELECT 1 FROM sqlite_master WHERE name = 'prios'").get());
  up.close();
  fs.rmSync(file, {force: true}); fs.rmSync(file + '-wal', {force: true}); fs.rmSync(file + '-shm', {force: true});
});
