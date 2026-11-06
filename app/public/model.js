// The rules of the product, shared by the server (which enforces them) and the page (which shows them).
// Lifted from the product lead's v1.1 prototype so both behave exactly as it does. Everything here reads one
// state object S: the server's S holds everything, the page's S holds only what the signed-in person may see.
// People are referred to by name throughout, as in the prototype; the server keeps names unique and carries
// a rename through every record.

export const ROLES = {ceo: 'CEO', hr: 'HR', manager: 'Manager', member: 'Member'};
export const SSTAT = ['Not done', 'In progress', 'Done'];
export const COLS = ['okrs', 'people', 'stand', 'wnotes', 'logs', 'welfare', 'leave', 'cycles', 'reviews', 'roles', 'ones', 'fb', 'docs', 'surveys', 'onb', 'tmpl'];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const KRTYPE = [['binary', 'Done or not done'], ['count', 'A number to reach'], ['monthly', 'A number to reach every month']];
export const OKRST = ['On track', 'At risk', 'Off track'];
export const OKRST_TONE = {'On track': 'good', 'At risk': 'warn', 'Off track': 'bad'};
export const OUTCOME = {delivered: ['Delivered', 'good'], moved: ['Pushed back', 'warn'], missed: ['Missed', 'bad'], open: ['Still open', '']};
export const BAND = {ok: ['On track', 'good'], watch: ['Needs a nudge', 'acc'], risk: ['At risk', 'warn'], off: ['Off track', 'bad']};
export const RTONE = {'In approval': 'warn', 'Sent back': 'amb', Open: 'good', 'On hold': 'amb', Filled: '', Declined: 'bad', Withdrawn: ''};
export const RKIND = ['New headcount', 'Replacement'];
export const DOCST = {Signed: 'good', 'Awaiting signature': 'warn', 'On file': ''};
export const FBTONE = {Praise: 'good', Improvement: 'warn'};
export const RATINGS = ['', 'Did not meet', 'Partly met', 'Met expectations', 'Exceeded', 'Outstanding'];
export const REVST = {none: ['Not started', ''], self: ['Self-review in', 'warn'], written: ['Ready to share', 'acc'],
  shared: ['Awaiting sign-off', 'warn'], ack: ['Signed off', 'good']};
export const WLOAD = ['', 'Very light', 'Light', 'Steady', 'Heavy', 'Too much'];
export const MOOD = ['', 'Struggling', 'Low', 'Okay', 'Good', 'Great'];
export const SUB_TONE = {'NativeTalk': 'sky', 'Connect': 'tea', 'Cyber Villa': 'vio'};
export const HR_ACTIONS = ['Offering support', 'Performance improvement plan', 'Ready for more responsibility'];
// Who does what, and by when, counted in days from the start date.
export const ONB_PLAN = [
  ['Send and sign the contract', 'HR', -7], ['Create the email account and logins', 'HR', -3],
  ['Order laptop and equipment', 'HR', -3], ['Share the handbook and policies', 'HR', -1],
  ['Welcome call and introductions', 'Manager', 0], ['Walk through the role and what good looks like', 'Manager', 1],
  ['Add to the team standup and Monday call', 'Manager', 1], ['Meet the people you work with most', 'New hire', 3],
  ['Complete role training', 'New hire', 10], ['Agree first OKRs with your manager', 'Manager', 14],
  ['First one to one', 'Manager', 14], ['Thirty day check-in', 'HR', 30]
];

// Section 13. Every alert, who gets it and when; HR can change the timing in Settings.
export const ALERTS = {
  krDone: ['Key result finished and awaiting approval', 'Line manager', 'now'],
  okrChange: ['OKR change request', 'Line manager', 'now'],
  krDecided: ['Key result approved or sent back', 'Owner', 'now'],
  roleStep: ['Role request at your step of the chain', 'Current approver', 'now'],
  roleRaiser: ['Role request sent back, declined or opened', 'Whoever raised it', 'now'],
  reviewShared: ['Review shared and awaiting sign-off', 'Employee', 'now'],
  reviewSigned: ['Review signed off', 'Manager and HR', 'now'],
  leaveAsked: ['Leave request awaiting approval', 'Line manager', 'now'],
  leaveDecided: ['Leave approved or declined', 'Requester', 'now'],
  checkin: ['Weekly check-in sent or reminded', 'Everyone asked', 'now'],
  onbDue: ['Onboarding task due or overdue', 'Task owner', 'digest'],
  checkinMissing: ['Weekly check-in not answered', 'Employee', 'digest'],
  fridayMissing: ['Friday review note missing', 'Employee', 'digest'],
  standupMissing: ['No standup logged this week', 'Employee', 'digest'],
  selfReviewDue: ['Self-review due date approaching', 'Employee', 'digest'],
};
export const ALERT_MODES = [['now', 'In the app and by email straight away'], ['digest', 'In the app and in the daily email'], ['off', 'In the app only']];

export const CFG0 = () => ({
  subs: ['NativeTalk', 'Connect', 'Cyber Villa'],
  leave: [{type: 'Annual leave', days: 25}, {type: 'Sick leave', days: 10}, {type: 'Compassionate leave', days: 5}, {type: 'Unpaid leave', days: 0}],
  yearStart: 0, staleDays: 14, riskAt: 80, behindAt: 60, aheadAt: 110,
  standupWeeks: 2, enpsDays: 28, reviewDueDays: 21, onbWho: ['HR', 'Manager', 'New hire'],
  cur: '₦', reqMgr: 1, reqExec: 1, execAt: 20000000,
  etypes: ['Permanent', 'Fixed term', 'Contract', 'Intern'],
  closeWhy: ['No longer needed', 'Budget cut', 'Filled another way', 'Reorganised'],
  mail: {fromName: 'Team OKR Tracker', replyTo: '', digestHour: 8, modes: Object.fromEntries(Object.entries(ALERTS).map(([k, v]) => [k, v[2]]))},
});

// ---------- dates and numbers ----------
export const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
export const parseIso = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const isIsoDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseIso(s)) === s;
export const isWeek = s => isIsoDate(s) && iso(mondayOf(parseIso(s))) === s;
export const curWeek = () => iso(mondayOf(new Date()));
export const today = () => iso(new Date());
export const shiftDay = (d, n) => { const x = parseIso(d); x.setDate(x.getDate() + n); return iso(x); };
export const workdaysBack = n => { const out = []; let d = today(); while (out.length < n) { const wd = parseIso(d).getDay(); if (wd !== 0 && wd !== 6) out.push(d); d = shiftDay(d, -1); } return out; };
export const fmt = n => String(Math.round(n * 10) / 10);
export const fn = n => Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 2});
export const r0 = n => Math.round(n);
export const curM = () => new Date().getMonth(), curY = () => new Date().getFullYear();
export const dateShort = t => new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
export const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
export const monIx = d => d.getFullYear() * 12 + d.getMonth();
export const WEEK = 7 * 86400000;
export const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- csv ----------
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// A leading = + - @ would run as a formula when the file is opened in a spreadsheet.
export const csvCell = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
export const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');

// Everything else reads one state object. getSub returns the page's subsidiary filter ('' on the server).
export function createModel({getSub = () => ''} = {}) {
  const S = {cfg: CFG0(), meta: {}};
  COLS.forEach(c => S[c] = []);
  const subFilter = () => getSub() || '';

  // ---------- who sees whom ----------
  const isGroup = p => !!p && (p.role === 'ceo' || p.role === 'hr');
  const where = p => [p.sub, p.team].filter(Boolean).join(' · ') || 'Group';
  const ownerLabel = o => o.owner === 'Company' ? (o.sub ? o.sub : 'Whole company') : o.owner;
  const cv = (o, e) => o.owner !== 'Company' || (isGroup(e) ? (!subFilter() || !o.sub || o.sub === subFilter()) : (!o.sub || o.sub === e.sub));
  const person = n => S.people.find(x => x.name === n);
  const mgrOf = p => p && p.mgr ? S.people.find(x => x.id === p.mgr) : null;
  const reportsTo = (p, m) => { let c = p, n = 0; while (c && m && n++ < 50) { if (c.mgr === m.id) return true; c = mgrOf(c); } return false; };
  const directs = p => S.people.filter(x => x.mgr === p.id).sort((a, b) => a.name.localeCompare(b.name));
  // A team is the unit around someone: a manager's own subtree, or for everyone
  // else the subtree of whoever they report to, so peers still see each other.
  const unitRoot = p => directs(p).length ? p : (mgrOf(p) || p);
  const teamNames = p => { const r = unitRoot(p), s = new Set([p.name, r.name]); S.people.forEach(x => { if (reportsTo(x, r)) s.add(x.name); }); return s; };
  // A manager's own reporting line: themselves and everyone below them, however many levels down.
  const lineNames = p => { const s = new Set([p.name]); S.people.forEach(x => { if (reportsTo(x, p)) s.add(x.name); }); return s; };
  // Members see only their own work. Managers see their reports, group-level sees all.
  function scope(p) {
    const sf = subFilter();
    return isGroup(p) ? new Set([...(sf ? [] : [p.name]), ...S.people.filter(x => !sf || x.sub === sf).map(x => x.name)])
      : p.role === 'manager' ? teamNames(p) : new Set([p.name]);
  }
  const lbScope = p => isGroup(p) ? new Set(S.people.filter(x => !subFilter() || x.sub === subFilter()).map(x => x.name)) : teamNames(p);
  const canSeeDossier = (e, p) => !!p && !!e && (isGroup(e) || (e.role === 'manager' && teamNames(e).has(p.name)) || p.name === e.name);
  const canSeePay = (e, p) => isGroup(e) || p.name === e.name;

  // ---------- progress ----------
  const gain = (n, w) => S.logs.filter(l => l.owner === n && l.week === w).reduce((s, l) => s + l.delta, 0);
  const isMonthly = k => k.type === 'monthly';
  const krMeasured = k => (k.type === 'count' || k.type === 'monthly') && +k.target > 0;
  const krFrac = (k, o, i) => (k.pct === 100 && !isMonthly(k)) ? 1 : krMeasured(k) ? Math.min(1, (o ? krCur(o, k, i) : (+k.cur || 0)) / +k.target) : 0;
  const krMeasure = (o, k, i) => `${isMonthly(k) ? MON[curM()] + ': ' : ''}${fn(krCur(o, k, i))} of ${fn(k.target)}${k.unit ? ' ' + k.unit : ''}${isMonthly(k) ? ' this month' : ''}`;
  const okrPct = o => o.krs?.length ? o.krs.reduce((t, k, i) => t + krFrac(k, o, i), 0) / o.krs.length * 100 : 0;
  const personOkrs = n => S.okrs.filter(o => o.owner === n);
  const personPct = n => { const a = personOkrs(n); return a.length ? a.reduce((s, o) => s + okrPct(o), 0) / a.length : (S.board?.[n]?.pct ?? 0); };
  const companyPct = e => { const a = S.okrs.filter(o => o.owner === 'Company' && cv(o, e)); return a.length ? a.reduce((s, o) => s + okrPct(o), 0) / a.length : null; };
  const isPersonal = o => o.owner !== 'Company';
  const overdue = (o, k) => isPersonal(o) && !isMonthly(k) && k.month != null && k.pct !== 100 && (o.year < curY() || (o.year === curY() && k.month < curM()));
  const goalMonth = () => ((curM() - S.cfg.yearStart + 12) % 12) + 1;
  const expectedPace = () => goalMonth() / 12 * 100;
  function okrExpected(o) {
    const n = o.krs?.length || 0;
    if (!n || !o.krs.some(k => k.month != null)) return expectedPace();
    const due = o.krs.filter(k => k.month == null || k.month <= curM()).length;
    return due / n * 100;
  }
  const personExpected = n => { const a = personOkrs(n); return a.length ? a.reduce((t, o) => t + okrExpected(o), 0) / a.length : expectedPace(); };
  // Status is worked out from the numbers. There is no control anywhere that sets it.
  function autoStatus(o) {
    const exp = okrExpected(o), pct = okrPct(o);
    const ratio = exp ? pct / exp * 100 : 100;
    const late = o.krs.filter(k => overdue(o, k)).length;
    if (ratio + 0.5 < S.cfg.behindAt || late > 1) return 'Off track';
    if (ratio + 0.5 < S.cfg.riskAt || late) return 'At risk';
    return 'On track';
  }
  const okrStatus = o => autoStatus(o);
  // A key result's plan is not just where it sits now: it is every month it was promised for.
  const moveLog = (k, to) => (k.month != null && to != null && to !== k.month)
    ? [...(k.moves || []), {from: k.month, to, at: Date.now()}] : (k.moves || []);
  const plannedFor = (k, m) => k.month === m || (k.moves || []).some(x => x.from === m);
  const movedOutOf = (k, m) => (k.moves || []).some(x => x.from === m) && k.month !== m;
  const doneInMonth = (k, m) => k.pct === 100 && k.apAt && new Date(k.apAt).getMonth() === m && new Date(k.apAt).getFullYear() === curY();
  // What a month actually came to: delivered, let go, or still owed.
  function monthRows(e, m) {
    const out = [];
    S.okrs.filter(o => isPersonal(o) && scope(e).has(o.owner)).forEach(o => o.krs.forEach((k, i) => {
      if (isMonthly(k)) {
        const got = achievedIn(o.id, i, m);
        if (!got && m > curM()) return;
        out.push({o, k, i, outcome: got >= k.target ? 'delivered' : m < curM() ? 'missed' : 'open', got});
        return;
      }
      if (k.month == null) return;
      const planned = plannedFor(k, m), done = doneInMonth(k, m);
      if (!planned && !done) return;
      const outcome = done ? 'delivered' : movedOutOf(k, m) ? 'moved' : (m < curM() ? 'missed' : 'open');
      out.push({o, k, i, outcome});
    }));
    return out;
  }
  const cyclesIn = (from, to) => S.cycles.filter(c => c.from <= to && c.to >= from).sort((a, b) => b.to.localeCompare(a.to));
  // Weeks in which anyone logged anything; the server sends these, since a page only holds its own scope.
  const liveWeeksAll = () => S.meta?.standWeeks || [...new Set(S.stand.map(x => x.week))];
  // One person over one window: what they delivered, what slipped, and what was said.
  // Months are compared as absolute indexes (year * 12 + month) so a window that
  // crosses a year end, which every half-year review period does, still counts.
  function appraise(name, from, to) {
    const f = parseIso(from).getTime(), t = parseIso(to).getTime() + 86399000;
    const inR = ms => ms >= f && ms <= t;
    const fromM = monIx(parseIso(from)), toM = monIx(parseIso(to)), nowM = monIx(new Date()), edgeM = Math.min(nowM, toM);
    const mine = personOkrs(name);
    let delivered = 0, missed = 0, pushed = 0, open = 0, monHit = 0, monMiss = 0;
    mine.forEach(o => o.krs.forEach((k, i) => {
      if (isMonthly(k)) {
        // A standing target is judged once for each month of the window that has been and gone.
        for (let m = Math.max(fromM, o.year * 12); m <= Math.min(edgeM, o.year * 12 + 11); m++) {
          if (achievedIn(o.id, i, m % 12, Math.floor(m / 12)) >= +k.target) monHit++; else monMiss++;
        }
        return;
      }
      if (k.pct === 100 && k.apAt && inR(k.apAt)) delivered++;
      (k.moves || []).forEach(mv => { if (inR(mv.at)) pushed++; });
      if (k.month == null || k.pct === 100) return;
      const km = o.year * 12 + k.month;
      if (km >= fromM && km <= toM) { if (km < nowM) missed++; else open++; }
    }));
    const weeks = [...new Set(S.stand.filter(x => x.owner === name).map(x => x.week))];
    const wInR = weeks.filter(wk2 => inR(parseIso(wk2).getTime()));
    // Measure against the weeks the team was actually using the tool, not every week
    // on the calendar, or anyone joining mid-year looks absent for months.
    const liveWeeks = liveWeeksAll().filter(wk2 => inR(parseIso(wk2).getTime()));
    const spanWeeks = Math.max(1, liveWeeks.length);
    const acts = S.stand.filter(x => x.owner === name && inR(parseIso(x.day || x.week).getTime()));
    // A review belongs to the period it covers, not the day it happened to be written.
    const revs = cyclesIn(from, to).map(c => { const r = S.reviews.find(x => x.owner === name && x.cycle === c.id);
      return {cycle: c.name, from: c.from, to: c.to, status: c.status, stage: revStage(r), ackAt: r && r.ack ? r.ack.at : 0, ackText: r && r.ack ? r.ack.text : '',
        self: r && r.self ? r.self.rating : null, selfText: r && r.self ? r.self.text : '',
        rating: r && r.mgr && r.mgr.rating != null ? r.mgr.rating : null, by: r && r.mgr ? r.mgr.by : '', text: r && r.mgr ? (r.mgr.text || '') : ''}; });
    const rated = revs.find(x => x.rating != null) || null;
    const fb = S.fb.filter(x => x.to === name && inR(x.at));
    const lv = S.leave.filter(x => x.owner === name && x.status === 'Approved' && inR(parseIso(x.from).getTime()));
    const wf = S.welfare.filter(x => x.owner === name && inR(parseIso(x.week).getTime()));
    const heavy = wf.filter(x => x.workload >= 4).length;
    return {name, p: person(name), delivered, missed, pushed, open, monHit, monMiss,
      standupPct: Math.min(100, wInR.length / spanWeeks * 100), spanWeeks, acts: acts.length,
      actsDone: acts.filter(x => x.status === 'Done').length,
      revs, rated, praise: fb.filter(x => x.kind === 'Praise').length, improve: fb.filter(x => x.kind === 'Improvement').length,
      leaveDays: lv.reduce((a, b) => a + b.days, 0), heavy, checkins: wf.length};
  }
  const okrUpdates = o => o.updates || [];
  const lastUpd = o => { const u = okrUpdates(o); return u.length ? u[u.length - 1] : null; };
  const staleDays = o => { const u = lastUpd(o); return u ? Math.floor((Date.now() - u.at) / 86400000) : null; };
  const isStale = o => { const d = staleDays(o); return d === null || d > S.cfg.staleDays; };
  // Only a hand-entered number can go stale; an automatic one keeps itself current.
  const krStale = (o, k, i) => krMeasured(k) && !isMonthly(k) && k.pct !== 100 && !krAuto(o, k, i) && (!k.curAt || Date.now() - k.curAt > S.cfg.staleDays * 86400000);
  const staleLabel = o => { const d = staleDays(o); return d === null ? 'never updated' : d === 0 ? 'updated today' : d === 1 ? 'updated yesterday' : 'updated ' + d + ' days ago'; };
  const krRef = x => { if (!x.okr) return null; const o = S.okrs.find(y => y.id === x.okr); const k = o && o.krs[x.kr]; return k ? {o, k} : null; };
  // SU-2: the picker lists only the signed-in person's own key results.
  const krOpts = n => S.okrs.filter(o => o.owner === n).flatMap(o => o.krs.map((k, i) => ({v: o.id + '|' + i, l: k.title, g: o.objective})));
  const activityOn = (oid, ki) => S.stand.filter(x => x.okr === oid && x.kr === ki).sort((a, b) => (b.day || b.week).localeCompare(a.day || a.week) || (b.ts || 0) - (a.ts || 0));
  const loggedTotal = (oid, ki) => activityOn(oid, ki).filter(x => x.status === 'Done' && x.n != null).reduce((t, x) => t + (+x.n || 0), 0);
  const hasLog = (oid, ki) => activityOn(oid, ki).some(x => x.n != null);
  const latestLogged = (oid, ki) => { const d = activityOn(oid, ki).filter(x => x.status === 'Done' && x.n != null); return d.length ? +d[0].n : null; };
  const pendingTotal = (oid, ki) => activityOn(oid, ki).filter(x => x.status !== 'Done' && x.n != null).reduce((t, x) => t + (+x.n || 0), 0);
  const inMonth = (x, m, y) => { const d = parseIso(x.day || x.week); return d.getMonth() === m && d.getFullYear() === (y ?? curY()); };
  const achievedIn = (oid, ki, m, y) => activityOn(oid, ki).filter(x => x.status === 'Done' && x.n != null && inMonth(x, m, y)).reduce((t, x) => t + (+x.n || 0), 0);
  // A standing target always reads from the log: it resets every month, so there is
  // nothing sensible for a person to type in and nothing to carry over.
  const krAuto = (o, k, i) => isMonthly(k) || (k.type === 'count' && hasLog(o.id, i) && k.curManual == null);
  const krCur = (o, k, i) => isMonthly(k) ? achievedIn(o.id, i, curM()) : krAuto(o, k, i) ? loggedTotal(o.id, i) : (k.curManual != null ? +k.curManual : (+k.cur || 0));
  const krState = k => k.pct === 100 ? 'approved' : k.req ? 'awaiting' : 'open';

  // ---------- workforce analytics ----------
  const pastWeeks = n => Array.from({length: n}, (_, i) => { const d = parseIso(curWeek()); d.setDate(d.getDate() - 7 * i); return iso(d); });
  const standupRate = n => { const ws = pastWeeks(4); return ws.filter(w => S.stand.some(x => x.owner === n && x.week === w)).length / ws.length * 100; };
  const overdueFor = n => S.okrs.filter(o => o.owner === n).reduce((t, o) => t + o.krs.filter(k => overdue(o, k)).length, 0);
  const approvedFor = n => S.okrs.filter(o => o.owner === n).reduce((t, o) => t + o.krs.filter(k => k.pct === 100).length, 0);
  const krCount = n => S.okrs.filter(o => o.owner === n).reduce((t, o) => t + o.krs.length, 0);
  const STEM = t => String(t).toLowerCase().match(/[a-z]{5,}/g) || [];
  function jdCoverage(n) {
    const p = person(n); if (!p || !p.jd) return [];
    const mine = S.okrs.filter(o => o.owner === n);
    return p.jd.map(d => { const words = new Set(STEM(d).map(w => w.replace(/s$/, '')));
      const hit = mine.find(o => [o.objective, ...o.krs.map(k => k.title)].some(t => STEM(t).some(w => words.has(w.replace(/s$/, '')))));
      return {d, okr: hit ? hit.objective : null}; });
  }
  const lastRating = n => { const done = S.reviews.filter(r => r.owner === n && r.mgr && r.mgr.rating != null).map(r => ({r, c: S.cycles.find(c => c.id === r.cycle)}))
    .filter(x => x.c).sort((a, b) => b.r.mgr.at - a.r.mgr.at); return done.length ? {rating: done[0].r.mgr.rating, cycle: done[0].c.name, by: done[0].r.mgr.by} : null; };
  function risk(n) {
    const p = person(n); if (!p || isGroup(p)) return null;
    const mine = personOkrs(n), pct = personPct(n), exp = personExpected(n), sr = standupRate(n), od = overdueFor(n);
    const off = mine.filter(o => okrStatus(o) === 'Off track'), atRisk = mine.filter(o => okrStatus(o) === 'At risk');
    const stale = mine.filter(isStale);
    const said = [], chase = [];
    off.forEach(o => said.push(`"${o.objective}" is off track`));
    atRisk.forEach(o => said.push(`"${o.objective}" is at risk`));
    if (!mine.length) chase.push('No OKRs set yet');
    stale.forEach(o => chase.push(`No note on "${o.objective}" since it was ${staleLabel(o)}`));
    if (sr / 25 < S.cfg.standupWeeks) chase.push(`Logged a standup in ${r0(sr / 25)} of the last 4 weeks`);
    if (od) chase.push(plural(od, 'key result is', 'key results are') + ' past their due month');
    const numStale = mine.reduce((t, o) => t + o.krs.filter((k, i) => krStale(o, k, i)).length, 0);
    if (numStale) chase.push(plural(numStale, 'measured key result has', 'measured key results have') + ' not moved in over ' + S.cfg.staleDays + ' days');
    mine.forEach(o => o.krs.forEach((k, i) => { if (k.type !== 'count' || k.pct === 100 || k.curManual == null) return;
      const lt = loggedTotal(o.id, i);
      if (lt > +k.curManual) chase.push(`Standup log adds up to ${fn(lt)} on "${k.title}" but the number was set by hand to ${fn(+k.curManual)}`);
    }));
    // WB-2: a heavy workload for several weeks running surfaces here.
    const heavyRun = pastWeeks(3).map(w => welfareOf(n, w)).filter(Boolean);
    if (heavyRun.length >= 2 && heavyRun.slice(0, 2).every(x => x.workload >= 4)) chase.push('Reported a heavy workload two weeks running');
    const band = off.length ? 'off' : atRisk.length ? 'risk' : (chase.length ? 'watch' : 'ok');
    return {n, p, pct, exp, sr, od, said, chase, flags: [...said, ...chase], stale: stale.length, numStale, noOkrs: !mine.length,
      rating: lastRating(n), ix: exp ? pct / exp * 100 : 0, band};
  }
  const isAhead = r => r.ix >= S.cfg.aheadAt || (r.pct >= 100 && goalMonth() < 12);

  // ---------- onboarding ----------
  const tmplFor = sub => S.tmpl.find(x => x.sub === sub) || S.tmpl.find(x => !x.sub) || {name: 'Default', tasks: ONB_PLAN.map(([t, who, off]) => ({t, who, off}))};
  const onbFor = n => S.onb.find(x => x.owner === n) || null;
  const onbPct = o => o && o.tasks.length ? o.tasks.filter(t => t.done).length / o.tasks.length * 100 : 0;
  const onbDue = (o, t) => { const d = parseIso(o.start); d.setDate(d.getDate() + t.off); return d; };
  const onbLate = (o, t) => !t.done && onbDue(o, t) < new Date();
  const onbActive = () => S.onb.filter(o => onbPct(o) < 100).sort((a, b) => a.start.localeCompare(b.start));
  const newOnb = (name, start, sub) => ({id: uuid(), owner: name, start, sub: sub || '', from: (tmplFor(sub).name || 'Default'), tasks: tmplFor(sub).tasks.map(t => ({...t, done: false, by: '', at: 0}))});
  // ON-2: a task can be ticked only by its owner: the starter, their manager, or HR.
  const onbCanTick = (e, o, t) => { const p = person(o.owner);
    if (t.who === 'New hire') return o.owner === e.name;
    if (t.who === 'Manager') return !!(p && mgrOf(p) && mgrOf(p).id === e.id) || e.role === 'ceo';
    return isGroup(e);
  };
  // Whose a task is, by name: used for the daily email.
  const onbOwners = (o, t) => { const p = person(o.owner);
    if (t.who === 'New hire') return [o.owner];
    if (t.who === 'Manager') { const m = p && mgrOf(p); return m ? [m.name] : S.people.filter(x => x.role === 'ceo').map(x => x.name); }
    return S.people.filter(x => x.role === 'hr').map(x => x.name);
  };

  // ---------- hiring ----------
  const money = n => +n ? S.cfg.cur + fn(n) : '';
  const payBand = r => (+r.payMin || +r.payMax) ? money(r.payMin) + ' to ' + money(r.payMax) + ' a year' : '';
  const hiresOf = r => r.hires || [];
  const closedOf = r => r.closed || [];
  const openings = r => Math.max(1, +r.count || 1);
  const toFill = r => Math.max(0, openings(r) - hiresOf(r).length - closedOf(r).length);
  const annualCost = r => (+r.payMax || 0) * openings(r);
  const roleLive = r => r.status === 'Open';
  const inAppr = r => r.status === 'In approval';
  const sentBack = r => r.status === 'Sent back';
  const roleShut = r => ['Filled', 'Declined', 'Withdrawn'].includes(r.status);
  const canRole = (e, r) => isGroup(e) || r.hm === e.name || r.reqBy === e.name;
  const raisedBy = (e, r) => r.reqBy === e.name;
  // A reference anyone can quote in a conversation, a contract or an invoice.
  const reqRef = () => { const y = curY(), used = new Set(S.roles.map(r => r.ref)); let n = S.roles.filter(r => (r.ref || '').startsWith('REQ-' + y)).length + 1;
    while (used.has(`REQ-${y}-${String(n).padStart(3, '0')}`)) n++; return `REQ-${y}-${String(n).padStart(3, '0')}`; };
  const hrAny = () => (S.people.find(p => p.role === 'hr') || {}).name || '';
  const chainOf = r => r.chain || [];
  const stepNow = r => chainOf(r).find(x => x.state === 'Pending') || null;
  const stepNo = r => chainOf(r).findIndex(x => x.state === 'Pending') + 1;
  const canStep = (e, st) => !!st && !!e && (st.role === 'HR' ? e.role === 'hr' : st.who === e.name);
  const stepLabel = st => st ? (st.role === 'HR' ? 'HR' : st.who + ' (' + st.role.toLowerCase() + ')') : '';
  // Line manager, then HR, then exec sign-off when the role is outside the plan or
  // costs more than the threshold. All three are policy, set in Settings.
  function chainFor(name, budgeted, cost) {
    const p = person(name), out = [], m = p && mgrOf(p);
    if (S.cfg.reqMgr && m) out.push({role: 'Line manager', who: m.name});
    out.push({role: 'HR', who: ''});
    const boss = S.people.find(x => x.role === 'ceo');
    if (S.cfg.reqExec && boss && (!budgeted || cost >= S.cfg.execAt)) out.push({role: 'Exec sign-off', who: boss.name});
    const seen = new Set();
    return out.filter(st => { const k = st.role === 'HR' ? 'HR' : st.who; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(st => ({...st, state: 'Pending', at: 0, note: ''}));
  }
  const logReq = (r, who, what, note) => { r.log = [...(r.log || []), {at: Date.now(), who, what, note: note || ''}]; };
  // Nobody approves their own request: a step the raiser sits on clears itself.
  function settleOwn(r, who) { const p = person(who);
    chainOf(r).forEach(st => { if (st.state !== 'Pending') return;
      if (st.who === who || (st.role === 'HR' && p && p.role === 'hr')) {
        Object.assign(st, {state: 'Approved', who: st.who || who, at: Date.now(), note: 'Raised the request, so this step cleared itself.'});
        logReq(r, who, st.role + ' step cleared itself', 'They raised the request, so they do not approve it.'); } }); }
  function openReq(r, by) {
    Object.assign(r, {status: 'Open', opened: today(), apBy: by, apAt: Date.now(), recruiter: r.recruiter || hrAny()});
    logReq(r, by, 'Opened for hiring', plural(openings(r), 'opening', 'openings'));
  }
  const openRolesAll = () => S.roles.filter(r => !subFilter() || r.sub === subFilter());
  const myAppr = e => openRolesAll().filter(r => inAppr(r) && canStep(e, stepNow(r)));
  const roleVisible = (e, r) => isGroup(e) || r.hm === e.name || r.reqBy === e.name || r.recruiter === e.name || chainOf(r).some(st => st.who === e.name);
  const openRoles = e => S.roles.filter(r => (!subFilter() || r.sub === subFilter()) && roleVisible(e, r));
  const askedRoles = e => openRoles(e).filter(r => raisedBy(e, r) && (inAppr(r) || sentBack(r)));
  const apprDays = r => r.apAt && r.reqAt ? Math.max(0, Math.floor((r.apAt - r.reqAt) / 86400000)) : null;
  const avgNum = a => a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length) : null;
  const daysOpen = r => { if (!r.opened) return 0;
    const end = r.status === 'Filled' && r.filledAt ? r.filledAt : Date.now();
    return Math.max(0, Math.floor((end - parseIso(r.opened).getTime()) / 86400000)); };

  // ---------- person records ----------
  const docsFor = n => S.docs.filter(d => d.owner === n).sort((a, b) => b.at - a.at);
  const onesFor = (a, b) => S.ones.filter(x => (x.owner === a && x.with === b) || (x.owner === b && x.with === a)).sort((x, y) => y.at - x.at);
  const fbFor = n => S.fb.filter(x => x.to === n).sort((a, b) => b.at - a.at);
  const dueReview = p => p.review && new Date(p.review) - Date.now() < 45 * 86400000;

  // ---------- wellbeing ----------
  const surveyFor = w => S.surveys.find(x => x.week === w) || null;
  const recipients = () => S.people.slice();
  const welfareOf = (n, w) => S.welfare.find(x => x.owner === n && x.week === w);
  const responded = w => recipients().filter(p => welfareOf(p.name, w));
  const outstanding = w => recipients().filter(p => !welfareOf(p.name, w));
  const surveyDue = e => { const sv = surveyFor(curWeek()); return !!sv && !sv.closed && !welfareOf(e.name, curWeek()); };
  const enpsAsked = n => S.welfare.some(x => x.owner === n && x.enps != null && Date.now() - x.ts < S.cfg.enpsDays * 86400000);
  const enpsOf = n => { const w = S.welfare.filter(x => x.owner === n && x.enps != null).sort((a, b) => b.ts - a.ts); return w.length ? w[0].enps : null; };
  function enpsScore(names) {
    const v = names.map(enpsOf).filter(x => x != null); if (!v.length) return null;
    const pro = v.filter(x => x >= 9).length, det = v.filter(x => x <= 6).length;
    return {score: Math.round((pro - det) / v.length * 100), n: v.length, pro, det};
  }
  function welfareFlag(n) {
    const ws = pastWeeks(3).map(w => welfareOf(n, w)).filter(Boolean);
    if (ws.length >= 2 && ws.slice(0, 2).every(x => x.workload >= 4)) return 'Heavy workload two weeks running';
    if (ws[0] && ws[0].mood <= 2) return 'Low wellbeing score this week';
    if (!ws.length) return 'No check-in in the last 3 weeks';
    return '';
  }

  // ---------- review cycle ----------
  const liveCycle = () => S.cycles.find(c => c.status === 'Open') || null;
  const revOf = (cid, n) => S.reviews.find(r => r.cycle === cid && r.owner === n);
  // The manager writes it, releases it, and the person signs it off. Nothing reaches
  // the employee until the manager shares it, so the conversation comes first.
  const revStage = r => !r ? 'none' : r.ack ? 'ack' : r.shared ? 'shared' : r.mgr ? 'written' : r.self ? 'self' : 'none';
  const revDone = r => revStage(r) === 'ack';
  const revSeen = r => !!(r && (r.shared || r.ack));
  const myRevToSign = e => { const c = liveCycle(), r = c && revOf(c.id, e.name); return r && r.shared && !r.ack ? r : null; };
  const revDue = c => c ? Math.ceil((parseIso(c.due) - Date.now()) / 86400000) : 0;

  // ---------- leave ----------
  const leaveFor = n => S.leave.filter(x => x.owner === n).sort((a, b) => b.from.localeCompare(a.from));
  const leaveAllow = ty => (S.cfg.leave.find(x => x.type === ty) || {days: 0}).days;
  const leaveTaken = (n, ty) => leaveFor(n).filter(x => x.status === 'Approved' && x.from.slice(0, 4) === String(curY()) && (!ty || x.type === ty)).reduce((t, x) => t + x.days, 0);
  const leaveBal = (n, ty) => leaveAllow(ty || S.cfg.leave[0].type) - leaveTaken(n, ty || S.cfg.leave[0].type);
  // WB-3: approval follows the reporting line; HR and the CEO can approve anyone's.
  const canDecideLeave = (e, l) => { const p = person(l.owner); return !!p && l.owner !== e.name && (isGroup(e) || reportsTo(p, e)); };
  const leavePending = e => S.leave.filter(x => x.status === 'Requested' && canDecideLeave(e, x));

  // ---------- goals: who may do what ----------
  // AP-1: the approver is the owner's line manager; the CEO can approve anyone but themselves.
  function canApprove(e, o) {
    if (!e || o.owner === 'Company') return false;
    if (e.role === 'ceo') return o.owner !== e.name;
    if (e.role !== 'manager') return false;
    const p = person(o.owner);
    return !!(p && p.name !== e.name && p.mgr === e.id);
  }
  // Changes apply straight away for the CEO, the owner's approver, and group level on company goals.
  const editDirect = (e, o) => e.role === 'ceo' || canApprove(e, o) || (isGroup(e) && o.owner === 'Company');
  const canEditOkr = (e, o) => isGroup(e) || editDirect(e, o) || o.owner === e.name;
  const canDeleteOkr = (e, o) => e.role === 'ceo' || (e.role === 'manager' && (o.owner === e.name || canApprove(e, o)));
  const canMarkKr = (e, o) => o.owner === 'Company' ? e.role === 'ceo' : o.owner === e.name;
  const revsFor = e => S.okrs.filter(o => o.rev && canApprove(e, o) && (e.role !== 'ceo' || !subFilter() || person(o.owner)?.sub === subFilter()));
  const approverOf = o => { const m = mgrOf(person(o.owner)); return m ? m.name : 'the CEO'; };
  // Who is asked to approve: the line manager, or every CEO when there is none.
  const approversFor = name => { const m = mgrOf(person(name)); return m ? [m.name] : S.people.filter(x => x.role === 'ceo' && x.name !== name).map(x => x.name); };
  const applyRev = (o, r) => { o.krs = r.krs.map(k => k.src != null ? {...o.krs[k.src], moves: moveLog(o.krs[k.src], k.month), title: k.title, month: k.month, type: k.type, target: k.type === 'binary' ? 0 : +k.target, unit: k.unit} : {title: k.title, pct: 0, req: false, reqAt: 0, apBy: '', month: k.month, type: k.type, target: k.type === 'binary' ? 0 : +k.target, unit: k.unit, cur: 0}); o.objective = r.objective; };
  function pendingFor(e) {
    const out = [];
    S.okrs.forEach(o => (o.krs || []).forEach((k, i) => { if (k.req && k.pct !== 100 && canApprove(e, o) && (e.role !== 'ceo' || !subFilter() || person(o.owner)?.sub === subFilter())) out.push({o, k, i}); }));
    return out.sort((a, b) => (a.k.reqAt || 0) - (b.k.reqAt || 0));
  }
  function ownerOptions(e) {
    if (e.role === 'ceo') return ['Company', ...S.cfg.subs.map(x => 'Company:' + x), ...S.people.map(p => p.name).filter(n => n !== e.name), e.name].filter((v, i, a) => a.indexOf(v) === i);
    if (e.role === 'manager') return [e.name, ...[...lineNames(e)].filter(n => n !== e.name)];
    if (e.role === 'hr') return [e.name, ...S.people.map(p => p.name).filter(n => n !== e.name)];
    return [];
  }
  const logGain = (o, delta) => { const n = personOkrs(o.owner).length || 1; S.logs.push({id: uuid(), owner: o.owner, week: curWeek(), delta: delta / o.krs.length / n, okr: o.id, ts: Date.now()}); };

  // ---------- what needs this person (NT-1); also what the daily email is built from ----------
  const fridayDue = (e, w = curWeek()) => new Date().getDay() === 5 && w === curWeek() && !S.wnotes.some(n => n.week === w && n.owner === e.name && n.text);
  function attentionFor(e) {
    const out = [], add = (kind, text, tab, btn) => out.push({kind, text, tab, btn});
    const hr = e.role === 'hr', appr = e.role === 'manager' || e.role === 'ceo';
    const myOkrs = personOkrs(e.name), mine = S.stand.filter(x => x.week === curWeek() && x.owner === e.name);
    const awaiting = myOkrs.reduce((s, o) => s + o.krs.filter(k => k.req && k.pct !== 100).length, 0);
    const kr = appr ? pendingFor(e).length : 0, revN = appr ? revsFor(e).length : 0;
    if (kr) add('krDone', `${plural(kr, 'key result is', 'key results are')} waiting for your approval.`, 'appr', 'Review');
    if (revN) add('okrChange', `${plural(revN, 'OKR change is', 'OKR changes are')} waiting for your approval.`, 'appr', 'Review');
    const lv = leavePending(e).length;
    if (lv) add('leaveAsked', `${plural(lv, 'leave request is', 'leave requests are')} waiting for your decision.`, 'ci-leave', 'Decide');
    const myOnb = onbFor(e.name);
    if (myOnb && onbPct(myOnb) < 100) { const n = myOnb.tasks.filter(t => t.who === 'New hire' && !t.done).length;
      if (n) add('onbDue', plural(n, 'onboarding task is', 'onboarding tasks are') + ' waiting for you.', 'hire-onb', 'Open checklist'); }
    const theirs = onbActive().filter(o => o.owner !== e.name).reduce((t, o) => t + o.tasks.filter(t2 => !t2.done && t2.who !== 'New hire' && onbOwners(o, t2).includes(e.name) && onbDue(o, t2) <= new Date(Date.now() + 2 * 86400000)).length, 0);
    if (theirs) add('onbDue', plural(theirs, 'onboarding task for a new starter is', 'onboarding tasks for new starters are') + ' due or overdue.', 'hire-onb', 'Open checklists');
    const onMe = myAppr(e), askedMine = askedRoles(e), backToMe = askedMine.filter(sentBack);
    if (onMe.length) add('roleStep', `${plural(onMe.length, 'role request is', 'role requests are')} at your step of the approval chain.`, 'hire-appr', 'Approve');
    if (backToMe.length) add('roleRaiser', `${plural(backToMe.length, 'role request was', 'role requests were')} sent back to you to fix: ${backToMe.map(r => r.title).join(', ')}.`, 'hire-appr', 'Fix it');
    const stillUp = askedMine.filter(inAppr);
    if (stillUp.length) add('', `${plural(stillUp.length, 'role you asked for is', 'roles you asked for are')} still in approval, with ${[...new Set(stillUp.map(r => stepLabel(stepNow(r))))].join(' and ')}.`, 'hire-appr', 'View');
    const toSeat = openRoles(e).filter(r => roleLive(r) && (isGroup(e) || r.hm === e.name)).reduce((t, r) => t + toFill(r), 0);
    if (toSeat) add('', `${plural(toSeat, 'opening is', 'openings are')} still to fill. Mark a role filled once you have hired.`, 'hire', 'Open roles');
    if (myRevToSign(e)) add('reviewShared', 'Your review has been shared with you. Read it and sign it off.', 'ci-rev', 'Open review');
    const c = liveCycle(), mineRev = c && revOf(c.id, e.name);
    if (c && !hr && !(mineRev && mineRev.self)) { const d = revDue(c);
      add('selfReviewDue', d > 0 ? `Your self-review for ${c.name} is due in ${plural(d, 'day', 'days')}.` : `Your self-review for ${c.name} was due ${c.due}.`, 'ci-rev', 'Write it'); }
    if (surveyDue(e)) add('checkinMissing', 'Your weekly check-in is waiting.', 'ci', 'Fill it in');
    if (fridayDue(e)) add('fridayMissing', 'Add your Friday comments on blockers and wins.', 'review', 'Open review');
    if (!hr && !mine.length) add('standupMissing', 'No standup entries for this week.', 'stand', 'Add activity');
    if (!hr && !myOkrs.length) add('', e.role === 'member' ? 'You have no OKRs yet. Your line manager sets them.' : 'You have no OKRs yet.', e.role === 'member' ? '' : 'okrs', e.role === 'member' ? '' : 'Add OKR');
    if (awaiting) add('', `${plural(awaiting, 'of your key results is', 'of your key results are')} awaiting approval.`, '', '');
    if (isGroup(e)) { const sig = S.docs.filter(d => d.status === 'Awaiting signature').length;
      if (sig && hr) add('', `${plural(sig, 'document is', 'documents are')} waiting for a signature across the group.`, 'people', 'Directory'); }
    return out;
  }

  return {
    S, isGroup, where, ownerLabel, cv, person, mgrOf, reportsTo, directs, unitRoot, teamNames, lineNames, scope, lbScope, canSeeDossier, canSeePay,
    gain, isMonthly, krMeasured, krFrac, krMeasure, okrPct, personOkrs, personPct, companyPct, isPersonal, overdue, goalMonth, expectedPace,
    okrExpected, personExpected, autoStatus, okrStatus, moveLog, plannedFor, movedOutOf, doneInMonth, monthRows, cyclesIn, appraise,
    okrUpdates, lastUpd, staleDays, isStale, krStale, staleLabel, krRef, krOpts, activityOn, loggedTotal, hasLog, latestLogged, pendingTotal,
    inMonth, achievedIn, krAuto, krCur, krState, pastWeeks, standupRate, overdueFor, approvedFor, krCount, jdCoverage, lastRating, risk, isAhead,
    tmplFor, onbFor, onbPct, onbDue, onbLate, onbActive, newOnb, onbCanTick, onbOwners,
    money, payBand, hiresOf, closedOf, openings, toFill, annualCost, roleLive, inAppr, sentBack, roleShut, canRole, raisedBy, reqRef, hrAny,
    chainOf, stepNow, stepNo, canStep, stepLabel, chainFor, logReq, settleOwn, openReq, openRolesAll, myAppr, roleVisible, openRoles, askedRoles,
    apprDays, avgNum, daysOpen, docsFor, onesFor, fbFor, dueReview,
    surveyFor, recipients, welfareOf, responded, outstanding, surveyDue, enpsAsked, enpsOf, enpsScore, welfareFlag,
    liveCycle, revOf, revStage, revDone, revSeen, myRevToSign, revDue,
    leaveFor, leaveAllow, leaveTaken, leaveBal, canDecideLeave, leavePending,
    canApprove, editDirect, canEditOkr, canDeleteOkr, canMarkKr, revsFor, approverOf, approversFor, applyRev, pendingFor, ownerOptions, logGain,
    fridayDue, attentionFor,
  };
}
