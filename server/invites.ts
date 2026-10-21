// Invitations: the Returning Officer makes a single-use link for one named person. Signing up with it needs
// no approval and works even while the sign-up page is closed, so the RO can keep sign-ups shut and still let
// friends in, one link each. Only a hash of each code is stored. Making one is announced, like every admin act.
import type { Express } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { Q } from './db';

export const INVITES_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_invites (
  id          BIGSERIAL PRIMARY KEY,
  code_hash   TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  created_by  INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  claimed_at  TIMESTAMPTZ,
  used_by     INT,
  revoked     BOOLEAN DEFAULT FALSE
);
`;
export const INVITE_DAYS = 7;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(randomBytes(20), (b) => ALPHA[b % ALPHA.length]).join('');
export const cleanCode = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

// an invitation still good to use: { id, name } or null
export async function validInvite(q: Q, code: string) {
  const c = cleanCode(code);
  if (c.length < 16) return null;
  return (await q('SELECT id, name FROM v2_invites WHERE code_hash = $1 AND NOT revoked AND used_by IS NULL AND claimed_at IS NULL AND expires_at > now()', [sha(c)])).rows[0] || null;
}
// take it, so two people can't use the same link at once; release it if the sign-up then fails
export async function claimInvite(q: Q, code: string) {
  return (await q('UPDATE v2_invites SET claimed_at = now() WHERE code_hash = $1 AND NOT revoked AND used_by IS NULL AND claimed_at IS NULL AND expires_at > now() RETURNING id, name, created_by', [sha(cleanCode(code))])).rows[0] || null;
}
export const releaseInvite = (q: Q, id: number) => q('UPDATE v2_invites SET claimed_at = NULL WHERE id = $1 AND used_by IS NULL', [id]);
export const useInvite = (q: Q, id: number, userId: number) => q('UPDATE v2_invites SET used_by = $2 WHERE id = $1', [id, userId]);

async function createInvite(q: Q, by: number, name: string) {
  const code = newCode();
  const r = (await q(`INSERT INTO v2_invites (code_hash, name, created_by, expires_at) VALUES ($1, $2, $3, now() + interval '${INVITE_DAYS} days') RETURNING id, expires_at`, [sha(code), name, by])).rows[0];
  return { id: r.id, name, code, expiresAt: r.expires_at };
}
const cleanName = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim();
const openCount = async (q: Q) => (await q('SELECT count(*)::int AS n FROM v2_invites WHERE NOT revoked AND used_by IS NULL AND expires_at > now()')).rows[0].n;
type Deps = { q: Q; auth: any; admin: any; limited: (k: string, n?: number) => boolean; announce: (cid: string, text: string) => Promise<void>; gazette: (text: string) => Promise<void>; allowance: (userId: number) => Promise<number> };
export function inviteRoutes(app: Express, d: Deps) {
  const { q, auth, admin, limited } = d;
  // the sign-in page asks who a link is for, to greet them by name
  app.get('/api/invites/check', async (req: any, res) => {
    if (limited('invcheck:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const inv = await validInvite(q, String(req.query.code || ''));
    if (!inv) return res.status(404).json({ error: 'That invitation has been used, has expired, or was never real. Ask the Returning Officer for a new one.' });
    res.json({ name: inv.name });
  });
  app.get('/api/admin/invites', auth, admin, async (_req: any, res) => {
    const rows = (await q('SELECT i.id, i.name, i.created_at, i.expires_at, i.used_by, i.revoked, u.display_name AS used_name FROM v2_invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 60')).rows;
    res.json(rows.map((r: any) => ({ id: r.id, name: r.name, createdAt: r.created_at, expiresAt: r.expires_at, status: r.revoked ? 'revoked' : r.used_by ? 'used' : new Date(r.expires_at).getTime() < Date.now() ? 'expired' : 'open', usedBy: r.used_by ? 'u' + r.used_by : null, usedName: r.used_name || null })));
  });
  // one name, or a batch: { names: [...] } gives one link each
  app.post('/api/admin/invites', auth, admin, async (req: any, res) => {
    const names = (Array.isArray(req.body?.names) ? req.body.names : [req.body?.name]).map(cleanName).filter(Boolean);
    if (!names.length) return res.status(400).json({ error: 'Say who it’s for.' });
    if (names.length > 30) return res.status(400).json({ error: 'Up to 30 names at once.' });
    if (names.some((n: string) => n.length < 2 || n.length > 40)) return res.status(400).json({ error: 'Each name is 2 to 40 characters.' });
    if ((await openCount(q)) + names.length > 60) return res.status(400).json({ error: 'That would be more than 60 invitations waiting. Revoke some first.' });
    const made = [];
    for (const n of names) made.push(await createInvite(q, req.user.id, n));
    await d.announce(req.cid, made.length === 1 ? `made an invitation for ${made[0].name}` : `made invitations for ${made.map((m) => m.name).join(', ')}`);
    res.json(req.body?.names ? { invites: made } : made[0]);
  });
  // trusted players send invitations from their allowance; the Gazette says who invited whom
  app.get('/api/invites', auth, async (req: any, res) => {
    const rows = (await q('SELECT i.id, i.name, i.created_at, i.expires_at, i.used_by, i.revoked, u.display_name AS used_name FROM v2_invites i LEFT JOIN users u ON u.id = i.used_by WHERE i.created_by = $1 ORDER BY i.created_at DESC LIMIT 30', [req.user.id])).rows;
    res.json({ left: await d.allowance(req.user.id), invites: rows.map((r: any) => ({ id: r.id, name: r.name, expiresAt: r.expires_at, status: r.revoked ? 'revoked' : r.used_by ? 'used' : new Date(r.expires_at).getTime() < Date.now() ? 'expired' : 'open', usedName: r.used_name || null })) });
  });
  app.post('/api/invites', auth, async (req: any, res) => {
    if (limited('invmake:' + req.user.id, 5)) return res.status(429).json({ error: 'Too many at once. Wait a minute.' });
    const name = cleanName(req.body?.name);
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Say who it’s for: 2 to 40 characters.' });
    const took = (await q('UPDATE v2_invite_allowance SET n = n - 1 WHERE user_id = $1 AND n > 0 RETURNING n', [req.user.id])).rows[0];
    if (!took) return res.status(403).json({ error: 'You have no invitations to send. The Returning Officer gives them to trusted players.' });
    const inv = await createInvite(q, req.user.id, name);
    await d.gazette(`${req.user.display_name} sends an invitation to ${name}.`);
    res.json({ ...inv, left: took.n });
  });
  app.post('/api/admin/invites/revoke', auth, admin, async (req: any, res) => {
    const r = await q('UPDATE v2_invites SET revoked = TRUE WHERE id = $1 AND used_by IS NULL AND NOT revoked RETURNING name', [Number(req.body?.id) || 0]);
    if (!r.rows.length) return res.status(404).json({ error: 'That invitation is already used or revoked.' });
    await d.announce(req.cid, `revoked the invitation for ${r.rows[0].name}`);
    res.json({ ok: true });
  });
}
