// The platform owners' page (TPD-1889): see every organization, send a locked-out CEO a link, pause an organization
// (spam, abuse) and bring it back. Companies sign up themselves; nobody here creates or approves them. Owners sign in here with their own accounts;
// nobody signed in to an organization can use it. The server checks every request (src/admin.js).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
const val = id => document.getElementById(id)?.value ?? '';
const token = () => new URLSearchParams(location.search).get('token') || '';

let phase = 'boot', me = null, orgs = [], out = null, confirmPause = null, authMsg = '', link = null;

async function api(url, {method = 'GET', json} = {}) {
  const res = await fetch(url, {method, credentials: 'same-origin',
    headers: {...(json !== undefined ? {'Content-Type': 'application/json'} : {}), ...(method !== 'GET' ? {'X-OKR': '1'} : {})},
    body: json !== undefined ? JSON.stringify(json) : undefined});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'Something went wrong. Try again.'); err.status = res.status; throw err; }
  return data;
}
let tt; function toast(m) { if (!m) return; const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 5000); }

async function load() {
  try {
    me = (await api('/api/platform/me')).owner;
    const r = await api('/api/platform/orgs');
    orgs = r.orgs; phase = 'app';
  } catch (err) {
    if (err.status === 401) { phase = 'login'; me = null; } else toast(err.message);
  }
  render();
}

// ---------- dates ----------
const day = ms => new Date(ms).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
function ago(ms) {
  if (!ms) return 'Not yet';
  const mins = Math.round((Date.now() - ms) / 60e3);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} minutes ago`;
  const d = new Date(ms), t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today, ' + d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return day(ms);
}

// ---------- screens ----------
const field = (id, label, type, extra = '') => `<label class="f">${label}<input type="${type}" id="${id}" ${extra}></label>`;
function authCard(title, body) {
  return `<div class="authwrap"><div class="card auth"><div class="brandrow"><span class="logo" aria-hidden="true"></span><h1>Team OKR Tracker</h1></div>
    <h2 style="font-size:17px">${esc(title)}</h2>${body}</div></div>`;
}
function authView() {
  const err = authMsg ? `<p class="err" role="alert">${esc(authMsg)}</p>` : '';
  if (phase === 'login') return authCard('Platform sign-in', `<p class="sub" style="margin:0">For the people who run the platform. Company staff sign in at <a href="/">the main page</a>.</p>
    <form data-submit="login">${field('li-email', 'Email', 'email', 'autocomplete="username" required')}${field('li-pass', 'Password', 'password', 'autocomplete="current-password" required')}
    ${err}<button class="btn" type="submit">Sign in</button></form>`);
  if (phase === 'setpw') {
    if (!link) return authCard('Platform link', `${err || '<p class="sub">Checking the link…</p>'}`);
    return authCard('Choose your password', `<p class="sub" style="margin:0">For the platform account <b>${esc(link.email)}</b>.</p>
      <form data-submit="setpw">${field('pw1', 'Password, at least 10 characters', 'password', 'autocomplete="new-password" minlength="10" required')}
      ${field('pw2', 'The same password again', 'password', 'autocomplete="new-password" minlength="10" required')}${err}<button class="btn" type="submit">Save password</button></form>`);
  }
  return '<p class="empty">Loading…</p>';
}

function orgRow(o) {
  const paused = o.status !== 'active';
  const ceo = o.ceo ? `<b>${esc(o.ceo.name)}</b><div class="sub">${esc(o.ceo.email)}</div>${o.ceo.ready ? '' : `<div style="margin-top:4px">${chip('Invite not used yet', 'warn')}</div>`}` : '<span class="sub">No CEO yet</span>';
  const acts = confirmPause === o.id
    ? `<span class="sub">Nobody in ${esc(o.name)} will be able to sign in. Nothing is deleted.</span><button class="btn bad sm" data-act="pause" data-id="${o.id}">Pause</button><button class="btn quiet sm" data-act="nopause">Cancel</button>`
    : paused ? `<button class="btn sm" data-act="resume" data-id="${o.id}">Bring back</button>`
    : `${o.ceo ? `<button class="btn ghost sm" data-act="resend" data-id="${o.id}">${o.ceo.ready ? 'Reset CEO password' : 'Resend invite'}</button>` : ''}<button class="btn quiet sm" data-act="askpause" data-id="${o.id}">Pause</button>`;
  return `<tr><td><b>${esc(o.name)}</b><div class="sub" style="font-family:var(--mono);font-size:12px">${esc(o.id)}</div></td><td>${ceo}</td>
    <td class="num">${o.people}</td><td style="white-space:nowrap">${esc(day(o.createdAt))}</td><td style="white-space:nowrap">${esc(ago(o.lastAt))}</td>
    <td>${paused ? chip('Paused', 'bad') : chip('Running', 'good')}</td><td><div class="row" style="gap:8px">${acts}</div></td></tr>`;
}
function appView() {
  const running = orgs.filter(o => o.status === 'active').length, paused = orgs.length - running;
  const people = orgs.reduce((n, o) => n + o.people, 0);
  return `<div class="pf"><header class="top"><div class="brandrow"><span class="logo" aria-hidden="true"></span><h1>Team OKR Tracker</h1>${chip('Platform', 'acc')}</div>
      <div class="row"><span class="sub">${esc(me.name || me.email)}</span><button class="btn quiet sm" data-act="signout">Sign out</button></div></header>
    <main>
      <div class="pagehead"><div><h1>Organizations</h1><p class="sub">${orgs.length} on the platform: ${running} running${paused ? `, ${paused} paused` : ''}, ${people} ${people === 1 ? 'person' : 'people'} in all. Only the platform's owners can see this page.</p></div></div>
      ${out ? `<section class="card" aria-live="polite"><div class="sec-h"><h2 style="font-size:16px">${esc(out.title)}</h2><button class="btn quiet sm" data-act="closeout">Close</button></div>
        <p style="margin:0">${esc(out.msg)}</p>
        <div class="linkbox"><input type="text" id="link-url" value="${esc(out.url)}" readonly aria-label="Link"><button class="btn sm" data-act="copylink">Copy</button></div>
        <p class="sub" style="margin:0">Anyone with this link can ${out.kind === 'invite' ? 'take over the CEO account' : 'reset that password'}, so send it only to them.</p></section>` : ''}
      <section class="card"><div class="sec-h"><h2>Every organization</h2></div>
        ${orgs.length ? `<div class="tblwrap"><table><thead><tr><th>Organization</th><th>CEO</th><th class="num">People</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>${orgs.map(orgRow).join('')}</tbody></table></div>` : '<div class="empty"><p>No organizations yet.</p></div>'}
      </section>
    </main></div>`;
}

function render() {
  const keep = ['li-email'].map(id => [id, val(id)]);
  $('#root').innerHTML = phase === 'app' ? appView() : authView();
  keep.forEach(([id, v]) => { const el = document.getElementById(id); if (el && v) el.value = v; });
}

// ---------- what the buttons and forms do ----------
const root = $('#root');
root.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id, o = orgs.find(x => x.id === id);
  if (a === 'copylink') {
    const el = $('#link-url'); if (!el) return;
    el.select();
    try { await navigator.clipboard.writeText(el.value); toast('Link copied.'); } catch { toast('Select the link and copy it.'); }
    return;
  }
  if (a === 'askpause') { confirmPause = id; return render(); }
  if (a === 'nopause') { confirmPause = null; return render(); }
  if (a === 'closeout') { out = null; return render(); }
  try {
    if (a === 'signout') { await api('/api/platform/logout', {method: 'POST', json: {}}); phase = 'login'; me = null; out = null; return render(); }
    if (a === 'resend') { const r = await api(`/api/platform/orgs/${id}/link`, {method: 'POST', json: {}}); out = {title: `${o.name}: ${r.kind === 'invite' ? 'new invite' : 'password reset'}`, ...r}; }
    if (a === 'pause' || a === 'resume') { const r = await api(`/api/platform/orgs/${id}/${a === 'pause' ? 'suspend' : 'resume'}`, {method: 'POST', json: {}}); toast(r.msg); confirmPause = null; }
  } catch (err) { toast(err.message); if (err.status === 401) phase = 'login'; }
  await load();
});
root.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target.dataset.submit;
  authMsg = '';
  try {
    if (f === 'login') { await api('/api/platform/login', {method: 'POST', json: {email: val('li-email'), password: val('li-pass')}}); return load(); }
    if (f === 'setpw') {
      if (val('pw1') !== val('pw2')) { authMsg = 'The two passwords don\'t match.'; return render(); }
      await api('/api/platform/password', {method: 'POST', json: {token: token(), password: val('pw1')}});
      history.replaceState(null, '', '/platform');
      return load();
    }
  } catch (err) {
    if (phase === 'app') { toast(err.message); if (err.status === 401) { phase = 'login'; } render(); }
    else { authMsg = err.message; render(); }
  }
});

// ---------- start ----------
(async function boot() {
  if (location.pathname === '/platform/setup') {
    phase = 'setpw'; render();
    try { link = await api('/api/platform/link', {method: 'POST', json: {token: token()}}); } catch (err) { authMsg = err.message; }
    return render();
  }
  await load();
})();
