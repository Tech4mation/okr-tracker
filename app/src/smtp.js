// A small SMTP client on node:net and node:tls, so email works with any provider (Google Workspace, Microsoft 365,
// Zoho, Amazon SES, Mailgun and so on) without adding a dependency. Supports implicit TLS (port 465), STARTTLS
// (port 587) and AUTH PLAIN or LOGIN.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';

const clean = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const quoteName = s => { const c = clean(s).replace(/["\\]/g, ''); return /^[\x20-\x7e]*$/.test(c) ? `"${c}"` : encWord(c); };
const b64lines = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');

export function buildMessage({from, fromName, to, replyTo, subject, text}) {
  const domain = String(from).split('@')[1] || 'localhost';
  const headers = [
    `From: ${fromName ? quoteName(fromName) + ' ' : ''}<${clean(from)}>`,
    `To: <${clean(to)}>`,
    ...(replyTo ? [`Reply-To: <${clean(replyTo)}>`] : []),
    `Subject: ${encWord(clean(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + b64lines(String(text).replace(/\r?\n/g, '\r\n'));
}

// One SMTP conversation. Resolves when the server accepts the message; rejects with the server's own words.
export function createSmtpTransport({host, port = 587, secure = false, user = '', pass = '', from, rejectUnauthorized = true, timeoutMs = 30000}) {
  if (!host || !from) return null;
  const describe = `${host}:${port}${secure ? ' (TLS)' : ''}`;
  async function send(msg) {
    let sock = secure ? tls.connect({host, port, servername: host, rejectUnauthorized}) : net.connect({host, port});
    let buf = '', waiting = null, failed = null;
    const wire = s => {
      s.setTimeout(timeoutMs, () => s.destroy(new Error(`The mail server at ${describe} stopped responding.`)));
      s.on('data', d => { buf += d.toString('utf8'); pump(); });
      s.on('error', err => { failed = err; if (waiting) { const w = waiting; waiting = null; w.reject(err); } });
      s.on('close', () => { if (waiting) { const w = waiting; waiting = null; w.reject(new Error('The mail server closed the connection.')); } });
    };
    // A reply is complete at a line of three digits followed by a space.
    function pump() {
      if (!waiting) return;
      const lines = buf.split('\r\n'), done = lines.findIndex(l => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
      if (done < 0) return;
      const reply = lines.slice(0, done + 1); buf = lines.slice(done + 1).join('\r\n');
      const w = waiting; waiting = null; w.resolve({code: +reply[done].slice(0, 3), text: reply.map(l => l.slice(4)).join('\n')});
    }
    const next = () => new Promise((resolve, reject) => { if (failed) return reject(failed); waiting = {resolve, reject}; pump(); });
    async function cmd(line, ...ok) {
      if (line != null) sock.write(line + '\r\n');
      const r = await next();
      if (!ok.includes(r.code)) throw new Error(`The mail server refused ${line ? line.split(' ')[0] : 'the connection'}: ${r.code} ${r.text}`);
      return r;
    }
    wire(sock);
    try {
      await cmd(null, 220);
      const me = os.hostname() || 'localhost';
      let ehlo = await cmd(`EHLO ${me}`, 250);
      if (!secure && /STARTTLS/i.test(ehlo.text)) {
        await cmd('STARTTLS', 220);
        sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error'); sock.setTimeout(0);
        const plain = sock;
        sock = tls.connect({socket: plain, servername: host, rejectUnauthorized});
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
        wire(sock);
        ehlo = await cmd(`EHLO ${me}`, 250);
      }
      if (user) {
        if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) await cmd('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'), 235);
        else { await cmd('AUTH LOGIN', 334); await cmd(Buffer.from(user).toString('base64'), 334); await cmd(Buffer.from(pass).toString('base64'), 235); }
      }
      await cmd(`MAIL FROM:<${clean(from)}>`, 250);
      await cmd(`RCPT TO:<${clean(msg.to)}>`, 250, 251);
      await cmd('DATA', 354);
      const body = buildMessage({...msg, from}).replace(/^\./gm, '..');
      await cmd(body + '\r\n.', 250);
      sock.write('QUIT\r\n');
    } finally {
      setTimeout(() => sock.destroy(), 200).unref?.();
    }
  }
  return {send, describe, from};
}
