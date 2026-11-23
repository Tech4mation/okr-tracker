// "Load sample data" (TPD-1890): a small made-up company, so a new CEO can see the tracker filled in before entering
// real people. Every record is tagged `sample: true`, so "Clear sample data" removes exactly these and nothing she
// entered herself. Sample people have no email address and can never sign in.
import {uuid, today, curWeek, curY, curM, shiftDay} from '../public/model.js';

// name, role, team, job title, line manager (null: the CEO)
const PEOPLE = [
  ['Amara Okafor', 'hr', 'People', 'Head of People', null],
  ['Tunde Bakare', 'manager', 'Sales', 'Sales Lead', null],
  ['Ngozi Eze', 'manager', 'Product', 'Product Lead', null],
  ['Kemi Adeyemi', 'member', 'Sales', 'Account Executive', 'Tunde Bakare'],
  ['Femi Johnson', 'member', 'Sales', 'Sales Associate', 'Tunde Bakare'],
  ['Zainab Musa', 'member', 'Product', 'Product Designer', 'Ngozi Eze'],
  ['Chidi Obi', 'member', 'Product', 'Software Engineer', 'Ngozi Eze'],
];
export const SAMPLE_NAMES = PEOPLE.map(p => p[0]);

// The records, ready to add. `ceo` is the person loading them; `leaveType` an allowance-based leave type in Settings.
export function sampleRecords(ceo, leaveType) {
  const now = Date.now(), y = curY(), m = curM(), later = n => Math.min(m + n, 11), wk = curWeek(), day = today();
  const people = PEOPLE.map(([name, role, team, title], i) => ({id: uuid(), name, email: '', role, sub: '', team, mgr: null, title,
    joined: shiftDay(day, -120 - i * 75), jd: [], contract: 'Permanent', notice: '1 month', uid: null, sample: true}));
  const byName = n => people.find(p => p.name === n);
  people.forEach((p, i) => { p.mgr = PEOPLE[i][4] ? byName(PEOPLE[i][4]).id : ceo.id; });

  const bin = (title, month, by) => ({title, pct: by ? 100 : 0, req: false, reqAt: 0, apBy: by || '', ...(by ? {apAt: now} : {}), month, type: 'binary', target: 0, unit: '', cur: 0});
  const count = (title, target, unit) => ({title, pct: 0, req: false, reqAt: 0, apBy: '', month: later(5), type: 'count', target, unit, cur: 0});
  const monthly = (title, target, unit) => ({title, pct: 0, req: false, reqAt: 0, apBy: '', type: 'monthly', target, unit, cur: 0});
  const okr = (owner, objective, krs) => ({id: uuid(), objective, owner, sub: '', year: y, updates: [], krs, sample: true});
  const okrs = [
    okr('Company', 'Grow revenue by 30% this year', [count('Sign 40 new customers', 40, 'customers'), bin('Launch the referral programme', later(1))]),
    okr('Tunde Bakare', 'Build a sales pipeline we can rely on', [count('Hold 60 discovery calls', 60, 'calls'), bin('Hire a second account executive', later(2))]),
    okr('Kemi Adeyemi', 'Close more of the deals we start', [count('Close 24 deals', 24, 'deals'), monthly('Book 10 demos every month', 10, 'demos')]),
    okr('Femi Johnson', 'Keep every lead warm', [count('Follow up on 200 leads', 200, 'leads'), bin('Clean up the customer list', m, 'Tunde Bakare')]),
    okr('Ngozi Eze', 'Ship the mobile app', [bin('Beta in testers\' hands', m, ceo.name), bin('Public launch', later(1))]),
    okr('Zainab Musa', 'Make signing up effortless', [count('Run 12 user interviews', 12, 'interviews'), bin('New sign-up designs approved', m)]),
    okr('Chidi Obi', 'Make the app fast', [bin('Start-up time under 2 seconds', later(1)), count('Fix 30 reported bugs', 30, 'bugs')]),
  ];
  const of = n => okrs.find(o => o.owner === n);
  const stand = (owner, text, status, n = null, unit = '', kr = null) =>
    ({id: uuid(), week: wk, day, owner, text, status, n, unit, okr: kr == null ? '' : of(owner).id, kr, ts: now, sample: true});
  const standups = [
    stand('Tunde Bakare', 'Discovery calls with new leads', 'Done', 9, 'calls', 0),
    stand('Kemi Adeyemi', 'Closed deals with two retailers', 'Done', 2, 'deals', 0),
    stand('Kemi Adeyemi', 'Product demos', 'Done', 4, 'demos', 1),
    stand('Femi Johnson', 'Followed up on this week\'s leads', 'Done', 35, 'leads', 0),
    stand('Ngozi Eze', 'Planned the launch with marketing', 'In progress'),
    stand('Zainab Musa', 'User interviews', 'Done', 3, 'interviews', 0),
    stand('Chidi Obi', 'Fixed bugs from the beta', 'Done', 6, 'bugs', 1),
    stand('Chidi Obi', 'Profile the app\'s start-up', 'Not done'),
  ];
  const leave = [];
  if (leaveType) {
    const away = (owner, from, len, status, apBy) => ({id: uuid(), owner, from, to: shiftDay(from, len - 1), days: len, type: leaveType, status,
      by: owner, at: now, apBy: apBy || '', ...(apBy ? {decidedAt: now} : {}), sample: true});
    leave.push(away('Kemi Adeyemi', shiftDay(day, 21), 5, 'Approved', 'Tunde Bakare'), away('Zainab Musa', shiftDay(day, 10), 2, 'Requested'));
  }
  return {people, okrs, stand: standups, leave};
}
