// Section 13: the same alerts the dashboard shows, sent by email. Immediate alerts are queued by the action that
// caused them, inside the same transaction; routine chasing goes out once a day as a single digest per person.
// Every email is logged in the outbox, so HR can prove what went out and see what failed.
import {ALERTS, EMAIL_RE, today, plural} from '../public/model.js';

const RETRY_MINUTES = [1, 5, 30, 120];
const TAB_NAMES = {appr: 'Approvals', okrs: 'OKRs', stand: 'Standup', review: 'Friday Review', ci: 'Check-ins', 'ci-leave': 'Check-ins, leave', 'ci-rev': 'Check-ins, review cycle',
  hire: 'Hiring and onboarding', 'hire-appr': 'Hiring, in approval', 'hire-onb': 'Hiring, onboarding', people: 'Directory', settings: 'Settings'};

export function createMailer({db, M, baseUrl, transport, log = console}) {
  const {S} = M;
  const link = tab => `${baseUrl()}/${tab ? '#' + tab : ''}`;
  const footer = '\n\n--\nTeam OKR Tracker. Open the app to act on this.\nHR chooses which alerts are emailed in Settings.';
  const ins = db.prepare(`INSERT OR IGNORE INTO outbox (key, kind, to_name, to_email, subject, body, status, error, next_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  function queue(kind, name, subject, text, key) {
    const p = M.person(name); if (!p) return;
    const em = (p.email || '').trim();
    // NT-2: someone with no valid address is reported to HR rather than failing silently.
    const status = !EMAIL_RE.test(em) ? 'no-address' : transport ? 'queued' : 'not-set-up';
    const error = status === 'no-address' ? 'No valid email address on their record.' : status === 'not-set-up' ? 'Email is not set up on the server.' : '';
    ins.run(key, kind, name, em, subject, `Hello ${name.split(' ')[0]},\n\n${text}${footer}`, status, error, Date.now(), Date.now());
  }

  // Called by actions, inside their transaction. Only alerts set to "straight away" are queued here.
  function notify(kind, names, {subject, text, tab, key}) {
    // Kinds outside the alert table, such as an invite, always go straight away.
    if (ALERTS[kind] && (S.cfg.mail?.modes?.[kind] || ALERTS[kind][2]) !== 'now') return;
    names.forEach(n => queue(kind, n, subject, tab == null ? text : `${text}\n\nOpen it: ${link(tab)}`, `${key}:${n}`));
  }

  // NT-3: one email a day per person, collecting the chasing alerts. Weekdays only.
  function runDigest(now = new Date()) {
    const d = now.getDay();
    if (d === 0 || d === 6 || now.getHours() < (S.cfg.mail?.digestHour ?? 8)) return 0;
    let n = 0;
    const has = db.prepare('SELECT 1 FROM outbox WHERE key = ?');
    for (const p of S.people) {
      const key = `digest:${today()}:${p.name}`;
      if (has.get(key)) continue;
      const items = M.attentionFor(p).filter(i => i.kind && S.cfg.mail.modes[i.kind] === 'digest');
      if (!items.length) continue;
      const lines = items.map(i => `- ${i.text}${i.tab ? `\n  ${TAB_NAMES[i.tab] || 'Open'}: ${link(i.tab)}` : ''}`).join('\n');
      queue('digest', p.name, `Your day in the OKR tracker: ${plural(items.length, 'thing', 'things')} waiting`, `Here is what is waiting for you today:\n\n${lines}`, key);
      n++;
    }
    return n;
  }

  // Sends what is due. A failed send is retried with growing gaps; after the last try it is marked failed for HR to see.
  // Runs one at a time; a caller who asks while a run is going waits for the next one to finish.
  let chain = Promise.resolve();
  const flush = () => (chain = chain.then(send1, send1));
  async function send1() {
    if (!transport) return;
    {
      const due = db.prepare("SELECT * FROM outbox WHERE status = 'queued' AND next_at <= ? ORDER BY id LIMIT 25").all(Date.now());
      for (const m of due) {
        try {
          await transport.send({to: m.to_email, subject: m.subject, text: m.body, fromName: S.cfg.mail?.fromName, replyTo: S.cfg.mail?.replyTo});
          db.prepare("UPDATE outbox SET status = 'sent', attempts = attempts + 1, error = '', sent_at = ? WHERE id = ?").run(Date.now(), m.id);
        } catch (err) {
          const tries = m.attempts + 1, last = tries > RETRY_MINUTES.length;
          db.prepare('UPDATE outbox SET status = ?, attempts = ?, error = ?, next_at = ? WHERE id = ?')
            .run(last ? 'failed' : 'queued', tries, String(err.message || err).slice(0, 500), Date.now() + (RETRY_MINUTES[tries - 1] || 0) * 60e3, m.id);
          log.error?.(`Email to ${m.to_email} failed (try ${tries}): ${err.message || err}`);
        }
      }
    }
  }

  async function sendTest(p) {
    if (!transport) throw new Error('Email is not set up on the server. Set SMTP_HOST and MAIL_FROM (see README).');
    if (!EMAIL_RE.test(p.email || '')) throw new Error('Your record has no valid email address.');
    await transport.send({to: p.email, subject: 'Test email from Team OKR Tracker', text: `Hello ${p.name.split(' ')[0]},\n\nThis is a test. If you can read it, alerts can reach your inbox.${footer}`,
      fromName: S.cfg.mail?.fromName, replyTo: S.cfg.mail?.replyTo});
    db.prepare(`INSERT INTO outbox (key, kind, to_name, to_email, subject, body, status, next_at, created_at, sent_at, attempts) VALUES (?, 'test', ?, ?, 'Test email', '', 'sent', 0, ?, ?, 1)`)
      .run(`test:${Date.now()}:${p.name}`, p.name, p.email, Date.now(), Date.now());
  }

  function report() {
    const rows = db.prepare('SELECT id, kind, to_name AS name, to_email AS email, subject, status, attempts, error, created_at AS at, sent_at AS sentAt FROM outbox ORDER BY id DESC LIMIT 200').all();
    const count = s => db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE status = ?').get(s).n;
    return {configured: !!transport, server: transport ? transport.describe : '', from: transport ? transport.from : '',
      counts: {sent: count('sent'), queued: count('queued'), failed: count('failed'), noAddress: count('no-address'), notSetUp: count('not-set-up')},
      noEmail: S.people.filter(p => !EMAIL_RE.test(p.email || '')).map(p => p.name), rows};
  }
  // What HR's dashboard needs to know: emails that could not be delivered.
  const problems = () => ({failed: db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status IN ('failed', 'no-address') AND created_at > ?").get(Date.now() - 14 * 864e5).n, configured: !!transport});

  return {notify, runDigest, flush, sendTest, report, problems};
}
