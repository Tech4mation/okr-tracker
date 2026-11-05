// Roles, visibility and permission rules from the PRD (sections 2, 4 and 6).
// One copy, shared by the server (which enforces them) and the page (which uses them to show the right controls).
// People are {id, name, role, team}. An OKR is {owner: personId | 'company', krs: [{done, req}]}.

export const ROLES = {ceo: 'CEO', hr: 'HR', manager: 'Manager', member: 'Member'};
export const SSTAT = ['Not done', 'In progress', 'Done'];
export const PSTAT = ['Agreed', 'In progress', 'Done', 'Blocked'];
export const OUTCOMES = ['Done', 'Partially done', 'Not started', 'Blocked / dropped'];
export const KR_MIN = 2, KR_MAX = 20;

// ---------- weeks (BR-7: Monday to Sunday, keyed by the Monday's date) ----------
export const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
export const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const curWeek = () => iso(mondayOf(new Date()));
export const shiftDay = (d, n) => { const x = parseIso(d); x.setDate(x.getDate() + n); return iso(x); };
export const isWeek = w => typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) && iso(mondayOf(parseIso(w))) === w;

// ---------- who sees whom ----------
export const teamKey = p => String(p?.team || '').trim().toLowerCase();
export const sameTeam = (a, b) => !!teamKey(a) && teamKey(a) === teamKey(b);
export const isAll = e => e.role === 'ceo' || e.role === 'hr';
export const isApprover = e => e.role === 'ceo' || e.role === 'manager';
export const readOnly = e => e.role === 'hr';

// Whose OKRs, standups, achievements and priorities this person sees: themselves, their team (managers), or everyone (CEO, HR).
export function scopeIds(e, people) {
  if (isAll(e)) return new Set(people.map(p => p.id));
  if (e.role === 'manager') return new Set(people.filter(p => p.id === e.id || sameTeam(p, e)).map(p => p.id));
  return new Set([e.id]);
}
// Who appears on this person's leaderboard: their team, or everyone for the CEO and HR. HR have no OKRs, so they're left off.
export function boardIds(e, people) {
  const base = isAll(e) ? people : people.filter(p => p.id === e.id || sameTeam(p, e));
  return base.filter(p => p.role !== 'hr').map(p => p.id);
}
// Who this person can create an OKR or priority for (US-2.4, US-7.1). Their own id first.
export function ownerChoices(e, people, withCompany) {
  if (readOnly(e)) return [];
  let list = [];
  if (e.role === 'ceo') list = people.filter(p => p.role !== 'hr');
  else if (e.role === 'manager') list = people.filter(p => sameTeam(p, e) && p.role !== 'hr');
  const others = list.filter(p => p.id !== e.id).sort((a, b) => a.name.localeCompare(b.name)).map(p => p.id);
  return [e.id, ...(withCompany && e.role === 'ceo' ? ['company'] : []), ...others];
}

// ---------- key-result approval (BR-3, BR-4) ----------
export function canApprove(e, owner) {
  if (!owner || owner.id === e.id || readOnly(e)) return false;
  if (e.role === 'ceo') return true;
  return e.role === 'manager' && owner.role === 'member' && sameTeam(owner, e);
}
// A member's request goes to a manager of the same team; a manager's (or a member with no team manager) goes to the CEO.
export function approversOf(owner, people) {
  if (!owner || owner.role !== 'member') return [];
  return people.filter(m => m.role === 'manager' && m.id !== owner.id && sameTeam(m, owner));
}
export const canRequest = (e, o) => !readOnly(e) && o.owner === e.id && (e.role === 'member' || e.role === 'manager');
export const canDirect = (e, o) => !readOnly(e) && e.role === 'ceo' && (o.owner === e.id || o.owner === 'company');
export const canReopen = e => !readOnly(e) && e.role === 'ceo';
export const canDeleteOkr = (e, o) => !readOnly(e) && (o.owner === e.id || e.role === 'ceo');

// ---------- weekly entries (BR-9) ----------
export const canEditEntry = (e, ownerId) => !readOnly(e) && (ownerId === e.id || e.role === 'ceo');
export const canEditPrio = (e, p) => !readOnly(e) && (p.assignee === e.id || p.by === e.id || e.role === 'ceo');
export const canReview = (e, p) => !readOnly(e) && (p.assignee === e.id || e.role === 'ceo');

// ---------- progress (BR-1, BR-2, BR-6) ----------
export const krWeight = o => 100 / (o.krs.length || 1);
export const okrPct = o => o.krs.length ? o.krs.filter(k => k.done).length / o.krs.length * 100 : 0;
export const avgPct = list => list.length ? list.reduce((s, o) => s + okrPct(o), 0) / list.length : 0;
