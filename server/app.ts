// The Realm API. The whole game is one JSON world held in memory, saved to Postgres after every change,
// and advanced to the real clock before every read or write. Players only ever receive their own view of it.
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Q, SCHEMA } from './db';
import { run, viewFor, advanceTo, nextDeadline, createLiveWorld, GameError, gazette, migrate } from '../engine/index';

export type Options = { q: Q; secret: string; origins: string[]; now?: () => number; log?: (...a: any[]) => void };

export async function makeApp(o: Options) {
  const { q, secret } = o;
  const now = o.now || (() => Date.now());
  const log = o.log || ((...a: any[]) => console.log('[realm]', ...a));
  await q(SCHEMA);

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
  const save = () => q('UPDATE v2_world SET state = $1, version = version + 1, updated_at = now() WHERE id = 1', [JSON.stringify(world)]);

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

  // the Returning Officer's tools that sit outside the game
  const admin = (req: any, res: any, next: any) => (req.user?.is_admin ? next() : res.status(403).json({ error: 'Returning Officer only.' }));
  app.get('/api/admin/export', auth, admin, (_req, res) => res.json(world));
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

  return { app, getWorld: () => world, tick: () => serial(catchUp) };
}

function addCitizen(w: any, id: string, name: string, admin: boolean) {
  if (w.citizens[id]) return;
  w.citizens[id] = { id, name, party: null, admin, active: true, joinedAt: w.now, influence: 10, seasonEarned: 0, approval: 50, log: [], stamps: [], titles: [], censures: 0, stats: {}, whip: { loyal: 0, rebel: 0 }, week: {}, objectives: [], exiledUntil: null, asylum: null, ambition: null, weekIncome: 0 };
  w.accounts.reserve = (w.accounts.reserve || 0) - 100;
  w.accounts['c:' + id] = 100;
  gazette(w, 'quiet', `${name} becomes a citizen.`);
}
