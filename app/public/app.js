// Team OKR Tracker page. Built to the Team OKR Tracker PRD v1.0 (28 Oct 2026).
// The server sends only what the signed-in person may see and re-checks every change; the rules imported here decide which controls to show.
import * as R from './rules.js';

const {ROLES, SSTAT, PSTAT, OUTCOMES, KR_MIN, KR_MAX} = R;
const ROLE_TONE = {ceo: 'vio', hr: 'sky', manager: 'tea', member: ''};
const TABS = [
  ['dashboard', 'Dashboard', 'Overview'],
  ['okrs', 'OKRs', 'Goals'],
  ['approvals', 'Approvals', 'Goals'],
  ['standup', 'Standup', 'Weekly'],
  ['achievements', 'Achievements', 'Weekly'],
  ['priorities', 'Priorities', 'Weekly'],
  ['review', 'Friday review', 'Weekly'],
  ['people', 'People', 'Admin'],
];

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const isoWeekNo = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const wd = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - wd); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
const dm = d => d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
const weekLabel = w => { const a = R.parseIso(w), b = R.parseIso(R.shiftDay(w, 6)); return `Week ${isoWeekNo(a)} · ${a.getMonth() === b.getMonth() ? a.getDate() : dm(a)}–${dm(b)}`; };
const dateOf = t => t ? dm(new Date(t)) : '';
const share = n => { const r = Math.round(n * 10) / 10; return (Number.isInteger(r) ? r : r.toFixed(1)) + '%'; };
const pctTxt = n => Math.round(n) + '%';
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const ini = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
const hue = n => [...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 6;
const rid = () => Math.random().toString(36).slice(2, 9);
const byName = (a, b) => a.name.localeCompare(b.name);
const ownerVal = v => v === 'company' ? 'company' : Number(v);

// ---------- state ----------
let S = {people: [], signups: [], okrs: [], stand: [], ach: [], prios: [], board: [], me: null, real: null, account: null, year: new Date().getFullYear()};
const keep = {};
let phase = 'boot', needsSetup = false, offline = false, events = null;
let wk = R.curWeek(), tab = 'dashboard', viewAs = '', navOpen = false, confirmKey = null, showOkrForm = false, resetShown = null;
let okrDraft = [rid(), rid()];
const params = new URLSearchParams(location.search);

// ---------- people and rules, applied to what the server sent ----------
const person = id => S.people.find(p => p.id === id) || null;
const pname = id => id === 'company' ? 'Company' : (person(id)?.name || 'Former member');
const eff = () => S.me;
const realMe = () => S.real;
const ro = e => R.readOnly(e);
const tabAllowed = (t, e) => t === 'approvals' ? R.isApprover(e) : t === 'people' ? R.isAll(e) : TABS.some(x => x[0] === t);
const scope = e => R.scopeIds(e, S.people);
const personalOkrs = id => S.okrs.filter(o => o.owner === id);
const companyOkrs = () => S.okrs.filter(o => o.owner === 'company');
const annual = id => R.avgPct(personalOkrs(id));
const awaitingCount = list => list.reduce((n, o) => n + o.krs.filter(k => k.req && !k.done).length, 0);
const canApprove = (e, ownerId) => R.canApprove(e, person(ownerId));
function approverOf(o) { const ms = R.approversOf(person(o.owner), S.people); return ms.length ? ms.map(m => m.name).join(' or ') : 'the CEO'; }
function pendingFor(e) {
  if (!R.isApprover(e)) return [];
  const out = [];
  S.okrs.forEach(o => o.krs.forEach(k => { if (k.req && !k.done && canApprove(e, o.owner)) out.push({o, k}); }));
  return out.sort((a, b) => (a.k.reqAt || 0) - (b.k.reqAt || 0));
}
const ownerOpts = (e, withCompany) => R.ownerChoices(e, S.people, withCompany).map(v => ({v, l: v === e.id ? `${e.name} (you)` : pname(v)}));
const reviewStats = list => { const rv = list.filter(p => p.reviewed); return {n: rv.length, avg: rv.length ? rv.reduce((s, p) => s + (+p.pct || 0), 0) / rv.length : 0}; };

// ---------- talking to the server ----------
const headers = () => ({'Content-Type': 'application/json', 'X-OKR': '1', ...(viewAs ? {'X-View-As': String(viewAs)} : {})});
async function api(method, path, body) {
  let res;
  try { res = await fetch(path, {method, headers: headers(), credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body)}); }
  catch { throw new Error('Can\'t reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !/^\/api\/(login|signup|setup|reset)$/.test(path)) { toLogin(data); throw new Error('Your session ended. Sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
// Runs one change, shows `ok` on success, then reloads the data. Returns the server's answer, or null if it failed.
async function act(method, path, body, ok) {
  try { const out = await api(method, path, body); if (ok) toast(ok); await refresh(); return out; }
  catch (err) { toast(err.message); render(); return null; }
}
let loading = null, again = false;
function refresh() {
  if (loading) { again = true; return loading; }
  loading = (async () => { do { again = false; await load(); } while (again); })().finally(() => { loading = null; });
  return loading;
}
async function load() {
  try {
    const res = await fetch(`/api/state?week=${encodeURIComponent(wk)}`, {headers: headers(), credentials: 'same-origin'});
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return toLogin(data);
    if (!res.ok) throw new Error(data.error);
    offline = false;
    S = {...S, ...data};
    if (!data.me) { phase = 'waiting'; S.me = null; }
    else {
      phase = 'app';
      if (viewAs && data.me.id === data.real.id) viewAs = '';
      if (data.week) wk = data.week;
    }
    listen();
  } catch { offline = true; }
  render();
}
function toLogin(data) { needsSetup = !!data?.needsSetup; stopListening(); if (!['login', 'signup'].includes(phase)) phase = 'login'; render(); }
// Live updates: the server says "something changed" and the page reloads its data.
function listen() {
  if (events) return;
  events = new EventSource('/api/events');
  events.onmessage = () => refresh();
}
function stopListening() { if (events) { events.close(); events = null; } }

// ---------- actions ----------
const val = id => { const el = document.getElementById(id); return el ? el.value : (keep[id] ?? ''); };
const clearKeep = (...pre) => Object.keys(keep).forEach(k => { if (pre.some(p => k.startsWith(p))) delete keep[k]; });
const clearField = id => { delete keep[id]; const el = document.getElementById(id); if (el) el.value = ''; };
let busy = false;
async function once(fn) { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }

async function onKr(oid, kid, v) {
  const e = eff(), o = S.okrs.find(x => x.id === oid), k = o?.krs.find(x => x.id === kid);
  if (!o || !k) return;
  const done = v === 'done';
  const msg = done ? (R.canDirect(e, o) ? 'Marked complete.' : `Sent to ${approverOf(o)} for approval.`) : (k.done ? 'Key result reopened.' : 'Request withdrawn.');
  await act('POST', `/api/krs/${kid}/status`, {done}, msg);
}
async function saveOkr() {
  const e = eff(), owners = R.ownerChoices(e, S.people, true);
  const owner = owners.length === 1 ? e.id : ownerVal(val('okr-owner') || e.id);
  const objective = val('okr-obj').trim(), krs = okrDraft.map(r => val('okr-kr-' + r).trim()).filter(Boolean);
  if (!objective) return toast('Write the objective before saving.');
  if (krs.length < KR_MIN) return toast('Add at least 2 key results before saving.');
  if (await act('POST', '/api/okrs', {owner, objective, krs}, 'OKR saved.')) { showOkrForm = false; resetOkrDraft(); render(); }
}
function resetOkrDraft() { okrDraft = [rid(), rid()]; clearKeep('okr-'); }
async function addEntry(kind, field, empty, ok) {
  const text = val(field).trim();
  if (!text) return toast(empty);
  if (await act('POST', `/api/${kind}`, {week: wk, text}, ok)) clearField(field);
}
async function addPrio() {
  const e = eff(), owners = R.ownerChoices(e, S.people, false), text = val('pr-text').trim();
  const assignee = owners.length === 1 ? e.id : Number(val('pr-owner') || e.id);
  if (!text) return toast('Write the priority before adding it.');
  if (await act('POST', '/api/prios', {week: wk, text, assignee}, assignee === e.id ? 'Priority added.' : `Priority assigned to ${pname(assignee)}.`)) clearField('pr-text');
}
async function saveReview(id) {
  const outcome = val('rv-o-' + id), raw = String(val('rv-p-' + id)).trim(), feedback = val('rv-f-' + id).trim(), pct = Number(raw);
  if (!OUTCOMES.includes(outcome) || raw === '' || !Number.isFinite(pct) || pct < 0 || pct > 100 || !feedback)
    return toast('Add an outcome, a percentage from 0 to 100 and written feedback before saving.');
  if (await act('POST', `/api/prios/${id}/review`, {outcome, pct, feedback}, 'Review saved.')) ['rv-o-', 'rv-p-', 'rv-f-'].forEach(x => delete keep[x + id]);
}
async function addPerson() {
  const name = val('pp-name').trim();
  if (!name) return toast('Add the person\'s name.');
  if (await act('POST', '/api/people', {name, role: val('pp-role') || 'member', team: val('pp-team').trim()}, `${name} added.`)) { clearField('pp-name'); clearField('pp-team'); delete keep['pp-role']; }
}
async function savePerson(id) {
  const p = person(id);
  if (!p) return;
  const role = id === realMe().id ? 'ceo' : val('pe-role-' + id);
  if (await act('PATCH', `/api/people/${id}`, {role, team: val('pe-team-' + id).trim()}, `Saved. ${p.name}'s access has changed.`)) { delete keep['pe-role-' + id]; delete keep['pe-team-' + id]; }
}
async function makeResetLink(id) {
  const out = await act('POST', `/api/people/${id}/reset-link`, {});
  if (out?.url) { resetShown = {id, url: out.url}; render(); }
}
async function linkSignup(uid) {
  const link = val('su-link-' + uid);
  const body = {person: link ? Number(link) : null, name: val('su-name-' + uid).trim(), role: val('su-role-' + uid) || 'member', team: val('su-team-' + uid).trim()};
  if (!link && !body.name) return toast('Add a name for this person.');
  if (await act('POST', `/api/signups/${uid}/link`, body, link ? `Linked to ${pname(Number(link))}.` : `${body.name} added.`)) clearKeep('su-');
}
const DEL_PATHS = {okrs: 'okrs', stand: 'stand', ach: 'ach', prios: 'prios', people: 'people', signups: 'signups'};
async function doDelete(kind, id) {
  confirmKey = null;
  if (!DEL_PATHS[kind]) return;
  await act('DELETE', `/api/${DEL_PATHS[kind]}/${id}`, undefined, kind === 'people' ? 'Person removed.' : kind === 'signups' ? 'Sign-in dismissed.' : 'Deleted.');
}

// ---------- signing in ----------
async function authSubmit(kind) {
  const bodies = {
    login: () => ({email: val('a-email').trim(), password: val('a-pass')}),
    signup: () => ({name: val('a-name').trim(), email: val('a-email').trim(), password: val('a-pass')}),
    setup: () => ({token: params.get('token'), name: val('a-name').trim(), email: val('a-email').trim(), team: val('a-team').trim(), password: val('a-pass')}),
    reset: () => ({token: params.get('token'), password: val('a-pass')}),
  };
  const body = bodies[kind]();
  if (kind !== 'login' && String(body.password || '').length < 8) return toast('Use a password of at least 8 characters.');
  try { await api('POST', '/api/' + kind, body); }
  catch (err) { return toast(err.message); }
  clearKeep('a-');
  if (kind === 'setup' || kind === 'reset') history.replaceState(null, '', '/');
  if (kind === 'reset') toast('Password changed. You\'re signed in.');
  phase = 'boot';
  await refresh();
}
async function signOut() {
  try { await api('POST', '/api/logout', {}); } catch { /* signed out locally either way */ }
  stopListening(); viewAs = ''; phase = 'login'; S = {...S, me: null, real: null}; render();
}

// ---------- html helpers ----------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  okrs: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  approvals: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.5"/>',
  standup: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  achievements: '<path d="M12 4.5l2.2 4.5 5 .7-3.6 3.5.85 4.9-4.45-2.35L7.55 18.1l.85-4.9L4.8 9.7l5-.7z"/>',
  priorities: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  review: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
const icon = k => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ''}</svg>`;
const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
const bar = (p, c = '') => `<div class="bar ${c}" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div>`;
const avatar = (n, sm) => `<span class="avatar ${sm ? 'sm ' : ''}av${hue(n)}" aria-hidden="true">${esc(ini(n))}</span>`;
const pageHead = (title, sub, right = '') => `<div class="pagehead"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>${right}</div>`;
const empty = msg => `<div class="empty"><p>${esc(msg)}</p></div>`;
const opts = (list, sel) => list.map(o => `<option value="${esc(o.v)}"${String(o.v) === String(sel) ? ' selected' : ''}>${esc(o.l)}</option>`).join('');
const sopts = (list, sel) => opts(list.map(x => ({v: x, l: x})), sel);
const roleOpts = sel => opts(Object.entries(ROLES).map(([v, l]) => ({v, l})), sel);
const stat = (tone, label, n, sub, pct, to) => `<button class="stat ${tone}" data-act="tab" data-t="${to}"><span class="l">${esc(label)}</span><span class="n">${esc(n)}</span>${pct != null ? bar(pct) : ''}<span class="s">${esc(sub)}</span></button>`;
const weekNav = () => `<div class="weeknav"><button class="btn ghost sm" data-act="wk-prev" aria-label="Previous week">‹</button><span class="lab">${esc(weekLabel(wk))}</span><button class="btn ghost sm" data-act="wk-next" aria-label="Next week">›</button><button class="btn ghost sm" data-act="wk-now"${wk === R.curWeek() ? ' disabled' : ''}>This week</button></div>`;
const youChip = (id, e) => id === e.id ? chip('You', 'acc') : '';
function delBtn(kind, id, label = 'Delete', ask = 'Delete this?') {
  if (confirmKey === kind + ':' + id) return `<span class="confirm"><span class="sub">${esc(ask)}</span><button class="btn sm bad" data-act="del-yes" data-kind="${kind}" data-id="${id}">${esc(label)}</button><button class="btn sm quiet" data-act="del-no">Cancel</button></span>`;
  return `<button class="btn sm quiet" data-act="del" data-kind="${kind}" data-id="${id}">${esc(label)}</button>`;
}
function groupBy(items, key, e) {
  const m = new Map();
  items.forEach(x => { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); });
  return [...m.entries()].sort(([a], [b]) => a === e.id ? -1 : b === e.id ? 1 : pname(a).localeCompare(pname(b)));
}

// ---------- views ----------
function viewDashboard(e) {
  const myPrios = S.prios.filter(p => p.assignee === e.id), done = myPrios.filter(p => p.status === 'Done').length;
  const cos = companyOkrs(), cpct = R.avgPct(cos), mine = personalOkrs(e.id);
  let stats;
  if (e.role === 'hr') {
    const avgA = S.board.length ? S.board.reduce((s, r) => s + r.annual, 0) / S.board.length : 0;
    const pd = S.prios.filter(p => p.status === 'Done').length;
    stats = [
      stat('ind', 'Average annual progress', pctTxt(avgA), `Across ${plural(S.board.length, 'person', 'people')}`, avgA, 'okrs'),
      stat('tea', 'Priorities done', `${pd}/${S.prios.length}`, 'Everyone, this week', null, 'priorities'),
      stat('amb', 'Awaiting approval', String(awaitingCount(S.okrs)), 'Key results company-wide', null, 'okrs'),
    ];
  } else {
    const a = annual(e.id), waiting = pendingFor(e).length;
    stats = [
      stat('ind', 'Your annual OKR progress', pctTxt(a), mine.length ? `${plural(mine.length, 'OKR', 'OKRs')} in ${S.year}` : 'No OKRs yet', a, 'okrs'),
      stat('tea', 'Priorities done', `${done}/${myPrios.length}`, myPrios.length ? 'Your priorities this week' : 'No priorities this week', null, 'priorities'),
      stat('amb', 'Awaiting approval', String(awaitingCount(mine)), 'Of your key results', null, 'okrs'),
      ...(R.isApprover(e) ? [stat('ros', 'Waiting for you', String(waiting), waiting ? 'Requests to approve' : 'Nothing to approve', null, 'approvals')] : []),
    ];
  }
  const okrLine = o => `<div><div class="row between"><span class="grow">${esc(o.objective)}</span><span class="pc">${pctTxt(R.okrPct(o))}</span></div>${bar(R.okrPct(o))}</div>`;
  const myCard = e.role === 'hr' ? '' : `<section class="card"><div class="sec-h"><h2>Your OKRs</h2><button class="btn quiet sm" data-act="tab" data-t="okrs">Open OKRs</button></div>${mine.length ? `<div class="list">${mine.map(okrLine).join('')}</div>` : empty(`You have no OKRs for ${S.year} yet. Add one on the OKRs page.`)}</section>`;
  const coCard = `<section class="card"><div class="sec-h"><h2>Company OKRs</h2>${cos.length ? `<span class="pc">${pctTxt(cpct)}</span>` : ''}</div>${cos.length ? `${bar(cpct)}<div class="list">${cos.map(okrLine).join('')}</div>` : empty('No company OKRs yet. The CEO sets these for everyone.')}${e.role === 'ceo' && !cos.length ? '<div class="row end"><button class="btn sm" data-act="okr-new" data-owner="company">Add a company OKR</button></div>' : ''}</section>`;
  return `${pageHead(`Hello, ${e.name.split(' ')[0]}`, 'Where you stand on your annual OKRs and this week\'s work.', weekNav())}
    <div class="stats">${stats.join('')}</div>
    <div class="cols"><div class="stack">${myCard}${coCard}</div><div class="stack">${leaderboard(e)}</div></div>`;
}
function leaderboard(e) {
  const rows = S.board.map(r => ({...r, name: pname(r.id)})).sort((x, y) => y.annual - x.annual || y.gain - x.gain || x.name.localeCompare(y.name));
  const when = wk === R.curWeek() ? 'this week' : 'that week';
  const body = rows.length ? `<div class="list">${rows.map((r, i) => `<div class="lbrow${r.id === e.id ? ' me' : ''}">
      <span class="medal${i < 3 && r.annual > 0 ? ' m' + (i + 1) : ''}">${i + 1}</span>${avatar(r.name)}
      <div class="lbname"><b>${esc(r.name)}</b><div class="krmeta">${Math.abs(r.gain) > 1e-9 ? chip(`${r.gain > 0 ? '+' : '−'}${share(Math.abs(r.gain))} ${when}`, r.gain > 0 ? 'good' : 'bad') : ''}${r.reviewed ? chip(`${r.reviewed} reviewed · avg ${pctTxt(r.reviewAvg)}`, 'acc') : ''}</div></div>
      ${bar(r.annual, r.annual >= 70 ? 'good' : '')}<span class="pc">${pctTxt(r.annual)}</span></div>`).join('')}</div>` : empty('Nobody to rank yet.');
  return `<section class="card"><div class="sec-h"><h2>Weekly leaderboard</h2><span class="sub">${R.isAll(e) ? 'Everyone' : e.team ? esc(e.team) : 'Just you, until you join a team'} · approved annual progress</span></div>${body}</section>`;
}

function okrForm(e) {
  const owners = ownerOpts(e, true), n = okrDraft.length, sh = share(100 / n);
  return `<form class="card" data-form="okr" autocomplete="off">
    <div class="sec-h"><h2>Add an OKR</h2><span class="sub">Each key result is worth an equal share of 100%.</span></div>
    <div class="formgrid">
      ${owners.length > 1 ? `<label class="f">Owner<select id="okr-owner" class="k">${opts(owners, e.id)}</select></label>` : `<label class="f">Owner<input type="text" value="${esc(e.name)}" disabled></label>`}
      <label class="f">Objective<input type="text" id="okr-obj" class="k" maxlength="200" placeholder="For example: Make onboarding feel effortless"></label>
    </div>
    <div class="lbl">Key results · ${n} × ${sh}</div>
    <div class="list">${okrDraft.map((r, i) => `<div class="krrow"><span class="n num">${i + 1}</span><input type="text" id="okr-kr-${r}" class="k" maxlength="200" placeholder="A result you can mark done" aria-label="Key result ${i + 1}">${chip(sh, 'acc')}<button type="button" class="btn quiet sm" data-act="kr-del" data-id="${r}"${n <= KR_MIN ? ' disabled' : ''} aria-label="Remove key result ${i + 1}">Remove</button></div>`).join('')}</div>
    <div class="row between"><button type="button" class="btn ghost sm" data-act="kr-add"${n >= KR_MAX ? ' disabled' : ''}>+ Add key result</button>
      <div class="acts"><button type="button" class="btn quiet" data-act="okr-cancel">Cancel</button><button class="btn" type="submit">Save OKR</button></div></div>
  </form>`;
}
function krRow(o, k, e) {
  const status = k.done ? chip(k.apBy && k.apBy !== o.owner ? `${o.owner === 'company' ? 'Completed' : 'Approved'} by ${pname(k.apBy)}` : 'Completed', 'good')
    : k.req ? chip(canApprove(e, o.owner) ? 'Awaiting your approval' : `Awaiting approval from ${approverOf(o)}`, 'amb')
    : chip('Not completed');
  const showSel = R.canDirect(e, o) || (R.canRequest(e, o) && !k.done) || (k.done && R.canReopen(e));
  const sel = showSel ? `<select class="sm" data-chg="kr" data-o="${o.id}" data-k="${k.id}" aria-label="Status of ${esc(k.title)}"><option value="not">Not completed</option><option value="done"${k.done || k.req ? ' selected' : ''}>Completed</option></select>` : '';
  const appr = k.req && !k.done && canApprove(e, o.owner)
    ? `<button class="btn sm" data-act="appr-ok" data-o="${o.id}" data-k="${k.id}">Approve</button><button class="btn sm ghost" data-act="appr-back" data-o="${o.id}" data-k="${k.id}">Send back</button>` : '';
  return `<div class="kr"><div class="t">${esc(k.title)}<div class="krmeta">${status}</div></div><div class="acts">${appr}${sel}</div></div>`;
}
function okrCard(o, e) {
  const pc = R.okrPct(o);
  return `<article class="card">
    <div class="okr-h"><div class="grow"><h3>${esc(o.objective)}</h3><p class="sub">${esc(pname(o.owner))} · ${plural(o.krs.length, 'key result', 'key results')} · ${share(R.krWeight(o))} each</p></div><span class="big">${pctTxt(pc)}</span></div>
    ${bar(pc, pc >= 70 ? 'good' : '')}
    <div class="list">${o.krs.map(k => krRow(o, k, e)).join('')}</div>
    ${R.canDeleteOkr(e, o) ? `<div class="row end">${delBtn('okrs', o.id, 'Delete OKR', 'Delete this OKR for everyone?')}</div>` : ''}
  </article>`;
}
function viewOkrs(e) {
  const can = !ro(e);
  const head = pageHead('OKRs', `Annual objectives for ${S.year}. A key result counts toward progress once it's approved.`, can && !showOkrForm ? '<button class="btn" data-act="okr-new">Add an OKR</button>' : '');
  const cos = companyOkrs();
  const company = `<section class="block"><div class="sec-h"><h2>Company OKRs</h2>${cos.length ? `<span class="sub">Average ${pctTxt(R.avgPct(cos))}</span>` : ''}</div>${cos.length ? cos.map(o => okrCard(o, e)).join('') : `<div class="card">${empty('No company OKRs yet. The CEO sets these for everyone to see.')}</div>`}</section>`;
  const ids = [...scope(e)].filter(id => person(id)?.role !== 'hr' || id === e.id).sort((a, b) => a === e.id ? -1 : b === e.id ? 1 : pname(a).localeCompare(pname(b)));
  const withOkrs = ids.filter(id => personalOkrs(id).length), without = ids.filter(id => !personalOkrs(id).length && id !== e.id);
  const sections = withOkrs.map(id => `<section class="block"><div class="sec-h"><div class="person-h">${avatar(pname(id))}<h2>${esc(pname(id))}</h2>${youChip(id, e)}</div><span class="sub">Annual progress <b class="num">${pctTxt(annual(id))}</b></span></div>${personalOkrs(id).map(o => okrCard(o, e)).join('')}</section>`).join('');
  const mineEmpty = e.role !== 'hr' && !personalOkrs(e.id).length ? `<section class="block"><div class="sec-h"><h2>Your OKRs</h2></div><div class="card">${empty('You have no OKRs yet. Add one with at least 2 key results.')}</div></section>` : '';
  const none = without.length ? `<p class="sub">No OKRs yet: ${without.map(id => esc(pname(id))).join(', ')}</p>` : '';
  return head + (can && showOkrForm ? okrForm(e) : '') + mineEmpty + company + sections + none;
}
function viewApprovals(e) {
  const list = pendingFor(e);
  const head = pageHead('Approvals', e.role === 'ceo' ? 'Completed key results waiting for you. Managers\' requests come to you, and you can approve anyone\'s.' : 'Key results your team marked complete. Approve them to count toward progress, or send them back.');
  if (!list.length) return head + `<div class="card">${empty('Nothing is waiting for your approval.')}</div>`;
  return head + `<div class="card"><div class="list">${list.map(({o, k}) => `<div class="block">
      <div class="person-h">${avatar(pname(o.owner))}<div class="grow"><b>${esc(pname(o.owner))}</b><div class="sub">${esc(o.objective)}</div></div><span class="sub">Requested ${esc(dateOf(k.reqAt))}</span></div>
      <div class="kr"><div class="t">${esc(k.title)}<div class="krmeta">${chip(`${share(R.krWeight(o))} of this OKR`, 'acc')}${chip(`+${share(R.krWeight(o) / (personalOkrs(o.owner).length || 1))} annual progress`)}</div></div>
      <div class="acts"><button class="btn sm" data-act="appr-ok" data-o="${o.id}" data-k="${k.id}">Approve</button><button class="btn sm ghost" data-act="appr-back" data-o="${o.id}" data-k="${k.id}">Send back</button></div></div>
    </div>`).join('')}</div></div>`;
}
function viewStandup(e) {
  const items = [...S.stand].sort((a, b) => (a.at || 0) - (b.at || 0));
  const form = !ro(e) ? `<form class="card" data-form="st" autocomplete="off"><div class="row"><label class="sr" for="st-text">Activity</label><input type="text" id="st-text" class="k grow" maxlength="300" placeholder="What are you working on this week?"><button class="btn" type="submit">Add</button></div></form>` : '';
  const groups = groupBy(items, 'owner', e);
  const body = groups.length ? groups.map(([id, list]) => {
    const d = list.filter(x => x.status === 'Done').length;
    return `<section class="card"><div class="person-h">${avatar(pname(id))}<h3 class="grow">${esc(pname(id))}</h3>${youChip(id, e)}<span class="sub num">${d} of ${list.length} done</span></div>
      <div class="list">${list.map(x => { const can = R.canEditEntry(e, x.owner), i = Math.max(0, SSTAT.indexOf(x.status)); return `<div class="kr"><div class="t">${esc(x.text)}</div><div class="acts"><span class="sbar s${i}" aria-hidden="true"><i></i></span><select class="sm" data-chg="st" data-id="${x.id}" aria-label="Status"${can ? '' : ' disabled'}>${sopts(SSTAT, x.status)}</select>${can ? delBtn('stand', x.id) : ''}</div></div>`; }).join('')}</div></section>`;
  }).join('') : `<div class="card">${empty('No activities logged for this week yet.')}</div>`;
  return pageHead('Weekly standup', 'What everyone is working on, with a status for each activity.', weekNav()) + form + body;
}
function viewAchievements(e) {
  const items = [...S.ach].sort((a, b) => (b.at || 0) - (a.at || 0));
  const form = !ro(e) ? `<form class="card" data-form="ach" autocomplete="off"><div class="row"><label class="sr" for="ach-text">Achievement</label><input type="text" id="ach-text" class="k grow" maxlength="300" placeholder="What did you get done that's worth celebrating?"><button class="btn" type="submit">Record</button></div></form>` : '';
  const body = items.length ? `<div class="card"><div class="list">${items.map(x => `<div class="ach">${avatar(pname(x.owner))}<div class="t"><div>${esc(x.text)}</div><div class="sub">${esc(pname(x.owner))} · ${esc(dateOf(x.at))}</div></div>${R.canEditEntry(e, x.owner) ? delBtn('ach', x.id) : ''}</div>`).join('')}</div></div>`
    : `<div class="card">${empty('No achievements recorded for this week yet.')}</div>`;
  return pageHead('Weekly achievements', 'Wins from the week, newest first.', weekNav()) + form + body;
}
function viewPriorities(e) {
  const items = [...S.prios].sort((a, b) => (a.at || 0) - (b.at || 0)), owners = ownerOpts(e, false);
  const form = !ro(e) ? `<form class="card" data-form="pr" autocomplete="off"><div class="row"><label class="sr" for="pr-text">Priority</label><input type="text" id="pr-text" class="k grow" maxlength="300" placeholder="What has to get done this week?">${owners.length > 1 ? `<label class="sr" for="pr-owner">Owner</label><select id="pr-owner" class="k">${opts(owners, e.id)}</select>` : ''}<button class="btn" type="submit">Add</button></div></form>` : '';
  const groups = groupBy(items, 'assignee', e);
  const body = groups.length ? groups.map(([id, list]) => {
    const d = list.filter(p => p.status === 'Done').length;
    return `<section class="card"><div class="person-h">${avatar(pname(id))}<h3 class="grow">${esc(pname(id))}</h3>${youChip(id, e)}<span class="sub num">${d} of ${list.length} done</span></div>
      <div class="list">${list.map(p => { const can = R.canEditPrio(e, p); return `<div class="kr"><div class="t">${esc(p.text)}${p.by && p.by !== p.assignee ? `<div class="krmeta">${chip('Assigned by ' + pname(p.by), 'vio')}</div>` : ''}</div><div class="acts"><select class="sm" data-chg="pr" data-id="${p.id}" aria-label="Status"${can ? '' : ' disabled'}>${sopts(PSTAT, p.status)}</select>${can ? delBtn('prios', p.id) : ''}</div></div>`; }).join('')}</div></section>`;
  }).join('') : `<div class="card">${empty('No priorities agreed for this week yet.')}</div>`;
  return pageHead('Weekly priorities', 'What each person has agreed to get done this week. Managers can assign priorities to their team.', weekNav()) + form + body;
}
function reviewBlock(p, e) {
  if (R.canReview(e, p)) {
    const id = p.id;
    return `<form class="rv" data-form="rv" data-id="${id}">
      <div class="rvgrid"><label class="f">Outcome<select id="rv-o-${id}" class="k"><option value="">Choose an outcome</option>${sopts(OUTCOMES, p.outcome)}</select></label>
      <label class="f">Done (%)<input type="number" id="rv-p-${id}" class="k" min="0" max="100" step="5" inputmode="numeric" value="${p.pct ?? ''}"></label></div>
      <label class="f">Feedback<textarea id="rv-f-${id}" class="k" rows="2" maxlength="1000" placeholder="What went well, and what got in the way?">${esc(p.feedback || '')}</textarea></label>
      <div class="row end">${p.reviewed ? chip('Reviewed', 'good') : ''}<button class="btn sm" type="submit">${p.reviewed ? 'Update review' : 'Save review'}</button></div>
    </form>`;
  }
  return p.reviewed ? `<div class="krmeta">${chip(p.outcome, 'good')}${chip(p.pct + '%', 'acc')}</div><p class="quote">${esc(p.feedback)}</p>` : `<div class="krmeta">${chip('Not reviewed yet')}</div>`;
}
function viewReview(e) {
  const items = S.prios.filter(p => scope(e).has(p.assignee)).sort((a, b) => (a.at || 0) - (b.at || 0));
  const friday = new Date().getDay() === 5 && wk === R.curWeek();
  const mineOpen = items.filter(p => p.assignee === e.id && !p.reviewed).length;
  const nudge = friday && mineOpen && !ro(e) ? `<div class="banner info"><span>It's Friday. Report back on how ${plural(mineOpen, 'priority', 'priorities')} went this week.</span></div>` : '';
  const groups = groupBy(items, 'assignee', e);
  const body = groups.length ? groups.map(([id, list]) => {
    const rs = reviewStats(list);
    return `<section class="card"><div class="person-h">${avatar(pname(id))}<h3 class="grow">${esc(pname(id))}</h3>${youChip(id, e)}<span class="sub num">${rs.n} of ${list.length} reviewed${rs.n ? ` · avg ${pctTxt(rs.avg)}` : ''}</span></div>
      <div class="list">${list.map(p => `<div><div class="kr"><div class="t"><b>${esc(p.text)}</b></div>${chip(p.status, p.status === 'Done' ? 'good' : p.status === 'Blocked' ? 'bad' : '')}</div>${reviewBlock(p, e)}</div>`).join('')}</div></section>`;
  }).join('') : `<div class="card">${empty('No priorities for this week, so there is nothing to review.')}</div>`;
  return pageHead('Friday review', 'Report back on each priority: the outcome, how much got done, and what you learned.', weekNav()) + nudge + body;
}
function viewPeople(e) {
  const real = realMe(), admin = e.role === 'ceo';
  const teams = [...new Set(S.people.map(p => String(p.team || '').trim()).filter(Boolean))].sort();
  const dl = `<datalist id="teams">${teams.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`;
  const people = [...S.people].sort(byName);
  let out = pageHead('People', 'Everyone in the tracker. Role and team decide what each person can see.') + dl;
  if (admin && resetShown && person(resetShown.id)) {
    out += `<div class="banner info"><div class="block grow"><span>Password reset link for ${esc(pname(resetShown.id))}. Send it to them privately; it works once, for 24 hours.</span><div class="codebox" id="reset-url">${esc(resetShown.url)}</div></div><div class="acts"><button class="btn sm" data-act="copy-reset">Copy link</button><button class="btn sm quiet" data-act="hide-reset">Done</button></div></div>`;
  }
  if (admin && S.signups.length) {
    out += `<section class="card"><div class="sec-h"><h2>New sign-ins</h2><span class="sub">${plural(S.signups.length, 'person is', 'people are')} waiting to be set up</span></div><div class="list">${S.signups.map(s => {
      const id = s.id, link = keep['su-link-' + id] || '', lp = person(Number(link));
      return `<div class="surow"><div class="person-h">${avatar(s.name)}<div class="grow"><b>${esc(s.name)}</b><div class="sub">${esc(s.email)} · signed up ${esc(dateOf(s.at))}</div></div>${delBtn('signups', id, 'Dismiss', 'Delete this account?')}</div>
        <div class="sugrid">
          <label class="f">Person<select id="su-link-${id}" class="k" data-chg="rerender"><option value="">Create new person</option>${opts(people.filter(p => !p.hasAccount).map(p => ({v: p.id, l: p.name})), link)}</select></label>
          ${link ? '' : `<label class="f">Name<input type="text" id="su-name-${id}" class="k" maxlength="80" value="${esc(s.name)}"></label>`}
          <label class="f">Role<select id="su-role-${id}" class="k">${roleOpts(lp?.role || 'member')}</select></label>
          <label class="f">Team<input type="text" id="su-team-${id}" class="k" list="teams" maxlength="60" value="${esc(lp?.team || '')}"></label>
          <button class="btn" data-act="su-add" data-id="${id}">Add</button>
        </div></div>`;
    }).join('')}</div></section>`;
  }
  if (admin) out += `<form class="card" data-form="pp" autocomplete="off"><h2>Add a person</h2><div class="sugrid">
      <label class="f">Name<input type="text" id="pp-name" class="k" maxlength="80"></label>
      <label class="f">Role<select id="pp-role" class="k">${roleOpts('member')}</select></label>
      <label class="f">Team<input type="text" id="pp-team" class="k" list="teams" maxlength="60" placeholder="For example: Growth"></label>
      <button class="btn" type="submit">Add person</button></div>
      <p class="sub">When they create an account, link it to this person from New sign-ins. Managers see everyone with the same team name.</p></form>`;
  const rows = people.map(p => {
    const self = p.id === real.id;
    const role = admin ? `<select id="pe-role-${p.id}" class="k sm" aria-label="Role for ${esc(p.name)}"${self ? ' disabled' : ''}>${roleOpts(p.role)}</select>` : chip(ROLES[p.role] || p.role, ROLE_TONE[p.role]);
    const team = admin ? `<input type="text" id="pe-team-${p.id}" class="k" list="teams" maxlength="60" value="${esc(p.team || '')}" aria-label="Team for ${esc(p.name)}">` : esc(p.team || '—');
    const acts = admin ? `<div class="acts"><button class="btn sm ghost" data-act="pe-save" data-id="${p.id}">Save</button>${p.hasAccount ? `<button class="btn sm quiet" data-act="pe-reset" data-id="${p.id}">Reset link</button>` : ''}${self ? '' : delBtn('people', p.id, 'Remove', 'Remove this person?')}</div>` : '';
    return `<tr><td><div class="person-h">${avatar(p.name, true)}<span>${esc(p.name)}</span>${self ? chip('You', 'acc') : ''}</div></td><td>${role}</td><td>${team}</td><td>${p.hasAccount ? `<span class="sub">${esc(p.email)}</span>` : chip('No account yet')}</td>${admin ? `<td>${acts}</td>` : ''}</tr>`;
  }).join('');
  out += `<section class="card"><div class="sec-h"><h2>Everyone</h2><span class="sub">${plural(people.length, 'person', 'people')}</span></div><div class="tblwrap"><table><thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Account</th>${admin ? '<th><span class="sr">Actions</span></th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  return out;
}

// ---------- screens ----------
const field = (id, label, type, extra = '') => `<label class="f">${esc(label)}<input type="${type}" id="${id}" class="k" ${extra}></label>`;
const screen = (title, msg, extra = '') => `<div class="authwrap"><div class="auth card"><div class="brandrow"><span class="logo" aria-hidden="true"></span><span>Team OKR Tracker</span></div><h1>${esc(title)}</h1>${msg ? `<p class="sub">${esc(msg)}</p>` : ''}${extra}</div></div>`;
function authScreen() {
  if (phase === 'setup') return screen('Create the CEO account', 'This account runs the tracker: it sets company OKRs and adds everyone else.', `<form data-form="setup" autocomplete="on">
    ${field('a-name', 'Your name', 'text', 'maxlength="80" autocomplete="name" required')}${field('a-email', 'Work email', 'email', 'maxlength="200" autocomplete="email" required')}
    ${field('a-team', 'Team (optional)', 'text', 'maxlength="60" placeholder="For example: Leadership"')}${field('a-pass', 'Password (at least 8 characters)', 'password', 'minlength="8" autocomplete="new-password" required')}
    <button class="btn" type="submit">Create CEO account</button></form>`);
  if (phase === 'reset') return screen('Choose a new password', 'You\'ll be signed in once it\'s saved, and signed out everywhere else.', `<form data-form="reset">
    ${field('a-pass', 'New password (at least 8 characters)', 'password', 'minlength="8" autocomplete="new-password" required')}<button class="btn" type="submit">Save password</button></form>`);
  if (phase === 'signup') return screen('Create your account', 'After you sign up, the CEO links your account to your role and team.', `<form data-form="signup" autocomplete="on">
    ${field('a-name', 'Your name', 'text', 'maxlength="80" autocomplete="name" required')}${field('a-email', 'Work email', 'email', 'maxlength="200" autocomplete="email" required')}
    ${field('a-pass', 'Password (at least 8 characters)', 'password', 'minlength="8" autocomplete="new-password" required')}<button class="btn" type="submit">Create account</button></form>
    <p class="sub">Already have an account? <button class="linkbtn" data-act="to-login">Sign in</button></p>`);
  return screen('Sign in', '', `${needsSetup ? '<div class="banner info"><span>The tracker isn\'t set up yet. Open the setup link from the server\'s log to create the CEO account.</span></div>' : ''}<form data-form="login" autocomplete="on">
    ${field('a-email', 'Email', 'email', 'autocomplete="username" required')}${field('a-pass', 'Password', 'password', 'autocomplete="current-password" required')}<button class="btn" type="submit">Sign in</button></form>
    <p class="sub">New here? <button class="linkbtn" data-act="to-signup">Create an account</button></p>
    <p class="sub">Forgot your password? Ask the CEO for a reset link.</p>`);
}
function build() {
  if (phase === 'boot') return screen('Loading the tracker…', offline ? 'Can\'t reach the server. Check your connection; the page retries when you reload.' : '');
  if (['login', 'signup', 'setup', 'reset'].includes(phase)) return authScreen();
  if (phase === 'waiting') return screen('Your account isn\'t set up yet', `You're signed in as ${S.account?.email || ''}. The CEO has your name in New sign-ins; once they add you, your dashboard appears here.`, '<button class="btn ghost" data-act="signout">Sign out</button>');
  const e = eff(), real = realMe();
  if (!tabAllowed(tab, e)) tab = 'dashboard';
  const badges = {approvals: pendingFor(e).length, people: e.role === 'ceo' ? S.signups.length : 0};
  const nav = TABS.filter(t => tabAllowed(t[0], e)), groups = [...new Set(nav.map(t => t[2]))];
  const views = {dashboard: viewDashboard, okrs: viewOkrs, approvals: viewApprovals, standup: viewStandup, achievements: viewAchievements, priorities: viewPriorities, review: viewReview, people: viewPeople};
  const banners = [
    offline ? '<div class="banner"><span>Can\'t reach the server right now. What you see may be out of date, and changes won\'t save until it\'s back.</span></div>' : '',
    e.role === 'hr' ? '<div class="banner info"><span>HR access is read-only. You can see everyone\'s OKRs and weekly work but not change them.</span></div>' : '',
    e.id !== real.id ? `<div class="banner info"><span>Previewing the app as ${esc(e.name)} (${esc(ROLES[e.role] || e.role)}). Anything you add is recorded as ${esc(e.name)}.</span><button class="btn sm ghost" data-act="viewas-me">Back to my view</button></div>` : '',
  ].join('');
  const others = S.people.filter(p => p.id !== real.id).sort(byName);
  return `<div class="app">
    <aside class="side${navOpen ? ' open' : ''}" aria-label="Sidebar">
      <div class="side-brand"><span class="logo" aria-hidden="true"></span><span>Team OKR Tracker</span></div>
      <nav aria-label="Main">${groups.map(g => `<div class="nav-lbl">${esc(g)}</div>${nav.filter(t => t[2] === g).map(([k, l]) => `<button class="nav-i" data-act="tab" data-t="${k}"${tab === k ? ' aria-current="page"' : ''}>${icon(k)}<span>${esc(l)}</span>${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('')}`).join('')}</nav>
      <div class="side-user"><div class="me">${avatar(e.name)}<div class="t"><b>${esc(e.name)}</b><span class="sub">${chip(ROLES[e.role] || e.role)}<span>${e.team ? esc(e.team) : 'No team'}</span></span></div></div><button class="btn ghost sm" data-act="signout">Sign out</button></div>
    </aside>
    <div class="scrim${navOpen ? ' on' : ''}" data-act="closenav"></div>
    <div class="mainwrap">
      <header class="topbar"><button class="iconbtn" data-act="menu" aria-label="Open menu">${icon('menu')}</button>
        <span class="crumb"><span class="sub muted-part">Team OKR Tracker</span><span class="sep">/</span><b>${esc(TABS.find(t => t[0] === tab)[1])}</b></span>
        ${real.role === 'ceo' && others.length ? `<label class="viewas" for="viewas">Viewing as<select id="viewas" class="sm" data-chg="viewas"><option value="">me</option>${opts(others.map(p => ({v: p.id, l: `${p.name} · ${ROLES[p.role] || p.role}`})), viewAs)}</select></label>` : ''}
      </header>
      <main class="content">${banners ? `<div class="banners">${banners}</div>` : ''}${views[tab](e)}</main>
      <footer class="foot">Changes are saved for everyone as you make them. ${S.year} OKR cycle.</footer>
    </div></div>`;
}

// ---------- render ----------
let queued = false;
function render() { if (queued) return; queued = true; Promise.resolve().then(() => { queued = false; paint(); }); }
function paint() {
  const app = document.getElementById('app'), a = document.activeElement;
  const fid = a && a.id && app.contains(a) ? a.id : null;
  let s0 = null, s1 = null;
  try { s0 = a.selectionStart; s1 = a.selectionEnd; } catch { /* not a text field */ }
  app.innerHTML = build();
  // Live updates re-render the page; put back anything the viewer was typing (US-2.3).
  for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el && el.value !== v) el.value = v; }
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus({preventScroll: true}); try { if (s0 != null) el.setSelectionRange(s0, s1); } catch { /* not a text field */ } } }
}
let toastTimer = null;
function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500); }

// ---------- navigation ----------
function fromHash() { const h = location.hash.slice(1); if (TABS.some(t => t[0] === h)) tab = h; }
function setTab(t) { navOpen = false; confirmKey = null; if (location.hash.slice(1) !== t) location.hash = t; else render(); }
function setWeek(w) { if (w === wk) return; wk = w; confirmKey = null; refresh(); }
window.addEventListener('hashchange', () => { fromHash(); navOpen = false; confirmKey = null; render(); window.scrollTo(0, 0); });

// ---------- events ----------
document.addEventListener('input', ev => { const t = ev.target; if (t.id && t.classList.contains('k')) keep[t.id] = t.value; });
document.addEventListener('change', ev => {
  const t = ev.target, d = t.dataset;
  if (t.id && t.classList.contains('k')) keep[t.id] = t.value;
  if (!d.chg || phase !== 'app') return;
  if (d.chg === 'rerender') return render();
  if (d.chg === 'viewas') { viewAs = t.value ? Number(t.value) : ''; confirmKey = null; showOkrForm = false; resetShown = null; return void refresh(); }
  if (d.chg === 'kr') return void once(() => onKr(Number(d.o), Number(d.k), t.value));
  if (d.chg === 'st') return void act('PATCH', `/api/stand/${d.id}`, {status: t.value});
  if (d.chg === 'pr') return void act('PATCH', `/api/prios/${d.id}`, {status: t.value});
});
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  switch (d.act) {
    case 'tab': setTab(d.t); break;
    case 'menu': navOpen = true; render(); break;
    case 'closenav': navOpen = false; render(); break;
    case 'wk-prev': setWeek(R.shiftDay(wk, -7)); break;
    case 'wk-next': setWeek(R.shiftDay(wk, 7)); break;
    case 'wk-now': setWeek(R.curWeek()); break;
    case 'viewas-me': viewAs = ''; refresh(); break;
    case 'to-signup': phase = 'signup'; render(); break;
    case 'to-login': phase = 'login'; render(); break;
    case 'signout': signOut(); break;
    case 'okr-new': showOkrForm = true; if (d.owner) keep['okr-owner'] = d.owner; if (tab !== 'okrs') setTab('okrs'); else render(); break;
    case 'okr-cancel': showOkrForm = false; resetOkrDraft(); render(); break;
    case 'kr-add': if (okrDraft.length < KR_MAX) { okrDraft.push(rid()); render(); } break;
    case 'kr-del': if (okrDraft.length > KR_MIN) { okrDraft = okrDraft.filter(r => r !== d.id); delete keep['okr-kr-' + d.id]; render(); } break;
    case 'appr-ok': case 'appr-back': {
      const o = S.okrs.find(x => x.id === Number(d.o));
      if (!o) return;
      once(() => d.act === 'appr-ok' ? act('POST', `/api/krs/${d.k}/approve`, {}, `Approved. ${pname(o.owner)}'s progress went up.`) : act('POST', `/api/krs/${d.k}/send-back`, {}, 'Sent back. It\'s marked Not completed again.'));
      break;
    }
    case 'del': confirmKey = d.kind + ':' + d.id; render(); break;
    case 'del-no': confirmKey = null; render(); break;
    case 'del-yes': once(() => doDelete(d.kind, Number(d.id))); break;
    case 'pe-save': once(() => savePerson(Number(d.id))); break;
    case 'pe-reset': once(() => makeResetLink(Number(d.id))); break;
    case 'hide-reset': resetShown = null; render(); break;
    case 'copy-reset': navigator.clipboard?.writeText(resetShown?.url || '').then(() => toast('Link copied.'), () => toast('Couldn\'t copy. Select the link and copy it yourself.')); break;
    case 'su-add': once(() => linkSignup(Number(d.id))); break;
  }
});
document.addEventListener('submit', ev => {
  const f = ev.target.closest('form[data-form]');
  if (!f) return;
  ev.preventDefault();
  const k = f.dataset.form;
  const fns = {
    login: () => authSubmit('login'), signup: () => authSubmit('signup'), setup: () => authSubmit('setup'), reset: () => authSubmit('reset'),
    okr: saveOkr, pr: addPrio, pp: addPerson, rv: () => saveReview(Number(f.dataset.id)),
    st: () => addEntry('stand', 'st-text', 'Write an activity before adding it.', 'Activity added.'),
    ach: () => addEntry('ach', 'ach-text', 'Write the achievement before recording it.', 'Achievement recorded.'),
  };
  if (fns[k]) once(fns[k]);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && navOpen) { navOpen = false; render(); } });

// ---------- start ----------
fromHash();
if (location.pathname === '/setup' && params.get('token')) phase = 'setup';
else if (location.pathname === '/reset' && params.get('token')) phase = 'reset';
render();
if (phase === 'boot') refresh();
