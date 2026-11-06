// Every change anyone can make, as a named action the server runs against its own copy of the data.
// The page calls these by name; nothing it sends is trusted. Each action re-checks who may do it, using the
// same rules the page uses to decide which buttons to show (public/model.js), so the two cannot drift apart.
import {ROLES, SSTAT, KRTYPE, RKIND, HR_ACTIONS, ALERTS, ALERT_MODES, EMAIL_RE, CFG0, uuid, today, curWeek, curM, curY,
  parseIso, isIsoDate, isWeek, plural, parseCsv} from '../public/model.js';

export class Refusal extends Error {}
const no = msg => { throw new Refusal(msg); };

// ---------- input checks ----------
function str(v, max, label, required = true) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) no(`${label} is required.`);
  if (s.length > max) no(`${label} is too long. Keep it under ${max} characters.`);
  return s;
}
const int = (v, lo, hi, label) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) no(`${label} must be a whole number from ${lo} to ${hi}.`); return n; };
const num = (v, lo, hi, label) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n) || n < lo || n > hi) no(`${label} must be a number from ${lo} to ${hi}.`); return n; };
const oneOf = (v, list, label) => list.includes(v) ? v : no(`Choose a valid ${label}.`);
const email = (v, required) => { const s = str(v, 200, 'Email', required).toLowerCase(); if (s && !EMAIL_RE.test(s)) no('Enter a valid email address.'); return s; };
const date = (v, label, required = true) => { const s = str(v, 10, label, required); if (s && !isIsoDate(s)) no(`${label} is not a valid date.`); return s; };
const arr = v => Array.isArray(v) ? v : [];

export function createActions(M, hooks) {
  const {S} = M;
  const now = () => Date.now();
  const notify = (kind, names, msg) => hooks.notify(kind, [...new Set(names.filter(Boolean))], msg);
  const hrNames = () => S.people.filter(p => p.role === 'hr').map(p => p.name);

  // ---------- lookups that refuse when the thing is gone ----------
  const find = (col, id, what) => S[col].find(x => x.id === id) || no(`That ${what} no longer exists. Refresh the page.`);
  const okr = id => find('okrs', id, 'OKR');
  const kr = (o, i) => o.krs[Number(i)] || no('That key result no longer exists. Refresh the page.');
  const personById = id => find('people', id, 'person');
  const personByName = n => M.person(n) || no(`${n || 'That person'} is not in the directory.`);
  const group = e => M.isGroup(e) || no('Only HR and the CEO can do that.');

  // A name is a key into every record, so it must be unique, and must not collide with someone who has left.
  const nameInRecords = n => S.okrs.some(o => o.owner === n) || S.stand.some(x => x.owner === n) || S.reviews.some(x => x.owner === n)
    || S.leave.some(x => x.owner === n) || S.welfare.some(x => x.owner === n) || S.docs.some(x => x.owner === n) || S.onb.some(x => x.owner === n);
  function freshName(v, exceptId) {
    const name = str(v, 80, 'Name');
    if (name === 'Company' || /^Company:/.test(name)) no('Choose a different name.');
    const clash = S.people.find(p => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
    if (clash) no(`Someone called ${clash.name} is already in the directory. Add a last name or initial to tell them apart.`);
    if (!exceptId && nameInRecords(name)) no(`${name} appears in past records from someone who has left. Add a last name or initial so the two stay apart.`);
    return name;
  }
  function freshEmail(v, exceptId, required = false) {
    const em = email(v, required);
    if (em && S.people.some(p => p.id !== exceptId && (p.email || '').toLowerCase() === em)) no('That email is already in use.');
    return em;
  }
  // Someone's name changed: carry it through every record that refers to them.
  function renamePerson(old, nu) {
    const sw = v => v === old ? nu : v;
    S.okrs.forEach(o => { o.owner = sw(o.owner); o.krs.forEach(k => { k.apBy = sw(k.apBy); }); (o.updates || []).forEach(u => { u.by = sw(u.by); }); if (o.rev) o.rev.by = sw(o.rev.by); });
    ['stand', 'wnotes', 'logs', 'welfare', 'reviews', 'docs', 'onb'].forEach(c => S[c].forEach(x => { x.owner = sw(x.owner); }));
    S.leave.forEach(x => { x.owner = sw(x.owner); x.by = sw(x.by); x.apBy = sw(x.apBy); });
    S.reviews.forEach(x => { if (x.mgr) x.mgr.by = sw(x.mgr.by); if (x.shared) x.shared.by = sw(x.shared.by); });
    S.roles.forEach(r => { ['hm', 'reqBy', 'recruiter', 'apBy', 'replacing'].forEach(f => { r[f] = sw(r[f]); });
      (r.chain || []).forEach(st => { st.who = sw(st.who); }); (r.log || []).forEach(l => { l.who = sw(l.who); });
      (r.hires || []).forEach(h => { h.name = sw(h.name); h.by = sw(h.by); }); (r.closed || []).forEach(c => { c.by = sw(c.by); }); });
    S.ones.forEach(x => { x.owner = sw(x.owner); x.with = sw(x.with); });
    S.fb.forEach(x => { x.to = sw(x.to); x.from = sw(x.from); });
    S.surveys.forEach(x => { x.sentBy = sw(x.sentBy); });
    S.onb.forEach(o => o.tasks.forEach(t => { t.by = sw(t.by); }));
    S.people.forEach(p => { if (p.hrnote) p.hrnote.by = sw(p.hrnote.by); });
  }
  // Reporting lines must not loop: nobody can report to themselves or to someone below them.
  function checkMgr(p, mgrId) {
    if (!mgrId) return null;
    const m = S.people.find(x => x.id === mgrId) || no('Choose who they report to from the list.');
    if (p && (m.id === p.id || M.reportsTo(m, p))) no(`${m.name} reports to ${p.name}, so ${p.name} cannot report to them.`);
    return m.id;
  }
  const ceos = () => S.people.filter(p => p.role === 'ceo');

  // ---------- goals ----------
  function readKrs(list, personal) {
    const krs = arr(list).map(k => ({src: k.src == null || k.src === '' ? null : Number(k.src), title: str(k.title, 200, 'Each key result', false),
      type: k.type || 'binary', target: k.target, unit: str(k.unit, 40, 'A unit', false), month: k.month})).filter(k => k.title);
    if (krs.length < 2) no('Enter an objective and at least 2 key results.');
    if (krs.length > 20) no('An OKR can have at most 20 key results.');
    krs.forEach(k => {
      oneOf(k.type, KRTYPE.map(x => x[0]), 'way to measure it');
      if (k.type !== 'binary') { if (!(+k.target > 0)) no('A measured key result needs a target above zero.'); k.target = num(k.target, 0, 1e12, 'A target'); } else { k.target = 0; k.unit = ''; }
      k.month = personal && k.type !== 'monthly' ? (k.month == null || k.month === '' ? curM() : int(k.month, 0, 11, 'A due month')) : undefined;
    });
    return krs;
  }
  function submitRev(e, o, rev) {
    if (M.editDirect(e, o)) { M.applyRev(o, rev); return 'Saved.'; }
    o.rev = {...rev, by: e.name, at: now()};
    notify('okrChange', o.owner === 'Company' ? ceos().map(p => p.name) : M.approversFor(o.owner),
      {subject: `${e.name} asked to change an OKR`, text: `${e.name} wants to change "${o.objective}". The change only takes effect once you approve it.`, tab: 'appr', key: `okrChange:${o.id}:${o.rev.at}`});
    return 'Sent to ' + M.approverOf(o) + ' for approval.';
  }

  const A = {
    'okr.add'(e, a) {
      const ow = M.ownerOptions(e);
      if (!ow.length) no('Your line manager sets your OKRs.');
      if (!ow.includes(a.owner)) no('You can\'t create an OKR for that owner.');
      const objective = str(a.objective, 200, 'The objective'), comp = a.owner.startsWith('Company');
      const krs = readKrs(a.krs, !comp);
      S.okrs.push({id: uuid(), objective, owner: comp ? 'Company' : a.owner, sub: a.owner.startsWith('Company:') ? a.owner.slice(8) : '', year: curY(), updates: [],
        krs: krs.map(x => ({title: x.title, pct: 0, req: false, reqAt: 0, apBy: '', month: x.month, type: x.type, target: x.target, unit: x.unit, cur: 0}))});
      return 'OKR saved.';
    },
    'okr.edit'(e, a) {
      const o = okr(a.id);
      if (!M.canEditOkr(e, o)) no('You can\'t edit this OKR.');
      if (o.rev) no('A change to this OKR is already waiting for approval.');
      const objective = str(a.objective, 200, 'The objective'), krs = readKrs(a.krs, M.isPersonal(o));
      const srcs = krs.map(k => k.src).filter(x => x != null);
      if (srcs.some(x => !Number.isInteger(x) || !o.krs[x]) || new Set(srcs).size !== srcs.length) no('This OKR changed while you were editing it. Refresh and try again.');
      if (o.krs.some((k, j) => (k.pct === 100 || k.req) && !srcs.includes(j))) no('Key results that are approved or awaiting approval cannot be removed.');
      return submitRev(e, o, {objective, krs: krs.map(k => ({src: k.src, title: k.title, month: k.month, type: k.type, target: k.target, unit: k.unit}))});
    },
    'okr.move'(e, a) {
      const o = okr(a.id), i = Number(a.i), k = kr(o, i);
      if (!(M.overdue(o, k) && o.year === curY())) no('Only an overdue key result from this year can be moved.');
      if (o.rev) no('A change to this OKR is already waiting for approval.');
      if (!(M.editDirect(e, o) || o.owner === e.name)) no('You can\'t move this key result.');
      return submitRev(e, o, {objective: o.objective, krs: o.krs.map((x, j) => ({src: j, title: x.title, month: j === i ? curM() : x.month, type: x.type || 'binary', target: x.target, unit: x.unit}))});
    },
    'okr.cancelChange'(e, a) {
      const o = okr(a.id);
      if (!o.rev) no('There is no change waiting on this OKR.');
      if (o.rev.by !== e.name && !M.canApprove(e, o)) no('Only whoever asked for the change can cancel it.');
      o.rev = null; return 'Change cancelled.';
    },
    'okr.decideChange'(e, a) {
      const o = okr(a.id);
      if (!o.rev) no('This change was already handled.');
      if (!M.canApprove(e, o)) no('You can\'t approve changes to this person\'s OKRs.');
      const by = o.rev.by;
      if (a.ok) M.applyRev(o, o.rev);
      o.rev = null;
      notify('krDecided', [by], {subject: `Your OKR change was ${a.ok ? 'approved' : 'not approved'}`, text: `${e.name} ${a.ok ? 'approved' : 'did not approve'} your change to "${o.objective}".`, tab: 'okrs', key: `okrChangeDone:${o.id}:${now()}`});
      return a.ok ? 'Change approved.' : 'Change rejected.';
    },
    'okr.delete'(e, a) {
      const o = okr(a.id);
      if (!M.canDeleteOkr(e, o)) no('You can\'t delete this OKR.');
      S.okrs = S.okrs.filter(x => x.id !== o.id); return 'OKR deleted.';
    },
    'okr.note'(e, a) {
      const o = okr(a.id), mine = o.owner !== 'Company' ? o.owner === e.name : M.isGroup(e);
      if (!mine) no('Only the owner can update a goal.');
      const text = str(a.text, 500, 'The note', false);
      let moved = 0;
      Object.entries(a.values && typeof a.values === 'object' ? a.values : {}).forEach(([i, v]) => {
        const k = o.krs[Number(i)];
        if (!k || !M.krMeasured(k) || k.pct === 100 || M.krAuto(o, k, Number(i))) return;
        const n = parseFloat(v); if (!(n >= 0) || n > 1e12 || n === M.krCur(o, k, Number(i))) return;
        Object.assign(k, {curManual: n, cur: n, curAt: now()}); moved++;
      });
      if (text) o.updates = [...M.okrUpdates(o), {text, status: M.okrStatus(o), by: e.name, at: now()}];
      return !text && !moved ? 'Nothing to save.' : moved ? `Saved, ${plural(moved, 'number', 'numbers')} updated.` : 'Note added.';
    },
    // Only the owner marks their own work done; it then waits for their line manager (AP-1).
    'kr.set'(e, a) {
      const o = okr(a.id), k = kr(o, a.i), company = o.owner === 'Company';
      if (!M.canMarkKr(e, o)) no('Only the owner can mark this key result.');
      const selfApproves = company || e.role === 'ceo';
      if (a.done) {
        if (k.pct === 100) no('This key result is already approved.');
        if (selfApproves) { Object.assign(k, {pct: 100, req: false, reqAt: now(), apBy: e.name, apAt: now()}); if (!company) M.logGain(o, 100); return 'Marked done.'; }
        if (k.req) return 'Already waiting for approval.';
        Object.assign(k, {req: true, reqAt: now()});
        notify('krDone', M.approversFor(o.owner), {subject: `${e.name} finished a key result`, text: `${e.name} marked "${k.title}" done on "${o.objective}". It needs your approval before it counts.`, tab: 'appr', key: `krDone:${o.id}:${a.i}:${k.reqAt}`});
        return 'Sent to ' + M.approverOf(o) + ' for approval.';
      }
      if (k.pct === 100) {
        if (!selfApproves) no('Ask ' + M.approverOf(o) + ' to reopen this.');
        Object.assign(k, {pct: 0, req: false, apBy: '', apAt: 0}); if (!company) M.logGain(o, -100); return 'Reopened.';
      }
      k.req = false; return 'Withdrawn.';
    },
    'kr.decide'(e, a) {
      const o = okr(a.id), k = kr(o, a.i);
      if (!M.canApprove(e, o)) no('You can\'t approve this person\'s key results.');
      if (!k.req || k.pct === 100) no('This request was already handled.');
      if (a.ok) { Object.assign(k, {pct: 100, req: false, apBy: e.name, apAt: now()}); M.logGain(o, 100); }
      else k.req = false;
      notify('krDecided', [o.owner], {subject: `Key result ${a.ok ? 'approved' : 'sent back'}`, text: `${e.name} ${a.ok ? 'approved' : 'sent back'} "${k.title}" on "${o.objective}".`, tab: 'okrs', key: `krDecided:${o.id}:${a.i}:${now()}`});
      return a.ok ? 'Approved.' : 'Sent back.';
    },

    // ---------- standup and the Friday review ----------
    'stand.add'(e, a) {
      const text = str(a.text, 300, 'The activity'), n = a.n === '' || a.n == null ? null : num(a.n, 0, 1e12, 'The figure');
      let okrId = '', ki = null;
      if (a.link) {
        const [oid, i] = String(a.link).split('|'), o = S.okrs.find(x => x.id === oid);
        if (!o || o.owner !== e.name || !o.krs[Number(i)]) no('You can only log against your own key results.');
        okrId = o.id; ki = Number(i);
      }
      S.stand.push({id: uuid(), week: curWeek(), day: today(), owner: e.name, text, status: 'Not done', n, unit: str(a.unit, 40, 'The unit', false), okr: okrId, kr: ki, ts: now()});
      return '';
    },
    'stand.status'(e, a) {
      const x = find('stand', a.id, 'activity');
      if (x.owner !== e.name) no('Only ' + x.owner + ' can set that.');
      x.status = oneOf(a.status, SSTAT, 'status'); return '';
    },
    'stand.delete'(e, a) {
      const x = find('stand', a.id, 'activity');
      if (x.owner !== e.name && !M.isGroup(e)) no('You can only delete your own activities.');
      S.stand = S.stand.filter(y => y.id !== x.id); return 'Deleted.';
    },
    'wnote.save'(e, a) {
      if (!isWeek(a.week) || a.week > curWeek()) no('Choose this week or an earlier one.');
      const text = str(a.text, 2000, 'Your comments', false), id = a.week + '_' + e.id;
      const ex = S.wnotes.find(x => x.week === a.week && x.owner === e.name);
      if (ex) Object.assign(ex, {text, ts: now()}); else S.wnotes.push({id, week: a.week, owner: e.name, text, ts: now()});
      return 'Comments saved.';
    },

    // ---------- the directory ----------
    'person.add'(e, a) {
      group(e);
      const name = freshName(a.name), em = freshEmail(a.email), r = oneOf(a.role, Object.keys(ROLES), 'role');
      if (r === 'ceo' && e.role !== 'ceo') no('Only the CEO can add another CEO.');
      const sub = a.sub ? oneOf(a.sub, S.cfg.subs, 'subsidiary') : '';
      const p = {id: uuid(), name, email: em, role: r, sub, team: str(a.team, 60, 'Team', false), mgr: null, title: str(a.title, 80, 'Job title', false),
        joined: today(), jd: [], contract: 'Permanent', notice: '1 month', uid: null};
      p.mgr = checkMgr(p, a.mgr || null);
      S.people.push(p); hooks.accounts.link(p);
      return name + ' added.' + (em ? ' Copy their invite link from the directory so they can sign in.' : '');
    },
    'person.save'(e, a, ctx) {
      group(e);
      const p = personById(a.id);
      if (p.role === 'ceo' && e.role !== 'ceo') no('Only the CEO can change a CEO\'s record.');
      const r = oneOf(a.role, Object.keys(ROLES), 'role');
      if (r === 'ceo' && p.role !== 'ceo' && e.role !== 'ceo') no('Only the CEO can make someone a CEO.');
      if (p.id === ctx.real.id && r !== p.role) no('You can\'t change your own role. Ask another CEO or HR to do it.');
      if (p.role === 'ceo' && r !== 'ceo' && ceos().length < 2) no('There must always be a CEO.');
      const name = a.name != null && a.name.trim() !== p.name ? freshName(a.name, p.id) : p.name;
      const em = freshEmail(a.email, p.id), sub = a.sub ? oneOf(a.sub, S.cfg.subs, 'subsidiary') : '', mgr = checkMgr(p, a.mgr || null);
      if (em !== (p.email || '')) hooks.accounts.email(p, em);
      if (name !== p.name) { renamePerson(p.name, name); p.name = name; }
      Object.assign(p, {email: em, role: r, sub, team: str(a.team, 60, 'Team', false), mgr});
      if (a.title != null) p.title = str(a.title, 80, 'Job title', false);
      hooks.accounts.link(p);
      return 'Saved.';
    },
    'person.employment'(e, a) {
      group(e);
      const p = personById(a.id);
      if (p.role === 'ceo' && e.role !== 'ceo') no('Only the CEO can change a CEO\'s record.');
      Object.assign(p, {title: str(a.title, 80, 'Job title', false), contract: str(a.contract, 40, 'Contract', false), notice: str(a.notice, 40, 'Notice period', false),
        joined: date(a.joined, 'Start date', false), review: date(a.review, 'Next review', false),
        salary: a.salary === '' || a.salary == null ? 0 : num(a.salary, 0, 1e12, 'Salary'),
        jd: arr(a.jd).map(x => str(x, 200, 'Each responsibility', false)).filter(Boolean).slice(0, 20)});
      return 'Saved.';
    },
    'person.delete'(e, a, ctx) {
      group(e);
      const p = personById(a.id);
      if (p.id === ctx.real.id) no('You can\'t remove yourself.');
      if (p.role === 'ceo' && e.role !== 'ceo') no('Only the CEO can remove a CEO.');
      if (p.role === 'ceo' && ceos().length < 2) no('There must always be a CEO.');
      S.people.forEach(x => { if (x.mgr === p.id) x.mgr = p.mgr || null; });
      S.people = S.people.filter(x => x.id !== p.id);
      hooks.accounts.remove(p);
      return p.name + ' removed. Their past records are kept.';
    },
    // DX-2: rows that can't be added are skipped with a reason; a file that can't be read adds nobody.
    'people.import'(e, a) {
      group(e);
      const rows = parseCsv(str(a.text, 512 * 1024, 'The file'));
      if (rows.length < 2) return {added: 0, skipped: [], error: 'That file has no rows under the header.'};
      const head = rows[0].map(h => h.trim().toLowerCase());
      const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
      const ci = {name: col('name', 'full name'), email: col('email', 'email address', 'work email'), sub: col('subsidiary', 'company'),
        role: col('role'), team: col('team', 'department'), title: col('job title', 'title'), mgr: col('reports to', 'manager', 'line manager')};
      if (ci.name < 0) return {added: 0, skipped: [], error: 'No "Name" column found. The header needs at least Name.'};
      const roleOf = v => { const x = String(v || '').trim().toLowerCase(); return x === 'ceo' ? 'ceo' : x === 'hr' ? 'hr' : x === 'manager' ? 'manager' : 'member'; };
      const added = [], skipped = [];
      rows.slice(1).forEach((r, i) => {
        const get = k => ci[k] >= 0 ? String(r[ci[k]] ?? '').trim() : '';
        if (!r.some(x => String(x).trim())) return;
        const name = get('name'), em = get('email').toLowerCase(), row = `Row ${i + 2}`;
        if (!name) return skipped.push(`${row}: no name`);
        if (name.length > 80) return skipped.push(`${row}: the name is too long`);
        if (S.people.some(p => p.name.toLowerCase() === name.toLowerCase()) || added.some(p => p.name.toLowerCase() === name.toLowerCase())) return skipped.push(`${row}: ${name} is already in the directory`);
        if (nameInRecords(name)) return skipped.push(`${row}: ${name} matches someone who has left; add a last name or initial`);
        if (em && !EMAIL_RE.test(em)) return skipped.push(`${row}: ${em} is not a valid email`);
        if (em && (S.people.some(p => (p.email || '').toLowerCase() === em) || added.some(p => p.email === em))) return skipped.push(`${row}: ${em} is already in use`);
        const sub = S.cfg.subs.find(x => x.toLowerCase() === get('sub').toLowerCase()) || '';
        if (get('sub') && !sub) return skipped.push(`${row}: "${get('sub')}" is not one of ${S.cfg.subs.join(', ')}`);
        const r2 = roleOf(get('role'));
        if (r2 === 'ceo' && e.role !== 'ceo') return skipped.push(`${row}: only the CEO can add another CEO`);
        added.push({id: uuid(), name, email: em, sub, role: r2, team: get('team').slice(0, 60), title: get('title').slice(0, 80),
          mgrName: get('mgr'), mgr: null, joined: today(), jd: [], contract: 'Permanent', notice: '1 month', uid: null});
      });
      added.forEach(p => S.people.push(p));
      // Resolve reporting lines last, so a manager listed in the same file still links up.
      added.forEach(p => { const m = p.mgrName && S.people.find(x => x.id !== p.id && x.name.toLowerCase() === p.mgrName.toLowerCase());
        p.mgr = m ? m.id : null; delete p.mgrName; hooks.accounts.link(p); });
      return {added: added.length, skipped, error: ''};
    },
    'hrnote.save'(e, a) {
      group(e); const p = personById(a.id);
      if (p.name === e.name) no('You can\'t record an action on yourself.');
      p.hrnote = {action: oneOf(a.action, HR_ACTIONS, 'action'), text: str(a.text, 500, 'Context', false), by: e.name, at: now()};
      return 'Recorded.';
    },
    'hrnote.clear'(e, a) { group(e); const p = personById(a.id); delete p.hrnote; return 'Cleared.'; },
    'one.add'(e, a) {
      const p = personById(a.id), m = M.mgrOf(p);
      if (!m || m.id !== e.id) no('Only their line manager logs one to ones.');
      S.ones.push({id: uuid(), owner: e.name, with: p.name, at: now(), notes: str(a.notes, 2000, 'What you discussed')});
      return 'Saved.';
    },
    'fb.add'(e, a) {
      const p = personById(a.id);
      if (!M.canSeeDossier(e, p) || p.name === e.name) no('You can\'t give feedback here.');
      S.fb.push({id: uuid(), to: p.name, from: e.name, kind: oneOf(a.kind, ['Praise', 'Improvement'], 'kind of feedback'), text: str(a.text, 1000, 'The feedback'), at: now()});
      return 'Feedback sent.';
    },
    'doc.add'(e, a) {
      group(e); const p = personById(a.id);
      S.docs.push({id: uuid(), owner: p.name, name: str(a.name, 120, 'The document name'), type: oneOf(a.type || 'Policy', ['Contract', 'Role', 'Policy', 'Other'], 'document type'),
        status: oneOf(a.status || 'Awaiting signature', ['On file', 'Awaiting signature', 'Signed'], 'status'), at: now()});
      return a.status === 'Awaiting signature' || !a.status ? 'Requested.' : 'Added.';
    },
    'doc.sign'(e, a) { group(e); const d = find('docs', a.id, 'document'); d.status = 'Signed'; d.at = now(); return 'Marked signed.'; },
    'doc.delete'(e, a) { group(e); const d = find('docs', a.id, 'document'); S.docs = S.docs.filter(x => x.id !== d.id); hooks.files.remove(d.id); return 'Document removed.'; },

    // ---------- settings (section 11) ----------
    'cfg.save'(e, a) {
      group(e);
      const c = a.cfg && typeof a.cfg === 'object' ? a.cfg : no('Nothing to save.'), old = S.cfg;
      // A list where entries can be renamed (the rename follows through) and removed (only when nothing uses them).
      // Every check runs before anything is renamed, so a refusal leaves the data untouched.
      const renames = [];
      function list(raw, oldVals, label, max, from, inUse, rename) {
        const vals = arr(raw).map(x => str(x, max, label));
        if (!vals.length) no(`Keep at least one ${label.toLowerCase()}.`);
        if (vals.length > 30) no(`At most 30 ${label.toLowerCase()} entries.`);
        if (new Set(vals.map(x => x.toLowerCase())).size !== vals.length) no(`Two ${label.toLowerCase()} entries share a name.`);
        const src = vals.map((_, i) => { const x = arr(from)[i]; return oldVals.includes(x) ? x : null; });
        oldVals.filter(x => !src.includes(x)).forEach(x => { if (inUse(x)) no(`"${x}" is in use, so it can't be removed.`); });
        vals.forEach((v, i) => { if (src[i] && src[i] !== v) renames.push(() => rename(src[i], v)); });
        return vals;
      }
      const subs = list(c.subs, old.subs, 'Subsidiary', 40, a.from?.subs, x => S.people.some(p => p.sub === x) || S.okrs.some(o => o.sub === x) || S.roles.some(r => r.sub === x) || S.tmpl.some(t => t.sub === x),
        (o2, n) => { S.people.forEach(p => { if (p.sub === o2) p.sub = n; }); S.okrs.forEach(o => { if (o.sub === o2) o.sub = n; });
          S.roles.forEach(r => { if (r.sub === o2) r.sub = n; }); S.tmpl.forEach(t => { if (t.sub === o2) t.sub = n; }); S.onb.forEach(t => { if (t.sub === o2) t.sub = n; }); });
      const lt = arr(c.leave);
      const leaveTypes = list(lt.map(x => x && x.type), old.leave.map(x => x.type), 'Leave type', 40, a.from?.leave, x => S.leave.some(l => l.type === x), (o2, n) => S.leave.forEach(l => { if (l.type === o2) l.type = n; }));
      const etypes = list(c.etypes, old.etypes, 'Contract type', 40, a.from?.etypes, x => S.roles.some(r => r.etype === x), (o2, n) => S.roles.forEach(r => { if (r.etype === o2) r.etype = n; }));
      const closeWhy = list(c.closeWhy, old.closeWhy, 'Close reason', 80, a.from?.closeWhy, x => S.roles.some(r => M.closedOf(r).some(y => y.reason === x)),
        (o2, n) => S.roles.forEach(r => M.closedOf(r).forEach(y => { if (y.reason === o2) y.reason = n; })));
      const onbWho = list(c.onbWho, old.onbWho, 'Task owner', 40, a.from?.onbWho, x => S.tmpl.some(t => t.tasks.some(k => k.who === x)) || S.onb.some(o => o.tasks.some(k => !k.done && k.who === x)),
        (o2, n) => { S.tmpl.forEach(t => t.tasks.forEach(k => { if (k.who === o2) k.who = n; })); S.onb.forEach(o => o.tasks.forEach(k => { if (k.who === o2) k.who = n; })); });
      const m = c.mail && typeof c.mail === 'object' ? c.mail : {};
      const modes = {}; Object.keys(ALERTS).forEach(k => { modes[k] = oneOf(m.modes?.[k] ?? old.mail.modes[k], ALERT_MODES.map(x => x[0]), 'email timing'); });
      const next = {subs, etypes, closeWhy, onbWho,
        leave: leaveTypes.map((type, i) => ({type, days: int(lt[i]?.days ?? 0, 0, 365, `Days for ${type}`)})),
        cur: str(c.cur, 3, 'The money symbol') || old.cur, reqMgr: c.reqMgr ? 1 : 0, reqExec: c.reqExec ? 1 : 0,
        yearStart: int(c.yearStart, 0, 11, 'The goal year start'), staleDays: int(c.staleDays, 1, 365, 'The chasing window'),
        riskAt: int(c.riskAt, 1, 200, 'The at-risk line'), behindAt: int(c.behindAt, 1, 100, 'The off-track line'), aheadAt: int(c.aheadAt, 100, 500, 'The ahead line'),
        standupWeeks: int(c.standupWeeks, 0, 4, 'Expected standups'), enpsDays: int(c.enpsDays, 7, 365, 'The recommend-question interval'),
        reviewDueDays: int(c.reviewDueDays, 1, 180, 'The self-review window'), execAt: int(c.execAt, 0, 1e12, 'The exec threshold'),
        mail: {fromName: str(m.fromName, 80, 'The sender name', false) || 'Team OKR Tracker', replyTo: email(m.replyTo, false),
          digestHour: int(m.digestHour ?? old.mail.digestHour, 0, 23, 'The daily email hour'), modes}};
      if (next.behindAt > next.riskAt) no('The off-track line has to be at or below the at-risk line.');
      renames.forEach(f => f());
      Object.assign(S.cfg, next);
      return 'Settings saved.';
    },
    'cfg.reset'(e) {
      group(e);
      const d = CFG0();
      ['yearStart', 'staleDays', 'riskAt', 'behindAt', 'aheadAt', 'standupWeeks', 'enpsDays', 'reviewDueDays', 'reqMgr', 'reqExec', 'execAt', 'cur', 'mail'].forEach(k => { S.cfg[k] = d[k]; });
      return 'Policy numbers and email settings are back to the defaults. Your lists are unchanged.';
    },

    // ---------- wellbeing and leave (section 7) ----------
    'survey.send'(e, a) {
      group(e);
      if (a.week !== curWeek()) no('A check-in can only be sent for this week.');
      if (M.surveyFor(a.week)) no('This week\'s check-in has already been sent.');
      S.surveys.push({id: uuid(), week: a.week, sentAt: now(), sentBy: e.name, remindedAt: 0, closed: false});
      notify('checkin', M.recipients().map(p => p.name).filter(n => n !== e.name), {subject: 'Your weekly check-in', text: 'Two quick questions on your workload and how you are doing. It takes about fifteen seconds.', tab: 'ci', key: `checkin:${a.week}`});
      return 'Check-in sent to ' + plural(M.recipients().length, 'person', 'people') + '.';
    },
    'survey.remind'(e, a) {
      group(e);
      const sv = M.surveyFor(a.week) || no('No check-in was sent that week.');
      if (sv.closed) no('This check-in is closed.');
      if (sv.remindedAt) no('A reminder has already gone out for this check-in.');
      const miss = M.outstanding(a.week).filter(p => p.name !== e.name);
      sv.remindedAt = now();
      notify('checkin', miss.map(p => p.name), {subject: 'Reminder: your weekly check-in', text: 'Your weekly check-in is still waiting. Two questions, about fifteen seconds.', tab: 'ci', key: `checkinRemind:${a.week}`});
      return 'Reminder sent to ' + plural(miss.length, 'person', 'people') + '.';
    },
    'survey.close'(e, a) { group(e); const sv = M.surveyFor(a.week) || no('No check-in was sent that week.'); sv.closed = !a.reopen; return sv.closed ? 'Check-in closed.' : 'Check-in reopened.'; },
    'welfare.save'(e, a) {
      const sv = M.surveyFor(a.week);
      if (!sv || sv.closed) no('This week\'s check-in is not open.');
      const v = {workload: int(a.workload, 1, 5, 'Workload'), mood: int(a.mood, 1, 5, 'How you are doing'), note: str(a.note, 500, 'The note', false), ts: now()};
      const ex = M.welfareOf(e.name, a.week);
      const enps = a.enps === '' || a.enps == null ? (ex?.enps ?? null) : int(a.enps, 0, 10, 'The recommend score');
      if (ex) Object.assign(ex, v, {enps}); else S.welfare.push({id: uuid(), week: a.week, owner: e.name, ...v, enps});
      return 'Check-in saved.';
    },
    'leave.add'(e, a) {
      const from = date(a.from, 'The start date'), to = date(a.to, 'The end date');
      if (to < from) no('The end date is before the start date.');
      const type = oneOf(a.type, S.cfg.leave.map(x => x.type), 'leave type');
      const days = Math.round((parseIso(to) - parseIso(from)) / 86400000) + 1;
      if (days > 366) no('Book at most a year at a time.');
      // A type with no allowance, such as unpaid leave, has no balance to run out of.
      if (M.leaveAllow(type) > 0 && days > M.leaveBal(e.name, type)) no(`That is ${days} days and only ${M.leaveBal(e.name, type)} days of ${type.toLowerCase()} are left.`);
      if (S.leave.some(l => l.owner === e.name && l.status !== 'Declined' && l.from <= to && l.to >= from)) no('You already have leave booked on some of those days.');
      const l = {id: uuid(), owner: e.name, from, to, days, type, status: 'Requested', by: e.name, at: now(), apBy: ''};
      S.leave.push(l);
      notify('leaveAsked', M.approversFor(e.name), {subject: `${e.name} asked for leave`, text: `${e.name} asked for ${plural(days, 'day', 'days')} of ${type.toLowerCase()}, ${from} to ${to}.`, tab: 'ci-leave', key: `leaveAsked:${l.id}`});
      return 'Sent to ' + M.approverOf({owner: e.name}) + ' for approval.';
    },
    'leave.withdraw'(e, a) {
      const l = find('leave', a.id, 'leave request');
      if (l.owner !== e.name || l.status !== 'Requested') no('Only a request still waiting can be withdrawn, by whoever asked.');
      S.leave = S.leave.filter(x => x.id !== l.id); return 'Withdrawn.';
    },
    'leave.decide'(e, a) {
      const l = find('leave', a.id, 'leave request');
      if (!M.canDecideLeave(e, l)) no('You can\'t decide this leave request.');
      if (l.status !== 'Requested') no('This request was already decided.');
      Object.assign(l, {status: a.ok ? 'Approved' : 'Declined', apBy: e.name, decidedAt: now()});
      notify('leaveDecided', [l.owner], {subject: `Leave ${a.ok ? 'approved' : 'declined'}`, text: `${e.name} ${a.ok ? 'approved' : 'declined'} your ${l.type.toLowerCase()}, ${l.from} to ${l.to}.`, tab: 'ci-leave', key: `leaveDecided:${l.id}`});
      return a.ok ? 'Leave approved.' : 'Leave declined.';
    },

    // ---------- review cycle (section 6) ----------
    'cycle.open'(e, a) {
      group(e);
      if (M.liveCycle()) no('A cycle is already open. Close it first.');
      const y = curY(), h = curM() < 6 ? 'H1' : 'H2';
      const from = date(a.from || y + (h === 'H1' ? '-01-01' : '-07-01'), 'The period start'), to = date(a.to || y + (h === 'H1' ? '-06-30' : '-12-31'), 'The period end');
      const due = date(a.due || new Date(Date.now() + S.cfg.reviewDueDays * 86400000).toISOString().slice(0, 10), 'The due date');
      if (to < from) no('The period ends before it starts.');
      S.cycles.push({id: uuid(), name: str(a.name, 60, 'The name', false) || `${h} ${y} review`, from, to, due, status: 'Open'});
      return 'Cycle opened. Everyone is asked for a self-review.';
    },
    'cycle.close'(e) { group(e); const c = M.liveCycle() || no('No cycle is open.'); c.status = 'Closed'; return 'Cycle closed.'; },
    'review.self'(e, a) {
      const c = M.liveCycle() || no('No review cycle is open.');
      const text = str(a.text, 4000, 'Your self-review'), rating = int(a.rating, 1, 5, 'Your rating');
      const ex = M.revOf(c.id, e.name);
      if (ex && ex.mgr) no('Your manager has already written their review, so your self-review is locked.');
      const self = {text, rating, at: now()};
      if (ex) ex.self = self; else S.reviews.push({id: uuid(), cycle: c.id, owner: e.name, self, mgr: null, shared: null, ack: null});
      return 'Sent to ' + M.approverOf({owner: e.name}) + '.';
    },
    // RV-2: the manager writes only once the self-review is in; RV-3: it stays private until shared.
    'review.mgr'(e, a) {
      const c = M.liveCycle() || no('No review cycle is open.'), p = personByName(a.name);
      if (!canWriteReview(e, p)) no('Only ' + p.name + '\'s line manager writes their review.');
      const r = M.revOf(c.id, p.name);
      if (!r || !r.self) no(p.name + ' has not sent their self-review yet.');
      if (r.shared) no('This review has already been shared.');
      r.mgr = {text: str(a.text, 4000, 'Your review'), rating: int(a.rating, 1, 5, 'The rating'), by: e.name, at: now()};
      return 'Saved. Share it with ' + p.name + ' once you have talked it through.';
    },
    'review.share'(e, a) {
      const c = M.liveCycle() || no('No review cycle is open.'), p = personByName(a.name), r = M.revOf(c.id, p.name);
      if (!r || !r.mgr) no('There is nothing to share yet.');
      if (!canWriteReview(e, p) && e.role !== 'ceo') no('Only their line manager or the CEO can share it.');
      if (r.shared) no('Already shared with ' + p.name + '.');
      r.shared = {by: e.name, at: now()};
      notify('reviewShared', [p.name], {subject: 'Your review is ready to sign off', text: `${e.name} has shared your ${c.name} with you. Read it and sign it off.`, tab: 'ci-rev', key: `reviewShared:${r.id}`});
      return 'Shared with ' + p.name + '. They will be asked to sign it off.';
    },
    'review.ack'(e, a) {
      const c = M.liveCycle() || no('No review cycle is open.'), r = M.revOf(c.id, e.name);
      if (!r || !r.shared) no('There is nothing to sign off yet.');
      if (r.ack) no('You have already signed this off.');
      r.ack = {at: now(), text: str(a.text, 2000, 'Your comment', false)};
      notify('reviewSigned', [r.mgr?.by, ...hrNames()].filter(n => n && n !== e.name), {subject: `${e.name} signed off their review`, text: `${e.name} signed off their ${c.name}.`, tab: 'ci-rev', key: `reviewSigned:${r.id}`});
      return 'Signed off. Your manager and HR can see it.';
    },

    // ---------- hiring (section 8) ----------
    'role.save'(e, a) {
      if (!['manager', 'ceo', 'hr'].includes(e.role)) no('Managers, HR and the CEO raise role requests.');
      const old = a.id ? find('roles', a.id, 'role request') : null;
      if (old && (!M.raisedBy(e, old) || !M.sentBack(old))) no('That request is not yours to resend.');
      const title = str(a.title, 100, 'The job title'), team = str(a.team, 60, 'The team');
      const why = str(a.why, 2000, 'The case for it');
      const pmin = a.payMin === '' || a.payMin == null ? 0 : num(a.payMin, 0, 1e12, 'Pay from'), pmax = a.payMax === '' || a.payMax == null ? 0 : num(a.payMax, 0, 1e12, 'Pay to');
      if (pmin && pmax && pmax < pmin) no('The top of the pay band cannot be below the bottom.');
      const n = int(a.count || 1, 1, 99, 'Openings'), bud = a.budgeted ? 1 : 0;
      let hm = e.name;
      if (M.isGroup(e)) { const p = personByName(a.hm); if (p.role !== 'manager' && p.role !== 'ceo') no('The hiring manager must be a manager or the CEO.'); hm = p.name; }
      const d = {title, team, sub: oneOf(a.sub, S.cfg.subs, 'subsidiary'), hm, count: n, kind: oneOf(a.kind, RKIND, 'reason for hire'), replacing: str(a.replacing, 80, 'Replacing', false),
        etype: oneOf(a.etype, S.cfg.etypes, 'contract type'), payMin: pmin, payMax: pmax, cost: str(a.cost, 40, 'The cost centre', false), budgeted: bud, why, needBy: date(a.needBy, 'Needed by', false)};
      const r = old || {id: uuid(), ref: M.reqRef(), reqBy: e.name, recruiter: '', hires: [], closed: [], log: [], apBy: '', apAt: 0, opened: '', note: '', jd: []};
      Object.assign(r, d, {status: 'In approval', reqAt: now(), note: '', chain: M.chainFor(e.name, bud, pmax * n)});
      M.logReq(r, e.name, old ? 'Fixed and resent the request' : 'Raised the request');
      M.settleOwn(r, e.name);
      if (!old) S.roles.push(r);
      const st = M.stepNow(r);
      if (!st) { M.openReq(r, e.name); return 'Role opened.'; }
      notifyStep(r, st);
      return `Sent for approval. With ${M.stepLabel(st)} now.`;
    },
    'role.approve'(e, a) {
      const r = find('roles', a.id, 'role request'), st = M.stepNow(r);
      if (!M.inAppr(r) || !M.canStep(e, st)) no('This request is not at your step.');
      Object.assign(st, {state: 'Approved', who: st.who || e.name, at: now()});
      M.logReq(r, e.name, 'Approved as ' + st.role.toLowerCase());
      const nxt = M.stepNow(r);
      if (nxt) { notifyStep(r, nxt); return 'Approved. Now with ' + M.stepLabel(nxt) + '.'; }
      M.openReq(r, e.name);
      notify('roleRaiser', [r.reqBy], {subject: `${r.title} is open for hiring`, text: `${r.ref} ${r.title} was approved and is open for hiring.`, tab: 'hire', key: `roleOpened:${r.id}`});
      return r.title + ' is open. ' + (r.reqBy || r.hm) + ' can see it.';
    },
    'role.sendBack'(e, a) {
      const r = find('roles', a.id, 'role request'), st = M.stepNow(r);
      if (!M.inAppr(r) || !M.canStep(e, st)) no('Only the approver at this step can send it back.');
      const why = str(a.why, 1000, 'What needs fixing');
      Object.assign(st, {state: 'Sent back', who: st.who || e.name, at: now(), note: why});
      Object.assign(r, {status: 'Sent back', note: why});
      M.logReq(r, e.name, 'Sent it back', why);
      notify('roleRaiser', [r.reqBy], {subject: `${r.title} was sent back to you`, text: `${e.name} sent ${r.ref} ${r.title} back for changes. Fix it and resend it.`, tab: 'hire-appr', key: `roleBack:${r.id}:${now()}`});
      return 'Sent back to ' + (r.reqBy || r.hm) + ' to fix.';
    },
    'role.decline'(e, a) {
      const r = find('roles', a.id, 'role request'), st = M.stepNow(r);
      if (!M.inAppr(r) || !M.canStep(e, st)) no('Only the approver at this step can decline it.');
      const why = str(a.why, 1000, 'A reason');
      Object.assign(st, {state: 'Declined', who: st.who || e.name, at: now(), note: why});
      Object.assign(r, {status: 'Declined', apBy: e.name, apAt: now(), note: why});
      M.logReq(r, e.name, 'Declined it', why);
      notify('roleRaiser', [r.reqBy], {subject: `${r.title} was declined`, text: `${e.name} declined ${r.ref} ${r.title}.`, tab: 'hire', key: `roleDeclined:${r.id}`});
      return 'Declined, with your reason on the record.';
    },
    'role.withdraw'(e, a) {
      const r = find('roles', a.id, 'role request');
      if (!M.raisedBy(e, r) || !(M.inAppr(r) || M.sentBack(r))) no('Only whoever raised it can withdraw it, while it is still in approval.');
      Object.assign(r, {status: 'Withdrawn', note: 'Withdrawn by ' + e.name + '.'});
      M.logReq(r, e.name, 'Withdrew the request'); return 'Withdrawn.';
    },
    'role.hold'(e, a) {
      const r = find('roles', a.id, 'role');
      if (!M.canRole(e, r)) no('Only HR or the hiring manager can do that.');
      if (a.reopen ? r.status !== 'On hold' : !M.roleLive(r)) no('That role is not ' + (a.reopen ? 'on hold.' : 'open.'));
      r.status = a.reopen ? 'Open' : 'On hold'; if (a.reopen) r.note = '';
      M.logReq(r, e.name, a.reopen ? 'Reopened' : 'Put on hold');
      return a.reopen ? 'Back open.' : 'Put on hold. HR and the hiring manager can see it.';
    },
    'role.close'(e, a) {
      const r = find('roles', a.id, 'role');
      if (!M.canRole(e, r)) no('Only HR or the hiring manager can close a role.');
      if (!(M.roleLive(r) || r.status === 'On hold')) no('Only an open role can be closed.');
      const left = M.toFill(r); if (!left) no('Every opening on this role is already accounted for.');
      const why = oneOf(a.why, S.cfg.closeWhy, 'reason');
      r.closed = [...M.closedOf(r), ...Array.from({length: left}, () => ({reason: why, at: now(), by: e.name}))];
      Object.assign(r, {status: M.hiresOf(r).length ? 'Filled' : 'Withdrawn', filledAt: now(), note: why});
      M.logReq(r, e.name, 'Closed ' + plural(left, 'opening', 'openings') + ' without hiring', why);
      return 'Closed: ' + why.toLowerCase() + '.';
    },
    // RQ-5: an outside hire joins the directory and starts onboarding; an internal move updates the existing record.
    'role.fill'(e, a) {
      const r = find('roles', a.id, 'role');
      if (!M.canRole(e, r)) no('Only HR or the hiring manager can fill a role.');
      if (!M.roleLive(r)) no('Only an open role can be filled.');
      const how = oneOf(a.how, ['Outside the company', 'Internal move'], 'where they are coming from'), nm = str(a.name, 80, 'Their name');
      if (M.hiresOf(r).some(h => h.name === nm)) no(nm + ' is already recorded on this role.');
      const start = date(a.start || today(), 'The start date'), ex = M.person(nm), hm = M.person(r.hm);
      if (how === 'Internal move') {
        if (!ex) no(nm + ' is not in the directory. Choose "Outside the company" instead.');
        Object.assign(ex, {title: r.title, team: r.team, sub: r.sub, mgr: hm && hm.id !== ex.id && !M.reportsTo(hm, ex) ? hm.id : ex.mgr});
      } else {
        if (ex) no(nm + ' is already in the directory. Choose "Internal move" instead.');
        const name = freshName(nm), em = freshEmail(a.email, null, true);
        const p = {id: uuid(), name, email: em, role: 'member', sub: r.sub, team: r.team, mgr: hm ? hm.id : null,
          title: r.title, joined: start, jd: r.jd || [], contract: r.etype || 'Permanent', notice: '1 month', uid: null};
        S.people.push(p); hooks.accounts.link(p);
        S.onb.push(M.newOnb(name, start, r.sub));
      }
      r.hires = [...M.hiresOf(r), {name: nm, at: now(), by: e.name, how}];
      M.logReq(r, e.name, 'Recorded ' + nm + ' as the hire', how);
      if (M.toFill(r) === 0) { Object.assign(r, {status: 'Filled', filledAt: now()}); M.logReq(r, e.name, 'Role filled and closed'); }
      return how === 'Internal move' ? nm + ' moved into the role.' : nm + ' added to the directory, onboarding started.';
    },

    // ---------- onboarding (section 9) ----------
    'tmpl.save'(e, a) {
      group(e);
      const name = str(a.name, 80, 'The checklist name'), sub = a.sub ? oneOf(a.sub, S.cfg.subs, 'subsidiary') : '';
      const tasks = arr(a.tasks).map(t => ({t: str(t.t, 200, 'Each task', false), who: t.who, off: t.off})).filter(t => t.t)
        .map(t => ({t: t.t, who: oneOf(t.who, S.cfg.onbWho, 'task owner'), off: int(t.off ?? 0, -365, 365, 'Days from start')}));
      if (!tasks.length) no('Add at least one task.');
      if (tasks.length > 80) no('Keep a checklist to 80 tasks.');
      const clash = S.tmpl.find(x => x.id !== a.id && x.sub === sub);
      if (clash) no(sub ? clash.name + ' already covers ' + sub + '.' : clash.name + ' is already the default.');
      // ON-1: editing a checklist does not change anyone already onboarding, because they hold their own copy.
      if (a.id) Object.assign(find('tmpl', a.id, 'checklist'), {name, sub, tasks}); else S.tmpl.push({id: uuid(), name, sub, tasks});
      return 'Checklist saved.';
    },
    'tmpl.delete'(e, a) {
      group(e); const tp = find('tmpl', a.id, 'checklist');
      if (!tp.sub) no('The default checklist can be edited but not deleted.');
      S.tmpl = S.tmpl.filter(x => x.id !== tp.id); return 'Checklist deleted.';
    },
    'onb.start'(e, a) {
      group(e); const p = personById(a.id);
      if (M.onbFor(p.name)) no(p.name + ' already has an onboarding checklist.');
      S.onb.push(M.newOnb(p.name, today(), p.sub)); return 'Onboarding started for ' + p.name + '.';
    },
    'onb.tick'(e, a) {
      const o = M.onbFor(a.owner) || no('That checklist no longer exists.'), t = o.tasks[Number(a.i)] || no('That task no longer exists.');
      if (!M.onbCanTick(e, o, t)) no('Only the task\'s owner can tick it.');
      Object.assign(t, {done: !t.done, by: t.done ? '' : e.name, at: t.done ? 0 : now()}); return '';
    },
  };

  // RV-2/RV-3 and the permissions matrix: a review is written and released by the person's own line manager.
  function canWriteReview(e, p) { return !!p && p.mgr === e.id; }
  function notifyStep(r, st) {
    const to = st.role === 'HR' ? hrNames() : [st.who];
    notify('roleStep', to, {subject: `Role request waiting on you: ${r.title}`, text: `${r.ref} ${r.title} (${r.team}, ${r.sub}) is at your step of the approval chain.`, tab: 'hire-appr', key: `roleStep:${r.id}:${r.reqAt}:${st.role}`});
  }

  return {actions: A, renamePerson, canWriteReview};
}
