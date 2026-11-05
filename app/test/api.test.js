// End-to-end checks of the API against the PRD's rules, calling the server directly (no page involved).
// Run with: npm test
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../src/db.js';
import {createApp, setupLink} from '../src/app.js';
import {curWeek, shiftDay} from '../public/rules.js';

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createApp({db, log: {error() {}}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

// A signed-in browser: keeps its session cookie and can preview as someone (CEO only).
function client() {
  let cookie = '', viewAs = null;
  const call = async (method, path, body, {noHeader} = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {'Content-Type': 'application/json', ...(noHeader ? {} : {'X-OKR': '1'}), ...(cookie ? {cookie} : {}), ...(viewAs ? {'X-View-As': String(viewAs)} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return {status: res.status, data: await res.json().catch(() => ({}))};
  };
  return {call, get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), del: p => call('DELETE', p), as: id => { viewAs = id; }};
}

const W = curWeek();
const ceo = client(), ana = client(), max = client(), sam = client(), hal = client();
const ids = {};
const state = async c => (await c.get('/api/state')).data;

test('the setup link creates the CEO account once', async () => {
  const token = new URL(setupLink(db, base)).searchParams.get('token');
  assert.equal((await ceo.post('/api/setup', {token: 'wrong', name: 'Cleo', email: 'cleo@x.co', password: 'password1'})).status, 400);
  assert.equal((await ceo.post('/api/setup', {token, name: 'Cleo', email: 'cleo@x.co', password: 'password1'})).status, 200);
  assert.equal((await client().post('/api/setup', {token, name: 'Eve', email: 'eve@x.co', password: 'password1'})).status, 400);
  assert.equal((await state(ceo)).me.role, 'ceo');
  assert.equal(setupLink(db, base), null);
});

test('writes without the app header are refused', async () => {
  assert.equal((await ceo.call('POST', '/api/people', {name: 'X', role: 'member'}, {noHeader: true})).status, 403);
});

test('new sign-ups see nothing until the CEO links them', async () => {
  for (const [c, name] of [[ana, 'ana'], [max, 'max'], [sam, 'sam'], [hal, 'hal']])
    assert.equal((await c.post('/api/signup', {name, email: `${name}@x.co`, password: 'password1'})).status, 200);
  assert.equal((await client().post('/api/signup', {name: 'Copy', email: 'ANA@x.co', password: 'password1'})).status, 409);
  assert.equal((await state(ana)).me, null);
  assert.equal((await ana.post('/api/stand', {week: W, text: 'x'})).status, 403);
  const signups = (await state(ceo)).signups;
  assert.equal(signups.length, 4);
  assert.equal((await ana.post(`/api/signups/${signups[0].id}/link`, {role: 'ceo', name: 'ana'})).status, 403);
  for (const [email, role, team] of [['ana@x.co', 'member', 'Growth'], ['max@x.co', 'manager', 'Growth'], ['sam@x.co', 'member', 'Sales'], ['hal@x.co', 'hr', '']]) {
    const u = signups.find(s => s.email === email);
    assert.equal((await ceo.post(`/api/signups/${u.id}/link`, {name: u.name, role, team})).status, 200);
  }
  const s = await state(ceo);
  assert.equal(s.signups.length, 0);
  s.people.forEach(p => { ids[p.name] = p.id; });
  ids.ceo = s.real.id;
});

test('OKRs need 2 to 20 key results and an owner the creator may choose', async () => {
  const add = (c, owner, n = 2) => c.post('/api/okrs', {owner, objective: 'Objective', krs: Array.from({length: n}, (_, i) => `KR ${i + 1}`)});
  assert.equal((await add(ana, ids.ana, 1)).status, 400);
  assert.equal((await add(ana, ids.ana, 21)).status, 400);
  assert.equal((await add(ana, ids.sam)).status, 403);
  assert.equal((await add(ana, 'company')).status, 403);
  assert.equal((await add(max, ids.sam)).status, 403);
  assert.equal((await add(hal, ids.hal)).status, 403);
  assert.equal((await add(ana, ids.ana, 4)).status, 200);
  assert.equal((await add(sam, ids.sam)).status, 200);
  assert.equal((await add(ceo, 'company')).status, 200);
});

test('members see their own OKRs, managers their team, HR and the CEO everyone', async () => {
  const owners = async c => new Set((await state(c)).okrs.map(o => o.owner));
  const a = await owners(ana), m = await owners(max), s = await owners(sam), h = await owners(hal);
  assert.deepEqual([...a].sort(), [ids.ana, 'company'].sort());
  assert.ok(!s.has(ids.ana));
  assert.ok(m.has(ids.ana) && !m.has(ids.sam));
  assert.ok(h.has(ids.ana) && h.has(ids.sam));
  assert.ok(!(await state(ana)).board.some(r => r.id === ids.sam), 'the leaderboard is team-only for members');
});

test('a completed key result counts only after the right manager approves it', async () => {
  const okr = (await state(ana)).okrs.find(o => o.owner === ids.ana), kr = okr.krs[0];
  assert.equal((await ana.post(`/api/krs/${kr.id}/status`, {done: true})).status, 200);
  let k = (await state(ana)).okrs.find(o => o.id === okr.id).krs[0];
  assert.equal(k.req, true);
  assert.equal(k.done, false);
  for (const c of [ana, sam, hal]) assert.equal((await c.post(`/api/krs/${kr.id}/approve`)).status, 403);
  assert.equal((await max.post(`/api/krs/${kr.id}/approve`)).status, 200);
  assert.equal((await max.post(`/api/krs/${kr.id}/approve`)).status, 409);
  k = (await state(ana)).okrs.find(o => o.id === okr.id).krs[0];
  assert.equal(k.done, true);
  assert.equal(k.apBy, ids.max);
  const row = (await state(ana)).board.find(r => r.id === ids.ana);
  assert.equal(row.annual, 25);
  assert.equal(row.gain, 25);
  assert.equal((await ana.post(`/api/krs/${kr.id}/status`, {done: false})).status, 403, 'only the CEO reopens');
  assert.equal((await ceo.post(`/api/krs/${kr.id}/status`, {done: false})).status, 200);
  const after = (await state(ana)).board.find(r => r.id === ids.ana);
  assert.equal(after.annual, 0);
  assert.equal(after.gain, 0);
});

test('a manager\'s request goes to the CEO, and the CEO\'s own key results count straight away', async () => {
  await max.post('/api/okrs', {owner: ids.max, objective: 'Hire', krs: ['a', 'b']});
  const o = (await state(max)).okrs.find(x => x.owner === ids.max);
  await max.post(`/api/krs/${o.krs[0].id}/status`, {done: true});
  assert.equal((await max.post(`/api/krs/${o.krs[0].id}/approve`)).status, 403);
  assert.equal((await ceo.post(`/api/krs/${o.krs[0].id}/approve`)).status, 200);
  const co = (await state(ceo)).okrs.find(x => x.owner === 'company');
  assert.equal((await ceo.post(`/api/krs/${co.krs[0].id}/status`, {done: true})).status, 200);
  assert.equal((await state(ana)).okrs.find(x => x.owner === 'company').krs[0].done, true);
});

test('HR is read-only', async () => {
  assert.equal((await hal.post('/api/stand', {week: W, text: 'x'})).status, 403);
  assert.equal((await hal.post('/api/prios', {week: W, text: 'x', assignee: ids.hal})).status, 403);
});

test('weekly entries belong to their owner, and a Friday review needs feedback', async () => {
  assert.equal((await ana.post('/api/stand', {week: shiftDay(W, 1), text: 'x'})).status, 400, 'weeks start on Monday');
  assert.equal((await ana.post('/api/stand', {week: W, text: 'Partner calls'})).status, 200);
  const st = (await state(ana)).stand[0];
  assert.equal((await sam.patch(`/api/stand/${st.id}`, {status: 'Done'})).status, 403);
  assert.equal((await max.patch(`/api/stand/${st.id}`, {status: 'Done'})).status, 403);
  assert.equal((await ceo.patch(`/api/stand/${st.id}`, {status: 'Done'})).status, 200);
  assert.equal((await state(sam)).stand.length, 0);
  assert.equal((await state(max)).stand.length, 1);
  assert.equal((await max.post('/api/prios', {week: W, text: 'Ship the pricing page', assignee: ids.sam})).status, 403);
  assert.equal((await max.post('/api/prios', {week: W, text: 'Ship the pricing page', assignee: ids.ana})).status, 200);
  const pr = (await state(ana)).prios[0];
  assert.equal(pr.by, ids.max);
  assert.equal(pr.status, 'Agreed');
  assert.equal((await ana.post(`/api/prios/${pr.id}/review`, {outcome: 'Done', pct: 90, feedback: ''})).status, 400);
  assert.equal((await max.post(`/api/prios/${pr.id}/review`, {outcome: 'Done', pct: 90, feedback: 'Fine'})).status, 403);
  assert.equal((await ana.post(`/api/prios/${pr.id}/review`, {outcome: 'Done', pct: 90, feedback: 'Shipped on Thursday'})).status, 200);
  const row = (await state(max)).board.find(r => r.id === ids.ana);
  assert.equal(row.reviewed, 1);
  assert.equal(row.reviewAvg, 90);
});

test('only the CEO can preview as someone else', async () => {
  ceo.as(ids.ana);
  const s = await state(ceo);
  assert.equal(s.me.id, ids.ana);
  assert.equal(s.real.id, ids.ceo);
  assert.equal((await ceo.post('/api/people', {name: 'Zed', role: 'member'})).status, 403, 'while previewing, the CEO acts as that person');
  ceo.as(null);
  sam.as(ids.ana);
  assert.equal((await state(sam)).me.id, ids.sam);
  sam.as(null);
});

test('people admin is CEO-only, and the CEO can\'t demote or remove themselves', async () => {
  assert.equal((await max.post('/api/people', {name: 'Zed', role: 'member'})).status, 403);
  assert.equal((await ana.patch(`/api/people/${ids.ana}`, {role: 'ceo', team: ''})).status, 403);
  assert.equal((await ceo.patch(`/api/people/${ids.ceo}`, {role: 'member', team: ''})).status, 400);
  assert.equal((await ceo.del(`/api/people/${ids.ceo}`)).status, 400);
  assert.equal((await ceo.post('/api/people', {name: 'ANA', role: 'member'})).status, 409);
  assert.equal((await ceo.patch(`/api/people/${ids.sam}`, {role: 'member', team: 'Growth'})).status, 200);
  assert.ok((await state(max)).okrs.some(o => o.owner === ids.sam), 'moving Sam to Growth shows their OKRs to Growth\'s manager');
});

test('a reset link works once and signs out old sessions', async () => {
  const {data} = await ceo.post(`/api/people/${ids.sam}/reset-link`);
  const token = new URL(data.url).searchParams.get('token');
  assert.equal((await client().post('/api/reset', {token, password: 'newpassword'})).status, 200);
  assert.equal((await sam.get('/api/state')).status, 401);
  assert.equal((await client().post('/api/reset', {token, password: 'another1'})).status, 400);
  assert.equal((await client().post('/api/login', {email: 'sam@x.co', password: 'password1'})).status, 401);
  assert.equal((await client().post('/api/login', {email: 'SAM@x.co', password: 'newpassword'})).status, 200);
});

test('the page is served with security headers, and nothing else on disk is', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(base + '/rules.js')).status, 200);
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/data/okr-tracker.db')).status, 404);
});
