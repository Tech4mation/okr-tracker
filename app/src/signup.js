// Companies sign up themselves (TPD-1897). Nobody at the platform creates or approves them.
//   1. Someone enters a company name, their name, work email and a password. We email a link to confirm the
//      address; nothing is created yet, and the password is kept only as a hash.
//   2. Opening the link creates the company, empty, with them as its CEO, and signs them in.
// The form never says whether an address is already in use. If it is, the address's owner gets an email saying
// so instead of a link, so the form can't be used to find out who has an account.
import * as A from './auth.js';
import {EMAIL_RE} from '../public/model.js';
import {fail} from './http.js';
import {SIGNUP_HOURS} from './platform.js';

const FROM_NAME = 'Team OKR Tracker';
const LINK_GONE = 'This link has expired or was already used. Sign up again to get a new one.';

export function createSignup({platform, addOrg, transport, enabled, ip, linkLimit, log = console}) {
  // At most 5 sign-ups an hour from one address, and 3 emails an hour to one inbox.
  const byIp = A.rateLimiter(5, 3600e3), byEmail = A.rateLimiter(3, 3600e3);
  const open = () => !!enabled && !!transport;

  async function start(req, b, base) {
    if (!open()) fail(403, 'Sign-up is switched off on this server.');
    const company = String(b.company || '').trim(), name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    if (!company || company.length > 80) fail(400, 'Enter your company\'s name, up to 80 characters.');
    if (!name || name.length > 80) fail(400, 'Enter your full name, up to 80 characters.');
    if (!EMAIL_RE.test(email) || email.length > 200) fail(400, 'Enter a valid work email address.');
    if (pw.length < 8) fail(400, 'Use a password of at least 8 characters.');
    if (pw.length > 200) fail(400, 'That password is too long.');
    if (!byIp(ip(req))) fail(429, 'Too many sign-ups from here. Wait an hour and try again.');
    const done = {ok: true, msg: `We've sent a link to ${email}. Open it within ${SIGNUP_HOURS} hours to finish setting up ${company}.`};
    if (!byEmail(email)) return done;                              // quietly: the inbox has had enough for now
    const first = name.split(' ')[0];
    const taken = platform.orgOfEmail(email);
    try {
      if (taken) {
        await A.hashPassword(pw);                                  // the same time either way, so timing gives nothing away
        await transport.send({to: email, fromName: FROM_NAME, subject: 'You already have a Team OKR Tracker account',
          text: `Hello ${first},\n\nSomeone, hopefully you, tried to set up a new company on Team OKR Tracker with this email address. It already belongs to ${platform.get(taken)?.name || 'a company'} on Team OKR Tracker, and each address can belong to only one company.\n\nSign in here: ${base}/\nForgotten your password? Ask your HR team or your CEO for a reset link.\n\nIf this wasn't you, you can ignore this email; nothing has changed.`});
      } else {
        const token = platform.signups.add({company, name, email, passHash: await A.hashPassword(pw)});
        await transport.send({to: email, fromName: FROM_NAME, subject: `Confirm your email to set up ${company} on Team OKR Tracker`,
          text: `Hello ${first},\n\nYou asked to set up ${company} on Team OKR Tracker. Open this link to confirm your email address and finish. It works once, within ${SIGNUP_HOURS} hours:\n${base}/confirm?token=${token}\n\nOnce you're in, you are ${company}'s CEO on the tracker: add your people, set who reports to whom, and send them their invites.\n\nIf this wasn't you, ignore this email and nothing will be created.`});
      }
    } catch (err) {
      log.error?.(`Sign-up email to ${email} failed: ${err.message || err}`);
      fail(502, 'We couldn\'t send the email just now. Check the address and try again in a few minutes.');
    }
    return done;
  }

  // Synchronous from start to finish, so one link can't create two companies.
  function confirm(req, res, b) {
    if (!linkLimit(ip(req))) fail(429, 'Too many attempts. Wait a few minutes and try again.');
    const s = platform.signups.byToken(b.token) || fail(400, LINK_GONE);
    if (platform.orgOfEmail(s.email)) { platform.signups.done(s.email); fail(409, 'That email address already belongs to a company. Sign in instead.'); }
    const o = addOrg(s.company);
    const uid = o.createCeo({name: s.name, email: s.email, passHash: s.pass_hash});
    platform.signups.done(s.email);
    o.startSession(res, uid);
    return {ok: true};
  }

  return {
    open,
    handle(req, res, {pathname, body, base}) {
      if (req.method === 'POST' && pathname === '/api/signup') return start(req, body, base);
      if (req.method === 'POST' && pathname === '/api/signup/confirm') return confirm(req, res, body);
      fail(404, 'Not found.');
    },
  };
}
