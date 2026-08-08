/* Republic — single-file API server.
   Deploy on Render. Needs DATABASE_URL and JWT_SECRET. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 24) {
  console.error('[republic] Refusing to start: JWT_SECRET must be at least 24 random characters.');
  console.error('[republic] Anyone who guesses it can forge a session for any citizen, including you.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false }
});
const q = (sql, params = []) => pool.query(sql, params);

const app = express();
/* A browser only ever sends scheme + host as its Origin, so
   "https://you.github.io/your-repo" would never match anything and every request
   from the site would be dropped with no error the server can see. Normalise
   whatever was pasted down to a bare origin, and accept a missing scheme too. */
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)
  .map(x => { try { return new URL(x.includes('://') ? x : 'https://' + x).origin; } catch { return null; } })
  .filter(Boolean);
app.use(cors({ origin: ORIGINS.length ? ORIGINS : true }));
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

/* Rate limiting. Held in memory, so it resets when Render restarts the service.
   It stops password guessing and flooding; it is not what protects the votes —
   the database constraints are. Limits are per IP, and a group signing up on the
   same WiFi shares one, so the registration limit is deliberately loose: the
   approval queue is what actually decides who gets an account. */
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) { buckets.set(key, { n: 1, reset: now + windowMs }); return true; }
  if (b.n >= max) return false;
  b.n++; return true;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of buckets) if (t > v.reset) buckets.delete(k); }, 60000).unref();
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'local';
const throttle = (key, max, ms) => (req, res, next) =>
  limit(`${key}:${clientIp(req)}`, max, ms) ? next() : res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
const slowWrites = (req, res, next) =>
  limit(`w:${req.user?.id}`, 40, 5 * 60 * 1000) ? next() : res.status(429).json({ error: 'Slow down.' });

/* ---------------------------------------------------------------- config */

const DEFAULTS = {
  nation_name: 'The Republic',
  motto: 'Founded by group chat.',
  seats: '5',                      // parliamentary seats
  term_days: '14',                 // length of a term
  seconds_required: '2',           // seconders before a bill can be tabled
  quorum: '3',                     // MPs who must vote for a division to count
  pass_threshold: '0.5',           // ordinary bills, share of non-abstaining votes
  constitutional_threshold: '0.667',
  veto_override: '0.667',
  bill_proposers: 'mps',           // mps | citizens — who may propose and second a bill
  bill_voters: 'mps',              // mps | citizens
  allow_veto_override: 'false',    // false: the President's assent is required, full stop
  impeachment_threshold: '0.667',  // share of the division needed to remove an officer
  referendum_threshold: '0.7',     // share of a referendum needed to strike a law down
  referendum_quorum: '0.5',        // share of citizens who must vote for it to count
  referendum_days: '2',            // how long a referendum poll stays open
  petition_share: '0.334',         // share of citizens needed to force a referendum or an initiative
  initiative_mode: 'table',        // off | table | enact — what citizens' signatures can do
  initiative_threshold: '0.7',     // share of a referendum needed to enact an initiative directly
  secret_ballot: 'true',           // hide who voted for whom in elections
  allow_open_signup: 'false',      // if true, no invite code needed
  require_approval: 'true',        // new accounts stay inert until an admin approves them

  // --- the electoral cycle, run by the server clock
  cycle_enabled: 'false',          // start it from the admin page
  cycle_anchor: '',                // ISO timestamp: the moment cycle 1 began
  cycle_days: '7',                 // length of one electoral cycle
  campaign_days: '2',              // days of campaigning before the poll
  poll_days: '1',                  // days the poll stays open
  cycle_elects: 'parliament,president',   // what is contested each cycle
  speaker_auto: 'true',            // the House picks a Speaker after each election
  speaker_nomination_hours: '12',
  speaker_poll_hours: '12',
  speaker_threshold: '0.667',      // Article 4: two thirds of the House
  speaker_relax: '1',              // votes the bar drops after each failed ballot; 0 to never relax
  flag_law_ref: 'L001',            // the law the app reads the flag and its colours from
  enforce_term_limit: 'false'      // Article 7: no two consecutive cycles in office
};

let CONFIG = { ...DEFAULTS };

async function loadConfig() {
  const { rows } = await q('SELECT key, value FROM config');
  CONFIG = { ...DEFAULTS };
  for (const r of rows) CONFIG[r.key] = r.value;
  return CONFIG;
}
const num = (k) => Number(CONFIG[k]);

/* Settings the House can change by passing a bill. Everything about how the
   game is played is in here — timings, thresholds, seats, who votes.
   Deliberately absent: require_approval and allow_open_signup. Those decide who
   gets an account at all, and a faction with one temporary majority could use
   them to let in enough sockpuppets to hold every majority afterwards. They stay
   with the returning officer. Nothing else is withheld. */
const LEGISLATABLE = new Set([
  'nation_name', 'motto', 'seats', 'term_days', 'seconds_required', 'quorum',
  'pass_threshold', 'constitutional_threshold', 'veto_override', 'bill_voters',
  'bill_proposers', 'allow_veto_override', 'impeachment_threshold', 'referendum_threshold',
  'referendum_quorum', 'referendum_days', 'petition_share',
  'initiative_mode', 'initiative_threshold',
  'secret_ballot', 'cycle_enabled', 'cycle_days', 'campaign_days', 'poll_days',
  'cycle_elects', 'speaker_auto', 'speaker_threshold', 'speaker_nomination_hours',
  'speaker_poll_hours', 'speaker_relax', 'enforce_term_limit', 'flag_law_ref'
]);

/* ------------------------------------------------------------------ the flag

   The flag lives in the statute book, not in the code. Whatever law
   `flag_law_ref` points at is read for a schedule of colours, and the app takes
   its palette from that. Amend the law and the site changes with it. */

const SEED_FLAG_ACT = `The flag of the Republic is three horizontal bands of equal depth —
emerald above, white in the middle, ocean below — charged at the centre with a ring
of nineteen gold stars, one for each citizen at the founding.

## 1. The bands
1. The bands are of equal depth, one third of the flag each.
2. The upper band is emerald, the middle white, the lower ocean.

## 2. The device
1. Nineteen twelve-pointed stars of gold stand in a ring at the centre of the flag.
2. The ring is centred on the flag and crosses all three bands.
3. The number of stars may be altered to match the number of citizens.

## 3. The colours of the state
1. The colours below are the colours of the Republic. They are used for the flag,
   and everywhere else the Republic shows its face.
2. Where this Act is amended, the colours here become the colours of the Republic
   at once, without further act.

## Schedule
band = #006A44 1 — Emerald
band = #FFFFFF 1 — White
band = #003087 1 — Ocean
device = #F2A800 — Gold
stars = 19`;

/* Reads the schedule out of a flag law. Everything is optional: a law with
   nothing but two band lines still produces a usable flag and palette. */
function parseFlag(body) {
  const out = { bands: [], device: null, stars: 0, primary: null, accent: null };
  for (const raw of String(body || '').split('\n')) {
    const m = raw.trim().match(/^(band|device|stars|primary|accent)\s*=\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'stars') { out.stars = Math.max(0, Math.min(60, parseInt(val, 10) || 0)); continue; }
    const hex = (val.match(/#[0-9a-f]{6}/i) || [])[0];
    if (!hex) continue;
    if (key === 'band') {
      const weight = parseFloat((val.match(/#[0-9a-f]{6}\s+(\d+(?:\.\d+)?)/i) || [])[1]) || 1;
      const label = (val.split(/[—–]/)[1] || '').trim();
      out.bands.push({ colour: hex.toUpperCase(), weight, label });
    } else out[key] = hex.toUpperCase();
  }
  return out.bands.length ? out : null;
}

async function currentFlag() {
  const ref = CONFIG.flag_law_ref;
  if (!ref) return null;
  const law = (await q('SELECT ref,title,body FROM laws WHERE ref=$1 AND repealed_at IS NULL', [ref])).rows[0];
  if (!law) return null;
  const flag = parseFlag(law.body);
  return flag ? { ...flag, law_ref: law.ref, law_title: law.title } : null;
}

/* A rule bill carries its changes as `key = value` lines in the bill text, so the
   thing people vote on is exactly the thing that gets applied. */
function parseRuleChanges(body) {
  const changes = [], errors = [];
  for (const line of String(body || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const m = t.match(/^([a-z_]+)\s*=\s*(.+?)\s*$/i);
    if (!m) { errors.push(`Cannot read this line: "${t.slice(0, 60)}"`); continue; }
    const key = m[1].toLowerCase(), value = m[2].replace(/^["']|["']$/g, '');
    if (!(key in DEFAULTS)) { errors.push(`There is no setting called "${key}".`); continue; }
    if (!LEGISLATABLE.has(key)) { errors.push(`"${key}" decides who gets an account and cannot be set by a bill.`); continue; }
    changes.push({ key, value });
  }
  if (!changes.length && !errors.length) errors.push('A rule bill needs at least one line of the form setting = value.');
  return { changes, errors };
}
const bool = (k) => String(CONFIG[k]).toLowerCase() === 'true';

const SEED_CONSTITUTION = `# Constitution of the Republic

## Article I — The Citizens
1. Every member of the group chat who holds an account is a citizen.
2. Each citizen has exactly one vote in any election or referendum. Votes are final.

## Article II — Parliament
1. Parliament has 5 seats, filled by open election.
2. The candidates with the most votes take the seats.
3. Parliament sits for one term, after which all seats are vacated and re-contested.

## Article III — The Speaker
1. The Speaker is elected by Parliament from among its own members.
2. The Speaker decides which bills are tabled and when a division is called.
3. The Speaker votes as an ordinary member. A tied division is lost.

## Article IV — The President
1. The President is elected by all citizens.
2. The President may assent to or veto any bill that passes Parliament.
3. A veto may be overridden by a two-thirds vote of Parliament.

## Article V — Making Law
1. Any citizen may propose a bill.
2. A bill requires seconders before the Speaker may table it.
3. A tabled bill goes to a division. A simple majority of those voting carries it.
4. On assent, a bill becomes law and is entered in the Statute Book.

## Article VI — Amendment
1. This Constitution may be amended by a bill of type "constitutional".
2. Constitutional bills require a two-thirds majority.

## Article VII — Records
1. All elections, divisions and enactments are recorded and public.
2. No record may be deleted, only superseded.`;

/* ------------------------------------------------------------ bootstrap */

async function bootstrap() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  for (const [k, v] of Object.entries(DEFAULTS)) {
    await q('INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
  const c = await q('SELECT count(*)::int n FROM constitution');
  if (!c.rows[0].n) {
    await q('INSERT INTO constitution(version, body) VALUES(1, $1)', [SEED_CONSTITUTION]);
  }
  // The Flag Act is law from the first minute, so the Republic is never colourless.
  const l = await q('SELECT count(*)::int n FROM laws');
  if (!l.rows[0].n) {
    await q('INSERT INTO laws(ref,title,body) VALUES($1,$2,$3)', ['L001', 'The Flag Act', SEED_FLAG_ACT]);
  }
  await loadConfig();
  const u = await q('SELECT count(*)::int n FROM users');
  if (!u.rows[0].n) console.log('[republic] No citizens yet — the first account to register becomes admin.');
  console.log('[republic] ready');
  console.log(ORIGINS.length
    ? `[republic] browser requests accepted from: ${ORIGINS.join(', ')}`
    : '[republic] ALLOWED_ORIGINS is not set — requests accepted from anywhere.');
}

/* ----------------------------------------------------------------- auth */

function sign(user) {
  return jwt.sign({ id: user.id, tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: '60d' });
}

async function attach(req, _res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (t) {
    try {
      const p = jwt.verify(t, JWT_SECRET);
      const { rows } = await q(
        'SELECT id,username,display_name,bio,is_admin,is_active,approved,token_version FROM users WHERE id=$1', [p.id]);
      const u = rows[0];
      if (u && u.is_active && u.approved && (p.tv || 0) === (u.token_version || 0)) req.user = u;
    } catch { /* invalid token — treated as anonymous */ }
  }
  next();
}
app.use(attach);

const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to do that.' });
const admin = (req, res, next) => req.user?.is_admin ? next() : res.status(403).json({ error: 'Admins only.' });

async function officesOf(userId) {
  const { rows } = await q('SELECT office FROM offices WHERE user_id=$1 AND active', [userId]);
  return rows.map(r => r.office);
}
const holds = async (userId, office) => (await officesOf(userId)).includes(office);

function requireOffice(office) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to do that.' });
    if (req.user.is_admin || await holds(req.user.id, office)) return next();
    res.status(403).json({ error: `Only the ${office} can do that.` });
  };
}

const log = (actor, action, detail = '') =>
  q('INSERT INTO audit(actor_id,action,detail) VALUES($1,$2,$3)', [actor, action, detail]).catch(() => {});

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: 'Something broke on the server. Try again.' });
});

/* --------------------------------------------------------------- routes */

app.get('/api/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

app.post('/api/auth/register', throttle('register', 25, 60 * 60 * 1000), wrap(async (req, res) => {
  const { invite, username, display_name, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (!/^[a-z0-9_]{3,20}$/i.test(username)) return res.status(400).json({ error: 'Usernames are 3–20 characters: letters, numbers, underscore.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Passwords must be at least 8 characters.' });
  if (/^(password|12345678|qwertyui|letmein|football|iloveyou|abcd1234)/i.test(String(password)))
    return res.status(400).json({ error: 'Pick a password nobody in the chat would guess.' });

  const first = (await q('SELECT count(*)::int n FROM users')).rows[0].n === 0;
  let inviteRow = null;
  if (!first && !bool('allow_open_signup')) {
    if (!invite) return res.status(400).json({ error: 'An invite code is required.' });
    const r = await q('SELECT * FROM invites WHERE code=$1 AND used_by IS NULL', [String(invite).trim().toUpperCase()]);
    if (!r.rows[0]) return res.status(400).json({ error: 'That invite code is not valid or has already been used.' });
    inviteRow = r.rows[0];
  }

  const exists = await q('SELECT 1 FROM users WHERE lower(username)=lower($1)', [username]);
  if (exists.rows[0]) return res.status(409).json({ error: 'That username is taken.' });

  const approved = first || !bool('require_approval');
  const hash = await bcrypt.hash(String(password), 10);
  const { rows } = await q(
    `INSERT INTO users(username,display_name,password_hash,is_admin,approved) VALUES($1,$2,$3,$4,$5)
     RETURNING id,username,display_name,bio,is_admin,approved,token_version`,
    [username, display_name?.trim() || username, hash, first, approved]
  );
  const user = rows[0];
  if (inviteRow) await q('UPDATE invites SET used_by=$1, used_at=now() WHERE code=$2', [user.id, inviteRow.code]);
  log(user.id, 'register', `${user.username}${approved ? '' : ' — awaiting approval'}`);
  if (!approved) return res.json({ pending: true });
  res.json({ token: sign(user), user });
}));

app.post('/api/auth/login', throttle('login', 20, 15 * 60 * 1000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const { rows } = await q('SELECT * FROM users WHERE lower(username)=lower($1)', [username || '']);
  const u = rows[0];
  if (!u || !u.is_active || !await bcrypt.compare(String(password || ''), u.password_hash)) {
    if (!limit(`user:${String(username || '').toLowerCase()}`, 8, 15 * 60 * 1000))
      return res.status(429).json({ error: 'Too many failed attempts on this account. Wait a few minutes.' });
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  if (!u.approved) return res.status(403).json({ error: 'Your account is waiting for approval by the returning officer.' });
  res.json({ token: sign(u), user: { id: u.id, username: u.username, display_name: u.display_name, bio: u.bio, is_admin: u.is_admin } });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const party = await q('SELECT p.* FROM party_members m JOIN parties p ON p.id=m.party_id WHERE m.user_id=$1', [req.user.id]);
  res.json({ ...req.user, offices: await officesOf(req.user.id), party: party.rows[0] || null });
}));

app.put('/api/me', auth, wrap(async (req, res) => {
  const { display_name, bio } = req.body || {};
  await q('UPDATE users SET display_name=COALESCE($1,display_name), bio=COALESCE($2,bio) WHERE id=$3',
    [display_name?.trim() || null, bio ?? null, req.user.id]);
  res.json({ ok: true });
}));

app.post('/api/me/password', auth, wrap(async (req, res) => {
  const { current, next: nextPw } = req.body || {};
  const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(String(current || ''), rows[0].password_hash))
    return res.status(401).json({ error: 'Current password is wrong.' });
  if (String(nextPw || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows: upd } = await q(
    'UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2 RETURNING id,token_version',
    [await bcrypt.hash(String(nextPw), 10), req.user.id]);
  log(req.user.id, 'password.change', '');
  res.json({ ok: true, token: sign(upd[0]) });
}));

/* ----------------------------------------------------------- state feed */

app.get('/api/state', wrap(async (_req, res) => {
  await loadConfig();
  const [offices, parties, elections, bills, counts] = await Promise.all([
    q(`SELECT o.office, o.seat, o.since, u.id AS user_id, u.display_name, u.username,
              p.name AS party_name, p.abbr AS party_abbr, p.colour AS party_colour
         FROM offices o
         JOIN users u ON u.id=o.user_id
         LEFT JOIN party_members m ON m.user_id=u.id
         LEFT JOIN parties p ON p.id=m.party_id
        WHERE o.active ORDER BY o.office, o.seat NULLS LAST`),
    q(`SELECT p.*, (SELECT count(*)::int FROM party_members m WHERE m.party_id=p.id) AS members
         FROM parties p ORDER BY members DESC, p.name`),
    q(`SELECT id,kind,title,seats,status,campaign_at,opens_at,closes_at,auto,cycle_no FROM elections
        WHERE status<>'closed' ORDER BY created_at DESC`),
    q(`SELECT id,ref,title,kind,status FROM bills
        WHERE status IN ('petition','draft','tabled','division','referendum','passed')
        ORDER BY created_at DESC LIMIT 20`),
    q(`SELECT (SELECT count(*)::int FROM bills WHERE status='petition') AS petitions,
              (SELECT count(*)::int FROM elections WHERE kind='referendum' AND status='voting') AS referendums,
              (SELECT count(*)::int FROM users WHERE is_active AND approved) AS citizens,
              (SELECT count(*)::int FROM laws WHERE repealed_at IS NULL) AS laws,
              (SELECT max(version) FROM constitution) AS constitution_version`)
  ]);
  res.json({
    config: CONFIG,
    cycle: cycleNow(),
    flag: await currentFlag(),
    offices: offices.rows,
    parties: parties.rows,
    elections: elections.rows,
    bills: bills.rows,
    stats: counts.rows[0]
  });
}));

app.get('/api/citizens', wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT u.id,u.username,u.display_name,u.bio,u.is_admin,u.created_at,
           p.name AS party_name, p.abbr AS party_abbr, p.colour AS party_colour,
           COALESCE((SELECT array_agg(o.office) FROM offices o WHERE o.user_id=u.id AND o.active), '{}') AS offices
      FROM users u
      LEFT JOIN party_members m ON m.user_id=u.id
      LEFT JOIN parties p ON p.id=m.party_id
     WHERE u.is_active AND u.approved ORDER BY u.created_at`);
  res.json(rows);
}));

/* -------------------------------------------------------------- parties */

app.get('/api/parties', wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT p.*, u.display_name AS leader_name,
           COALESCE((SELECT json_agg(json_build_object('id',x.id,'display_name',x.display_name))
                       FROM party_members m JOIN users x ON x.id=m.user_id WHERE m.party_id=p.id), '[]') AS members
      FROM parties p LEFT JOIN users u ON u.id=p.leader_id ORDER BY p.created_at`);
  res.json(rows);
}));

app.post('/api/parties', auth, slowWrites, wrap(async (req, res) => {
  const { name, abbr, colour, manifesto } = req.body || {};
  if (!name || !abbr) return res.status(400).json({ error: 'A party needs a name and a short code.' });
  const dupe = await q('SELECT 1 FROM parties WHERE lower(name)=lower($1)', [name]);
  if (dupe.rows[0]) return res.status(409).json({ error: 'A party with that name already exists.' });
  const { rows } = await q(
    'INSERT INTO parties(name,abbr,colour,manifesto,leader_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [name.trim(), abbr.trim().toUpperCase().slice(0, 5), colour || '#5B2E9E', manifesto || '', req.user.id]);
  await q('INSERT INTO party_members(user_id,party_id) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET party_id=$2',
    [req.user.id, rows[0].id]);
  log(req.user.id, 'party.found', rows[0].name);
  res.json(rows[0]);
}));

app.put('/api/parties/:id', auth, wrap(async (req, res) => {
  const p = (await q('SELECT * FROM parties WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'No such party.' });
  if (p.leader_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Only the party leader can edit this.' });
  const { manifesto, colour, abbr } = req.body || {};
  await q('UPDATE parties SET manifesto=COALESCE($1,manifesto), colour=COALESCE($2,colour), abbr=COALESCE($3,abbr) WHERE id=$4',
    [manifesto ?? null, colour ?? null, abbr?.toUpperCase().slice(0, 5) ?? null, p.id]);
  res.json({ ok: true });
}));

app.post('/api/parties/:id/join', auth, wrap(async (req, res) => {
  const p = (await q('SELECT * FROM parties WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'No such party.' });
  await q('INSERT INTO party_members(user_id,party_id) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET party_id=$2, joined_at=now()',
    [req.user.id, p.id]);
  log(req.user.id, 'party.join', p.name);
  res.json({ ok: true });
}));

app.post('/api/parties/leave', auth, wrap(async (req, res) => {
  await q('DELETE FROM party_members WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ elections */

async function tally(electionId) {
  const { rows } = await q(`
    SELECT c.id, c.user_id, c.statement, c.withdrawn, u.display_name, u.username,
           p.name AS party_name, p.abbr AS party_abbr, p.colour AS party_colour,
           (SELECT count(*)::int FROM votes v WHERE v.candidacy_id=c.id) AS votes
      FROM candidacies c
      JOIN users u ON u.id=c.user_id
      LEFT JOIN parties p ON p.id=c.party_id
     WHERE c.election_id=$1
     ORDER BY votes DESC, u.display_name`, [electionId]);
  return rows;
}

/* The roll is frozen at the moment the poll opened, so an account created
   mid-poll cannot vote in it. Set lazily, so it holds however the poll opened —
   by hand, or by the cycle clock. */
async function rollCutoff(e) {
  if (e.status !== 'voting') return null;
  if (e.opened_at) return e.opened_at;
  const r = await q('UPDATE elections SET opened_at=COALESCE(opened_at, now()) WHERE id=$1 RETURNING opened_at', [e.id]);
  return r.rows[0]?.opened_at || null;
}

async function electorate(e) {
  // Accepts an election row or a bare kind, because certify() asks for the
  // House roll before it has anything else to hand.
  if (typeof e === 'string') e = { kind: e };
  if (e.kind === 'speaker') {
    const { rows } = await q("SELECT user_id FROM offices WHERE active AND office='mp'");
    return rows.map(r => r.user_id);
  }
  const cutoff = await rollCutoff(e);
  const { rows } = await q(
    `SELECT id FROM users WHERE is_active AND approved
       AND ($1::timestamptz IS NULL OR created_at < $1)`, [cutoff]);
  return rows.map(r => r.id);
}

const DAY = 86400000, HOUR = 3600000;
const TITLES = { parliament: 'General election', president: 'Presidential election', speaker: 'Election of the Speaker', referendum: 'Referendum' };

/* Close an election and seat whoever won it. Used by the admin route and by the clock. */
/* ------------------------------------------------------------ referendums

   The House makes the law; the people can take it back. A referendum is bound to
   a law, asks one question, and strikes the law down if enough of the Republic
   says so. Citizens force one by petition — nobody has to ask permission. */

async function citizenCount() {
  return (await q('SELECT count(*)::int n FROM users WHERE is_active AND approved')).rows[0].n;
}

/* Two questions share one ballot box. On a law the proposition is "strike this
   down", so `reject` is the affirmative. On an initiative it is "make this law",
   so `enact` is. `share` always means the share in favour of the proposition. */
async function referendumTally(electionId, kind = 'law') {
  const { rows } = await q('SELECT choice FROM referendum_votes WHERE election_id=$1', [electionId]);
  const yes = rows.filter(r => r.choice === (kind === 'initiative' ? 'enact' : 'reject')).length;
  const no = rows.filter(r => r.choice === (kind === 'initiative' ? 'reject' : 'keep')).length;
  const cast = yes + no;
  return { yes, no, keep: kind === 'initiative' ? no : no, reject: kind === 'initiative' ? no : yes,
           enact: kind === 'initiative' ? yes : 0, cast, share: cast ? yes / cast : 0 };
}

async function openInitiativeReferendum(bill, actorId) {
  const open = (await q(
    "SELECT 1 FROM elections WHERE kind='referendum' AND target_bill_id=$1 AND status<>'closed'", [bill.id])).rows[0];
  if (open) return null;
  const closes = new Date(Date.now() + num('referendum_days') * DAY);
  const { rows } = await q(
    `INSERT INTO elections(kind,title,seats,status,target_bill_id,opens_at,closes_at,auto)
     VALUES('referendum',$1,1,'voting',$2,now(),$3,TRUE) RETURNING *`,
    [`Initiative on ${bill.ref} — ${bill.title}`, bill.id, closes]);
  await q("UPDATE bills SET status='referendum' WHERE id=$1", [bill.id]);
  log(actorId, 'initiative.referendum', bill.ref);
  return rows[0];
}

async function openReferendum(lawId, actorId, why) {
  const open = (await q(
    "SELECT 1 FROM elections WHERE kind='referendum' AND target_law_id=$1 AND status<>'closed'", [lawId])).rows[0];
  if (open) return null;
  const law = (await q('SELECT ref,title FROM laws WHERE id=$1 AND repealed_at IS NULL', [lawId])).rows[0];
  if (!law) return null;
  const closes = new Date(Date.now() + num('referendum_days') * DAY);
  const { rows } = await q(
    `INSERT INTO elections(kind,title,seats,status,target_law_id,opens_at,closes_at,auto)
     VALUES('referendum',$1,1,'voting',$2,now(),$3,TRUE) RETURNING *`,
    [`Referendum on ${law.ref} — ${law.title}`, lawId, closes]);
  log(actorId, 'referendum.open', `${law.ref} (${why})`);
  return rows[0];
}

async function certify(e, actorId) {
  await loadConfig();
  await q("UPDATE elections SET status='closed' WHERE id=$1", [e.id]);

  if (e.kind === 'referendum' && e.target_bill_id) {
    const b = (await q('SELECT * FROM bills WHERE id=$1', [e.target_bill_id])).rows[0];
    const t = await referendumTally(e.id, 'initiative');
    const roll = await citizenCount();
    const quorum = Math.ceil(num('referendum_quorum') * roll);
    const need = num('initiative_threshold');
    const out = { seated: [], referendum: true, initiative: true, ...t, roll, quorum, need };
    if (t.cast < quorum || t.share < need) {
      await q("UPDATE bills SET status='failed', result=$1, resolved_at=now() WHERE id=$2",
        [`${t.yes} for / ${t.no} against`, b.id]);
      log(actorId, 'initiative.lost', `${b.ref}: ${t.cast < quorum ? 'quorum' : Math.round(t.share * 100) + '%'}`);
      return { ...out, enacted: false, reason: t.cast < quorum ? 'quorum' : 'threshold' };
    }
    // The people have spoken directly: this becomes law without the House or the President.
    await enact(b, actorId);
    await q('UPDATE bills SET result=$1 WHERE id=$2', [`${t.yes} for / ${t.no} against`, b.id]);
    log(actorId, 'initiative.enacted', `${b.ref} by ${Math.round(t.share * 100)}% of ${t.cast} votes`);
    return { ...out, enacted: true, bill: b.ref };
  }

  if (e.kind === 'referendum') {
    if (!e.target_law_id) return { seated: [], referendum: true };
    const t = await referendumTally(e.id, 'law');
    const roll = await citizenCount();
    const quorum = Math.ceil(num('referendum_quorum') * roll);
    const need = num('referendum_threshold');
    const out = { seated: [], referendum: true, ...t, roll, quorum, need };
    if (t.cast < quorum) {
      log(actorId, 'referendum.void', `too few voted: ${t.cast} of ${quorum} needed`);
      return { ...out, struck: false, reason: 'quorum' };
    }
    if (t.share < need) {
      log(actorId, 'referendum.kept', `${Math.round(t.share * 100)}% to reject, ${Math.round(need * 100)}% needed`);
      return { ...out, struck: false, reason: 'threshold' };
    }
    const law = (await q(
      'UPDATE laws SET repealed_at=now() WHERE id=$1 AND repealed_at IS NULL RETURNING ref,title',
      [e.target_law_id])).rows[0];
    log(actorId, 'referendum.struck', `${law?.ref || '?'} rejected by ${Math.round(t.share * 100)}% of ${t.cast} votes`);
    return { ...out, struck: true, law: law?.ref };
  }

  const results = (await tally(e.id)).filter(c => !c.withdrawn);
  const winners = results.slice(0, e.seats).filter(w => w.votes > 0);
  const office = e.kind === 'parliament' ? 'mp' : e.kind;

  // Article 4: the Speaker needs two thirds of the whole House, not merely the most
  // votes — and each failed ballot lowers the bar by one vote, down to a simple
  // majority, so the House cannot deadlock itself into silence forever.
  if (e.kind === 'speaker') {
    const roll = await electorate('speaker');
    const house = roll.length;
    // Count only ballots that produced nobody, and only since the chair was last
    // filled or the House last seated — whichever came later. A successful ballot
    // puts the bar back to two thirds for the next vacancy.
    const cutoff = (await q(`
      SELECT GREATEST(
        COALESCE((SELECT min(since) FROM offices WHERE active AND office='mp'), 'epoch'::timestamptz),
        COALESCE((SELECT max(el.created_at) FROM elections el
                   WHERE el.kind='speaker' AND EXISTS (SELECT 1 FROM offices o WHERE o.election_id=el.id)),
                 'epoch'::timestamptz)) AS c`)).rows[0].c;
    const priorFailures = (await q(`
      SELECT count(*)::int n FROM elections el
       WHERE el.kind='speaker' AND el.status='closed' AND el.id <> $1 AND el.created_at >= $2
         AND NOT EXISTS (SELECT 1 FROM offices o WHERE o.election_id = el.id)`, [e.id, cutoff])).rows[0].n;
    const floor = Math.floor(house / 2) + 1;                       // a simple majority, never lower
    const full = Math.ceil(num('speaker_threshold') * house);
    const needed = Math.max(floor, full - priorFailures * num('speaker_relax'));
    if (!winners[0] || winners[0].votes < needed) {
      const nextNeeded = Math.max(floor, needed - num('speaker_relax'));
      log(actorId, 'election.speaker.failed', `${e.title}: ${winners[0]?.votes || 0} of ${needed} needed`);
      return {
        seated: [], failed: true, needed, best: winners[0]?.votes || 0, house,
        ballot: priorFailures + 1, next_needed: nextNeeded
      };
    }
    log(actorId, 'election.speaker.carried', `${winners[0].display_name} with ${winners[0].votes} of ${needed} needed`);
  }

  const cutoff = winners.at(-1)?.votes;
  const tie = results.filter(r => r.votes === cutoff).length > winners.filter(w => w.votes === cutoff).length;

  await q('UPDATE offices SET active=FALSE, until=now() WHERE office=$1 AND active', [office]);
  if (office === 'mp') await q("UPDATE offices SET active=FALSE, until=now() WHERE office='speaker' AND active");
  const seated = [];
  let seat = 1;
  for (const w of winners) {
    await q('INSERT INTO offices(office,user_id,seat,election_id) VALUES($1,$2,$3,$4)',
      [office, w.user_id, office === 'mp' ? seat++ : null, e.id]);
    seated.push({ office, name: w.display_name, votes: w.votes });
  }
  log(actorId, 'election.certify', `${e.title}: ${seated.map(x => x.name).join(', ') || 'nobody'}`);
  return { seated, tie };
}

/* ------------------------------------------------------- the electoral cycle */

function cyclePlan(anchor, k) {
  const len = num('cycle_days'), camp = num('campaign_days'), poll = num('poll_days');
  const start = new Date(anchor.getTime() + k * len * DAY);
  return {
    start,
    campaign_at: new Date(start.getTime() + Math.max(0, len - camp - poll) * DAY),
    opens_at: new Date(start.getTime() + Math.max(0, len - poll) * DAY),
    closes_at: new Date(start.getTime() + len * DAY)
  };
}

/* Where we are right now, derived from the clock rather than stored. */
function cycleNow() {
  if (!bool('cycle_enabled') || !CONFIG.cycle_anchor) return null;
  const anchor = new Date(CONFIG.cycle_anchor);
  const len = num('cycle_days');
  if (isNaN(anchor.getTime()) || !(len > 0)) return null;
  const k = Math.floor((Date.now() - anchor.getTime()) / (len * DAY));
  if (k < 0) return { number: 0, phase: 'pending', next_at: anchor, start: anchor };
  const p = cyclePlan(anchor, k);
  const now = Date.now();
  let phase = 'nominations', next = p.campaign_at;
  if (now >= p.opens_at.getTime()) { phase = 'poll'; next = p.closes_at; }
  else if (now >= p.campaign_at.getTime()) { phase = 'campaign'; next = p.opens_at; }
  return { number: k + 1, phase, next_at: next, ...p };
}

/* The House keeps balloting until someone clears the threshold. */
async function ensureSpeakerElection() {
  const mps = (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;
  if (!mps) return;
  if ((await q("SELECT 1 FROM offices WHERE active AND office='speaker'")).rows[0]) return;
  if ((await q("SELECT 1 FROM elections WHERE kind='speaker' AND status<>'closed'")).rows[0]) return;
  const opens = new Date(Date.now() + num('speaker_nomination_hours') * HOUR);
  const closes = new Date(opens.getTime() + num('speaker_poll_hours') * HOUR);
  await q(`INSERT INTO elections(kind,title,seats,status,opens_at,closes_at,auto)
           VALUES('speaker',$1,1,'nominations',$2,$3,TRUE)`, [TITLES.speaker, opens, closes]);
  log(null, 'cycle.speaker', 'ballot opened');
}

/* One minute tick: open the cycle's elections, then move any scheduled election along. */
async function tick() {
  try {
    await loadConfig();
    const c = cycleNow();
    if (c && c.number > 0) {
      for (const kind of CONFIG.cycle_elects.split(',').map(x => x.trim()).filter(Boolean)) {
        if (!TITLES[kind] || kind === 'speaker') continue;
        // The closing deadline identifies a cycle's election, so restarting the clock
        // with a new anchor makes fresh ones instead of silently doing nothing.
        if ((await q('SELECT 1 FROM elections WHERE kind=$1 AND closes_at=$2', [kind, c.closes_at])).rows[0]) continue;
        await q(`INSERT INTO elections(kind,title,seats,status,campaign_at,opens_at,closes_at,auto,cycle_no)
                 VALUES($1,$2,$3,'nominations',$4,$5,$6,TRUE,$7)`,
          [kind, `${TITLES[kind]} — cycle ${c.number}`, kind === 'parliament' ? num('seats') : 1,
           c.campaign_at, c.opens_at, c.closes_at, c.number]);
        log(null, 'cycle.open', `${kind}, cycle ${c.number}`);
      }
    }

    const due = (await q(`SELECT * FROM elections WHERE status<>'closed'
                          AND (campaign_at IS NOT NULL OR opens_at IS NOT NULL OR closes_at IS NOT NULL)`)).rows;
    const now = Date.now();
    for (const e of due) {
      if (e.closes_at && now >= +new Date(e.closes_at)) { await certify(e, null); continue; }

      // Elections on the clock track their timetable in both directions, so re-anchoring
      // the cycle moves them back too. Manual ones only ever move forward.
      let want = e.status;
      if (e.auto) {
        want = 'nominations';
        if (e.campaign_at && now >= +new Date(e.campaign_at)) want = 'campaign';
        if (e.opens_at && now >= +new Date(e.opens_at)) want = 'voting';
      } else if (e.opens_at && now >= +new Date(e.opens_at) && e.status !== 'voting') want = 'voting';
      else if (e.campaign_at && now >= +new Date(e.campaign_at) && e.status === 'nominations') want = 'campaign';

      if (want !== e.status) {
        await q('UPDATE elections SET status=$1 WHERE id=$2', [want, e.id]);
        log(null, 'cycle.' + want, e.title);
      }
    }

    if (bool('speaker_auto')) await ensureSpeakerElection();
  } catch (err) {
    console.error('[republic] tick failed:', err.message);
  }
}

app.get('/api/elections', wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT e.*, (SELECT count(*)::int FROM votes v WHERE v.election_id=e.id) AS turnout,
                (SELECT count(*)::int FROM candidacies c WHERE c.election_id=e.id AND NOT c.withdrawn) AS runners
      FROM elections e ORDER BY e.created_at DESC`);
  res.json(rows);
}));

app.get('/api/elections/:id', wrap(async (req, res) => {
  const e = (await q('SELECT * FROM elections WHERE id=$1', [req.params.id])).rows[0];
  if (!e) return res.status(404).json({ error: 'No such election.' });
  const candidates = await tally(e.id);
  const hideCounts = bool('secret_ballot') && e.status === 'voting';
  const roll = await electorate(e);
  let myVote = null;
  if (req.user) {
    const v = await q('SELECT candidacy_id FROM votes WHERE election_id=$1 AND voter_id=$2', [e.id, req.user.id]);
    myVote = v.rows[0]?.candidacy_id ?? null;
  }
  if (e.kind === 'referendum' && e.target_bill_id) {
    const t = await referendumTally(e.id, 'initiative');
    const bill = (await q('SELECT id,ref,title,kind,body,status FROM bills WHERE id=$1', [e.target_bill_id])).rows[0];
    const mine = req.user
      ? (await q('SELECT choice FROM referendum_votes WHERE election_id=$1 AND user_id=$2', [e.id, req.user.id])).rows[0]
      : null;
    const rollN = await citizenCount();
    return res.json({
      ...e, bill, initiative: true,
      eligible: roll.length,
      turnout: t.cast,
      can_vote: req.user ? roll.includes(req.user.id) : false,
      my_choice: mine?.choice || null,
      tally: hideCounts ? null : t,
      quorum: Math.ceil(num('referendum_quorum') * rollN),
      need: num('initiative_threshold'),
      candidates: []
    });
  }

  if (e.kind === 'referendum' && e.target_law_id) {
    const t = await referendumTally(e.id);
    const law = (await q('SELECT id,ref,title,body,repealed_at FROM laws WHERE id=$1', [e.target_law_id])).rows[0];
    const mine = req.user
      ? (await q('SELECT choice FROM referendum_votes WHERE election_id=$1 AND user_id=$2', [e.id, req.user.id])).rows[0]
      : null;
    const rollN = await citizenCount();
    return res.json({
      ...e, law,
      eligible: roll.length,
      turnout: t.cast,
      can_vote: req.user ? roll.includes(req.user.id) : false,
      my_choice: mine?.choice || null,
      tally: hideCounts ? null : t,
      quorum: Math.ceil(num('referendum_quorum') * rollN),
      need: num('referendum_threshold'),
      candidates: []
    });
  }

  res.json({
    ...e,
    eligible: roll.length,
    turnout: (await q('SELECT count(*)::int n FROM votes WHERE election_id=$1', [e.id])).rows[0].n,
    can_vote: req.user ? roll.includes(req.user.id) : false,
    my_vote: myVote,
    candidates: candidates.map(c => hideCounts ? { ...c, votes: null } : c)
  });
}));

app.post('/api/elections', admin, wrap(async (req, res) => {
  await loadConfig();
  const { kind, title, seats, closes_at, target_law_id } = req.body || {};
  if (!['president', 'parliament', 'speaker', 'referendum'].includes(kind))
    return res.status(400).json({ error: 'Pick a valid election type.' });
  if (kind === 'referendum' && target_law_id) {
    const made = await openReferendum(Number(target_law_id), req.user.id, 'called by the returning officer');
    if (!made) return res.status(400).json({ error: 'That law is already under referendum, or is not in force.' });
    return res.json(made);
  }
  const n = kind === 'parliament' ? (Number(seats) || num('seats')) : 1;
  const { rows } = await q('INSERT INTO elections(kind,title,seats,closes_at) VALUES($1,$2,$3,$4) RETURNING *',
    [kind, title?.trim() || TITLES[kind], n, closes_at || null]);
  log(req.user.id, 'election.create', rows[0].title);
  res.json(rows[0]);
}));

app.post('/api/elections/:id/stand', auth, wrap(async (req, res) => {
  await loadConfig();
  const e = (await q('SELECT * FROM elections WHERE id=$1', [req.params.id])).rows[0];
  if (!e) return res.status(404).json({ error: 'No such election.' });
  if (e.status !== 'nominations') return res.status(400).json({ error: 'Nominations have closed for this election.' });
  if (e.kind === 'speaker' && !await holds(req.user.id, 'mp'))
    return res.status(403).json({ error: 'Only sitting MPs may stand for Speaker.' });

  // Article 7: no two consecutive cycles in office. Sitting officers are exactly the people who
  // held office last cycle, since seats are only vacated when the next poll is certified.
  if (bool('enforce_term_limit') && e.kind !== 'speaker' && (await officesOf(req.user.id)).length)
    return res.status(403).json({ error: 'You hold office this cycle. Article 7 makes you sit the next one out.' });
  const party = (await q('SELECT party_id FROM party_members WHERE user_id=$1', [req.user.id])).rows[0];
  const { rows } = await q(`
    INSERT INTO candidacies(election_id,user_id,party_id,statement) VALUES($1,$2,$3,$4)
    ON CONFLICT (election_id,user_id) DO UPDATE SET statement=$4, party_id=$3, withdrawn=FALSE
    RETURNING *`, [e.id, req.user.id, party?.party_id || null, (req.body?.statement || '').slice(0, 4000)]);
  log(req.user.id, 'election.stand', e.title);
  res.json(rows[0]);
}));

app.post('/api/elections/:id/withdraw', auth, wrap(async (req, res) => {
  const e = (await q('SELECT status FROM elections WHERE id=$1', [req.params.id])).rows[0];
  if (!e) return res.status(404).json({ error: 'No such election.' });
  if (e.status === 'voting' || e.status === 'closed')
    return res.status(400).json({ error: 'You cannot withdraw once the poll has opened — it would void ballots already cast.' });
  await q('UPDATE candidacies SET withdrawn=TRUE WHERE election_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

app.post('/api/elections/:id/vote', auth, wrap(async (req, res) => {
  const e = (await q('SELECT * FROM elections WHERE id=$1', [req.params.id])).rows[0];
  if (!e) return res.status(404).json({ error: 'No such election.' });
  if (e.status !== 'voting') return res.status(400).json({ error: 'This election is not open for voting.' });
  if (e.closes_at && new Date(e.closes_at) < new Date()) return res.status(400).json({ error: 'The poll has closed.' });
  const roll = await electorate(e);
  if (!roll.includes(req.user.id)) return res.status(403).json({ error: 'You are not in the electorate for this vote.' });
  const c = (await q('SELECT * FROM candidacies WHERE id=$1 AND election_id=$2 AND NOT withdrawn',
    [req.body?.candidacy_id, e.id])).rows[0];
  if (!c) return res.status(400).json({ error: 'That candidate is not standing.' });
  try {
    await q('INSERT INTO votes(election_id,voter_id,candidacy_id) VALUES($1,$2,$3)', [e.id, req.user.id, c.id]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You have already voted in this election. One vote each.' });
    throw err;
  }
  log(req.user.id, 'election.vote', `#${e.id}`);
  res.json({ ok: true });
}));

app.post('/api/elections/:id/referendum', auth, wrap(async (req, res) => {
  await loadConfig();
  const e = (await q('SELECT * FROM elections WHERE id=$1', [req.params.id])).rows[0];
  if (!e || e.kind !== 'referendum') return res.status(404).json({ error: 'No such referendum.' });
  if (e.status !== 'voting') return res.status(400).json({ error: 'This referendum is not open.' });
  if (e.closes_at && new Date(e.closes_at) < new Date()) return res.status(400).json({ error: 'The poll has closed.' });
  const choice = req.body?.choice;
  const allowed = e.target_bill_id ? ['enact', 'reject'] : ['keep', 'reject'];
  if (!allowed.includes(choice))
    return res.status(400).json({ error: `Vote ${allowed[0]} or ${allowed[1]}.` });
  const roll = await electorate(e);
  if (!roll.includes(req.user.id)) return res.status(403).json({ error: 'You are not in the electorate for this vote.' });
  try {
    await q('INSERT INTO referendum_votes(election_id,user_id,choice) VALUES($1,$2,$3)', [e.id, req.user.id, choice]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You have already voted in this referendum. One vote each.' });
    throw err;
  }
  log(req.user.id, 'referendum.vote', `#${e.id}`);
  res.json({ ok: true });
}));

/* Any citizen may sign. Enough signatures and the referendum opens itself —
   the House and the President are not consulted. */
app.post('/api/laws/:id/petition', auth, wrap(async (req, res) => {
  await loadConfig();
  const law = (await q('SELECT id,ref FROM laws WHERE id=$1 AND repealed_at IS NULL', [req.params.id])).rows[0];
  if (!law) return res.status(404).json({ error: 'No such law in force.' });
  await q('INSERT INTO petitions(law_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [law.id, req.user.id]);
  const signed = (await q('SELECT count(*)::int n FROM petitions WHERE law_id=$1', [law.id])).rows[0].n;
  const needed = Math.max(1, Math.ceil(num('petition_share') * await citizenCount()));
  let opened = null;
  if (signed >= needed) opened = await openReferendum(law.id, req.user.id, `petition of ${signed}`);
  res.json({ signed, needed, opened: !!opened, election_id: opened?.id || null });
}));

app.get('/api/laws/:id/petition', wrap(async (req, res) => {
  await loadConfig();
  const signed = (await q('SELECT count(*)::int n FROM petitions WHERE law_id=$1', [req.params.id])).rows[0].n;
  const mine = req.user
    ? !!(await q('SELECT 1 FROM petitions WHERE law_id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0]
    : false;
  const live = (await q(
    "SELECT id FROM elections WHERE kind='referendum' AND target_law_id=$1 AND status<>'closed'", [req.params.id])).rows[0];
  res.json({
    signed, mine,
    needed: Math.max(1, Math.ceil(num('petition_share') * await citizenCount())),
    election_id: live?.id || null
  });
}));

app.post('/api/elections/:id/status', admin, wrap(async (req, res) => {
  await loadConfig();
  const status = req.body?.status;
  if (!['nominations', 'campaign', 'voting', 'closed'].includes(status))
    return res.status(400).json({ error: 'Status must be nominations, campaign, voting or closed.' });
  const e = (await q('SELECT * FROM elections WHERE id=$1', [req.params.id])).rows[0];
  if (!e) return res.status(404).json({ error: 'No such election.' });

  if (e.status === 'closed' && status !== 'closed')
    return res.status(400).json({ error: 'A certified election cannot be reopened. Call a fresh one instead.' });
  if (status === 'closed') return res.json({ ...e, ...(await certify(e, req.user.id)) });

  // Taking manual control detaches the election from the clock.
  await q('UPDATE elections SET status=$1, auto=FALSE WHERE id=$2', [status, e.id]);
  log(req.user.id, 'election.status', `${e.title} -> ${status}`);
  res.json({ ...e, status });
}));

app.post('/api/admin/cycle', admin, wrap(async (req, res) => {
  const action = req.body?.action;
  if (action === 'start') {
    const at = req.body?.anchor ? new Date(req.body.anchor) : new Date();
    if (isNaN(at.getTime())) return res.status(400).json({ error: 'That start time makes no sense.' });
    await q("INSERT INTO config(key,value) VALUES('cycle_anchor',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [at.toISOString()]);
    await q("INSERT INTO config(key,value) VALUES('cycle_enabled','true') ON CONFLICT (key) DO UPDATE SET value='true'");
    log(req.user.id, 'cycle.start', at.toISOString());
    await loadConfig();
    // Re-anchoring re-times this cycle's elections rather than duplicating them,
    // and voids anything left over from the schedule you just replaced.
    const c = cycleNow();
    if (c && c.number > 0) {
      await q(`UPDATE elections SET campaign_at=$1, opens_at=$2, closes_at=$3
                WHERE auto AND status<>'closed' AND kind<>'speaker' AND cycle_no=$4`,
        [c.campaign_at, c.opens_at, c.closes_at, c.number]);
      // Leftovers from the schedule you replaced: a poll that actually ran is honoured
      // and certified; one that never opened is simply voided.
      const orphans = (await q(`SELECT * FROM elections WHERE auto AND status<>'closed'
                                AND kind<>'speaker' AND cycle_no IS DISTINCT FROM $1`, [c.number])).rows;
      for (const o of orphans) {
        if (o.status === 'voting') await certify(o, req.user.id);
        else {
          await q("UPDATE elections SET status='closed', auto=FALSE WHERE id=$1", [o.id]);
          log(req.user.id, 'cycle.void', o.title);
        }
      }
    }
  } else if (action === 'stop') {
    await q("INSERT INTO config(key,value) VALUES('cycle_enabled','false') ON CONFLICT (key) DO UPDATE SET value='false'");
    log(req.user.id, 'cycle.stop', '');
  } else return res.status(400).json({ error: 'Action must be start or stop.' });
  await loadConfig();
  await tick();
  res.json({ cycle: cycleNow(), config: CONFIG });
}));

/* ---------------------------------------------------------------- bills */

/* Who may put a bill before the House, and who may second one. Defaults to the
   House alone; a rule bill can open it to every citizen. */
async function canPropose(userId) {
  if (CONFIG.bill_proposers === 'citizens') return true;
  const u = (await q('SELECT is_admin FROM users WHERE id=$1', [userId])).rows[0];
  if (u?.is_admin) return true;
  return (await officesOf(userId)).some(o => o === 'mp' || o === 'speaker');
}

const NOT_YOURS = 'Only the House may do that. A rule bill can open it to every citizen.';

async function billVoters() {
  if (CONFIG.bill_voters === 'citizens') {
    const { rows } = await q('SELECT id FROM users WHERE is_active AND approved');
    return rows.map(r => r.id);
  }
  const { rows } = await q("SELECT user_id FROM offices WHERE active AND office='mp'");
  return rows.map(r => r.user_id);
}

async function billDetail(id, viewer) {
  const b = (await q(`
    SELECT b.*, u.display_name AS author_name, u.username AS author_username,
           t.display_name AS target_name,
           (SELECT count(*)::int FROM bill_petitions p WHERE p.bill_id=b.id) AS signatures,
           (SELECT count(*)::int FROM bill_seconds s WHERE s.bill_id=b.id) AS seconds
      FROM bills b LEFT JOIN users u ON u.id=b.author_id
      LEFT JOIN users t ON t.id=b.target_user_id WHERE b.id=$1`, [id])).rows[0];
  if (!b) return null;
  const div = (await q(`
    SELECT v.vote, u.id AS user_id, u.display_name
      FROM bill_votes v JOIN users u ON u.id=v.user_id WHERE v.bill_id=$1 ORDER BY v.cast_at`, [id])).rows;
  const comments = (await q(`
    SELECT c.*, u.display_name FROM comments c JOIN users u ON u.id=c.user_id
     WHERE c.bill_id=$1 ORDER BY c.created_at`, [id])).rows;
  const seconders = (await q(`
    SELECT u.id,u.display_name FROM bill_seconds s JOIN users u ON u.id=s.user_id WHERE s.bill_id=$1`, [id])).rows;
  const eligible = await billVoters();
  return {
    ...b,
    division: div,
    counts: {
      aye: div.filter(v => v.vote === 'aye').length,
      no: div.filter(v => v.vote === 'no').length,
      abstain: div.filter(v => v.vote === 'abstain').length,
      eligible: eligible.length
    },
    seconders,
    comments,
    my_vote: viewer ? (div.find(v => v.user_id === viewer.id)?.vote ?? null) : null,
    i_seconded: viewer ? seconders.some(s => s.id === viewer.id) : false,
    can_vote: viewer ? eligible.includes(viewer.id) : false
  };
}

app.get('/api/bills', wrap(async (req, res) => {
  const status = req.query.status;
  const { rows } = await q(`
    SELECT b.id,b.ref,b.title,b.kind,b.status,b.created_at,b.result,u.display_name AS author_name,
           (SELECT count(*)::int FROM bill_seconds s WHERE s.bill_id=b.id) AS seconds,
           (SELECT count(*)::int FROM comments c WHERE c.bill_id=b.id) AS comments
      FROM bills b LEFT JOIN users u ON u.id=b.author_id
     WHERE ($1::text IS NULL OR b.status=$1) ORDER BY b.created_at DESC`, [status || null]);
  res.json(rows);
}));

app.get('/api/bills/:id', wrap(async (req, res) => {
  const b = await billDetail(req.params.id, req.user);
  b ? res.json(b) : res.status(404).json({ error: 'No such bill.' });
}));

app.post('/api/bills', auth, slowWrites, wrap(async (req, res) => {
  await loadConfig();
  if (!await canPropose(req.user.id)) return res.status(403).json({ error: NOT_YOURS });
  const { title, kind, body, target_law_id, target_user_id } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'A bill needs a title and a text.' });
  const k = ['law', 'amendment', 'repeal', 'motion', 'constitutional', 'rule', 'impeachment'].includes(kind) ? kind : 'law';
  if (k === 'rule') {
    const { errors } = parseRuleChanges(body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  }
  if (k === 'impeachment') {
    const t = (await q('SELECT id FROM users WHERE id=$1 AND is_active', [target_user_id || 0])).rows[0];
    if (!t) return res.status(400).json({ error: 'An impeachment must name the officer it removes.' });
    const held = await officesOf(t.id);
    if (!held.length) return res.status(400).json({ error: 'That citizen holds no office, so there is nothing to remove them from.' });
  }
  const n = (await q('SELECT count(*)::int n FROM bills')).rows[0].n + 1;
  const { rows } = await q(
    `INSERT INTO bills(ref,title,kind,body,target_law_id,target_user_id,author_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [`B${String(n).padStart(3, '0')}`, title.trim().slice(0, 200), k, body,
     target_law_id || null, k === 'impeachment' ? target_user_id : null, req.user.id]);
  log(req.user.id, 'bill.propose', rows[0].ref);
  res.json(rows[0]);
}));

/* A citizen's draft. Inert until enough of the Republic signs it — then either
   the House must take it up, or it goes straight to the people, depending on
   what the House has set initiative_mode to. */
app.post('/api/initiatives', auth, slowWrites, wrap(async (req, res) => {
  await loadConfig();
  if (CONFIG.initiative_mode === 'off')
    return res.status(403).json({ error: 'Citizens\' initiatives are switched off. The House would have to set initiative_mode to table or enact.' });
  const { title, kind, body, target_law_id } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'An initiative needs a title and a text.' });
  const k = ['law', 'amendment', 'repeal', 'motion', 'constitutional', 'rule'].includes(kind) ? kind : 'law';
  if (k === 'rule') {
    const { errors } = parseRuleChanges(body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  }
  const n = (await q('SELECT count(*)::int n FROM bills')).rows[0].n + 1;
  const { rows } = await q(
    `INSERT INTO bills(ref,title,kind,body,target_law_id,author_id,status,origin)
     VALUES($1,$2,$3,$4,$5,$6,'petition','initiative') RETURNING *`,
    [`B${String(n).padStart(3, '0')}`, title.trim().slice(0, 200), k, body, target_law_id || null, req.user.id]);
  log(req.user.id, 'initiative.propose', rows[0].ref);
  res.json(rows[0]);
}));

app.post('/api/bills/:id/sign', auth, wrap(async (req, res) => {
  await loadConfig();
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such initiative.' });
  if (b.status !== 'petition') return res.status(400).json({ error: 'This is no longer collecting signatures.' });
  if (CONFIG.initiative_mode === 'off') return res.status(403).json({ error: 'Citizens\' initiatives are switched off.' });
  await q('INSERT INTO bill_petitions(bill_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [b.id, req.user.id]);
  const signed = (await q('SELECT count(*)::int n FROM bill_petitions WHERE bill_id=$1', [b.id])).rows[0].n;
  const needed = Math.max(1, Math.ceil(num('petition_share') * await citizenCount()));
  if (signed < needed) return res.json({ signed, needed, mode: CONFIG.initiative_mode });

  if (CONFIG.initiative_mode === 'enact') {
    const el = await openInitiativeReferendum(b, req.user.id);
    return res.json({ signed, needed, mode: 'enact', election_id: el?.id || null });
  }
  // 'table': the signatures stand in for seconders, and the Speaker must take it up.
  await q("UPDATE bills SET status='tabled' WHERE id=$1", [b.id]);
  log(req.user.id, 'initiative.tabled', `${b.ref} on ${signed} signatures`);
  res.json({ signed, needed, mode: 'table', tabled: true });
}));

app.get('/api/bills/:id/sign', wrap(async (req, res) => {
  await loadConfig();
  const signed = (await q('SELECT count(*)::int n FROM bill_petitions WHERE bill_id=$1', [req.params.id])).rows[0].n;
  const mine = req.user
    ? !!(await q('SELECT 1 FROM bill_petitions WHERE bill_id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0]
    : false;
  res.json({
    signed, mine, mode: CONFIG.initiative_mode,
    needed: Math.max(1, Math.ceil(num('petition_share') * await citizenCount()))
  });
}));

app.post('/api/bills/:id/second', auth, wrap(async (req, res) => {
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'draft') return res.status(400).json({ error: 'This bill has already moved past seconding.' });
  if (b.author_id === req.user.id) return res.status(400).json({ error: 'You cannot second your own bill.' });
  await loadConfig();
  if (!await canPropose(req.user.id)) return res.status(403).json({ error: NOT_YOURS });
  await q('INSERT INTO bill_seconds(bill_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [b.id, req.user.id]);
  res.json({ ok: true });
}));

app.post('/api/bills/:id/comments', auth, slowWrites, wrap(async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  const { rows } = await q('INSERT INTO comments(bill_id,user_id,body) VALUES($1,$2,$3) RETURNING *',
    [req.params.id, req.user.id, body.slice(0, 4000)]);
  res.json(rows[0]);
}));

app.post('/api/bills/:id/table', requireOffice('speaker'), wrap(async (req, res) => {
  await loadConfig();
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'draft') return res.status(400).json({ error: 'Only draft bills can be tabled.' });
  const s = (await q('SELECT count(*)::int n FROM bill_seconds WHERE bill_id=$1', [b.id])).rows[0].n;
  if (s < num('seconds_required'))
    return res.status(400).json({ error: `This bill needs ${num('seconds_required')} seconders and has ${s}.` });
  await q("UPDATE bills SET status='tabled' WHERE id=$1", [b.id]);
  log(req.user.id, 'bill.table', b.ref);
  res.json({ ok: true });
}));

app.post('/api/bills/:id/division', requireOffice('speaker'), wrap(async (req, res) => {
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'tabled') return res.status(400).json({ error: 'Table the bill before calling a division.' });
  await q("UPDATE bills SET status='division', divided_at=now() WHERE id=$1", [b.id]);
  log(req.user.id, 'bill.division', b.ref);
  res.json({ ok: true });
}));

app.post('/api/bills/:id/vote', auth, wrap(async (req, res) => {
  await loadConfig();
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'division') return res.status(400).json({ error: 'No division is open on this bill.' });
  const vote = req.body?.vote;
  if (!['aye', 'no', 'abstain'].includes(vote)) return res.status(400).json({ error: 'Vote aye, no or abstain.' });
  const eligible = await billVoters();
  if (!eligible.includes(req.user.id)) return res.status(403).json({ error: 'You do not have a vote in this division.' });
  try {
    await q('INSERT INTO bill_votes(bill_id,user_id,vote) VALUES($1,$2,$3)', [b.id, req.user.id, vote]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You have already voted in this division.' });
    throw err;
  }
  log(req.user.id, 'bill.vote', `${b.ref} ${vote}`);
  res.json({ ok: true });
}));

app.post('/api/bills/:id/close', requireOffice('speaker'), wrap(async (req, res) => {
  await loadConfig();
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'division') return res.status(400).json({ error: 'There is no open division to close.' });
  const v = (await q('SELECT vote FROM bill_votes WHERE bill_id=$1', [b.id])).rows;
  const aye = v.filter(x => x.vote === 'aye').length;
  const no = v.filter(x => x.vote === 'no').length;
  if (v.length < num('quorum'))
    return res.status(400).json({ error: `Quorum is ${num('quorum')} and only ${v.length} voted.` });
  const threshold = b.kind === 'constitutional' ? num('constitutional_threshold')
    : b.kind === 'impeachment' ? num('impeachment_threshold')
    : num('pass_threshold');
  const share = (aye + no) ? aye / (aye + no) : 0;
  const carried = share > threshold || (threshold === 0.5 && share === 0.5 && aye > no);
  const result = `${aye} aye / ${no} no / ${v.filter(x => x.vote === 'abstain').length} abstain`;

  // An impeachment takes effect the moment it carries. Sending it to the
  // President for assent would let an officer veto their own removal.
  if (carried && b.kind === 'impeachment') {
    const t = (await q('SELECT display_name FROM users WHERE id=$1', [b.target_user_id])).rows[0];
    const gone = (await q(
      'UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND active RETURNING office',
      [b.target_user_id])).rows.map(r => r.office);
    await q("UPDATE bills SET status='enacted', result=$1, resolved_at=now() WHERE id=$2", [result, b.id]);
    log(req.user.id, 'bill.impeach', `${b.ref}: ${t?.display_name} removed from ${gone.join(', ') || 'nothing'} (${result})`);
    return res.json({ carried, result, share, impeached: t?.display_name, removed_from: gone });
  }

  await q('UPDATE bills SET status=$1, result=$2, resolved_at=now() WHERE id=$3',
    [carried ? 'passed' : 'failed', result, b.id]);
  log(req.user.id, 'bill.close', `${b.ref} ${carried ? 'carried' : 'lost'} (${result})`);
  res.json({ carried, result, share });
}));

/* Presidential assent, veto, and override. Motions skip the statute book. */
app.post('/api/bills/:id/assent', requireOffice('president'), wrap(async (req, res) => {
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'passed') return res.status(400).json({ error: 'Only a bill that has passed can be assented to.' });
  if (req.body?.veto) {
    await q("UPDATE bills SET status='vetoed' WHERE id=$1", [b.id]);
    log(req.user.id, 'bill.veto', b.ref);
    return res.json({ status: 'vetoed' });
  }
  await enact(b, req.user.id);
  res.json({ status: 'enacted' });
}));

app.post('/api/bills/:id/override', requireOffice('speaker'), wrap(async (req, res) => {
  await loadConfig();
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b || b.status !== 'vetoed') return res.status(400).json({ error: 'That bill is not under veto.' });
  if (!bool('allow_veto_override'))
    return res.status(403).json({
      error: 'The President\'s assent is required for a bill to become law, and a veto is final. Pass a rule bill setting allow_veto_override = true if the House wants that power.'
    });
  const v = (await q('SELECT vote FROM bill_votes WHERE bill_id=$1', [b.id])).rows;
  const aye = v.filter(x => x.vote === 'aye').length;
  const no = v.filter(x => x.vote === 'no').length;
  if (!(aye + no) || aye / (aye + no) < num('veto_override'))
    return res.status(400).json({ error: `An override needs ${Math.round(num('veto_override') * 100)}% of the division.` });
  await enact(b, req.user.id, true);
  res.json({ status: 'enacted', overridden: true });
}));

async function enact(b, actorId, overridden = false) {
  if (b.kind === 'rule') {
    const { changes } = parseRuleChanges(b.body);
    for (const c of changes) {
      await q('INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [c.key, c.value]);
    }
    await loadConfig();
    log(actorId, 'rule.change', `${b.ref}: ${changes.map(c => `${c.key}=${c.value}`).join(', ')}`);
  } else if (b.kind === 'constitutional') {
    const v = (await q('SELECT max(version) m FROM constitution')).rows[0].m || 0;
    await q('INSERT INTO constitution(version, body, bill_id) VALUES($1,$2,$3)', [v + 1, b.body, b.id]);
  } else if (b.kind === 'repeal' && b.target_law_id) {
    await q('UPDATE laws SET repealed_at=now(), repealed_by=$1 WHERE id=$2', [b.id, b.target_law_id]);
  } else if (b.kind === 'amendment' && b.target_law_id) {
    await q('UPDATE laws SET body=$1, title=$2 WHERE id=$3', [b.body, b.title, b.target_law_id]);
  } else if (b.kind !== 'motion') {
    const n = (await q('SELECT count(*)::int n FROM laws')).rows[0].n + 1;
    await q('INSERT INTO laws(ref,title,body,bill_id) VALUES($1,$2,$3,$4)',
      [`L${String(n).padStart(3, '0')}`, b.title, b.body, b.id]);
  }
  await q("UPDATE bills SET status='enacted' WHERE id=$1", [b.id]);
  log(actorId, overridden ? 'bill.override' : 'bill.assent', b.ref);
}

/* ----------------------------------------------------- laws + constitution */

app.get('/api/laws', wrap(async (req, res) => {
  const includeRepealed = req.query.all === '1';
  const { rows } = await q(`
    SELECT l.*, b.ref AS bill_ref, u.display_name AS author_name
      FROM laws l LEFT JOIN bills b ON b.id=l.bill_id LEFT JOIN users u ON u.id=b.author_id
     WHERE ($1::bool OR l.repealed_at IS NULL) ORDER BY l.enacted_at DESC`, [includeRepealed]);
  res.json(rows);
}));

app.get('/api/flag', wrap(async (_req, res) => {
  await loadConfig();
  const flag = await currentFlag();
  flag ? res.json(flag) : res.status(404).json({ error: 'No flag law is in force.' });
}));

app.get('/api/constitution', wrap(async (_req, res) => {
  const { rows } = await q('SELECT * FROM constitution ORDER BY version DESC');
  res.json({ current: rows[0] || null, history: rows });
}));

app.get('/api/audit', wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT a.*, u.display_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id
     ORDER BY a.at DESC LIMIT 200`);
  res.json(rows);
}));

/* A paste-ready digest for the group chat. */
app.get('/api/digest', wrap(async (_req, res) => {
  await loadConfig();
  const off = (await q(`SELECT o.office,o.seat,u.display_name FROM offices o JOIN users u ON u.id=o.user_id
                        WHERE o.active ORDER BY o.office, o.seat`)).rows;
  const el = (await q("SELECT title,status,closes_at FROM elections WHERE status<>'closed'")).rows;
  const bl = (await q(`SELECT ref,title,status FROM bills
                       WHERE status IN ('petition','draft','tabled','division','referendum','passed')`)).rows;
  const laws = (await q('SELECT count(*)::int n FROM laws WHERE repealed_at IS NULL')).rows[0].n;
  const line = o => `${o.office === 'mp' ? `Seat ${o.seat}` : o.office[0].toUpperCase() + o.office.slice(1)}: ${o.display_name}`;
  const c = cycleNow();
  const text = [
    `*${CONFIG.nation_name}* — state of the union`,
    c ? `Cycle ${c.number} · ${c.phase} · next change ${new Date(c.next_at).toUTCString()}` : 'Cycle clock stopped.',
    '',
    ...off.map(line),
    '',
    el.length ? `Open elections:\n${el.map(e => `• ${e.title} (${e.status})`).join('\n')}` : 'No elections open.',
    '',
    bl.length ? `Live business:\n${bl.map(b => `• ${b.ref} ${b.title} — ${b.status}`).join('\n')}` : 'No bills before the house.',
    '',
    `${laws} laws in force.`
  ].join('\n');
  res.type('text/plain').send(text);
}));

/* ---------------------------------------------------------------- admin */

app.get('/api/admin/invites', admin, wrap(async (_req, res) => {
  const { rows } = await q(`SELECT i.*, u.display_name AS used_by_name FROM invites i
                            LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC`);
  res.json(rows);
}));

app.post('/api/admin/invites', admin, wrap(async (req, res) => {
  const n = Math.min(Math.max(Number(req.body?.count) || 1, 1), 50);
  const made = [];
  for (let i = 0; i < n; i++) {
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    await q('INSERT INTO invites(code,note) VALUES($1,$2)', [code, req.body?.note || '']);
    made.push(code);
  }
  res.json(made);
}));

app.put('/api/admin/config', admin, wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULTS)) continue;
    await q('INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, String(v)]);
  }
  log(req.user.id, 'config.update', Object.keys(req.body || {}).join(','));
  res.json(await loadConfig());
}));

app.post('/api/admin/office', admin, wrap(async (req, res) => {
  const { user_id, office, seat, remove } = req.body || {};
  if (!['president', 'speaker', 'mp'].includes(office)) return res.status(400).json({ error: 'Unknown office.' });
  if (remove) {
    await q('UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office=$2 AND active', [user_id, office]);
  } else {
    if (office !== 'mp') await q('UPDATE offices SET active=FALSE, until=now() WHERE office=$1 AND active', [office]);
    await q('INSERT INTO offices(office,user_id,seat) VALUES($1,$2,$3)', [office, user_id, seat || null]);
  }
  log(req.user.id, 'office.set', `${office} ${remove ? 'removed from' : 'given to'} #${user_id}`);
  res.json({ ok: true });
}));

app.post('/api/admin/dissolve', admin, wrap(async (req, res) => {
  await q("UPDATE offices SET active=FALSE, until=now() WHERE active AND office IN ('mp','speaker')");
  log(req.user.id, 'parliament.dissolve', '');
  res.json({ ok: true });
}));

app.get('/api/admin/pending', admin, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT u.id,u.username,u.display_name,u.created_at,i.code AS invite_code,i.note AS invite_note
      FROM users u LEFT JOIN invites i ON i.used_by=u.id
     WHERE NOT u.approved AND u.is_active ORDER BY u.created_at`);
  res.json(rows);
}));

app.post('/api/admin/approve', admin, wrap(async (req, res) => {
  const { user_id, approve } = req.body || {};
  const target = (await q('SELECT username FROM users WHERE id=$1', [user_id])).rows[0];
  if (!target) return res.status(404).json({ error: 'No such account.' });
  if (approve === false) {
    await q('UPDATE users SET is_active=FALSE WHERE id=$1', [user_id]);
    log(req.user.id, 'account.reject', target.username);
  } else {
    await q('UPDATE users SET approved=TRUE WHERE id=$1', [user_id]);
    log(req.user.id, 'account.approve', target.username);
  }
  res.json({ ok: true });
}));

/* Every admin action on someone else's account is written to the public record.
   Admins are trusted by necessity; this is what keeps them accountable. */
app.post('/api/admin/user', admin, wrap(async (req, res) => {
  const { user_id, is_admin, is_active, reset_password } = req.body || {};
  const target = (await q('SELECT username FROM users WHERE id=$1', [user_id])).rows[0];
  if (!target) return res.status(404).json({ error: 'No such account.' });
  if (typeof is_admin === 'boolean') {
    await q('UPDATE users SET is_admin=$1 WHERE id=$2', [is_admin, user_id]);
    log(req.user.id, is_admin ? 'admin.grant' : 'admin.revoke', target.username);
  }
  if (typeof is_active === 'boolean') {
    await q('UPDATE users SET is_active=$1 WHERE id=$2', [is_active, user_id]);
    log(req.user.id, is_active ? 'account.restore' : 'account.suspend', target.username);
  }
  if (reset_password) {
    if (Number(user_id) === req.user.id) return res.status(400).json({ error: 'Change your own password from your account page.' });
    const temp = crypto.randomBytes(6).toString('hex');
    await q('UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2',
      [await bcrypt.hash(temp, 10), user_id]);
    log(req.user.id, 'password.reset', `${target.username} — reset by an admin`);
    return res.json({ temp_password: temp });
  }
  res.json({ ok: true });
}));

app.put('/api/admin/constitution', admin, wrap(async (req, res) => {
  const body = req.body?.body;
  if (!body) return res.status(400).json({ error: 'The constitution cannot be empty.' });
  const v = (await q('SELECT max(version) m FROM constitution')).rows[0].m || 0;
  await q('INSERT INTO constitution(version, body) VALUES($1,$2)', [v + 1, body]);
  log(req.user.id, 'constitution.edit', `v${v + 1}`);
  res.json({ version: v + 1 });
}));

app.use((_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

bootstrap()
  .then(async () => {
    await tick();
    setInterval(tick, 60000);
    app.listen(PORT, () => console.log(`[republic] listening on ${PORT}`));
  })
  .catch(err => { console.error('[republic] failed to start:', err); process.exit(1); });
