/* Republic — single-file API server.
   Deploy on Render. Needs DATABASE_URL and JWT_SECRET. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
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

/* Everything that moves money is more than one statement, and `q` takes a fresh
   connection out of the pool for each one. Without this, a crash or a dropped
   connection between the debit and the credit leaves sum(accounts.balance)
   permanently off zero — the one invariant the whole economy rests on — and no
   suite can catch it, because a suite that completes is exactly the case that
   cannot fail.

   `fn` is handed a runner with the same shape as `q`, bound to one connection
   inside a transaction. Pass it down to anything that writes, or the write
   escapes the transaction and is not rolled back.

   The tests run against an in-process Postgres with exactly one connection and
   no `connect()`, so there BEGIN/COMMIT go to the pool itself and overlapping
   transactions are queued rather than interleaved — which is what a single
   connection would do anyway. */
let txQueue = Promise.resolve();
async function tx(fn) {
  if (typeof pool.connect === 'function') {
    const client = await pool.connect();
    const run = (sql, params = []) => client.query(sql, params);
    try {
      await run('BEGIN');
      const out = await fn(run);
      await run('COMMIT');
      return out;
    } catch (err) {
      try { await run('ROLLBACK'); } catch { /* the connection is already gone */ }
      throw err;
    } finally {
      client.release();
    }
  }
  const mine = txQueue.catch(() => {}).then(async () => {
    try {
      await q('BEGIN');
      const out = await fn(q);
      await q('COMMIT');
      return out;
    } catch (err) {
      try { await q('ROLLBACK'); } catch { /* nothing to roll back */ }
      throw err;
    }
  });
  txQueue = mine.catch(() => {});
  return mine;
}

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

  // The Judicial Enforcement Act
  supermajority_share: '0.667',    // Article 2.2 — two thirds of ALL citizens
  supermajority_days: '7',         // how long a motion may gather signatures

  emergency_max_days: '3',         // longest a declaration may run before it lapses
  emergency_end_share: '0.5',      // share of the House needed to end one at once

  justice_terms: '2',              // cycles a Justice sits — two 7-day cycles is the fortnight
  justice_auto: 'true',            // call the ballot when the People's seat falls empty
  justice_nomination_hours: '24',
  justice_poll_hours: '48',              // cycles a Justice serves

  // The Creation of an Economy Act
  currency_name: 'Mark',
  currency_symbol: 'M',
  dividend: '100',                 // paid to every citizen every cycle, unconditionally
  salary_president: '150',
  salary_speaker: '120',
  salary_mp: '80',
  salary_justice: '100',
  tax_free_allowance: '200',       // nothing is taken below this
  tax_rate: '0.1',                 // on the balance above the allowance
  tax_upper_threshold: '1000',
  tax_rate_upper: '0.25',          // progressive: a higher rate above the threshold
  registration_fee: '25',
  deposit_rate: '0.02',            // paid on deposits each cycle
  loan_rate: '0.05',               // charged on loans each cycle
  loan_ceiling: '500',             // most one citizen may owe the public bank
  ownership_cap: '0.4',            // most of one business a single citizen may hold
  goods_economy_enabled: 'false',   // categorise business goods for strategic/foreign trade

  // The Treasury and the Fed
  salary_treasurer: '110',
  salary_foreign_minister: '110',
  salary_quartermaster: '110',

  // War: supply, upkeep and readiness. No movement, no dice.
  military_budget_per_cycle: '600',  // most the Quartermaster may spend in one cycle
  upkeep_food: '2',                  // per unit of formation size, per cycle
  upkeep_energy: '1',
  upkeep_arms: '1',
  upkeep_pay: '10',                  // wages per unit of size, paid to citizens
  raise_cost_arms: '5',              // arms drawn from the stockpile to raise one unit
  readiness_fall: '15',              // per cycle when supply is short
  readiness_rise: '5',               // per cycle when it is not — recovery is slower on purpose
  strength_per_size: '4',            // what one fully-ready unit of size is worth against a power
  conflict_step: '10',               // most a conflict can move in one cycle, either way
  salary_fed_chair: '110',
  salary_intel_director: '120',
  fed_terms: '3',                  // Article 21.9: cycles the head of the Fed serves
  intel_director_terms: '4',       // Section 2.4: cycles the Director of Intelligence serves
  reserve_ratio: '0.2',            // what a licensed bank must hold against its deposits
  bank_charter_fee: '250',         // least capital a citizen may open a bank with
  deposit_guarantee: '300',        // what the Treasury makes good per depositor if a bank fails

  // Diplomacy
  foreign_treasury_start: '5000',     // legacy: existing worlds may still hold Republic-mark reserves
  foreign_treasury_per_cycle: '1000', // legacy: no longer tops foreign powers up from our Treasury
  foreign_currency_start: '10000',    // opening local-currency supply, held by the foreign treasury
  foreign_export_cap_per_cycle: '2000', // most one power may buy from us in a cycle; 0 = no cap
  diplomacy_enabled: 'false',
  foreign_actions_per_cycle: '6',
  treaty_threshold: '0.667',
  recognition_threshold: '0.5',
  foreign_trade_tax: '0.1',

  // Offshore money, forex and defection
  offshore_enabled: 'false',
  offshore_fee: '0.05',             // the haven's cut of a deposit, rounded up in its favour
  offshore_minimum: '50',           // least a haven will take in a single deposit
  forex_spread: '0.03',             // the power's cut of a conversion, either direction
  forex_step: '0.05',               // most a rate may move in one cycle, as a fraction of itself
  forex_weight_trade: '0.4',        // how much the balance of trade moves the rate
  forex_weight_pressure: '0.4',     // how much conflict pressure moves the rate
  forex_weight_issuance: '0.2',     // how much fresh issuance moves the rate
  forex_trade_scale: '2000',        // trade balance that produces a full-strength signal
  forex_issuance_scale: '5000',     // issuance since the last fixing that produces a full-strength signal
  defection_return_share: '0.3',    // the Treasury's cut of frozen holdings on readmission

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
  runoff_hours: '24',              // how long a tied seat's run-off stays open
  flag_law_ref: 'L001',            // the law the app reads the flag and its colours from
  enforce_term_limit: 'false'      // Article 7: no two consecutive cycles in office
};

let CONFIG = { ...DEFAULTS };
const ENACT_HOOKS = [];
const addEnactHook = fn => { if (typeof fn === 'function') ENACT_HOOKS.push(fn); };

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
   with the returning officer.

   Also absent: deposit_rate, loan_rate, loan_ceiling and reserve_ratio. Article
   21.10 says in terms that neither the House, nor the President, nor the Prime
   Minister, nor the Speaker may set the rate of interest, and Part 7.24 of the
   Economy Act says no officer may instruct the Fed. A rule bill setting the
   rate of interest would be exactly that instruction with a vote attached. They
   belong to the head of the Fed, who publishes reasons for every change, and to
   the Citizens, who may abolish the Fed outright at a supermajority (21.13). */
const LEGISLATABLE = new Set([
  'nation_name', 'motto', 'seats', 'term_days', 'seconds_required', 'quorum',
  'pass_threshold', 'constitutional_threshold', 'veto_override', 'bill_voters',
  'bill_proposers', 'allow_veto_override', 'impeachment_threshold', 'referendum_threshold',
  'referendum_quorum', 'referendum_days', 'petition_share',
  'initiative_mode', 'initiative_threshold', 'justice_terms',
  'emergency_max_days', 'emergency_end_share',
  'supermajority_share', 'supermajority_days',
  'currency_name', 'currency_symbol', 'dividend', 'salary_president', 'salary_speaker',
  'salary_mp', 'salary_justice', 'registration_fee',
  'ownership_cap', 'goods_economy_enabled',
  'salary_treasurer', 'salary_foreign_minister', 'salary_quartermaster', 'salary_fed_chair', 'salary_intel_director',
  'upkeep_food', 'upkeep_energy', 'upkeep_arms', 'upkeep_pay',
  'raise_cost_arms', 'readiness_fall', 'readiness_rise', 'strength_per_size', 'conflict_step', 'fed_terms', 'intel_director_terms', 'bank_charter_fee', 'deposit_guarantee',
  'diplomacy_enabled', 'foreign_actions_per_cycle', 'treaty_threshold', 'recognition_threshold',
  'secret_ballot', 'cycle_enabled', 'cycle_days', 'campaign_days', 'poll_days',
  'cycle_elects', 'speaker_auto', 'speaker_threshold', 'speaker_nomination_hours',
  'speaker_poll_hours', 'speaker_relax', 'runoff_hours', 'enforce_term_limit', 'flag_law_ref',
  'foreign_treasury_per_cycle', 'foreign_export_cap_per_cycle',
  'offshore_enabled', 'offshore_fee', 'offshore_minimum', 'forex_spread', 'forex_step',
  'forex_weight_trade', 'forex_weight_pressure', 'forex_weight_issuance',
  'forex_trade_scale', 'forex_issuance_scale', 'defection_return_share'
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

/* Article 12.2: a declaration suspends only what it names. So the names are a
   fixed list, and anything not on it cannot be suspended however the declaration
   is worded.

   Three things are deliberately absent and can never be claimed: the House's
   power to end the emergency, impeachment, and the holding of a poll that has
   already opened. An emergency that could switch off its own off-switch is not
   an emergency power, it is a coup. */
const EMERGENCY_POWERS = {
  halt_elections: 'Halt elections — no new poll opens and the cycle clock does not advance',
  extend_term: 'Extend the current term — sitting members stay in office past the cycle',
  fast_track: 'Fast-track bills — no seconders required to table',
  president_may_table: 'The President may table bills and call divisions',
  lower_quorum: 'Lower the quorum for a division to one member',
  close_borders: 'Close the borders — no foreign trade or new treaties'
};

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

/* The declaration in force, if any. Lapses on its own the moment it is read
   after expiry — nobody has to remember to end it. */
let EMERGENCY = null;
async function currentEmergency() {
  const e = (await q("SELECT * FROM emergencies WHERE status='in_force' ORDER BY id DESC LIMIT 1")).rows[0];
  if (!e) { EMERGENCY = null; return null; }
  if (e.expires_at && new Date(e.expires_at) <= new Date()) {
    await q("UPDATE emergencies SET status='lapsed', ended_at=now(), ended_by='lapsed' WHERE id=$1", [e.id]);
    log(null, 'emergency.lapse', `#${e.id} ran out`);
    EMERGENCY = null;
    return null;
  }
  EMERGENCY = e;
  return e;
}

const emergencyPowers = async () => {
  const e = await currentEmergency();
  return new Set(String(e?.powers || '').split(',').map(x => x.trim()).filter(Boolean));
};
const underPower = async (name) => (await emergencyPowers()).has(name);

/* ------------------------------------------------------------ bootstrap */

async function bootstrap() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const extra = path.join(__dirname, 'schema-acts.sql');
  if (fs.existsSync(extra)) await pool.query(fs.readFileSync(extra, 'utf8'));
  const diplomacySchema = path.join(__dirname, 'schema-diplomacy.sql');
  if (fs.existsSync(diplomacySchema)) await pool.query(fs.readFileSync(diplomacySchema, 'utf8'));
  const budgetSchema = path.join(__dirname, 'schema-budget.sql');
  if (fs.existsSync(budgetSchema)) await pool.query(fs.readFileSync(budgetSchema, 'utf8'));
  // Intelligence collection and operations. After diplomacy: it extends
  // intel_service/intel_reports and hangs new tables off powers/foreign_agents.
  const intelSchema = path.join(__dirname, 'schema-intel.sql');
  if (fs.existsSync(intelSchema)) await pool.query(fs.readFileSync(intelSchema, 'utf8'));
  // The Treasury and the Fed. Loaded after schema-acts.sql, which owns `cases`
  // and `accounts` — the private banks hang off both.
  const moneySchema = path.join(__dirname, 'schema-money.sql');
  if (fs.existsSync(moneySchema)) await pool.query(fs.readFileSync(moneySchema, 'utf8'));
  // Supply, procurement and upkeep. After diplomacy: foreign offers are bought from.
  const warSchema = path.join(__dirname, 'schema-war.sql');
  if (fs.existsSync(warSchema)) await pool.query(fs.readFileSync(warSchema, 'utf8'));
  // The generated world. After diplomacy, whose `powers` table world_powers hangs off.
  const worldgenSchema = path.join(__dirname, 'schema-worldgen.sql');
  if (fs.existsSync(worldgenSchema)) await pool.query(fs.readFileSync(worldgenSchema, 'utf8'));
  // Offshore money, forex and defection. Last: it hangs off a foreign power and
  // its defection triggers attach to every ballot box every schema above defines.
  const offshoreSchema = path.join(__dirname, 'schema-offshore.sql');
  if (fs.existsSync(offshoreSchema)) await pool.query(fs.readFileSync(offshoreSchema, 'utf8'));
  // Delegated credentials for third-party apps. Independent of every schema
  // above — it only references users(id) — so it can load anywhere, but goes
  // last because it is the newest and least tangled with anything else here.
  const apikeysSchema = path.join(__dirname, 'schema-apikeys.sql');
  if (fs.existsSync(apikeysSchema)) await pool.query(fs.readFileSync(apikeysSchema, 'utf8'));
  // The Press Act. Independent of every schema above — it only references
  // users(id), deliberately not schema-acts.sql's businesses — so it can
  // load anywhere.
  const pressSchema = path.join(__dirname, 'schema-press.sql');
  if (fs.existsSync(pressSchema)) await pool.query(fs.readFileSync(pressSchema, 'utf8'));
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

/* An API key is distinguished from a JWT by prefix alone (`rk_`), never by
   length or shape guessing, so the two token kinds are never ambiguous here.
   The secret half is never stored — only an HMAC of it, keyed on the same
   JWT_SECRET the server already refuses to boot without. That is checked on
   every request, so it has to be fast; bcrypt would not be, and does not need
   to be here the way it does for a password, because the key itself is 192
   bits of randomness nobody is guessing offline. */
async function attach(req, _res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (t && t.startsWith('rk_')) {
    try {
      const hash = crypto.createHmac('sha256', JWT_SECRET).update(t).digest('hex');
      const { rows } = await q(
        `SELECT k.id AS key_id, k.label, k.scopes, k.cap_amount, k.cap_window_ms, k.revoked_at,
                u.id, u.username, u.display_name, u.bio, u.is_admin, u.is_active, u.approved, u.token_version
           FROM api_keys k JOIN users u ON u.id = k.user_id
          WHERE k.key_hash = $1`, [hash]);
      const row = rows[0];
      if (row && !row.revoked_at && row.is_active && row.approved) {
        req.user = {
          id: row.id, username: row.username, display_name: row.display_name, bio: row.bio,
          is_admin: row.is_admin, is_active: row.is_active, approved: row.approved, token_version: row.token_version
        };
        req.apiKey = {
          id: row.key_id, label: row.label, scopes: String(row.scopes || '').split(',').filter(Boolean),
          cap_amount: row.cap_amount, cap_window_ms: row.cap_window_ms
        };
        // Best-effort: a citizen glancing at "last used" should never be able
        // to stall a request that would otherwise be fine.
        q('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [row.key_id]).catch(() => {});
      }
    } catch { /* invalid key — treated as anonymous */ }
  } else if (t) {
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

const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to do that.' });
  /* A key carries the implicit read scope and nothing more unless a route
     opts it in explicitly with requireScope. That has to hold for every
     write route in the app, not just the ones built with keys in mind — so
     the block lives here, in the gate almost every write route already
     calls, rather than as something each route has to remember to add. A
     route that wants to accept a scoped key for a write uses requireScope()
     in place of this. */
  if (req.apiKey && !['GET', 'HEAD'].includes(req.method))
    return res.status(403).json({ error: 'This API key cannot make changes. It needs a route with an explicit scope.' });
  next();
};
const admin = (req, res, next) => {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admins only.' });
  // The Returning Officer's own powers are never delegable to an app acting
  // on someone's behalf — there is no scope for them, on purpose.
  if (req.apiKey) return res.status(403).json({ error: 'API keys cannot act as the Returning Officer.' });
  next();
};

/* For the handful of routes that should accept a suitably-scoped key instead
   of blocking every key outright — today that is only economy:pay. A full
   JWT session carries every scope implicitly: a signed-in citizen isn't
   limited by a key's restrictions, only a delegated app is. */
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to do that.' });
    if (req.apiKey && !req.apiKey.scopes.includes(scope))
      return res.status(403).json({ error: `This API key is missing the "${scope}" scope.` });
    next();
  };
}

/* Office compatibility after repeal of the old one-seat rule.

   The President, Prime Minister and Justices remain constitutionally exclusive:
   holding any one of them means holding nothing else. House membership is
   cross-cutting, so an MP (and therefore the Speaker) may also carry a compatible
   executive portfolio. Executive portfolios may only be combined inside their
   own policy family: Treasury/Fed for economic management, and Foreign
   Affairs/Defence/Intelligence for external and national-security affairs. */
const EXCLUSIVE_OFFICES = new Set(['president', 'prime_minister', 'justice']);
const HOUSE_OFFICES = new Set(['mp', 'speaker']);
const OFFICE_AREA = new Map([
  ['treasurer', 'economic'],
  ['fed_chair', 'economic'],
  ['quartermaster', 'statecraft'],
  ['foreign_minister', 'statecraft'],
  ['intel_director', 'statecraft']
]);
const officesCompatible = (a, b) => {
  if (!a || !b || a === b) return true;
  if (EXCLUSIVE_OFFICES.has(a) || EXCLUSIVE_OFFICES.has(b)) return false;
  if (HOUSE_OFFICES.has(a) || HOUSE_OFFICES.has(b)) return true;
  const aa = OFFICE_AREA.get(a);
  const bb = OFFICE_AREA.get(b);
  return !!aa && aa === bb;
};
const seatClash = (held, office) => held.filter(o => o !== office && !officesCompatible(o, office));

async function officesOf(userId) {
  const { rows } = await q('SELECT office FROM offices WHERE user_id=$1 AND active', [userId]);
  return rows.map(r => r.office);
}
const holds = async (userId, office) => (await officesOf(userId)).includes(office);

function requireOffice(office) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to do that.' });
    // No office comes with a key scope. Holding an office through a delegated
    // app would mean the app, not the citizen, casts the Speaker's vote.
    if (req.apiKey) return res.status(403).json({ error: 'API keys cannot act in an office.' });
    /* The Returning Officer runs the elections. They are not the President, the
       Speaker, or the House, and they do not act in those offices — an admin who
       can assent to their own bills makes every result look arranged.

       If an officer goes absent, the answer is to appoint or remove one through
       /api/admin/office, not to stand in for them. */
    if (await holds(req.user.id, office)) return next();
    // Article 12: a declaration may hand the Speaker's business to the President
    // for its duration. It never hands over anything else.
    if (office === 'speaker' && await holds(req.user.id, 'president') && await underPower('president_may_table'))
      return next();
    res.status(403).json({ error: `Only the ${office} can do that.` });
  };
}

/* A key acting for a citizen is exactly the case the public record has to
   show plainly — "every admin action writes to the public record" only means
   something if a delegated app can't quietly blend into an ordinary action by
   the citizen it's acting for. Routes that accept a scoped key fold this into
   the detail string log() already takes, rather than widening log()'s
   signature for one caller shape. */
const attribute = (detail, req) => req?.apiKey ? `${detail} (via app:${req.apiKey.label})` : detail;

/* The public event feed taps this, not the audit table directly, so a
   listener never sees a row before it's actually committed and never has to
   poll. One process, one emitter — a restart just drops SSE connections,
   which publicapi.js documents as expected client-reconnect behaviour. */
const events = new (require('events').EventEmitter)();
events.setMaxListeners(0);

const log = (actor, action, detail = '') => {
  events.emit('audit', { actor_id: actor, action, detail, at: new Date().toISOString() });
  return q('INSERT INTO audit(actor_id,action,detail) VALUES($1,$2,$3)', [actor, action, detail]).catch(() => {});
};

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  /* RP001 is the Republic's own SQLSTATE: a rule the database itself holds —
     one person one vote, a defector's frozen domestic account — raised with
     the sentence a citizen should actually read. It is not a bug, so it does
     not get a stack trace and a 500; it gets exactly the same shape as any
     other refusal. See schema-offshore.sql for the triggers that raise it. */
  if (err.code === 'RP001') return res.status(400).json({ error: err.message });
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

/* ------------------------------------------------------------- API keys */

// The only scope beyond the implicit read every key gets. Keep this list
// short on purpose — a third-party app should never be able to acquire a
// capability nobody thought to name here.
const KEY_SCOPES = new Set(['economy:pay']);
const KEY_MIN_WINDOW_MS = 60 * 60 * 1000;        // an hour
const KEY_MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const keyOut = k => ({
  id: k.id, label: k.label, scopes: String(k.scopes || '').split(',').filter(Boolean),
  cap_amount: k.cap_amount, cap_window_ms: k.cap_window_ms,
  created_at: k.created_at, last_used_at: k.last_used_at, revoked_at: k.revoked_at
});

// A route built for a citizen's own JWT session, not for a key to use on
// itself — auth() already refuses any apiKey a non-GET request here, which is
// exactly right: an app cannot mint or revoke its own credentials.
app.post('/api/me/keys', auth, wrap(async (req, res) => {
  const { label, scopes, cap_amount, cap_window_ms } = req.body || {};
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Give the key a label so you know what it is for later.' });
  const wantScopes = Array.isArray(scopes) ? scopes.filter(s => KEY_SCOPES.has(s)) : [];
  if (Array.isArray(scopes) && wantScopes.length !== scopes.length)
    return res.status(400).json({ error: `Unknown scope. Valid scopes: ${[...KEY_SCOPES].join(', ')}.` });
  let cap = null, window = null;
  if (cap_amount != null) {
    cap = Math.round(Number(cap_amount));
    if (!(cap > 0)) return res.status(400).json({ error: 'A spending cap must be a positive amount.' });
    window = Math.round(Number(cap_window_ms) || 24 * 60 * 60 * 1000);
    window = Math.min(KEY_MAX_WINDOW_MS, Math.max(KEY_MIN_WINDOW_MS, window));
  }
  const raw = 'rk_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHmac('sha256', JWT_SECRET).update(raw).digest('hex');
  const { rows } = await q(
    `INSERT INTO api_keys(user_id,label,key_hash,scopes,cap_amount,cap_window_ms)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, String(label).trim().slice(0, 80), hash, wantScopes.join(','), cap, window]);
  log(req.user.id, 'apikey.create', `"${rows[0].label}"${wantScopes.length ? ' scopes: ' + wantScopes.join(',') : ''}`);
  // The only moment the raw key is ever readable again by anyone, including us.
  res.json({ key: raw, ...keyOut(rows[0]) });
}));

app.get('/api/me/keys', auth, wrap(async (req, res) => {
  const { rows } = await q('SELECT * FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(rows.map(keyOut));
}));

app.post('/api/me/keys/:id/revoke', auth, wrap(async (req, res) => {
  const { rows } = await q(
    'UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING label',
    [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'No such key.' });
  log(req.user.id, 'apikey.revoke', `"${rows[0].label}"`);
  res.json({ ok: true });
}));

// Abuse response, same precedent as an admin resetting a password: the
// citizen who created the key normally revokes it, but a compromised or
// misbehaving app is exactly the case the Returning Officer has to be able to
// cut off even if the citizen is unreachable.
app.post('/api/admin/keys/:id/revoke', admin, wrap(async (req, res) => {
  const { rows } = await q(
    'UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING label,user_id',
    [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'No such key.' });
  log(req.user.id, 'apikey.revoke', `"${rows[0].label}" — revoked by the Returning Officer for user #${rows[0].user_id}`);
  res.json({ ok: true });
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
const TITLES = { parliament: 'General election', president: 'Presidential election', speaker: 'Election of the Speaker', justice: "Election of the People's Justice", referendum: 'Referendum' };

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
  /* Article 12: a declaration may extend the current term. Certifying is what
     vacates the sitting House, so under that power the result is recorded and
     the seats are simply not changed hands until the emergency ends. */
  if (await underPower('extend_term') && (e.kind === 'parliament' || e.kind === 'president')) {
    await q("UPDATE elections SET status='closed' WHERE id=$1", [e.id]);
    log(actorId, 'emergency.term.extend', `${e.title} counted but not seated`);
    return { seated: [], held: true, reason: 'the term is extended under a declaration of extraordinary circumstances' };
  }
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

  /* The People's Justice.

     Article 17.1 gives the Citizens one seat on the Court, and until now nobody
     voted for it — the Returning Officer simply recorded a name. This is that
     vote. Three things make it unlike every other election:

     1. It seats into court_seats as well as offices, and only seat 3. The
        generic path below vacates every holder of the office being elected,
        which for 'justice' would sweep the House's and the President's
        appointees out of a ballot they had no part in.
     2. A tie leaves the seat vacant and the ballot is simply run again. The
        generic path breaks ties by display-name order, and display names are
        user-editable, so on a seat held for a fixed term that is worth gaming.
     3. It is refused outright while the seat is occupied. A Justice holds for a
        term (17.3); an election that could unseat one mid-term would make the
        term decorative and put the Court at the mercy of whoever calls polls. */
  if (e.kind === 'justice') {
    const seat = (await q('SELECT * FROM court_seats WHERE seat=3')).rows[0];
    if (seat?.user_id) {
      log(actorId, 'election.justice.void', `${e.title}: the seat was already filled`);
      return { seated: [], void: true, reason: 'the seat was filled before the poll closed' };
    }
    if (!winners[0]) {
      log(actorId, 'election.justice.empty', `${e.title}: nobody stood, or nobody voted`);
      return { seated: [], failed: true, reason: 'nobody was elected' };
    }
    if (tie) {
      log(actorId, 'election.justice.tied', `${e.title}: tied on ${cutoff} votes, seat left vacant`);
      return { seated: [], tie: true, reason: 'the vote was tied, so the seat stays empty and the ballot is run again' };
    }
    // Article 17.11: a Justice holds no other office.
    const clash = await officesOf(winners[0].user_id);
    if (clash.length) {
      log(actorId, 'election.justice.unseated', `${winners[0].display_name} won but holds ${clash.join(', ')} — Article 17.11`);
      return { seated: [], failed: true, reason: `${winners[0].display_name} holds office as ${clash.join(', ')} and would have to resign it first` };
    }
    const ends = justiceTermEnds();
    await q('UPDATE court_seats SET user_id=$1, appointed_at=now(), term_ends=$2 WHERE seat=3', [winners[0].user_id, ends]);
    await q("INSERT INTO offices(office,user_id,seat,election_id) VALUES('justice',$1,3,$2)", [winners[0].user_id, e.id]);
    log(actorId, 'election.justice.carried', `${winners[0].display_name} elected to the People's seat with ${winners[0].votes} votes, until ${ends.toISOString().slice(0, 10)}`);
    return { seated: [{ office: 'justice', name: winners[0].display_name, votes: winners[0].votes }], term_ends: ends };
  }

  /* A tie for the last seat used to be settled by `ORDER BY … u.display_name`,
     and a display name is a field the candidate can edit from their own account
     page at any moment, including while the poll is open. So the tiebreak went
     to whoever renamed themselves earliest in the alphabet.

     `tie` above is already the exact condition worth acting on: more candidates
     level on the cutoff score than there are seats left at that score. A tie
     that changes nothing — everyone level is being seated anyway — is not a tie
     for this purpose and falls straight through.

     So: seat everyone who is clearly above the cutoff, and put the contested
     seats to a run-off between exactly the candidates who are level on it. The
     run-off inherits this poll's `opened_at`, which is what freezes the
     electoral roll — otherwise the gap between the tie and the run-off is an
     open window for registering sockpuppets to decide it.

     A run-off that ties again leaves the seats empty rather than running a
     third, which is what the People's Justice ballot already does and stops an
     evenly-split electorate from looping forever. */
  if (tie && !e.runoff_of) {
    const contested = results.filter(r => r.votes === cutoff);
    const clear = winners.filter(w => w.votes > cutoff);
    const seatsLeft = e.seats - clear.length;
    const closes = new Date(Date.now() + num('runoff_hours') * 3600000);
    const r = (await q(
      `INSERT INTO elections(kind,title,seats,status,opens_at,closes_at,opened_at,runoff_of,cycle_no)
       VALUES($1,$2,$3,'voting',now(),$4,$5,$6,$7) RETURNING id`,
      [e.kind, `${e.title} — run-off`, seatsLeft, closes, e.opened_at, e.id, e.cycle_no])).rows[0];
    for (const c of contested)
      await q('INSERT INTO candidacies(election_id,user_id,statement) VALUES($1,$2,$3)',
        [r.id, c.user_id, c.statement || '']);
    log(actorId, 'election.runoff',
      `${e.title}: ${contested.map(c => c.display_name).join(', ')} tied on ${cutoff} for ${seatsLeft} seat(s)`);
  }

  if (!e.runoff_of) {
    await q('UPDATE offices SET active=FALSE, until=now() WHERE office=$1 AND active', [office]);
    if (office === 'mp') await q("UPDATE offices SET active=FALSE, until=now() WHERE office='speaker' AND active");
  }
  const seated = [];
  /* A run-off fills the seats its parent left contested, so it must not vacate
     and must not restart the numbering on top of members already sitting. */
  let seat = e.runoff_of
    ? Number((await q("SELECT COALESCE(max(seat),0)::int m FROM offices WHERE office='mp' AND active")).rows[0].m) + 1
    : 1;
  /* Everyone level on the cutoff is going to a run-off, so they are not seated
     here. On a run-off that tied again, that leaves the seats empty. */
  const toSeat = tie ? winners.filter(w => w.votes > cutoff) : winners;
  for (const w of toSeat) {
    // A winner may keep House membership alongside a compatible portfolio, but
    // exclusive offices and cross-area portfolio combinations remain barred.
    const clash = seatClash(await officesOf(w.user_id), office);
    if (clash.length) {
      log(actorId, 'election.unseated', `${w.display_name} won but the office conflicts with ${clash.join(', ')}`);
      continue;
    }
    await q('INSERT INTO offices(office,user_id,seat,election_id) VALUES($1,$2,$3,$4)',
      [office, w.user_id, office === 'mp' ? seat++ : null, e.id]);
    seated.push({ office, name: w.display_name, votes: w.votes });
  }
  log(actorId, 'election.certify', `${e.title}: ${seated.map(x => x.name).join(', ') || 'nobody'}`);
  if (tie)
    return {
      seated,
      tie,
      runoff: !e.runoff_of,
      reason: e.runoff_of
        ? 'the run-off tied as well, so the seat stays empty and the Returning Officer calls a fresh ballot'
        : 'the last seat is tied, so it goes to a run-off between the candidates who are level'
    };
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

/* How long a Justice sits, in one place, because certify() and judiciary.js both
   need the answer and a fortnight in one and three weeks in the other would be
   invisible until somebody's term ended early. Two cycles of seven days is the
   fortnight the Act asks for; both halves are settings. */
function justiceTermEnds() {
  const terms = Math.max(1, num('justice_terms') || 2);
  return new Date(Date.now() + terms * num('cycle_days') * DAY);
}

/* A term that never ends is not a term. Nothing used to expire a Justice's seat,
   so `term_ends` was decoration. This retires them on the tick — for all three
   seats, since the House's and the President's appointees hold for a term too. */
async function retireExpiredJustices() {
  const { rows } = await q(`
    SELECT s.seat, s.user_id, u.display_name FROM court_seats s
      JOIN users u ON u.id = s.user_id
     WHERE s.user_id IS NOT NULL AND s.term_ends IS NOT NULL AND s.term_ends <= now()`);
  for (const j of rows) {
    await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='justice' AND active", [j.user_id]);
    await q('UPDATE court_seats SET user_id=NULL, appointed_at=NULL, term_ends=NULL WHERE seat=$1', [j.seat]);
    log(null, 'court.term.ended', `${j.display_name} leaves seat ${j.seat}, term served`);
  }
}

/* The Citizens' seat is filled by a vote, so when it falls empty the vote is
   called rather than waiting for someone to remember. Same shape as the
   Speaker's ballot, and the same guard against opening a second one. */
async function ensureJusticeElection() {
  const seat = (await q('SELECT user_id FROM court_seats WHERE seat=3')).rows[0];
  if (!seat || seat.user_id) return;
  if ((await q("SELECT 1 FROM elections WHERE kind='justice' AND status<>'closed'")).rows[0]) return;
  const opens = new Date(Date.now() + num('justice_nomination_hours') * HOUR);
  const closes = new Date(opens.getTime() + num('justice_poll_hours') * HOUR);
  await q(`INSERT INTO elections(kind,title,seats,status,opens_at,closes_at,auto)
           VALUES('justice',$1,1,'nominations',$2,$3,TRUE)`, [TITLES.justice, opens, closes]);
  log(null, 'cycle.justice', "ballot opened for the People's seat");
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

    /* Article 12: a declaration may halt elections. It stops new polls opening
       and the clock advancing — it does NOT stop a poll that is already open,
       and it does not stop one closing. An emergency that could freeze a poll
       mid-count would be a way to lose an election and keep the seat. */
    const halted = await underPower('halt_elections');
    const c = cycleNow();
    if (!halted && c && c.number > 0) {
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

      // Under a halt, a poll that has not opened stays shut. One already open is
      // left alone, and closing is never blocked — see the note above.
      if (halted && want === 'voting' && e.status !== 'voting') want = e.status;

      if (want !== e.status) {
        await q('UPDATE elections SET status=$1 WHERE id=$2', [want, e.id]);
        log(null, 'cycle.' + want, e.title);
      }
    }

    if (bool('speaker_auto')) await ensureSpeakerElection();
    /* Retire first, then call the ballot, so a term that ends on this tick puts
       the election in the same minute rather than sixty seconds later. */
    await retireExpiredJustices();
    if (ACT_CONTEXT.intel?.retireExpiredDirector) await ACT_CONTEXT.intel.retireExpiredDirector();
    if (!halted && bool('justice_auto')) await ensureJusticeElection();
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
  if (!['president', 'parliament', 'speaker', 'justice', 'referendum'].includes(kind))
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

/* Run the clock now. Render's free tier sleeps and a sleeping instance has no
   timer, so polls can open late and a Justice's term can outlast itself by
   however long nobody visited. Everything self-heals on the next tick; this is
   the button that says "next tick, please" instead of waiting up to a minute. */
app.post('/api/admin/tick', admin, wrap(async (req, res) => {
  await tick();
  log(req.user.id, 'cycle.tick', 'run by hand');
  res.json({ ok: true, at: new Date().toISOString(), cycle: cycleNow() });
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
  // A defector holds no seat and no signature, and offices.js already clears
  // their seats the moment they renounce — but when bill_proposers is opened to
  // every citizen, that check never runs, so a foreign subject could still
  // author a Republic bill. offshore.js is optional, so ask only if it mounted.
  if (ACT_CONTEXT.offshore?.defectors) {
    const defected = await ACT_CONTEXT.offshore.defectors();
    if (defected.includes(userId)) return false;
  }
  if (CONFIG.bill_proposers === 'citizens') return true;
  const u = (await q('SELECT is_admin FROM users WHERE id=$1', [userId])).rows[0];
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
  const k = ['law', 'amendment', 'repeal', 'motion', 'constitutional', 'rule', 'impeachment', 'treaty', 'recognition'].includes(kind) ? kind : 'law';
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

/* Editing and withdrawing a draft.

   `withdrawn` has been in the schema comment and in the front end's status
   colours since the beginning, and nothing ever set it — so a typo in a bill
   was permanent and the only remedy was to propose a second bill correcting the
   first. That is a real cost in a chamber of nineteen people who are mostly
   drafting on a phone.

   Two rules keep this from becoming a way to cheat:

   1. **Only before the division.** Once the Speaker has called a division,
      people are voting on a text, and changing or vanishing it under them would
      make every vote a vote on something unknown. Draft and tabled only.
   2. **An edit clears the seconds.** Signatures are for the text that was
      signed. Editing after two members have seconded it and then sending a
      different bill to the Speaker is a bait and switch, so the seconds go and
      the proposer has to earn them again. */

const BILL_EDITABLE = ['draft', 'tabled', 'petition'];

app.patch('/api/bills/:id', auth, wrap(async (req, res) => {
  await loadConfig();
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.kind === 'budget') return res.status(400).json({ error: 'A Presidential Budget is a structured fiscal proposal. Replace it after the House rejects it rather than editing its bill text.' });
  if (b.author_id !== req.user.id)
    return res.status(403).json({ error: 'A bill belongs to whoever proposed it. Only they may change its text.' });
  if (!BILL_EDITABLE.includes(b.status))
    return res.status(400).json({
      error: `${b.ref} is ${b.status}. A bill can only be changed before the Speaker calls a division — after that, people are voting on a text.`
    });

  const title = req.body?.title === undefined ? b.title : String(req.body.title).trim().slice(0, 200);
  const body = req.body?.body === undefined ? b.body : String(req.body.body);
  const kind = req.body?.kind === undefined ? b.kind : req.body.kind;
  if (!title || !body) return res.status(400).json({ error: 'A bill needs a title and a text.' });
  if (kind !== b.kind && !['law', 'amendment', 'repeal', 'motion', 'constitutional', 'rule', 'treaty', 'recognition'].includes(kind))
    return res.status(400).json({ error: 'Unknown kind of bill.' });
  if (kind === 'impeachment' || b.kind === 'impeachment')
    return res.status(400).json({ error: 'An impeachment names an officer, so it is withdrawn and re-proposed rather than edited.' });
  if (kind === 'rule') {
    const { errors } = parseRuleChanges(body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  }

  const seconds = (await q('SELECT count(*)::int n FROM bill_seconds WHERE bill_id=$1', [b.id])).rows[0].n;
  const changed = title !== b.title || body !== b.body || kind !== b.kind;
  if (!changed) return res.json({ ...b, seconds_cleared: 0 });

  await q('UPDATE bills SET title=$2, body=$3, kind=$4 WHERE id=$1', [b.id, title, body, kind]);
  // Signatures were for the text that was signed.
  if (seconds) await q('DELETE FROM bill_seconds WHERE bill_id=$1', [b.id]);
  log(req.user.id, 'bill.amend', `${b.ref}${seconds ? ` — ${seconds} second(s) cleared` : ''}`);
  const row = (await q('SELECT * FROM bills WHERE id=$1', [b.id])).rows[0];
  res.json({ ...row, seconds_cleared: seconds });
}));

app.post('/api/bills/:id/withdraw', auth, wrap(async (req, res) => {
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.kind === 'budget') return res.status(400).json({ error: 'The President has placed this budget before the House. The House now decides it.' });
  if (b.author_id !== req.user.id)
    return res.status(403).json({ error: 'Only the member who proposed a bill may withdraw it. Nobody can pull someone else\'s.' });
  if (!BILL_EDITABLE.includes(b.status))
    return res.status(400).json({
      error: `${b.ref} is ${b.status} and cannot be withdrawn — once a division is called the House decides its fate, not the proposer.`
    });
  /* The bill is kept, not deleted. The record of what was proposed and then
     pulled is part of the public record, and a hole in the reference numbers
     would be worse than a withdrawn bill sitting in the list. */
  await q("UPDATE bills SET status='withdrawn', resolved_at=now(), result='withdrawn by the proposer' WHERE id=$1", [b.id]);
  log(req.user.id, 'bill.withdraw', b.ref);
  res.json({ ok: true, ref: b.ref });
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
  if (await underPower('fast_track')) { /* Article 12: seconders suspended by declaration */ }
  else if (s < num('seconds_required'))
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
  const quorum = await underPower('lower_quorum') ? 1 : num('quorum');
  if (v.length < quorum)
    return res.status(400).json({ error: `Quorum is ${quorum} and only ${v.length} voted.` });
  const threshold = b.kind === 'constitutional' ? num('constitutional_threshold')
    : b.kind === 'impeachment' ? num('impeachment_threshold')
    : b.kind === 'treaty' ? num('treaty_threshold')
    : b.kind === 'recognition' ? num('recognition_threshold')
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
    if (gone.includes('intel_director') && ACT_CONTEXT.intel?.directorRemoved)
      await ACT_CONTEXT.intel.directorRemoved(b.target_user_id);
    await q("UPDATE bills SET status='enacted', result=$1, resolved_at=now() WHERE id=$2", [result, b.id]);
    log(req.user.id, 'bill.impeach', `${b.ref}: ${t?.display_name} removed from ${gone.join(', ') || 'nothing'} (${result})`);
    return res.json({ carried, result, share, impeached: t?.display_name, removed_from: gone });
  }

  /* A tie used to be lost by default, silently. If there is a Vice President it
     is theirs to break, in public; if there is not, it is lost as before. */
  /* Article 4.7: the Speaker decides the business of the House, and by long
     convention breaks its ties. Giving the casting vote to whoever assents would
     let one person break a tie and then approve the result of it. */
  if (aye === no && aye > 0) {
    await q("UPDATE bills SET status='tied', result=$1 WHERE id=$2", [result, b.id]);
    log(req.user.id, 'bill.tied', `${b.ref} tied ${result} — to the Speaker's casting vote`);
    return res.json({ tied: true, result });
  }

  /* A Presidential Budget is complete when the House carries it. Sending the
     House's approval back to the executive for assent would let the proposer
     veto the chamber's amendments to their own fiscal plan. */
  if (b.kind === 'budget') {
    if (!carried) {
      await q("UPDATE bills SET status='failed', result=$1, resolved_at=now() WHERE id=$2", [result, b.id]);
      if (ACT_CONTEXT.budget?.billRejected) await ACT_CONTEXT.budget.billRejected(b.id);
      log(req.user.id, 'budget.reject', `${b.ref} lost (${result})`);
      return res.json({ carried: false, result, share });
    }
    await q('UPDATE bills SET result=$1, resolved_at=now() WHERE id=$2', [result, b.id]);
    await enact(b, req.user.id);
    return res.json({ carried: true, result, share, enacted: true });
  }

  await q('UPDATE bills SET status=$1, result=$2, resolved_at=now() WHERE id=$3',
    [carried ? 'passed' : 'failed', result, b.id]);
  log(req.user.id, 'bill.close', `${b.ref} ${carried ? 'carried' : 'lost'} (${result})`);
  res.json({ carried, result, share });
}));

/* Presidential assent, veto, and override. Motions skip the statute book. */
/* Article 17.4 and 18.5. The Prime Minister assents to ordinary bills; the
   President keeps constitutional bills and anything touching how elections run.
   Where there is no Prime Minister, the President assents — the Republic does
   not stop legislating because an appointment has not been made. */
app.post('/api/bills/:id/assent', auth, wrap(async (req, res) => {
  const held = await officesOf(req.user.id);
  /* Refuse on the office before touching the database. Someone with no standing
     should get 403 whatever they put in the URL, not an error from a bad id. */
  if (!held.includes('president') && !held.includes('prime_minister'))
    return res.status(403).json({ error: 'Assent belongs to the Prime Minister, and to the President for constitutional and electoral bills.' });
  if (!/^\d+$/.test(String(req.params.id))) return res.status(404).json({ error: 'No such bill.' });
  const target = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: 'No such bill.' });
  const pm = await pmNow();
  const presidential = presidentialBill(target) || !pm;
  if (presidential && !held.includes('president'))
    return res.status(403).json({ error: pm
      ? 'This bill changes the Constitution or the electoral system. Only the President may assent to it.'
      : 'There is no Prime Minister. Until one is confirmed, only the President may assent.' });
  if (!presidential && !held.includes('prime_minister'))
    return res.status(403).json({ error: 'The Prime Minister assents to ordinary bills.' });
  return assentHandler(req, res);
}));

const assentHandler = wrap(async (req, res) => {
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
});

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
  if (b.kind === 'emergency') {
    // The clock starts when the House agrees, not when the President asked.
    await loadConfig();
    const em = (await q("SELECT * FROM emergencies WHERE bill_id=$1", [b.id])).rows[0];
    if (em) {
      // Same floor as the proposal, or a short declaration is silently stretched.
      const days = Math.min(num('emergency_max_days'),
        Math.max(0.0001, (new Date(em.expires_at) - new Date(em.created_at)) / DAY));
      await q(`UPDATE emergencies SET status='in_force', declared_at=now(), expires_at=$1 WHERE id=$2`,
        [new Date(Date.now() + days * DAY), em.id]);
      log(actorId, 'emergency.declare', `#${em.id}: ${em.powers} for ${days} day(s)`);
      await currentEmergency();
    }
    await q("UPDATE bills SET status='enacted' WHERE id=$1", [b.id]);
    return;
  }
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
  } else if (b.kind !== 'motion' && b.kind !== 'budget') {
    const n = (await q('SELECT count(*)::int n FROM laws')).rows[0].n + 1;
    await q('INSERT INTO laws(ref,title,body,bill_id) VALUES($1,$2,$3,$4)',
      [`L${String(n).padStart(3, '0')}`, b.title, b.body, b.id]);
  }
  await q("UPDATE bills SET status='enacted' WHERE id=$1", [b.id]);
  for (const hook of ENACT_HOOKS) await hook(b, actorId);
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
/* A live image of the state of the Republic.

   Home screen widgets proper need a native app — WidgetKit on iOS, an
   AppWidgetProvider in an APK on Android — and a web app cannot supply one on
   either platform. What every widget system *can* do is display an image from a
   URL and refresh it on a timer. So this endpoint is the widget: no auth, no
   personal data, just what a passer-by could read off the front page anyway.

   Deliberately public. It is embedded by widget apps that cannot hold a token,
   and it exposes nothing that /api/state does not. */
/* ═════════════════════════════════ The Prime Minister — Article 17

   The President appoints; the House confirms; the House alone removes. That
   triangle is the whole safeguard. A Prime Minister the President could dismiss
   would be an employee, and a Prime Minister the House could not remove would be
   a second President.

   The Prime Minister assents to ordinary bills. The President keeps a veto over
   constitutional bills and over rule bills touching the electoral system —
   Article 18.5 — so the two never hold the same key to the same door.  */

async function pmNow() {
  const { rows } = await q(`
    SELECT u.id, u.display_name FROM offices o JOIN users u ON u.id=o.user_id
     WHERE o.office='prime_minister' AND o.active LIMIT 1`);
  return rows[0] || null;
}

/* Which bills does the President keep? Anything that changes the Constitution,
   and any rule bill touching how elections are run. Everything else is the
   Prime Minister's. */
const ELECTORAL_KEYS = [
  'seats', 'cycle_days', 'campaign_days', 'poll_days', 'cycle_elects', 'secret_ballot',
  'enforce_term_limit', 'speaker_threshold', 'speaker_relax', 'speaker_auto',
  'pass_threshold', 'constitutional_threshold', 'veto_override', 'quorum',
  'supermajority_share', 'petition_share', 'referendum_threshold', 'referendum_quorum',
  'initiative_mode', 'initiative_threshold', 'bill_voters', 'bill_proposers'
];

function presidentialBill(b) {
  if (b.kind === 'constitutional') return true;
  if (b.kind !== 'rule') return false;
  const { changes } = parseRuleChanges(b.body);
  return changes.some(c => ELECTORAL_KEYS.includes(c.key));
}

app.get('/api/prime-minister', wrap(async (req, res) => {
  await loadConfig();
  const pm = await pmNow();
  const nom = (await q(`
    SELECT n.*, u.display_name, p.display_name AS nominated_by_name,
           (SELECT count(*)::int FROM pm_confirmations c WHERE c.nomination_id=n.id) AS confirmations
      FROM pm_nominations n
      LEFT JOIN users u ON u.id=n.user_id
      LEFT JOIN users p ON p.id=n.nominated_by
     WHERE n.status='open' ORDER BY n.id DESC LIMIT 1`)).rows[0] || null;
  const house = (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;
  const needed = Math.max(1, Math.floor(house / 2) + 1);
  const refused = (await q(`SELECT count(*)::int n FROM pm_nominations
                             WHERE status='refused' AND created_at > now() - interval '30 days'`)).rows[0].n;
  let confirmed = false, movedNC = false;
  if (req.user) {
    if (nom) confirmed = !!(await q('SELECT 1 FROM pm_confirmations WHERE nomination_id=$1 AND user_id=$2',
      [nom.id, req.user.id])).rows[0];
    if (pm) movedNC = !!(await q('SELECT 1 FROM no_confidence WHERE pm_user_id=$1 AND user_id=$2',
      [pm.id, req.user.id])).rows[0];
  }
  const nc = pm ? (await q('SELECT count(*)::int n FROM no_confidence WHERE pm_user_id=$1', [pm.id])).rows[0].n : 0;
  res.json({
    prime_minister: pm, nomination: nom, house, needed,
    refusals_this_cycle: refused,
    i_confirmed: confirmed, no_confidence: nc, i_moved_no_confidence: movedNC
  });
}));

app.post('/api/prime-minister', requireOffice('president'), wrap(async (req, res) => {
  if (await pmNow()) return res.status(400).json({ error: 'There is a Prime Minister. Only the House can remove one.' });
  const target = (await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved',
    [req.body?.user_id || 0])).rows[0];
  if (!target) return res.status(400).json({ error: 'Name a citizen to appoint.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'The President may not appoint themselves.' });
  await q("UPDATE pm_nominations SET status='withdrawn', settled_at=now() WHERE status='open'");
  const { rows } = await q('INSERT INTO pm_nominations(user_id,nominated_by) VALUES($1,$2) RETURNING *',
    [target.id, req.user.id]);
  log(req.user.id, 'pm.nominate', target.display_name);
  res.json(rows[0]);
}));

/* Article 17.3 — an appointment takes effect only on the confidence of the
   House, and a House that refuses three in a cycle is sent back to the country. */
app.post('/api/prime-minister/confirm', auth, wrap(async (req, res) => {
  await loadConfig();
  const nom = (await q("SELECT * FROM pm_nominations WHERE status='open' ORDER BY id DESC LIMIT 1")).rows[0];
  if (!nom) return res.status(400).json({ error: 'No appointment is before the House.' });
  if (!(await officesOf(req.user.id)).includes('mp'))
    return res.status(403).json({ error: 'The House confirms a Prime Minister.' });
  const support = req.body?.support !== false;
  if (!support) {
    await q('DELETE FROM pm_confirmations WHERE nomination_id=$1 AND user_id=$2', [nom.id, req.user.id]);
    return res.json({ confirmed: false, withdrew: true });
  }
  await q('INSERT INTO pm_confirmations(nomination_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [nom.id, req.user.id]);
  const votes = (await q('SELECT count(*)::int n FROM pm_confirmations WHERE nomination_id=$1', [nom.id])).rows[0].n;
  const house = (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;
  const needed = Math.max(1, Math.floor(house / 2) + 1);
  if (votes < needed) return res.json({ confirmed: false, votes, needed });

  const clash = seatClash(await officesOf(nom.user_id), 'prime_minister');
  if (clash.length)
    return res.status(400).json({ error: `They hold office as ${clash.join(', ')}. The Prime Minister may hold no other office and must resign it first.` });

  await q("INSERT INTO offices(office,user_id) VALUES('prime_minister',$1)", [nom.user_id]);
  await q("UPDATE pm_nominations SET status='confirmed', settled_at=now() WHERE id=$1", [nom.id]);
  await q('DELETE FROM no_confidence WHERE pm_user_id=$1', [nom.user_id]);
  const who = (await q('SELECT display_name FROM users WHERE id=$1', [nom.user_id])).rows[0];
  log(req.user.id, 'pm.confirm', `${who?.display_name} confirmed, ${votes} of ${house}`);
  res.json({ confirmed: true, votes, needed });
}));

app.post('/api/prime-minister/refuse', auth, wrap(async (req, res) => {
  const nom = (await q("SELECT * FROM pm_nominations WHERE status='open' ORDER BY id DESC LIMIT 1")).rows[0];
  if (!nom) return res.status(400).json({ error: 'No appointment is before the House.' });
  if (!(await officesOf(req.user.id)).includes('speaker'))
    return res.status(403).json({ error: 'The Speaker declares the House\'s refusal.' });
  await q("UPDATE pm_nominations SET status='refused', settled_at=now() WHERE id=$1", [nom.id]);
  const refused = (await q(`SELECT count(*)::int n FROM pm_nominations
                             WHERE status='refused' AND created_at > now() - interval '30 days'`)).rows[0].n;
  log(req.user.id, 'pm.refuse', `refusal ${refused}`);
  if (refused >= 3) {
    await q("UPDATE offices SET active=FALSE, until=now() WHERE active AND office IN ('mp','speaker')");
    await q("UPDATE pm_nominations SET status='withdrawn' WHERE status='refused'");
    log(req.user.id, 'pm.dissolution', 'three refusals — the House is dissolved');
    return res.json({ refused, dissolved: true });
  }
  res.json({ refused, dissolved: false });
}));

/* Article 17.6 — the House withdraws confidence at any time, on a simple
   majority, and the office falls at once. No Speaker, no division, no President. */
app.post('/api/prime-minister/no-confidence', auth, wrap(async (req, res) => {
  const pm = await pmNow();
  if (!pm) return res.status(400).json({ error: 'There is no Prime Minister.' });
  if (!(await officesOf(req.user.id)).includes('mp'))
    return res.status(403).json({ error: 'Only the House may withdraw its confidence.' });
  await q('INSERT INTO no_confidence(pm_user_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [pm.id, req.user.id]);
  const votes = (await q('SELECT count(*)::int n FROM no_confidence WHERE pm_user_id=$1', [pm.id])).rows[0].n;
  const house = (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;
  const needed = Math.max(1, Math.floor(house / 2) + 1);
  if (votes < needed) return res.json({ fallen: false, votes, needed });
  await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='prime_minister' AND active", [pm.id]);
  await q('DELETE FROM no_confidence WHERE pm_user_id=$1', [pm.id]);
  log(req.user.id, 'pm.no_confidence', `${pm.display_name} falls, ${votes} of ${house}`);
  res.json({ fallen: true, votes, needed });
}));

/* The Speaker's casting vote — Article 4.7 and long convention. */
app.post('/api/bills/:id/casting-vote', requireOffice('speaker'), wrap(async (req, res) => {
  const b = (await q('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ error: 'No such bill.' });
  if (b.status !== 'tied') return res.status(400).json({ error: 'That bill is not tied.' });
  const vote = req.body?.vote;
  if (!['aye', 'no'].includes(vote))
    return res.status(400).json({ error: 'Cast aye or no. There is no abstaining from a casting vote.' });
  if (vote === 'no') {
    await q("UPDATE bills SET status='failed', casting_vote='no', resolved_at=now() WHERE id=$1", [b.id]);
    if (b.kind === 'budget' && ACT_CONTEXT.budget?.billRejected) await ACT_CONTEXT.budget.billRejected(b.id);
    log(req.user.id, 'bill.casting', `${b.ref} lost on the Speaker's casting vote`);
    return res.json({ carried: false });
  }
  if (b.kind === 'impeachment') {
    const gone = (await q('UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND active RETURNING office',
      [b.target_user_id])).rows.map(r => r.office);
    await q("UPDATE bills SET status='enacted', casting_vote='aye', resolved_at=now() WHERE id=$1", [b.id]);
    log(req.user.id, 'bill.casting', `${b.ref} carried on the casting vote`);
    return res.json({ carried: true, removed_from: gone });
  }
  if (b.kind === 'budget') {
    await q("UPDATE bills SET casting_vote='aye', resolved_at=now() WHERE id=$1", [b.id]);
    await enact(b, req.user.id);
    log(req.user.id, 'bill.casting', `${b.ref} budget carried on the casting vote`);
    return res.json({ carried: true, enacted: true });
  }
  await q("UPDATE bills SET status='passed', casting_vote='aye', resolved_at=now() WHERE id=$1", [b.id]);
  log(req.user.id, 'bill.casting', `${b.ref} carried on the Speaker's casting vote`);
  res.json({ carried: true });
}));

/* ═════════════════════════════ Article 2 — the Sovereignty of the People

   Two thirds of all Citizens may do what no officer can stop. Until now this
   existed only on paper: the Constitution's most powerful mechanism had no
   machinery at all, while four other Articles leaned on it.

     4.6   appoint a Speaker directly, ending a deadlock the House cannot
     10.5  remove any officer, at any time, for any reason or none
     10.6  dissolve the House
     12.3  end a declaration of extraordinary circumstances

   It is a standing motion rather than a poll: signatures accumulate and the act
   happens the moment two thirds is reached. No officer opens it, closes it, or
   is asked about it — because Article 2 does not ask one.

   Anything outside that list is a `resolution`. It records that two thirds of
   the Republic wanted something, which binds every officer under 2.5, but the
   app does not pretend it can execute an arbitrary instruction. */
const SUPER_ACTS = {
  appoint_speaker: 'Appoint a Speaker directly (Article 4.6)',
  remove_officer: 'Remove an officer from every office they hold (Article 10.5)',
  dissolve_house: 'Dissolve the House and vacate every seat (Article 10.6)',
  end_emergency: 'End the declaration of extraordinary circumstances (Article 12.3)',
  resolution: 'Resolve that something is the will of the Republic (Article 2.3)'
};

async function superNeeded() {
  const n = (await q('SELECT count(*)::int n FROM users WHERE is_active AND approved')).rows[0].n;
  return { citizens: n, needed: Math.max(1, Math.ceil(n * num('supermajority_share'))) };
}

async function carrySupermajority(m, actorId) {
  let outcome = 'Recorded as the will of the Republic.';
  if (m.kind === 'appoint_speaker' && m.target_user_id) {
    if (!(await officesOf(m.target_user_id)).includes('mp'))
      outcome = 'Not seated: Article 4.1 requires the Speaker to be a member of the House.';
    else {
      await q("UPDATE offices SET active=FALSE, until=now() WHERE office='speaker' AND active");
      await q("INSERT INTO offices(office,user_id) VALUES('speaker',$1)", [m.target_user_id]);
      outcome = 'Speaker appointed by the Citizens.';
    }
  } else if (m.kind === 'remove_officer' && m.target_user_id) {
    const gone = (await q(
      'UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND active RETURNING office',
      [m.target_user_id])).rows.map(r => r.office);
    outcome = gone.length ? `Removed from ${gone.join(', ')}.` : 'That citizen held no office.';
  } else if (m.kind === 'dissolve_house') {
    await q("UPDATE offices SET active=FALSE, until=now() WHERE active AND office IN ('mp','speaker')");
    outcome = 'The House is dissolved and every seat vacated.';
  } else if (m.kind === 'end_emergency') {
    const em = await currentEmergency();
    if (em) {
      await q("UPDATE emergencies SET status='ended', ended_at=now(), ended_by='citizens' WHERE id=$1", [em.id]);
      await currentEmergency();
      outcome = 'The declaration is ended by the Citizens.';
    } else outcome = 'No declaration was in force.';
  }
  await q("UPDATE supermajorities SET status='carried', carried_at=now(), outcome=$1 WHERE id=$2",
    [outcome, m.id]);
  log(actorId, 'supermajority.carried', `#${m.id} ${m.kind}: ${outcome}`);
  return outcome;
}

app.get('/api/supermajority', wrap(async (req, res) => {
  await loadConfig();
  const { citizens, needed } = await superNeeded();
  await q(`UPDATE supermajorities SET status='lapsed'
            WHERE status='open' AND expires_at IS NOT NULL AND expires_at <= now()`);
  const rows = (await q(`
    SELECT m.*, u.display_name AS opened_by_name, t.display_name AS target_name,
           (SELECT count(*)::int FROM supermajority_signatures s WHERE s.motion_id=m.id) AS signatures
      FROM supermajorities m
      LEFT JOIN users u ON u.id=m.opened_by
      LEFT JOIN users t ON t.id=m.target_user_id
     ORDER BY (m.status='open') DESC, m.id DESC LIMIT 30`)).rows;
  let mine = [];
  if (req.user) {
    mine = (await q('SELECT motion_id FROM supermajority_signatures WHERE user_id=$1', [req.user.id]))
      .rows.map(r => r.motion_id);
  }
  res.json({
    citizens, needed, acts: SUPER_ACTS,
    motions: rows.map(m => ({ ...m, signed: mine.includes(m.id) }))
  });
}));

app.post('/api/supermajority', auth, slowWrites, wrap(async (req, res) => {
  await loadConfig();
  const kind = req.body?.kind;
  if (!(kind in SUPER_ACTS))
    return res.status(400).json({ error: 'Choose one of the acts the Constitution names.' });
  const reasons = String(req.body?.reasons || '').trim();
  if (!reasons) return res.status(400).json({ error: 'Say what you are asking the Republic to agree to.' });
  let target = null;
  if (kind === 'appoint_speaker' || kind === 'remove_officer') {
    target = (await q('SELECT id FROM users WHERE id=$1 AND is_active AND approved',
      [req.body?.target_user_id || 0])).rows[0];
    if (!target) return res.status(400).json({ error: 'Name the citizen this concerns.' });
  }
  const { rows } = await q(
    `INSERT INTO supermajorities(kind,target_user_id,reasons,opened_by,expires_at)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [kind, target?.id || null, reasons.slice(0, 4000), req.user.id,
     new Date(Date.now() + num('supermajority_days') * DAY)]);
  log(req.user.id, 'supermajority.open', `#${rows[0].id} ${kind}`);
  res.json(rows[0]);
}));

app.post('/api/supermajority/:id/sign', auth, wrap(async (req, res) => {
  await loadConfig();
  const m = (await q("SELECT * FROM supermajorities WHERE id=$1 AND status='open'", [req.params.id])).rows[0];
  if (!m) return res.status(404).json({ error: 'No such open motion.' });
  if (m.expires_at && new Date(m.expires_at) <= new Date()) {
    await q("UPDATE supermajorities SET status='lapsed' WHERE id=$1", [m.id]);
    return res.status(400).json({ error: 'That motion has lapsed.' });
  }
  await q('INSERT INTO supermajority_signatures(motion_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [m.id, req.user.id]);
  const signatures = (await q('SELECT count(*)::int n FROM supermajority_signatures WHERE motion_id=$1',
    [m.id])).rows[0].n;
  const { citizens, needed } = await superNeeded();
  if (signatures < needed) return res.json({ carried: false, signatures, needed, citizens });
  const outcome = await carrySupermajority(m, req.user.id);
  res.json({ carried: true, signatures, needed, citizens, outcome });
}));

app.post('/api/supermajority/:id/withdraw', auth, wrap(async (req, res) => {
  const m = (await q("SELECT * FROM supermajorities WHERE id=$1 AND status='open'", [req.params.id])).rows[0];
  if (!m) return res.status(404).json({ error: 'No such open motion.' });
  if (m.opened_by !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Only whoever opened it may withdraw it.' });
  await q("UPDATE supermajorities SET status='withdrawn' WHERE id=$1", [m.id]);
  res.json({ ok: true });
}));

/* Article 7.4 — a Citizen may resign any office at any time, and need give no
   reason. There was no way to do this at all: an officer could only be removed
   by somebody else, which is not what the Constitution says. */
app.post('/api/me/resign', auth, wrap(async (req, res) => {
  const office = req.body?.office;
  const held = await officesOf(req.user.id);
  if (!held.includes(office)) return res.status(400).json({ error: 'You do not hold that office.' });
  await q('UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office=$2 AND active',
    [req.user.id, office]);
  // Article 4.1: the Speaker is a member of the House, so leaving the House
  // leaves the chair with it.
  if (office === 'mp' && held.includes('speaker')) {
    await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='speaker' AND active",
      [req.user.id]);
  }
  if (office === 'intel_director' && ACT_CONTEXT.intel?.directorRemoved)
    await ACT_CONTEXT.intel.directorRemoved(req.user.id);
  log(req.user.id, 'office.resign', office);
  res.json({ ok: true, offices: await officesOf(req.user.id) });
}));

/* ═══════════════════════════════════ Article 12 — Extraordinary Circumstances

   The President moves it, the House decides it, and the House alone can end it.
   That shape is the whole safeguard: an emergency the President could declare
   unilaterally would simply be the President ruling. */

app.get('/api/emergency', wrap(async (req, res) => {
  await loadConfig();
  const now = await currentEmergency();
  const history = (await q(`
    SELECT e.*, u.display_name AS declared_by_name,
           (SELECT count(*)::int FROM emergency_end_votes v WHERE v.emergency_id=e.id) AS end_votes
      FROM emergencies e LEFT JOIN users u ON u.id=e.declared_by
     ORDER BY e.id DESC LIMIT 20`)).rows;
  const house = (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;
  const needed = Math.max(1, Math.ceil(house * num('emergency_end_share')));
  let mine = false;
  if (req.user && now) {
    mine = !!(await q('SELECT 1 FROM emergency_end_votes WHERE emergency_id=$1 AND user_id=$2',
      [now.id, req.user.id])).rows[0];
  }
  res.json({
    in_force: now ? { ...now, powers: String(now.powers || '').split(',').filter(Boolean) } : null,
    powers_available: EMERGENCY_POWERS,
    max_days: num('emergency_max_days'),
    house, end_votes_needed: needed, i_voted_to_end: mine,
    end_votes: now ? (await q('SELECT count(*)::int n FROM emergency_end_votes WHERE emergency_id=$1', [now.id])).rows[0].n : 0,
    history
  });
}));

/* The President moves a declaration. It is a bill, so the House decides it. */
app.post('/api/emergency', requireOffice('president'), wrap(async (req, res) => {
  await loadConfig();
  if (await currentEmergency()) return res.status(400).json({ error: 'A declaration is already in force.' });
  const reasons = String(req.body?.reasons || '').trim();
  if (!reasons) return res.status(400).json({ error: 'Say what the circumstances are. The House is being asked to suspend the ordinary law on your word.' });
  const asked = (req.body?.powers || []).filter(p => p in EMERGENCY_POWERS);
  if (!asked.length) return res.status(400).json({ error: 'Name at least one power. A declaration suspends only what it names.' });
  // The floor is deliberately tiny rather than a round number: a declaration of
  // twenty minutes is a legitimate thing to want, and it must be possible to
  // watch one lapse without waiting an hour.
  const days = Math.min(Math.max(Number(req.body?.days) || 1, 0.0001), num('emergency_max_days'));

  const n = (await q('SELECT count(*)::int n FROM bills')).rows[0].n + 1;
  const body = [
    reasons, '',
    '## Powers claimed',
    ...asked.map(p => `- ${EMERGENCY_POWERS[p]}`), '',
    `This declaration lapses after ${days} day${days === 1 ? '' : 's'} unless ended sooner.`,
    'The House may end it at any moment without the President\'s consent.'
  ].join('\n');

  const bill = (await q(
    `INSERT INTO bills(ref,title,kind,body,author_id) VALUES($1,$2,'emergency',$3,$4) RETURNING *`,
    [`B${String(n).padStart(3, '0')}`, 'Declaration of Extraordinary Circumstances', body, req.user.id])).rows[0];
  const em = (await q(
    `INSERT INTO emergencies(bill_id,declared_by,reasons,powers,expires_at)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [bill.id, req.user.id, reasons, asked.join(','), new Date(Date.now() + days * DAY)])).rows[0];
  log(req.user.id, 'emergency.propose', `${bill.ref}: ${asked.join(', ')}`);
  res.json({ ...em, bill_ref: bill.ref, bill_id: bill.id });
}));

/* Article 12.3 — the House alone, at any moment. No Speaker, no division, no
   waiting for the President. Each member's vote counts the instant it is cast. */
app.post('/api/emergency/end', auth, wrap(async (req, res) => {
  await loadConfig();
  const em = await currentEmergency();
  if (!em) return res.status(400).json({ error: 'No declaration is in force.' });

  const isMp = (await officesOf(req.user.id)).includes('mp');
  const isPres = req.user.id === em.declared_by;
  if (!isMp && !isPres)
    return res.status(403).json({ error: 'The House ends a declaration, or the President who made it. Ask a member to move it.' });

  if (isPres && !isMp) {
    await q("UPDATE emergencies SET status='ended', ended_at=now(), ended_by='president' WHERE id=$1", [em.id]);
    log(req.user.id, 'emergency.end', `#${em.id} ended by the President`);
    await currentEmergency();
    return res.json({ ended: true, by: 'president' });
  }

  await q('INSERT INTO emergency_end_votes(emergency_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [em.id, req.user.id]);
  const votes = (await q('SELECT count(*)::int n FROM emergency_end_votes WHERE emergency_id=$1', [em.id])).rows[0].n;
  const house = (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;
  const needed = Math.max(1, Math.ceil(house * num('emergency_end_share')));
  if (votes < needed) {
    log(req.user.id, 'emergency.end.move', `#${em.id}: ${votes} of ${needed}`);
    return res.json({ ended: false, votes, needed });
  }
  await q("UPDATE emergencies SET status='ended', ended_at=now(), ended_by='house' WHERE id=$1", [em.id]);
  log(req.user.id, 'emergency.end', `#${em.id} ended by the House, ${votes} of ${house}`);
  await currentEmergency();
  res.json({ ended: true, by: 'house', votes, needed });
}));


function pngColour(hex, fallback = '#000000') {
  const m = String(hex || fallback).match(/^#?([0-9a-f]{6})$/i);
  const n = parseInt(m ? m[1] : fallback.replace('#', ''), 16);

  return [
    (n >> 16) & 255,
    (n >> 8) & 255,
    n & 255,
    255
  ];
}

function pngCrc32(buf) {
  let c = 0xffffffff;

  for (const b of buf) {
    c ^= b;

    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }

  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);

  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);

  out.writeUInt32BE(
    pngCrc32(Buffer.concat([t, data])),
    8 + data.length
  );

  return out;
}


async function makeWidgetSvg(dark = false, radius = 0) {
  await loadConfig();

  const W = 360, H = 170;
  /* Kept clear of the host's corner mask on every side. */
  const SAFE = 26;

  const flag = await currentFlag();
  const bands = flag?.bands || [];

  const primary =
    bands.map(b => b.colour).filter(c => c && c !== '#FFFFFF')[0]
    || '#1E2A5A';

  const accent = flag?.device || primary;

  const paper = dark ? '#15171C' : '#F5F6F7';
  const ink = dark ? '#F2F3F5' : '#14161C';
  const ink2 = dark ? '#9AA0AB' : '#5C6270';
  const rule = dark ? '#2C3037' : '#C8CBD1';

  const off = (
    await q(`
      SELECT o.office, u.display_name
      FROM offices o
      JOIN users u ON u.id = o.user_id
      WHERE o.active
    `)
  ).rows;

  const one = k =>
    off.find(o => o.office === k)?.display_name || 'Vacant';

  const mps =
    off.filter(o => o.office === 'mp').length;

  const el = (
    await q(`
      SELECT title, status
      FROM elections
      WHERE status IN ('nominations','campaign','voting')
      ORDER BY id DESC
      LIMIT 1
    `)
  ).rows[0];

  const live = (
    await q(`
      SELECT count(*)::int n
      FROM bills
      WHERE status IN (
        'petition',
        'draft',
        'tabled',
        'division',
        'referendum',
        'passed'
      )
    `)
  ).rows[0].n;

  const laws = (
    await q(`
      SELECT count(*)::int n
      FROM laws
      WHERE repealed_at IS NULL
    `)
  ).rows[0].n;

  const cits = (
    await q(`
      SELECT count(*)::int n
      FROM users
      WHERE is_active AND approved
    `)
  ).rows[0].n;

  const e = str =>
    String(str ?? '')
      .replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c])
      .slice(0, 40);

  const headline = el
    ? (
        el.status === 'voting'
          ? 'POLL OPEN'
          : el.status === 'campaign'
            ? 'CAMPAIGNING'
            : 'NOMINATIONS OPEN'
      )
    : (
        live
          ? `${live} BEFORE THE HOUSE`
          : 'THE HOUSE IS QUIET'
      );

  /* Inset from both sides and rounded, so the host's corner mask never eats an
     end. A full-bleed strip loses roughly 24pt at each corner on iOS. */
  const STRIP_Y = 16, STRIP_H = 7, STRIP_W = W - SAFE * 2;
  let bandStrip = `<clipPath id="strip"><rect x="${SAFE}" y="${STRIP_Y}" width="${STRIP_W}" height="${STRIP_H}" rx="${STRIP_H / 2}"/></clipPath><g clip-path="url(#strip)">`;
  if (bands.length) {
    const total = bands.reduce((n, b) => n + (b.weight || 1), 0) || 1;
    let x = SAFE;
    for (const b of bands) {
      const bw = STRIP_W * ((b.weight || 1) / total);
      bandStrip += `<rect x="${x.toFixed(1)}" y="${STRIP_Y}" width="${(bw + 0.6).toFixed(1)}" height="${STRIP_H}" fill="${e(b.colour)}"/>`;
      x += bw;
    }
  } else {
    bandStrip += `<rect x="${SAFE}" y="${STRIP_Y}" width="${STRIP_W}" height="${STRIP_H}" fill="${e(primary)}"/>`;
  }
  // A hairline round the bar so a white band is still visible on pale paper.
  bandStrip += `</g><rect x="${SAFE}" y="${STRIP_Y}" width="${STRIP_W}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="none" stroke="${rule}" stroke-width="0.75"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">

    <!-- iOS masks a widget with its own corner radius, and so does KWGT. Anything
         within about 24pt of a corner is eaten by that arc, which is why a
         full-bleed strip lost its ends. The background goes edge to edge and
         everything else stays inside SAFE. -->
    <rect width="${W}" height="${H}" ${radius ? `rx="${radius}"` : ''} fill="${paper}"/>

    <!-- The flag as an inset bar rather than a full-bleed strip, with rounded
         ends of its own so the inset reads as deliberate. -->
    ${bandStrip}

    <text x="${SAFE}" y="52" font-size="19" font-weight="700" fill="${ink}">${e(CONFIG.nation_name)}</text>
    <text x="${SAFE}" y="69" font-size="10.5" letter-spacing="1.6" font-weight="600" fill="${e(accent)}">${e(headline)}</text>
    ${el ? `<text x="${SAFE}" y="87" font-size="12" fill="${ink2}">${e(el.title)}</text>` : ''}

    <line x1="${SAFE}" y1="${el ? 99 : 84}" x2="${W - SAFE}" y2="${el ? 99 : 84}" stroke="${rule}"/>

    <text x="${SAFE}" y="116" font-size="11" fill="${ink2}">President</text>
    <text x="${SAFE}" y="132" font-size="13.5" font-weight="600" fill="${ink}">${e(one('president'))}</text>
    <text x="${W / 2 + 6}" y="116" font-size="11" fill="${ink2}">Speaker</text>
    <text x="${W / 2 + 6}" y="132" font-size="13.5" font-weight="600" fill="${ink}">${e(one('speaker'))}</text>

    <!-- Baseline 150: the bottom corner arc reaches about y=146 at this inset. -->
    <text x="${SAFE}" y="150" font-size="10.5" fill="${ink2}">${mps} sitting · ${laws} laws · ${cits} citizens</text>

  </svg>`;

}

/* The same widget as data, for anything that can draw its own text.

   Scriptable on iOS renders natively with real fonts at the device's own
   density, which is sharper than any image we could send and picks up the
   phone's dark mode without being told. An image is only needed where the
   widget host cannot draw — Android image widgets, mostly. */
app.get('/api/widget.json', wrap(async (_req, res) => {
  await loadConfig();
  const flag = await currentFlag();
  const bands = (flag?.bands || []).map(b => ({ colour: b.colour, weight: b.weight || 1 }));

  const off = (await q(`SELECT o.office, u.display_name FROM offices o
                        JOIN users u ON u.id = o.user_id WHERE o.active`)).rows;
  const one = k => off.find(o => o.office === k)?.display_name || null;
  const el = (await q(`SELECT title, status, closes_at FROM elections
                        WHERE status IN ('nominations','campaign','voting')
                        ORDER BY id DESC LIMIT 1`)).rows[0] || null;
  const live = (await q(`SELECT count(*)::int n FROM bills
                         WHERE status IN ('petition','draft','tabled','division','referendum','passed')`)).rows[0].n;
  const laws = (await q('SELECT count(*)::int n FROM laws WHERE repealed_at IS NULL')).rows[0].n;
  const cits = (await q('SELECT count(*)::int n FROM users WHERE is_active AND approved')).rows[0].n;
  const mps = off.filter(o => o.office === 'mp').length;
  let emergency = null;
  try {
    const em = await currentEmergency();
    if (em) emergency = { reasons: em.reasons, expires_at: em.expires_at };
  } catch { /* core without Article 12 */ }

  res.set('Cache-Control', 'public, max-age=120');
  res.json({
    nation: CONFIG.nation_name,
    accent: flag?.device || bands.find(b => b.colour !== '#FFFFFF')?.colour || '#1E2A5A',
    bands,
    headline: emergency ? 'EXTRAORDINARY CIRCUMSTANCES'
      : el ? (el.status === 'voting' ? 'POLL OPEN' : el.status === 'campaign' ? 'CAMPAIGNING' : 'NOMINATIONS OPEN')
      : live ? `${live} BEFORE THE HOUSE` : 'THE HOUSE IS QUIET',
    urgent: !!(emergency || el?.status === 'voting'),
    subtitle: emergency ? emergency.reasons : el ? el.title : null,
    closes_at: el?.closes_at || emergency?.expires_at || null,
    president: one('president'),
    speaker: one('speaker'),
    counts: { mps, laws, citizens: cits, live },
    as_of: new Date().toISOString()
  });
}));

app.get('/api/widget.svg', wrap(async (req, res) => {
  const dark =
    String(req.query.theme || '').toLowerCase() === 'dark';

  const radius = Math.max(0, Math.min(48, parseInt(req.query.radius, 10) || 0));
  const svg = await makeWidgetSvg(dark, radius);

  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=120');

  res.send(svg);
}));


app.get('/api/widget.png', wrap(async (req, res) => {
  const dark =
    String(req.query.theme || '').toLowerCase() === 'dark';

  const radius = Math.max(0, Math.min(48, parseInt(req.query.radius, 10) || 0));
  const svg = await makeWidgetSvg(dark, radius);

  /* Required here rather than at the top of the file. sharp is a large native
     dependency; if it is missing or fails to build, that must cost one widget
     request and not the whole Republic's ability to boot. */
  let sharp;
  try { sharp = require('sharp'); }
  catch { return res.status(503).json({ error: 'PNG rendering is unavailable on this server. Use /api/widget.svg or /api/widget.json.' }); }

  // Rendered at 3x. A widget canvas is roughly three device pixels per point,
  // so a 1x PNG is the blurry one.
  const png = await sharp(Buffer.from(svg), { density: 216 })
    .resize(1080, 510, { fit: 'fill' })
    .png()
    .toBuffer();

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=120');

  res.send(png);
}));


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
  const budgetControlled = new Set(['tax_free_allowance','tax_rate','tax_upper_threshold','tax_rate_upper','foreign_trade_tax','military_budget_per_cycle']);
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULTS) || budgetControlled.has(k)) continue;
    await q('INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, String(v)]);
  }
  log(req.user.id, 'config.update', Object.keys(req.body || {}).join(','));
  res.json(await loadConfig());
}));

/* The Returning Officer runs the machinery — invites, approvals, settings,
   elections — and holds no office themselves. Where an office has a route of its
   own that means something (a confirmation vote, a term, a protection against
   dismissal), the RO does not have a second door into it: an RO who can seat a
   Fed chair the House never confirmed has quietly taken the House's power, and
   an RO who can unseat one has taken a power the constitution gives nobody. */
const RO_MAY_NOT_FILL = {
  quartermaster: 'The Quartermaster is appointed by the Prime Minister, or by the President where there is none, through /api/war/quartermaster/appoint. The Returning Officer holds no office and does not appoint to one.',
  foreign_minister: 'The Foreign Minister is appointed by the Prime Minister, or by the President where there is none, through /api/diplomacy/foreign-office/appoint. The Returning Officer holds no office and does not appoint to one.',
  treasurer: 'The Treasurer is appointed by the Prime Minister, or by the President where there is none, through /api/treasury/appoint. The Returning Officer holds no office and does not appoint to one.',
  fed_chair: 'The head of the Fed is nominated by the President and confirmed by the House. Once confirmed, only impeachment or their own resignation removes them — Article 21.10 and 21.11. There is no administrative route in or out.',
  intel_director: 'The Director of Intelligence is nominated by the Prime Minister, or the President where there is none, and confirmed by a majority of the House. Once confirmed, only impeachment, expiry of the fixed term, or their own resignation removes them. There is no administrative route in or out.'
};

app.post('/api/admin/office', admin, wrap(async (req, res) => {
  const { user_id, office, seat, remove } = req.body || {};
  if (RO_MAY_NOT_FILL[office]) return res.status(403).json({ error: RO_MAY_NOT_FILL[office] });
  if (!['president', 'prime_minister', 'speaker', 'mp', 'justice'].includes(office)) return res.status(400).json({ error: 'Unknown office.' });
  if (!remove) {
    const held = await officesOf(user_id);
    const clash = seatClash(held, office);
    if (clash.length)
      return res.status(400).json({ error: `That office conflicts with ${clash.join(', ')}. Exclusive offices cannot be combined, and executive portfolios may only be combined within the same policy area.` });
  }
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

/* The Acts are mounted as modules so they can be added or removed without
   touching anything above. Each is optional: if the file is not there, the
   Republic simply does not have that institution yet. */
const ACT_CONTEXT = {
  q, tx, log, auth, admin, wrap, num, bool, loadConfig, officesOf, holds, seatClash, officesCompatible,
  citizenCount, slowWrites, requireOffice, requireScope, attribute, events, enact, canPropose, cycleNow, addEnactHook, bcrypt, crypto,
  justiceTermEnds,
  get CONFIG() { return CONFIG; }
};
/* Order matters twice over. economy.js sets ctx.economy as its last act and
   money.js and offshore.js borrow the ledger primitives off it. diplomacy.js is
   mounted before all three because economy's payrun calls ctx.diplomacy?.runPayrun,
   and because a foreign power holds a real account like anyone else. worldexport,
   worldgen and offshore go last, in that order: worldexport only reads territory
   tables diplomacy's schema owns; worldgen reads ctx.diplomacy and ctx.war at
   request time, never at mount time, to measure a generated power against the
   same strength a real conflict would use; offshore reads ctx.war?.blockadedPowers
   and ctx.intel the same way. All three are optional like everything else here —
   a missing atlas, diplomacy schema or war module and they answer 503 instead of
   inventing a number. intelligence.js mounts right after war.js: it extends
   ctx.intel (which diplomacy.js set) rather than replacing it, and a coup or
   removal is exactly the kind of write worldgen and offshore need to already see
   coming. */
/* Say what happened to every one of them. A module that fails to mount answers
   503 for the rest of the process's life, and on Render that used to be
   invisible at boot — the same failure shape as a mismatched ALLOWED_ORIGINS,
   where the server looks healthy while half the site does not work. */
for (const mod of ['./judiciary', './diplomacy', './economy', './money', './war', './intelligence', './budget', './worldexport', './worldgen', './offshore', './publicapi', './press']) {
  const name = mod.replace('./', '');
  try {
    require(mod).mount(app, ACT_CONTEXT);
    console.log(`[republic] ${name} mounted`);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(mod)) {
      console.log(`[republic] ${name} is not in this build — its endpoints will answer 404`);
      continue;
    }
    console.error(`[republic] ${name} FAILED TO MOUNT — its endpoints will answer 404:`, err.message);
  }
}

app.use((_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

bootstrap()
  .then(async () => {
    await tick();
    setInterval(tick, 60000);
    app.listen(PORT, () => console.log(`[republic] listening on ${PORT}`));
  })
  .catch(err => { console.error('[republic] failed to start:', err); process.exit(1); });
