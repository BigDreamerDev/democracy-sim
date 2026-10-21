// The Realm API. The whole game is one JSON world held in memory, saved to Postgres after every change,
// and advanced to the real clock before every read or write. Players only ever receive their own view of it.
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Q, SCHEMA } from './db';
import { publicApi, newKey, keyHash, MAX_KEYS } from './public';
import { apps, APPS_SCHEMA, Sender } from './apps';
import { SECURITY_SCHEMA, passwordProblem, hash, dummyCompare, needsRehash, account, lockedFor, failed, succeeded, headers, limiter } from './security';
import { providers, authorizeUrl, exchange, random } from './oauth';
import { passkeys, PASSKEY_SCHEMA } from './passkeys';
import { IMAGES_SCHEMA, imageGet, imageRoutes, photoProblem } from './images';
import { INVITES_SCHEMA, inviteRoutes, claimInvite, releaseInvite, useInvite } from './invites';
import { run, viewFor, advanceTo, nextDeadline, createLiveWorld, GameError, gazette, migrate, needs, adminDid, nm } from '../engine/index';

export type Options = { q: Q; secret: string; origins: string[]; now?: () => number; log?: (...a: any[]) => void; send?: Sender; site?: string; devOrigins?: boolean; env?: Record<string, string | undefined>; publicUrl?: string; saveEvery?: number };

export async function makeApp(o: Options) {
  const { q, secret } = o;
  const now = o.now || (() => Date.now());
  const log = o.log || ((...a: any[]) => console.log('[realm]', ...a));
  await q(SCHEMA);
  await q(APPS_SCHEMA);
  await q(SECURITY_SCHEMA);
  await q(PASSKEY_SCHEMA);
  await q(IMAGES_SCHEMA);
  await q(INVITES_SCHEMA);
  const env = o.env || process.env;
  const OAUTH = providers(env);
  const rate = limiter(now);
  const A = apps(q, (...a: any[]) => log(...a), o.send);
  const SITE = o.site || 'https://bigdreamerdev.github.io/democracy-sim/';
  // a player's alerts, from their own redacted view only, so a personal webhook can never carry someone else's secret
  const alertsFor = (uid: number) => (world.citizens['u' + uid] ? needs(viewFor(world, 'u' + uid), 'u' + uid) : null);

  // ---------- the world ----------
  let world: any;
  const people = async () => (await q('SELECT id, display_name, is_admin FROM users WHERE is_active AND approved ORDER BY id')).rows.map((u: any) => ({ id: 'u' + u.id, name: u.display_name, admin: !!u.is_admin }));
  const saved = (await q('SELECT state FROM v2_world WHERE id = 1')).rows[0];
  if (saved) world = migrate(saved.state);
  else {
    world = createLiveWorld(await people(), now(), (now() % 2147483647) | 0);
    await q('INSERT INTO v2_world (id, state) VALUES (1, $1)', [JSON.stringify(world)]);
    log(`New realm created for ${Object.keys(world.citizens).length} citizens.`);
  }
  // `version` goes up on every save; long-polling API clients wait on it
  let version = Number((await q('SELECT version FROM v2_world WHERE id = 1')).rows[0]?.version || 0);
  let waiters: (() => void)[] = [];
  let lastGz: string | undefined = world.gazette[0]?.id;
  // Writes are coalesced: the first change writes at once, and any more within `saveEvery` ms become one
  // trailing write. Every write rewrites the whole world, so on Neon's free tier this is what keeps storage
  // history and compute time down. Players see changes instantly either way; flush() runs on shutdown.
  const SAVE_EVERY = o.saveEvery ?? 0;
  let lastWrite = 0;
  let pending: any = null;
  const write = async () => {
    clearTimeout(pending);
    pending = null;
    lastWrite = Date.now();
    await q('UPDATE v2_world SET state = $1, version = $2, updated_at = now() WHERE id = 1', [JSON.stringify(world), version]);
  };
  const persist = async () => {
    if (!SAVE_EVERY) return write();
    if (pending) return;
    const wait = lastWrite + SAVE_EVERY - Date.now();
    if (wait <= 0) return write();
    pending = setTimeout(() => write().catch((e) => log('save failed', e)), wait);
  };
  const flush = async () => {
    if (pending) await write();
  };
  // logs and snapshots don't need to live forever
  await q("DELETE FROM v2_log WHERE at < now() - interval '45 days'").catch(() => {});
  await q('DELETE FROM v2_snapshots WHERE id NOT IN (SELECT id FROM v2_snapshots ORDER BY at DESC LIMIT 5)').catch(() => {});
  const save = async () => {
    version++;
    await persist();
    // push new Gazette entries to webhooks, oldest first, without holding up the request
    const top = world.gazette[0]?.id;
    if (top !== lastGz) {
      const i = lastGz ? world.gazette.findIndex((g: any) => g.id === lastGz) : world.gazette.length;
      const fresh = i > 0 ? world.gazette.slice(0, i).reverse() : [];
      lastGz = top;
      A.broadcast(fresh, world.config.realmName, version).catch((e) => log('webhooks failed', e));
    }
    A.notify(alertsFor, world.config.realmName, SITE);
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  const waitForChange = (since: number, ms: number) =>
    new Promise<void>((res) => {
      if (version > since) return res();
      const done = () => (clearTimeout(t), res());
      const t = setTimeout(() => ((waiters = waiters.filter((f) => f !== done)), res()), ms);
      waiters.push(done);
    });

  // every change goes through one queue, so two requests can never interleave
  let chain: Promise<any> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const catchUp = async () => {
    const before = world.now;
    const due = nextDeadline(world);
    if (due && due <= now()) {
      advanceTo(world, now());
      await save();
    } else world.now = Math.max(world.now, now());
    return world.now !== before;
  };
  let timer: any = null;
  const schedule = () => {
    clearTimeout(timer);
    const due = nextDeadline(world);
    if (!due) return;
    timer = setTimeout(() => serial(catchUp).then(schedule).catch((e) => log('clock error', e)), Math.min(Math.max(due - now(), 1000), 6 * 3600_000));
    if (timer.unref) timer.unref();
  };
  schedule();

  // ---------- auth ----------
  // Session tokens: HS256 JWTs carrying the user id and token_version. Bumping token_version (password change,
  // "sign out everywhere", an RO password reset) kills every older token. Tokens last 30 days and are refreshed
  // in the X-Realm-Token header once they are a week old, so active players stay signed in.
  const sign = (u: any) => jwt.sign({ id: u.id, tv: u.token_version || 0 }, secret, { expiresIn: '30d', algorithm: 'HS256' });
  const userCache = new Map<number, any>();
  const loadUser = async (id: number) => {
    const u = (await q('SELECT id, username, display_name, is_admin, is_active, approved, token_version FROM users WHERE id = $1', [id])).rows[0];
    if (u) userCache.set(id, u);
    return u;
  };
  const auth = async (req: any, res: any, next: any) => {
    const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (t.startsWith('rlm_')) return res.status(401).json({ error: 'API keys only work on /api/v1.' });
    let p: any;
    try {
      p = jwt.verify(t, secret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Please sign in.' });
    }
    const u = userCache.get(p.id) || (await loadUser(p.id));
    if (!u || !u.is_active || !u.approved || (u.token_version || 0) !== p.tv) return res.status(401).json({ error: 'Please sign in again.' });
    if (rate('user:' + u.id, 120, 60_000)) return res.status(429).json({ error: 'Slow down a little: too many requests from your account.' });
    req.user = u;
    req.cid = 'u' + u.id;
    if (p.iat && now() / 1000 - p.iat > 7 * 86400) res.setHeader('X-Realm-Token', sign(u));
    if (!world.citizens[req.cid]) return res.status(403).json({ error: 'You are not a citizen of this realm yet. Ask the Returning Officer.' });
    next();
  };
  const limited = (key: string, n = 10) => rate(key, n, 60_000);
  const welcome = async (u: any, req: any) => {
    userCache.set(u.id, u);
    await succeeded(q, u.id, String(req.ip || ''));
    const cid = 'u' + u.id;
    if (!world.citizens[cid] && u.approved)
      await serial(async () => {
        addCitizen(world, cid, u.display_name, !!u.is_admin);
        await save();
      });
    return { token: sign(u), me: cid };
  };
  const audit = (actor: string, cmd: string, ok: boolean, error?: string) => q('INSERT INTO v2_log (actor, cmd, args, ok, error) VALUES ($1, $2, $3, $4, $5)', [actor, cmd, '{}', ok, error || null]).catch(() => {});

  // ---------- app ----------
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(headers);
  app.use(express.json({ limit: '200kb' }));
  // the public API for players' own apps: any origin, API keys only (see public.ts and API.md)
  const v1 = publicApi({ q, now, log, world: () => world, setWorld: (w) => (world = w), version: () => version, waitForChange, serial, catchUp, save, schedule, apps: A, alertsFor, loadUser: async (id) => userCache.get(id) || loadUser(id) });
  app.use('/api/v1', v1);
  // ---------- sign in with Discord, Google, Microsoft or Apple ----------
  const apiBase = (req: any) => (o.publicUrl || env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const callbackUrl = (req: any, provider: string) => `${apiBase(req)}/api/oauth/${provider}/callback`;
  const oauthCallback = async (req: any, res: any) => {
    const prov = OAUTH[req.params.provider];
    const src = req.method === 'POST' ? req.body || {} : req.query || {};
    const state = String(src.state || '');
    const flow = state && (await q('SELECT *, extract(epoch FROM now() - created_at) AS age FROM v2_oauth_flows WHERE state = $1', [state])).rows[0];
    const back = (msg?: string) => res.redirect(303, `${flow ? flow.return_to : SITE}#/oauth?flow=${encodeURIComponent(state)}${msg ? '&error=' + encodeURIComponent(msg) : ''}`);
    if (!prov || !flow || flow.provider !== prov.id || flow.result || Number(flow.age) > 600) return back('That sign-in link has expired. Try again.');
    const done = (result: string, userId: number | null = null) => q('UPDATE v2_oauth_flows SET result = $1, result_user = $2 WHERE state = $3', [result, userId, state]);
    try {
      if (src.error) throw new Error(src.error === 'access_denied' ? 'You cancelled the sign-in.' : `${prov.name} said no.`);
      const tokens = await exchange(prov, String(src.code || ''), callbackUrl(req, prov.id), flow.verifier);
      const who = await prov.identity(tokens, { nonce: flow.nonce, form: src });
      const linked = (await q('SELECT user_id FROM v2_identities WHERE provider = $1 AND subject = $2', [prov.id, who.sub])).rows[0];
      if (flow.mode === 'link') {
        if (linked && linked.user_id !== flow.user_id) throw new Error(`That ${prov.name} account is already linked to someone else.`);
        if (!linked) await q('INSERT INTO v2_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, provider) DO UPDATE SET subject = EXCLUDED.subject, email = EXCLUDED.email', [prov.id, who.sub, flow.user_id, who.email || null]);
        await done('linked', flow.user_id);
        audit('u' + flow.user_id, 'auth.link.' + prov.id, true);
        return back();
      }
      if (linked) {
        await done('login', linked.user_id);
        return back();
      }
      // a new person: only if sign-ups are open, and never by matching an email to an existing account
      if (!world.flags.openSignup) throw new Error(`No account is linked to that ${prov.name} account. Sign in with your password, then link ${prov.name} from your passport.`);
      const base = String(who.name || who.email?.split('@')[0] || prov.id).toLowerCase().normalize('NFKD').replace(/[^a-z0-9_]/g, '').slice(0, 14) || 'citizen';
      let username = base.length >= 3 ? base : base + 'citizen';
      while ((await q('SELECT 1 FROM users WHERE lower(username) = $1', [username])).rows.length) username = base.slice(0, 14) + Math.floor(1000 + Math.random() * 9000);
      const name = String(who.name || username).replace(/\s+/g, ' ').trim().slice(0, 24) || username;
      const approved = !world.flags.requireApproval;
      const u = (await q('INSERT INTO users (username, display_name, password_hash, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, name, await hash(random(24)), approved])).rows[0];
      await q('INSERT INTO v2_accounts (user_id, no_password) VALUES ($1, TRUE) ON CONFLICT (user_id) DO UPDATE SET no_password = TRUE', [u.id]);
      await q('INSERT INTO v2_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)', [prov.id, who.sub, u.id, who.email || null]);
      await serial(async () => {
        if (approved) addCitizen(world, 'u' + u.id, name, false);
        else world.pending.push({ id: 'su' + u.id, uid: 'u' + u.id, name, userId: u.id, who: `Signed up with ${prov.name}${who.email ? ' as ' + who.email : ''}`, at: world.now });
        await save();
      });
      await done(approved ? 'login' : 'waiting', u.id);
      audit('u' + u.id, 'auth.signup.' + prov.id, true);
      back();
    } catch (e: any) {
      await done('error:' + String(e.message || 'Sign-in failed.').slice(0, 200));
      log('oauth failed', prov.id, e.message);
      back(String(e.message || 'Sign-in failed.'));
    }
  };
  app.get('/api/oauth/:provider/callback', oauthCallback);
  app.post('/api/oauth/:provider/callback', express.urlencoded({ extended: false, limit: '20kb' }), oauthCallback);
  imageGet(app, q);

  // CORS that fails loudly: an unknown origin gets a clear 403 instead of a silent 200 with no header
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const local = o.devOrigins && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (!local && !o.origins.includes(origin)) {
        log(`Refused origin ${origin}. Add it to ALLOWED_ORIGINS.`);
        return res.status(403).json({ error: `Origin ${origin} is not allowed.` });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'X-Realm-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, now: now(), phase: world.phase }));

  app.post('/api/login', async (req, res) => {
    if (limited('login:' + req.ip)) return res.status(429).json({ error: 'Too many attempts from here. Wait a minute.' });
    const { username, password } = req.body || {};
    const pw = String(password || '').slice(0, 200);
    const u = (await q('SELECT * FROM users WHERE lower(username) = lower($1)', [String(username || '').trim().slice(0, 40)])).rows[0];
    if (!u || !u.is_active) {
      await dummyCompare(pw);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    const acc = await account(q, u.id);
    const wait = lockedFor(acc, now());
    if (wait) return res.status(429).json({ error: `Too many wrong passwords. This account is locked for ${Math.ceil(wait / 60_000)} more minutes.` });
    if (acc.no_password || !(await bcrypt.compare(pw, u.password_hash))) {
      const lock = await failed(q, u.id, now());
      audit('u' + u.id, 'auth.login', false, lock ? 'locked' : 'wrong password');
      return res.status(401).json({ error: lock ? `Wrong password. The account is now locked for ${Math.round(lock / 60_000)} minutes.` : acc.no_password ? 'This account signs in with a passkey, Discord, Google, Microsoft or Apple.' : 'Wrong username or password.' });
    }
    if (!u.approved) return res.status(403).json({ error: 'Your account is waiting for the Returning Officer to approve it.' });
    if (needsRehash(u.password_hash)) await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hash(pw), u.id]);
    audit('u' + u.id, 'auth.login', true);
    res.json(await welcome(u, req));
  });

  app.post('/api/signup', async (req, res) => {
    if (limited('signup:' + req.ip, 5)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    // an invitation from the Returning Officer works even with sign-ups closed, and needs no approval
    const invite = req.body?.invite ? String(req.body.invite) : '';
    if (!invite && !world.flags.openSignup) return res.status(403).json({ error: 'Sign-ups are closed. Ask the Returning Officer for an invitation.' });
    const username = String(req.body?.username || '').trim().toLowerCase();
    const name = String(req.body?.display_name || '').replace(/\s+/g, ' ').trim();
    const password = String(req.body?.password || '');
    const whoNote = String(req.body?.who || '').replace(/\s+/g, ' ').trim();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Usernames are 3 to 20 letters, numbers or underscores.' });
    if (name.length < 2 || name.length > 24) return res.status(400).json({ error: 'Give a display name of 2 to 24 characters.' });
    const bad = passwordProblem(password, username);
    if (bad) return res.status(400).json({ error: bad });
    if (!invite && world.flags.requireApproval && (whoNote.length < 2 || whoNote.length > 80)) return res.status(400).json({ error: 'Say who you are in the group chat, so the Returning Officer knows it’s you (2 to 80 characters).' });
    if ((await q('SELECT 1 FROM users WHERE lower(username) = $1', [username])).rows.length) return res.status(409).json({ error: 'That username is taken.' });
    const inv = invite ? await claimInvite(q, invite) : null;
    if (invite && !inv) return res.status(403).json({ error: 'That invitation has been used, has expired, or was revoked. Ask the Returning Officer for a new one.' });
    const approved = !!inv || !world.flags.requireApproval;
    let u: any;
    try {
      u = (await q('INSERT INTO users (username, display_name, password_hash, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, name, await hash(password), approved])).rows[0];
    } catch (e) {
      if (inv) await releaseInvite(q, inv.id);
      throw e;
    }
    if (inv) await useInvite(q, inv.id, u.id);
    await serial(async () => {
      if (approved) addCitizen(world, 'u' + u.id, name, false);
      else world.pending.push({ id: 'su' + u.id, uid: 'u' + u.id, name, userId: u.id, who: whoNote, at: world.now });
      if (inv) gazette(world, 'quiet', `${name} joins by invitation (sent for ${inv.name}).`);
      await save();
    });
    audit('u' + u.id, inv ? 'auth.signup.invite' : 'auth.signup', true);
    res.json(approved ? await welcome(u, req) : { waiting: true });
  });

  // change your password, or set one if you joined with Discord/Google/Microsoft/Apple
  app.post('/api/password', auth, async (req: any, res) => {
    if (limited('pw:' + req.user.id, 5)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const { current, next } = req.body || {};
    const u = (await q('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
    const acc = await account(q, u.id);
    if (!acc.no_password && !(await bcrypt.compare(String(current || ''), u.password_hash))) return res.status(400).json({ error: 'Your current password is wrong.' });
    const bad = passwordProblem(String(next || ''), u.username);
    if (bad) return res.status(400).json({ error: bad });
    await q('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [await hash(String(next)), u.id]);
    await q('UPDATE v2_accounts SET no_password = FALSE WHERE user_id = $1', [u.id]);
    userCache.delete(u.id);
    audit(req.cid, 'auth.password', true);
    res.json({ token: sign({ ...u, token_version: (u.token_version || 0) + 1 }) });
  });

  // sign out of every device, this one gets a fresh token
  app.post('/api/logout-all', auth, async (req: any, res) => {
    const u = (await q('UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING *', [req.user.id])).rows[0];
    userCache.delete(u.id);
    audit(req.cid, 'auth.logout-all', true);
    res.json({ token: sign(u) });
  });

  // your sign-in methods
  app.get('/api/me/security', auth, async (req: any, res) => {
    const acc = await account(q, req.user.id);
    const ids = (await q('SELECT provider, email, created_at FROM v2_identities WHERE user_id = $1 ORDER BY created_at', [req.user.id])).rows;
    const keys = (await q('SELECT id, name, created_at, last_used FROM v2_passkeys WHERE user_id = $1 ORDER BY created_at', [req.user.id])).rows;
    res.json({ username: req.user.username, password: !acc.no_password, lastLogin: acc.last_login, identities: ids, passkeys: keys, providers: Object.values(OAUTH).map((p) => ({ id: p.id, name: p.name })) });
  });
  app.post('/api/oauth/unlink', auth, async (req: any, res) => {
    const acc = await account(q, req.user.id);
    const ids = (await q('SELECT provider FROM v2_identities WHERE user_id = $1', [req.user.id])).rows;
    const keys = (await q('SELECT count(*)::int AS n FROM v2_passkeys WHERE user_id = $1', [req.user.id])).rows[0].n;
    if (acc.no_password && ids.length <= 1 && !keys) return res.status(400).json({ error: 'That is your only way to sign in. Set a password, add a passkey or link another account first.' });
    await q('DELETE FROM v2_identities WHERE user_id = $1 AND provider = $2', [req.user.id, String(req.body?.provider || '')]);
    audit(req.cid, 'auth.unlink.' + req.body?.provider, true);
    res.json({ ok: true });
  });

  app.get('/api/oauth/providers', (_req, res) => res.json(Object.values(OAUTH).map((p) => ({ id: p.id, name: p.name }))));
  // step 1: the site asks for a sign-in link. `browser` is a random value the site keeps in sessionStorage; only
  // the same browser can finish the sign-in, so a stolen or planted link is useless.
  app.post('/api/oauth/begin', async (req: any, res) => {
    if (limited('oauth:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const prov = OAUTH[String(req.body?.provider || '')];
    if (!prov) return res.status(400).json({ error: 'That sign-in option is not set up.' });
    const browser = String(req.body?.browser || '');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(browser)) return res.status(400).json({ error: 'Your browser blocked the sign-in. Allow site storage and try again.' });
    let userId: number | null = null;
    const mode = req.body?.mode === 'link' ? 'link' : 'login';
    if (mode === 'link') {
      try {
        const t: any = jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''), secret, { algorithms: ['HS256'] });
        const u = await loadUser(t.id);
        if (!u || !u.is_active || (u.token_version || 0) !== t.tv) throw new Error();
        userId = u.id;
      } catch {
        return res.status(401).json({ error: 'Sign in first.' });
      }
    }
    const origin = String(req.headers.origin || '');
    const ret = o.origins.includes(origin) || (o.devOrigins && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? (origin === new URL(SITE).origin ? SITE : origin + '/') : SITE;
    const state = random(24), nonce = random(16), verifier = random(48);
    await q("DELETE FROM v2_oauth_flows WHERE created_at < now() - interval '1 day'");
    await q('INSERT INTO v2_oauth_flows (state, provider, mode, user_id, browser, nonce, verifier, return_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [state, prov.id, mode, userId, browser, nonce, verifier, ret]);
    res.json({ url: authorizeUrl(prov, callbackUrl(req, prov.id), state, nonce, verifier) });
  });
  // step 3: back on the site, the same browser swaps the finished flow for a session. Each flow works once.
  app.post('/api/oauth/finish', async (req: any, res) => {
    if (limited('oauth:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const flow = (await q('DELETE FROM v2_oauth_flows WHERE state = $1 RETURNING *, extract(epoch FROM now() - created_at) AS age', [String(req.body?.flow || '')])).rows[0];
    if (!flow || flow.browser !== String(req.body?.browser || '')) return res.status(400).json({ error: 'That sign-in was started in another browser, or has already been used.' });
    if (Number(flow.age) > 900) return res.status(400).json({ error: 'That sign-in expired. Try again.' });
    if (!flow.result || flow.result.startsWith('error:')) return res.status(400).json({ error: flow.result ? flow.result.slice(6) : 'The sign-in did not finish.' });
    if (flow.result === 'linked') return res.json({ linked: flow.provider });
    if (flow.result === 'waiting') return res.json({ waiting: true });
    const u = (await q('SELECT * FROM users WHERE id = $1', [flow.result_user])).rows[0];
    if (!u || !u.is_active) return res.status(403).json({ error: 'That account is not active.' });
    if (!u.approved) return res.json({ waiting: true });
    audit('u' + u.id, 'auth.login.' + flow.provider, true);
    res.json(await welcome(u, req));
  });

  // ---------- passkeys (passkeys.ts) ----------
  passkeys(app, {
    q, now, auth, limited, welcome, audit,
    allowedOrigin: (origin) => o.origins.includes(origin) || (!!o.devOrigins && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)),
    hasPassword: async (id) => !(await account(q, id)).no_password,
    identities: async (id) => (await q('SELECT count(*)::int AS n FROM v2_identities WHERE user_id = $1', [id])).rows[0].n,
  });

  app.get('/api/state', auth, async (req: any, res) => {
    await serial(catchUp);
    schedule();
    res.json({ world: viewFor(world, req.cid), me: req.cid, serverNow: now() });
  });

  app.post('/api/act', auth, async (req: any, res) => {
    const { cmd, args } = req.body || {};
    // admin.duplicate also deactivates a login, so it only runs through its own route
    if (typeof cmd !== 'string' || cmd.startsWith('admin.reset') || cmd === 'admin.duplicate') return res.status(400).json({ error: 'Unknown action.' });
    const bad = await photoProblem(q, req.user.id, args);
    if (bad) return res.status(400).json({ error: bad });
    try {
      await serial(async () => {
        await catchUp();
        const waiting = cmd === 'admin.approve' ? world.pending.find((p: any) => p.id === args?.id) : null;
        world = run(world, req.cid, cmd, args || {});
        // keep the login table in step with the sign-up decision
        if (waiting?.userId) await q(args.approve ? 'UPDATE users SET approved = TRUE WHERE id = $1' : 'UPDATE users SET is_active = FALSE WHERE id = $1', [waiting.userId]);
        if (waiting?.userId) userCache.delete(waiting.userId);
        await save();
      });
      schedule();
      q('INSERT INTO v2_log (actor, cmd, args, ok) VALUES ($1, $2, $3, TRUE)', [req.cid, cmd, JSON.stringify(args || {})]).catch(() => {});
      res.json({ world: viewFor(world, req.cid), me: req.cid, serverNow: now() });
    } catch (e: any) {
      q('INSERT INTO v2_log (actor, cmd, args, ok, error) VALUES ($1, $2, $3, FALSE, $4)', [req.cid, String(cmd), JSON.stringify(args || {}), String(e.message)]).catch(() => {});
      if (e instanceof GameError) return res.status(400).json({ error: e.message });
      log('act failed', cmd, e);
      res.status(500).json({ error: 'Something went wrong on the server. It has been logged.' });
    }
  });

  // personal API keys, managed from the official site only
  app.get('/api/keys', auth, async (req: any, res) => {
    res.json((await q('SELECT k.id, k.name, k.prefix, k.scope, k.created_at, k.last_used, k.app_id, a.homepage FROM v2_api_keys k LEFT JOIN v2_apps a ON a.id = k.app_id WHERE k.user_id = $1 AND NOT k.revoked ORDER BY k.id', [req.user.id])).rows);
  });
  app.post('/api/keys', auth, async (req: any, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    const scope = req.body?.scope === 'act' ? 'act' : 'read';
    if (name.length < 2) return res.status(400).json({ error: 'Name the key after the app that will use it.' });
    const n = (await q('SELECT count(*)::int AS n FROM v2_api_keys WHERE user_id = $1 AND NOT revoked AND app_id IS NULL', [req.user.id])).rows[0].n;
    if (n >= MAX_KEYS) return res.status(400).json({ error: `You can have ${MAX_KEYS} keys. Revoke one first.` });
    const key = newKey();
    const row = (await q('INSERT INTO v2_api_keys (user_id, name, prefix, key_hash, scope) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, prefix, scope, created_at, last_used', [req.user.id, name, key.slice(0, 10), keyHash(key), scope])).rows[0];
    res.json({ ...row, key });
  });
  app.post('/api/keys/revoke', auth, async (req: any, res) => {
    const row = (await q('UPDATE v2_api_keys SET revoked = TRUE WHERE id = $1 AND user_id = $2 RETURNING key_hash', [Number(req.body?.id) || 0, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'No such key.' });
    v1.forgetKey(row.key_hash);
    res.json({ ok: true });
  });

  // your apps, "Sign in with the Realm", and webhooks (first-party site; apps get the same via /api/v1)
  const handle = (fn: (req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      res.json(await fn(req));
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'That did not work.' });
    }
  };
  app.get('/api/apps', auth, handle((req) => A.mine(req.user.id)));
  app.post('/api/apps', auth, handle((req) => A.create(req.user.id, req.body)));
  app.post('/api/apps/update', auth, handle((req) => A.update(req.user.id, req.body)));
  app.post('/api/apps/delete', auth, handle(async (req) => ((await A.remove(req.user.id, Number(req.body?.id) || 0)).forEach((h: string) => v1.forgetKey(h)), { ok: true })));
  app.get('/api/apps/info', auth, handle(async (req) => {
    const a: any = await A.info(String(req.query.app || ''));
    delete a.id;
    return a;
  }));
  app.post('/api/authorize', auth, handle(async (req) => {
    const r = await A.authorize(req.user.id, req.body, newKey);
    r.revoked.forEach((h: string) => v1.forgetKey(h));
    return { redirect: r.redirect };
  }));
  app.get('/api/hooks', auth, handle((req) => A.listHooks(req.user.id)));
  app.post('/api/hooks', auth, handle((req) => A.addHook(req.user.id, req.body?.url, req.body?.kind || 'gazette', (alertsFor(req.user.id) || []).map((a: any) => a.key))));
  app.post('/api/apps/review', auth, handle((req) => A.review(req.user.id, req.body)));
  app.post('/api/apps/unreview', auth, handle((req) => A.unreview(req.user.id, String(req.body?.app || ''))));
  app.post('/api/hooks/delete', auth, handle(async (req) => (await A.removeHook(req.user.id, Number(req.body?.id) || 0), { ok: true })));
  app.post('/api/hooks/test', auth, handle((req) => A.testHook(req.user.id, Number(req.body?.id) || 0, world.config.realmName)));

  // the Returning Officer's tools that sit outside the game
  const admin = (req: any, res: any, next: any) => (req.user?.is_admin ? next() : res.status(403).json({ error: 'Returning Officer only.' }));
  inviteRoutes(app, {
    q, auth, admin, limited,
    announce: (cid, text) => serial(async () => {
      adminDid(world, cid, text);
      await save();
    })
  });
  // a second account for someone who already has one: struck out in the game, and its login switched off
  app.post('/api/admin/duplicate', auth, admin, async (req: any, res) => {
    const dup = String(req.body?.dup || '');
    const keep = String(req.body?.keep || '');
    try {
      await serial(async () => {
        await catchUp();
        world = run(world, req.cid, 'admin.duplicate', { dup, keep });
        const id = /^u\d+$/.test(dup) ? Number(dup.slice(1)) : null;
        if (id) {
          await q('UPDATE users SET is_active = FALSE, token_version = token_version + 1 WHERE id = $1', [id]);
          userCache.delete(id);
          await q('UPDATE v2_api_keys SET revoked = TRUE WHERE user_id = $1', [id]).catch(() => {});
        }
        await save();
      });
      schedule();
      audit(req.cid, 'admin.duplicate', true);
      res.json({ world: viewFor(world, req.cid), me: req.cid, serverNow: now() });
    } catch (e: any) {
      if (e instanceof GameError) return res.status(400).json({ error: e.message });
      log('duplicate failed', e);
      res.status(500).json({ error: 'Something went wrong on the server. It has been logged.' });
    }
  });
  imageRoutes(app, {
    q, auth, admin, limited, audit,
    announce: (cid, owner, reason) => serial(async () => {
      adminDid(world, cid, `took down a photo posted by ${nm(world, owner)}: ${reason}`);
      await save();
    })
  });
  // the export holds every secret in the game, so taking one is announced
  app.get('/api/admin/export', auth, admin, async (req: any, res) => {
    await serial(async () => {
      adminDid(world, req.cid, 'downloaded a full export of the realm, secrets included');
      await save();
    });
    res.json(world);
  });
  // a misbehaving app: out of the directory, no new sign-ins, every key revoked, and the realm is told why
  app.get('/api/admin/apps', auth, admin, handle(() => A.allApps()));
  app.post('/api/admin/apps/remove', auth, admin, handle(async (req) => {
    const r = await A.takeDown(String(req.body?.app || ''), req.body?.reason);
    r.keys.forEach((h: string) => v1.forgetKey(h));
    await serial(async () => {
      adminDid(world, req.cid, `removed the app ${r.name}: ${String(req.body.reason).trim()}`, '#/apps');
      await save();
    });
    return { ok: true, revoked: r.keys.length };
  }));
  app.post('/api/admin/apps/restore', auth, admin, handle(async (req) => {
    const r = await A.restore(String(req.body?.app || ''));
    await serial(async () => {
      adminDid(world, req.cid, `restored the app ${r.name}`, '#/apps');
      await save();
    });
    return { ok: true };
  }));
  // a forgotten password: the RO gets a temporary one to send privately, and the realm sees that it happened
  app.post('/api/admin/password', auth, admin, async (req: any, res) => {
    const cid = String(req.body?.citizen || '');
    const u = (await q('SELECT id, display_name FROM users WHERE id = $1', [Number(cid.replace(/^u/, '')) || 0])).rows[0];
    if (!u) return res.status(404).json({ error: 'No such account.' });
    const temp = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 6)).join('-');
    await q('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [await hash(temp), u.id]);
    await account(q, u.id);
    await q('UPDATE v2_accounts SET failures = 0, locked_until = NULL, no_password = FALSE WHERE user_id = $1', [u.id]);
    userCache.delete(u.id);
    await serial(async () => {
      adminDid(world, req.cid, `reset ${u.display_name}'s password, which would let them sign in as ${u.display_name}`);
      await save();
    });
    res.json({ temp });
  });
  app.post('/api/admin/reset', auth, admin, async (req: any, res) => {
    if (req.body?.confirm !== 'RESET THE REALM') return res.status(400).json({ error: 'Type RESET THE REALM to confirm.' });
    await serial(async () => {
      await q('INSERT INTO v2_snapshots (reason, state) VALUES ($1, $2)', ['before reset', JSON.stringify(world)]);
      const keep = { fame: world.fame, zones: (world.streets?.zones || []).filter((z: any) => z.by === 'ro') };
      world = createLiveWorld(await people(), now(), (now() % 2147483647) | 0);
      // the Hall of Fame outlives every realm, and so do the safety zones the RO added
      if (keep.fame) world.fame = keep.fame;
      world.streets.zones.push(...keep.zones);
      adminDid(world, req.cid, 'reset the realm to a fresh Founding Convention');
      await save();
    });
    schedule();
    log(`Realm reset by ${req.user.username}.`);
    res.json({ world: viewFor(world, req.cid), me: req.cid, serverNow: now() });
  });

  // bad JSON and the like: answer in JSON, with CORS on the public API so other apps can read the error
  app.use((err: any, req: any, res: any, _next: any) => {
    if (req.path.startsWith('/api/v1')) res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'That body is not valid JSON.' : err.type === 'entity.too.large' ? 'That request is too large.' : 'Something went wrong.' });
  });

  return { app, getWorld: () => world, tick: () => serial(catchUp), flush };
}

function addCitizen(w: any, id: string, name: string, admin: boolean) {
  if (w.citizens[id]) return;
  w.citizens[id] = { id, name, party: null, admin, active: true, joinedAt: w.now, influence: 10, seasonEarned: 0, approval: 50, log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [], exiledUntil: null, asylum: null, ambition: null, weekIncome: 0 };
  w.accounts.reserve = (w.accounts.reserve || 0) - 100;
  w.accounts['c:' + id] = 100;
  gazette(w, 'quiet', `${name} becomes a citizen.`);
}
