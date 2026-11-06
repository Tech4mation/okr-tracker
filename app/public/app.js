// Team OKR Tracker page, PRD v1.1. The screens are the product lead's prototype; what changed is where the data
// lives. The server sends only what the signed-in person may see, and every change goes to the server as a named
// action that it re-checks. The rules shared with the server (model.js) decide which controls to show.
import {ROLES, SSTAT, KRTYPE, OKRST, OKRST_TONE, OUTCOME, BAND, RTONE, RKIND, DOCST, FBTONE, RATINGS, REVST, WLOAD, MOOD, SUB_TONE, HR_ACTIONS,
  ALERTS, ALERT_MODES, MON, MONFULL, iso, parseIso, curWeek, today, shiftDay, fmt, fn, r0, curM, curY, dateShort, plural,
  toCsv, createModel} from './model.js';

let subFilter = '';
const M = createModel({getSub: () => subFilter});
const {S, isGroup, where, ownerLabel, cv, person, mgrOf, reportsTo, directs, scope, lbScope, canSeeDossier, canSeePay,
  gain, isMonthly, krMeasured, krFrac, krMeasure, okrPct, personOkrs, personPct, companyPct, isPersonal, overdue, goalMonth, expectedPace,
  okrStatus, monthRows, appraise, lastUpd, isStale, krStale, krRef, krOpts, activityOn, latestLogged, pendingTotal,
  krAuto, krCur, krState, pastWeeks, standupRate, overdueFor, approvedFor, krCount, jdCoverage, risk, isAhead,
  tmplFor, onbFor, onbPct, onbDue, onbLate, onbActive, onbCanTick, money, hiresOf, closedOf, openings, toFill, roleLive, inAppr,
  sentBack, roleShut, canRole, raisedBy, chainOf, stepNow, stepNo, canStep, stepLabel, chainFor, myAppr, openRoles, askedRoles, apprDays, avgNum,
  daysOpen, docsFor, onesFor, fbFor, dueReview, surveyFor, recipients, welfareOf, responded, outstanding, surveyDue, enpsAsked, enpsScore,
  welfareFlag, liveCycle, revOf, revStage, revDone, revSeen, myRevToSign, revDue, leaveFor, leaveAllow, leaveBal, leavePending,
  editDirect, canEditOkr, canDeleteOkr, canMarkKr, revsFor, approverOf, pendingFor, ownerOptions, fridayDue, attentionFor} = M;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dayLabel = d => { const x = parseIso(d); return d === today() ? 'Today' : d === shiftDay(today(), -1) ? 'Yesterday' : x.toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'short'}); };
const monOpts = sel => MONFULL.map((m, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${m}</option>`).join('');
const subs = () => S.cfg.subs;

// ---------- page state ----------
let ST = null, phase = 'boot', authMsg = '', link = null, viewAs = null;
let pf = {q: '', team: '', role: ''};
const FF0 = () => ({appr2: {q: '', team: ''}, hist: {q: '', team: '', v: ''}, hire: {q: '', team: ''}, rev: {q: '', team: '', v: ''}, lead: {q: '', team: ''}, perf: {q: '', team: ''}, welf: {q: '', team: ''}, okrs: {q: '', team: '', st: '', mo: ''}, appr: {q: '', team: ''}, stand: {q: '', st: ''}, review: {q: '', st: ''}});
let ff = FF0();
let wk = curWeek(), tab = 'dash', confirmDel = null;
let draft = {owner: null, obj: '', krs: ['', ''], ms: [null, null], kt: ['binary', 'binary'], tg: ['', ''], un: ['', '']}, showForm = false, navOpen = false;
let editing = null, okrUpd = null, krOpen = null, ciSeg = 'week', histM = null, perfSeg = 'now', apFrom = '', apTo = '', okrTab = null, standWho = null, revWho = null,
  dossier = null, perfTab = 'all', dirView = 'table', openRev = null, openRole = null, hireTab = 'open', fillR = null, declR = null, sbR = null, closeR = null, editR = null,
  imp = null, tdraft = null, cfgDraft = null, mailRep = null, cycleForm = false, empEdit = false, linkOut = null;

const realMe = () => ST && S.people.find(p => p.id === ST.realId) || null;
const eff = () => ST && S.people.find(p => p.id === ST.effId) || realMe();

// ---------- talking to the server ----------
async function api(url, opts = {}) {
  const headers = {...(opts.json !== undefined ? {'Content-Type': 'application/json'} : {}), ...(opts.method && opts.method !== 'GET' ? {'X-OKR': '1'} : {}),
    ...(viewAs ? {'X-View-As': viewAs} : {}), ...(opts.headers || {})};
  const res = await fetch(url, {method: opts.method || 'GET', headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body, credentials: 'same-origin'});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'Something went wrong. Try again.'); err.status = res.status; err.data = data; throw err; }
  return data;
}
// Every change goes through here: the server checks it, saves it, and every open page refreshes.
async function act(a, args = {}) {
  try {
    const r = await api('/api/act', {method: 'POST', json: {a, args}});
    if (r.msg) toast(r.msg);
    await refresh();
    return r;
  } catch (err) { toast(err.message); if (err.status === 401) await refresh(); return null; }
}
let inflight = null, again = false;
async function refresh() {
  if (inflight) { again = true; return inflight; }
  inflight = (async () => {
    do {
      again = false;
      try {
        const st = await api('/api/state');
        if (!st.realId) { ST = null; phase = 'unlinked'; authMsg = st.account?.email || ''; }
        else {
          Object.keys(st.S).forEach(k => { S[k] = st.S[k]; });
          ST = st; if (phase !== 'app') { phase = 'app'; listen(); if (tab === 'settings') setTimeout(loadMail); }
          if (!st.previewing && viewAs && st.effId === st.realId) viewAs = null;
        }
      } catch (err) {
        if (err.status === 401) { ST = null; phase = err.data?.needsSetup ? 'nosetup' : 'login'; }
        else toast(err.message);
      }
    } while (again);
    render();
  })();
  try { await inflight; } finally { inflight = null; }
}
let es = null;
function listen() {
  if (es || !window.EventSource) return;
  es = new EventSource('/api/events');
  es.onmessage = () => refresh();
}
let tt; function toast(m) { if (!m) return; const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 4000); }
const val = id => document.getElementById(id)?.value ?? '';
const clear = (...ids) => ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

// ---------- tabs, with the address bar following along ----------
const SUBTABS = {ci: ['week', 'rev', 'leave'], hire: ['appr', 'open', 'closed', 'all', 'onb', 'tmpl']};
function go(t) {
  const [base, sub] = String(t || 'dash').split('-');
  tab = base || 'dash';
  if (sub && base === 'ci' && SUBTABS.ci.includes(sub)) ciSeg = sub;
  if (sub && base === 'hire' && SUBTABS.hire.includes(sub)) hireTab = sub;
  if (base === 'hire' && !sub) hireTab = ['manager', 'ceo', 'hr'].includes(eff()?.role) ? 'open' : 'onb';
  if (base === 'ci' && !sub) ciSeg = 'week';
  confirmDel = null; navOpen = false; editing = null; okrUpd = null; krOpen = null; dossier = null; imp = null; fillR = null; declR = null; sbR = null; closeR = null; editR = null; empEdit = false;
  if (tab === 'settings') { cfgDraft = null; mailRep = null; loadMail(); }
  const h = '#' + t;
  if (location.hash !== h) history.replaceState(null, '', h);
}
window.addEventListener('hashchange', () => { if (phase === 'app') { go(location.hash.slice(1)); render(); } });
// The email log is for HR and the CEO only, and not while previewing someone else.
async function loadMail() {
  if (!ST || ST.previewing || !isGroup(realMe())) return;
  try { mailRep = await api('/api/mail'); } catch { mailRep = null; }
  render();
}

// ---------- csv ----------
function buildCsv(kind, e) {
  const d = n => n ? new Date(n).toISOString().slice(0, 10) : '';
  if (kind === 'people') return toCsv([['Name', 'Email', 'Subsidiary', 'Role', 'Team', 'Job title', 'Reports to', 'Started', 'Contract'],
    ...S.people.filter(p => !subFilter || !p.sub || p.sub === subFilter).map(p => [p.name, p.email, p.sub, ROLES[p.role] || p.role, p.team, p.title, mgrOf(p)?.name || '', p.joined, p.contract])]);
  if (kind === 'appraisal') { const yr2 = curY(), dc = liveCycle() || S.cycles.slice().sort((a, b) => b.to.localeCompare(a.to))[0];
    const fr = apFrom || (dc ? dc.from : `${yr2}-01-01`), tt2 = apTo || (dc ? dc.to : today());
    const ex = S.cycles.find(c => c.from === fr && c.to === tt2);
    return toCsv([['Name', 'Job title', 'Subsidiary', 'Team', 'Review period', 'From', 'To', 'Delivered', 'Missed', 'Pushed back', 'Monthly targets hit', 'Monthly targets set',
        'Standups %', 'Activities', 'Activities done', 'Cycle', 'Review stage', 'Signed off on', 'Self rating', 'Manager rating', 'Reviewed by', 'Praise', 'To improve', 'Leave days', 'Check-ins', 'Heavy weeks'],
      ...[...lbScope(e)].filter(n => { const p = person(n); return p && !isGroup(p); }).sort().map(n => { const r = appraise(n, fr, tt2), v = r.rated || r.revs[0] || null;
        return [r.name, r.p.title, r.p.sub, r.p.team, ex ? ex.name : 'Custom window', fr, tt2, r.delivered, r.missed, r.pushed, r.monHit, r.monHit + r.monMiss,
          r0(r.standupPct), r.acts, r.actsDone, v ? v.cycle : '', v ? REVST[v.stage][0] : '', v && v.ackAt ? d(v.ackAt) : '', v && v.self != null ? v.self + '/5' : '',
          v && v.rating != null ? v.rating + '/5' : '', v ? v.by : '', r.praise, r.improve, r.leaveDays, r.checkins, r.heavy]; })]); }
  if (kind === 'perf') return toCsv([['Name', 'Job title', 'Subsidiary', 'Team', 'Standing', 'Owner raised', 'Needs chasing', 'Progress %', 'Expected %', 'Delivering %', 'Standups %', 'Stale goals', 'Stale numbers', 'Last review'],
    ...[...lbScope(e)].map(n => risk(n)).filter(Boolean).map(r => [r.n, r.p.title, r.p.sub, r.p.team, BAND[r.band][0], r.said.join('; '), r.chase.join('; '), r0(r.pct), r0(r.exp), r0(r.ix), r0(r.sr), r.stale, r.numStale, r.rating ? r.rating.rating + '/5' : ''])]);
  if (kind === 'okrs') return toCsv([['Owner', 'Objective', 'Year', 'Key result', 'Kind', 'Current', 'Target', 'Unit', 'Progress %', 'Due month', 'Status', 'Approved by', 'Approved on'],
    ...S.okrs.filter(o => o.owner === 'Company' ? cv(o, e) : scope(e).has(o.owner)).flatMap(o => o.krs.map((k, i) =>
      [ownerLabel(o), o.objective, o.year, k.title, isMonthly(k) ? 'Monthly target' : krMeasured(k) ? 'A number to reach' : 'Done or not done', krMeasured(k) ? krCur(o, k, i) : '', krMeasured(k) ? k.target : '', k.unit || '', r0(krFrac(k, o, i) * 100), k.month != null ? MONFULL[k.month] : '', k.pct === 100 ? 'Approved' : k.req ? 'Awaiting approval' : overdue(o, k) ? 'Overdue' : 'Open', k.apBy || '', d(k.apAt)]))]);
  if (kind === 'stand') return toCsv([['Date', 'Week', 'Person', 'Activity', 'Status', 'Figure', 'Unit'],
    ...S.stand.filter(x => scope(e).has(x.owner)).sort((a, b) => (b.day || b.week).localeCompare(a.day || a.week)).map(x => [x.day || x.week, x.week, x.owner, x.text, x.status, x.n ?? '', x.unit || ''])]);
  if (kind === 'leave') return toCsv([['Person', 'Type', 'From', 'To', 'Days', 'Status', 'Approved by'],
    ...S.leave.filter(x => lbScope(e).has(x.owner)).map(x => [x.owner, x.type, x.from, x.to, x.days, x.status, x.apBy])]);
  if (kind === 'welf') return toCsv([['Week', 'Person', 'Workload', 'How they are doing', 'eNPS', 'Note'],
    ...S.welfare.filter(x => lbScope(e).has(x.owner)).sort((a, b) => b.week.localeCompare(a.week)).map(x => [x.week, x.owner, WLOAD[x.workload], MOOD[x.mood], x.enps ?? '', x.note])]);
  if (kind === 'rev') return toCsv([['Cycle', 'Person', 'Stage', 'Self rating', 'Self review', 'Manager', 'Manager rating', 'Manager review', 'Shared on', 'Signed off on', 'Their comment'],
    ...S.reviews.filter(r => lbScope(e).has(r.owner)).map(r => [(S.cycles.find(x => x.id === r.cycle) || {}).name || '', r.owner, REVST[revStage(r)][0],
      r.self?.rating ?? '', r.self?.text ?? '', r.mgr?.by ?? '', r.mgr?.rating ?? '', r.mgr?.text ?? '',
      r.shared ? d(r.shared.at) : '', r.ack ? d(r.ack.at) : '', r.ack?.text ?? ''])]);
  if (kind === 'hire') return toCsv([['Reference', 'Role', 'Subsidiary', 'Team', 'Hiring manager', 'Recruiter', 'Status', 'Openings', 'Filled', 'Closed unfilled',
      'Reason for hire', 'Replacing', 'Contract', 'Asked for by', 'Asked on', 'Needed by',
      'Approval chain', 'Decided by', 'Opened', 'Days to approve', 'Days open', 'Filled by', 'Note'],
    ...openRoles(e).map(r => [r.ref || '', r.title, r.sub, r.team, r.hm, r.recruiter || '', r.status, openings(r), hiresOf(r).length, closedOf(r).length,
      r.kind || '', r.replacing || '', r.etype || '',
      r.reqBy || '', r.reqAt ? d(r.reqAt) : '', r.needBy || '',
      chainOf(r).map(x => (x.role === 'HR' ? 'HR' : x.who) + ': ' + x.state).join('; '),
      r.apBy || '', r.opened || '', apprDays(r) ?? '', r.opened ? daysOpen(r) : '',
      hiresOf(r).map(h => h.name + ' (' + (h.how || 'New hire') + ')').join('; '), r.note || ''])]);
  return '';
}
function exportCsv(kind, e) {
  const text = buildCsv(kind, e);
  if (!text) return toast('Nothing to export.');
  const name = 'okr-tracker-' + kind + '-' + today() + '.csv';
  try {
    const url = URL.createObjectURL(new Blob(['﻿' + text], {type: 'text/csv;charset=utf-8;'}));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Downloaded ' + name);
  } catch (_) { toast('This browser blocked the download.'); }
}
const expBtn = kind => `<button class="btn quiet sm" data-act="export" data-x="${kind}" title="Download this list as a CSV file">Export CSV</button>`;

// ---------- settings draft: edited on the page, sent whole when saved ----------
function startCfgDraft() {
  const c = JSON.parse(JSON.stringify(S.cfg));
  cfgDraft = {c, from: {subs: [...c.subs], leave: c.leave.map(x => x.type), etypes: [...c.etypes], closeWhy: [...c.closeWhy], onbWho: [...c.onbWho]}};
}
function readCfg() {
  if (!cfgDraft) return;
  const c = cfgDraft.c, g = id => document.getElementById(id);
  if (!g('cf-stale')) return;
  c.subs = c.subs.map((x, i) => g('cf-sub-' + i) ? g('cf-sub-' + i).value.trim() : x);
  c.leave = c.leave.map((x, i) => ({type: g('cf-lt-' + i) ? g('cf-lt-' + i).value.trim() : x.type, days: g('cf-ld-' + i) ? Math.max(0, +g('cf-ld-' + i).value || 0) : x.days}));
  c.onbWho = c.onbWho.map((x, i) => g('cf-ow-' + i) ? g('cf-ow-' + i).value.trim() : x);
  c.etypes = c.etypes.map((x, i) => g('cf-et-' + i) ? g('cf-et-' + i).value.trim() : x);
  c.closeWhy = c.closeWhy.map((x, i) => g('cf-cw-' + i) ? g('cf-cw-' + i).value.trim() : x);
  c.cur = g('cf-cur').value.trim() || c.cur;
  c.reqMgr = +g('cf-rm').value ? 1 : 0; c.execAll = +g('cf-re').value ? 1 : 0;
  ['yearStart:cf-ys', 'staleDays:cf-stale', 'riskAt:cf-risk', 'behindAt:cf-behind', 'aheadAt:cf-ahead', 'standupWeeks:cf-su', 'enpsDays:cf-enps', 'reviewDueDays:cf-rev']
    .forEach(x => { const [k, id] = x.split(':'); const v = Math.round(+g(id).value); if (!isNaN(v)) c[k] = v; });
  c.mail.fromName = g('cf-mfrom').value.trim(); c.mail.replyTo = g('cf-mreply').value.trim(); c.mail.digestHour = +g('cf-mhour').value;
  Object.keys(ALERTS).forEach(k => { if (g('cf-mm-' + k)) c.mail.modes[k] = g('cf-mm-' + k).value; });
}
let draftMoved = false;
function cfgList(key, add) { readCfg(); cfgDraft.c[key].push(add); cfgDraft.from[key].push(null); draftMoved = true; }
function cfgRemove(key, i) { readCfg(); cfgDraft.c[key].splice(i, 1); cfgDraft.from[key].splice(i, 1); draftMoved = true; }
function readTmpl() {
  if (!tdraft) return;
  tdraft.name = val('tn'); tdraft.sub = val('ts');
  tdraft.tasks = tdraft.tasks.map((t, i) => { const el = document.getElementById('tt-' + i);
    return el ? {t: el.value, who: val('to-' + i), off: +val('td-' + i) || 0} : t; });
}

// ---------- html helpers ----------
const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
const bar = (p, c = '') => `<div class="bar ${c === '' ? (p >= 70 ? 'good' : p < 35 ? 'warm' : '') : c}" role="progressbar" aria-valuenow="${r0(p)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div>`;
const opts = (list, sel) => list.map(o => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');
const weekNav = (dark) => {
  const s = parseIso(wk), e = new Date(s); e.setDate(e.getDate() + 6);
  const f = (d, y) => d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', ...(y ? {year: 'numeric'} : {})});
  return `<div class="weeknav${dark ? ' on-dark' : ''}"><button class="btn ghost sm" data-act="wk" data-n="-1" aria-label="Previous week">‹</button>
    <span class="lab">${f(s)} – ${f(e, true)}</span><button class="btn ghost sm" data-act="wk" data-n="1" aria-label="Next week"${wk >= curWeek() ? ' disabled' : ''}>›</button>
    <button class="btn ghost sm" data-act="wk" data-n="0"${wk === curWeek() ? ' disabled' : ''}>This week</button></div>`;
};
const ownerOpts = (list, sel) => list.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v === 'Company' ? 'Whole company' : v.startsWith('Company:') ? v.slice(8) + ' (subsidiary)' : v)}</option>`).join('');
const ICONS = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  lead: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  okrs: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  appr: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.5"/>',
  stand: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  review: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  perf: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ci: '<path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7C19 15.6 12 20 12 20z"/>',
  hire: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M18.5 8.5v6M21.5 11.5h-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  swap: '<path d="M15 12H3m0 0 4-4m-4 4 4 4M15 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4"/>'
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ''}</svg>`;
const ini = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const hue = n => [...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 6;
const avatar = (n, sm) => `<span class="avatar av${hue(n)}${sm ? ' sm' : ''}" aria-hidden="true">${esc(ini(n))}</span>`;
const ROLE_TONE = {ceo: 'vio', hr: 'tea', manager: 'amb', member: 'sky'};
const pageHead = (title, sub, right = '') => `<div class="pagehead"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>${right}</div>`;
const empty = (msg, btn = '') => `<div class="empty"><p>${esc(msg)}</p>${btn}</div>`;
const stat = (tone, label, num, sub, pct, to) => `<button class="stat ${tone}" data-act="tab" data-t="${to}" title="Open ${esc(label)}"><span class="l">${esc(label)}<svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></span><span class="n">${num}</span>${pct != null ? bar(pct, 'tone') : ''}<span class="s">${esc(sub)}</span></button>`;
const tabBtn = (t, label, cls = 'ghost') => `<button class="btn ${cls} sm" data-act="tab" data-t="${t}">${esc(label)}</button>`;
const teamsIn = names => [...new Set([...names].map(n => person(n)?.team).filter(Boolean))].sort();
const hit = (q, ...t) => !q.trim() || t.some(x => String(x || '').toLowerCase().includes(q.trim().toLowerCase()));
function fbar(t, o = {}) {
  const f = ff[t], dirty = Object.values(f).some(Boolean);
  if (o.team && f.team && !o.team.includes(f.team)) f.team = '';
  const sel = (k, label, all, list) => `<label class="f">${label}<select id="ff-${t}-${k}" data-ff="${t}.${k}"><option value="">${all}</option>${list.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}"${f[k] === v ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
  return `<div class="card fbar"><div class="row" style="align-items:flex-end">
    <label class="f grow" style="flex-basis:220px">Search<input type="search" id="ff-${t}-q" data-ff="${t}.q" value="${esc(f.q)}" placeholder="${esc(o.ph || 'Search')}"></label>
    ${o.v ? sel('v', o.vLabel || 'Result', o.vAll || 'Any', o.v) : ''}${o.mo ? sel('mo', 'Due month', 'Any month', o.mo) : ''}${o.team && o.team.length > 1 ? sel('team', 'Team', 'All teams', o.team) : ''}${o.st ? sel('st', o.stLabel || 'Status', o.stAll || 'All', o.st) : ''}
    ${dirty ? `<button class="btn quiet sm" data-act="clearff" data-t="${t}">Clear filters</button>` : ''}${o.count != null ? `<span class="sub">${esc(o.count)}</span>` : ''}</div></div>`;
}
function lbRows(e) {
  return [...lbScope(e)].map(n => person(n)).filter(p => p && p.role !== 'hr').map(p => ({p, pct: personPct(p.name), g: gain(p.name, wk)}))
    .sort((a, b) => b.pct - a.pct || b.g - a.g || a.p.name.localeCompare(b.p.name));
}
function lbRow(r, i, me) {
  return `<div class="lbrow${i === 0 ? ' first' : ''}"><span class="medal ${i < 3 ? 'm' + (i + 1) : ''}">${i + 1}</span>${avatar(r.p.name)}
    <div class="lbname"><div><b>${esc(r.p.name)}</b>${r.p.name === me ? ' <span class="sub">(you)</span>' : ''}</div><div class="sub">${esc(where(r.p))}</div>${r.g > 0.04 ? `<div class="chips">${chip('+' + fmt(r.g) + '% this week', 'good')}</div>` : ''}</div>
    <div class="lbbar">${bar(r.pct)}</div><span class="pc">${r0(r.pct)}%</span></div>`;
}
const dosLink = (e, p, label) => canSeeDossier(e, p) ? `<button class="namelink" data-act="dossier" data-id="${p.id}">${esc(label || p.name)}</button>` : esc(label || (p ? p.name : ''));
const statTone = st => st === 'Done' ? 'good' : st === 'Blocked' ? 'bad' : st === 'In progress' ? 'warn' : '';
function grouped(items, key) { const m = new Map(); items.forEach(x => { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m].sort((a, b) => a[0].localeCompare(b[0])); }
const canWriteReview = (e, p) => !!p && p.mgr === e.id;

// ---------- views ----------
function viewDash(e) {
  const hr = e.role === 'hr', appr = e.role === 'manager' || e.role === 'ceo';
  const myOkrs = personOkrs(e.name), myPct = personPct(e.name), cp = companyPct(e);
  const mine = S.stand.filter(x => x.week === wk && x.owner === e.name);
  const done = mine.filter(x => x.status === 'Done').length;
  const awaitingOf = list => list.reduce((s, o) => s + o.krs.filter(k => k.req && k.pct !== 100).length, 0);
  const awaiting = awaitingOf(myOkrs);
  const revN = appr ? revsFor(e).length : 0, waiting = appr ? pendingFor(e).length + revN : 0;
  const wkAll = S.stand.filter(x => x.week === wk && scope(e).has(x.owner));
  const companyStat = cp !== null ? stat('vio', 'Company OKRs', r0(cp) + '%', 'Average progress. View company OKRs', cp, 'okrs') : stat('vio', 'Company OKRs', '—', 'None set yet', null, 'okrs');
  const stats = hr ? [companyStat,
      stat('tea', 'Standup this week', wkAll.length ? `${wkAll.filter(x => x.status === 'Done').length}/${wkAll.length}` : '—', wkAll.length ? 'Activities done. Open standup' : 'No entries yet', null, 'stand'),
      stat('amb', 'Open requests', awaitingOf(S.okrs.filter(o => o.owner === 'Company' ? cv(o, e) : scope(e).has(o.owner))), 'Finished key results across the company, waiting on approvers', null, 'okrs')]
    : [stat('ind', 'Your annual progress', r0(myPct) + '%', myOkrs.length ? plural(myOkrs.length, 'OKR', 'OKRs') + '. Open my OKRs' : (e.role === 'member' ? 'No OKRs yet. Your line manager sets them' : 'No OKRs yet. Create one'), myPct, 'okrs'),
      stat('tea', 'Standup this week', mine.length ? `${done}/${mine.length}` : '—', mine.length ? 'Activities done. Open standup' : 'No entries yet. Add one', null, 'stand'),
      ...(e.role === 'ceo' ? [] : [stat('amb', 'My requests', awaiting, awaiting ? 'Key results you finished, waiting for someone to approve' : 'Nothing waiting. Open my OKRs', null, 'okrs')]),
      ...(appr ? [stat('ros', 'To review', waiting, waiting ? 'Requests from your team for you to approve or send back' : 'No requests to review. Open approvals', null, 'appr')] : []),
      companyStat];
  // NT-1: the same list the daily email is built from, so the two never disagree.
  const todo = attentionFor(e).map(x => [x.text, x.tab ? tabBtn(x.tab, x.btn || 'Open', '') : '']);
  if (ST.mail && !ST.previewing && ST.mail.failed) todo.unshift([`${plural(ST.mail.failed, 'email', 'emails')} could not be delivered in the last two weeks.`, tabBtn('settings', 'See why', '')]);
  const company = S.okrs.filter(o => o.owner === 'Company' && cv(o, e));
  const subCard = isGroup(e) ? `<section class="card"><div class="sec-h"><h2>Subsidiaries</h2>${subFilter ? '<button class="btn quiet sm" data-act="subfilter" data-s="">Show all</button>' : '<span class="sub">Select one to filter the whole app</span>'}</div><div class="list">${subs().map(n => {
    const ps = S.people.filter(p => p.sub === n && p.role !== 'hr'), pct = ps.length ? ps.reduce((t, p) => t + personPct(p.name), 0) / ps.length : 0;
    const pend = S.okrs.filter(o => person(o.owner)?.sub === n).reduce((t, o) => t + o.krs.filter(k => k.req && k.pct !== 100).length, 0);
    const lk = pend && e.role === 'ceo';
    return `<div class="subrow${subFilter === n ? ' on' : ''}"><button class="subhit" data-act="subfilter" data-s="${esc(n)}" aria-pressed="${subFilter === n}"><span class="grow"><b>${esc(n)}</b><span class="sub">${plural(ps.length, 'person', 'people')}${pend && !lk ? ' · ' + pend + ' awaiting approval' : ''}</span></span><span class="subbar">${bar(pct)}</span><span class="pc">${r0(pct)}%</span></button>${lk ? `<button class="pendlink" data-act="subappr" data-s="${esc(n)}" title="Review ${esc(n)} requests">${pend} awaiting approval</button>` : ''}</div>`; }).join('')}</div></section>` : '';
  const okrRow = o => `<button class="rowlink" data-act="tab" data-t="okrs" aria-label="Open OKRs: ${esc(o.objective)}"><span class="kr"><span class="t"><b>${esc(o.objective)}</b><span class="sub" style="display:block">${plural(o.krs.length, 'key result', 'key results')}</span></span></span><span class="prog" style="margin-top:8px">${bar(okrPct(o))}<span class="pc">${r0(okrPct(o))}%</span></span></button>`;
  const rows = lbRows(e);
  return `${monCall()}
  <section class="hero"><div><h1>Welcome back, ${esc(e.name.split(' ')[0])}</h1><p>${esc(ROLES[e.role] || e.role)} · ${esc(where(e))}${subFilter && isGroup(e) ? ' · showing ' + esc(subFilter) + ' only' : ''}. Here is where things stand this week.</p></div>${weekNav(true)}</section>
  <div class="stats">${stats.join('')}</div>
  <div class="cols"><div class="stack">
    ${subCard}
    ${hr ? '' : `<section class="card s-okrs"><div class="sec-h"><h2>My OKRs</h2>${myOkrs.length ? tabBtn('okrs', 'View all', 'quiet') : ''}</div>
      ${myOkrs.length ? `<div class="list">${myOkrs.slice(0, 4).map(okrRow).join('')}</div>` : empty(e.role === 'member' ? 'You have no OKRs yet. Your line manager sets them.' : 'You have no OKRs yet.', e.role === 'member' ? '' : tabBtn('okrs', 'Add your first OKR', ''))}</section>
    <section class="card s-prios"><div class="sec-h"><h2>My standup this week</h2>${mine.length ? tabBtn('stand', 'View all', 'quiet') : ''}</div>
      ${mine.length ? `<div class="list">${mine.map(x => `<div class="kr"><div class="t">${esc(x.text)}</div>${chip(x.status, statTone(x.status))}</div>`).join('')}</div>` : empty('No standup entries for this week.', tabBtn('stand', 'Add an activity', ''))}</section>`}
    ${company.length ? `<section class="card s-company"><div class="sec-h"><h2>Company OKRs</h2>${tabBtn('okrs', 'View all', 'quiet')}</div><p class="sub" style="margin:-4px 0 4px">Goals for the whole company or one subsidiary.</p><div class="list">${company.slice(0, 3).map(okrRow).join('')}</div></section>` : ''}
  </div><div class="stack">
    <section class="card s-attn"><div class="sec-h"><h2>Needs your attention</h2></div>
      ${todo.length ? `<div class="list">${todo.map(([t, b]) => `<div class="kr"><div class="t">${esc(t)}</div>${b}</div>`).join('')}</div>` : empty('You are all caught up.')}</section>
    <section class="card s-lb"><div class="sec-h"><h2>Team leaderboard</h2>${rows.length > 5 ? tabBtn('lead', 'See all', 'quiet') : ''}</div>
      ${rows.length ? `<div class="list">${rows.slice(0, 5).map((r, i) => lbRow(r, i, e.name)).join('')}</div>` : empty('No one to rank yet.')}</section>
  </div></div>`;
}
function viewLead(e) {
  const all = lbRows(e).map((r, i) => ({r, i})), f = ff.lead;
  const rows = all.filter(({r}) => (!f.team || r.p.team === f.team) && hit(f.q, r.p.name, r.p.team, r.p.sub));
  return `${pageHead('Team leaderboard', 'Ranked by approved annual progress. Everyone in your team can see this page.', weekNav())}
  ${all.length > 1 ? fbar('lead', {ph: 'Search by name', team: teamsIn(all.map(x => x.r.p.name)), count: `Showing ${rows.length} of ${all.length}. Ranks stay the same when filtered.`}) : ''}
  <div class="card">${rows.length ? `<div class="list">${rows.map(({r, i}) => lbRow(r, i, e.name)).join('')}</div>` : empty(all.length ? 'No one matches these filters.' : 'No people to rank yet. HR adds people in the Directory.')}</div>`;
}
const monCall = () => new Date().getDay() === 1 && wk === curWeek() ? '<div class="banner info">Today: mandatory all-teams call at 9:00 AM to review business priorities.</div>' : '';

function editForm(o, direct) {
  const d = editing;
  return `<form class="card" data-submit="saveedit"><h3>Edit OKR</h3>
    <p class="sub">${direct ? 'Changes apply right away.' : 'Changes are not applied until ' + esc(approverOf(o)) + ' approves them.'}</p>
    <label class="f">Objective<input type="text" id="ed-obj" data-draft="ed-obj" value="${esc(d.obj)}" maxlength="200"></label>
    <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Key results · ${fmt(100 / d.krs.length)}% each</span>
    ${d.krs.map((k, i) => { const lock = k.src != null && (o.krs[k.src].pct === 100 || o.krs[k.src].req);
      return `<div class="krform"><div class="row" style="flex-wrap:nowrap"><input type="text" class="grow" id="ed-kr-${i}" data-draft="ed-kr" data-i="${i}" value="${esc(k.title)}" aria-label="Key result ${i + 1}" maxlength="200">${isPersonal(o) && (k.type || 'binary') !== 'monthly' ? `<select id="ed-km-${i}" data-chg="edmonth" data-i="${i}" aria-label="Due month">${monOpts(k.month)}</select>` : ''}${d.krs.length > 2 && !lock ? `<button type="button" class="btn quiet sm" data-act="rmedkr" data-i="${i}">Remove</button>` : ''}</div>
      <div class="row"><select id="ed-kk-${i}" data-chg="edkind" data-i="${i}" aria-label="How it is measured">${KRTYPE.map(([v, l]) => `<option value="${v}"${(k.type || 'binary') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${(k.type || 'binary') !== 'binary' ? `<input type="number" min="0" step="any" id="ed-ktg-${i}" data-draft="edtg" data-i="${i}" value="${esc(String(k.target ?? ''))}" placeholder="Target" aria-label="Target ${i + 1}" style="width:120px">
        <input type="text" id="ed-kun-${i}" data-draft="edun" data-i="${i}" value="${esc(k.unit || '')}" placeholder="Unit" aria-label="Unit ${i + 1}" style="width:150px">` : ''}</div></div>`; }).join('')}
    <div><button type="button" class="btn ghost sm" data-act="addedkr"${d.krs.length >= 20 ? ' disabled' : ''}>+ Add key result</button></div>
    <p class="sub" style="margin:0">${isPersonal(o) ? 'Personal key results can be adjusted every month: change what you do or when it is due.' : 'Company OKRs are annual and normally stay in place all year.'}</p></div>
    <div class="row"><button class="btn" type="submit">${direct ? 'Save changes' : 'Send for approval'}</button><button type="button" class="btn quiet" data-act="canceledit">Cancel</button></div></form>`;
}
function okrCard(o, e) {
  const direct = editDirect(e, o);
  if (editing && editing.id === o.id) return editForm(o, direct);
  const canEdit = canEditOkr(e, o);
  const n = o.krs.length, wt = 100 / n, p = okrPct(o);
  const canDel = canDeleteOkr(e, o), canKr = canMarkKr(e, o);
  const delUi = !canDel ? '' : confirmDel === o.id
    ? `<span class="acts"><button class="btn bad sm" data-act="delokr" data-id="${o.id}">Delete</button><button class="btn quiet sm" data-act="cancel">Cancel</button></span>`
    : `<button class="btn quiet sm" data-act="askdel" data-id="${o.id}">Delete</button>`;
  const editUi = !canEdit ? '' : o.rev ? `<span class="acts">${chip('Change awaiting approval', 'warn')}${o.rev.by === e.name ? `<button class="btn quiet sm" data-act="cancelchange" data-id="${o.id}">Cancel change</button>` : ''}</span>` : `<button class="btn quiet sm" data-act="editokr" data-id="${o.id}">Edit</button>`;
  const mine = o.owner !== 'Company' ? o.owner === e.name : isGroup(e);
  const st = okrStatus(o), lu = lastUpd(o);
  const manKrs = o.krs.map((k, i) => ({k, i})).filter(x => krMeasured(x.k) && x.k.pct !== 100 && !krAuto(o, x.k, x.i));
  const upd = okrUpd === o.id ? `<form class="ci-form" data-submit="saveupd" style="flex-direction:column;align-items:stretch;gap:10px"><input type="hidden" id="up-id" value="${o.id}">
    <div class="row"><label class="f grow" style="flex-basis:260px">Add a note <span class="sub">(optional)</span><input type="text" id="up-text" placeholder="Context the numbers do not show" maxlength="500"></label></div>
    ${manKrs.length ? `<div style="display:flex;flex-direction:column;gap:6px"><span class="lbl">Numbers nobody can read off the work log</span>
      ${manKrs.map(({k, i}) => { const lg = latestLogged(o.id, i);
        return `<div class="row" style="flex-wrap:nowrap"><span class="grow" style="min-width:0">${esc(k.title)}</span>
          <input type="number" min="0" step="any" id="up-kr-${i}" value="${esc(String(krCur(o, k, i)))}" aria-label="Current value for ${esc(k.title)}" style="width:120px">
          <span class="sub num" style="white-space:nowrap">of ${fn(k.target)}${k.unit ? ' ' + esc(k.unit) : ''}</span>
          ${lg != null && lg !== krCur(o, k, i) ? `<button type="button" class="btn quiet sm" data-act="usesugg" data-i="${i}" data-v="${lg}">Log says ${fn(lg)}</button>` : ''}</div>`; }).join('')}</div>` : ''}
    <div class="row"><button class="btn" type="submit">Save</button><button type="button" class="btn quiet" data-act="cancelupd">Cancel</button></div></form>` : '';
  return `<article class="card"><div class="okr-h"><div class="grow"><h3>${esc(o.objective)}</h3><div class="sub">${esc(ownerLabel(o))} · ${esc(o.year)} · ${plural(n, 'key result', 'key results')}</div></div><span class="acts">${chip(st, OKRST_TONE[st])}<span class="sub">worked out from the numbers</span>${mine && !upd ? `<button class="btn quiet sm" data-act="openupd" data-id="${o.id}">${manKrs.length ? 'Numbers and notes' : 'Add a note'}</button>` : ''}${editUi}${delUi}</span></div>
    ${upd}
    ${lu ? `<div class="sub">${esc(lu.by)}: ${esc(lu.text)}</div>` : ''}
    <div class="prog">${bar(p)}<span class="pc">${r0(p)}%</span></div>
    <div class="list">${o.krs.map((k, i) => {
      const st2 = krState(k);
      if (ff.okrs.mo && isPersonal(o) && String(k.month) !== ff.okrs.mo) return '';
      const od = overdue(o, k), due = isMonthly(k) ? chip('Every month', 'acc') : isPersonal(o) && k.month != null && st2 !== 'approved' ? chip((od ? 'Overdue · ' : 'Due ') + MON[k.month], od ? 'bad' : '') : '';
      const status = st2 === 'approved' ? chip('Approved' + (k.apBy ? ' by ' + k.apBy : '') + (k.apAt ? ' · ' + dateShort(k.apAt) : ''), 'good') : st2 === 'awaiting' ? chip('Awaiting approval', 'warn') : chip('Not completed');
      let a = '', mv = '';
      if (od && o.year === curY() && !o.rev && (direct || o.owner === e.name)) mv = `<button class="btn quiet sm" data-act="kmove" data-o="${o.id}" data-i="${i}" title="${direct ? 'Move this key result to this month' : 'Ask your line manager to move this key result to this month'}">Move to ${MON[curM()]}</button>`;
      if (canKr) {
        if (st2 === 'open') a = `<button class="btn ghost sm" data-act="krdone" data-o="${o.id}" data-i="${i}" data-v="1" title="${e.role === 'ceo' ? 'Mark this key result done' : 'Mark this key result done. Your line manager still has to approve it.'}">Done</button>`;
        else if (st2 === 'awaiting') a = `<button class="btn quiet sm" data-act="krdone" data-o="${o.id}" data-i="${i}" data-v="0">Withdraw</button>`;
        else if (e.role === 'ceo' || o.owner === 'Company') a = `<button class="btn quiet sm" data-act="krdone" data-o="${o.id}" data-i="${i}" data-v="0">Reopen</button>`;
      }
      const acts = activityOn(o.id, i), openK = krOpen === o.id + '|' + i;
      const actBtn = acts.length ? `<button class="linkish" data-act="krlog" data-o="${o.id}" data-i="${i}" aria-expanded="${openK}">${plural(acts.length, 'activity', 'activities')} logged${acts.filter(x => x.status === 'Done').length ? ', ' + acts.filter(x => x.status === 'Done').length + ' done' : ''}</button>` : '<span>nothing logged against this yet</span>';
      const meas = krMeasured(k), frac = krFrac(k, o, i), isAuto = krAuto(o, k, i);
      const valUi = !meas ? '' : `<div class="measure">
        <div class="prog">${bar(frac * 100, frac >= 1 ? 'good' : '')}<span class="pc">${r0(frac * 100)}%</span></div>
        <div class="row" style="gap:8px"><span class="sub num">${esc(krMeasure(o, k, i))}</span>${isMonthly(k) ? `<span class="sub">counted from the standup log &middot; starts again in ${esc(MON[(curM() + 1) % 12])}</span>`
          : isAuto ? `<span class="sub">counted from the standup log</span>`
          : krStale(o, k, i) ? chip(k.curAt ? 'number ' + Math.floor((Date.now() - k.curAt) / 86400000) + ' days old' : 'never set', 'warn') : ''}
          ${(p2 => p2 ? chip(fn(p2) + (k.unit ? ' ' + k.unit : '') + ' logged but not marked done', 'warn') : '')(krMeasured(k) ? pendingTotal(o.id, i) : 0)}</div></div>`;
      return `<div class="krwrap"><div class="kr"><div class="t">${esc(k.title)}<div class="sub num">${fmt(wt)}% of this OKR · ${actBtn}</div></div><div class="acts">${due}${status}${mv}${a}</div></div>${valUi}${openK ? actList(acts, e) : ''}</div>`;
    }).join('')}</div></article>`;
}
const actLine = (x, e) => `<div class="kr"><div class="t">${esc(x.text)}<div class="sub">${esc(x.owner)} · ${esc(dayLabel(x.day || x.week))}${x.n != null ? ' · ' + fmt(x.n) + ' ' + esc(x.unit || '') : ''}</div></div>${e && x.owner === e.name ? `<select class="sm" data-chg="stand" data-id="${x.id}" aria-label="Status">${opts(SSTAT, x.status)}</select>` : chip(x.status, statTone(x.status))}</div>`;
const actList = (rows, e) => `<div class="actlog"><div class="list">${rows.map(x => actLine(x, e)).join('')}</div></div>`;

function viewOkrs(e) {
  const sc = scope(e), f = ff.okrs;
  const okrOk = o => hit(f.q, o.objective, o.owner === 'Company' ? ownerLabel(o) : o.owner, ...o.krs.map(k => k.title)) && (!f.st || (f.st === 'stale' ? isStale(o) : okrStatus(o) === f.st)) && (!f.mo || !isPersonal(o) || o.krs.some(k => String(k.month) === f.mo));
  const allCompany = S.okrs.filter(o => o.owner === 'Company' && cv(o, e));
  const allPeople = [...sc].filter(n => personOkrs(n).length);
  const company = allCompany.filter(o => !f.team && okrOk(o));
  const people = allPeople.filter(n => (!f.team || person(n)?.team === f.team) && personOkrs(n).some(okrOk)).sort((a, b) => a.localeCompare(b));
  const mineNames = allPeople.filter(n => n === e.name), teamNamesL = allPeople.filter(n => n !== e.name);
  const hasTeam = [...sc].some(n => n !== e.name);
  const view = okrTab && (okrTab !== 'team' || hasTeam) ? okrTab : (isGroup(e) ? 'company' : 'personal');
  const hm = histM == null ? Math.max(0, curM() - 1) : histM;
  const nMine = mineNames.reduce((t, n) => t + personOkrs(n).length, 0);
  const nTeam = teamNamesL.reduce((t, n) => t + personOkrs(n).length, 0);
  const forView = view === 'company' ? [] : people.filter(n => view === 'personal' ? n === e.name : n !== e.name);
  const shownN = view === 'company' ? company.length : forView.reduce((t, n) => t + personOkrs(n).filter(okrOk).length, 0);
  const tabs = `<div class="seg" role="tablist" aria-label="Whose goals">${[['company', 'Company', allCompany.length],
    ...(hasTeam ? [['team', isGroup(e) ? 'Everyone' : 'My team', nTeam]] : []), ['personal', 'Mine', nMine], ['hist', 'History', null]].map(([v, l, c]) =>
    `<button role="tab" aria-selected="${view === v}" data-act="okrtab" data-v="${v}">${l}${c == null ? '' : `<span class="seg-n">${c}</span>`}</button>`).join('')}</div>`;
  const ow = ownerOptions(e);
  if (!ow.includes(draft.owner)) draft.owner = ow[0];
  const n = draft.krs.length;
  const newBtn = ow.length ? `<button class="btn" data-act="newokr">${showForm ? 'Close form' : '+ New OKR'}</button>` : '';
  const form = ow.length && showForm ? `<form class="card" data-submit="addokr"><h2 style="font-size:16px">New OKR</h2>
    <div class="row" style="align-items:flex-end"><label class="f grow" style="flex-basis:320px">Objective<input type="text" id="ok-obj" data-draft="obj" value="${esc(draft.obj)}" placeholder="What do you want to achieve this year?" maxlength="200"></label>
    <label class="f">Owner<select id="ok-owner" data-chg="owner"${ow.length < 2 ? ' disabled' : ''}>${ownerOpts(ow, draft.owner)}</select></label></div>
    <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Key results · ${fmt(100 / n)}% each</span>
    ${draft.krs.map((k, i) => `<div class="krform"><div class="row" style="flex-wrap:nowrap"><span class="num sub" style="min-width:44px;text-align:right">${fmt(100 / n)}%</span>
      <input type="text" class="grow" id="ok-kr-${i}" data-draft="kr" data-i="${i}" value="${esc(k)}" placeholder="Key result ${i + 1}" aria-label="Key result ${i + 1}" maxlength="200">
      ${draft.owner && !draft.owner.startsWith('Company') && (draft.kt[i] || 'binary') !== 'monthly' ? `<select id="ok-km-${i}" data-chg="krmonth" data-i="${i}" aria-label="Due month">${monOpts(draft.ms[i] ?? curM())}</select>` : ''}
      <button type="button" class="btn quiet sm" data-act="rmkr" data-i="${i}"${n <= 2 ? ' disabled' : ''} aria-label="Remove key result ${i + 1}">Remove</button></div>
      <div class="row" style="padding-left:52px"><select id="ok-kk-${i}" data-chg="krkind" data-i="${i}" aria-label="How it is measured">${KRTYPE.map(([v, l]) => `<option value="${v}"${(draft.kt[i] || 'binary') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${(draft.kt[i] || 'binary') !== 'binary' ? `<input type="number" min="0" step="any" id="ok-ktg-${i}" data-draft="ktg" data-i="${i}" value="${esc(draft.tg[i] || '')}" placeholder="Target" aria-label="Target ${i + 1}" style="width:120px">
        <input type="text" id="ok-kun-${i}" data-draft="kun" data-i="${i}" value="${esc(draft.un[i] || '')}" placeholder="Unit, e.g. guides" aria-label="Unit ${i + 1}" style="width:160px">` : ''}</div></div>`).join('')}</div>
    <div class="row between"><div class="row"><button type="button" class="btn ghost sm" data-act="addkr"${n >= 20 ? ' disabled' : ''}>+ Add key result</button><span class="sub">2 to 20 key results</span></div>
    <p class="sub" style="flex-basis:100%;margin:0">A number to reach adds up every activity you log against it until the target is met. A number to reach every month does the same but resets on the first of each month, so there is no deadline and nothing to move. Leave it as done or not done when it is a one-off. ${draft.owner && draft.owner.startsWith('Company') ? 'Company OKRs are annual and stay in place all year.' : 'Plan each key result for a month. You can adjust personal OKRs every month, and changes are approved by the line manager. Make each one specific, measurable, achievable, realistic and time-bound.'}</p>
    <div class="row"><button type="button" class="btn quiet" data-act="newokr">Cancel</button><button class="btn" type="submit">Save OKR</button></div></div></form>` : '';
  return `${pageHead('OKRs', 'Annual goals and their key results. Standing is worked out from the numbers; counting key results read themselves off the standup log.', `<div class="row">${newBtn}${expBtn('okrs')}</div>`)}
  ${e.role === 'member' ? `<div class="banner info"><span>Your line manager sets your OKRs. You can edit them, and ${esc(approverOf({owner: e.name}))} has to approve each change before it takes effect.</span></div>` : ''}
  ${form}
  ${tabs}
  ${view === 'hist' ? '<p class="sub" style="margin:0">What each month came to. A key result is delivered in the month it was approved, missed if its month passed without approval, and pushed back if it was promised for that month and later moved.</p>' : `<p class="sub" style="margin:0">${view === 'company' ? 'Company OKRs are annual. Corporate direction rarely changes abruptly, so they stay in place all year.' : view === 'team' ? 'Everyone in your scope. You can see their goals and standing, but only they can update them.' : 'Planned by month and adjustable monthly if the work is not going to plan. Changes go to your line manager for approval.'}</p>`}
  ${view !== 'hist' && (view === 'company' ? allCompany.length : view === 'team' ? nTeam : nMine) > 1 ? fbar('okrs', {ph: view === 'company' ? 'Search company OKRs or key results' : 'Search objectives, key results or people', team: view === 'team' ? teamsIn(teamNamesL) : [], mo: view !== 'company' ? MON.map((m, i) => [String(i), MONFULL[i] + (i === curM() ? ' (this month)' : '')]) : null, st: [...OKRST.map(x => [x, x]), ['stale', 'Not updated recently']], stLabel: 'Standing', stAll: 'Any', count: `Showing ${shownN} of ${view === 'company' ? allCompany.length : view === 'team' ? nTeam : nMine} OKRs`}) : ''}
  ${view === 'hist' ? (rows => {
    const f2 = ff.hist, q = f2.q.trim().toLowerCase();
    const shown = rows.filter(r => (!f2.v || r.outcome === f2.v) && (!f2.team || person(r.o.owner)?.team === f2.team) && hit(q, r.o.owner, r.k.title, r.o.objective));
    const cnt = k2 => rows.filter(r => r.outcome === k2).length;
    const byOwner = grouped(shown.map(r => ({...r, owner: r.o.owner})), 'owner');
    return `<div class="row" style="gap:4px"><button class="btn quiet sm" data-act="histm" data-n="-1" aria-label="Earlier month">&lsaquo;</button>
      <span class="num" style="min-width:150px;text-align:center">${esc(MONFULL[hm])} ${esc(curY())}</span>
      <button class="btn quiet sm" data-act="histm" data-n="1" aria-label="Later month"${hm >= curM() ? ' disabled' : ''}>&rsaquo;</button>
      ${hm !== Math.max(0, curM() - 1) ? '<button class="btn quiet sm" data-act="histm" data-n="0">Last month</button>' : ''}</div>
    <div class="stats">${stat('tea', 'Delivered', cnt('delivered'), 'Approved during ' + MONFULL[hm], null, 'okrs')}
      ${stat('ros', 'Missed', cnt('missed'), 'Due that month and never approved', null, 'okrs')}
      ${stat('amb', 'Pushed back', cnt('moved'), 'Promised for that month, moved later', null, 'okrs')}
      ${stat('ind', 'Still open', cnt('open'), 'Due this month, not yet approved', null, 'okrs')}</div>
    ${rows.length > 1 ? fbar('hist', {ph: 'Search by person, objective or key result', team: teamsIn(rows.map(r => r.o.owner)),
      v: Object.entries(OUTCOME).map(([a2, b2]) => [a2, b2[0]]), vLabel: 'Outcome', vAll: 'Any outcome',
      count: `Showing ${shown.length} of ${rows.length} key results`}) : ''}
    ${byOwner.length ? byOwner.map(([who, list]) => `<section class="card"><div class="person-h">${avatar(who)}<b class="grow">${dosLink(e, person(who), who)}</b>
      <span class="sub">${list.filter(r => r.outcome === 'delivered').length} of ${list.length} delivered</span></div>
      <div class="list">${list.map(r => `<div class="kr"><div class="t">${esc(r.k.title)}
        <div class="sub">${esc(r.o.objective)}${r.got != null ? ' &middot; ' + fn(r.got) + ' of ' + fn(r.k.target) + (r.k.unit ? ' ' + esc(r.k.unit) : '') : ''}${r.outcome === 'moved' ? ' &middot; now due ' + MON[r.k.month] : ''}${r.outcome === 'delivered' && r.k.apBy && r.got == null ? ' &middot; approved by ' + esc(r.k.apBy) : ''}</div></div>
        ${chip(OUTCOME[r.outcome][0], OUTCOME[r.outcome][1])}</div>`).join('')}</div></section>`).join('')
      : `<div class="card">${empty(rows.length ? 'Nothing matches these filters.' : 'Nothing was planned for ' + MONFULL[hm] + '.')}</div>`}`;
  })(monthRows(e, hm)) : ''}
  ${view === 'company' ? `<section class="block"><div class="sec-h"><h2>Company OKRs</h2>${company.length ? `<span class="sub">Average <span class="num">${r0(companyPct(e))}%</span></span>` : ''}</div><p class="sub" style="margin:-4px 0 4px">Goals for the whole company or one subsidiary.</p>
    ${company.length ? company.map(o => okrCard(o, e)).join('') : `<div class="card">${empty((f.q || f.st || f.team ? 'No company OKRs match these filters.' : 'No company OKRs yet.') + (e.role === 'ceo' ? ' Choose New OKR and set the owner to Whole company or a subsidiary.' : ''))}</div>`}</section>` : ''}
  ${view !== 'company' && view !== 'hist' ? `<section class="block"><div class="sec-h"><h2>${view === 'personal' ? 'My OKRs' : isGroup(e) ? 'Everyone' : 'My team'}</h2></div>
    ${forView.length ? forView.map(nm => `<div class="block"><div class="person-h">${avatar(nm, true)}<b>${esc(nm)}</b><span class="sub">Annual progress <span class="num">${r0(personPct(nm))}%</span></span></div>${personOkrs(nm).filter(okrOk).map(o => okrCard(o, e)).join('')}</div>`).join('')
      : `<div class="card">${empty(f.q || f.st || f.team ? 'No OKRs match these filters.' : view === 'personal' ? 'You have no OKRs yet.' + (e.role === 'member' ? ' Your line manager will set them.' : '') : 'Nobody here has OKRs yet.', view === 'personal' && ow.length ? '<button class="btn" data-act="newokr">Create the first OKR</button>' : '')}</div>`}</section>` : ''}`;
}

function viewApprovals(e) {
  const all = pendingFor(e), f = ff.appr;
  const list = all.filter(({o, k}) => (!f.team || person(o.owner)?.team === f.team) && hit(f.q, o.owner, o.objective, k.title));
  const revs = revsFor(e).filter(o => (!f.team || person(o.owner)?.team === f.team) && hit(f.q, o.owner, o.objective, o.rev.objective, ...o.rev.krs.map(k => k.title)));
  const keptSrc = o => new Set(o.rev.krs.map(k => k.src));
  const diff = o => `<div class="diff">${o.rev.objective !== o.objective ? `<div><s>${esc(o.objective)}</s> → <b>${esc(o.rev.objective)}</b></div>` : `<div><b>${esc(o.objective)}</b></div>`}
    ${o.rev.krs.map(k => k.src == null ? `<div>+ ${esc(k.title)} <span class="sub">(new key result${k.month != null ? ', due ' + MON[k.month] : ''})</span></div>` : k.title !== o.krs[k.src].title || k.month !== o.krs[k.src].month || (k.type || 'binary') !== (o.krs[k.src].type || 'binary') || +k.target !== +(o.krs[k.src].target || 0) ? `<div><s>${esc(o.krs[k.src].title)}${o.krs[k.src].month != null ? ' (due ' + MON[o.krs[k.src].month] + ')' : ''}</s> → ${esc(k.title)}${k.month != null ? ' (due ' + MON[k.month] + ')' : ''}</div>` : `<div class="sub">${esc(k.title)}</div>`).join('')}
    ${o.krs.map((k, i) => keptSrc(o).has(i) ? '' : `<div class="sub"><s>${esc(k.title)}</s> (removed)</div>`).join('')}</div>`;
  const revUi = revs.length ? `<section class="card"><h2 style="font-size:16px">OKR changes</h2><p class="sub">Edits your team made to their OKRs. They only take effect when you approve.</p><div class="list">${revs.map(o => `<div class="kr" style="align-items:flex-start"><div class="person-h t" style="align-items:flex-start">${avatar(o.owner)}<div style="min-width:0"><div><b>${esc(o.owner)}</b> <span class="sub">${o.rev.by && o.rev.by !== o.owner ? esc(o.rev.by) + ' proposed a change' : 'proposed a change'}</span></div>${diff(o)}</div></div>
    <div class="acts"><button class="btn sm" data-act="apprev" data-id="${o.id}">Approve</button><button class="btn ghost sm" data-act="rejrev" data-id="${o.id}">Reject</button></div></div>`).join('')}</div></section>` : '';
  return `${pageHead('Approvals', 'Key results your team marked complete, and changes they want to make to their OKRs. Approving a key result adds to their progress and to this week\'s gain.')}
  ${revUi}
  ${all.length > 1 ? fbar('appr', {ph: 'Search by person, OKR or key result', team: teamsIn(all.map(x => x.o.owner)), count: `Showing ${list.length} of ${all.length}`}) : ''}
  <div class="card">${list.length ? `<div class="list">${list.map(({o, k, i}) => `<div class="kr"><div class="person-h t">${avatar(o.owner)}<div style="min-width:0"><div><b>${esc(o.owner)}</b> <span class="sub">${esc(o.objective)}</span></div><div>${esc(k.title)}</div>${k.reqAt ? `<div class="sub">Marked done ${dateShort(k.reqAt)}${k.month != null ? ' · due ' + MON[k.month] : ''}</div>` : ''}
      ${(acts => acts.length ? `<details class="evid"><summary>${plural(acts.length, 'activity', 'activities')} logged against this</summary>${actList(acts)}</details>` : '<div class="sub">No activity logged against this key result.</div>')(activityOn(o.id, i))}</div></div>
    <div class="acts">${chip('Worth ' + fmt(100 / o.krs.length) + '%')}<button class="btn sm" data-act="approve" data-o="${o.id}" data-i="${i}">Approve</button><button class="btn ghost sm" data-act="sendback" data-o="${o.id}" data-i="${i}">Send back</button></div></div>`).join('')}</div>` : empty(all.length ? 'No requests match these filters.' : revs.length ? 'No key results are waiting.' : revsFor(e).length ? 'No changes match these filters.' : 'Nothing is waiting for you.')}</div>`;
}

function viewStand(e) {
  const sc = scope(e), f = ff.stand;
  const hasTeam = [...sc].some(n => n !== e.name);
  const who = !hasTeam ? 'mine' : standWho || (S.stand.some(x => x.week === wk && x.owner === e.name) ? 'mine' : 'team');
  const allWeek = S.stand.filter(x => x.week === wk && sc.has(x.owner));
  const weekItems = allWeek.filter(x => who === 'mine' ? x.owner === e.name : x.owner !== e.name);
  const items = weekItems.filter(x => (!f.st || x.status === f.st) && hit(f.q, x.owner, x.text));
  const whoTabs = hasTeam ? `<div class="seg" role="tablist" aria-label="Whose standup">${[['mine', 'Mine', allWeek.filter(x => x.owner === e.name).length], ['team', isGroup(e) ? 'Everyone' : 'My team', allWeek.filter(x => x.owner !== e.name).length]].map(([v, l, c]) =>
    `<button role="tab" aria-selected="${who === v}" data-act="standwho" data-v="${v}">${l}<span class="seg-n">${c}</span></button>`).join('')}</div>` : '';
  const dayOf = x => x.day || x.week;
  return `${pageHead('Standup', 'What everyone is working on, logged day by day. The Friday review looks back over the whole week.', `<div class="row">${weekNav()}${expBtn('stand')}</div>`)}
  <form class="card" data-submit="addstand"><div class="row"><label class="sr" for="su-text">Add an activity</label><input type="text" class="grow" style="flex-basis:240px" id="su-text" placeholder="What are you working on?" maxlength="300">
      <input type="number" min="0" step="any" id="su-n" placeholder="How many" aria-label="How many" style="width:116px">
      <input type="text" id="su-unit" placeholder="Unit, optional" aria-label="Unit" style="width:148px" maxlength="40">
      ${(ko => ko.length ? `<select id="su-kr" aria-label="Which key result"><option value="">Not tied to a key result</option>${ko.map(x => `<option value="${esc(x.v)}">${esc(x.l)}</option>`).join('')}</select>` : '')(krOpts(e.name))}
      <button class="btn" type="submit">Add</button></div>
    <p class="sub" style="margin:0">Logged against ${esc(dayLabel(today()).toLowerCase())}. A figure is optional; a Done entry with a figure adds to the key result it is tied to.</p></form>
  ${whoTabs}
  ${weekItems.length > 1 ? fbar('stand', {ph: 'Search by person or activity', st: SSTAT, count: `Showing ${items.length} of ${weekItems.length} activities`}) : ''}
  ${items.length ? grouped(items, 'owner').map(([o, list]) => { const d = list.filter(x => x.status === 'Done').length;
    const byDay = grouped(list.map(x => ({...x, _d: dayOf(x)})), '_d').sort((a, b) => b[0].localeCompare(a[0]));
    return `<section class="card"><div class="person-h">${avatar(o)}<b class="grow">${dosLink(e, person(o), o)}</b><span class="sub num">${d} of ${list.length} done</span></div>${bar(d / list.length * 100, 'good')}
    ${byDay.map(([dy, rows]) => `<div class="daygrp"><div class="lbl">${esc(dayLabel(dy))}</div>
      <div class="list">${rows.sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(x => { const own = x.owner === e.name, can = own || isGroup(e);
        const ref = krRef(x);
        return `<div class="kr"><div class="t">${esc(x.text)}${x.n != null || ref ? `<div class="sub">${x.n != null ? fmt(x.n) + ' ' + esc(x.unit || '') : ''}${x.n != null && ref ? ' · ' : ''}${ref ? '→ ' + esc(ref.k.title) : ''}</div>` : ''}</div>
          <div class="acts"><select class="sm" data-chg="stand" data-id="${x.id}" aria-label="Status"${own ? '' : ' disabled'} title="${own ? 'Set your status' : esc(x.owner) + ' sets this'}">${opts(SSTAT, x.status)}</select>
          ${can ? `<button class="btn quiet sm" data-act="delstand" data-id="${x.id}" aria-label="Delete activity">Delete</button>` : ''}</div></div>`; }).join('')}</div></div>`).join('')}</section>`; }).join('')
    : `<div class="card">${empty(weekItems.length ? 'No activities match these filters.' : who === 'mine' ? 'You have not logged anything this week.' : 'Nobody else has logged anything this week.')}</div>`}`;
}

function viewReview(e) {
  const sc = scope(e);
  const fri = fridayDue(e, wk);
  const notes = new Map(S.wnotes.filter(x => x.week === wk).map(x => [x.owner, x]));
  // SU-3: everyone in scope gets a comment box, including people with no standup entries that week.
  const names = [...new Set([...[...sc].filter(n => { const p = person(n); return p && (!isGroup(p) || n === e.name); }), e.name])].sort((a, b) => a.localeCompare(b));
  const rf = ff.review;
  const hasTeam = names.some(n => n !== e.name);
  const rWho = !hasTeam ? 'mine' : revWho || 'mine';
  const scoped = names.filter(n => rWho === 'mine' ? n === e.name : n !== e.name);
  const shownNames = scoped.filter(n => hit(rf.q, n) && (!rf.st || (rf.st === 'with') === !!notes.get(n)?.text));
  const rTabs = hasTeam ? `<div class="seg" role="tablist" aria-label="Whose review">${[['mine', 'Mine', names.filter(n => n === e.name).length], ['team', isGroup(e) ? 'Everyone' : 'My team', names.filter(n => n !== e.name).length]].map(([v, l, c]) =>
    `<button role="tab" aria-selected="${rWho === v}" data-act="revwho" data-v="${v}">${l}<span class="seg-n">${c}</span></button>`).join('')}</div>` : '';
  return `${pageHead('Friday Review', 'Look back on the week: what your standup covered, plus blockers, achievements and feedback.', weekNav())}
  ${fri ? '<div class="banner"><span>It is Friday. Add your comments on blockers, achievements and feedback.</span></div>' : ''}
  ${rTabs}
  ${scoped.length > 1 ? fbar('review', {ph: 'Search by name', st: [['with', 'Comments added'], ['without', 'No comments yet']], stLabel: 'Comments', count: `Showing ${shownNames.length} of ${scoped.length} people`}) : ''}
  ${shownNames.length ? shownNames.map(o => {
    const act2 = S.stand.filter(x => x.week === wk && x.owner === o).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const d = act2.filter(x => x.status === 'Done').length;
    const nt = notes.get(o), canN = o === e.name;
    return `<section class="card"><div class="person-h">${avatar(o)}<b class="grow">${dosLink(e, person(o), o)}</b>${act2.length ? chip(d + ' of ' + act2.length + ' done', d === act2.length ? 'good' : 'acc') : ''}${nt && nt.text ? chip('Comments added', 'tea') : chip('No comments yet')}</div>
      <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Standup this week</span>
        ${act2.length ? `<div class="list">${act2.map(x => `<div class="kr"><div class="t">${esc(x.text)}${x.day ? `<div class="sub">${esc(dayLabel(x.day))}</div>` : ''}</div>${chip(x.status, statTone(x.status))}</div>`).join('')}</div>` : '<span class="sub">No standup entries.</span>'}</div>
      <div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="wn-${wk}">Blockers, achievements or feedback</label>
        ${canN ? `<textarea id="wn-${wk}" maxlength="2000" placeholder="Anything blocking you, wins from the week, or feedback. Include work outside your key results.">${esc(nt?.text || '')}</textarea><div class="end" style="display:flex;justify-content:flex-end"><button class="btn sm" data-act="savenote">Save comments</button></div>`
          : `<div${nt && nt.text ? '' : ' class="sub"'}>${nt && nt.text ? esc(nt.text) : 'No comments yet.'}</div>`}</div></section>`;
  }).join('') : `<div class="card">${empty(scoped.length ? 'No one matches these filters.' : rWho === 'mine' ? 'Nothing of yours to review this week.' : 'Nothing from anyone else this week.')}</div>`}`;
}

// The requisition form, used both to raise one and to fix one that was sent back.
function reqForm(e, r) {
  const me = person(e.name) || {}, mine = isGroup(e);
  const d = r || {sub: me.sub || subs()[0], team: me.team || '', count: 1, kind: RKIND[0], etype: S.cfg.etypes[0],
    needBy: iso(new Date(Date.now() + 60 * 86400000)), replacing: '', why: '', title: '', hm: ''};
  const chain = chainFor(e.name);
  const left = chain.filter(st => st.state === 'Pending' && !(st.who === e.name || (st.role === 'HR' && e.role === 'hr')));
  return `<form class="card" data-submit="addrole">${r ? `<input type="hidden" id="ro-id" value="${r.id}">` : ''}
    <div class="sec-h"><h2 style="font-size:16px">${r ? 'Fix and resend ' + esc(r.ref || 'the request') : 'New role request'}</h2>${r ? chip('Sent back', 'amb') : ''}</div>
    <p class="sub" style="margin:0">${r ? 'Change what was flagged and it goes back through approval from the start.'
      : left.length ? 'This needs ' + esc(left.map(stepLabel).join(', then ')) + ' to approve it.'
      : 'You are the only approver this needs, so it opens straight away.'}</p>
    <div class="row"><label class="f grow" style="flex-basis:220px">Job title<input type="text" id="ro-title" value="${esc(d.title || '')}" placeholder="e.g. Support Engineer" maxlength="100"></label>
      <label class="f">Subsidiary<select id="ro-sub">${subs().map(x => `<option${d.sub === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="f">Team<input type="text" id="ro-team" value="${esc(d.team || '')}" placeholder="Team" style="width:150px" maxlength="60"></label>
      ${mine ? `<label class="f">Hiring manager<select id="ro-hm">${S.people.filter(p => p.role === 'manager' || p.role === 'ceo').map(p => `<option${d.hm === p.name ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}</div>
    <div class="row"><label class="f">Reason for hire<select id="ro-kind">${RKIND.map(x => `<option${d.kind === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="f grow" style="flex-basis:160px">Replacing<input type="text" id="ro-rep" value="${esc(d.replacing || '')}" placeholder="Blank for new headcount" maxlength="80"></label>
      <label class="f">Contract<select id="ro-et">${S.cfg.etypes.map(x => `<option${d.etype === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="f">Openings<input type="number" id="ro-n" value="${esc(String(d.count || 1))}" min="1" max="99" style="width:90px"></label>
      <label class="f">Needed by<input type="date" id="ro-by" value="${esc(d.needBy || '')}"></label></div>
    <label class="f">The case for it<textarea id="ro-why" rows="2" placeholder="What is not getting done without this person" maxlength="2000">${esc(d.why || '')}</textarea></label>
    <div class="row"><button class="btn" type="submit">${r ? 'Resend for approval' : left.length ? 'Send for approval' : 'Open role'}</button><button type="button" class="btn quiet" data-act="cancelrole">Cancel</button></div></form>`;
}

function viewHire(e) {
  const f = ff.hire, q = f.q.trim().toLowerCase();
  const all = openRoles(e);
  const inTab = r => hireTab === 'all' || (hireTab === 'appr' ? inAppr(r) || sentBack(r) : hireTab === 'open' ? roleLive(r) || r.status === 'On hold' : roleShut(r));
  const rs = all.filter(r => inTab(r) && (!f.team || r.team === f.team)
    && (!q || r.title.toLowerCase().includes(q) || (r.ref || '').toLowerCase().includes(q) || r.reqBy?.toLowerCase().includes(q) || r.hm.toLowerCase().includes(q) || hiresOf(r).some(h => h.name.toLowerCase().includes(q))))
    .sort((a, b) => (b.reqAt || 0) - (a.reqAt || 0));
  const live = all.filter(roleLive), held = all.filter(r => r.status === 'On hold');
  const waiting = all.filter(r => inAppr(r) || sentBack(r)), onMe = myAppr(e);
  const seats = live.reduce((t, r) => t + toFill(r), 0);
  const avgFill = avgNum(all.filter(r => r.status === 'Filled' && r.opened && r.filledAt).map(daysOpen));
  const avgAp = avgNum(all.map(apprDays).filter(x => x != null));
  const mineOnb = onbActive().filter(o => isGroup(e) || (person(o.owner) && mgrOf(person(o.owner)) && mgrOf(person(o.owner)).id === e.id));
  const canAsk = ['manager', 'ceo', 'hr'].includes(e.role);
  const segs = [...(waiting.length || canAsk ? [['appr', onMe.length ? 'Waiting on you' : 'In approval', onMe.length || waiting.length]] : []),
    (h => ['open', h ? 'Open or on hold' : 'Open roles', live.length + h])(held.length),
    ['closed', 'Filled or closed', all.filter(roleShut).length], ['all', 'All roles', all.length], ['onb', 'Onboarding', mineOnb.length],
    ...(isGroup(e) ? [['tmpl', 'Checklists', S.tmpl.length]] : [])];
  if (!segs.some(x => x[0] === hireTab)) hireTab = segs.some(x => x[0] === 'onb') && !canAsk ? 'onb' : 'open';
  const ed = editR ? all.find(r => r.id === editR) : null;
  return `${pageHead('Hiring and onboarding', isGroup(e)
      ? 'Every role starts as a request with a reference and the case for it, and goes through the line manager and HR' + (S.cfg.execAll ? ', then the CEO,' : '') + ' before it opens. It closes when its openings are filled.'
      : canAsk ? 'Raise a role when your team needs one. It goes through approval, you see every step, and it closes itself once you have hired.' : 'Your onboarding checklist.',
    `<div class="row">${canAsk ? '<button class="btn" data-act="newrole">+ New role request</button>' : ''}${canAsk ? expBtn('hire') : ''}</div>`)}
  ${hireTab === 'onb' || hireTab === 'tmpl' ? '' : `<div class="stats">${stat('ind', 'Open roles', live.length, 'Approved and actively hiring', null, 'hire')}
    ${stat('tea', 'Openings to fill', seats, seats ? 'Seats still empty across those roles' : 'Every open role is filled', null, 'hire')}
    ${stat('amb', onMe.length ? 'Waiting on you' : 'In approval', onMe.length || waiting.length, onMe.length ? 'Requests at your step of the chain' : waiting.length ? 'Requests still going through approval' : 'Nothing in approval', null, 'hire-appr')}
    ${stat('vio', 'Days to approve', avgAp == null ? '—' : avgAp, avgFill == null ? 'Average, raised to opened' : `Average, raised to opened · ${avgFill} days more to fill`, null, 'hire')}</div>`}
  ${ed && raisedBy(e, ed) ? reqForm(e, ed) : openRole === 'new' && canAsk ? reqForm(e, null) : ''}
  <div class="seg" role="tablist" aria-label="Role status">${segs.map(([v, l, c]) => `<button role="tab" aria-selected="${hireTab === v}" data-act="hiretab" data-v="${v}">${l}<span class="seg-n">${c}</span></button>`).join('')}</div>
  ${hireTab === 'tmpl' && isGroup(e) ? `
    <p class="sub" style="margin:0">A new starter gets the checklist for their subsidiary, or the default when there is none. Changing a checklist does not alter anyone already onboarding.</p>
    ${tdraft ? `<form class="card" data-submit="savetmpl"><div class="sec-h"><h2 style="font-size:16px">${esc(tdraft.id ? 'Edit checklist' : 'New checklist')}</h2>${tdraft.id && tdraft.sub ? chip(tdraft.sub, SUB_TONE[tdraft.sub] || '') : ''}</div>
      <div class="row"><label class="f grow" style="flex-basis:220px">Name<input type="text" id="tn" value="${esc(tdraft.name)}" placeholder="e.g. Connect starter" maxlength="80"></label>
        <label class="f">Applies to<select id="ts"><option value="">Everyone (default)</option>${subs().map(x => `<option${tdraft.sub === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label></div>
      <div style="display:flex;flex-direction:column;gap:6px"><span class="lbl">Tasks</span>
        ${tdraft.tasks.map((t, i) => `<div class="row" style="flex-wrap:nowrap">
          <input type="text" class="grow" id="tt-${i}" value="${esc(t.t)}" placeholder="What needs doing" aria-label="Task ${i + 1}" maxlength="200">
          <select id="to-${i}" aria-label="Who does it">${S.cfg.onbWho.map(x => `<option${t.who === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <label class="f" style="flex:none"><input type="number" id="td-${i}" value="${t.off}" aria-label="Days from start" style="width:84px"></label>
          <button type="button" class="btn quiet sm" data-act="rmtask" data-i="${i}" aria-label="Remove task ${i + 1}">Remove</button></div>`).join('')}
        <div class="row"><button type="button" class="btn ghost sm" data-act="addtask">+ Add task</button><span class="sub">Days are counted from the start date. Use a negative number for before day one.</span></div></div>
      <div class="row"><button class="btn" type="submit">Save checklist</button><button type="button" class="btn quiet" data-act="canceltmpl">Cancel</button>
        ${tdraft.id && tdraft.sub ? `<button type="button" class="btn quiet" data-act="deltmpl" data-id="${tdraft.id}">Delete</button>` : ''}</div></form>`
      : `<div class="row"><button class="btn" data-act="newtmpl">+ New checklist</button></div>`}
    ${S.tmpl.length ? S.tmpl.map(tp => `<section class="card"><div class="sec-h"><h2>${esc(tp.name)}</h2><div class="person-h">${tp.sub ? chip(tp.sub, SUB_TONE[tp.sub] || '') : chip('Default')}${chip(plural(tp.tasks.length, 'task', 'tasks'))}<button class="btn quiet sm" data-act="edittmpl" data-id="${tp.id}">Edit</button></div></div>
      <div class="list">${[...tp.tasks].sort((a, b) => a.off - b.off).map(t => `<div class="kr"><div class="t">${esc(t.t)}<div class="sub">${esc(t.who)} · ${t.off < 0 ? Math.abs(t.off) + ' days before start' : t.off === 0 ? 'on day one' : 'day ' + t.off}</div></div></div>`).join('')}</div></section>`).join('')
      : `<div class="card">${empty('No checklists saved yet. New starters get the built-in default until you save one.')}</div>`}
  ` : hireTab === 'onb' ? (mineOnb.length ? mineOnb.map(o => { const p = person(o.owner), late = o.tasks.filter(t => onbLate(o, t)).length;
    return `<section class="card"><div class="person-h">${avatar(o.owner)}<div class="grow" style="min-width:0"><div><b>${dosLink(e, p, o.owner)}</b> ${chip(r0(onbPct(o)) + '% done', onbPct(o) >= 100 ? 'good' : '')}${late ? chip(plural(late, 'task overdue', 'tasks overdue'), 'bad') : ''}</div>
      <div class="sub">${esc(p?.title || '')}${p?.sub ? ' · ' + esc(where(p)) : ''} · started ${esc(parseIso(o.start).toLocaleDateString(undefined, {day: 'numeric', month: 'long'}))}${o.from ? ' · ' + esc(o.from) : ''}</div></div></div>
    ${bar(onbPct(o))}
    <div class="list">${o.tasks.map((t, i) => ({t, i})).sort((a, b) => a.t.off - b.t.off).map(({t, i}) => `<div class="kr"><div class="t">${t.done ? `<s>${esc(t.t)}</s>` : esc(t.t)}
      <div class="sub">${esc(t.who)} · due ${esc(onbDue(o, t).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))}${t.done ? ' · done by ' + esc(t.by) : onbLate(o, t) ? ' · overdue' : ''}</div></div>
      <div class="acts">${t.done ? chip('Done', 'good') : onbLate(o, t) ? chip('Overdue', 'bad') : chip('To do')}
        ${onbCanTick(e, o, t) ? `<button class="btn ${t.done ? 'quiet' : 'ghost'} sm" data-act="onbtick" data-n="${esc(o.owner)}" data-i="${i}">${t.done ? 'Undo' : 'Mark done'}</button>` : ''}</div></div>`).join('')}</div></section>`; }).join('')
    : `<div class="card">${empty('Nobody is onboarding right now.' + (isGroup(e) ? ' Recording a hire from outside starts a checklist automatically.' : ''))}</div>`) : `
  ${all.length > 1 ? fbar('hire', {ph: 'Search by role, reference, manager or hire', team: [...new Set(all.map(r => r.team))].sort(), count: `Showing ${rs.length} of ${all.length} roles`}) : ''}
  ${rs.length ? rs.map(r => {
    const can = canRole(e, r), hs = hiresOf(r), cl = closedOf(r), left = toFill(r), st = stepNow(r), mine = canStep(e, st);
    const a = [];
    if (inAppr(r) && mine) a.push(`<button class="btn sm" data-act="aprole" data-id="${r.id}">Approve</button><button class="btn quiet sm" data-act="sbrole" data-id="${r.id}">Send back</button><button class="btn quiet sm" data-act="declrole" data-id="${r.id}">Decline</button>`);
    if (sentBack(r) && raisedBy(e, r)) a.push(`<button class="btn sm" data-act="editrole" data-id="${r.id}">Fix and resend</button>`);
    if (roleLive(r) && can) a.push(`<button class="btn sm" data-act="fillrole" data-id="${r.id}">Record a hire</button><button class="btn quiet sm" data-act="holdrole" data-id="${r.id}">Put on hold</button>`);
    if (r.status === 'On hold' && can) a.push(`<button class="btn quiet sm" data-act="reopenrole" data-id="${r.id}">Reopen</button>`);
    if ((roleLive(r) || r.status === 'On hold') && can && left) a.push(`<button class="btn quiet sm" data-act="closerole" data-id="${r.id}">Close ${left > 1 ? 'the openings' : 'it'}</button>`);
    if ((inAppr(r) || sentBack(r)) && raisedBy(e, r)) a.push(`<button class="btn quiet sm" data-act="withdrawrole" data-id="${r.id}">Withdraw</button>`);
    return `<section class="card"><div class="sec-h"><h2>${esc(r.title)}</h2><div class="person-h">${r.ref ? chip(r.ref) : ''}${chip(r.status, RTONE[r.status] ?? '')}${openings(r) > 1 ? chip(`${hs.length} of ${openings(r)} filled`, left ? 'warn' : 'good') : ''}${roleLive(r) && r.opened ? chip('open ' + plural(daysOpen(r), 'day', 'days'), daysOpen(r) > 60 ? 'warn' : '') : ''}${a.join('')}</div></div>
    <p class="sub" style="margin:-4px 0 4px">${esc(r.team)} · ${esc(r.sub)} · hiring manager ${esc(r.hm)}${r.recruiter ? ' · recruiter ' + esc(r.recruiter) : ''}${openings(r) > 1 ? ' · ' + plural(openings(r), 'opening', 'openings') : ''}</p>
    <div class="list">
      <div class="kr"><div class="t">Asked for by ${esc(r.reqBy || r.hm)}${r.reqAt ? ' on ' + esc(dateShort(r.reqAt)) : ''}
        <div class="sub">${esc(r.kind || 'New headcount')}${r.replacing ? ' for ' + esc(r.replacing) : ''}${r.etype ? ' · ' + esc(r.etype) : ''}${r.needBy ? ' · needed by ' + esc(parseIso(r.needBy).toLocaleDateString(undefined, {day: 'numeric', month: 'long'})) : ''}</div>
        ${r.why ? `<div>${esc(r.why)}</div>` : ''}</div></div>
      ${chainOf(r).length ? `<div class="kr"><div class="t">Approval${inAppr(r) ? ` · step ${stepNo(r)} of ${chainOf(r).length}` : ''}
        <div class="sub">${chainOf(r).map(x => `${esc(x.who || x.role)}: ${esc(x.state === 'Pending' ? 'waiting' : x.state.toLowerCase())}${x.at ? ' ' + esc(dateShort(x.at)) : ''}`).join(' · ')}</div>
        ${(x => x && x.note ? `<div>${esc(x.note)}</div>` : '')(chainOf(r).filter(x => x.note && x.state !== 'Approved').pop())}</div>
        ${inAppr(r) ? `<div class="acts">${chip(mine ? 'Your approval' : 'With ' + stepLabel(st), mine ? 'warn' : '')}</div>` : ''}</div>` : ''}
      ${r.status === 'Declined' ? `<div class="kr"><div class="t">Declined by ${esc(r.apBy)}${r.apAt ? ' on ' + esc(dateShort(r.apAt)) : ''}<div class="sub">${esc(r.note || 'No reason given.')}</div></div></div>`
        : r.status === 'Withdrawn' ? `<div class="kr"><div class="t">Withdrawn<div class="sub">${esc(r.note || 'No longer needed.')}</div></div></div>`
        : r.opened ? `<div class="kr"><div class="t">Opened by ${esc(r.apBy || 'HR')} on ${esc(parseIso(r.opened).toLocaleDateString(undefined, {day: 'numeric', month: 'long'}))}
          <div class="sub">${apprDays(r) != null ? plural(apprDays(r), 'day', 'days') + ' in approval · ' : ''}${r.status === 'Filled' ? 'filled in ' + plural(daysOpen(r), 'day', 'days') : r.status === 'On hold' ? esc(r.note || 'on hold') : plural(left, 'opening', 'openings') + ' still to fill'}</div></div></div>` : ''}
      ${r.jd && r.jd.length ? `<div class="kr"><div class="t">What the role covers<div class="sub">${esc(r.jd.join(' · '))}</div></div></div>` : ''}
      ${hs.map(h => { const hp = person(h.name);
        return `<div class="kr"><div class="person-h t">${avatar(h.name)}<div style="min-width:0"><div><b>${hp ? dosLink(e, hp) : esc(h.name)}</b></div>
          <div class="sub">${esc(h.how || 'New hire')} · recorded by ${esc(h.by)} on ${esc(dateShort(h.at))}</div></div></div>
          <div class="acts">${chip('Hired', 'good')}</div></div>`; }).join('')}
      ${cl.map(x => `<div class="kr"><div class="t">Opening closed without a hire<div class="sub">${esc(x.reason)} · ${esc(x.by)} on ${esc(dateShort(x.at))}</div></div><div class="acts">${chip('Closed')}</div></div>`).join('')}
    </div>
    ${(r.log || []).length ? `<details class="evid"><summary>Process history (${(r.log || []).length})</summary><div class="actlog"><div class="list">${[...r.log].reverse().map(x => `<div class="kr"><div class="t">${esc(x.what)}
      <div class="sub">${esc(x.who)} · ${esc(dateShort(x.at))}${x.note ? ' · ' + esc(x.note) : ''}</div></div></div>`).join('')}</div></div></details>` : ''}
    ${declR === r.id && mine ? `<form class="ci-form" data-submit="savedecl" style="flex-direction:column;align-items:stretch;gap:8px"><input type="hidden" id="dc-id" value="${r.id}">
      <label class="f">Why are you declining it?<textarea id="dc-why" rows="2" placeholder="This ends the request, so say what would change your mind" maxlength="1000"></textarea></label>
      <div class="row"><button class="btn" type="submit">Decline request</button><button type="button" class="btn quiet" data-act="canceldecl">Cancel</button>
        <span class="sub">Declining ends the request. Sending back keeps it alive.</span></div></form>` : ''}
    ${sbR === r.id && mine ? `<form class="ci-form" data-submit="savesb" style="flex-direction:column;align-items:stretch;gap:8px"><input type="hidden" id="sb-id" value="${r.id}">
      <label class="f">What needs fixing?<textarea id="sb-why" rows="2" placeholder="${esc(r.reqBy || r.hm)} can edit and resend it" maxlength="1000"></textarea></label>
      <div class="row"><button class="btn" type="submit">Send back</button><button type="button" class="btn quiet" data-act="cancelsb">Cancel</button>
        <span class="sub">Sending back keeps the request alive. Declining ends it.</span></div></form>` : ''}
    ${closeR === r.id && can ? `<form class="ci-form" data-submit="saveclose" style="flex-direction:column;align-items:stretch;gap:8px"><input type="hidden" id="cl-id" value="${r.id}">
      <div class="row"><label class="f">Why are you closing ${left > 1 ? plural(left, 'opening', 'openings') : 'it'}?<select id="cl-why">${S.cfg.closeWhy.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
        <button class="btn" type="submit">Close without hiring</button><button type="button" class="btn quiet" data-act="cancelclose">Cancel</button></div></form>` : ''}
    ${fillR === r.id && can ? (() => { const movers = S.people.filter(p => p.role !== 'hr' && p.role !== 'ceo').map(p => p.name).sort();
      return `<form class="ci-form" data-submit="savefill" style="flex-direction:column;align-items:stretch;gap:8px"><input type="hidden" id="fl-id" value="${r.id}">
      <p class="sub" style="margin:0">Record who is taking the seat. Someone from outside is added to the directory and starts onboarding; an internal move updates their record to this team.</p>
      <div class="row"><label class="f">Coming from<select id="fl-how"><option>Outside the company</option><option>Internal move</option></select></label>
        <label class="f grow" style="flex-basis:200px">Name<input type="text" id="fl-name" placeholder="Full name" list="fl-list" maxlength="80"><datalist id="fl-list">${movers.map(n => `<option>${esc(n)}</option>`).join('')}</datalist></label>
        <label class="f grow" style="flex-basis:200px">Work email<input type="email" id="fl-email" placeholder="name@company.com" maxlength="200"></label>
        <label class="f">Start date<input type="date" id="fl-start" value="${esc(today())}"></label></div>
      <div class="row"><button class="btn" type="submit">Record the hire</button><button type="button" class="btn quiet" data-act="cancelfill">Cancel</button>
        <span class="sub">${left > 1 ? plural(left, 'opening', 'openings') + ' on this role, so it stays open until the last one is filled.' : 'This is the last opening, so the role closes.'}</span></div></form>`; })() : ''}
    </section>`; }).join('')
    : `<div class="card">${empty(all.length ? 'No roles match these filters.' : canAsk ? 'No roles yet.' : 'No roles open.', all.length || !canAsk ? '' : '<button class="btn" data-act="newrole">New role request</button>')}</div>`}`}`;
}

function viewRev(e) {
  const c = liveCycle(), f = ff.rev, q = f.q.trim().toLowerCase();
  const y = curY(), h = curM() < 6 ? 'H1' : 'H2';
  const openForm = cycleForm && isGroup(e) ? `<form class="card" data-submit="opencycle"><h3>Open a review cycle</h3>
    <div class="row"><label class="f grow" style="flex-basis:200px">Name<input type="text" id="cy-name" value="${esc(h + ' ' + y + ' review')}" maxlength="60"></label>
      <label class="f">Period from<input type="date" id="cy-from" value="${esc(y + (h === 'H1' ? '-01-01' : '-07-01'))}"></label>
      <label class="f">Period to<input type="date" id="cy-to" value="${esc(y + (h === 'H1' ? '-06-30' : '-12-31'))}"></label>
      <label class="f">Self-reviews due<input type="date" id="cy-due" value="${esc(iso(new Date(Date.now() + S.cfg.reviewDueDays * 86400000)))}"></label></div>
    <div class="row"><button class="btn" type="submit">Open the cycle</button><button type="button" class="btn quiet" data-act="cyclecancel">Cancel</button></div></form>` : '';
  if (!c) return `${openForm}<div class="card">${empty('No review cycle is open.', isGroup(e) && !cycleForm ? '<button class="btn" data-act="opencycle">Open a cycle</button>' : '')}</div>`;
  const mine = revOf(c.id, e.name), days = revDue(c);
  const inLine = p => isGroup(e) || reportsTo(p, e);
  const allMine = [...lbScope(e)].map(n => person(n)).filter(p => p && !isGroup(p) && p.name !== e.name && inLine(p));
  const team = allMine.map(p => ({p, r: revOf(c.id, p.name)})).filter(x => (!f.team || x.p.team === f.team) && (!f.v || revStage(x.r) === f.v) && (!q || x.p.name.toLowerCase().includes(q)))
    .sort((a, b) => a.p.name.localeCompare(b.p.name));
  const doneN = allMine.filter(p => revDone(revOf(c.id, p.name))).length;
  const scale = (id, sel) => `<label class="f">Rating<select id="${id}">${RATINGS.map((l, i) => i ? `<option value="${i}"${sel === i ? ' selected' : ''}>${i} · ${l}</option>` : '').join('')}</select></label>`;
  const selfCard = e.role === 'hr' && !mine ? '' : `<section class="card"><div class="sec-h"><h2>Your self-review</h2>${chip(REVST[revStage(mine)][0], REVST[revStage(mine)][1])}</div>
    ${mine && mine.self ? `<div class="list"><div class="kr"><div class="t">${esc(mine.self.text)}<div class="sub">You rated yourself ${mine.self.rating} · ${esc(RATINGS[mine.self.rating])} · sent ${esc(dateShort(mine.self.at))}</div></div></div>
      ${revSeen(mine) ? `<div class="kr"><div class="t">${esc(mine.mgr.text)}<div class="sub">${esc(mine.mgr.by)} rated you ${mine.mgr.rating} · ${esc(RATINGS[mine.mgr.rating])} · shared ${esc(dateShort(mine.shared.at))}</div></div>${chip(REVST[revStage(mine)][0], REVST[revStage(mine)][1])}</div>
        ${mine.ack ? `<div class="kr"><div class="t">You signed this off on ${esc(dateShort(mine.ack.at))}${mine.ack.text ? '' : '.'}
          ${mine.ack.text ? `<div class="sub">Your comment: ${esc(mine.ack.text)}</div>` : ''}</div>${chip('Signed off', 'good')}</div>`
          : `<form class="ci-form" data-submit="saveack" style="flex-direction:column;align-items:stretch;gap:8px">
          <p class="sub" style="margin:0">Signing off records that you have read it and discussed it. It does not mean you agree, and anything you add here stays on the record.</p>
          <label class="f">Anything to add? (optional)<textarea id="rv-ack" rows="2" placeholder="Your own words on the review, if you want them on file" maxlength="2000"></textarea></label>
          <div class="row"><button class="btn" type="submit">Sign off</button></div></form>`}`
        : `<div class="sub">${mine.mgr ? esc(mine.mgr.by) + ' has written their review and will share it with you after you have talked it through.' : 'Waiting on ' + esc(approverOf({owner: e.name})) + '.'}</div>`}</div>`
      : `<form data-submit="saveself" style="display:flex;flex-direction:column;gap:12px">
      <label class="f">How did the half go?<textarea id="rv-self" placeholder="What you delivered, what slipped and why, what you need next half." maxlength="4000"></textarea></label>
      <div class="row">${scale('rv-selfr', 3)}<button class="btn" type="submit">Send self-review</button></div></form>`}</section>`;
  return `<div class="row between"><p class="sub" style="margin:0">${esc(c.name)}, covering ${esc(c.from)} to ${esc(c.to)}. Everyone writes a self-review, their manager responds, then shares it and the person signs it off.</p><div class="row">${isGroup(e) ? `<button class="btn quiet sm" data-act="closecycle">Close cycle</button>` : ''}${allMine.length ? expBtn('rev') : ''}</div></div>
  <div class="banner${days < 7 ? '' : ' info'}"><span>${days > 0 ? `${plural(days, 'day', 'days')} until self-reviews are due on ${esc(parseIso(c.due).toLocaleDateString(undefined, {day: 'numeric', month: 'long'}))}.` : 'Self-reviews were due on ' + esc(parseIso(c.due).toLocaleDateString(undefined, {day: 'numeric', month: 'long'})) + '.'}</span></div>
  ${selfCard}
  ${allMine.length ? `<section class="card"><div class="sec-h"><h2>${isGroup(e) ? 'Everyone' : 'Your team'}</h2><span class="sub">${doneN} of ${allMine.length} signed off</span></div>
    ${allMine.length > 1 ? fbar('rev', {ph: 'Search by name', team: teamsIn(allMine.map(p => p.name)), v: [['none', 'Not started'], ['self', 'Self-review in'], ['written', 'Ready to share'], ['shared', 'Awaiting sign-off'], ['ack', 'Signed off']], vLabel: 'Stage', vAll: 'Any stage', count: `Showing ${team.length} of ${allMine.length}`}) : ''}
    <div class="list">${team.length ? team.map(({p, r}) => { const st = revStage(r), ed = openRev === p.name, writer = canWriteReview(e, p);
      return `<div class="krb"><div class="kr"><div class="person-h t">${avatar(p.name)}<div style="min-width:0"><div><b>${dosLink(e, p)}</b></div>
        <div class="sub">${esc(p.title || ROLES[p.role])}${r && r.self ? ' · rated themselves ' + r.self.rating : ''}${r && r.mgr ? ' · ' + esc(r.mgr.by === e.name ? 'you' : r.mgr.by) + ' rated ' + r.mgr.rating : ''}</div>
        ${r && r.self ? `<div>${esc(r.self.text)}</div>` : ''}${r && r.mgr ? `<div class="sub">${esc(r.mgr.by)}: ${esc(r.mgr.text)}</div>` : ''}
        ${r && r.ack ? `<div class="sub">Signed off by ${esc(p.name)} on ${esc(dateShort(r.ack.at))}${r.ack.text ? ' · "' + esc(r.ack.text) + '"' : ''}</div>`
          : r && r.shared ? `<div class="sub">Shared ${esc(dateShort(r.shared.at))}, waiting for ${esc(p.name)} to sign off</div>` : ''}</div></div>
        <div class="acts">${chip(REVST[st][0], REVST[st][1])}${(st === 'self' || st === 'written') && writer && !ed ? `<button class="btn ${st === 'self' ? '' : 'quiet '}sm" data-act="openrev" data-n="${esc(p.name)}">${st === 'self' ? 'Write review' : 'Rewrite'}</button>` : ''}${st === 'written' && (writer || e.role === 'ceo') ? `<button class="btn sm" data-act="sharerev" data-n="${esc(p.name)}">Share with ${esc(p.name.split(' ')[0])}</button>` : ''}</div></div>
        ${ed ? `<form class="ci-form" data-submit="savemgr" style="flex-wrap:wrap"><label class="f grow" style="flex-basis:100%">Your review of ${esc(p.name)}<textarea id="rv-mgr" placeholder="What they delivered, where they need support, what happens next." maxlength="4000">${esc(r && r.mgr ? r.mgr.text : '')}</textarea></label>
          <div class="row">${scale('rv-mgrr', r && r.mgr ? r.mgr.rating : r && r.self ? r.self.rating : 3)}<button class="btn" type="submit">Save review</button><button type="button" class="btn quiet" data-act="cancelrev">Cancel</button></div>
          <p class="sub" style="margin:0">It stays private to you, HR and the CEO until you share it.</p></form>` : ''}</div>`; }).join('')
      : empty('Nobody matches these filters.')}</div></section>` : ''}`;
}

const dRange = d => parseIso(d).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
function viewAppraise(e) {
  const yr = curY();
  const cycs = S.cycles.slice().sort((a, b) => b.to.localeCompare(a.to));
  const dflt = liveCycle() || cycs[0] || null;
  const from = apFrom || (dflt ? dflt.from : `${yr}-01-01`), to = apTo || (dflt ? dflt.to : today());
  const exact = S.cycles.find(c => c.from === from && c.to === to) || null;
  const f = ff.appr2, q = f.q.trim().toLowerCase();
  const inScope = [...lbScope(e)].filter(n => { const p = person(n); return p && !isGroup(p) && n !== e.name && (isGroup(e) || reportsTo(p, e)); }).sort();
  const names = inScope.filter(n => (!f.team || person(n)?.team === f.team) && (!q || n.toLowerCase().includes(q) || (person(n)?.title || '').toLowerCase().includes(q)));
  const rows = names.map(n => appraise(n, from, to));
  const quick = [...cycs.slice(0, 3).map(c => [c.name, c.from, c.to]),
    ['This year', `${yr}-01-01`, today()], ['Last 90 days', iso(new Date(Date.now() - 90 * 86400000)), today()]];
  const scored = rows.map(r => r.rated).filter(Boolean);
  const dist = [5, 4, 3, 2, 1].map(v => [v, scored.filter(x => x.rating === v).length]).filter(x => x[1]);
  return `<div class="card"><div class="row" style="align-items:flex-end">
      <label class="f">From<input type="date" id="ap-from" value="${esc(from)}" data-chg="apfrom"></label>
      <label class="f">To<input type="date" id="ap-to" value="${esc(to)}" data-chg="apto"></label>
      ${quick.map(([l, a, b2]) => `<button class="btn quiet sm" data-act="aprange" data-a="${a}" data-b="${b2}"${from === a && to === b2 ? ' disabled' : ''}>${esc(l)}</button>`).join('')}
      <span class="grow"></span>${expBtn('appraisal')}</div>
    <p class="sub" style="margin:0">${exact ? `${esc(exact.name)} · the review period, ${esc(dRange(from))} to ${esc(dRange(to))}${exact.status === 'Open' ? ' · still open' : ''}`
      : `${esc(dRange(from))} to ${esc(dRange(to))} · not a review period, so there may be no rating to show. The buttons above jump to one.`}</p>
    ${inScope.length > 1 ? `<div class="row" style="align-items:flex-end;margin-top:4px">
      <label class="f grow" style="flex-basis:220px">Employee<input type="search" id="ff-appr2-q" data-ff="appr2.q" value="${esc(f.q)}" placeholder="Search by name or job title"></label>
      ${(ts => ts.length > 1 ? `<label class="f">Team<select id="ff-appr2-team" data-ff="appr2.team"><option value="">All teams</option>${ts.map(x => `<option${f.team === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : '')(teamsIn(inScope))}
      <span class="sub">${rows.length} of ${inScope.length} people</span></div>` : ''}
    ${scored.length > 1 ? `<div class="list"><div class="kr"><div class="t">Ratings across ${plural(rows.length, 'person', 'people')}
      <div class="sub">${dist.map(([v, n]) => `${n} rated ${v}/5`).join(' · ')}${rows.length - scored.length ? ' · ' + (rows.length - scored.length) + ' not rated yet' : ''}</div></div>
      <div class="acts">${chip('Average ' + (scored.reduce((t, x) => t + x.rating, 0) / scored.length).toFixed(1) + '/5', 'vio')}</div></div></div>` : ''}</div>
  ${rows.length ? rows.map(r => `<section class="card"><div class="person-h">${avatar(r.name)}<div class="grow" style="min-width:0">
      <div><b>${dosLink(e, r.p)}</b>${r.rated ? chip('Rated ' + r.rated.rating + '/5', 'vio') : r.revs.some(x => x.status === 'Open') ? chip(REVST[r.revs[0].stage][0], REVST[r.revs[0].stage][1]) : ''}</div>
      <div class="sub">${esc(r.p.title || ROLES[r.p.role])} · ${esc(where(r.p))}</div></div></div>
    <div class="stats">
      ${stat('tea', 'Delivered', r.delivered, 'Key results approved in this window', null, 'perf')}
      ${stat('ros', 'Missed', r.missed, 'Due in this window, never approved', null, 'perf')}
      ${stat('amb', 'Pushed back', r.pushed, 'Deadlines moved in this window', null, 'perf')}
      ${stat('ind', 'Standups', r0(r.standupPct) + '%', `${r.acts} activities, ${r.actsDone} done`, r.standupPct, 'stand')}</div>
    <div class="list">
      ${r.monHit + r.monMiss ? `<div class="kr"><div class="t">Monthly targets<div class="sub">${r.monHit} of ${r.monHit + r.monMiss} months hit</div></div>
        <div class="acts">${chip(r0(r.monHit / (r.monHit + r.monMiss) * 100) + '%', r.monHit === r.monHit + r.monMiss ? 'good' : r.monHit * 2 >= r.monHit + r.monMiss ? 'warn' : 'bad')}</div></div>` : ''}
      ${r.revs.length ? r.revs.map(v => `<div class="kr"><div class="t">${esc(v.cycle)}
        <div class="sub">${v.rating != null ? `Manager ${v.rating}/5 by ${esc(v.by)}` : REVST[v.stage][0]}${v.self != null ? ` · they rated themselves ${v.self}/5` : ''} · ${esc(dRange(v.from))} to ${esc(dRange(v.to))}${v.ackAt ? ' · signed off ' + esc(dateShort(v.ackAt)) : ''}</div>
        ${v.ackText ? `<div class="sub">They added: ${esc(v.ackText)}</div>` : ''}
        ${v.text ? `<div>${esc(v.text)}</div>` : ''}</div><div class="acts">${chip(REVST[v.stage][0], REVST[v.stage][1])}</div></div>`).join('')
        : `<div class="kr"><div class="t">Review<div class="sub">No review cycle covers this window.</div></div></div>`}
      <div class="kr"><div class="t">Feedback<div class="sub">${r.praise} praise, ${r.improve} on things to improve</div></div></div>
      <div class="kr"><div class="t">Time off and wellbeing<div class="sub">${plural(r.leaveDays, 'day', 'days')} of approved leave · ${r.checkins ? r.checkins + ' check-ins, ' + r.heavy + ' heavy weeks' : 'no check-ins'}</div></div></div>
    </div></section>`).join('')
    : `<div class="card">${empty(inScope.length ? 'Nobody matches these filters.' : 'Nobody to appraise yet.')}</div>`}`;
}

function viewPerf(e) {
  const f = ff.perf, q = f.q.trim().toLowerCase();
  const all = [...lbScope(e)].filter(n => n !== e.name && (isGroup(e) || reportsTo(person(n), e))).map(n => risk(n)).filter(Boolean);
  const counts = {off: all.filter(r => r.band === 'off').length, risk: all.filter(r => r.band === 'risk').length, watch: all.filter(r => r.band === 'watch').length, ok: all.filter(r => r.band === 'ok').length};
  const noOkrs = all.filter(r => r.noOkrs), staleN = all.filter(r => r.stale).length;
  const top = [...all].sort((a, b) => b.ix - a.ix).slice(0, 5).map(r => r.n);
  const rows = all.filter(r => (perfTab === 'all' || (perfTab === 'top' ? top.includes(r.n) : r.band === perfTab)) && (!f.team || r.p.team === f.team) && (!q || r.n.toLowerCase().includes(q) || (r.p.title || '').toLowerCase().includes(q)))
    .sort((a, b) => perfTab === 'top' ? (b.ix - a.ix) || (b.pct - a.pct) : ({off: 0, risk: 1, watch: 2, ok: 3})[a.band] - ({off: 0, risk: 1, watch: 2, ok: 3})[b.band] || a.pct - b.pct);
  const segs = [['all', 'Everyone', all.length], ['off', 'Off track', counts.off], ['risk', 'At risk', counts.risk], ['watch', 'Needs a nudge', counts.watch], ['top', 'Top five', Math.min(5, all.length)]];
  const segBar = `<div class="seg" role="tablist" aria-label="Performance view">${[['now', 'Where things stand'], ['appraisal', 'Appraisal']].map(([v, l]) =>
    `<button role="tab" aria-selected="${perfSeg === v}" data-act="perfseg" data-v="${v}">${l}</button>`).join('')}</div>`;
  if (perfSeg === 'appraisal') return `${pageHead('Performance', 'A record for any person over any window of time: what they delivered, what slipped, and what was said about it.')}${segBar}${viewAppraise(e)}`;
  return `${pageHead('Performance signals', 'Where each person stands, worked out from their numbers, and what needs chasing. Only managers, HR and the CEO see this. Ratings come from the review cycle, not from this page.', expBtn('perf'))}${segBar}
  <div class="stats">
    ${stat('ros', 'Behind or at risk', counts.off + counts.risk, counts.off + counts.risk ? 'Worked out from progress against the expected pace' : 'Nobody is behind', null, 'perf')}
    ${stat('amb', 'No word from the owner', staleN, `Goals with no note in over ${S.cfg.staleDays} days`, null, 'perf')}
    ${stat('tea', 'On track', counts.ok, 'Current and no flags raised', null, 'perf')}
    ${stat('vio', 'Ahead of plan', all.filter(isAhead).length, `Past the ${r0(expectedPace())}% expected by month ${goalMonth()} of 12, or already finished`, null, 'perf')}</div>
  ${noOkrs.length ? `<div class="banner"><span>${plural(noOkrs.length, 'person has', 'people have')} no OKRs set: ${esc(noOkrs.map(r => r.n).join(', '))}. That is their manager's to fix, not a performance flag.</span></div>` : ''}
  <div class="seg" role="tablist" aria-label="Performance band">${segs.map(([v, l, c]) => `<button role="tab" aria-selected="${perfTab === v}" data-act="perftab" data-v="${v}">${l}<span class="seg-n">${c}</span></button>`).join('')}</div>
  ${all.length > 1 ? fbar('perf', {ph: 'Search by name or job title', team: teamsIn(all.map(r => r.n)), count: `Showing ${rows.length} of ${all.length}`}) : ''}
  <div class="card">${rows.length ? `<div class="list">${rows.map(r => `<div class="prow">
    <div class="person-h grow">${avatar(r.n)}<div style="min-width:0"><div><b>${dosLink(e, r.p)}</b> ${chip(BAND[r.band][0], BAND[r.band][1])}${isAhead(r) ? chip('Ahead of plan', 'vio') : ''}${r.band === 'ok' && r.ix >= S.cfg.aheadAt && dueReview(r.p) ? chip('Review due', 'acc') : ''}</div>
      <div class="sub">${esc(r.p.title || ROLES[r.p.role])} · ${esc(where(r.p))}</div>
      ${r.said.length ? `<div class="flagset"><span class="lbl">Standing</span><ul class="flags said">${r.said.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${r.chase.length ? `<div class="flagset"><span class="lbl">Needs chasing</span><ul class="flags">${r.chase.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${!r.said.length && !r.chase.length ? '<div class="sub">Goals current, nothing raised.</div>' : ''}</div></div>
    <div class="pcol"><div class="sub">Delivering <b>${r0(r.ix)}%</b> of what is expected by now</div><div class="prog">${bar(r.pct, r.pct >= r.exp ? 'good' : r.pct < r.exp * S.cfg.behindAt / 100 ? 'bad' : 'warm')}<span class="pc">${r0(r.pct)}%</span></div>
      <div class="sub">Standups ${r0(r.sr)}% · ${r.rating ? 'last review ' + r.rating.rating + '/5' : 'no review yet'}</div></div></div>`).join('')}</div>`
    : empty(all.length ? 'Nobody matches these filters.' : 'Nobody reports to you yet.')}</div>`;
}

function viewWelf(e) {
  const f = ff.welf, q = f.q.trim().toLowerCase(), mine = welfareOf(e.name, wk), sv = surveyFor(wk), own = !!sv && !sv.closed;
  const team = isGroup(e) || e.role === 'manager';
  const names = team ? [...lbScope(e)].filter(n => { const p = person(n); return p && !isGroup(p) && n !== e.name && (isGroup(e) || reportsTo(p, e)) && (!f.team || p.team === f.team) && (!q || n.toLowerCase().includes(q)); }).sort() : [];
  const rows = names.map(n => ({n, p: person(n), w: welfareOf(n, wk), flag: welfareFlag(n)}));
  const need = rows.filter(r => r.flag).length;
  const avg = rows.filter(r => r.w).length ? rows.filter(r => r.w).reduce((t, r) => t + r.w.workload, 0) / rows.filter(r => r.w).length : null;
  const scale = (id, label, list, sel) => `<label class="f grow">${label}<select id="${id}">${list.map((l, i) => i ? `<option value="${i}"${sel === i ? ' selected' : ''}>${esc(l)}</option>` : '').join('')}</select></label>`;
  const gotIt = responded(wk), miss = outstanding(wk);
  const svCard = isGroup(e) ? `<section class="card"><div class="sec-h"><h2>Weekly check-in survey</h2>${sv ? chip(sv.closed ? 'Closed' : 'Open', sv.closed ? '' : 'good') : chip('Not sent', 'warn')}</div>
    ${!sv ? `<p class="sub" style="margin:0">Nobody has been asked for a check-in this week.</p>
      ${wk === curWeek() ? `<div class="row"><button class="btn" data-act="sendsurvey">Send to ${plural(recipients().length, 'person', 'people')}</button><span class="sub">It goes on everyone's dashboard, and to their inbox when email is set up.</span></div>` : '<p class="sub" style="margin:0">A check-in can only be sent for the current week.</p>'}`
      : `<p class="sub" style="margin:0">Sent by ${esc(sv.sentBy)} on ${esc(dateShort(sv.sentAt))} to ${plural(recipients().length, 'person', 'people')}.${sv.remindedAt ? ' Reminder sent ' + esc(dateShort(sv.remindedAt)) + '.' : ''}</p>
      <div class="prog">${bar(gotIt.length / recipients().length * 100)}<span class="pc">${r0(gotIt.length / recipients().length * 100)}%</span></div>
      <p class="sub" style="margin:0">${gotIt.length} of ${recipients().length} have replied.${miss.length ? ' Waiting on ' + esc(miss.map(p => p.name).join(', ')) + '.' : ' Everyone has replied.'}</p>
      <div class="row">${miss.length && !sv.closed && !sv.remindedAt ? `<button class="btn ghost sm" data-act="remindsurvey">Send a reminder</button>` : ''}
        ${sv.closed ? `<button class="btn quiet sm" data-act="reopensurvey">Reopen</button>` : `<button class="btn quiet sm" data-act="closesurvey">Close it</button>`}</div>`}</section>` : '';
  return `<div class="row between"><p class="sub" style="margin:0">A weekly check-in on workload and wellbeing. Managers and HR see their own people.</p><div class="row">${weekNav()}${team ? expBtn('welf') : ''}</div></div>
  ${svCard}
  ${(!sv || sv.closed) && !isGroup(e) ? `<div class="card">${empty(sv ? 'This week\'s check-in is closed.' : 'No check-in has been sent for this week yet.')}</div>` : ''}
  ${own ? `<form class="card" data-submit="savewelf"><div class="sec-h"><h2 style="font-size:16px">${mine ? 'Your check-in this week' : 'How is this week going?'}</h2>${mine ? chip('Sent ' + dateShort(mine.ts), 'good') : ''}</div>
    <p class="sub" style="margin:0">Two questions, once a week. ${esc(approverOf({owner: e.name}))} and HR can read your answers.</p>
    <div class="row" style="align-items:flex-end">${scale('wf-load', 'How heavy was your workload?', WLOAD, mine?.workload || 3)}${scale('wf-mood', 'How are you doing?', MOOD, mine?.mood || 4)}</div>
    <label class="f"><span>Anything you want to flag? <span class="sub">(optional)</span></span><input type="text" id="wf-note" value="${esc(mine?.note || '')}" placeholder="Blockers, workload, anything you need" maxlength="500"></label>
    ${!enpsAsked(e.name) || mine?.enps != null ? `<div class="askonce"><label class="f" for="wf-enps">How likely are you to recommend working here, to someone looking for a job?</label>
      <div class="row"><span class="sub">Not at all likely</span><select id="wf-enps"><option value="">Rather not say</option>${Array.from({length: 11}, (_, i) => `<option value="${i}"${mine?.enps === i ? ' selected' : ''}>${i}</option>`).join('')}</select><span class="sub">Extremely likely</span>
      <span class="sub">· asked every ${S.cfg.enpsDays} days</span></div></div>` : '<input type="hidden" id="wf-enps" value="">'}
    <div class="row"><button class="btn" type="submit">${mine ? 'Update check-in' : 'Send check-in'}</button></div></form>` : ''}
  ${team ? `<div class="stats">${stat('ros', 'Needs attention', need, need ? 'Heavy workload or a low score' : 'Nobody flagged this week', null, 'ci')}
    ${stat('tea', 'Checked in', rows.filter(r => r.w).length + '/' + rows.length, 'People who answered this week', null, 'ci')}
    ${stat('ind', 'Average workload', avg == null ? '—' : fmt(avg) + '/5', avg == null ? 'No check-ins yet' : WLOAD[Math.round(avg)], null, 'ci')}
    ${(x => stat('vio', 'eNPS', x ? (x.score > 0 ? '+' : '') + x.score : '—', x ? `${x.pro} promoters, ${x.det} detractors of ${x.n}` : 'Nobody has answered yet', null, 'ci'))(enpsScore(names))}</div>
  ${rows.length > 1 ? fbar('welf', {ph: 'Search by name', team: teamsIn(names), count: `Showing ${rows.length} people`}) : ''}
  <div class="card">${rows.length ? `<div class="list">${rows.map(r => `<div class="kr"><div class="person-h t">${avatar(r.n)}<div style="min-width:0"><div><b>${dosLink(e, r.p)}</b></div>
    <div class="sub">${r.w ? esc(WLOAD[r.w.workload] + ' workload · feeling ' + MOOD[r.w.mood].toLowerCase()) : 'No check-in this week'}</div>
    ${r.w && r.w.note ? `<div>${esc(r.w.note)}</div>` : ''}${r.flag ? `<div class="sub"><b>${esc(r.flag)}</b></div>` : ''}</div></div>
    <div class="acts">${r.w ? chip(r.w.workload + '/5 workload', r.w.workload >= 4 ? 'warn' : '') : chip('No check-in')}${r.flag ? chip('Needs attention', 'bad') : ''}</div></div>`).join('')}</div>`
    : empty('Nobody to show yet.')}</div>` : ''}`;
}

function viewLeave(e) {
  const pend = leavePending(e);
  const myLeave = leaveFor(e.name);
  const bal = x => leaveAllow(x.type) > 0 ? leaveBal(e.name, x.type) + ' ' + x.type.toLowerCase() : null;
  return `<div class="row between"><p class="sub" style="margin:0">Time off, and the requests waiting on you.</p>${isGroup(e) || e.role === 'manager' ? expBtn('leave') : ''}</div>
  ${pend.length ? `<section class="card"><div class="sec-h"><h2>Leave to approve</h2>${chip(plural(pend.length, 'request', 'requests'), 'warn')}</div>
    <div class="list">${pend.map(l => `<div class="kr"><div class="person-h t">${avatar(l.owner)}<div style="min-width:0"><div><b>${esc(l.owner)}</b> <span class="sub">${esc(l.type)}</span></div>
      <div class="sub">${esc(parseIso(l.from).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))} to ${esc(parseIso(l.to).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))} · ${plural(l.days, 'day', 'days')}${leaveAllow(l.type) > 0 ? ' · ' + leaveBal(l.owner, l.type) + ' days of ' + esc(l.type).toLowerCase() + ' left' : ''}</div></div></div>
    <div class="acts"><button class="btn sm" data-act="apleave" data-id="${l.id}">Approve</button><button class="btn ghost sm" data-act="rejleave" data-id="${l.id}">Decline</button></div></div>`).join('')}</div></section>` : ''}
  <section class="card"><div class="sec-h"><h2>Your leave</h2><span class="sub">${S.cfg.leave.map(bal).filter(Boolean).join(' · ')} left this year</span></div>
    <form class="row" data-submit="addleave" style="align-items:flex-end"><label class="f">From<input type="date" id="lv-from"></label><label class="f">To<input type="date" id="lv-to"></label>
      <label class="f">Type<select id="lv-type">${S.cfg.leave.map(x => `<option>${esc(x.type)}</option>`).join('')}</select></label>
      <button class="btn" type="submit">Request</button><span class="sub">Goes to ${esc(approverOf({owner: e.name}))} for approval.</span></form>
    <div class="list">${myLeave.length ? myLeave.slice(0, 8).map(l => `<div class="kr"><div class="t">${esc(l.type)}<div class="sub">${esc(parseIso(l.from).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))} to ${esc(parseIso(l.to).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))} · ${plural(l.days, 'day', 'days')}${l.apBy ? ' · ' + esc(l.status.toLowerCase()) + ' by ' + esc(l.apBy) : ''}</div></div>
      <div class="acts">${chip(l.status, l.status === 'Approved' ? 'good' : l.status === 'Requested' ? 'warn' : '')}${l.status === 'Requested' ? `<button class="btn quiet sm" data-act="delleave" data-id="${l.id}">Withdraw</button>` : ''}</div></div>`).join('') : '<div class="sub">No leave booked this year.</div>'}</div></section>`;
}

function viewCheck(e) {
  const pendN = leavePending(e).length;
  const c = liveCycle(), mineRev = c ? revOf(c.id, e.name) : null;
  const revDueN = c && e.role !== 'hr' && (!(mineRev && mineRev.self) || !!myRevToSign(e)) ? 1 : 0;
  const segs = [['week', 'This week', surveyDue(e) ? 1 : 0], ['rev', 'Review cycle', revDueN], ['leave', 'Leave', pendN]];
  const body = ciSeg === 'rev' ? viewRev(e) : ciSeg === 'leave' ? viewLeave(e) : viewWelf(e);
  return `${pageHead('Check-ins', 'The weekly pulse, the formal review cycle and time off, in one place.')}
  <div class="seg" role="tablist" aria-label="Which check-in">${segs.map(([v, l, n]) => `<button role="tab" aria-selected="${ciSeg === v}" data-act="ciseg" data-v="${v}">${l}${n ? `<span class="seg-n">${n}</span>` : ''}</button>`).join('')}</div>
  ${body}`;
}

function viewDossier(e) {
  const p = S.people.find(x => x.id === dossier);
  if (!canSeeDossier(e, p)) { dossier = null; return viewDash(e); }
  const r = risk(p.name), mine = personOkrs(p.name), cov = jdCoverage(p.name);
  const act2 = S.stand.filter(x => x.week === wk && x.owner === p.name);
  const openKrs = [], done = [];
  mine.forEach(o => o.krs.forEach(k => { if (k.pct !== 100) openKrs.push({o, k}); else if (k.apAt) done.push({o, k}); }));
  done.sort((a, b) => b.k.apAt - a.k.apAt);
  const hist = pastWeeks(4).map(w => welfareOf(p.name, w)).filter(Boolean);
  const yrs = p.joined ? (Date.now() - parseIso(p.joined)) / (365.25 * 86400000) : 0;
  const hr = isGroup(e) && p.name !== e.name, canEditEmp = isGroup(e) && (p.role !== 'ceo' || e.role === 'ceo');
  const note = p.hrnote;
  const empForm = empEdit && canEditEmp ? `<form data-submit="saveemp" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><label class="f grow" style="flex-basis:200px">Name<input type="text" id="em-name" value="${esc(p.name)}" maxlength="80"></label>
        <label class="f grow" style="flex-basis:200px">Job title<input type="text" id="em-title" value="${esc(p.title || '')}" maxlength="80"></label></div>
      <div class="row"><label class="f">Contract<input type="text" id="em-contract" value="${esc(p.contract || '')}" list="em-ct" style="width:150px" maxlength="40"><datalist id="em-ct">${S.cfg.etypes.map(x => `<option>${esc(x)}</option>`).join('')}</datalist></label>
        <label class="f">Notice<input type="text" id="em-notice" value="${esc(p.notice || '')}" placeholder="e.g. 1 month" style="width:130px" maxlength="40"></label>
        <label class="f">Started<input type="date" id="em-joined" value="${esc(p.joined || '')}"></label>
        <label class="f">Next review<input type="date" id="em-review" value="${esc(p.review || '')}"></label>
        <label class="f">Salary a year (${esc(S.cfg.cur)})<input type="number" id="em-salary" value="${esc(String(p.salary || ''))}" min="0" step="1000" style="width:150px"></label></div>
      <label class="f">Job description, one responsibility per line<textarea id="em-jd" rows="3" maxlength="4000">${esc((p.jd || []).join('\n'))}</textarea></label>
      <div class="row"><button class="btn sm" type="submit">Save</button><button type="button" class="btn quiet sm" data-act="cancelemp">Cancel</button></div></form>` : '';
  return `${pageHead(p.name, `${p.title || ROLES[p.role]} · ${where(p)}`, '<button class="btn quiet" data-act="closedos">Back</button>')}
  <section class="card"><div class="person-h">${avatar(p.name)}<div class="grow" style="min-width:0"><div class="person-h">${chip(ROLES[p.role] || p.role, ROLE_TONE[p.role])}${r ? chip(BAND[r.band][0], BAND[r.band][1]) : ''}</div>
    <div class="sub">${esc(p.email || 'No email on file')} · joined ${esc(p.joined ? parseIso(p.joined).toLocaleDateString(undefined, {month: 'long', year: 'numeric'}) : 'unknown')}${p.joined ? ` · ${fmt(yrs)} years` : ''}${mgrOf(p) ? ' · reports to ' + esc(mgrOf(p).name) : ''}${directs(p).length ? ' · ' + plural(directs(p).length, 'direct report', 'direct reports') : ''}</div></div></div></section>
  <div class="stats">
    ${stat('ind', 'Annual progress', r0(personPct(p.name)) + '%', `${r0(expectedPace())}% expected by now`, personPct(p.name), 'okrs')}
    ${stat('tea', 'Key results approved', approvedFor(p.name) + '/' + krCount(p.name), plural(mine.length, 'OKR', 'OKRs'), null, 'okrs')}
    ${stat('amb', 'Standup consistency', r0(standupRate(p.name)) + '%', 'Weeks logged out of the last 4', standupRate(p.name), 'stand')}
    ${stat('ros', 'Overdue', overdueFor(p.name), overdueFor(p.name) ? 'Key results past their month' : 'Nothing overdue', null, 'okrs')}</div>
  <div class="cols"><div class="stack">
    <section class="card"><div class="sec-h"><h2>Job description vs goals</h2><span class="sub">${cov.filter(c => c.okr).length} of ${cov.length} covered</span></div>
      <div class="list">${cov.length ? cov.map(c => `<div class="kr"><div class="t">${esc(c.d)}<div class="sub">${c.okr ? 'Covered by: ' + esc(c.okr) : 'No OKR covers this responsibility'}</div></div>${c.okr ? chip('Covered', 'good') : chip('Gap', 'warn')}</div>`).join('') : empty('No job description on file.')}</div></section>
    <section class="card"><div class="sec-h"><h2>Active work</h2></div>
      <div class="list">${openKrs.length ? openKrs.map(({o, k}) => `<div class="kr"><div class="t">${esc(k.title)}<div class="sub">${esc(o.objective)}${k.month != null ? ' · due ' + MON[k.month] : ''}</div></div><div class="acts">${overdue(o, k) ? chip('Overdue', 'bad') : k.req ? chip('Awaiting approval', 'warn') : ''}</div></div>`).join('')
        : '<div class="sub">No open key results.</div>'}
        ${act2.length ? act2.map(x => `<div class="kr"><div class="t">${esc(x.text)}<div class="sub">Standup this week</div></div>${chip(x.status, statTone(x.status))}</div>`).join('') : '<div class="sub">No standup entries this week.</div>'}</div></section>
    <section class="card"><div class="sec-h"><h2>Approval history</h2></div>
      <div class="list">${done.length ? done.slice(0, 8).map(({o, k}) => `<div class="kr"><div class="t">${esc(k.title)}<div class="sub">${esc(o.objective)}</div></div><div class="acts">${chip('Approved by ' + (k.apBy || '—') + ' · ' + dateShort(k.apAt), 'good')}</div></div>`).join('') : '<div class="sub">Nothing approved yet.</div>'}</div></section>
  </div><div class="stack">
    <section class="card"><div class="sec-h"><h2>Standing</h2></div>
      ${r ? `${r.said.length ? `<div class="flagset"><span class="lbl">Standing</span><ul class="flags said">${r.said.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${r.chase.length ? `<div class="flagset"><span class="lbl">Needs chasing</span><ul class="flags">${r.chase.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${!r.said.length && !r.chase.length ? '<p class="sub">Goals current, nothing raised.</p>' : ''}
        <p class="sub">${r.rating ? 'Last review: ' + r.rating.rating + '/5 by ' + esc(r.rating.by) + ' in ' + esc(r.rating.cycle) + '.' : 'No completed review yet.'}</p>` : '<p class="sub">Group-level roles are not ranked.</p>'}</section>
    ${(o => !o ? (hr ? `<section class="card"><div class="sec-h"><h2>Onboarding</h2></div><p class="sub" style="margin:0">No checklist for ${esc(p.name)}.</p>
      <div class="row"><button class="btn sm" data-act="startonb" data-id="${p.id}">Start onboarding</button><span class="sub">Uses the ${esc(tmplFor(p.sub).name || 'default')} checklist.</span></div></section>` : '')
      : `<section class="card"><div class="sec-h"><h2>Onboarding</h2>${chip(r0(onbPct(o)) + '% done', onbPct(o) >= 100 ? 'good' : '')}</div>
      ${bar(onbPct(o))}
      <div class="list">${o.tasks.filter(t => !t.done).slice(0, 5).map(t => `<div class="kr"><div class="t">${esc(t.t)}<div class="sub">${esc(t.who)} · due ${esc(onbDue(o, t).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))}</div></div>${onbLate(o, t) ? chip('Overdue', 'bad') : chip('To do')}</div>`).join('') || '<div class="sub">Everything is done.</div>'}</div>
      <div class="row"><button class="btn quiet sm" data-act="tab" data-t="hire-onb">Open the full checklist</button></div></section>`)(onbFor(p.name))}
    <section class="card"><div class="sec-h"><h2>One to ones</h2></div>
      ${mgrOf(p) && mgrOf(p).id === e.id ? `<form class="row" data-submit="addone" style="align-items:flex-end"><label class="f grow" style="flex-basis:100%">Log a one to one<input type="text" id="one-note" placeholder="What you discussed and what you agreed" maxlength="2000"></label><button class="btn sm" type="submit">Save</button></form>` : ''}
      <div class="list">${onesFor(p.name, mgrOf(p)?.name || '').length ? onesFor(p.name, mgrOf(p)?.name || '').slice(0, 5).map(o => `<div class="kr"><div class="t">${esc(o.notes)}<div class="sub">${esc(o.owner)} and ${esc(o.with)} · ${esc(dateShort(o.at))}</div></div></div>`).join('') : '<div class="sub">No one to ones logged.</div>'}</div></section>
    <section class="card"><div class="sec-h"><h2>Feedback</h2><span class="sub">${plural(fbFor(p.name).length, 'note', 'notes')}</span></div>
      ${p.name !== e.name ? `<form data-submit="addfb" style="display:flex;flex-direction:column;gap:8px"><label class="f">Give feedback<input type="text" id="fb-text" placeholder="Be specific about what they did" maxlength="1000"></label>
        <div class="row"><label class="f">Kind<select id="fb-kind"><option>Praise</option><option>Improvement</option></select></label><button class="btn sm" type="submit">Send</button></div></form>` : ''}
      <div class="list">${fbFor(p.name).length ? fbFor(p.name).slice(0, 6).map(x => `<div class="kr"><div class="t">${esc(x.text)}<div class="sub">${esc(x.from)} · ${esc(dateShort(x.at))}</div></div>${chip(x.kind, FBTONE[x.kind])}</div>`).join('') : '<div class="sub">No feedback yet.</div>'}</div></section>
    <section class="card"><div class="sec-h"><h2>Documents</h2>${docsFor(p.name).some(d => d.status === 'Awaiting signature') ? chip('Signature outstanding', 'warn') : ''}</div>
      <div class="list">${docsFor(p.name).length ? docsFor(p.name).map(d => `<div class="kr"><div class="t">${esc(d.name)}<div class="sub">${esc(d.type)} · ${esc(dateShort(d.at))}${d.file ? ' · ' + esc(d.file.name) + ' (' + fmt(d.file.size / 1024) + ' KB)' : ' · no file attached'}</div></div>
        <div class="acts">${d.file ? `<a class="btn quiet sm" href="/api/docs/${esc(d.id)}/file" download>Download</a>` : ''}${chip(d.status, DOCST[d.status])}${isGroup(e) && d.status === 'Awaiting signature' ? `<button class="btn quiet sm" data-act="signdoc" data-id="${d.id}">Mark signed</button>` : ''}${isGroup(e) || p.name === e.name ? `<button class="btn quiet sm" data-act="pickdoc" data-id="${d.id}">${d.file ? 'Replace' : 'Upload'}</button>` : ''}${isGroup(e) ? (confirmDel === d.id ? `<button class="btn bad sm" data-act="deldoc" data-id="${d.id}">Remove</button><button class="btn quiet sm" data-act="cancel">Cancel</button>` : `<button class="btn quiet sm" data-act="askdel" data-id="${d.id}">Remove</button>`) : ''}</div></div>`).join('') : '<div class="sub">No documents on file.</div>'}</div>
      <input type="file" id="doc-file" class="sr" aria-label="Choose a file to attach">
      ${isGroup(e) || p.name === e.name ? '<p class="sub" style="margin:0">Files up to 5 MB. PDFs and images download as they are; anything else downloads as a file.</p>' : ''}
      ${isGroup(e) ? `<form class="row" data-submit="adddoc" style="align-items:flex-end"><label class="f grow">Add or request a document<input type="text" id="doc-name" placeholder="e.g. Updated contract" maxlength="120"></label>
        <label class="f">Type<select id="doc-type">${['Contract', 'Role', 'Policy', 'Other'].map(x => `<option${x === 'Policy' ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f">Status<select id="doc-status"><option>Awaiting signature</option><option>On file</option><option>Signed</option></select></label><button class="btn sm" type="submit">Add</button></form>` : ''}</section>
    <section class="card"><div class="sec-h"><h2>Reviews</h2></div>
      <div class="list">${S.cycles.map(c => ({c, r: revOf(c.id, p.name)})).filter(x => x.r).map(({c, r: rv}) => `<div class="kr"><div class="t">${esc(c.name)}
        <div class="sub">${rv.self ? 'Self ' + rv.self.rating : 'No self-review'}${rv.mgr && rv.mgr.rating != null ? ' · ' + esc(rv.mgr.by) + ' ' + rv.mgr.rating + ' · ' + esc(RATINGS[rv.mgr.rating]) : rv.mgr ? ' · ' + esc(rv.mgr.by) + ' has written theirs' : ''}</div>
        ${rv.mgr && rv.mgr.text ? `<div>${esc(rv.mgr.text)}</div>` : ''}</div>${chip(REVST[revStage(rv)][0], REVST[revStage(rv)][1])}</div>`).join('') || '<div class="sub">No reviews recorded.</div>'}</div></section>
    <section class="card"><div class="sec-h"><h2>Employment</h2>${dueReview(p) ? chip('Review due', 'acc') : ''}${canEditEmp && !empEdit ? '<button class="btn quiet sm" data-act="editemp">Edit</button>' : ''}</div>
      ${empForm || `<div class="list">
        <div class="kr"><div class="t">Contract<div class="sub">${esc(p.contract || 'Not recorded')}${p.notice ? ' · ' + esc(p.notice) + ' notice' : ''}</div></div></div>
        <div class="kr"><div class="t">Started<div class="sub">${esc(p.joined ? parseIso(p.joined).toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'}) : 'Not recorded')}</div></div></div>
        <div class="kr"><div class="t">Next review<div class="sub">${esc(p.review ? parseIso(p.review).toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'}) : 'Not scheduled')}</div></div>${r && r.ix >= S.cfg.aheadAt ? chip('Delivering ' + r0(r.ix) + '%', 'vio') : ''}</div>
        ${canSeePay(e, p) ? `<div class="kr"><div class="t">Salary<div class="sub">${esc(p.salary ? money(p.salary) + ' a year' : 'Not recorded')}</div></div></div>`
          : '<div class="kr"><div class="t">Salary<div class="sub">Visible to HR and the CEO only</div></div></div>'}
      </div>`}</section>
    <section class="card"><div class="sec-h"><h2>Leave</h2><span class="sub">${leaveBal(p.name)} of ${leaveAllow(S.cfg.leave[0].type)} days of ${esc(S.cfg.leave[0].type).toLowerCase()} left</span></div>
      <div class="list">${leaveFor(p.name).length ? leaveFor(p.name).slice(0, 5).map(l => `<div class="kr"><div class="t">${esc(l.type)}<div class="sub">${esc(parseIso(l.from).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))} to ${esc(parseIso(l.to).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}))} · ${plural(l.days, 'day', 'days')}${l.apBy ? ' · ' + esc(l.status.toLowerCase()) + ' by ' + esc(l.apBy) : ''}</div></div>${chip(l.status, l.status === 'Approved' ? 'good' : l.status === 'Requested' ? 'warn' : '')}</div>`).join('') : '<div class="sub">No leave recorded this year.</div>'}</div></section>
    <section class="card"><div class="sec-h"><h2>Wellbeing</h2></div>
      ${welfareFlag(p.name) ? `<div class="banner info"><span>${esc(welfareFlag(p.name))}</span></div>` : ''}
      <div class="list">${hist.length ? hist.map(x => `<div class="kr"><div class="t">${esc(WLOAD[x.workload])} workload · feeling ${esc(MOOD[x.mood].toLowerCase())}${x.note ? `<div class="sub">${esc(x.note)}</div>` : ''}</div>${chip(x.workload + '/5', x.workload >= 4 ? 'warn' : '')}</div>`).join('') : '<div class="sub">No check-ins in the last 4 weeks.</div>'}</div></section>
    <section class="card"><div class="sec-h"><h2>People action</h2></div>
      ${note ? `<div class="kr"><div class="t"><b>${esc(note.action)}</b><div class="sub">Set by ${esc(note.by)} on ${esc(dateShort(note.at))}</div>${note.text ? `<div>${esc(note.text)}</div>` : ''}</div></div>` : '<p class="sub">No action recorded.</p>'}
      ${hr ? `<form data-submit="savenote-hr" style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        <label class="f">Action<select id="hr-act"><option value="">Choose an action</option>${HR_ACTIONS.map(x => `<option${note && note.action === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f">Context<input type="text" id="hr-note" value="${esc(note?.text || '')}" placeholder="What was agreed, and with whom" maxlength="500"></label>
        <div class="row"><button class="btn sm" type="submit">Record</button>${note ? '<button type="button" class="btn quiet sm" data-act="clearhr">Clear</button>' : ''}</div>
        <p class="sub">A flag is a prompt for a conversation. Record what was agreed with the person, not just the score.</p></form>` : ''}</section>
  </div></div>`;
}

function orgNode(p, e, depth, seen = new Set()) {
  if (seen.has(p.id) || depth > 20) return '';
  seen.add(p.id);
  const kids = directs(p).filter(k => !subFilter || !k.sub || k.sub === subFilter);
  return `<li><div class="orgc"><div class="person-h">${avatar(p.name, true)}<div style="min-width:0"><div><b>${dosLink(e, p)}</b> ${chip(ROLES[p.role] || p.role, ROLE_TONE[p.role])}</div>
    <div class="sub">${esc(p.title || '')}${p.sub ? ' · ' + esc(where(p)) : ''}${kids.length ? ' · ' + plural(kids.length, 'direct report', 'direct reports') : ''}</div></div></div></div>
    ${kids.length ? `<ul>${kids.map(k => orgNode(k, e, depth + 1, seen)).join('')}</ul>` : ''}</li>`;
}

function viewSet(e) {
  if (!cfgDraft) startCfgDraft();
  const c = cfgDraft.c;
  const num = (id, label, v, hint) => `<label class="f"><span>${label}</span><input type="number" min="0" step="1" id="${id}" value="${esc(String(v))}">${hint ? `<span class="sub">${esc(hint)}</span>` : ''}</label>`;
  const was = (key, i) => cfgDraft.from[key][i];
  const mr = mailRep;
  const st = s => ({sent: ['Sent', 'good'], queued: ['Waiting to send', 'warn'], failed: ['Failed', 'bad'], 'no-address': ['No email address', 'bad'], 'not-set-up': ['Email not set up', '']}[s] || [s, '']);
  return `${pageHead('Settings', 'The policy numbers behind the rest of the app. Only the CEO and HR can change these.')}
  <section class="card"><div class="sec-h"><h2>Subsidiaries</h2><span class="sub">${plural(c.subs.length, 'subsidiary', 'subsidiaries')}</span></div>
    <div class="list">${c.subs.map((x, i) => { const inUse = was('subs', i) && S.people.some(p => p.sub === was('subs', i));
      return `<div class="kr"><div class="t"><input type="text" id="cf-sub-${i}" value="${esc(x)}" aria-label="Subsidiary ${i + 1}" maxlength="40"></div>
      <div class="acts"><span class="sub">${plural(was('subs', i) ? S.people.filter(p => p.sub === was('subs', i)).length : 0, 'person', 'people')}</span>
        ${inUse ? '<span class="sub">in use</span>' : `<button class="btn quiet sm" data-act="rmcfg" data-k="subs" data-i="${i}">Remove</button>`}</div></div>`; }).join('')}</div>
    <div class="row"><button class="btn ghost sm" data-act="addcfg" data-k="subs">+ Add subsidiary</button><span class="sub">Renaming one moves everyone and everything on it. A subsidiary in use cannot be removed.</span></div></section>

  <section class="card"><div class="sec-h"><h2>Goal year and chasing</h2></div>
    <div class="row" style="align-items:flex-start">
      <label class="f"><span>The goal year starts in</span><select id="cf-ys">${MONFULL.map((m, i) => `<option value="${i}"${c.yearStart === i ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select><span class="sub">Sets what "expected by now" means</span></label>
      ${num('cf-stale', 'Chase a goal with no update after', c.staleDays, 'days')}
      ${num('cf-risk', 'Call a goal at risk below', c.riskAt, '% of expected pace')}
      ${num('cf-behind', 'Call it off track below', c.behindAt, '% of expected pace')}
      ${num('cf-ahead', 'Count someone ahead of plan above', c.aheadAt, '% of expected pace')}</div></section>

  <section class="card"><div class="sec-h"><h2>Rhythm</h2></div>
    <div class="row" style="align-items:flex-start">
      ${num('cf-su', 'Expect a standup in at least', c.standupWeeks, 'of the last 4 weeks')}
      ${num('cf-enps', 'Ask the recommend question every', c.enpsDays, 'days')}
      ${num('cf-rev', 'Self-reviews are due after', c.reviewDueDays, 'days when a cycle opens')}</div></section>

  <section class="card"><div class="sec-h"><h2>Leave</h2></div>
    <div class="list">${c.leave.map((x, i) => { const inUse = was('leave', i) && S.leave.some(l => l.type === was('leave', i));
      return `<div class="kr"><div class="t"><input type="text" id="cf-lt-${i}" value="${esc(x.type)}" aria-label="Leave type ${i + 1}" maxlength="40"></div>
      <div class="acts"><input type="number" min="0" id="cf-ld-${i}" value="${x.days}" aria-label="Days for ${esc(x.type)}" style="width:92px"><span class="sub">days a year${x.days ? '' : ', no limit'}</span>
        ${inUse || c.leave.length < 2 ? '<span class="sub">in use</span>' : `<button class="btn quiet sm" data-act="rmcfg" data-k="leave" data-i="${i}">Remove</button>`}</div></div>`; }).join('')}</div>
    <div class="row"><button class="btn ghost sm" data-act="addcfg" data-k="leave">+ Add leave type</button><span class="sub">The first type is the one shown as the headline balance. Zero days means no limit, as for unpaid leave.</span></div></section>

  <section class="card"><div class="sec-h"><h2>Hiring approvals</h2></div>
    <p class="sub" style="margin:0">Every role request runs through these steps in order. A step the person asking already sits on clears itself.</p>
    <div class="row" style="align-items:flex-start">
      <label class="f"><span>Money is shown in</span><input type="text" id="cf-cur" value="${esc(c.cur)}" maxlength="3" style="width:80px"><span class="sub">symbol used for salaries</span></label>
      <label class="f"><span>Line manager approves first</span><select id="cf-rm"><option value="1"${c.reqMgr ? ' selected' : ''}>Yes</option><option value="0"${c.reqMgr ? '' : ' selected'}>No, straight to HR</option></select></label>
      <label class="f"><span>The CEO signs off as well</span><select id="cf-re"><option value="0"${c.execAll ? '' : ' selected'}>No</option><option value="1"${c.execAll ? ' selected' : ''}>Yes, after HR</option></select></label></div></section>

  <section class="card"><div class="sec-h"><h2>Contract types</h2></div>
    <div class="list">${c.etypes.map((x, i) => `<div class="kr"><div class="t"><input type="text" id="cf-et-${i}" value="${esc(x)}" aria-label="Contract type ${i + 1}" maxlength="40"></div>
      <div class="acts">${c.etypes.length > 1 && !(was('etypes', i) && S.roles.some(r => r.etype === was('etypes', i))) ? `<button class="btn quiet sm" data-act="rmcfg" data-k="etypes" data-i="${i}">Remove</button>` : '<span class="sub">in use</span>'}</div></div>`).join('')}</div>
    <div class="row"><button class="btn ghost sm" data-act="addcfg" data-k="etypes">+ Add contract type</button><span class="sub">What a role request can offer.</span></div></section>

  <section class="card"><div class="sec-h"><h2>Why an opening closes unfilled</h2></div>
    <div class="list">${c.closeWhy.map((x, i) => `<div class="kr"><div class="t"><input type="text" id="cf-cw-${i}" value="${esc(x)}" aria-label="Close reason ${i + 1}" maxlength="80"></div>
      <div class="acts">${c.closeWhy.length > 1 && !(was('closeWhy', i) && S.roles.some(r => closedOf(r).some(y => y.reason === was('closeWhy', i)))) ? `<button class="btn quiet sm" data-act="rmcfg" data-k="closeWhy" data-i="${i}">Remove</button>` : '<span class="sub">in use</span>'}</div></div>`).join('')}</div>
    <div class="row"><button class="btn ghost sm" data-act="addcfg" data-k="closeWhy">+ Add reason</button><span class="sub">Offered when a role closes with seats still empty, so the reporting holds up.</span></div></section>

  <section class="card"><div class="sec-h"><h2>Onboarding task owners</h2></div>
    <div class="list">${c.onbWho.map((x, i) => `<div class="kr"><div class="t"><input type="text" id="cf-ow-${i}" value="${esc(x)}" aria-label="Owner ${i + 1}" maxlength="40"></div>
      <div class="acts">${c.onbWho.length > 1 && !(was('onbWho', i) && S.tmpl.some(t => t.tasks.some(k => k.who === was('onbWho', i)))) ? `<button class="btn quiet sm" data-act="rmcfg" data-k="onbWho" data-i="${i}">Remove</button>` : '<span class="sub">in use</span>'}</div></div>`).join('')}</div>
    <div class="row"><button class="btn ghost sm" data-act="addcfg" data-k="onbWho">+ Add owner</button><span class="sub">Who a checklist task can be assigned to. The new starter never has tasks: their line manager ticks Manager tasks, and HR ticks the rest.</span></div></section>

  <section class="card"><div class="sec-h"><h2>Email alerts</h2>${mr ? chip(mr.configured ? 'Email is set up' : 'Email is not set up', mr.configured ? 'good' : 'warn') : ''}</div>
    <p class="sub" style="margin:0">Every alert shows in the app. Choose which also go by email straight away, which wait for the one daily email, and which stay in the app only. Emails never contain a rating, a pay figure or review text.</p>
    <div class="row" style="align-items:flex-start">
      <label class="f grow" style="flex-basis:200px"><span>Sender name</span><input type="text" id="cf-mfrom" value="${esc(c.mail.fromName)}" maxlength="80"></label>
      <label class="f grow" style="flex-basis:220px"><span>Reply-to address</span><input type="email" id="cf-mreply" value="${esc(c.mail.replyTo)}" placeholder="Someone who reads replies" maxlength="200"></label>
      <label class="f"><span>Daily email goes out at</span><select id="cf-mhour">${Array.from({length: 24}, (_, h) => `<option value="${h}"${c.mail.digestHour === h ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select><span class="sub">weekdays only</span></label></div>
    <div class="tblwrap"><table><thead><tr><th>Alert</th><th>Goes to</th><th>Email</th></tr></thead><tbody>
      ${Object.entries(ALERTS).map(([k, [label, to]]) => `<tr><td>${esc(label)}</td><td>${esc(to)}</td><td><select id="cf-mm-${k}" aria-label="Email for ${esc(label)}">${ALERT_MODES.map(([v, l]) => `<option value="${v}"${c.mail.modes[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div></section>

  <div class="row"><button class="btn" data-act="savecfg">Save settings</button><button class="btn quiet" data-act="discardcfg">Discard changes</button><button class="btn quiet" data-act="resetcfg">Reset numbers to defaults</button></div>

  <section class="card"><div class="sec-h"><h2>Email log</h2><div class="row">${mr && mr.configured ? '<button class="btn quiet sm" data-act="testmail">Send me a test email</button>' : ''}<button class="btn quiet sm" data-act="reloadmail">Refresh</button></div></div>
    ${!mr ? '<p class="sub" style="margin:0">Loading…</p>' : `
    <p class="sub" style="margin:0">${mr.configured ? `Sending through ${esc(mr.server)} as ${esc(mr.from)}.` : 'Nothing can be emailed until the server is given a mail account (SMTP_HOST and MAIL_FROM; see the README). Alerts still show in the app.'}
      ${mr.counts.sent} sent · ${mr.counts.queued} waiting · ${mr.counts.failed} failed · ${mr.counts.noAddress} with no address.</p>
    ${mr.noEmail.length ? `<div class="banner"><span>No valid email address for ${esc(mr.noEmail.join(', '))}. They can't be invited or emailed until one is added in the Directory.</span></div>` : ''}
    ${mr.rows.length ? `<div class="tblwrap"><table class="mailtbl"><thead><tr><th>When</th><th>To</th><th>What</th><th>Status</th></tr></thead><tbody>
      ${mr.rows.slice(0, 100).map(m => `<tr><td>${esc(new Date(m.at).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}))}</td><td>${esc(m.name)}<div class="sub">${esc(m.email || 'no address')}</div></td><td>${esc(m.subject)}</td>
        <td>${chip(st(m.status)[0], st(m.status)[1])}${m.error ? `<div class="sub">${esc(m.error)}</div>` : ''}${m.attempts > 1 ? `<div class="sub">${m.attempts} tries</div>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="sub" style="margin:0">Nothing has been emailed yet.</p>'}`}</section>`;
}

function viewPeople(e) {
  const admin = isGroup(e);
  const inSub = S.people.filter(p => !subFilter || !p.sub || p.sub === subFilter);
  const teams = [...new Set(inSub.map(p => p.team).filter(Boolean))].sort();
  if (pf.team && !teams.includes(pf.team)) pf.team = '';
  const q = pf.q.trim().toLowerCase();
  const list = inSub.filter(p => (!pf.team || p.team === pf.team) && (!pf.role || p.role === pf.role) && (!q || p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = !!(subFilter || pf.team || pf.role || q);
  const fopt = (v, cur, l) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  const roleOpts = sel => (e.role === 'ceo' ? ['member', 'manager', 'hr', 'ceo'] : ['member', 'manager', 'hr']).map(r => `<option value="${r}"${sel === r ? ' selected' : ''}>${ROLES[r]}</option>`).join('');
  const subOpts = sel => `<option value="">Group-level</option>` + subs().map(x => `<option${sel === x ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const roots = S.people.filter(p => !p.mgr || !S.people.some(x => x.id === p.mgr));
  const tabs = `<div class="seg" role="tablist" aria-label="Directory view">${[['table', 'Table'], ['org', 'Org chart']].map(([v, l]) =>
    `<button role="tab" aria-selected="${dirView === v}" data-act="dirview" data-v="${v}">${l}</button>`).join('')}</div>`;
  const linkCard = linkOut ? `<div class="card"><div class="sec-h"><h2 style="font-size:16px">${esc(linkOut.msg)}</h2><button class="btn quiet sm" data-act="clearlink">Dismiss</button></div>
    <p class="sub" style="margin:0">${linkOut.emailed ? 'It is on its way to their inbox. The link is here too, in case it does not arrive.' : (ST.mail && !ST.mail.configured ? 'Email is not set up yet, so send this to them yourself (chat or email). ' : 'Send this to them yourself (chat or email). ') + (linkOut.kind === 'invite' ? 'It lets them choose a password and sign in.' : 'It lets them choose a new password.')}</p>
    <div class="linkbox"><input type="text" id="link-url" value="${esc(linkOut.url)}" readonly aria-label="Link"><button class="btn sm" data-act="copylink">Copy</button></div></div>` : '';
  if (dirView === 'org') return `${pageHead('Directory', 'Who reports to whom. Approvals follow these lines.', expBtn('people'))}${tabs}
    <div class="card"><ul class="org">${roots.map(p => orgNode(p, e, 0)).join('')}</ul></div>`;
  return `${pageHead('Directory', 'Add people and set their subsidiary, role, team and who they report to. Approvals follow the reporting line.', `<div class="row"><button class="btn quiet" data-act="pickcsv">Import CSV</button>${expBtn('people')}</div>`)}${tabs}
  <input type="file" id="csv-in" accept=".csv,text/csv" class="sr" aria-label="Choose a CSV file of people">
  ${linkCard}
  ${imp ? `<div class="card"><div class="sec-h"><h2 style="font-size:16px">Import result</h2><button class="btn quiet sm" data-act="clearimp">Dismiss</button></div>
    ${imp.error ? `<p class="sub" style="margin:0">${esc(imp.error)} Nobody was added.</p>` : `<p class="sub" style="margin:0">${plural(imp.added, 'person', 'people')} added${imp.skipped.length ? ', ' + imp.skipped.length + ' skipped' : ''}.</p>`}
    ${imp.skipped.length ? `<ul class="flags">${imp.skipped.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="sub" style="margin:0">Columns read: Name (required), Email, Subsidiary, Role, Team, Job title, Reports to.</p></div>` : ''}
  <form class="card" data-submit="addperson"><h3>Add a person</h3><div class="row"><input type="text" id="pe-name" placeholder="Full name" aria-label="Name" class="grow" maxlength="80"><input type="email" id="pe-email" placeholder="Work email" aria-label="Email" class="grow" maxlength="200">
    <input type="text" id="pe-title" placeholder="Job title" aria-label="Job title" style="width:160px" maxlength="80">
    <select id="pe-sub" aria-label="Subsidiary">${subOpts('')}</select>
    <select id="pe-role" aria-label="Role">${roleOpts('member')}</select>
    <input type="text" id="pe-team" placeholder="Team" aria-label="Team" style="width:140px" maxlength="60">
    <select id="pe-mgr" aria-label="Reports to"><option value="">Reports to…</option>${S.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <button class="btn" type="submit">Add</button></div><p class="sub" style="margin:0">They sign in with the email. After adding them, use Invite to get a link for them.</p></form>
  <div class="card"><div class="row" style="align-items:flex-end;margin-bottom:12px">
    <label class="f grow" style="flex-basis:220px">Search<input type="search" id="pf-q" data-pf="q" value="${esc(pf.q)}" placeholder="Search by name, email or job title"></label>
    <label class="f">Subsidiary<select id="pf-sub" data-chg="sub">${fopt('', subFilter, 'All')}${subs().map(x => fopt(x, subFilter, x)).join('')}</select></label>
    <label class="f">Team<select id="pf-team" data-pf="team">${fopt('', pf.team, 'All teams')}${teams.map(x => fopt(x, pf.team, x)).join('')}</select></label>
    <label class="f">Role<select id="pf-role" data-pf="role">${fopt('', pf.role, 'All roles')}${['ceo', 'hr', 'manager', 'member'].map(r => fopt(r, pf.role, ROLES[r])).join('')}</select></label>
    ${filtered ? '<button class="btn quiet sm" data-act="clearpf">Clear filters</button>' : ''}</div>
    <p class="sub" style="margin:0 0 8px">Showing ${list.length} of ${S.people.length} ${S.people.length === 1 ? 'person' : 'people'}</p>
    <div class="tblwrap"><table><thead><tr><th>Name</th><th>Email</th><th>Subsidiary</th><th>Role</th><th>Team</th><th>Reports to</th><th>Sign-in</th><th></th></tr></thead><tbody>
  ${list.length ? list.map(p => admin && (e.role === 'ceo' || p.role !== 'ceo') ? `<tr><td><div class="person-h">${avatar(p.name, true)}<div><b>${dosLink(e, p)}</b>${p.title ? `<div class="sub">${esc(p.title)}</div>` : ''}</div></div></td>
    <td><input type="email" id="pr-e-${p.id}" value="${esc(p.email || '')}" aria-label="Email" style="width:230px" maxlength="200"></td>
    <td><select id="pr-s-${p.id}" aria-label="Subsidiary">${subOpts(p.sub)}</select></td>
    <td><select id="pr-r-${p.id}" aria-label="Role"${p.id === ST.realId ? ' disabled title="You can\'t change your own role"' : ''}>${roleOpts(p.role)}</select></td>
    <td><input type="text" id="pr-t-${p.id}" value="${esc(p.team || '')}" aria-label="Team" style="width:130px" maxlength="60"></td>
    <td><select id="pr-m-${p.id}" aria-label="Reports to"><option value="">Nobody</option>${S.people.filter(x => x.id !== p.id && !reportsTo(x, p)).sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}"${p.mgr === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
    <td>${p.account ? `<button class="btn quiet sm" data-act="mklink" data-id="${p.id}" title="${ST.mail?.configured ? 'Email them a password reset link' : 'Make a password reset link'}">Reset link</button>` : `<button class="btn ghost sm" data-act="mklink" data-id="${p.id}" title="${ST.mail?.configured ? 'Email them an invite' : 'Make an invite link'}"${p.email ? '' : ' disabled'}>${ST.mail?.configured ? 'Send invite' : 'Invite'}</button>`}</td>
    <td><div class="row"><button class="btn sm" data-act="saveperson" data-id="${p.id}">Save</button>${p.id === ST.realId ? '' : confirmDel === p.id ? `<button class="btn bad sm" data-act="delperson" data-id="${p.id}">Confirm</button><button class="btn quiet sm" data-act="cancel">Cancel</button>` : `<button class="btn quiet sm" data-act="askdel" data-id="${p.id}">Remove</button>`}</div></td></tr>`
    : `<tr><td><div class="person-h">${avatar(p.name, true)}<div><b>${dosLink(e, p)}</b>${p.title ? `<div class="sub">${esc(p.title)}</div>` : ''}</div></div></td><td>${esc(p.email || '—')}</td><td>${p.sub ? chip(p.sub, SUB_TONE[p.sub] || '') : chip('Group-level')}</td><td>${chip(ROLES[p.role] || p.role, ROLE_TONE[p.role])}</td><td>${esc(p.team || '—')}</td><td>${esc(mgrOf(p)?.name || '—')}</td><td>${p.account ? chip('Active', 'good') : chip('Not yet')}</td><td></td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">${filtered ? 'No one matches these filters.' : 'No people yet.'}</td></tr>`}</tbody></table></div></div>`;
}

// ---------- sign-in screens ----------
const token = () => new URLSearchParams(location.search).get('token') || '';
function authCard(title, body) {
  return `<div class="authwrap"><div class="card auth"><div class="brandrow"><span class="logo" aria-hidden="true"></span><h1>Team OKR Tracker</h1></div>
    ${title ? `<h2 style="font-size:17px">${esc(title)}</h2>` : ''}${body}</div></div>`;
}
const field = (id, label, type, extra = '') => `<label class="f">${label}<input type="${type}" id="${id}" ${extra}></label>`;
function authView() {
  const err = authMsg ? `<p class="err" role="alert">${esc(authMsg)}</p>` : '';
  if (phase === 'login') return authCard('Sign in', `<form data-submit="login">${field('li-email', 'Work email', 'email', 'autocomplete="username" required')}${field('li-pass', 'Password', 'password', 'autocomplete="current-password" required')}
    ${err}<button class="btn" type="submit">Sign in</button><p class="sub" style="margin:0">New here, or forgot your password? Ask HR for a link.</p></form>`);
  if (phase === 'setup') return authCard('Create the CEO account', `<p class="sub">This link sets up the first account. Whoever uses it becomes the CEO and can then add everyone else.</p>
    <form data-submit="setup">${field('su-name', 'Your full name', 'text', 'autocomplete="name" maxlength="80" required')}${field('su-email', 'Work email', 'email', 'autocomplete="username" required')}
    ${field('su-pass', 'Password, at least 8 characters', 'password', 'autocomplete="new-password" minlength="8" required')}${err}<button class="btn" type="submit">Create account</button></form>`);
  if (phase === 'invite' || phase === 'reset') {
    if (!link) return authCard(phase === 'invite' ? 'Invite link' : 'Reset link', `${err || '<p class="sub">Checking the link…</p>'}<p class="sub" style="margin:0"><a href="/">Go to sign in</a></p>`);
    return authCard(phase === 'invite' ? `Welcome, ${link.name.split(' ')[0]}` : 'Choose a new password', `<p class="sub">${phase === 'invite' ? 'Choose a password for your account. You will sign in with ' : 'For the account '}<b>${esc(link.email)}</b>.</p>
      <form data-submit="${phase}">${field('pw1', 'Password, at least 8 characters', 'password', 'autocomplete="new-password" minlength="8" required')}${field('pw2', 'The same password again', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${err}<button class="btn" type="submit">${phase === 'invite' ? 'Create my account' : 'Save password'}</button></form>`);
  }
  if (phase === 'unlinked') return authCard('Almost there', `<p class="sub">You are signed in as <b>${esc(authMsg)}</b>, but nobody in the directory has that email yet. Ask HR to add you with it, then refresh this page.</p>
    <div class="row"><button class="btn" data-act="reload">Refresh</button><button class="btn quiet" data-act="signout">Sign out</button></div>`);
  if (phase === 'nosetup') return authCard('Not set up yet', '<p class="sub">Nobody has created the CEO account. Whoever runs the server can print a setup link with <code>npm run setup-link</code>.</p>');
  return authCard('', '<p class="sub">Loading…</p>');
}

// ---------- shell ----------
function render() {
  const root = $('#root');
  // Forms drawn from a draft read themselves back first, so a live update never throws away what was typed.
  // (Skipped straight after a row was added or removed, when the page still shows the old rows.)
  if (!draftMoved && phase === 'app' && cfgDraft && document.getElementById('cf-stale')) readCfg();
  if (!draftMoved && phase === 'app' && tdraft && document.getElementById('tn')) readTmpl();
  draftMoved = false;
  const keep = [...root.querySelectorAll('input[id]:not([type=file]):not([type=hidden]):not([readonly]),textarea[id],select[id]')].map(el => ({id: el.id, v: el.value}));
  const ae = document.activeElement, focus = ae && ae.id && root.contains(ae) ? {id: ae.id, s: ae.selectionStart, e: ae.selectionEnd} : null;
  root.innerHTML = phase === 'app' && ST ? build() : authView();
  keep.forEach(k => { const el = document.getElementById(k.id); if (el && el.value !== k.v && !/^(ok-owner|subsel|viewas|pf-sub|pf-team|pf-role|ff-.*|t[tod]-.*|ok-kt-.*|ed-kt-.*|cf-.*|ap-(from|to))$/.test(k.id)) { if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === k.v)) return; el.value = k.v; } });
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus(); try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch (_) {} } }
}
function build() {
  const real = realMe(), e = eff();
  if (!real || !e) return authCard('', '<p class="sub">Loading…</p>');
  const appr = e.role === 'manager' || e.role === 'ceo';
  const pend = appr ? pendingFor(e).length + revsFor(e).length : 0;
  const badges = {appr: pend, ci: (surveyDue(e) ? 1 : 0) + (myRevToSign(e) ? 1 : 0) + leavePending(e).length, hire: myAppr(e).length + askedRoles(e).filter(sentBack).length};
  const nav = [['dash', 'Dashboard', 'Overview'], ['lead', 'Team leaderboard', 'Overview'], ['okrs', 'OKRs', 'Goals'], ...(appr ? [['appr', 'Approvals', 'Goals']] : []),
    ['stand', 'Standup', 'Rhythm'], ['review', 'Friday Review', 'Rhythm'],
    ...(isGroup(e) || e.role === 'manager' ? [['perf', 'Performance signals', 'People']] : []), ['ci', 'Check-ins', 'People'], ...(isGroup(e) || e.role === 'manager' ? [['hire', 'Hiring and onboarding', 'People']] : []),
    ...(isGroup(e) ? [['people', 'Directory', 'People']] : [])];
  const navAll = [...nav, ...(isGroup(e) ? [['settings', 'Settings', '']] : [])];
  if (!navAll.some(t => t[0] === tab)) tab = 'dash';
  const views = {settings: viewSet, hire: viewHire, ci: viewCheck, dash: viewDash, lead: viewLead, okrs: viewOkrs, appr: viewApprovals, stand: viewStand, review: viewReview, people: viewPeople, perf: viewPerf};
  const groups = [...new Set(nav.map(n => n[2]))];
  const page = dossier ? 'Person record' : navAll.find(n => n[0] === tab)[1];
  return `<div class="app">
    <aside class="side${navOpen ? ' open' : ''}" aria-label="Sidebar">
      <div class="side-brand"><span class="logo" aria-hidden="true"></span><span>Team OKR Tracker</span></div>
      <nav aria-label="Main">${groups.map(g => `<div class="nav-lbl">${esc(g)}</div>${nav.filter(n => n[2] === g).map(([k, l]) =>
        `<button class="nav-i" data-act="tab" data-t="${k}"${tab === k && !dossier ? ' aria-current="page"' : ''}>${icon(k)}<span>${esc(l)}</span>${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('')}`).join('')}</nav>
      <div class="side-user"><div class="me">${avatar(real.name)}<div class="t"><b>${esc(real.name)}</b><span>${chip(ROLES[real.role] || real.role, ROLE_TONE[real.role])} ${esc(where(real))}</span></div></div>
        ${ST.previewing ? `<p class="real">Previewing as ${esc(e.name)}</p>` : ''}
        <button class="btn ghost sm" data-act="dossier" data-id="${e.id}">${ST.previewing ? 'Their record' : 'My record'}</button>${isGroup(e) ? `<button class="btn ghost sm" data-act="tab" data-t="settings"${tab === 'settings' ? ' aria-current="page"' : ''}>Settings</button>` : ''}<button class="btn ghost sm" data-act="signout">${icon('swap')}Sign out</button></div>
    </aside>
    <div class="scrim${navOpen ? ' on' : ''}" data-act="closenav"></div>
    <div class="mainwrap">
      <header class="topbar"><button class="iconbtn menu" data-act="menu" aria-label="Open menu">${icon('menu')}</button>
        <span class="crumb"><span class="sub">Team OKR Tracker</span><span class="sep">/</span><b>${esc(page)}</b></span>
        <span class="grow"></span>
        ${isGroup(e) ? `<label class="viewas">Subsidiary <select id="subsel" class="sm" data-chg="sub"><option value="">All</option>${subs().map(x => `<option${subFilter === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
        ${real.role === 'ceo' && ST.others.length ? `<label class="viewas">Viewing as <select id="viewas" class="sm" data-chg="viewas"><option value="">me</option>${ST.others.map(p => `<option value="${p.id}"${viewAs === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}</header>
      <main class="content">${e.role === 'hr' && !ST.previewing ? '<div class="banner info"><span>You have HR access: people, documents, review cycles, the weekly survey, settings and everyone\'s goals.</span></div>' : ''}${ST.previewing ? `<div class="banner info"><span>Previewing the app as ${esc(e.name)}: you see exactly what they see. It is read-only; switch back to "me" to make changes.</span></div>` : ''}${dossier ? viewDossier(e) : views[tab](e)}</main>
      <footer class="foot"><span>Changes save as you make them and show up for everyone straight away.</span></footer>
    </div></div>`;
}

// ---------- events ----------
const root = $('#root');
root.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id, e = eff(), i = +b.dataset.i;
  if (a === 'reload') return void refresh();
  if (a === 'signout') { api('/api/logout', {method: 'POST', json: {}}).catch(() => {}).finally(() => { if (es) { es.close(); es = null; } ST = null; viewAs = null; subFilter = ''; phase = 'login'; authMsg = ''; history.replaceState(null, '', '/'); render(); }); return; }
  if (!e) return;
  if (a === 'tab') go(b.dataset.t);
  else if (a === 'menu') navOpen = !navOpen;
  else if (a === 'closenav') navOpen = false;
  else if (a === 'wk') { const n = +b.dataset.n; if (n === 0) wk = curWeek(); else { const d = parseIso(wk); d.setDate(d.getDate() + 7 * n); const nw = iso(d); wk = nw > curWeek() ? curWeek() : nw; } }
  else if (a === 'newokr') showForm = !showForm;
  else if (a === 'krdone') act('kr.set', {id: b.dataset.o, i, done: b.dataset.v === '1'});
  else if (a === 'askdel') confirmDel = id;
  else if (a === 'cancel') confirmDel = null;
  else if (a === 'addkr') { if (draft.krs.length < 20) { draft.krs.push(''); draft.ms.push(null); draft.kt.push('binary'); draft.tg.push(''); draft.un.push(''); } }
  else if (a === 'rmkr') { if (draft.krs.length > 2) { draft.krs.splice(i, 1); draft.ms.splice(i, 1); draft.kt.splice(i, 1); draft.tg.splice(i, 1); draft.un.splice(i, 1); } }
  else if (a === 'delokr') { confirmDel = null; act('okr.delete', {id}); }
  else if (a === 'approve' || a === 'sendback') act('kr.decide', {id: b.dataset.o, i, ok: a === 'approve'});
  else if (a === 'delstand') act('stand.delete', {id});
  else if (a === 'delperson') { confirmDel = null; act('person.delete', {id}); }
  else if (a === 'saveperson') act('person.save', {id, mgr: val('pr-m-' + id) || null, email: val('pr-e-' + id).trim(), role: val('pr-r-' + id), sub: val('pr-s-' + id), team: val('pr-t-' + id).trim()});
  else if (a === 'mklink') { api(`/api/people/${id}/link`, {method: 'POST', json: {}}).then(r => { linkOut = r; render(); }).catch(err => toast(err.message)); return; }
  else if (a === 'copylink') { const el = $('#link-url'); if (el) { el.select(); (navigator.clipboard?.writeText(el.value) || Promise.reject()).then(() => toast('Link copied.')).catch(() => { try { document.execCommand('copy'); toast('Link copied.'); } catch { toast('Select the link and copy it.'); } }); } return; }
  else if (a === 'clearlink') linkOut = null;
  else if (a === 'subfilter') subFilter = b.dataset.s || '';
  else if (a === 'subappr') { subFilter = b.dataset.s; go('appr'); }
  else if (a === 'editokr') { const o = S.okrs.find(x => x.id === id); if (o) editing = {id, obj: o.objective, krs: o.krs.map((k, j) => ({src: j, title: k.title, month: k.month, type: k.type || 'binary', target: k.target ?? '', unit: k.unit || ''}))}; }
  else if (a === 'dossier') { dossier = id; navOpen = false; editing = null; empEdit = false; confirmDel = null; }
  else if (a === 'closedos') { dossier = null; empEdit = false; }
  else if (a === 'editemp') empEdit = true;
  else if (a === 'cancelemp') empEdit = false;
  else if (a === 'perftab') perfTab = b.dataset.v;
  else if (a === 'perfseg') perfSeg = b.dataset.v;
  else if (a === 'aprange') { apFrom = b.dataset.a; apTo = b.dataset.b; }
  else if (a === 'dirview') dirView = b.dataset.v;
  else if (a === 'addcfg') { const k = b.dataset.k; cfgList(k, k === 'leave' ? {type: 'New leave type', days: 0} : {subs: 'New subsidiary', etypes: 'New contract type', closeWhy: 'New reason', onbWho: 'New owner'}[k]); }
  else if (a === 'rmcfg') cfgRemove(b.dataset.k, i);
  else if (a === 'savecfg') { readCfg(); act('cfg.save', {cfg: cfgDraft.c, from: cfgDraft.from}).then(r => { if (r) { cfgDraft = null; render(); } }); return; }
  else if (a === 'discardcfg') cfgDraft = null;
  else if (a === 'resetcfg') { act('cfg.reset').then(r => { if (r) { cfgDraft = null; render(); } }); return; }
  else if (a === 'reloadmail') { loadMail(); return; }
  else if (a === 'testmail') { api('/api/mail/test', {method: 'POST', json: {}}).then(r => { toast(r.msg); loadMail(); }).catch(err => { toast(err.message); loadMail(); }); return; }
  else if (a === 'export') { exportCsv(b.dataset.x, e); return; }
  else if (a === 'pickcsv') { const el = $('#csv-in'); if (el) { el.value = ''; el.click(); } return; }
  else if (a === 'clearimp') imp = null;
  else if (a === 'pickdoc') { const el = $('#doc-file'); if (el) { el.value = ''; el.dataset.doc = id; el.click(); } return; }
  else if (a === 'deldoc') { confirmDel = null; act('doc.delete', {id}); }
  else if (a === 'sendsurvey') act('survey.send', {week: wk});
  else if (a === 'remindsurvey') act('survey.remind', {week: wk});
  else if (a === 'closesurvey' || a === 'reopensurvey') act('survey.close', {week: wk, reopen: a === 'reopensurvey'});
  else if (a === 'openrev') openRev = b.dataset.n;
  else if (a === 'cancelrev') openRev = null;
  else if (a === 'sharerev') act('review.share', {name: b.dataset.n});
  else if (a === 'newrole') { openRole = openRole === 'new' ? null : 'new'; editR = null; }
  else if (a === 'cancelrole') { openRole = null; editR = null; }
  else if (a === 'hiretab') { hireTab = b.dataset.v; tdraft = null; fillR = null; declR = null; sbR = null; closeR = null; editR = null; history.replaceState(null, '', '#hire-' + hireTab); }
  else if (a === 'newtmpl') tdraft = {id: '', name: '', sub: '', tasks: [{t: '', who: S.cfg.onbWho[0], off: 0}]};
  else if (a === 'edittmpl') { const tp = S.tmpl.find(x => x.id === id); if (tp) tdraft = {id: tp.id, name: tp.name, sub: tp.sub, tasks: tp.tasks.map(x => ({...x}))}; }
  else if (a === 'canceltmpl') tdraft = null;
  else if (a === 'addtask') { if (tdraft) { readTmpl(); tdraft.tasks.push({t: '', who: S.cfg.onbWho[0], off: 0}); draftMoved = true; } }
  else if (a === 'rmtask') { if (tdraft && tdraft.tasks.length > 1) { readTmpl(); tdraft.tasks.splice(i, 1); draftMoved = true; } }
  else if (a === 'deltmpl') act('tmpl.delete', {id}).then(r => { if (r) { tdraft = null; render(); } });
  else if (a === 'startonb') act('onb.start', {id});
  else if (a === 'onbtick') act('onb.tick', {owner: b.dataset.n, i});
  else if (a === 'holdrole' || a === 'reopenrole') { fillR = null; act('role.hold', {id, reopen: a === 'reopenrole'}); }
  else if (a === 'aprole') act('role.approve', {id}).then(r => { if (r && !S.roles.find(x => x.id === id && inAppr(x))) { hireTab = 'open'; render(); } });
  else if (a === 'declrole') { declR = declR === id ? null : id; fillR = sbR = closeR = null; }
  else if (a === 'canceldecl') declR = null;
  else if (a === 'sbrole') { sbR = sbR === id ? null : id; fillR = declR = closeR = null; }
  else if (a === 'cancelsb') sbR = null;
  else if (a === 'closerole') { closeR = closeR === id ? null : id; fillR = declR = sbR = null; }
  else if (a === 'cancelclose') closeR = null;
  else if (a === 'editrole') { editR = editR === id ? null : id; openRole = null; fillR = declR = sbR = closeR = null; }
  else if (a === 'withdrawrole') { fillR = declR = sbR = editR = null; act('role.withdraw', {id}); }
  else if (a === 'fillrole') { fillR = fillR === id ? null : id; declR = null; }
  else if (a === 'cancelfill') fillR = null;
  else if (a === 'signdoc') act('doc.sign', {id});
  else if (a === 'opencycle') cycleForm = true;
  else if (a === 'cyclecancel') cycleForm = false;
  else if (a === 'closecycle') act('cycle.close');
  else if (a === 'delleave') act('leave.withdraw', {id});
  else if (a === 'apleave' || a === 'rejleave') act('leave.decide', {id, ok: a === 'apleave'});
  else if (a === 'clearhr') act('hrnote.clear', {id: dossier});
  else if (a === 'openupd') { okrUpd = id; editing = null; }
  else if (a === 'krlog') { const key = b.dataset.o + '|' + i; krOpen = krOpen === key ? null : key; }
  else if (a === 'cancelupd') okrUpd = null;
  else if (a === 'usesugg') { const el = document.getElementById('up-kr-' + i); if (el) { el.value = b.dataset.v; el.focus(); } return; }
  else if (a === 'canceledit') editing = null;
  else if (a === 'kmove') act('okr.move', {id: b.dataset.o, i});
  else if (a === 'okrtab') { okrTab = b.dataset.v; editing = null; okrUpd = null; }
  else if (a === 'histm') { const n = +b.dataset.n, cur = histM == null ? Math.max(0, curM() - 1) : histM; histM = n === 0 ? Math.max(0, curM() - 1) : Math.max(0, Math.min(curM(), cur + n)); }
  else if (a === 'ciseg') { ciSeg = b.dataset.v; history.replaceState(null, '', '#ci-' + ciSeg); }
  else if (a === 'standwho') standWho = b.dataset.v;
  else if (a === 'revwho') revWho = b.dataset.v;
  else if (a === 'addedkr') { if (editing && editing.krs.length < 20) { const o = S.okrs.find(x => x.id === editing.id); editing.krs.push({src: null, type: 'binary', target: '', unit: '', title: '', month: o && isPersonal(o) ? curM() : undefined}); } }
  else if (a === 'rmedkr') { if (editing) editing.krs.splice(i, 1); }
  else if (a === 'cancelchange') act('okr.cancelChange', {id});
  else if (a === 'apprev' || a === 'rejrev') act('okr.decideChange', {id, ok: a === 'apprev'});
  else if (a === 'savenote') act('wnote.save', {week: wk, text: val('wn-' + wk)});
  else if (a === 'clearff') ff[b.dataset.t] = FF0()[b.dataset.t];
  else if (a === 'clearpf') { pf = {q: '', team: '', role: ''}; subFilter = ''; }
  render();
});
root.addEventListener('change', ev => {
  if (ev.target.id === 'csv-in') { const f = ev.target.files && ev.target.files[0]; if (!f) return;
    if (f.size > 500 * 1024) return toast('That file is too large. Keep it under 500 KB.');
    const r = new FileReader(); r.onload = () => act('people.import', {text: String(r.result)}).then(out => { if (out) { imp = out; render(); } }); r.onerror = () => toast('Could not read that file.'); r.readAsText(f); return; }
  if (ev.target.id === 'doc-file') { const f = ev.target.files && ev.target.files[0], id = ev.target.dataset.doc; if (!f || !id) return;
    if (f.size > 5 * 1024 * 1024) return toast('Keep files under 5 MB.');
    api(`/api/docs/${id}/file`, {method: 'PUT', body: f, headers: {'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name)}})
      .then(r => { toast(r.msg); return refresh(); }).catch(err => toast(err.message)); return; }
  const t = ev.target, k = t.dataset.chg;
  if (t.dataset.pf) { pf[t.dataset.pf] = t.value; return render(); }
  if (t.dataset.ff) { const [a, b] = t.dataset.ff.split('.'); ff[a][b] = t.value; return render(); }
  if (!k) return;
  if (k === 'viewas') { viewAs = t.value || null; draft.owner = null; dossier = null; editing = null; return void refresh(); }
  else if (k === 'sub') subFilter = t.value;
  else if (k === 'apfrom') apFrom = t.value;
  else if (k === 'apto') apTo = t.value;
  else if (k === 'owner') draft.owner = t.value;
  else if (k === 'krmonth') draft.ms[+t.dataset.i] = +t.value;
  else if (k === 'krkind') draft.kt[+t.dataset.i] = t.value;
  else if (k === 'edkind' && editing) editing.krs[+t.dataset.i].type = t.value;
  else if (k === 'edmonth' && editing) editing.krs[+t.dataset.i].month = +t.value;
  else if (k === 'stand') return void act('stand.status', {id: t.dataset.id, status: t.value});
  render();
});
root.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.pf === 'q') { pf.q = t.value; return render(); }
  if (t.dataset.ff && t.dataset.ff.endsWith('.q')) { const [a, b] = t.dataset.ff.split('.'); ff[a][b] = t.value; return render(); }
  if (t.dataset.draft === 'ed-obj' && editing) editing.obj = t.value;
  else if (t.dataset.draft === 'ed-kr' && editing) editing.krs[+t.dataset.i].title = t.value;
  else if (t.dataset.draft === 'obj') draft.obj = t.value;
  else if (t.dataset.draft === 'kr') draft.krs[+t.dataset.i] = t.value;
  else if (t.dataset.draft === 'ktg') draft.tg[+t.dataset.i] = t.value;
  else if (t.dataset.draft === 'kun') draft.un[+t.dataset.i] = t.value;
  else if (t.dataset.draft === 'edtg' && editing) editing.krs[+t.dataset.i].target = t.value;
  else if (t.dataset.draft === 'edun' && editing) editing.krs[+t.dataset.i].unit = t.value;
});
// Sign-in forms talk to the server directly; everything else is an action.
async function authSubmit(f) {
  authMsg = '';
  try {
    if (f === 'login') await api('/api/login', {method: 'POST', json: {email: val('li-email'), password: val('li-pass')}});
    else if (f === 'setup') await api('/api/setup', {method: 'POST', json: {token: token(), name: val('su-name'), email: val('su-email'), password: val('su-pass')}});
    else {
      if (val('pw1') !== val('pw2')) { authMsg = 'The two passwords don\'t match.'; return render(); }
      await api('/api/' + f, {method: 'POST', json: {token: token(), password: val('pw1')}});
    }
    history.replaceState(null, '', '/');
    phase = 'boot'; await refresh();
  } catch (err) { authMsg = err.message; render(); }
}
root.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target.dataset.submit;
  if (['login', 'setup', 'invite', 'reset'].includes(f)) return void authSubmit(f);
  const e = eff(); if (!e) return;
  if (f === 'addokr') {
    const krs = draft.krs.map((t, j) => ({title: t.trim(), month: draft.ms[j] ?? curM(), type: draft.kt[j] || 'binary', target: draft.tg[j], unit: (draft.un[j] || '').trim()})).filter(x => x.title);
    if (!draft.obj.trim() || krs.length < 2) return toast('Enter an objective and at least 2 key results.');
    if (krs.some(x => x.type !== 'binary' && !(+x.target > 0))) return toast('A measured key result needs a target above zero.');
    const owner = draft.owner;
    act('okr.add', {objective: draft.obj.trim(), owner, krs}).then(r => { if (r) { okrTab = owner.startsWith('Company') ? 'company' : owner === e.name ? 'personal' : 'team';
      draft = {owner, obj: '', krs: ['', ''], ms: [null, null], kt: ['binary', 'binary'], tg: ['', ''], un: ['', '']}; showForm = false; render(); } });
  } else if (f === 'saveedit') {
    if (!editing) return render();
    const krs = editing.krs.map(k => ({src: k.src, title: k.title.trim(), month: k.month, type: k.type || 'binary', target: k.target, unit: (k.unit || '').trim()})).filter(k => k.title);
    act('okr.edit', {id: editing.id, objective: editing.obj.trim(), krs}).then(r => { if (r) { editing = null; render(); } });
  } else if (f === 'saveupd') {
    const o = S.okrs.find(x => x.id === val('up-id')); if (!o) return;
    const values = {}; o.krs.forEach((k, i) => { const el = document.getElementById('up-kr-' + i); if (el && el.value !== '') values[i] = el.value; });
    act('okr.note', {id: o.id, text: val('up-text').trim(), values}).then(r => { if (r) { okrUpd = null; render(); } });
  } else if (f === 'savetmpl') {
    if (!tdraft) return;
    readTmpl();
    act('tmpl.save', {id: tdraft.id || undefined, name: tdraft.name, sub: tdraft.sub, tasks: tdraft.tasks}).then(r => { if (r) { tdraft = null; render(); } });
  } else if (f === 'addrole') {
    const id = val('ro-id') || undefined;
    act('role.save', {id, title: val('ro-title'), team: val('ro-team'), sub: val('ro-sub'), hm: val('ro-hm'), count: val('ro-n'), kind: val('ro-kind'), replacing: val('ro-rep'),
      etype: val('ro-et'), why: val('ro-why'), needBy: val('ro-by')})
      .then(r => { if (r) { openRole = null; editR = null; hireTab = /open/i.test(r.msg || '') && !/approval/i.test(r.msg || '') ? 'open' : 'appr'; render(); } });
  } else if (f === 'savedecl') act('role.decline', {id: val('dc-id'), why: val('dc-why')}).then(r => { if (r) { declR = null; hireTab = 'closed'; render(); } });
  else if (f === 'savesb') act('role.sendBack', {id: val('sb-id'), why: val('sb-why')}).then(r => { if (r) { sbR = null; render(); } });
  else if (f === 'saveclose') act('role.close', {id: val('cl-id'), why: val('cl-why')}).then(r => { if (r) { closeR = null; hireTab = 'closed'; render(); } });
  else if (f === 'savefill') {
    const how = val('fl-how');
    act('role.fill', {id: val('fl-id'), how, name: val('fl-name'), email: val('fl-email'), start: val('fl-start')}).then(r => { if (r) { fillR = null; if (how !== 'Internal move') hireTab = 'onb'; render(); } });
  } else if (f === 'addone') act('one.add', {id: dossier, notes: val('one-note')}).then(r => { if (r) { clear('one-note'); render(); } });
  else if (f === 'addfb') act('fb.add', {id: dossier, kind: val('fb-kind'), text: val('fb-text')}).then(r => { if (r) { clear('fb-text'); render(); } });
  else if (f === 'adddoc') act('doc.add', {id: dossier, name: val('doc-name'), type: val('doc-type'), status: val('doc-status')}).then(r => { if (r) { clear('doc-name'); render(); } });
  else if (f === 'saveself') act('review.self', {text: val('rv-self'), rating: val('rv-selfr')});
  else if (f === 'savemgr') act('review.mgr', {name: openRev, text: val('rv-mgr'), rating: val('rv-mgrr')}).then(r => { if (r) { openRev = null; render(); } });
  else if (f === 'saveack') act('review.ack', {text: val('rv-ack')});
  else if (f === 'opencycle') act('cycle.open', {name: val('cy-name'), from: val('cy-from'), to: val('cy-to'), due: val('cy-due')}).then(r => { if (r) { cycleForm = false; render(); } });
  else if (f === 'addleave') act('leave.add', {from: val('lv-from'), to: val('lv-to'), type: val('lv-type')}).then(r => { if (r) { clear('lv-from', 'lv-to'); render(); } });
  else if (f === 'savewelf') act('welfare.save', {week: wk, workload: val('wf-load'), mood: val('wf-mood'), note: val('wf-note'), enps: val('wf-enps')});
  else if (f === 'savenote-hr') act('hrnote.save', {id: dossier, action: val('hr-act'), text: val('hr-note')});
  else if (f === 'saveemp') act('person.employment', {id: dossier, title: val('em-title'), contract: val('em-contract'), notice: val('em-notice'), joined: val('em-joined'), review: val('em-review'),
      salary: val('em-salary'), jd: val('em-jd').split('\n')}).then(r => {
      if (!r) return;
      const p = S.people.find(x => x.id === dossier), nm = val('em-name').trim();
      const done = () => { empEdit = false; render(); };
      if (p && nm && nm !== p.name) act('person.save', {id: p.id, name: nm, email: p.email || '', role: p.role, sub: p.sub, team: p.team, mgr: p.mgr}).then(done); else done();
    });
  else if (f === 'addstand') {
    const t = val('su-text').trim(); if (!t) return toast('Enter an activity first.');
    act('stand.add', {text: t, n: val('su-n').trim(), unit: val('su-unit').trim(), link: val('su-kr')}).then(r => { if (r) { clear('su-text', 'su-n', 'su-unit'); render(); } });
  } else if (f === 'addperson') {
    act('person.add', {name: val('pe-name'), email: val('pe-email'), title: val('pe-title'), role: val('pe-role'), sub: val('pe-sub'), team: val('pe-team'), mgr: val('pe-mgr') || null})
      .then(r => { if (r) { clear('pe-name', 'pe-email', 'pe-team', 'pe-title'); render(); } });
  }
  render();
});

// ---------- start ----------
(async function boot() {
  const path = location.pathname;
  if (path === '/setup') { phase = 'setup'; return render(); }
  if (path === '/invite' || path === '/reset') {
    phase = path.slice(1); render();
    try { link = await api('/api/link', {method: 'POST', json: {kind: phase, token: token()}}); } catch (err) { authMsg = err.message; }
    return render();
  }
  go(location.hash.slice(1) || 'dash');
  await refresh();
})();
