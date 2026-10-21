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
  return (await q('UPDATE v2_invites SET claimed_at = now() WHERE code_hash = $1 AND NOT revoked AND used_by IS NULL AND claimed_at IS NULL AND expires_at > now() RETURNING id, name', [sha(cleanCode(code))])).rows[0] || null;
}
export const releaseInvite = (q: Q, id: number) => q('UPDATE v2_invites SET claimed_at = NULL WHERE id = $1 AND used_by IS NULL', [id]);
export const useInvite = (q: Q, id: number, userId: number) => q('UPDATE v2_invites SET used_by = $2 WHERE id = $1', [id, userId]);

type Deps = { q: Q; auth: any; admin: any; limited: (k: string, n?: number) => boolean; announce: (cid: string, text: string) => Promise<void> };
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
  app.post('/api/admin/invites', auth, admin, async (req: any, res) => {
    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Say who it’s for: 2 to 40 characters.' });
    const open = (await q("SELECT count(*)::int AS n FROM v2_invites WHERE NOT revoked AND used_by IS NULL AND expires_at > now()")).rows[0].n;
    if (open >= 40) return res.status(400).json({ error: 'You have 40 invitations waiting. Revoke some first.' });
    const code = newCode();
    const r = (await q(`INSERT INTO v2_invites (code_hash, name, created_by, expires_at) VALUES ($1, $2, $3, now() + interval '${INVITE_DAYS} days') RETURNING id, expires_at`, [sha(code), name, req.user.id])).rows[0];
    await d.announce(req.cid, `made an invitation for ${name}`);
    res.json({ id: r.id, name, code, expiresAt: r.expires_at });
  });
  app.post('/api/admin/invites/revoke', auth, admin, async (req: any, res) => {
    const r = await q('UPDATE v2_invites SET revoked = TRUE WHERE id = $1 AND used_by IS NULL AND NOT revoked RETURNING name', [Number(req.body?.id) || 0]);
    if (!r.rows.length) return res.status(404).json({ error: 'That invitation is already used or revoked.' });
    await d.announce(req.cid, `revoked the invitation for ${r.rows[0].name}`);
    res.json({ ok: true });
  });
}
