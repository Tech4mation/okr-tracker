
import './style.css';
import { supabase, configured } from './supabase.js';

const ROLES = {ceo:'CEO', hr:'HR', manager:'Manager', member:'Member'};
const PSTAT = ['Agreed','In progress','Done','Blocked'];
const SSTAT = ['Not done','In progress','Done'];
const OUTC = ['Done','Partially done','Not started','Blocked / dropped'];
const WEEKLY = ['stand','ach','prios','wnotes'];
const COLS = ['okrs','people','signups', ...WEEKLY];
const S = {lead: []}; COLS.forEach(c => S[c] = []);
const loaded = new Set();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const mondayOf = d => { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - (x.getDay()+6)%7); return x; };
const parseIso = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const curWeek = () => iso(mondayOf(new Date()));
const fmt = n => String(Math.round(n*10)/10);
const r0 = n => Math.round(n);

let session = null, uid = null, profName = '', authMode = 'in', busy = false;
let wk = curWeek(), tab = 'dash', viewAs = null, confirmDel = null;
let draft = {owner:null, obj:'', krs:['','']};
let started = false, booting = configured;

// ---------- identity & visibility ----------
const realMe = () => S.people.find(x => uid && x.uid === uid) || null;
function eff() { const r = realMe(); if (!r) return null; if (viewAs && r.role === 'ceo') { const p = S.people.find(x => x.id === viewAs); if (p) return p; } return r; }
const teamNames = p => { const s = new Set([p.name]); if (p.team) S.people.forEach(x => { if (x.team === p.team) s.add(x.name); }); return s; };
function scope(p) { return (p.role === 'ceo' || p.role === 'hr') ? new Set([p.name, ...S.people.map(x => x.name)]) : p.role === 'manager' ? teamNames(p) : new Set([p.name]); }
const lbScope = p => (p.role === 'ceo' || p.role === 'hr') ? new Set(S.people.map(x => x.name)) : teamNames(p);
const person = n => S.people.find(x => x.name === n);

// ---------- progress ----------
const okrPct = o => o.krs?.length ? o.krs.filter(k => k.pct === 100).length / o.krs.length * 100 : 0;
const personOkrs = n => S.okrs.filter(o => o.owner === n);
const personPct = n => { const a = personOkrs(n); return a.length ? a.reduce((s,o) => s + okrPct(o), 0) / a.length : 0; };
const companyPct = () => { const a = S.okrs.filter(o => o.owner === 'Company'); return a.length ? a.reduce((s,o) => s + okrPct(o), 0) / a.length : null; };
const krState = k => k.pct === 100 ? 'approved' : k.req ? 'awaiting' : 'open';

function canApprove(e, o) {
  if (!e || o.owner === 'Company') return false;
  if (e.role === 'ceo') return true;
  if (e.role !== 'manager') return false;
  const p = person(o.owner);
  return !!(p && p.role === 'member' && p.team && p.team === e.team && p.name !== e.name);
}
function pendingFor(e) {
  const out = [];
  S.okrs.forEach(o => (o.krs || []).forEach((k, i) => { if (k.req && k.pct !== 100 && canApprove(e, o)) out.push({o, k, i}); }));
  return out.sort((a,b) => (a.k.reqAt||0) - (b.k.reqAt||0));
}

// ---------- data ----------
const fail = r => { if (r?.error) throw r.error; return r; };
const guard = () => { if (viewAs) throw new Error('Preview is read-only. Choose Viewing as: me to make changes.'); };
const weekTables = new Set(WEEKLY);
async function load(c) {
  let q = supabase.from(c).select('*');
  if (weekTables.has(c)) q = q.eq('week', wk);
  const r = fail(await q);
  S[c] = r.data || []; loaded.add(c);
}
async function loadLead() { const r = await supabase.rpc('leaderboard', {p_week: wk}); S.lead = r.error ? [] : (r.data || []); }
async function loadWeek() { await Promise.all([...WEEKLY.map(load), loadLead()]); render(); }
async function refresh(c) { try { await Promise.all([c ? load(c) : Promise.resolve(), loadLead()]); } catch (_) {} render(); }
async function w(fn) { try { guard(); await fn(); } catch (e) { toast(e?.message || 'Could not save. Try again.'); return false; } return true; }
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3500); }
const add = async (c, d) => { const ok = await w(async () => fail(await supabase.from(c).insert(d))); if (ok) refresh(c); return ok; };
const upd = async (c, id, d) => { const ok = await w(async () => fail(await supabase.from(c).update(d).eq('id', id))); if (ok) refresh(c); return ok; };
const del = async (c, id) => { const ok = await w(async () => fail(await supabase.from(c).delete().eq('id', id))); if (ok) refresh(c); return ok; };
const val = id => document.getElementById(id)?.value ?? '';
async function rpcKr(fn, args) { const ok = await w(async () => fail(await supabase.rpc(fn, {...args, p_week: curWeek()}))); refresh('okrs'); return ok; }
const setKr = (oid, i, done) => rpcKr('set_kr', {p_okr: oid, p_idx: i, p_done: done});
const approve = (oid, i, ok) => rpcKr('approve_kr', {p_okr: oid, p_idx: i, p_ok: ok});

// ---------- html helpers ----------
const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
const bar = (p, c = '') => `<div class="bar ${c}" role="progressbar" aria-valuenow="${r0(p)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div>`;
const opts = (list, sel) => list.map(o => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');
const weekNav = () => {
  const s = parseIso(wk), e = new Date(s); e.setDate(e.getDate() + 6);
  const f = (d, y) => d.toLocaleDateString('en-GB', {day:'numeric', month:'short', ...(y ? {year:'numeric'} : {})});
  return `<div class="weeknav"><button class="btn ghost sm" data-act="wk" data-n="-1" aria-label="Previous week">‹</button>
    <span class="lab">${f(s)} – ${f(e, true)}</span><button class="btn ghost sm" data-act="wk" data-n="1" aria-label="Next week">›</button>
    <button class="btn ghost sm" data-act="wk" data-n="0"${wk === curWeek() ? ' disabled' : ''}>This week</button></div>`;
};

// ---------- views ----------
function viewDash(e) {
  const myPct = personPct(e.name), cp = companyPct();
  const mine = S.prios.filter(p => p.week === wk && p.assignee === e.name);
  const awaiting = S.okrs.filter(o => o.owner === e.name).reduce((s,o) => s + o.krs.filter(k => k.req && k.pct !== 100).length, 0);
  const waiting = (e.role === 'manager' || e.role === 'ceo') ? pendingFor(e).length : null;
  const fri = fridayDue(e);
  return `${monCall()}${fri ? `<div class="banner">It is Friday. Report back on how this week's priorities went. <button class="btn sm" data-act="tab" data-t="review">Open Friday Review</button></div>` : ''}
  <div class="row between"><h2>Dashboard</h2>${weekNav()}</div>
  <div class="grid">
    <div class="stat"><span class="l">Your annual OKR progress</span><span class="n">${r0(myPct)}%</span>${bar(myPct)}</div>
    <div class="stat"><span class="l">Priorities done this week</span><span class="n">${mine.filter(p => p.status === 'Done').length}/${mine.length}</span></div>
    <div class="stat"><span class="l">Key results awaiting approval</span><span class="n">${awaiting}</span></div>
    ${waiting !== null ? `<div class="stat"><span class="l">Waiting for your approval</span><span class="n">${waiting}</span></div>` : ''}
    ${cp !== null ? `<div class="stat"><span class="l">Company OKRs, average</span><span class="n">${r0(cp)}%</span>${bar(cp, 'good')}</div>` : ''}
  </div>`;
}

function viewLead(e) {
  const rows = [...S.lead].map(r => ({p: r, pct: +r.pct, g: +r.gain, n: r.rev_n, avg: +r.rev_avg}))
    .sort((a, b) => b.pct - a.pct || b.g - a.g || a.p.name.localeCompare(b.p.name));
  return `<div class="row between"><h2>Leaderboard</h2>${weekNav()}</div>
  <div class="card"><div class="row between"><h3>Weekly leaderboard</h3><span class="sub">Ranked by approved annual progress. “+” is the gain from key results approved in the selected week.</span></div>
  ${rows.length ? rows.map((r, i) => {
        return `<div class="lb"><span class="medal ${i < 3 ? 'm' + (i+1) : ''}">${i+1}</span>
      <div class="row between"><span><b>${esc(r.p.name)}</b> <span class="sub">${esc(r.p.team || 'No team')}</span></span>
      <span class="row"><span class="num"><b>${r0(r.pct)}%</b></span>${r.g > 0.04 ? chip('+' + fmt(r.g) + '% this week', 'good') : ''}${r.n ? chip(r.n + ' reviewed · avg ' + r0(r.avg) + '%', 'acc') : ''}</span></div>
      <span></span>${bar(r.pct)}</div>`;
  }).join('') : '<p class="empty">No people to rank yet. The CEO adds people in the People tab.</p>'}</div>`;
}

const monCall = () => new Date().getDay() === 1 && wk === curWeek() ? '<div class="banner info">Today: mandatory all-teams call at 9:00 AM to review business priorities.</div>' : '';
function fridayDue(e) {
  if (new Date().getDay() !== 5 || wk !== curWeek() || e.role === 'hr') return false;
  return S.prios.some(p => p.week === wk && p.assignee === e.name && !p.reviewed);
}

function ownerOptions(e) {
  if (e.role === 'ceo') return ['Company', ...S.people.map(p => p.name).filter(n => n !== e.name), e.name].filter((v, i, a) => a.indexOf(v) === i);
  if (e.role === 'manager') return [e.name, ...[...teamNames(e)].filter(n => n !== e.name)];
  if (e.role === 'member') return [e.name];
  return [];
}
function okrCard(o, e) {
  const n = o.krs.length, wt = 100 / n, p = okrPct(o);
  const canDel = !e.role || e.role !== 'hr' ? (o.owner === e.name || e.role === 'ceo') : false;
  const canKr = e.role !== 'hr' && (e.role === 'ceo' || (o.owner !== 'Company' && o.owner === e.name));
  return `<div class="card"><div class="row between"><div class="grow"><h3>${esc(o.objective)}</h3><span class="sub">${esc(o.owner)} · ${esc(o.year)}</span></div>
    <span class="num"><b>${r0(p)}%</b></span></div>${bar(p)}
    <div>${o.krs.map((k, i) => { const st = krState(k);
      const status = st === 'approved' ? chip('Approved' + (k.apBy ? ' by ' + k.apBy : ''), 'good') : st === 'awaiting' ? chip('Awaiting approval', 'warn') : chip('Not completed');
      return `<div class="kr"><span class="w">${fmt(wt)}%</span><span>${esc(k.title)}</span>
        <span class="st">${status}</span>
        ${canKr ? `<select aria-label="Status of ${esc(k.title)}" data-chg="kr" data-o="${o.id}" data-i="${i}"><option value="0"${st === 'open' ? ' selected' : ''}>Not completed</option><option value="1"${st !== 'open' ? ' selected' : ''}>Completed</option></select>` : '<span></span>'}</div>`; }).join('')}</div>
    ${canDel ? (confirmDel === o.id ? `<div class="row"><span class="sub">Delete this OKR for everyone?</span><button class="btn bad sm" data-act="delokr" data-id="${o.id}">Confirm delete</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>` : `<div><button class="btn ghost sm" data-act="askdel" data-id="${o.id}">Delete</button></div>`) : ''}</div>`;
}
function viewOkrs(e) {
  const sc = scope(e), company = S.okrs.filter(o => o.owner === 'Company');
  const people = [...sc].filter(n => personOkrs(n).length);
  const ow = ownerOptions(e);
  if (!ow.includes(draft.owner)) draft.owner = ow[0];
  const n = draft.krs.length;
  return `<h2>OKRs</h2>
  <section class="row" style="flex-direction:column;align-items:stretch;gap:12px"><h3>Company OKRs</h3>
    ${company.length ? company.map(o => okrCard(o, e)).join('') : '<div class="card empty">No company OKRs yet.' + (e.role === 'ceo' ? ' Add one below and choose Company as the owner.' : '') + '</div>'}</section>
  ${ow.length ? `<form class="card" data-submit="addokr"><h3>Add an OKR</h3>
    <div class="row"><label class="f grow">Objective<input type="text" id="ok-obj" data-draft="obj" value="${esc(draft.obj)}" placeholder="What do you want to achieve this year?"></label>
    <label class="f">Owner<select id="ok-owner" data-chg="owner"${ow.length < 2 ? ' disabled' : ''}>${opts(ow, draft.owner)}</select></label></div>
    <div>${draft.krs.map((k, i) => `<div class="row" style="margin-bottom:6px"><span class="num sub" style="min-width:44px">${fmt(100 / n)}%</span>
      <input type="text" class="grow" id="ok-kr-${i}" data-draft="kr" data-i="${i}" value="${esc(k)}" placeholder="Key result ${i + 1}" aria-label="Key result ${i + 1}">
      <button type="button" class="btn ghost sm" data-act="rmkr" data-i="${i}"${n <= 2 ? ' disabled' : ''} aria-label="Remove key result ${i + 1}">Remove</button></div>`).join('')}</div>
    <div class="row"><button type="button" class="btn ghost" data-act="addkr"${n >= 20 ? ' disabled' : ''}>+ Add key result</button><button class="btn" type="submit">Save OKR</button><span class="sub">2 to 20 key results, each worth an equal share of 100%.</span></div></form>` : ''}
  <section style="display:flex;flex-direction:column;gap:12px"><h3>${e.role === 'member' ? 'My OKRs' : 'Personal OKRs'}</h3>
    ${people.length ? people.map(nm => `<div style="display:flex;flex-direction:column;gap:12px"><div class="row between"><b>${esc(nm)}</b><span class="sub">Annual progress <span class="num">${r0(personPct(nm))}%</span></span></div>${personOkrs(nm).map(o => okrCard(o, e)).join('')}</div>`).join('') : '<div class="card empty">No personal OKRs yet.</div>'}</section>`;
}

function viewApprovals(e) {
  const list = pendingFor(e);
  return `<h2>Approvals</h2>${list.length ? list.map(({o, k, i}) => `<div class="card"><div class="row between"><div class="grow"><b>${esc(o.owner)}</b> <span class="sub">${esc(o.objective)}</span><div>${esc(k.title)}</div></div>
    ${chip('Weight ' + fmt(100 / o.krs.length) + '%')}<div class="row"><button class="btn sm" data-act="approve" data-o="${o.id}" data-i="${i}">Approve</button><button class="btn ghost sm" data-act="sendback" data-o="${o.id}" data-i="${i}">Send back</button></div></div></div>`).join('')
    : '<div class="card empty">Nothing is waiting for you.</div>'}`;
}

function grouped(items, key) { const m = new Map(); items.forEach(x => { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m].sort((a,b) => a[0].localeCompare(b[0])); }

function viewStand(e) {
  const sc = scope(e), items = S.stand.filter(x => x.week === wk && sc.has(x.owner));
  const canAdd = e.role !== 'hr';
  return `<div class="row between"><h2>Weekly Standup</h2>${weekNav()}</div>
  ${canAdd ? `<form class="card" data-submit="addstand"><div class="row"><input type="text" class="grow" id="su-text" placeholder="What are you working on?" aria-label="Activity"><button class="btn" type="submit">Add</button></div></form>` : ''}
  ${items.length ? grouped(items, 'owner').map(([o, list]) => { const d = list.filter(x => x.status === 'Done').length;
    return `<div class="card"><div class="row between"><h3>${esc(o)}</h3><span class="sub num">${d}/${list.length} done</span></div>
    ${list.sort((a,b) => (a.ts||0) - (b.ts||0)).map(x => { const can = e.role !== 'hr' && (x.owner === e.name || e.role === 'ceo');
      const pct = x.status === 'Done' ? 100 : x.status === 'In progress' ? 50 : 0;
      return `<div class="row" style="border-top:1px solid var(--line);padding-top:8px"><span class="grow">${esc(x.text)}</span><div style="width:70px">${bar(pct, 'good')}</div>
        <select data-chg="stand" data-id="${x.id}" aria-label="Status"${can ? '' : ' disabled'}>${opts(SSTAT, x.status)}</select>
        ${can ? `<button class="btn ghost sm" data-act="delstand" data-id="${x.id}" aria-label="Delete activity">Delete</button>` : ''}</div>`; }).join('')}</div>`; }).join('')
    : '<div class="card empty">No standup entries for this week.</div>'}`;
}

function viewAch(e) {
  const sc = scope(e), items = S.ach.filter(x => x.week === wk && sc.has(x.owner)).sort((a,b) => (b.ts||0) - (a.ts||0));
  return `<div class="row between"><h2>Weekly Achievements</h2>${weekNav()}</div>
  ${e.role !== 'hr' ? `<form class="card" data-submit="addach"><div class="row"><input type="text" class="grow" id="ac-text" placeholder="What went well?" aria-label="Achievement"><button class="btn" type="submit">Record</button></div></form>` : ''}
  ${items.length ? `<div class="card">${items.map(x => `<div class="row between" style="border-top:1px solid var(--line);padding-top:8px"><span class="grow"><b>${esc(x.owner)}</b> · ${esc(x.text)}</span>
    ${(x.owner === e.name || e.role === 'ceo') && e.role !== 'hr' ? `<button class="btn ghost sm" data-act="delach" data-id="${x.id}">Delete</button>` : ''}</div>`).join('')}</div>` : '<div class="card empty">No achievements recorded this week.</div>'}`;
}

function viewPrios(e) {
  const sc = scope(e), items = S.prios.filter(x => x.week === wk && sc.has(x.assignee));
  const ow = ownerOptions(e).filter(n => n !== 'Company');
  return `<div class="row between"><h2>Weekly Priorities</h2>${weekNav()}</div>
  ${ow.length ? `<form class="card" data-submit="addprio"><div class="row"><input type="text" class="grow" id="pr-text" placeholder="What matters this week?" aria-label="Priority">
    <label class="sr" for="pr-owner">Owner</label><select id="pr-owner"${ow.length < 2 ? ' disabled' : ''}>${opts(ow, e.name)}</select><button class="btn" type="submit">Add</button></div></form>` : ''}
  ${items.length ? grouped(items, 'assignee').map(([o, list]) => { const d = list.filter(x => x.status === 'Done').length;
    return `<div class="card"><div class="row between"><h3>${esc(o)}</h3><span class="sub num">${d}/${list.length} done</span></div>
    ${list.map(x => { const can = e.role !== 'hr' && (x.assignee === e.name || x.by === e.name || e.role === 'ceo');
      return `<div class="row" style="border-top:1px solid var(--line);padding-top:8px"><span class="grow">${esc(x.text)}${x.by && x.by !== x.assignee ? `<div class="sub">Assigned by ${esc(x.by)}</div>` : ''}</span>
        <select data-chg="prio" data-id="${x.id}" aria-label="Status"${can ? '' : ' disabled'}>${opts(PSTAT, x.status)}</select>
        ${can ? `<button class="btn ghost sm" data-act="delprio" data-id="${x.id}">Delete</button>` : ''}</div>`; }).join('')}</div>`; }).join('')
    : '<div class="card empty">No priorities for this week.</div>'}`;
}

function viewReview(e) {
  const sc = scope(e), items = S.prios.filter(x => x.week === wk && sc.has(x.assignee));
  const fri = fridayDue(e);
  const noteId = n => wk + '_' + (person(n)?.id || 'owner');
  const notes = new Map(S.wnotes.filter(x => x.week === wk).map(x => [x.owner, x]));
  const names = [...new Set([...items.map(x => x.assignee), ...S.stand.filter(x => x.week === wk && sc.has(x.owner)).map(x => x.owner), ...notes.keys()])].filter(n => sc.has(n)).sort();
  return `<div class="row between"><h2>Friday Review</h2>${weekNav()}</div>
  ${fri ? '<div class="banner">It is Friday. Report back on each priority below.</div>' : ''}
  ${names.length ? names.map(o => { const list = items.filter(x => x.assignee === o), rev0 = list.filter(x => x.reviewed); const act = S.stand.filter(x => x.week === wk && x.owner === o).sort((a,b) => (a.ts||0)-(b.ts||0)); const nt = notes.get(o); const canN = e.role !== 'hr' && (o === e.name || e.role === 'ceo');
    const sec = `<div style="border-top:1px solid var(--line);padding-top:8px;display:flex;flex-direction:column;gap:8px"><b>This week's standup</b>${act.length ? act.map(x => `<div class="row"><span class="grow">${esc(x.text)}</span>${chip(x.status, x.status === 'Done' ? 'good' : x.status === 'In progress' ? 'warn' : '')}</div>`).join('') : '<span class="sub">No standup entries.</span>'}
      <b>Blockers, achievements or feedback</b>${canN ? `<textarea id="wn-${noteId(o)}" placeholder="Anything blocking you, wins from the week, or feedback. Include work outside your key results.">${esc(nt?.text || '')}</textarea><div><button class="btn sm" data-act="savenote" data-o="${esc(o)}">Save comments</button></div>` : `<div class="${nt ? '' : 'sub'}">${nt ? esc(nt.text) : 'No comments yet.'}</div>`}</div>`;
    return `<div class="card"><h2>${esc(o)}</h2>${sec}${list.length ? '<div class="sub num">' + rev0.length + ' of ' + list.length + ' priorities reviewed</div>' : ''}${reviewList(o, list, e)}</div>`; }).join('')
    : '<div class="card empty">No priorities to review for this week.</div>'}`;
}
function reviewList(o, list, e) {
  return list.map(x => { const can = e.role !== 'hr' && (x.assignee === e.name || e.role === 'ceo');
    const head = `<div class="row between"><span class="grow"><b>${esc(x.text)}</b></span>${x.reviewed ? chip('Reviewed', 'good') : chip('Not reviewed')}</div>`;
    if (!can) return `<div style="border-top:1px solid var(--line);padding-top:8px;display:flex;flex-direction:column;gap:6px">${head}${x.reviewed ? `<div>${esc(x.outcome)} · <span class="num">${r0(x.pct)}%</span></div><div class="sub">${esc(x.feedback)}</div>` : ''}</div>`;
    return `<div style="border-top:1px solid var(--line);padding-top:8px;display:flex;flex-direction:column;gap:8px">${head}
      <div class="row"><label class="f">Outcome<select id="rv-o-${x.id}"><option value="">Choose outcome</option>${opts(OUTC, x.outcome)}</select></label>
      <label class="f">Percent<input type="number" min="0" max="100" id="rv-p-${x.id}" value="${x.reviewed ? esc(x.pct) : ''}" style="width:90px"></label></div>
      <label class="f">Feedback<textarea id="rv-f-${x.id}">${esc(x.feedback || '')}</textarea></label>
      <div><button class="btn sm" data-act="review" data-id="${x.id}">Save review</button></div></div>`; }).join('');
}

function viewPeople(e) {
  const ceo = e.role === 'ceo';
  const unlinked = S.people.filter(p => !p.uid);
  return `<h2>People</h2>
  ${ceo && S.signups.length ? `<div class="card"><h3>New sign-ins</h3><span class="sub">These people opened the app and are waiting to be set up.</span>
    ${S.signups.map(s => `<div class="row" style="border-top:1px solid var(--line);padding-top:8px"><b class="grow">${esc(s.name || 'Unnamed')}</b>
      <select id="sg-l-${s.id}" aria-label="Link to"><option value="">Create new person</option>${unlinked.map(p => `<option value="${p.id}">Link to ${esc(p.name)}</option>`).join('')}</select>
      <select id="sg-r-${s.id}" aria-label="Role">${['member','manager','hr','ceo'].map(r => `<option value="${r}">${ROLES[r]}</option>`).join('')}</select>
      <input type="text" id="sg-t-${s.id}" placeholder="Team" aria-label="Team" style="width:130px"><button class="btn sm" data-act="linksign" data-id="${s.id}">Add</button></div>`).join('')}</div>` : ''}
  ${ceo ? `<form class="card" data-submit="addperson"><h3>Add a person</h3><div class="row"><input type="text" id="pe-name" placeholder="Name" aria-label="Name" class="grow">
    <select id="pe-role" aria-label="Role">${['member','manager','hr','ceo'].map(r => `<option value="${r}">${ROLES[r]}</option>`).join('')}</select>
    <input type="text" id="pe-team" placeholder="Team" aria-label="Team" style="width:140px"><button class="btn" type="submit">Add</button></div></form>` : ''}
  <div class="card"><div class="tblwrap"><table><thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Sign-in</th>${ceo ? '<th></th>' : ''}</tr></thead><tbody>
  ${S.people.length ? [...S.people].sort((a,b) => a.name.localeCompare(b.name)).map(p => ceo ? `<tr><td>${esc(p.name)}</td>
    <td><select id="pr-r-${p.id}" aria-label="Role">${['member','manager','hr','ceo'].map(r => `<option value="${r}"${p.role === r ? ' selected' : ''}>${ROLES[r]}</option>`).join('')}</select></td>
    <td><input type="text" id="pr-t-${p.id}" value="${esc(p.team || '')}" aria-label="Team" style="width:140px"></td><td>${p.uid ? chip('Linked', 'good') : chip('Not linked')}</td>
    <td><div class="row"><button class="btn sm" data-act="saveperson" data-id="${p.id}">Save</button>${confirmDel === p.id ? `<button class="btn bad sm" data-act="delperson" data-id="${p.id}">Confirm</button><button class="btn ghost sm" data-act="cancel">Cancel</button>` : `<button class="btn ghost sm" data-act="askdel" data-id="${p.id}">Remove</button>`}</div></td></tr>`
    : `<tr><td>${esc(p.name)}</td><td>${ROLES[p.role] || esc(p.role)}</td><td>${esc(p.team || '—')}</td><td>${p.uid ? chip('Linked', 'good') : chip('Not linked')}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">No people yet.</td></tr>`}</tbody></table></div></div>`;
}

function authView() {
  const up = authMode === 'up';
  return `<main><form class="card auth" data-submit="auth"><h2>Team OKR Tracker</h2>
    <p class="sub">${up ? 'Create your account. The CEO will set up your role and team.' : 'Sign in to see your OKRs and weekly work.'}</p>
    ${up ? '<label class="f">Your name<input type="text" id="au-name" autocomplete="name" required></label>' : ''}
    <label class="f">Email<input type="text" id="au-email" inputmode="email" autocomplete="email" required></label>
    <label class="f">Password<input type="password" id="au-pass" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="8" required></label>
    <button class="btn" type="submit"${busy ? ' disabled' : ''}>${up ? 'Create account' : 'Sign in'}</button>
    <button type="button" class="btn ghost sm" data-act="authmode">${up ? 'I already have an account' : 'Create an account'}</button></form></main>`;
}

// ---------- shell ----------
function render() {
  const root = $('#root');
  const keep = [...root.querySelectorAll('input[id],textarea[id],select[id]')].map(el => ({id: el.id, v: el.value}));
  const ae = document.activeElement, focus = ae && ae.id && root.contains(ae) ? {id: ae.id, s: ae.selectionStart, e: ae.selectionEnd} : null;
  root.innerHTML = build();
  keep.forEach(k => { const el = document.getElementById(k.id); if (el && el.value !== k.v && !/^(ok-owner)$/.test(k.id)) { if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === k.v)) return; el.value = k.v; } });
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus(); try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch (_) {} } }
}
function build() {
  if (!configured) return `<main><div class="card auth"><h2>Setup needed</h2><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the environment, then rebuild. See the README.</p></div></main>`;
  if (booting) return '<p class="empty">Loading…</p>';
  if (!session) return authView();
  if (!loaded.has('people') || !loaded.has('signups')) return '<p class="empty">Loading…</p>';
  const real = realMe();
  if (!real) return `<header class="top"><span class="brand">Team OKR Tracker</span></header><main><div class="card"><h2>Your account is not set up yet</h2>
    <p>Hi ${esc(profName || 'there')}. The CEO has been notified and will add you shortly. Refresh this page once they have.</p><div><button class="btn ghost sm" data-act="signout">Sign out</button></div></div></main>`;
  const e = eff(), pend = (e.role === 'manager' || e.role === 'ceo') ? pendingFor(e).length : 0;
  const tabs = [['dash','Dashboard'], ['lead','Leaderboard'], ['okrs','OKRs'], ...(e.role === 'manager' || e.role === 'ceo' ? [['appr','Approvals']] : []), ['stand','Standup'], ['ach','Achievements'], ['prio','Priorities'], ['review','Friday Review'], ...(e.role === 'ceo' || e.role === 'hr' ? [['people','People']] : [])];
  if (!tabs.some(t => t[0] === tab)) tab = 'dash';
  const views = {dash: viewDash, lead: viewLead, okrs: viewOkrs, appr: viewApprovals, stand: viewStand, ach: viewAch, prio: viewPrios, review: viewReview, people: viewPeople};
  const others = S.people.filter(p => p.name !== real.name);
  return `<header class="top"><span class="brand">Team OKR Tracker</span><div class="who"><b>${esc(e.name)}</b>${chip(ROLES[e.role] || e.role, 'acc')}<span>${esc(e.team || 'No team')}</span>
    <button class="btn ghost sm" data-act="signout">Sign out</button>
    ${real.role === 'ceo' ? `<label class="row sub">Viewing as <select id="viewas" data-chg="viewas"><option value="">me</option>${others.map(p => `<option value="${p.id}"${viewAs === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}</div></header>
    <nav class="tabs" aria-label="Sections">${tabs.map(([k, l]) => `<button data-act="tab" data-t="${k}"${tab === k ? ' aria-current="page"' : ''}>${l}${k === 'appr' && pend ? `<span class="badge">${pend}</span>` : ''}</button>`).join('')}</nav>
    <main>${e.role === 'hr' ? '<div class="banner info">HR access is read-only.</div>' : ''}${(viewAs && real.role === 'ceo') ? `<div class="banner info">Previewing the app as ${esc(e.name)}. Preview is read-only.</div>` : ''}${views[tab](e)}</main>`;
}

// ---------- events ----------
const root = $('#root');
root.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'authmode') { authMode = authMode === 'in' ? 'up' : 'in'; return render(); }
  const a = b.dataset.act, id = b.dataset.id, e = eff(), i = +b.dataset.i;
  if (a === 'tab') { tab = b.dataset.t; confirmDel = null; }
  else if (a === 'wk') { const n = +b.dataset.n; if (n === 0) wk = curWeek(); else { const d = parseIso(wk); d.setDate(d.getDate() + 7 * n); wk = iso(d); } }
  else if (a === 'askdel') confirmDel = id;
  else if (a === 'cancel') confirmDel = null;
  else if (a === 'addkr') { if (draft.krs.length < 20) draft.krs.push(''); }
  else if (a === 'rmkr') { if (draft.krs.length > 2) draft.krs.splice(i, 1); }
  else if (a === 'delokr') { confirmDel = null; del('okrs', id); }
  else if (a === 'approve') approve(b.dataset.o, i, true);
  else if (a === 'sendback') approve(b.dataset.o, i, false);
  else if (a === 'delstand') del('stand', id);
  else if (a === 'delach') del('ach', id);
  else if (a === 'delprio') del('prios', id);
  else if (a === 'delperson') { confirmDel = null; del('people', id); }
  else if (a === 'review') {
    const o = val('rv-o-' + id), p = val('rv-p-' + id), f = val('rv-f-' + id).trim();
    if (!o) return toast('Choose an outcome.');
    if (p === '' || +p < 0 || +p > 100) return toast('Enter a percentage from 0 to 100.');
    if (!f) return toast('Write some feedback before saving.');
    upd('prios', id, {outcome:o, pct:+p, feedback:f, reviewed:true}).then(ok => { if (ok) toast('Review saved.'); });
  }
  else if (a === 'savenote') {
    const o = b.dataset.o, id = wk + '_' + (person(o)?.id || 'owner'), t = val('wn-' + id).trim();
    w(async () => fail(await supabase.from('wnotes').upsert({id, week: wk, owner: o, text: t, ts: Date.now()}))).then(ok => { if (ok) { toast('Comments saved.'); refresh('wnotes'); } });
  }
  else if (a === 'saveperson') upd('people', id, {role: val('pr-r-' + id), team: val('pr-t-' + id).trim()}).then(ok => { if (ok) toast('Saved. Their view changes on next load.'); });
  else if (a === 'linksign') {
    const sg = S.signups.find(x => x.id === id); if (!sg) return;
    const link = val('sg-l-' + id), role = val('sg-r-' + id), team = val('sg-t-' + id).trim();
    w(async () => {
      if (link) fail(await supabase.from('people').update({uid: sg.id, role, team}).eq('id', link));
      else fail(await supabase.from('people').insert({name: sg.name || 'Unnamed', role, team, uid: sg.id}));
      fail(await supabase.from('signups').delete().eq('id', id));
    }).then(() => load('people').then(() => load('signups')).then(render));
  }
  else if (a === 'signout') { supabase.auth.signOut().then(() => location.reload()); }
  render();
  if (a === 'wk') loadWeek();
});
root.addEventListener('change', ev => {
  const t = ev.target, k = t.dataset.chg; if (!k) return;
  if (k === 'viewas') { viewAs = t.value || null; draft.owner = null; }
  else if (k === 'owner') draft.owner = t.value;
  else if (k === 'kr') setKr(t.dataset.o, +t.dataset.i, t.value === '1');
  else if (k === 'stand') upd('stand', t.dataset.id, {status: t.value});
  else if (k === 'prio') upd('prios', t.dataset.id, {status: t.value});
  render();
});
root.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.draft === 'obj') draft.obj = t.value;
  else if (t.dataset.draft === 'kr') draft.krs[+t.dataset.i] = t.value;
});
root.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target.dataset.submit;
  if (f === 'auth') return doAuth();
  const e = eff(); if (!e) return;
  if (f === 'addokr') {
    if (viewAs) return toast('Preview is read-only. Choose Viewing as: me to make changes.');
    const krs = draft.krs.map(s => s.trim()).filter(Boolean), obj = draft.obj.trim();
    if (!obj || krs.length < 2) return toast('Enter an objective and at least 2 key results.');
    add('okrs', {objective: obj, owner: draft.owner, year: new Date().getFullYear(), krs: krs.map(t => ({title:t, pct:0, req:false, reqAt:0, apBy:''}))});
    draft = {owner: draft.owner, obj:'', krs:['','']};
  } else if (f === 'addstand') {
    const t = val('su-text').trim(); if (!t) return toast('Enter an activity first.');
    add('stand', {week: wk, owner: e.name, text: t, status: 'Not done', ts: Date.now()}); $('#su-text').value = '';
  } else if (f === 'addach') {
    const t = val('ac-text').trim(); if (!t) return toast('Enter an achievement first.');
    add('ach', {week: wk, owner: e.name, text: t, ts: Date.now()}); $('#ac-text').value = '';
  } else if (f === 'addprio') {
    const t = val('pr-text').trim(); if (!t) return toast('Enter a priority first.');
    const a = val('pr-owner') || e.name;
    add('prios', {week: wk, text: t, assignee: a, by: e.name, status: 'Agreed', outcome: '', pct: 0, feedback: '', reviewed: false, ts: Date.now()}); $('#pr-text').value = '';
  } else if (f === 'addperson') {
    const n = val('pe-name').trim(); if (!n) return toast('Enter a name.');
    add('people', {name: n, role: val('pe-role'), team: val('pe-team').trim(), uid: null}); $('#pe-name').value = ''; $('#pe-team').value = '';
  }
  render();
});

// ---------- auth & boot ----------
async function doAuth() {
  const email = val('au-email').trim(), password = val('au-pass');
  if (!email || password.length < 8) return toast('Enter your email and a password of at least 8 characters.');
  busy = true; render();
  try {
    if (authMode === 'up') {
      const name = val('au-name').trim(); if (!name) { toast('Enter your name.'); return; }
      const r = fail(await supabase.auth.signUp({email, password, options: {data: {full_name: name}}}));
      if (!r.data.session) { toast('Check your email to confirm your account, then sign in.'); authMode = 'in'; return; }
    } else fail(await supabase.auth.signInWithPassword({email, password}));
    await start();
  } catch (e) { toast(e?.message || 'Could not sign in.'); }
  finally { busy = false; render(); }
}

function subscribe() {
  const ch = supabase.channel('okr-live');
  [...COLS, 'logs'].forEach(c => ch.on('postgres_changes', {event: '*', schema: 'public', table: c}, () => {
    if (c === 'logs') refresh(); else refresh(c);
  }));
  ch.subscribe();
}

async function start() {
  const {data} = await supabase.auth.getSession();
  session = data.session; if (!session) return render();
  if (started) return render();
  started = true;
  uid = session.user.id;
  profName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '';
  try {
    await Promise.all([load('okrs'), load('people'), load('signups'), ...WEEKLY.map(load), loadLead()]);
    if (!realMe()) {
      const claimed = await supabase.rpc('claim_ceo', {p_name: profName});
      if (claimed.data) await Promise.all([load('people'), load('okrs'), load('signups'), ...WEEKLY.map(load), loadLead()]);
      else await supabase.from('signups').upsert({id: uid, name: profName}, {ignoreDuplicates: true});
    }
    subscribe();
  } catch (e) { toast(e?.message || 'Could not load data.'); }
  loaded.add('people'); loaded.add('signups');
  render();
}

render();
if (configured) start().catch(() => {}).finally(() => { booting = false; render(); });
