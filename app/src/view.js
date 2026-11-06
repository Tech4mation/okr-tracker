// What one person's browser receives: only the records they are allowed to see (PRD section 1, section 10 and the
// permissions matrix). The page renders whatever it is given, so this is where privacy is actually enforced.
import {curY} from '../public/model.js';

export function viewFor(M, e) {
  const {S} = M;
  const group = M.isGroup(e), mgr = e.role === 'manager';
  const scope = M.scope(e), board = M.lbScope(e), team = mgr ? M.teamNames(e) : new Set([e.name]);
  const above = n => { const p = M.person(n); return !!p && M.reportsTo(p, e); };   // e is in n's management line
  // Old day-to-day entries stop travelling to the page after a year; goals, reviews and leave always do.
  const since = `${curY() - 1}-01-01`, recent = x => (x.day || x.week || '') >= since;
  const mine = n => n === e.name;

  const people = S.people.map(p => {
    const out = {id: p.id, name: p.name, role: p.role, team: p.team, sub: p.sub, mgr: p.mgr, title: p.title || '', joined: p.joined || ''};
    if (M.canSeeDossier(e, p)) Object.assign(out, {email: p.email || '', contract: p.contract || '', notice: p.notice || '', review: p.review || '', jd: p.jd || [], hrnote: p.hrnote || null});
    if (M.canSeePay(e, p)) out.salary = p.salary || 0;
    if (group) out.account = !!p.uid;
    return out;
  });
  const okrs = S.okrs.filter(o => o.owner === 'Company' ? (group || !o.sub || o.sub === e.sub) : scope.has(o.owner));
  // RV-3: until the manager shares it, the person only learns that a review has been written.
  const reviews = S.reviews.filter(r => mine(r.owner) || group || above(r.owner)).map(r => mine(r.owner) && !r.shared && !r.ack && r.mgr
    ? {...r, mgr: {by: r.mgr.by, at: r.mgr.at}} : r);
  const out = {
    cfg: S.cfg,
    people, okrs, reviews,
    stand: S.stand.filter(x => scope.has(x.owner) && recent(x)),
    wnotes: S.wnotes.filter(x => scope.has(x.owner)),
    logs: S.logs.filter(x => board.has(x.owner) && recent(x)),
    welfare: S.welfare.filter(x => (mine(x.owner) || group || (mgr && team.has(x.owner))) && recent(x)),
    leave: S.leave.filter(x => mine(x.owner) || group || (mgr && team.has(x.owner))),
    cycles: S.cycles,
    roles: S.roles.filter(r => M.roleVisible(e, r)),
    ones: S.ones.filter(x => mine(x.owner) || mine(x.with) || group || above(x.with)),
    fb: S.fb.filter(x => mine(x.to) || mine(x.from) || group || above(x.to)),
    docs: S.docs.filter(x => mine(x.owner) || group || above(x.owner)),
    surveys: S.surveys,
    onb: S.onb.filter(x => mine(x.owner) || group || (mgr && team.has(x.owner))),
    tmpl: group ? S.tmpl : [],
    // The leaderboard needs teammates' standing, not their goals: send the figure, not the records.
    board: Object.fromEntries([...board].map(n => [n, {pct: M.personPct(n)}])),
    meta: {standWeeks: [...new Set(S.stand.filter(recent).map(x => x.week))]},
  };
  return out;
}
