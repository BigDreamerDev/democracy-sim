// The public API: /api/v1/*. For players building their own apps, bots and frontends.
// Authenticated with personal API keys (never passwords), open to any origin, and given the same
// redacted view of the world the official site gets. Every rule is still enforced by the engine.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { viewFor, run, GameError, CATALOG } from '../engine/index';
import type { Q } from './db';

export type Ctx = {
  q: Q;
  now: () => number;
  log: (...a: any[]) => void;
  world: () => any;
  setWorld: (w: any) => void;
  version: () => number;
  waitForChange: (since: number, ms: number) => Promise<void>;
  serial: <T>(fn: () => Promise<T> | T) => Promise<T>;
  catchUp: () => Promise<any>;
  save: () => Promise<any>;
  schedule: () => void;
  loadUser: (id: number) => Promise<any>;
  apps: any;
};

const hash = (k: string) => createHash('sha256').update(k).digest('hex');
export const newKey = () => 'rlm_' + randomBytes(24).toString('base64url');
export const keyHash = hash;
export const MAX_KEYS = 5;

export function publicApi(c: Ctx) {
  const r = express.Router();
  const keys = new Map<string, any>(); // hash -> key row, cached
  const hits = new Map<string, { n: number; at: number }>();
  (r as any).forgetKey = (h: string) => keys.delete(h);

  // any origin may call this API: keys are sent as a header, never as cookies, so there's nothing ambient to steal
  r.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-None-Match');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Realm-Version, X-RateLimit-Remaining');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // GET /api/v1 needs no key: it says what's here
  r.get('/', (_req, res) =>
    res.json({
      name: 'The Realm API',
      version: 1,
      docs: 'https://github.com/BigDreamerDev/democracy-sim/blob/main/API.md',
      auth: 'Authorization: Bearer rlm_… (make a key on your passport in the app)',
      endpoints: ['GET /api/v1/me', 'GET /api/v1/state', 'GET /api/v1/gazette', 'GET /api/v1/commands', 'GET /api/v1/apps', 'POST /api/v1/act', 'GET|POST /api/v1/hooks', 'POST /api/v1/hooks/delete', 'POST /api/v1/hooks/test'],
      signIn: 'Send players to <site>/#/authorize?app=<client_id>&scope=read|act&state=<anything>; they come back to your redirect with #key=…&scope=…&state=…'
    })
  );
  r.get('/commands', (_req, res) => res.json(CATALOG));
  // the app directory: apps players have made and listed
  r.get('/apps', async (_req, res) => res.json(await c.apps.directory()));

  r.use(async (req: any, res, next) => {
    const k = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!k.startsWith('rlm_')) return res.status(401).json({ error: 'Send an API key: Authorization: Bearer rlm_…' });
    const h = hash(k);
    let row = keys.get(h);
    if (!row) {
      row = (await c.q('SELECT * FROM v2_api_keys WHERE key_hash = $1', [h])).rows[0];
      if (row) keys.set(h, row);
    }
    if (!row || row.revoked) return res.status(401).json({ error: 'That API key is not valid or has been revoked.' });
    const u = await c.loadUser(row.user_id);
    if (!u || !u.is_active || !u.approved) return res.status(401).json({ error: 'That account is not active.' });
    const cid = 'u' + u.id;
    if (!c.world().citizens[cid]) return res.status(403).json({ error: 'You are not a citizen of this realm.' });
    // 120 requests a minute per key; long-polls count once
    const t = hits.get(h);
    if (!t || c.now() - t.at > 60_000) hits.set(h, { n: 1, at: c.now() });
    else if (++t.n > 120) return res.status(429).json({ error: 'Slow down: 120 requests a minute per key.' });
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, 120 - (hits.get(h)!.n || 0))));
    if (!row.last_used || c.now() - new Date(row.last_used).getTime() > 600_000) {
      row.last_used = new Date(c.now());
      c.q('UPDATE v2_api_keys SET last_used = now() WHERE id = $1', [row.id]).catch(() => {});
    }
    req.cid = cid;
    req.key = row;
    next();
  });

  const tagFor = (req: any) => `W/"${c.version()}-${req.cid}"`;
  const reply = (req: any, res: any, body: any) => {
    res.setHeader('ETag', tagFor(req));
    res.setHeader('X-Realm-Version', String(c.version()));
    res.json(body);
  };

  r.get('/me', async (req: any, res) => {
    await c.serial(c.catchUp);
    const w = viewFor(c.world(), req.cid);
    const me = w.citizens[req.cid];
    reply(req, res, { id: req.cid, name: me.name, party: me.party, crowns: w.accounts['c:' + req.cid] || 0, influence: me.influence, approval: me.approval, scope: req.key.scope, keyName: req.key.name });
  });

  // ?since=<version>&wait=<seconds up to 25>: holds the request until something changes (long-poll)
  r.get('/state', async (req: any, res) => {
    const since = Number(req.query.since);
    const wait = Math.min(Math.max(Number(req.query.wait) || 0, 0), 25);
    if (Number.isFinite(since) && wait && since >= c.version()) await c.waitForChange(since, wait * 1000);
    await c.serial(c.catchUp);
    c.schedule();
    if (req.headers['if-none-match'] === tagFor(req)) return res.status(304).end();
    reply(req, res, { world: viewFor(c.world(), req.cid), me: req.cid, serverNow: c.now(), version: c.version() });
  });

  // ?since=<gazette id>&limit=<n up to 100>: the public record, newest first
  r.get('/gazette', async (req: any, res) => {
    await c.serial(c.catchUp);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const all = c.world().gazette;
    const stop = req.query.since ? all.findIndex((g: any) => g.id === req.query.since) : -1;
    reply(req, res, (stop >= 0 ? all.slice(0, stop) : all).slice(0, limit));
  });

  r.post('/act', async (req: any, res) => {
    if (req.key.scope !== 'act') return res.status(403).json({ error: 'This key is read-only. Make a key with the "act" scope.' });
    const { cmd, args } = req.body || {};
    if (typeof cmd !== 'string' || !CATALOG[cmd]) return res.status(400).json({ error: 'Unknown action. GET /api/v1/commands lists them.' });
    try {
      await c.serial(async () => {
        await c.catchUp();
        const top = c.world().gazette[0]?.id;
        const w = run(c.world(), req.cid, cmd, args || {});
        // the bot badge: anything this action put in the Gazette says which app did it
        for (const g of w.gazette) {
          if (g.id === top) break;
          g.via = req.key.name;
        }
        c.setWorld(w);
        await c.save();
      });
      c.schedule();
      c.q('INSERT INTO v2_log (actor, cmd, args, ok) VALUES ($1, $2, $3, TRUE)', [req.cid + ' via ' + req.key.prefix, cmd, JSON.stringify(args || {})]).catch(() => {});
      reply(req, res, { ok: true, world: viewFor(c.world(), req.cid), me: req.cid, serverNow: c.now(), version: c.version() });
    } catch (e: any) {
      c.q('INSERT INTO v2_log (actor, cmd, args, ok, error) VALUES ($1, $2, $3, FALSE, $4)', [req.cid + ' via ' + req.key.prefix, cmd, JSON.stringify(args || {}), String(e.message)]).catch(() => {});
      if (e instanceof GameError) return res.status(400).json({ ok: false, error: e.message });
      c.log('v1 act failed', cmd, e);
      res.status(500).json({ ok: false, error: 'Something went wrong on the server. It has been logged.' });
    }
  });

  // webhooks, for bots that would rather be told than ask
  const wrap = (fn: (req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      res.json(await fn(req));
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'That did not work.' });
    }
  };
  r.get('/hooks', wrap((req) => c.apps.listHooks(req.key.user_id)));
  r.post('/hooks', wrap((req) => c.apps.addHook(req.key.user_id, req.body?.url)));
  r.post('/hooks/delete', wrap(async (req) => (await c.apps.removeHook(req.key.user_id, Number(req.body?.id) || 0), { ok: true })));
  r.post('/hooks/test', wrap((req) => c.apps.testHook(req.key.user_id, Number(req.body?.id) || 0, c.world().config.realmName)));

  r.use((_req, res) => res.status(404).json({ error: 'No such endpoint. GET /api/v1 lists them.' }));
  return r as express.Router & { forgetKey: (h: string) => void };
}
