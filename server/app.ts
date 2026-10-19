// The Realm API. The whole game is one JSON world held in memory, saved to Postgres after every change,
// and advanced to the real clock before every read or write. Players only ever receive their own view of it.
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Q, SCHEMA } from './db';
import { publicApi, newKey, keyHash, MAX_KEYS } from './public';
import { apps, APPS_SCHEMA, Sender } from './apps';
import { run, viewFor, advanceTo, nextDeadline, createLiveWorld, GameError, gazette, migrate, needs } from '../engine/index';

export type Options = { q: Q; secret: string; origins: string[]; now?: () => number; log?: (...a: any[]) => void; send?: Sender; site?: string };

export async function makeApp(o: Options) {
  const { q, secret } = o;
  const now = o.now || (() => Date.now());
  const log = o.log || ((...a: any[]) => console.log('[realm]', ...a));
  await q(SCHEMA);
  await q(APPS_SCHEMA);
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
  const save = async () => {
    await q('UPDATE v2_world SET state = $1, version = version + 1, updated_at = now() WHERE id = 1', [JSON.stringify(world)]);
    version++;
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
  const sign = (u: any) => jwt.sign({ id: u.id, tv: u.token_version || 0 }, secret, { expiresIn: '60d' });
  const userCache = new Map<number, any>();
  const loadUser = async (id: number) => {
    const u = (await q('SELECT id, username, display_name, is_admin, is_active, approved, token_version FROM users WHERE id = $1', [id])).rows[0];
    if (u) userCache.set(id, u);
    return u;
  };
  const auth = async (req: any, res: any, next: any) => {
    const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
    try {
      const p: any = jwt.verify(t, secret);
      const u = userCache.get(p.id) || (await loadUser(p.id));
      if (!u || !u.is_active || !u.approved || (u.token_version || 0) !== p.tv) return res.status(401).json({ error: 'Please sign in again.' });
      req.user = u;
      req.cid = 'u' + u.id;
      if (!world.citizens[req.cid]) return res.status(403).json({ error: 'You are not a citizen of this realm yet. Ask the Returning Officer.' });
      next();
    } catch {
      res.status(401).json({ error: 'Please sign in.' });
    }
  };
  const tries = new Map<string, { n: number; at: number }>();
  const limited = (key: string) => {
    const t = tries.get(key);
    if (!t || now() - t.at > 60_000) {
      tries.set(key, { n: 1, at: now() });
      return false;
    }
    t.n++;
    return t.n > 10;
  };

  // ---------- app ----------
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));
  // the public API for players' own apps: any origin, API keys only (see public.ts and API.md)
  const v1 = publicApi({ q, now, log, world: () => world, setWorld: (w) => (world = w), version: () => version, waitForChange, serial, catchUp, save, schedule, apps: A, alertsFor, loadUser: async (id) => userCache.get(id) || loadUser(id) });
  app.use('/api/v1', v1);
  // CORS that fails loudly: an unknown origin gets a clear 403 instead of a silent 200 with no header
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!o.origins.includes(origin)) {
        log(`Refused origin ${origin}. Add it to ALLOWED_ORIGINS.`);
        return res.status(403).json({ error: `Origin ${origin} is not allowed.` });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, now: now(), phase: world.phase }));

  app.post('/api/login', async (req, res) => {
    if (limited('login:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const { username, password } = req.body || {};
    const u = (await q('SELECT * FROM users WHERE lower(username) = lower($1)', [String(username || '').trim()])).rows[0];
    if (!u || !u.is_active || !(await bcrypt.compare(String(password || ''), u.password_hash))) return res.status(401).json({ error: 'Wrong username or password.' });
    if (!u.approved) return res.status(403).json({ error: 'Your account is waiting for the Returning Officer to approve it.' });
    userCache.set(u.id, u);
    const cid = 'u' + u.id;
    if (!world.citizens[cid])
      await serial(async () => {
        addCitizen(world, cid, u.display_name, !!u.is_admin);
        await save();
      });
    res.json({ token: sign(u), me: cid });
  });

  app.post('/api/signup', async (req, res) => {
    if (limited('signup:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    if (!world.flags.openSignup) return res.status(403).json({ error: 'Sign-ups are closed. Ask the Returning Officer.' });
    const username = String(req.body?.username || '').trim().toLowerCase();
    const name = String(req.body?.display_name || '').trim();
    const password = String(req.body?.password || '');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Usernames are 3 to 20 letters, numbers or underscores.' });
    if (name.length < 2 || name.length > 24) return res.status(400).json({ error: 'Give a display name of 2 to 24 characters.' });
    if (password.length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    if ((await q('SELECT 1 FROM users WHERE lower(username) = $1', [username])).rows.length) return res.status(409).json({ error: 'That username is taken.' });
    const approved = !world.flags.requireApproval;
    const u = (await q('INSERT INTO users (username, display_name, password_hash, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, name, await bcrypt.hash(password, 10), approved])).rows[0];
    await serial(async () => {
      if (approved) addCitizen(world, 'u' + u.id, name, false);
      else world.pending.push({ id: 'su' + u.id, uid: 'u' + u.id, name, userId: u.id });
      await save();
    });
    res.json(approved ? { token: sign(u), me: 'u' + u.id } : { waiting: true });
  });

  app.post('/api/password', auth, async (req: any, res) => {
    const { current, next } = req.body || {};
    const u = (await q('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!(await bcrypt.compare(String(current || ''), u.password_hash))) return res.status(400).json({ error: 'Your current password is wrong.' });
    if (String(next || '').length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    await q('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [await bcrypt.hash(String(next), 10), u.id]);
    userCache.delete(u.id);
    res.json({ token: sign({ ...u, token_version: (u.token_version || 0) + 1 }) });
  });

  app.get('/api/state', auth, async (req: any, res) => {
    await serial(catchUp);
    schedule();
    res.json({ world: viewFor(world, req.cid), me: req.cid, serverNow: now() });
  });

  app.post('/api/act', auth, async (req: any, res) => {
    const { cmd, args } = req.body || {};
    if (typeof cmd !== 'string' || cmd.startsWith('admin.reset')) return res.status(400).json({ error: 'Unknown action.' });
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
  app.get('/api/admin/export', auth, admin, (_req, res) => res.json(world));
  // a misbehaving app: out of the directory, no new sign-ins, every key revoked, and the realm is told why
  app.get('/api/admin/apps', auth, admin, handle(() => A.allApps()));
  app.post('/api/admin/apps/remove', auth, admin, handle(async (req) => {
    const r = await A.takeDown(String(req.body?.app || ''), req.body?.reason);
    r.keys.forEach((h: string) => v1.forgetKey(h));
    await serial(async () => {
      world.adminLog.unshift({ at: now(), by: req.cid, text: `Removed the app ${r.name}: ${String(req.body.reason).trim()}` });
      gazette(world, 'quiet', `The Returning Officer removed the app ${r.name}: ${String(req.body.reason).trim()}`);
      await save();
    });
    return { ok: true, revoked: r.keys.length };
  }));
  app.post('/api/admin/apps/restore', auth, admin, handle(async (req) => {
    const r = await A.restore(String(req.body?.app || ''));
    await serial(async () => {
      world.adminLog.unshift({ at: now(), by: req.cid, text: `Restored the app ${r.name}` });
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
    await q('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [await bcrypt.hash(temp, 10), u.id]);
    userCache.delete(u.id);
    await serial(async () => {
      world.adminLog.unshift({ at: now(), by: req.cid, text: `Reset ${u.display_name}'s password` });
      gazette(world, 'quiet', `The Returning Officer reset ${u.display_name}'s password at their request.`);
      await save();
    });
    res.json({ temp });
  });
  app.post('/api/admin/reset', auth, admin, async (req: any, res) => {
    if (req.body?.confirm !== 'RESET THE REALM') return res.status(400).json({ error: 'Type RESET THE REALM to confirm.' });
    await serial(async () => {
      await q('INSERT INTO v2_snapshots (reason, state) VALUES ($1, $2)', ['before reset', JSON.stringify(world)]);
      world = createLiveWorld(await people(), now(), (now() % 2147483647) | 0);
      world.adminLog.unshift({ at: now(), by: req.cid, text: 'Reset the realm to a fresh Founding Convention' });
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

  return { app, getWorld: () => world, tick: () => serial(catchUp) };
}

function addCitizen(w: any, id: string, name: string, admin: boolean) {
  if (w.citizens[id]) return;
  w.citizens[id] = { id, name, party: null, admin, active: true, joinedAt: w.now, influence: 10, seasonEarned: 0, approval: 50, log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [], exiledUntil: null, asylum: null, ambition: null, weekIncome: 0 };
  w.accounts.reserve = (w.accounts.reserve || 0) - 100;
  w.accounts['c:' + id] = 100;
  gazette(w, 'quiet', `${name} becomes a citizen.`);
}
