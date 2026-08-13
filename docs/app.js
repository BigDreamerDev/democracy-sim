/* Republic — client. No build step, no framework. */

const API = (window.API_BASE || '').replace(/\/$/, '');
let TOKEN = localStorage.getItem('republic.token') || '';
let ME = null;
let STATE = null;

/* ------------------------------------------------------------- plumbing */

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    // fetch only throws like this for network-level failures, and by far the
    // commonest one here is CORS: the server answered, the browser binned it.
    console.error('[republic] request to ' + API + path + ' failed before it got a reply:', err);
    const e = new Error('NETWORK');
    e.network = true;
    throw e;
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data?.error || 'The server could not be reached.');
  return data;
}

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3400);
}

const when = d => d ? new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const day = d => d ? new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* "2d 6h" — how long until a scheduled moment. */
function until(d) {
  if (!d) return '';
  const ms = new Date(d) - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24);
  if (dd) return `${dd}d ${h % 24}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function scheduleNote(e) {
  if (e.status === 'nominations' && e.campaign_at) return ` · nominations close in ${until(e.campaign_at)}`;
  if (e.status === 'campaign' && e.opens_at) return ` · poll opens in ${until(e.opens_at)}`;
  if (e.status === 'voting' && e.closes_at) return ` · poll closes in ${until(e.closes_at)}`;
  return '';
}

const PHASE = {
  pending:     ['Cycle not yet begun', 'starts'],
  nominations: ['Nominations open', 'campaigning starts'],
  campaign:    ['Campaigning', 'poll opens'],
  poll:        ['Polls open', 'poll closes']
};

/* Minimal markdown: headings, lists, bold, italic, paragraphs. */
function md(src) {
  const lines = esc(src || '').split('\n');
  let out = '', list = null;
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { close(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) { close(); }
    else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return out;
}

/* ------------------------------------------------------------------- the flag

   The palette is not written in the stylesheet. It is read out of whatever law
   `flag_law_ref` points at, so amending the Flag Act re-skins the whole site.
   Roles are assigned by area: the largest dark band leads, the device becomes
   the accent, the lightest colour becomes the ground. Every result is then
   checked for contrast and darkened until it is legible — a pale yellow flag
   must not produce unreadable text. */

const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgb2hex = ([r, g, b]) => '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = h => {
  const c = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));
const sat = h => { const [r, g, b] = hex2rgb(h).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

/* Darken (or lighten) a colour until it reads clearly against `on`. */
function legible(colour, on, target = 4.5) {
  const towards = lum(on) > 0.4 ? '#000000' : '#FFFFFF';
  let out = colour;
  for (let t = 0; t <= 0.9 && contrast(out, on) < target; t += 0.05) out = mix(colour, towards, t);
  return out;
}

/* Light, dark, or follow the phone.

   Dark cannot be a separate stylesheet here: the palette is derived at runtime
   from whatever the Flag Act says, so the flag has to survive the inversion.
   The rule is that the flag keeps its hue and loses its brightness — the paper
   becomes a very dark tint of the flag's own ground rather than plain black,
   and every accent is re-checked for contrast against the dark card instead of
   the light one. */
const THEMES = ['auto', 'light', 'dark'];
const themePref = () => localStorage.getItem('republic.theme') || 'auto';
const darkNow = () => {
  const t = themePref();
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
};

function setTheme(next) {
  localStorage.setItem('republic.theme', next);
  document.documentElement.dataset.theme = next;
  const btn = $('#themeBtn');
  if (btn) btn.textContent = next === 'dark' ? '☾' : next === 'light' ? '☀' : '◐';
  applyFlagTheme(STATE?.flag);
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (themePref() === 'auto') applyFlagTheme(STATE?.flag); });
}

function applyFlagTheme(flag) {
  const root = document.documentElement;
  if (!flag || !flag.bands?.length) { root.removeAttribute('style'); return; }

  // Area per colour, largest first. Repeating a colour in two bands doubles its weight.
  const area = new Map();
  for (const b of flag.bands) area.set(b.colour, (area.get(b.colour) || 0) + b.weight);
  const byArea = [...area.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);

  const ground = byArea.slice().sort((a, b) => lum(b) - lum(a))[0];          // the lightest band
  const dark = byArea.filter(c => lum(c) < 0.6).sort((a, b) => area.get(b) - area.get(a));
  const primary = flag.primary || dark[0] || byArea.find(c => c !== ground) || byArea[0];

  // A near-white or near-black band carries no hue worth using as an accent, so
  // skip it. A flag of three greys falls back to its own primary rather than
  // inventing a colour that is not on it.
  const accentRaw = flag.accent || flag.device
    || byArea.filter(c => c !== primary && sat(c) > 0.15).sort((a, b) => sat(b) - sat(a))[0]
    || primary;

  const night = darkNow();

  // The tint carries the flag's hue; the theme decides the brightness. In light
  // the ground is washed pale, in dark it is taken almost to black — either way
  // the colour on the page is the colour on the flag.
  let wash = ground;
  if (night) {
    for (let i = 0; i < 24 && lum(wash) > 0.06; i++) wash = mix(wash, '#000000', 0.28);
  } else {
    for (let i = 0; i < 24 && lum(wash) < 0.75; i++) wash = mix(wash, '#FFFFFF', 0.15);
  }
  const paper = night ? mix('#0E1014', wash, 0.30) : mix('#E9EAEC', wash, 0.28);
  const card = night ? mix('#171A20', wash, 0.24) : mix('#F5F6F7', wash, 0.22);
  const ink = lum(paper) > 0.5 ? '#14161C' : '#F2F3F5';

  // legible() walks the colour towards black on a light card and towards white
  // on a dark one, so the same call does the right thing in both themes.
  const accent = legible(accentRaw, card);            // links and text
  const accentFill = accentRaw;                       // buttons, seats, the brand dot
  const onAccent = contrast('#FFFFFF', accentFill) >= 3.2 ? '#FFFFFF' : '#14161C';
  // The top bar is a solid block of the flag's primary with white on it. In dark
  // it is darkened further so it reads as a bar rather than a glowing panel.
  const bar = night ? mix(legible(primary, '#FFFFFF', 3.5), '#000000', 0.35)
                    : legible(primary, '#FFFFFF', 3.5);

  const set = (k, v) => root.style.setProperty(k, v);
  set('--paper', paper);
  set('--card', card);
  set('--ink', ink);
  set('--rule', mix(paper, ink, 0.22));
  set('--ink-2', mix(paper, ink, 0.62));
  set('--ink-3', mix(paper, ink, 0.42));
  set('--box', bar);
  set('--indelible', accent);
  set('--indelible-fill', accentFill);
  set('--on-accent', onAccent);
  set('--indelible-soft', mix(card, accentFill, night ? 0.26 : 0.16));
  set('--shadow', night ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.07)');
  root.style.colorScheme = night ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bar);
}

/* Draws the flag itself from the same schedule, so the picture and the palette
   can never drift apart. */
function flagSvg(flag, w = 300) {
  if (!flag?.bands?.length) return '';
  const h = Math.round(w * 0.6);
  const total = flag.bands.reduce((n, b) => n + b.weight, 0) || 1;
  let y = 0, out = `<svg viewBox="0 0 ${w} ${h}" class="flag" role="img" aria-label="Flag of the Republic">`;
  for (const b of flag.bands) {
    const bh = h * (b.weight / total);
    out += `<rect x="0" y="${y.toFixed(2)}" width="${w}" height="${(bh + 0.5).toFixed(2)}" fill="${esc(b.colour)}"/>`;
    y += bh;
  }
  if (flag.stars > 0 && flag.device) {
    const cx = w / 2, cy = h / 2, ring = h * 0.2393, r = h * 0.0329, pts = 12;
    for (let i = 0; i < flag.stars; i++) {
      const a = (i / flag.stars) * Math.PI * 2 - Math.PI / 2;
      const sx = cx + ring * Math.cos(a), sy = cy + ring * Math.sin(a);
      let d = '';
      for (let k = 0; k < pts * 2; k++) {
        const rad = k % 2 ? r * 0.52 : r;
        const t = (k / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
        d += `${k ? 'L' : 'M'}${(sx + rad * Math.cos(t)).toFixed(2)} ${(sy + rad * Math.sin(t)).toFixed(2)}`;
      }
      out += `<path d="${d}Z" fill="${esc(flag.device)}"/>`;
    }
  }
  return out + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(0,0,0,.18)"/></svg>`;
}

const statusTag = s => {
  const map = {
    draft: '', tabled: 'on-navy', division: 'on-violet', passed: 'on-green',
    enacted: 'on-green', failed: 'on-oxide', vetoed: 'on-oxide', withdrawn: '',
    nominations: 'on-navy', campaign: 'on-violet', voting: 'on-violet', closed: ''
  };
  return `<span class="tag ${map[s] ?? ''}">${esc(s)}</span>`;
};

/* Every action button goes through this. It disables while the request is in
   flight, which stops the double-submits that produce "you have already voted"
   as a reward for an impatient tap, and gives the tap something to answer. */
async function busy(btn, fn) {
  if (!btn || btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const was = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); }
  finally { delete btn.dataset.busy; btn.disabled = false; btn.innerHTML = was; }
}

/* Wire a set of buttons to an action, refreshing only what changed. */
function onAction(selector, handler) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.onclick = () => busy(btn, async () => {
      try { await handler(btn); }
      catch (err) { toast(err.message, true); }
    });
  });
}

const isAdmin = () => !!ME?.is_admin;
const canPropose = () => STATE?.config?.bill_proposers === 'citizens'
  || !!ME?.offices?.some(o => o === 'mp' || o === 'speaker');

/* Holding an office, not administering one. The Returning Officer is deliberately
   excluded: they keep the Returning officer page and nothing else, so their screen
   shows what they actually are rather than every office at once. */
const has = o => !!ME?.offices?.includes(o);

/* ----------------------------------------------------------------- gate */

function showGate(msg) {
  $('#gate').hidden = false;
  $('#shell').hidden = true;
  if (msg) $('#gateMsg').textContent = msg;
}

document.querySelectorAll('[data-gate]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-gate]').forEach(x => x.classList.toggle('is-on', x === b));
  $('#formIn').hidden = b.dataset.gate !== 'in';
  $('#formUp').hidden = b.dataset.gate !== 'up';
  $('#gateMsg').textContent = '';
});

$('#formIn').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: f });
    TOKEN = r.token; localStorage.setItem('republic.token', TOKEN);
    await start();
  } catch (err) { $('#gateMsg').textContent = err.message; }
};

$('#formUp').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('/api/auth/register', { method: 'POST', body: f });
    if (r.pending) {
      const m = $('#gateMsg');
      m.className = 'gate-msg ok';
      m.textContent = 'Account created. The returning officer has to approve you before you can sign in.';
      e.target.reset();
      return;
    }
    TOKEN = r.token; localStorage.setItem('republic.token', TOKEN);
    await start();
  } catch (err) { $('#gateMsg').textContent = err.message; }
};

if ($('#themeBtn')) {
  $('#themeBtn').textContent = themePref() === 'dark' ? '☾' : themePref() === 'light' ? '☀' : '◐';
  $('#themeBtn').onclick = () => setTheme(THEMES[(THEMES.indexOf(themePref()) + 1) % THEMES.length]);
}

$('#signout').onclick = () => {
  localStorage.removeItem('republic.token');
  TOKEN = ''; ME = null;
  location.hash = '';
  location.reload();
};

/* --------------------------------------------------------------- router */

/* Extra pages, added by the Act modules in acts.js. Kept as a separate surface so
   those can be dropped in or removed without touching anything in here. */
const SUBROUTES = {};

const ROUTES = [
  ['chamber', 'Chamber', viewChamber],
  ['elections', 'Elections', viewElections],
  ['bills', 'Bills', viewBills],
  ['laws', 'Statute book', viewLaws],
  ['constitution', 'Constitution', viewConstitution],
  ['parties', 'Parties', viewParties],
  ['citizens', 'Citizens', viewCitizens],
  ['people', 'The People', viewPeople],
  ['emergency', 'Article 12', viewEmergency],
  ['record', 'Record', viewRecord],
  ['me', 'My account', viewMe],
  ['admin', 'Returning officer', viewAdmin]
];

function drawRail() {
  const path = (location.hash.slice(2) || 'chamber').split('/')[0];
  $('#rail').innerHTML = ROUTES
    .filter(r => r[0] !== 'admin' || isAdmin())
    .map(([k, label]) => `<a href="#/${k}" class="${k === path ? 'is-on' : ''}">${label}</a>`).join('');
}

async function route() {
  if (!ME) return;
  const parts = (location.hash.slice(2) || 'chamber').split('/');
  drawRail();
  const view = $('#view');
  view.innerHTML = `<div class="skeleton"><div class="sk sk-title"></div><div class="sk sk-line"></div>
    <div class="sk sk-card"></div><div class="sk sk-card"></div></div>`;
  const single = { election: viewElection, bill: viewBill, party: viewParty, ...SUBROUTES }[parts[0]];
  const fn = single || (ROUTES.find(r => r[0] === parts[0])?.[2]) || viewChamber;
  try {
    await fn(view, parts[1]);
  } catch (err) {
    view.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

/* Article 12. While a declaration is in force it is the most important fact
   about the Republic, so it sits above everything on every page — and it always
   carries the way to end it. */
async function drawEmergency() {
  let e;
  try { e = await api('/api/emergency'); } catch { return; }
  const bar = $('#emergency');
  if (!bar) return;
  if (!e.in_force) { bar.innerHTML = ''; bar.hidden = true; return; }

  const em = e.in_force;
  const left = new Date(em.expires_at) - Date.now();
  const hrs = Math.max(0, Math.floor(left / 3600000));
  const mins = Math.max(0, Math.floor((left % 3600000) / 60000));
  const canEnd = has('mp') || ME?.id === em.declared_by;

  bar.hidden = false;
  bar.innerHTML = `<div class="emergency">
    <div class="emergency-main">
      <p class="emergency-kicker">Extraordinary circumstances · declared by ${esc(em.declared_by_name || 'the President')}</p>
      <p class="emergency-reason">${esc(em.reasons)}</p>
      <ul class="emergency-powers">${em.powers.map(p => `<li>${esc(e.powers_available[p] || p)}</li>`).join('')}</ul>
      <p class="emergency-meta">Lapses in ${hrs}h ${mins}m unless ended sooner · ${e.end_votes} of ${e.end_votes_needed} members have moved to end it</p>
    </div>
    ${canEnd ? `<div class="emergency-act">
      <button class="btn btn-sm btn-no" id="endEmergency" ${e.i_voted_to_end ? 'disabled' : ''}>
        ${e.i_voted_to_end ? 'You have moved to end it' : ME?.id === em.declared_by && !has('mp') ? 'End it' : 'Move to end it'}</button>
    </div>` : ''}
  </div>`;

  if ($('#endEmergency')) $('#endEmergency').onclick = () => busy($('#endEmergency'), async () => {
    try {
      const r = await api('/api/emergency/end', { method: 'POST' });
      toast(r.ended ? 'The declaration is ended. The ordinary law is back.'
        : `Recorded — ${r.votes} of ${r.needed} members.`);
      drawEmergency();
      if (r.ended) route();
    } catch (err) { toast(err.message, true); }
  });
}

async function refreshState() {
  STATE = await api('/api/state');
  $('#navName').textContent = STATE.config.nation_name;
  $('#gateName').textContent = STATE.config.nation_name;
  $('#navMotto').textContent = STATE.config.motto;
  document.title = STATE.config.nation_name;
  applyFlagTheme(STATE.flag);
  drawEmergency();
  const gf = $('#gateFlag');
  if (gf) gf.innerHTML = flagSvg(STATE.flag, 340);
}

async function start() {
  try {
    await refreshState();
  } catch (err) {
    if (!err.network) return showGate(`The server answered with an error: ${err.message}`);
    // Tell the difference between "asleep or wrong address" and "blocked by CORS"
    // by asking for the same URL without CORS in play. If that succeeds, the
    // server is up and the origin is the problem.
    let reachable = false;
    try { await fetch(API + '/api/health', { mode: 'no-cors' }); reachable = true; } catch {}
    return showGate(reachable
      ? `The server is running but is refusing requests from this site. In Render, set ALLOWED_ORIGINS to exactly ${location.origin} (no path, no trailing slash) and redeploy.`
      : `Cannot reach ${API || '(API_BASE is not set)'}. Check API_BASE in docs/config.js, then give Render up to a minute to wake up. Details are in the browser console.`);
  }
  if (!TOKEN) return showGate('');
  try { ME = await api('/api/me'); }
  catch { localStorage.removeItem('republic.token'); TOKEN = ''; return showGate('Your session expired. Sign in again.'); }
  $('#gate').hidden = true;
  $('#shell').hidden = false;
  $('#whoName').textContent = ME.display_name;
  const title = (ME.offices || []).map(o => o === 'mp' ? 'MP' : o[0].toUpperCase() + o.slice(1))[0];
  const badge = $('#whoRole');
  if (badge) { badge.textContent = title || (ME.is_admin ? 'Returning Officer' : 'Citizen'); badge.hidden = false; }
  if (!location.hash) location.hash = '#/chamber';
  await route();
}

/* ------------------------------------------------------------- chamber */

/* Seats are laid out to fit, however many there are. One row while they are
   comfortable; concentric rows once they would touch, the way a real chamber
   does it. The floor arc sits inside the seats so it never crosses them. */
function seatLayout(n, W, H) {
  const cx = W / 2, cy = H * 0.80, span = 152;          // degrees the benches sweep
  const outer = H * 0.60, inner = outer * 0.46;
  for (let rows = 1; rows <= 5; rows++) {
    const radii = rows === 1 ? [outer]
      : Array.from({ length: rows }, (_, i) => inner + (outer - inner) * (i / (rows - 1)));
    const sum = radii.reduce((a, b) => a + b, 0);
    const counts = radii.map(r => Math.max(1, Math.round(n * r / sum)));
    let diff = n - counts.reduce((a, b) => a + b, 0), i = counts.length - 1;
    while (diff !== 0) {                                 // fix rounding, back row first
      counts[i] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
      i = (i - 1 + counts.length) % counts.length;
    }
    if (counts.some(c => c < 1)) continue;

    // Largest radius that keeps neighbours apart along every row...
    let r = 22;
    radii.forEach((R, k) => {
      const c = counts[k];
      const step = c > 1 ? (span / (c - 1)) * Math.PI / 180 : Math.PI;
      r = Math.min(r, R * Math.sin(step / 2) - 2.5);
    });
    // ...and keeps the rows themselves apart.
    if (rows > 1) r = Math.min(r, (outer - inner) / (rows - 1) / 2 - 2);

    if (r >= 11 || rows === 5) return { cx, cy, radii, counts, r: Math.max(6, r), span, floor: inner - Math.max(6, r) - 8 };
  }
}

function hemicycle(offices, seats) {
  const mps = offices.filter(o => o.office === 'mp').sort((a, b) => (a.seat || 0) - (b.seat || 0));
  const speaker = offices.find(o => o.office === 'speaker');
  const n = Math.max(Number(seats) || 1, 1);
  const W = 640, H = 300;
  const L = seatLayout(n, W, H);
  const named = L.r >= 15 && L.radii.length === 1;      // names only fit on a single roomy row

  let svg = `<svg viewBox="0 0 ${W} ${H + (named ? 0 : 0)}" role="img" aria-label="Seating of the chamber">`;
  if (L.floor > 20) {
    svg += `<path d="M ${(L.cx - L.floor).toFixed(1)} ${L.cy} A ${L.floor.toFixed(1)} ${L.floor.toFixed(1)} 0 0 1 ${(L.cx + L.floor).toFixed(1)} ${L.cy}" fill="none" stroke="var(--rule)" stroke-width="1"/>`;
  }

  let seat = 0;
  L.radii.forEach((R, row) => {
    const c = L.counts[row];
    for (let i = 0; i < c; i++, seat++) {
      const deg = c === 1 ? 90 : (90 + L.span / 2) - i * (L.span / (c - 1));
      const t = deg * Math.PI / 180;
      const x = L.cx + R * Math.cos(t), y = L.cy - R * Math.sin(t);
      const m = mps[seat];
      const fill = m ? (m.party_colour || 'var(--ink-3)') : 'none';
      svg += `<circle class="seat ${m ? '' : 'vacant'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${L.r.toFixed(1)}" fill="${esc(fill)}"><title>${esc(m ? `Seat ${seat + 1}: ${m.display_name}` : `Seat ${seat + 1}: vacant`)}</title></circle>`;
      if (L.r >= 9) {
        svg += `<text class="seat-no" x="${x.toFixed(1)}" y="${(y + L.r * 0.34).toFixed(1)}" style="font-size:${Math.min(11, L.r * 0.75).toFixed(1)}px" fill="${m ? '#fff' : 'var(--ink-3)'}">${seat + 1}</text>`;
      }
      if (named) {
        svg += `<text class="seat-name" x="${x.toFixed(1)}" y="${(y + L.r + 14).toFixed(1)}">${esc(m ? m.display_name : 'vacant')}</text>`;
      }
    }
  });

  const cw = Math.min(180, W * 0.34);
  svg += `<rect class="chair" x="${(L.cx - cw / 2).toFixed(1)}" y="${(L.cy + 12).toFixed(1)}" width="${cw}" height="28" rx="2"/>`;
  svg += `<text class="chair-label" x="${L.cx}" y="${(L.cy + 30).toFixed(1)}">${esc(speaker ? 'SPEAKER · ' + speaker.display_name.toUpperCase() : 'SPEAKER · VACANT')}</text>`;
  svg += '</svg>';

  // When the seats are too small to label, the names go underneath instead.
  if (!named) {
    svg += `<div class="seat-key">${Array.from({ length: n }, (_, k) => {
      const m = mps[k];
      return `<span class="seat-chip"><i style="background:${esc(m ? (m.party_colour || 'var(--ink-3)') : 'transparent')};${m ? '' : 'border-style:dashed'}"></i>${k + 1} ${esc(m ? m.display_name : 'vacant')}</span>`;
    }).join('')}</div>`;
  }
  return svg;
}

/* The desk.

   The complaint that produced this: the President's screen looked exactly like
   everyone else's, so holding the highest office in the Republic felt like
   holding none. Every officer now lands on a list of what is waiting for them,
   with the actions inline — assent from the front page, not four taps deep.

   It is built from data the chamber already fetches plus one bills call, so it
   costs one extra request and no extra round trips per item. */
async function deskItems() {
  const out = [];
  const bills = await api('/api/bills');
  const need = Number(STATE.config.seconds_required);

  if (has('president')) {
    for (const b of bills.filter(b => b.status === 'passed')) {
      out.push({
        office: 'President', urgent: true,
        what: `<span class="ref">${esc(b.ref)}</span> ${esc(b.title)} has passed the House`,
        why: 'Nothing becomes law until you assent. A veto is final.',
        actions: `<button class="btn btn-sm btn-aye" data-desk="assent" data-id="${b.id}">Assent</button>
                  <button class="btn btn-sm btn-no" data-desk="veto" data-id="${b.id}">Veto</button>`
      });
    }
  }

  if (has('president')) {
    let em = null;
    try { em = await api('/api/emergency'); } catch {}
    if (em && !em.in_force) {
      out.push({
        office: 'President',
        what: 'Declare extraordinary circumstances',
        why: 'Ask the House to suspend named parts of the ordinary law, for a stated time. Only the House can grant it, and the House alone can end it.',
        actions: '<a class="btn btn-sm" href="#/emergency">Draft a declaration</a>'
      });
    }
  }

  if (has('speaker')) {
    for (const b of bills.filter(b => b.status === 'draft' && b.seconds >= need)) {
      out.push({
        office: 'Speaker',
        what: `<span class="ref">${esc(b.ref)}</span> ${esc(b.title)} has its seconders`,
        why: 'It cannot reach a division until you table it.',
        actions: `<button class="btn btn-sm btn-primary" data-desk="table" data-id="${b.id}">Table it</button>`
      });
    }
    for (const b of bills.filter(b => b.status === 'tabled')) {
      out.push({
        office: 'Speaker',
        what: `<span class="ref">${esc(b.ref)}</span> ${esc(b.title)} is tabled`,
        why: 'The House is waiting on you to call the division.',
        actions: `<button class="btn btn-sm btn-primary" data-desk="division" data-id="${b.id}">Call the division</button>`
      });
    }
    for (const b of bills.filter(b => b.status === 'division')) {
      out.push({
        office: 'Speaker',
        what: `<span class="ref">${esc(b.ref)}</span> ${esc(b.title)} is in division`,
        why: 'Close it when the House has spoken. Nothing closes itself.',
        actions: `<button class="btn btn-sm" data-desk="close" data-id="${b.id}">Close the division</button>`
      });
    }
  }

  if (has('mp')) {
    for (const b of bills.filter(b => b.status === 'division')) {
      const full = await api('/api/bills/' + b.id);
      if (full.my_vote || !full.can_vote) continue;
      out.push({
        office: 'Member', urgent: true,
        what: `<span class="ref">${esc(b.ref)}</span> ${esc(b.title)}`,
        why: `${full.counts.aye} aye · ${full.counts.no} no · ${full.counts.eligible - full.division.length} yet to vote. You are one of them.`,
        actions: `<button class="btn btn-sm btn-aye" data-desk="aye" data-id="${b.id}">Aye</button>
                  <button class="btn btn-sm btn-no" data-desk="no" data-id="${b.id}">No</button>
                  <button class="btn btn-sm" data-desk="abstain" data-id="${b.id}">Abstain</button>`
      });
    }
  }

  // Everyone: a poll you have not voted in is the most urgent thing there is.
  for (const e of STATE.elections.filter(e => e.status === 'voting')) {
    const full = await api('/api/elections/' + e.id);
    if (!full.can_vote || full.my_vote || full.my_choice) continue;
    out.push({
      office: 'Citizen', urgent: true,
      what: `${esc(e.title)} is open`,
      why: `${full.turnout} of ${full.eligible} have voted. You have not.`,
      actions: `<a class="btn btn-sm btn-primary" href="#/election/${e.id}">Go and vote</a>`
    });
  }

  if (STATE.stats?.petitions) {
    out.push({
      office: 'Citizen',
      what: `${STATE.stats.petitions} initiative${STATE.stats.petitions > 1 ? 's need' : ' needs'} signatures`,
      why: 'Enough names and it goes before the House without anyone\'s permission.',
      actions: '<a class="btn btn-sm" href="#/bills">Have a look</a>'
    });
  }
  return out;
}

async function drawDesk() {
  const box = $('#desk');
  if (!box) return;
  let items = [];
  try { items = await deskItems(); } catch { box.innerHTML = ''; return; }

  const titles = [...new Set(items.map(i => i.office))];
  box.innerHTML = `<section class="desk ${items.some(i => i.urgent) ? 'is-urgent' : ''}">
    <div class="desk-head">
      <p class="eyebrow">${titles.length ? esc(titles.join(' · ')) : 'Your desk'}</p>
      <h2>${items.length ? `${items.length} thing${items.length > 1 ? 's' : ''} waiting on you` : 'Nothing waiting on you'}</h2>
    </div>
    ${items.length ? items.map(i => `<div class="desk-item ${i.urgent ? 'is-urgent' : ''}">
      <div class="desk-what"><div>${i.what}</div><p class="desk-why">${i.why}</p></div>
      <div class="desk-actions">${i.actions}</div>
    </div>`).join('')
    : `<p class="desk-idle">The Republic is not waiting on you. ${has('president') ? 'Bills come here for assent when the House passes them.' : has('speaker') ? 'Bills appear here when they have their seconders.' : 'Polls and divisions you can take part in will appear here.'}</p>`}
  </section>`;

  const paths = { assent: 'assent', veto: 'assent', table: 'table', division: 'division', close: 'close' };
  onAction('[data-desk]', async btn => {
    const kind = btn.dataset.desk, id = btn.dataset.id;
    if (['aye', 'no', 'abstain'].includes(kind)) {
      await api(`/api/bills/${id}/vote`, { method: 'POST', body: { vote: kind } });
      toast(`Voted ${kind}.`);
    } else {
      const r = await api(`/api/bills/${id}/${paths[kind]}`, {
        method: 'POST', body: kind === 'veto' ? { veto: true } : {}
      });
      toast(r.result ? `${r.carried ? 'Carried' : 'Lost'} — ${r.result}`
        : kind === 'veto' ? 'Vetoed. That is the end of it.'
        : kind === 'assent' ? 'Assented. It is law.' : 'Done.');
    }
    await refreshState();
    drawDesk();                       // only the desk redraws, not the page
  });
}

async function viewChamber(v) {
  await refreshState();
  const { offices, config, stats, elections, bills, parties } = STATE;
  const pres = offices.find(o => o.office === 'president');
  const spk = offices.find(o => o.office === 'speaker');
  const pm = offices.find(o => o.office === 'prime_minister');

  v.innerHTML = `
    <h1 class="page">${esc(config.nation_name)}</h1>
    <p class="page-sub">${esc(config.motto)}</p>

    <div id="desk"></div>

    ${STATE.cycle ? `<div class="cycle">
      <div>
        <p class="eyebrow">Cycle ${STATE.cycle.number} · day ${Math.max(1, Math.floor((Date.now() - new Date(STATE.cycle.start)) / 86400000) + 1)} of ${config.cycle_days}</p>
        <strong>${PHASE[STATE.cycle.phase][0]}</strong>
      </div>
      <div class="cycle-next">
        <span>${PHASE[STATE.cycle.phase][1]} in</span>
        <strong>${until(STATE.cycle.next_at)}</strong>
      </div>
    </div>` : ''}

    ${STATE.flag ? `<section class="card flag-block">
      ${flagSvg(STATE.flag, 260)}
      <div class="flag-note">
        <p class="eyebrow">The flag · ${esc(STATE.flag.law_ref)} ${esc(STATE.flag.law_title)}</p>
        <p class="small">These are the colours of the Republic, and the colours of this site. They are set by law — amend <a href="#/laws">${esc(STATE.flag.law_ref)}</a> and everything here changes with it.</p>
        <div class="swatches">${[...STATE.flag.bands.map(b => [b.colour, b.label]),
            ...(STATE.flag.device ? [[STATE.flag.device, 'Device']] : [])]
            .map(([c, l]) => `<span class="swatch-chip"><i style="background:${esc(c)}"></i>${esc(l || c)}</span>`).join('')}</div>
      </div>
    </section>` : ''}

    <section class="chamber">
      <p class="eyebrow">The chamber · ${config.seats} seats</p>
      ${hemicycle(offices, Number(config.seats))}
      <div class="offices">
        <div class="office"><p class="eyebrow">President</p><strong>${esc(pres?.display_name || 'Vacant')}</strong>
          <p class="office-note">Appoints the Prime Minister · assents to constitutional bills</p></div>

        <div class="office ${pm ? '' : 'is-vacant'}"><p class="eyebrow">Prime Minister</p>
          <strong>${esc(pm?.display_name || 'Vacant')}</strong>
          <p class="office-note">${pm
            ? 'Assents to ordinary bills · holds office while the House allows'
            : 'No ordinary bill can become law until the President appoints one and the House confirms'}</p>
          ${!pm && has('president') ? '<a class="btn btn-sm btn-primary" href="#/prime-minister" style="margin-top:8px">Appoint one</a>' : ''}
          ${!pm && has('mp') && !has('president') ? '<a class="btn btn-sm" href="#/prime-minister" style="margin-top:8px">See the appointment</a>' : ''}
        </div>

        <div class="office"><p class="eyebrow">Speaker</p><strong>${esc(spk?.display_name || 'Vacant')}</strong>
          <p class="office-note">Tables bills, calls and closes divisions, breaks ties</p></div>
      </div>
    </section>

    <div class="grid2">
      <div class="card">
        <h2>Open elections</h2>
        ${elections.length ? `<div class="list">${elections.map(e => `
          <a class="item" href="#/election/${e.id}">
            <div class="item-top"><span class="item-title">${esc(e.title)}</span>${statusTag(e.status)}</div>
            <div class="item-meta">${esc(e.kind)}${e.seats > 1 ? ` · ${e.seats} seats` : ''}${e.closes_at ? ` · closes ${when(e.closes_at)}` : ''}</div>
          </a>`).join('')}</div>` : '<div class="empty">No election is running.</div>'}
      </div>

      <div class="card">
        <h2>Before the house</h2>
        ${bills.length ? `<div class="list">${bills.map(b => `
          <a class="item" href="#/bill/${b.id}">
            <div class="item-top"><span class="item-title"><span class="ref">${esc(b.ref)}</span> ${esc(b.title)}</span>${statusTag(b.status)}</div>
            <div class="item-meta">${esc(b.kind)}</div>
          </a>`).join('')}</div>` : '<div class="empty">Nothing on the order paper.</div>'}
      </div>
    </div>

    <div class="card">
      <h2>Where things stand</h2>
      <div class="row small">
        ${stats.petitions ? `<a class="tag on-violet" href="#/bills">${stats.petitions} initiative${stats.petitions > 1 ? 's' : ''} need signatures</a>` : ''}
        ${stats.referendums ? `<a class="tag on-violet" href="#/elections">${stats.referendums} referendum${stats.referendums > 1 ? 's' : ''} open</a>` : ''}
        <span class="tag">${stats.citizens} citizens</span>
        <span class="tag">${stats.laws} laws in force</span>
        <span class="tag">constitution v${stats.constitution_version ?? 1}</span>
        <span class="tag">${parties.length} parties</span>
      </div>
    </div>`;
  drawDesk();
}

/* ----------------------------------------------------------- elections */

async function viewElections(v) {
  const list = await api('/api/elections');
  v.innerHTML = `
    <h1 class="page">Elections</h1>
    <p class="page-sub">One citizen, one vote, no takebacks</p>
    ${isAdmin() ? `
    <div class="card">
      <h2>Call an election</h2>
      <form id="mk" class="stack">
        <div class="grid2">
          <label class="field"><span>Type</span><select name="kind">
            <option value="parliament">Parliament (${STATE.config.seats} seats)</option>
            <option value="president">President</option>
            <option value="speaker">Speaker (MPs vote)</option>
            <option value="referendum">Referendum</option>
          </select></label>
          <label class="field"><span>Closes (optional)</span><input type="datetime-local" name="closes_at"></label>
        </div>
        <label class="field"><span>Title</span><input name="title" placeholder="e.g. Second general election"></label>
        <button class="btn btn-primary">Call it</button>
      </form>
    </div>` : ''}
    ${list.length ? `<div class="list">${list.map(e => `
      <a class="item" href="#/election/${e.id}">
        <div class="item-top"><span class="item-title">${esc(e.title)}</span>${statusTag(e.status)}</div>
        <div class="item-meta">${esc(e.kind)} · ${e.runners} standing · ${e.turnout} votes cast${e.seats > 1 ? ` · ${e.seats} seats` : ''}${e.auto ? ' · on the clock' : ''}${scheduleNote(e)}</div>
      </a>`).join('')}</div>` : '<div class="empty">No elections have been held yet.</div>'}`;

  if (isAdmin()) $('#mk').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.closes_at) delete f.closes_at;
    try { const r = await api('/api/elections', { method: 'POST', body: f }); location.hash = `#/election/${r.id}`; }
    catch (err) { toast(err.message, true); }
  };
}

async function viewElection(v, id) {
  const e = await api('/api/elections/' + id);
  if (e.kind === 'referendum' && (e.law || e.bill)) return renderReferendum(v, e, id);
  const live = e.candidates.filter(c => !c.withdrawn);
  const mine = live.find(c => c.user_id === ME.id);
  const elected = e.status === 'closed' ? live.slice(0, e.seats).filter(c => c.votes > 0).map(c => c.id) : [];
  const top = Math.max(1, ...live.map(c => c.votes || 0));

  let main = '';
  if (e.status === 'campaign') {
    main = `<div class="card"><h2>Campaigning</h2>
      <p>Nominations are closed and the ballot is fixed. Make your case in the chat.
      ${e.opens_at ? `The poll opens in <strong>${until(e.opens_at)}</strong>.` : ''}</p></div>`;
  } else if (e.status === 'nominations') {
    main = `<div class="card">
      <h2>${mine ? 'Your nomination' : 'Stand for election'}</h2>
      <form id="stand" class="stack">
        <label class="field"><span>Why you</span><textarea name="statement" placeholder="Your pitch. The whole chat will read it.">${esc(mine?.statement || '')}</textarea></label>
        <div class="row">
          <button class="btn btn-primary">${mine ? 'Update nomination' : 'Put my name forward'}</button>
          ${mine ? '<button class="btn" id="withdraw" type="button">Withdraw</button>' : ''}
        </div>
      </form>
    </div>`;
  } else if (e.status === 'voting') {
    if (e.my_vote) {
      const c = e.candidates.find(x => x.id === e.my_vote);
      main = `<div class="card"><h2>Your ballot is cast</h2>
        <p>You voted for <strong>${esc(c?.display_name || 'a candidate')}</strong>. That is final.</p>
        <div class="stamp">Ballot recorded</div></div>`;
    } else if (!e.can_vote) {
      main = `<div class="card"><div class="empty">You are not in the electorate for this vote.</div></div>`;
    } else {
      main = `<div class="ballot">
        <div class="ballot-head">Official ballot · mark one · you cannot change it</div>
        ${live.map(c => `<label class="option">
          <input type="radio" name="ballot" value="${c.id}">
          <span class="option-body">
            <span class="option-name">${esc(c.display_name)} ${c.party_abbr ? `<span class="tag">${esc(c.party_abbr)}</span>` : ''}</span>
            ${c.statement ? `<span class="option-statement">${esc(c.statement)}</span>` : ''}
          </span>
        </label>`).join('') || '<div class="empty">Nobody is standing.</div>'}
      </div>
      <div class="row" style="margin-top:14px"><button class="btn btn-primary" id="cast">Cast my vote</button></div>`;
    }
  }

  const results = `<div class="card">
    <h2>${e.status === 'closed' ? 'Result' : 'Standing'}</h2>
    ${live.length ? live.map(c => `
      <div class="result-row ${elected.includes(c.id) ? 'is-elected' : ''}">
        <div>
          <div><strong>${esc(c.display_name)}</strong> ${c.party_abbr ? `<span class="tag">${esc(c.party_abbr)}</span>` : ''}
            ${elected.includes(c.id) ? '<span class="tag on-green">elected</span>' : ''}</div>
          ${c.votes !== null ? `<div class="bar"><span style="width:${Math.round((c.votes / top) * 100)}%"></span></div>` : ''}
        </div>
        <div class="result-count">${c.votes === null ? '—' : c.votes}</div>
      </div>`).join('') : '<div class="empty">No candidates.</div>'}
    <p class="item-meta" style="margin-top:12px">Turnout ${e.turnout} of ${e.eligible}${e.status === 'voting' && STATE.config.secret_ballot === 'true' ? ' · counts hidden until the poll closes' : ''}</p>
  </div>`;

  v.innerHTML = `
    <h1 class="page">${esc(e.title)}</h1>
    <p class="page-sub">${esc(e.kind)} · ${statusTag(e.status)}${e.auto ? ' · run by the clock' : ''}</p>
    ${e.campaign_at || e.opens_at || e.closes_at ? `<div class="card"><p class="eyebrow">Timetable</p>
      <div class="row small">
        ${e.campaign_at ? `<span class="tag">nominations close ${when(e.campaign_at)}</span>` : ''}
        ${e.opens_at ? `<span class="tag">poll opens ${when(e.opens_at)}</span>` : ''}
        ${e.closes_at ? `<span class="tag">poll closes ${when(e.closes_at)}</span>` : ''}
      </div></div>` : ''}
    ${main}
    ${results}
    ${isAdmin() ? `<div class="card"><h2>Returning officer</h2>
      <div class="row">
        <button class="btn" data-set="nominations">Reopen nominations</button>
        <button class="btn" data-set="campaign">Close nominations</button>
        <button class="btn btn-primary" data-set="voting">Open the poll</button>
        <button class="btn" data-set="closed">Close and certify</button>
      </div>
      <p class="small muted" style="margin-top:10px">Certifying seats the winners and vacates the previous holders. Closing a parliamentary election also vacates the Speaker. Touching any of these takes the election off the clock and you run it by hand from then on.</p>
    </div>` : ''}`;

  if ($('#stand')) $('#stand').onsubmit = async ev => {
    ev.preventDefault();
    try {
      await api(`/api/elections/${id}/stand`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
      toast('You are on the ballot.'); route();
    } catch (err) { toast(err.message, true); }
  };
  if ($('#withdraw')) $('#withdraw').onclick = async () => {
    if (!confirm('Withdraw your candidacy?')) return;
    await api(`/api/elections/${id}/withdraw`, { method: 'POST' }); route();
  };
  if ($('#cast')) $('#cast').onclick = async () => {
    const pick = document.querySelector('input[name=ballot]:checked');
    if (!pick) return toast('Mark a candidate first.', true);
    if (!confirm('Cast your vote? You get one and it cannot be changed.')) return;
    try { await api(`/api/elections/${id}/vote`, { method: 'POST', body: { candidacy_id: Number(pick.value) } }); route(); }
    catch (err) { toast(err.message, true); }
  };
  document.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
    try {
      const r = await api(`/api/elections/${id}/status`, { method: 'POST', body: { status: b.dataset.set } });
      if (r.failed) toast(`No Speaker: best was ${r.best} of the ${r.needed} needed from a House of ${r.house}. Ballot ${r.ballot} — the next one needs ${r.next_needed}.`, true);
      else if (r.tie) toast('Tie on the last seat — settle it and appoint manually in the admin page.', true);
      else toast('Updated.');
      route();
    } catch (err) { toast(err.message, true); }
  });
}

/* A referendum asks one question about one law: does it stay or go? */
async function renderReferendum(v, e, id) {
  const pct = n => Math.round(n * 100) + '%';
  const t = e.tally;
  const done = e.status === 'closed';
  const init = !!e.initiative;
  const subject = init ? e.bill : e.law;
  const carried = done && (init ? e.bill.status === 'enacted' : !!e.law.repealed_at);
  const yesWord = init ? 'enact' : 'reject';

  v.innerHTML = `
    <h1 class="page">${esc(e.title)}</h1>
    <p class="page-sub">Referendum · ${statusTag(e.status)}${e.closes_at ? ' · closes ' + when(e.closes_at) : ''}</p>

    <div class="card">
      <p class="eyebrow">${init ? 'The proposal' : 'The law in question'} · ${esc(subject.ref)}</p>
      <div class="prose">${md(subject.body)}</div>
    </div>

    ${done ? `<div class="card"><h2>Result</h2>
        <p><strong>${init ? (carried ? 'Enacted.' : 'Not enacted.') : (carried ? 'Rejected.' : 'Kept.')}</strong>
        ${t ? `${t.yes} for, ${t.no} against — ${pct(t.share)}, ${pct(e.need)} needed.` : ''}</p>
        <p class="small muted">${init
          ? (carried ? 'It is law, passed by the Republic itself.' : 'It does not become law.')
          : (carried ? 'The law is repealed and has left the statute book.' : 'The law stands.')}</p>
      </div>`
    : e.my_choice ? `<div class="card"><h2>Your ballot is cast</h2>
        <p>You voted to <strong>${esc(e.my_choice)}</strong>. That is final.</p>
        <div class="stamp">Ballot recorded</div></div>`
    : !e.can_vote ? '<div class="card"><div class="empty">You are not in the electorate for this vote.</div></div>'
    : `<div class="ballot">
        <div class="ballot-head">${init ? 'Should this become law?' : 'Should this law stand?'} · one vote each · you cannot change it</div>
        <label class="option"><input type="radio" name="ref" value="${init ? 'enact' : 'keep'}">
          <span class="option-body"><span class="option-name">${init ? 'Enact it' : 'Keep it'}</span>
          <span class="option-statement">${init ? 'It enters the statute book at once.' : 'The law stays as it is.'}</span></span></label>
        <label class="option"><input type="radio" name="ref" value="reject">
          <span class="option-body"><span class="option-name">Reject it</span>
          <span class="option-statement">${init ? 'It does not become law.' : 'The law is struck from the statute book.'}</span></span></label>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn btn-primary" id="castref">Cast my vote</button></div>`}

    <div class="card"><h2>Where it stands</h2>
      <p class="item-meta">${e.turnout} of ${e.eligible} have voted · ${e.quorum} must vote for the result to count · ${pct(e.need)} of votes cast needed to ${init ? 'enact it' : 'strike the law down'}</p>
      ${t ? `<div class="strip">${`<span class="blk ${init ? 'aye' : 'no'}"></span>`.repeat(t.yes)}${`<span class="blk ${init ? 'no' : 'aye'}"></span>`.repeat(t.no)}${'<span class="blk"></span>'.repeat(Math.max(0, e.eligible - t.cast))}</div>
             <p class="item-meta">${t.yes} ${yesWord} · ${t.no} ${init ? 'reject' : 'keep'}</p>`
          : '<p class="small muted">Counts are hidden until the poll closes.</p>'}
    </div>

    ${isAdmin() ? `<div class="card"><h2>Returning officer</h2>
      <div class="row"><button class="btn" data-close>Close and count</button></div></div>` : ''}`;

  if ($('#castref')) $('#castref').onclick = async () => {
    const pick = document.querySelector('input[name=ref]:checked');
    if (!pick) return toast('Choose keep or reject first.', true);
    if (!confirm(`Vote to ${pick.value} this law? You get one vote and it cannot be changed.`)) return;
    try { await api(`/api/elections/${id}/referendum`, { method: 'POST', body: { choice: pick.value } }); route(); }
    catch (err) { toast(err.message, true); }
  };
  const closeBtn = document.querySelector('[data-close]');
  if (closeBtn) closeBtn.onclick = async () => {
    try {
      const r = await api(`/api/elections/${id}/status`, { method: 'POST', body: { status: 'closed' } });
      toast(r.struck ? `Struck down — ${Math.round(r.share * 100)}% voted to reject.`
        : r.enacted ? `Enacted by the Republic — ${Math.round(r.share * 100)}% in favour.`
        : r.reason === 'quorum' ? `Void: only ${r.cast} voted, ${r.quorum} needed.`
        : `${Math.round(r.share * 100)}% in favour, ${Math.round(r.need * 100)}% needed.`);
      route();
    } catch (err) { toast(err.message, true); }
  };
}

/* Article 2 — the People's power. Two thirds of all Citizens, gathering by
   signature rather than by poll, because no officer opens or closes it. */
async function viewPeople(v) {
  const d = await api('/api/supermajority');
  const cs = await api('/api/citizens');
  const open = d.motions.filter(m => m.status === 'open');
  const past = d.motions.filter(m => m.status !== 'open');

  v.innerHTML = `
    <h1 class="page">The People</h1>
    <p class="page-sub">Article 2 · ${d.needed} of ${d.citizens} citizens carries anything below</p>

    <div class="card">
      <p class="small">Two thirds of all Citizens may do what no officer can stop: appoint a Speaker over a deadlocked House, remove any officer at all, dissolve the House, or end a declaration of extraordinary circumstances. Nobody opens or closes this — signatures gather, and the act happens the moment two thirds is reached.</p>
    </div>

    ${open.length ? open.map(m => `<div class="card">
      <div class="spread"><h2 style="margin:0">${esc(d.acts[m.kind] || m.kind)}</h2>
        <span class="tag on-violet">${m.signatures} of ${d.needed}</span></div>
      ${m.target_name ? `<p class="item-meta">Concerning ${esc(m.target_name)}</p>` : ''}
      <p style="margin:8px 0 0">${esc(m.reasons)}</p>
      <div class="bar" style="margin-top:10px"><span style="width:${Math.min(100, Math.round(m.signatures / d.needed * 100))}%"></span></div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-sm ${m.signed ? '' : 'btn-primary'}" data-sign="${m.id}" ${m.signed ? 'disabled' : ''}>${m.signed ? 'You have signed' : 'Sign it'}</button>
        ${m.opened_by === ME.id ? `<button class="btn btn-sm" data-pull="${m.id}">Withdraw</button>` : ''}
        <span class="small muted">opened by ${esc(m.opened_by_name || '')}</span>
      </div>
    </div>`).join('') : '<div class="card"><div class="empty">No motion is open.</div></div>'}

    <div class="card"><h2>Open one</h2>
      <form id="sm" class="stack">
        <label class="field"><span>What should the Republic do?</span><select name="kind" id="smk">
          ${Object.entries(d.acts).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}
        </select></label>
        <label class="field" id="smt" hidden><span>Concerning whom</span><select name="target_user_id">
          ${cs.map(c => `<option value="${c.id}">${esc(c.display_name)}${(c.offices || []).length ? ` — ${esc((c.offices || []).join(', '))}` : ''}</option>`).join('')}
        </select></label>
        <label class="field"><span>Why</span><textarea name="reasons" required></textarea></label>
        <button class="btn btn-primary">Open the motion</button>
      </form>
    </div>

    ${past.length ? `<div class="card"><h2>The record</h2><div class="list">${past.map(m => `<div class="item">
      <div class="item-top"><span class="item-title">${esc(d.acts[m.kind] || m.kind)}</span>
        <span class="tag ${m.status === 'carried' ? 'on-green' : ''}">${esc(m.status)}</span></div>
      <div class="item-meta">${m.signatures} signatures · ${when(m.created_at)}${m.outcome ? ` · ${esc(m.outcome)}` : ''}</div>
    </div>`).join('')}</div></div>` : ''}`;

  const k = $('#smk');
  const syncK = () => { $('#smt').hidden = !['appoint_speaker', 'remove_officer'].includes(k.value); };
  k.onchange = syncK; syncK();

  $('#sm').onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    if (f.target_user_id) f.target_user_id = Number(f.target_user_id); else delete f.target_user_id;
    try { await api('/api/supermajority', { method: 'POST', body: f }); toast('Motion opened.'); route(); }
    catch (err) { toast(err.message, true); }
  };
  onAction('[data-sign]', async btn => {
    const r = await api(`/api/supermajority/${btn.dataset.sign}/sign`, { method: 'POST' });
    toast(r.carried ? `Carried by ${r.signatures} of ${r.citizens}. ${r.outcome}` : `Signed — ${r.signatures} of ${r.needed}.`);
    route();
  });
  onAction('[data-pull]', async btn => {
    await api(`/api/supermajority/${btn.dataset.pull}/withdraw`, { method: 'POST' });
    route();
  });
}

/* Article 12 — the President drafting a declaration, and the record of every
   one ever made. The form is deliberately blunt about what it costs. */
async function viewEmergency(v) {
  const e = await api('/api/emergency');
  const mine = has('president');

  v.innerHTML = `
    <h1 class="page">Extraordinary circumstances</h1>
    <p class="page-sub">Article 12 · the House grants it, the House ends it</p>

    <div class="card">
      <p class="small">A declaration suspends <strong>only what it names</strong>, and <strong>only for as long as it says</strong>. The President moves one; it is a bill and the House votes on it like any other. A majority of the House can end it at any moment without asking the President, and it lapses on its own when its time runs out.</p>
      <p class="small muted">Three things can never be suspended: the House's power to end a declaration, impeachment, and a poll that has already opened.</p>
    </div>

    ${e.in_force ? `<div class="card"><h2>In force</h2>
      <p>${esc(e.in_force.reasons)}</p>
      <ul class="emergency-powers">${e.in_force.powers.map(p => `<li>${esc(e.powers_available[p] || p)}</li>`).join('')}</ul>
      <p class="item-meta">Declared ${when(e.in_force.declared_at)} · lapses ${when(e.in_force.expires_at)} · ${e.end_votes} of ${e.end_votes_needed} members have moved to end it</p>
    </div>`
    : mine ? `<div class="card"><h2>Draft a declaration</h2>
      <form id="dec" class="stack">
        <label class="field"><span>What are the circumstances?</span>
          <textarea name="reasons" required placeholder="The House is being asked to suspend the ordinary law on your word. Say why."></textarea></label>
        <p class="eyebrow" style="margin-bottom:0">Powers claimed</p>
        <div class="powers">${Object.entries(e.powers_available).map(([k, label]) => `
          <label class="power"><input type="checkbox" name="powers" value="${esc(k)}">
            <span>${esc(label)}</span></label>`).join('')}</div>
        <label class="field"><span>For how long</span><select name="days">
          <option value="0.25">6 hours</option>
          <option value="0.5">12 hours</option>
          <option value="1" selected>1 day</option>
          <option value="2">2 days</option>
          <option value="${esc(e.max_days)}">${esc(e.max_days)} days — the longest allowed</option>
        </select></label>
        <button class="btn btn-primary">Put it to the House</button>
      </form>
    </div>`
    : '<div class="card"><div class="empty">Only the President may move a declaration.</div></div>'}

    <div class="card"><h2>The record</h2>
      ${e.history.length ? `<div class="list">${e.history.map(h => `<div class="item">
        <div class="item-top"><span class="item-title">${esc(h.reasons.slice(0, 80))}</span>
          <span class="tag ${h.status === 'in_force' ? 'on-oxide' : h.status === 'refused' ? '' : 'on-green'}">${esc(h.status.replace('_', ' '))}</span></div>
        <div class="item-meta">${esc(h.declared_by_name || '')} · ${when(h.created_at)}${h.ended_by ? ` · ended by ${esc(h.ended_by)}` : ''}</div>
      </div>`).join('')}</div>` : '<p class="small muted">No declaration has ever been made.</p>'}
    </div>`;

  if ($('#dec')) $('#dec').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const powers = f.getAll('powers');
    if (!powers.length) return toast('Name at least one power — a declaration suspends only what it names.', true);
    if (!confirm(`Put this to the House? It claims ${powers.length} power${powers.length > 1 ? 's' : ''} and everyone will see exactly what you asked for.`)) return;
    try {
      const r = await api('/api/emergency', { method: 'POST', body: {
        reasons: f.get('reasons'), powers, days: Number(f.get('days'))
      } });
      toast(`Moved as ${r.bill_ref}. The House decides.`);
      location.hash = `#/bill/${r.bill_id}`;
    } catch (err) { toast(err.message, true); }
  };
}

/* --------------------------------------------------------------- bills */

async function viewBills(v) {
  const list = await api('/api/bills');
  v.innerHTML = `
    <h1 class="page">Bills</h1>
    <p class="page-sub">Anyone may propose · ${STATE.config.seconds_required} seconders to reach the floor</p>

    ${canPropose() ? `<div class="card">
      <h2>Propose something</h2>
      <form id="mk" class="stack">
        <label class="field"><span>Title</span><input name="title" required placeholder="Short and quotable"></label>
        <div class="grid2">
          <label class="field"><span>Kind</span><select name="kind">
            <option value="law">New law</option>
            <option value="amendment">Amend a law</option>
            <option value="repeal">Repeal a law</option>
            <option value="motion">Motion (no statute)</option>
            <option value="constitutional">Constitutional amendment</option>
            <option value="rule">Change a rule of the game</option>
            <option value="impeachment">Impeachment</option>
          </select></label>
          <label class="field"><span>Law it changes</span><select name="target_law_id" id="targ"><option value="">—</option></select></label>
        </div>
        <label class="field" id="targetuser" hidden><span>Officer to remove</span><select name="target_user_id" id="who"><option value="">—</option></select></label>
        <label class="field"><span>Text</span><textarea name="body" id="body" required placeholder="Write it as it should read in the statute book. Markdown works."></textarea></label>
        <div id="rulehelp" hidden>
          <p class="eyebrow">Rule bills</p>
          <p class="small muted">One change per line, written as <span class="code">setting = value</span>. Whatever passes is exactly what gets applied — no one edits it afterwards. Current values:</p>
          <div class="row" style="margin-top:8px">${RULE_KEYS.map(k =>
            `<button type="button" class="code" data-rule="${k}" style="cursor:pointer;border-style:dashed">${k} = ${esc(STATE.config[k] ?? '')}</button>`).join('')}</div>
          <p class="small muted" style="margin-top:8px">Two settings are missing on purpose: whether new accounts need approval, and whether invites are required. Those decide who gets a vote at all, so they stay with the returning officer.</p>
        </div>
        <button class="btn btn-primary">Propose</button>
      </form>
    </div>` : ''}

    ${STATE.config.initiative_mode === 'off' ? (canPropose() ? '' : `<div class="card"><h2>Propose something</h2>
      <p class="small muted">Only the House may put a bill before itself, and citizens' initiatives are switched off. Ask an MP to move it for you, or stand at the next election.</p></div>`)
    : `<div class="card"><h2>Start an initiative</h2>
      <p class="small muted">${canPropose() ? 'Open to every citizen, you included — this route goes to the people rather than through the House.' : 'Only the House may put a bill before itself, but anyone may start an initiative.'}
        Collect signatures from ${Math.round(Number(STATE.config.petition_share) * 100)}% of citizens and ${STATE.config.initiative_mode === 'enact'
          ? `it goes straight to the whole Republic, becoming law at ${Math.round(Number(STATE.config.initiative_threshold) * 100)}% — without the House and without the President.`
          : 'the House must take it up. It still faces a division, and the President still has to assent.'}</p>
      <form id="init" class="stack" style="margin-top:14px">
        <label class="field"><span>Title</span><input name="title" required placeholder="Short and quotable"></label>
        <div class="grid2">
          <label class="field"><span>Kind</span><select name="kind" id="initkind">
            <option value="law">New law</option>
            <option value="amendment">Amend a law</option>
            <option value="repeal">Repeal a law</option>
            <option value="motion">Motion (no statute)</option>
          </select></label>
          <label class="field" id="initlawwrap" hidden><span>Law it changes</span>
            <select name="target_law_id" id="initlaw"><option value="">—</option></select></label>
        </div>
        <label class="field"><span>Text</span><textarea name="body" required placeholder="Write it as it should read in the statute book."></textarea></label>
        <button class="btn btn-primary">Start the initiative</button>
      </form>
    </div>`}

    ${list.length ? `<div class="list">${list.map(b => `
      <a class="item" href="#/bill/${b.id}">
        <div class="item-top"><span class="item-title"><span class="ref">${esc(b.ref)}</span> ${esc(b.title)}</span>${statusTag(b.status)}</div>
        <div class="item-meta">${esc(b.kind)} · ${esc(b.author_name || 'unknown')} · ${b.seconds} seconded · ${b.comments} comments${b.result ? ' · ' + esc(b.result) : ''}</div>
      </a>`).join('')}</div>` : '<div class="empty">Nothing has been proposed yet. Be the first.</div>'}`;

  // Laws are needed by whichever forms are on the page, so fetch once.
  const lawOptions = api('/api/laws').then(laws => '<option value="">—</option>' +
    laws.map(l => `<option value="${l.id}">${esc(l.ref)} ${esc(l.title)}</option>`).join(''));

  if ($('#init')) {
    const ik = $('#initkind');
    const syncInit = () => { $('#initlawwrap').hidden = !['amendment', 'repeal'].includes(ik.value); };
    ik.onchange = syncInit; syncInit();
    lawOptions.then(html => { if ($('#initlaw')) $('#initlaw').innerHTML = html; });
    $('#init').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.target_law_id) delete f.target_law_id;
      try {
        const r = await api('/api/initiatives', { method: 'POST', body: f });
        location.hash = `#/bill/${r.id}`;
      } catch (err) { toast(err.message, true); }
    };
  }

  // Everything below belongs to the House's own bill form, which is not
  // always on the page — scope the lookups to it or they find the other form.
  const kindSel = document.querySelector('#mk select[name=kind]');
  if (!kindSel) return;
  api('/api/citizens').then(cs => {
    $('#who').innerHTML = '<option value="">—</option>' + cs.filter(c => (c.offices || []).length)
      .map(c => `<option value="${c.id}">${esc(c.display_name)} — ${(c.offices || []).join(', ')}</option>`).join('');
  });
  const syncKind = () => {
    const isRule = kindSel.value === 'rule';
    $('#targetuser').hidden = kindSel.value !== 'impeachment';
    $('#rulehelp').hidden = !isRule;
    $('#body').placeholder = isRule
      ? 'cycle_days = 5\ncampaign_days = 1'
      : 'Write it as it should read in the statute book. Markdown works.';
  };
  kindSel.onchange = syncKind; syncKind();
  document.querySelectorAll('[data-rule]').forEach(b => b.onclick = () => {
    const t = $('#body');
    t.value = (t.value ? t.value.replace(/\s*$/, '\n') : '') + `${b.dataset.rule} = ${STATE.config[b.dataset.rule] ?? ''}`;
    t.focus();
  });

  lawOptions.then(html => { if ($('#targ')) $('#targ').innerHTML = html; });

  $('#mk').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.target_law_id) delete f.target_law_id;
    if (f.target_user_id) f.target_user_id = Number(f.target_user_id); else delete f.target_user_id;
    try { const r = await api('/api/bills', { method: 'POST', body: f }); location.hash = `#/bill/${r.id}`; }
    catch (err) { toast(err.message, true); }
  };
}

async function viewBill(v, id) {
  const b = await api('/api/bills/' + id);
  const need = Number(STATE.config.seconds_required);
  const c = b.counts;

  const strip = () => {
    const votes = b.division.map(d => `<span class="blk ${d.vote}" title="${esc(d.display_name)}: ${d.vote}"></span>`).join('');
    const blanks = '<span class="blk"></span>'.repeat(Math.max(0, c.eligible - b.division.length));
    return `<div class="strip">${votes}${blanks}</div>
      <p class="item-meta">${c.aye} aye · ${c.no} no · ${c.abstain} abstain · ${c.eligible - b.division.length} yet to vote</p>`;
  };

  let action = '';
  if (b.status === 'petition') {
    const mode = STATE.config.initiative_mode;
    action = `<div id="signbox"><p class="small muted">Loading signatures…</p></div>
      <p class="small muted" style="margin-top:10px">${mode === 'enact'
        ? `Once enough citizens sign, this goes straight to the whole Republic. At ${Math.round(Number(STATE.config.initiative_threshold) * 100)}% it becomes law without the House or the President.`
        : 'Once enough citizens sign, the House must take it up. It still has to pass a division and get the President\'s assent.'}</p>`;
  } else if (b.status === 'referendum') {
    action = '<p class="small">This proposal is with the people. See the open referendum on the Elections page.</p>';
  } else if (b.status === 'draft') {
    action = `<div class="row">
      <span class="tag">${b.seconds} of ${need} seconders</span>
      ${b.author_id === ME.id ? '<span class="small muted">You cannot second your own bill.</span>'
        : !canPropose() ? '<span class="small muted">Only the House may second a bill.</span>'
        : `<button class="btn ${b.i_seconded ? '' : 'btn-primary'}" id="second" ${b.i_seconded ? 'disabled' : ''}>${b.i_seconded ? 'You seconded this' : 'Second it'}</button>`}
      ${has('speaker') && b.seconds >= need ? '<button class="btn" data-act="table">Table it</button>' : ''}
    </div>`;
  } else if (b.status === 'tabled') {
    action = `<div class="row"><span class="small muted">Tabled and waiting on the Speaker to call a division.</span>
      ${has('speaker') ? '<button class="btn btn-primary" data-act="division">Call the division</button>' : ''}</div>`;
  } else if (b.status === 'division') {
    action = `${strip()}
      ${b.can_vote && !b.my_vote ? `<div class="row" style="margin-top:10px">
        <button class="btn btn-aye" data-vote="aye">Aye</button>
        <button class="btn btn-no" data-vote="no">No</button>
        <button class="btn" data-vote="abstain">Abstain</button>
      </div>` : b.my_vote ? `<div class="stamp">You voted ${esc(b.my_vote)}</div>`
        : '<p class="small muted">You do not have a vote in this division.</p>'}
      ${has('speaker') ? '<div class="row" style="margin-top:12px"><button class="btn" data-act="close">Close the division</button></div>' : ''}`;
  } else if (b.status === 'passed') {
    action = `${strip()}<p class="small">Carried. Awaiting presidential assent.</p>
      ${has('president') ? `<div class="row">
        <button class="btn btn-aye" data-act="assent">Give assent</button>
        <button class="btn btn-no" data-act="veto">Veto</button></div>` : ''}`;
  } else if (b.status === 'vetoed') {
    const canOverride = STATE.config.allow_veto_override === 'true';
    action = `${strip()}<p class="small">${canOverride
      ? `Vetoed by the President. The House may override with ${Math.round(Number(STATE.config.veto_override) * 100)}% of the division.`
      : 'Vetoed by the President. That is the end of it — assent is required for a bill to become law. The House would first have to pass a rule bill setting <span class="code">allow_veto_override = true</span>.'}</p>
      ${canOverride && has('speaker') ? '<button class="btn btn-primary" data-act="override">Move the override</button>' : ''}`;
  } else if (b.status === 'failed' || b.status === 'enacted') {
    action = strip();
  }

  v.innerHTML = `
    <h1 class="page">${esc(b.title)}</h1>
    <p class="page-sub"><span class="ref">${esc(b.ref)}</span> · ${esc(b.kind)} · ${esc(b.author_name || 'unknown')} · ${day(b.created_at)} · ${statusTag(b.status)}</p>

    ${b.kind === 'impeachment' ? `<div class="card">
      <p class="eyebrow">Impeachment</p>
      <p>If this carries at ${Math.round(Number(STATE.config.impeachment_threshold) * 100)}% of the division, <strong>${esc(b.target_name || 'the officer named')}</strong> is removed from every office they hold, at once. It does not go to the President for assent.</p>
    </div>` : ''}
    <div class="card">${b.kind === 'rule'
      ? `<p class="eyebrow">If this passes, these settings change</p>
         <div class="list">${b.body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
            const [k, ...rest] = l.split('=');
            const key = k.trim(), to = rest.join('=').trim();
            const from = STATE.config[key];
            return `<div class="item"><div class="item-top">
              <span class="item-title">${esc(key)}</span>
              <span class="item-meta">${esc(from ?? '—')} &rarr; <strong>${esc(to)}</strong></span></div></div>`;
          }).join('')}</div>`
      : `<div class="prose">${md(b.body)}</div>`}</div>

    <div class="card"><h2>Progress</h2>${action || '<p class="small muted">Concluded.</p>'}
      ${b.seconders.length ? `<p class="item-meta" style="margin-top:12px">Seconded by ${b.seconders.map(s => esc(s.display_name)).join(', ')}</p>` : ''}
      ${b.division.length ? `<p class="item-meta">Division: ${b.division.map(d => `${esc(d.display_name)} ${d.vote}`).join(' · ')}</p>` : ''}
    </div>

    <div class="card">
      <h2>Debate</h2>
      ${b.comments.length ? b.comments.map(x => `
        <div style="padding:10px 0;border-bottom:1px solid var(--rule)">
          <div class="item-meta">${esc(x.display_name)} · ${when(x.created_at)}</div>
          <div style="white-space:pre-wrap">${esc(x.body)}</div>
        </div>`).join('') : '<p class="small muted">No one has spoken yet.</p>'}
      <form id="say" class="stack" style="margin-top:14px">
        <label class="field"><span>Speak</span><textarea name="body" style="min-height:90px" required></textarea></label>
        <button class="btn">Add to the debate</button>
      </form>
    </div>`;

  if ($('#signbox')) {
    const box = $('#signbox');
    const draw = (p) => {
      box.innerHTML = `<div class="row">
        <button class="btn ${p.mine ? '' : 'btn-primary'}" ${p.mine ? 'disabled' : ''}>${p.mine ? 'You have signed' : 'Sign this initiative'}</button>
        <span class="small muted">${p.signed} of ${p.needed} signatures</span></div>
        <div class="bar" style="margin-top:8px"><span style="width:${Math.min(100, Math.round(p.signed / p.needed * 100))}%"></span></div>`;
      const btn = box.querySelector('button');
      if (btn) btn.onclick = async () => {
        try {
          const r = await api(`/api/bills/${id}/sign`, { method: 'POST' });
          if (r.election_id) { toast('Enough signatures — it goes to the people.'); location.hash = `#/election/${r.election_id}`; }
          else if (r.tabled) { toast('Enough signatures — it is before the House.'); route(); }
          else { toast(`Signed. ${r.signed} of ${r.needed}.`); draw({ ...r, mine: true }); }
        } catch (err) { toast(err.message, true); }
      };
    };
    api(`/api/bills/${id}/sign`).then(draw).catch(() => {});
  }

  $('#say').onsubmit = async e => {
    e.preventDefault();
    try { await api(`/api/bills/${id}/comments`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); route(); }
    catch (err) { toast(err.message, true); }
  };
  if ($('#second')) $('#second').onclick = async () => {
    try { await api(`/api/bills/${id}/second`, { method: 'POST' }); route(); } catch (err) { toast(err.message, true); }
  };
  document.querySelectorAll('[data-vote]').forEach(btn => btn.onclick = async () => {
    if (!confirm(`Vote ${btn.dataset.vote}? One vote per member, final.`)) return;
    try { await api(`/api/bills/${id}/vote`, { method: 'POST', body: { vote: btn.dataset.vote } }); route(); }
    catch (err) { toast(err.message, true); }
  });
  document.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
    const a = btn.dataset.act;
    const paths = { table: 'table', division: 'division', close: 'close', assent: 'assent', veto: 'assent', override: 'override' };
    try {
      const r = await api(`/api/bills/${id}/${paths[a]}`, { method: 'POST', body: a === 'veto' ? { veto: true } : {} });
      if (r.impeached) toast(`${r.impeached} removed from ${r.removed_from.join(', ')} — ${r.result}`);
      else if (r.result) toast(`${r.carried ? 'Carried' : 'Lost'} — ${r.result}`);
      route();
    } catch (err) { toast(err.message, true); }
  });
}

/* ------------------------------------------------------ laws + charter */

async function viewLaws(v) {
  const all = location.hash.includes('all');
  const laws = await api('/api/laws?all=' + (all ? '1' : '0'));
  v.innerHTML = `
    <h1 class="page">Statute book</h1>
    <p class="page-sub">${laws.filter(l => !l.repealed_at).length} in force</p>
    ${laws.length ? laws.map(l => `
      <div class="card">
        <div class="spread">
          <h2 style="margin:0"><span class="ref">${esc(l.ref)}</span> ${esc(l.title)}</h2>
          ${l.repealed_at ? '<span class="tag on-oxide">repealed</span>' : '<span class="tag on-green">in force</span>'}
        </div>
        <p class="item-meta">Enacted ${day(l.enacted_at)}${l.author_name ? ' · proposed by ' + esc(l.author_name) : ''}${l.bill_ref ? ' · from ' + esc(l.bill_ref) : ''}</p>
        <div class="prose" style="margin-top:10px">${md(l.body)}</div>
        ${l.repealed_at ? '' : `<div class="row" style="margin-top:12px" data-pet="${l.id}"></div>`}
      </div>`).join('') : '<div class="empty">No laws yet. The statute book opens with your first enacted bill.</div>'}
    <button class="btn" id="tog">${all ? 'Hide repealed' : 'Show repealed laws'}</button>`;
  $('#tog').onclick = () => { location.hash = all ? '#/laws' : '#/laws/all'; };

  // The people's veto: sign, and past a threshold the referendum opens itself.
  for (const box of document.querySelectorAll('[data-pet]')) {
    const id = box.dataset.pet;
    const draw = (p) => {
      box.innerHTML = p.election_id
        ? `<a class="btn btn-primary" href="#/election/${p.election_id}">Referendum open — vote on this law</a>`
        : `<button class="btn ${p.mine ? '' : 'btn-primary'}" ${p.mine ? 'disabled' : ''}>${p.mine ? 'You have signed' : 'Call a referendum'}</button>
           <span class="small muted">${p.signed} of ${p.needed} signatures needed to put this to the whole Republic</span>`;
      const btn = box.querySelector('button');
      if (btn) btn.onclick = async () => {
        try {
          const r = await api(`/api/laws/${id}/petition`, { method: 'POST' });
          if (r.opened) { toast('Enough signatures — the referendum is open.'); location.hash = `#/election/${r.election_id}`; }
          else { toast(`Signed. ${r.signed} of ${r.needed}.`); draw({ ...r, mine: true }); }
        } catch (err) { toast(err.message, true); }
      };
    };
    api(`/api/laws/${id}/petition`).then(draw).catch(() => {});
  }
}

async function viewConstitution(v) {
  const c = await api('/api/constitution');
  v.innerHTML = `
    <h1 class="page">Constitution</h1>
    <p class="page-sub">Version ${c.current?.version ?? 1} · ratified ${day(c.current?.ratified_at)}</p>
    <div class="card"><div class="prose">${md(c.current?.body || '')}</div></div>
    ${c.history.length > 1 ? `<div class="card"><h2>Earlier versions</h2>
      ${c.history.slice(1).map(h => `<details style="border-bottom:1px solid var(--rule);padding:8px 0">
        <summary style="cursor:pointer">Version ${h.version} · ${day(h.ratified_at)}</summary>
        <div class="prose" style="margin-top:10px">${md(h.body)}</div></details>`).join('')}</div>` : ''}
    <p class="small muted">To change this, propose a bill of kind “constitutional”. It needs ${Math.round(Number(STATE.config.constitutional_threshold) * 100)}% of the division.</p>`;
}

/* ------------------------------------------------------------- parties */

async function viewParties(v) {
  const parties = await api('/api/parties');
  v.innerHTML = `
    <h1 class="page">Parties</h1>
    <p class="page-sub">One membership each · leaving is instant, forgiveness is not</p>

    <div class="card">
      <h2>Found a party</h2>
      <form id="mk" class="stack">
        <div class="grid2">
          <label class="field"><span>Name</span><input name="name" required></label>
          <label class="field"><span>Short code</span><input name="abbr" maxlength="5" required placeholder="e.g. PPL"></label>
        </div>
        <label class="field"><span>Colour</span><input type="color" name="colour" value="#5B2E9E"></label>
        <label class="field"><span>What you stand for</span><textarea name="manifesto" style="min-height:110px"></textarea></label>
        <button class="btn btn-primary">Found it</button>
      </form>
    </div>

    ${parties.map(p => {
      const mine = ME.party?.id === p.id;
      return `<div class="card">
        <div class="spread">
          <h2 style="margin:0"><span class="swatch" style="background:${esc(p.colour)}"></span> ${esc(p.name)} <span class="tag">${esc(p.abbr)}</span></h2>
          <button class="btn btn-sm ${mine ? '' : 'btn-primary'}" data-join="${p.id}">${mine ? 'Leave' : 'Join'}</button>
        </div>
        <p class="item-meta">Leader ${esc(p.leader_name || '—')} · ${p.members.length} members: ${p.members.map(m => esc(m.display_name)).join(', ') || 'none'}</p>
        ${p.manifesto ? `<div class="prose" style="margin-top:10px">${md(p.manifesto)}</div>` : ''}
        ${p.leader_id === ME.id ? `<form data-edit="${p.id}" class="stack" style="margin-top:12px">
          <label class="field"><span>Edit manifesto</span><textarea name="manifesto" style="min-height:90px">${esc(p.manifesto)}</textarea></label>
          <button class="btn btn-sm">Save</button></form>` : ''}
      </div>`;
    }).join('') || '<div class="empty">No parties yet.</div>'}`;

  $('#mk').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/parties', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); ME = await api('/api/me'); route(); }
    catch (err) { toast(err.message, true); }
  };
  document.querySelectorAll('[data-join]').forEach(b => b.onclick = async () => {
    const leaving = b.textContent === 'Leave';
    try {
      await api(leaving ? '/api/parties/leave' : `/api/parties/${b.dataset.join}/join`, { method: 'POST' });
      ME = await api('/api/me'); route();
    } catch (err) { toast(err.message, true); }
  });
  document.querySelectorAll('[data-edit]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    await api(`/api/parties/${f.dataset.edit}`, { method: 'PUT', body: Object.fromEntries(new FormData(f)) });
    toast('Saved.'); route();
  });
}

/* ------------------------------------------------------------ citizens */

async function viewCitizens(v) {
  const list = await api('/api/citizens');
  v.innerHTML = `
    <h1 class="page">Citizens</h1>
    <p class="page-sub">${list.length} on the roll</p>
    <div class="list">${list.map(u => `
      <div class="item">
        <div class="item-top">
          <span class="item-title">${esc(u.display_name)} ${u.party_abbr ? `<span class="tag" style="border-color:${esc(u.party_colour)};color:${esc(u.party_colour)}">${esc(u.party_abbr)}</span>` : ''}</span>
          <span>${(u.offices || []).map(o => `<span class="tag on-navy">${esc(o === 'mp' ? 'MP' : o)}</span>`).join(' ')}</span>
        </div>
        <div class="item-meta">@${esc(u.username)} · joined ${day(u.created_at)}</div>
        ${u.bio ? `<div class="small" style="margin-top:4px">${esc(u.bio)}</div>` : ''}
      </div>`).join('')}</div>`;
}

/* -------------------------------------------------------------- record */

async function viewRecord(v) {
  const [log, digest] = await Promise.all([api('/api/audit'), fetch(API + '/api/digest').then(r => r.text())]);
  v.innerHTML = `
    <h1 class="page">The record</h1>
    <p class="page-sub">Everything that happened, in order</p>
    <div class="card">
      <h2>Digest for the group chat</h2>
      <textarea id="dg" style="min-height:190px;font-family:var(--mono);font-size:12px">${esc(digest)}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="cp">Copy</button></div>
    </div>
    <div class="card"><h2>Log</h2>
      ${log.map(l => `<div class="logline"><time>${when(l.at)}</time>
        <div><strong>${esc(l.display_name || 'system')}</strong> ${esc(l.action)} ${esc(l.detail)}</div></div>`).join('')}
    </div>`;
  $('#cp').onclick = async () => {
    try { await navigator.clipboard.writeText($('#dg').value); toast('Copied. Paste it in the chat.'); }
    catch { $('#dg').select(); toast('Select and copy manually.', true); }
  };
}

/* ------------------------------------------------------------ my account */

async function viewMe(v) {
  ME = await api('/api/me');
  v.innerHTML = `
    <h1 class="page">${esc(ME.display_name)}</h1>
    <p class="page-sub">@${esc(ME.username)}${ME.offices.length ? ' · ' + ME.offices.join(', ') : ''}${ME.party ? ' · ' + esc(ME.party.name) : ''}</p>
    <div class="card"><h2>Profile</h2>
      <form id="pf" class="stack">
        <label class="field"><span>Display name</span><input name="display_name" value="${esc(ME.display_name)}"></label>
        <label class="field"><span>About you</span><textarea name="bio" style="min-height:90px">${esc(ME.bio || '')}</textarea></label>
        <button class="btn btn-primary">Save</button>
      </form>
    </div>
    ${ME.offices.length ? `<div class="card"><h2>Resign</h2>
      <p class="small muted">Article 7.4: you may resign any office at any time, and need give no reason. Leaving the House leaves the chair with it.</p>
      <div class="row" style="margin-top:10px">${ME.offices.map(o =>
        `<button class="btn btn-sm" data-resign="${esc(o)}">Resign as ${esc(o === 'mp' ? 'MP' : o)}</button>`).join('')}</div>
    </div>` : ''}

    <div class="card"><h2>Password</h2>
      <form id="pw" class="stack">
        <label class="field"><span>Current</span><input type="password" name="current" required></label>
        <label class="field"><span>New</span><input type="password" name="next" required></label>
        <button class="btn">Change it</button>
      </form>
    </div>`;
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    await api('/api/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    ME = await api('/api/me'); $('#whoName').textContent = ME.display_name; toast('Saved.');
  };
  onAction('[data-resign]', async btn => {
    if (!confirm(`Resign as ${btn.dataset.resign}? It takes effect at once.`)) return;
    await api('/api/me/resign', { method: 'POST', body: { office: btn.dataset.resign } });
    ME = await api('/api/me'); toast('Resigned.'); route();
  });

  $('#pw').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      if (r.token) { TOKEN = r.token; localStorage.setItem('republic.token', TOKEN); }
      toast('Password changed. Any other device signed in as you has been logged out.');
      e.target.reset();
    }
    catch (err) { toast(err.message, true); }
  };
}

/* --------------------------------------------------------------- admin */

/* The settings a bill may change. Must match LEGISLATABLE on the server. */
const RULE_KEYS = [
  'seats', 'quorum', 'seconds_required', 'pass_threshold', 'constitutional_threshold',
  'veto_override', 'bill_voters', 'bill_proposers', 'allow_veto_override',
  'impeachment_threshold', 'referendum_threshold', 'referendum_quorum',
  'referendum_days', 'petition_share', 'initiative_mode', 'initiative_threshold',
  'secret_ballot', 'term_days',
  'cycle_enabled', 'cycle_days', 'campaign_days', 'poll_days', 'cycle_elects',
  'speaker_auto', 'speaker_threshold', 'speaker_relax', 'enforce_term_limit', 'nation_name', 'motto',
  'salary_treasurer', 'salary_fed_chair', 'fed_terms', 'bank_charter_fee', 'deposit_guarantee',
  'diplomacy_enabled', 'foreign_actions_per_cycle', 'treaty_threshold', 'recognition_threshold', 'foreign_trade_tax'
];

const CONFIG_FIELDS = [
  ['nation_name', 'Name of the state'],
  ['motto', 'Motto'],
  ['seats', 'Parliamentary seats'],
  ['term_days', 'Term length (days)'],
  ['seconds_required', 'Seconders needed'],
  ['quorum', 'Quorum for a division'],
  ['pass_threshold', 'Pass threshold (0–1)'],
  ['constitutional_threshold', 'Constitutional threshold'],
  ['veto_override', 'Veto override threshold'],
  ['bill_proposers', 'Who may propose and second bills (mps / citizens)'],
  ['bill_voters', 'Who votes on bills (mps / citizens)'],
  ['allow_veto_override', 'The House may override a presidential veto (true / false)'],
  ['impeachment_threshold', 'Impeachment threshold (0–1 of the division)'],
  ['referendum_threshold', 'Referendum threshold to strike a law (0–1)'],
  ['referendum_quorum', 'Referendum quorum (0–1 of citizens)'],
  ['referendum_days', 'Days a referendum stays open'],
  ['petition_share', 'Share of citizens needed to force a referendum (0–1)'],
  ['initiative_mode', "Citizens' initiatives (off / table / enact)"],
  ['initiative_threshold', 'Initiative threshold to become law directly (0–1)'],
  ['secret_ballot', 'Hide election counts while voting (true / false)'],
  ['allow_open_signup', 'Allow signup without an invite (true / false)'],
  ['require_approval', 'New accounts need admin approval (true / false)'],
  ['cycle_days', 'Electoral cycle length (days)'],
  ['campaign_days', 'Days of campaigning'],
  ['poll_days', 'Days the poll stays open'],
  ['cycle_elects', 'Contested each cycle (parliament, president)'],
  ['speaker_auto', 'House picks its own Speaker automatically (true / false)'],
  ['speaker_threshold', 'Speaker threshold (0–1, share of the House)'],
  ['speaker_relax', 'Votes the Speaker bar drops per failed ballot (0 = never)'],
  ['speaker_nomination_hours', 'Speaker nominations (hours)'],
  ['speaker_poll_hours', 'Speaker poll (hours)'],
  ['enforce_term_limit', 'No two consecutive cycles in office (true / false)'],
  ['goods_economy_enabled', 'Strategic goods economy (true / false)'],
  ['salary_treasurer', 'Treasurer salary'],
  ['salary_fed_chair', 'Fed chair salary'],
  ['fed_terms', 'Cycles the head of the Fed serves'],
  ['bank_charter_fee', 'Least capital a citizen may open a bank with'],
  ['deposit_guarantee', 'What the Treasury makes good per depositor if a bank fails'],
  ['diplomacy_enabled', 'Enable diplomacy (true / false)'],
  ['foreign_actions_per_cycle', 'Foreign actions allowed per cycle'],
  ['treaty_threshold', 'Treaty ratification threshold (0–1)'],
  ['recognition_threshold', 'Foreign recognition threshold (0–1)'],
  ['foreign_trade_tax', 'Tax on foreign imports (0–1)']
];

async function viewAdmin(v) {
  if (!isAdmin()) return v.innerHTML = '<div class="empty">Admins only.</div>';
  const [invites, citizens, con, pending] = await Promise.all([
    api('/api/admin/invites'), api('/api/citizens'), api('/api/constitution'), api('/api/admin/pending')]);

  v.innerHTML = `
    <h1 class="page">Returning officer</h1>
    <p class="page-sub">Rules, invites, and the appointment of offices</p>

    ${pending.length ? `<div class="card">
      <h2>Waiting for approval <span class="tag on-violet">${pending.length}</span></h2>
      <p class="small muted">Check each name against the group chat before you approve it. This is the only thing standing between one person and two votes.</p>
      <div class="list">${pending.map(u => `
        <div class="item"><div class="item-top">
          <span class="item-title">${esc(u.display_name)} <span class="muted small">@${esc(u.username)}</span></span>
          <span class="row">
            <button class="btn btn-sm btn-primary" data-ok="${u.id}">Approve</button>
            <button class="btn btn-sm" data-no="${u.id}">Reject</button>
          </span></div>
          <div class="item-meta">applied ${when(u.created_at)}${u.invite_code ? ' · used code ' + esc(u.invite_code) : ' · no invite code'}${u.invite_note ? ' · issued to ' + esc(u.invite_note) : ''}</div>
        </div>`).join('')}</div>
    </div>` : ''}

    <div class="card"><h2>Rules of the game</h2>
      <form id="cfg" class="stack">
        <div class="grid2">${CONFIG_FIELDS.map(([k, label]) =>
          `<label class="field"><span>${label}</span><input name="${k}" value="${esc(STATE.config[k])}"></label>`).join('')}</div>
        <button class="btn btn-primary">Save rules</button>
      </form>
    </div>

    <div class="card"><h2>The clock</h2>
      ${STATE.cycle ? `<p>Cycle ${STATE.cycle.number}, ${PHASE[STATE.cycle.phase][0].toLowerCase()}. Next change in <strong>${until(STATE.cycle.next_at)}</strong> (${when(STATE.cycle.next_at)}).</p>`
        : '<p>The cycle is stopped. Elections only happen when you call them by hand.</p>'}
      <p class="small muted">Running the clock creates each cycle's elections, closes nominations, opens the poll and certifies the result on time. Anyone can change the timings above; the clock picks them up on the next minute.</p>
      <div class="row" style="margin-top:12px">
        <input type="datetime-local" id="anchor" style="width:auto">
        <button class="btn btn-primary" id="cycstart">${STATE.cycle ? 'Restart the cycle' : 'Start the cycle'}</button>
        ${STATE.cycle ? '<button class="btn" id="cycstop">Stop the clock</button>' : ''}
      </div>
      <p class="small muted" style="margin-top:8px">Leave the date blank to start from this moment. Cycle 1 begins at whatever you set.</p>
    </div>

    <div class="card"><h2>Invites</h2>
      <div class="row"><input id="n" type="number" value="1" min="1" max="50" style="width:80px">
        <input id="note" placeholder="Issued to (name from the chat)" style="width:auto;flex:1;min-width:180px">
        <button class="btn btn-primary" id="gen">Generate codes</button></div>
      <p class="small muted" style="margin-top:8px">Make one code at a time, write down who it went to, and <strong>send it in a direct message</strong>. A code pasted into the group chat can be claimed by whoever reads it first.</p>
      <div class="row" style="margin-top:10px">${invites.map(i =>
        `<span class="code" style="${i.used_by ? 'opacity:.4;text-decoration:line-through' : ''}">${esc(i.code)}${i.used_by_name ? ' · ' + esc(i.used_by_name) : ''}</span>`).join('') || '<span class="small muted">None yet.</span>'}</div>
    </div>

    <div class="card"><h2>Appoint and remove</h2>
      <p class="small muted">For ties, resignations, and coups. Elections normally do this for you.</p>
      <p class="small muted">The Prime Minister is properly appointed by the President and confirmed by the House on the <a href="#/prime-minister">Prime Minister</a> page — that records who backed the government. Use this only where the House has already decided elsewhere and will not tap through.</p>
      <p class="small muted">The Treasurer and the head of the Fed are not here on purpose. The Treasurer is the government's to appoint, and the Fed's head is nominated by the President, confirmed by the House, and removable only by impeachment — you would be taking a power from one of them, or a power nobody has.</p>
      <form id="off" class="stack" style="margin-top:10px">
        <div class="grid2">
          <label class="field"><span>Citizen</span><select name="user_id">${citizens.map(u => `<option value="${u.id}">${esc(u.display_name)}</option>`).join('')}</select></label>
          <label class="field"><span>Office</span><select name="office"><option value="mp">MP</option><option value="speaker">Speaker</option><option value="president">President</option><option value="prime_minister">Prime Minister</option></select></label>
        </div>
        <label class="field"><span>Seat number (MPs only)</span><input name="seat" type="number" min="1"></label>
        <div class="row"><button class="btn btn-primary" name="do" value="add">Appoint</button>
          <button class="btn" name="do" value="remove">Remove</button>
          <button class="btn" type="button" id="dis">Dissolve parliament</button></div>
      </form>
    </div>

    <div class="card"><h2>Citizens</h2>
      <div class="list">${citizens.map(u => `
        <div class="item"><div class="item-top">
          <span class="item-title">${esc(u.display_name)} ${u.is_admin ? '<span class="tag on-violet">admin</span>' : ''}</span>
          <span class="row">
            <button class="btn btn-sm" data-adm="${u.id}" data-val="${u.is_admin ? 'false' : 'true'}">${u.is_admin ? 'Demote' : 'Make admin'}</button>
            <button class="btn btn-sm" data-rst="${u.id}">Reset password</button>
            <button class="btn btn-sm" data-sus="${u.id}">Suspend</button>
          </span></div></div>`).join('')}</div>
    </div>

    <div class="card"><h2>Constitution</h2>
      <p class="small muted">Editing here publishes a new version directly. Normally you would pass a constitutional bill instead.</p>
      <form id="con" class="stack" style="margin-top:10px">
        <textarea name="body" style="min-height:320px;font-family:var(--mono);font-size:12.5px">${esc(con.current?.body || '')}</textarea>
        <button class="btn">Publish version ${(con.current?.version || 0) + 1}</button>
      </form>
    </div>`;

  $('#cfg').onsubmit = async e => {
    e.preventDefault();
    await api('/api/admin/config', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    await refreshState(); toast('Rules saved.');
  };
  $('#cycstart').onclick = async () => {
    const at = $('#anchor').value;
    if (STATE.cycle && !confirm('Restarting re-times the current cycle. Ballots already cast are kept; elections left over from the old schedule are voided. Continue?')) return;
    await api('/api/admin/cycle', { method: 'POST', body: { action: 'start', ...(at ? { anchor: new Date(at).toISOString() } : {}) } });
    await refreshState(); toast('The clock is running.'); route();
  };
  if ($('#cycstop')) $('#cycstop').onclick = async () => {
    await api('/api/admin/cycle', { method: 'POST', body: { action: 'stop' } });
    await refreshState(); toast('Clock stopped.'); route();
  };
  $('#gen').onclick = async () => {
    const codes = await api('/api/admin/invites', { method: 'POST', body: { count: Number($('#n').value), note: $('#note').value } });
    toast(codes.length + ' codes made.'); route();
  };
  $('#off').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const remove = e.submitter?.value === 'remove';
    await api('/api/admin/office', { method: 'POST', body: { ...f, user_id: Number(f.user_id), seat: Number(f.seat) || null, remove } });
    toast(remove ? 'Removed.' : 'Appointed.'); await refreshState();
  };
  $('#dis').onclick = async () => {
    if (!confirm('Vacate every seat and the Speaker?')) return;
    await api('/api/admin/dissolve', { method: 'POST' }); toast('Parliament dissolved.'); await refreshState();
  };
  $('#con').onsubmit = async e => {
    e.preventDefault();
    await api('/api/admin/constitution', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    toast('New version published.'); route();
  };
  document.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    await api('/api/admin/approve', { method: 'POST', body: { user_id: Number(b.dataset.ok), approve: true } });
    toast('Approved.'); await refreshState(); route();
  });
  document.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
    if (!confirm('Reject this application? The account is kept in the record but cannot sign in.')) return;
    await api('/api/admin/approve', { method: 'POST', body: { user_id: Number(b.dataset.no), approve: false } });
    toast('Rejected.'); route();
  });
  document.querySelectorAll('[data-adm]').forEach(b => b.onclick = async () => {
    await api('/api/admin/user', { method: 'POST', body: { user_id: Number(b.dataset.adm), is_admin: b.dataset.val === 'true' } });
    route();
  });
  document.querySelectorAll('[data-rst]').forEach(b => b.onclick = async () => {
    const r = await api('/api/admin/user', { method: 'POST', body: { user_id: Number(b.dataset.rst), reset_password: true } });
    alert('Temporary password: ' + r.temp_password);
  });
  document.querySelectorAll('[data-sus]').forEach(b => b.onclick = async () => {
    if (!confirm('Suspend this citizen? They lose access but keep their record.')) return;
    await api('/api/admin/user', { method: 'POST', body: { user_id: Number(b.dataset.sus), is_active: false } });
    route();
  });
}

async function viewParty(v, id) { location.hash = '#/parties'; }

/* What acts.js is allowed to reach. Deliberately narrow. */
window.Republic = {
  api, esc, md, toast, $, when, day, statusTag,
  state: () => STATE,
  me: () => ME,
  reload: () => route(),
  addRoute: (path, label, fn) => {
    if (!ROUTES.some(r => r[0] === path)) ROUTES.splice(ROUTES.length - 2, 0, [path, label, fn]);
  },
  addSubRoute: (path, fn) => { SUBROUTES[path] = fn; },
  refreshNav: () => { if (ME) drawRail(); }
};

start();
