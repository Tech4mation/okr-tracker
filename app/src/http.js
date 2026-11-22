// Small HTTP helpers shared by the platform's router (app.js) and each organization's routes (org.js).
import zlib from 'node:zlib';

export const MAX_JSON = 700 * 1024, MAX_FILE = 5 * 1024 * 1024;
export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
// Returned by a route that wrote the response itself.
export const HANDLED = Symbol('handled');

export const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function send(req, res, status, body, headers = {}) {
  let data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {ok: true});
  const h = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers};
  if (data.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { data = zlib.gzipSync(data); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
  res.writeHead(status, h);
  res.end(data);
}
export const readRaw = (req, max) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', ch => { size += ch.length; if (size > max) { reject(new HttpError(413, max === MAX_FILE ? 'Keep files under 5 MB.' : 'That request is too large.')); req.destroy(); } else chunks.push(ch); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
export const parseJson = buf => {
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { throw new HttpError(400, 'The request wasn\'t valid JSON.'); }
};
