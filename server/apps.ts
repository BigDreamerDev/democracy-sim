// Players' apps: registering an app, "Sign in with the Realm" (consent → a key handed back to the app),
// the public app directory, and webhooks that push every new Gazette entry to a URL.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Q } from './db';

export const MAX_APPS = 3;
export const MAX_HOOKS = 3;
const hash = (k: string) => createHash('sha256').update(k).digest('hex');

export const APPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_apps (
  id          BIGSERIAL PRIMARY KEY,
  client_id   TEXT UNIQUE NOT NULL,
  user_id     INT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  homepage    TEXT NOT NULL DEFAULT '',
  redirect    TEXT NOT NULL DEFAULT '',
  listed      BOOLEAN DEFAULT TRUE,
  deleted     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE v2_api_keys ADD COLUMN IF NOT EXISTS app_id BIGINT;
CREATE TABLE IF NOT EXISTS v2_hooks (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  failures    INT DEFAULT 0,
  last_status TEXT,
  last_at     TIMESTAMPTZ,
  disabled    BOOLEAN DEFAULT FALSE,
  deleted     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);
`;

// ---------- URLs from players are untrusted ----------
export function checkUrl(raw: string, { https = true } = {}): string {
  let u: URL;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new Error('That is not a web address.');
  }
  if (https && u.protocol !== 'https:') throw new Error('Use an https:// address.');
  if (!https && !['https:', 'http:'].includes(u.protocol)) throw new Error('Use an http(s):// address.');
  if (u.username || u.password) throw new Error('No passwords in the address, please.');
  if (u.href.length > 300) throw new Error('That address is too long.');
  return u.href;
}
// redirect addresses may be http://localhost so people can develop on their own machine
export function checkRedirect(raw: string) {
  const href = checkUrl(raw, { https: false });
  const u = new URL(href);
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('Redirects must be https://, or http://localhost while developing.');
  if (u.hash) throw new Error('Leave the #part off the redirect address.');
  return href;
}
const privateIp = (ip: string) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith('::ffff:');
// webhooks are fetched by the server, so never let one point inside Render's network
async function safeToCall(url: string) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) return false;
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  return ips.length > 0 && !ips.some(privateIp);
}

export type Sender = (url: string, body: string, headers: Record<string, string>) => Promise<number>;
export const defaultSender: Sender = async (url, body, headers) => {
  if (!(await safeToCall(url))) throw new Error('address not allowed');
  const r = await fetch(url, { method: 'POST', body, headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  return r.status;
};

export function apps(q: Q, log: (...a: any[]) => void, send: Sender = defaultSender) {
  // ---------- the app registry ----------
  const view = (a: any) => ({ id: a.id, client_id: a.client_id, name: a.name, description: a.description, homepage: a.homepage, redirect: a.redirect, listed: a.listed, created_at: a.created_at });
  async function create(userId: number, b: any) {
    const name = String(b?.name || '').trim().slice(0, 40);
    if (name.length < 2) throw new Error('Name your app.');
    const description = String(b?.description || '').trim().slice(0, 280);
    const homepage = b?.homepage ? checkUrl(b.homepage, { https: false }) : '';
    const redirect = b?.redirect ? checkRedirect(b.redirect) : '';
    const n = (await q('SELECT count(*)::int AS n FROM v2_apps WHERE user_id = $1 AND NOT deleted', [userId])).rows[0].n;
    if (n >= MAX_APPS) throw new Error(`You can register ${MAX_APPS} apps. Delete one first.`);
    const client_id = 'app_' + randomBytes(9).toString('base64url');
    return view((await q('INSERT INTO v2_apps (client_id, user_id, name, description, homepage, redirect, listed) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [client_id, userId, name, description, homepage, redirect, b?.listed !== false])).rows[0]);
  }
  async function update(userId: number, b: any) {
    const a = (await q('SELECT * FROM v2_apps WHERE id = $1 AND user_id = $2 AND NOT deleted', [Number(b?.id) || 0, userId])).rows[0];
    if (!a) throw new Error('No such app.');
    const next = {
      name: b.name !== undefined ? String(b.name).trim().slice(0, 40) : a.name,
      description: b.description !== undefined ? String(b.description).trim().slice(0, 280) : a.description,
      homepage: b.homepage !== undefined ? (b.homepage ? checkUrl(b.homepage, { https: false }) : '') : a.homepage,
      redirect: b.redirect !== undefined ? (b.redirect ? checkRedirect(b.redirect) : '') : a.redirect,
      listed: b.listed !== undefined ? !!b.listed : a.listed
    };
    if (next.name.length < 2) throw new Error('Name your app.');
    return view((await q('UPDATE v2_apps SET name=$1, description=$2, homepage=$3, redirect=$4, listed=$5 WHERE id=$6 RETURNING *', [next.name, next.description, next.homepage, next.redirect, next.listed, a.id])).rows[0]);
  }
  async function remove(userId: number, id: number) {
    const a = (await q('UPDATE v2_apps SET deleted = TRUE WHERE id = $1 AND user_id = $2 AND NOT deleted RETURNING id', [id, userId])).rows[0];
    if (!a) throw new Error('No such app.');
    // everyone who signed in with it loses its key
    return (await q('UPDATE v2_api_keys SET revoked = TRUE WHERE app_id = $1 AND NOT revoked RETURNING key_hash', [a.id])).rows.map((r: any) => r.key_hash);
  }
  const mine = async (userId: number) => (await q('SELECT a.*, (SELECT count(*)::int FROM v2_api_keys k WHERE k.app_id = a.id AND NOT k.revoked) AS users FROM v2_apps a WHERE user_id = $1 AND NOT deleted ORDER BY id', [userId])).rows.map((a: any) => ({ ...view(a), users: a.users }));
  const directory = async () =>
    (await q(`SELECT a.client_id, a.name, a.description, a.homepage, a.created_at, u.display_name AS by,
      (SELECT count(*)::int FROM v2_api_keys k WHERE k.app_id = a.id AND NOT k.revoked) AS users
      FROM v2_apps a JOIN users u ON u.id = a.user_id WHERE a.listed AND NOT a.deleted ORDER BY users DESC, a.id`)).rows;

  // ---------- Sign in with the Realm ----------
  async function info(clientId: string) {
    const a = (await q('SELECT a.*, u.display_name AS by FROM v2_apps a JOIN users u ON u.id = a.user_id WHERE client_id = $1 AND NOT deleted', [String(clientId || '')])).rows[0];
    if (!a) throw new Error('That app does not exist, or its maker deleted it.');
    return { client_id: a.client_id, name: a.name, description: a.description, homepage: a.homepage, by: a.by, redirect: a.redirect, id: a.id };
  }
  // the player said yes: make (or replace) this app's key for them and send them back with it
  async function authorize(userId: number, b: any, newKey: () => string) {
    const a = await info(b?.app);
    if (!a.redirect) throw new Error('This app has no redirect address set, so it cannot sign people in.');
    if (b.redirect && b.redirect !== a.redirect) throw new Error('That redirect address does not match the one the app registered.');
    const scope = b.scope === 'act' ? 'act' : 'read';
    const old = (await q('UPDATE v2_api_keys SET revoked = TRUE WHERE user_id = $1 AND app_id = $2 AND NOT revoked RETURNING key_hash', [userId, a.id])).rows.map((r: any) => r.key_hash);
    const key = newKey();
    await q('INSERT INTO v2_api_keys (user_id, name, prefix, key_hash, scope, app_id) VALUES ($1,$2,$3,$4,$5,$6)', [userId, a.name, key.slice(0, 10), hash(key), scope, a.id]);
    const state = String(b.state || '').slice(0, 200);
    const back = a.redirect + '#' + new URLSearchParams({ key, scope, ...(state ? { state } : {}) }).toString();
    return { redirect: back, revoked: old };
  }

  // ---------- webhooks ----------
  const hookView = (h: any) => ({ id: h.id, url: h.url, failures: h.failures, last_status: h.last_status, last_at: h.last_at, disabled: h.disabled, created_at: h.created_at });
  async function addHook(userId: number, url: string) {
    const href = checkUrl(url);
    const n = (await q('SELECT count(*)::int AS n FROM v2_hooks WHERE user_id = $1 AND NOT deleted', [userId])).rows[0].n;
    if (n >= MAX_HOOKS) throw new Error(`You can have ${MAX_HOOKS} webhooks. Delete one first.`);
    const secret = 'whsec_' + randomBytes(18).toString('base64url');
    const h = (await q('INSERT INTO v2_hooks (user_id, url, secret) VALUES ($1,$2,$3) RETURNING *', [userId, href, secret])).rows[0];
    return { ...hookView(h), secret };
  }
  const listHooks = async (userId: number) => (await q('SELECT * FROM v2_hooks WHERE user_id = $1 AND NOT deleted ORDER BY id', [userId])).rows.map(hookView);
  async function removeHook(userId: number, id: number) {
    if (!(await q('UPDATE v2_hooks SET deleted = TRUE WHERE id = $1 AND user_id = $2 AND NOT deleted RETURNING id', [id, userId])).rows[0]) throw new Error('No such webhook.');
  }
  async function deliver(h: any, payload: any) {
    const body = JSON.stringify(payload);
    const sig = 'sha256=' + createHmac('sha256', h.secret).update(body).digest('hex');
    let status = 'error';
    let ok = false;
    try {
      const code = await send(h.url, body, { 'Content-Type': 'application/json', 'User-Agent': 'TheRealm-Webhook/1', 'X-Realm-Event': payload.event, 'X-Realm-Signature': sig, 'X-Realm-Delivery': randomBytes(8).toString('hex') });
      status = String(code);
      ok = code >= 200 && code < 300;
    } catch (e: any) {
      status = 'error: ' + String(e.message || e).slice(0, 80);
    }
    // 20 failures in a row switches a hook off; one success resets the count
    await q('UPDATE v2_hooks SET last_status = $1, last_at = now(), failures = CASE WHEN $2 THEN 0 ELSE failures + 1 END, disabled = CASE WHEN $2 THEN FALSE ELSE failures + 1 >= 20 END WHERE id = $3', [status, ok, h.id]).catch(() => {});
    return { ok, status };
  }
  async function testHook(userId: number, id: number, realm: string) {
    const h = (await q('SELECT * FROM v2_hooks WHERE id = $1 AND user_id = $2 AND NOT deleted', [id, userId])).rows[0];
    if (!h) throw new Error('No such webhook.');
    return deliver(h, { event: 'ping', realm, sentAt: Date.now(), entries: [] });
  }
  // called after every save with the Gazette entries that are new since the last call
  async function broadcast(entries: any[], realm: string, version: number) {
    if (!entries.length) return;
    const hooks = (await q('SELECT * FROM v2_hooks WHERE NOT deleted AND NOT disabled')).rows;
    const payload = { event: 'gazette', realm, version, sentAt: Date.now(), entries: entries.map((g) => ({ id: g.id, at: g.at, kind: g.kind, text: g.text, link: g.link, via: g.via || null })) };
    await Promise.all(hooks.map((h: any) => deliver(h, payload)));
  }

  return { create, update, remove, mine, directory, info, authorize, addHook, listHooks, removeHook, testHook, broadcast };
}
