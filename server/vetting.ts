// Vetting citizens: the Returning Officer's private notes, a same-device hint, and how many invitations each
// trusted player may send. None of this is in the world: it never reaches other players.
//
// The device hint: each browser keeps a random id (localStorage) and sends it as X-Realm-Device. Only its hash
// is stored. It's a hint, not proof: clearing the browser gives a new id, and siblings can share a laptop.
import type { Express } from 'express';
import { createHash } from 'node:crypto';
import type { Q } from './db';

export const VETTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_devices (
  user_id     INT NOT NULL,
  device_hash TEXT NOT NULL,
  first_seen  TIMESTAMPTZ DEFAULT now(),
  last_seen   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, device_hash)
);
CREATE INDEX IF NOT EXISTS v2_devices_hash ON v2_devices (device_hash);
CREATE TABLE IF NOT EXISTS v2_notes (
  subject     TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS v2_invite_allowance (
  user_id     INT PRIMARY KEY,
  n           INT NOT NULL DEFAULT 0
);
`;
const sha = (s: string) => createHash('sha256').update('realm-device:' + s).digest('hex');
export const deviceOf = (req: any) => {
  const d = String(req.headers['x-realm-device'] || '');
  return /^[a-z0-9]{16,64}$/.test(d) ? d : '';
};
export async function recordDevice(q: Q, userId: number, req: any) {
  const d = deviceOf(req);
  if (!d) return;
  await q('INSERT INTO v2_devices (user_id, device_hash) VALUES ($1, $2) ON CONFLICT (user_id, device_hash) DO UPDATE SET last_seen = now()', [userId, sha(d)]).catch(() => {});
}
// other accounts that have been used in this browser
export async function sameDevice(q: Q, userId: number, req: any): Promise<{ id: number; name: string }[]> {
  const d = deviceOf(req);
  if (!d) return [];
  return (await q('SELECT u.id, u.display_name AS name FROM v2_devices v JOIN users u ON u.id = v.user_id WHERE v.device_hash = $1 AND v.user_id <> $2', [sha(d), userId])).rows;
}
export const allowanceOf = async (q: Q, userId: number) => (await q('SELECT n FROM v2_invite_allowance WHERE user_id = $1', [userId])).rows[0]?.n || 0;

type Deps = { q: Q; auth: any; admin: any; announce: (cid: string, text: string) => Promise<void>; name: (cid: string) => string };
export function vettingRoutes(app: Express, d: Deps) {
  const { q, auth, admin } = d;
  app.get('/api/admin/notes', auth, admin, async (_req, res) => {
    const out: Record<string, string> = {};
    (await q('SELECT subject, text FROM v2_notes')).rows.forEach((r: any) => (out[r.subject] = r.text));
    res.json(out);
  });
  // private to the RO, so not announced: it changes nothing in the game
  app.post('/api/admin/notes', auth, admin, async (req: any, res) => {
    const subject = String(req.body?.citizen || '');
    if (!/^u\d+$/.test(subject)) return res.status(400).json({ error: 'Pick a citizen or an application.' });
    const text = String(req.body?.text || '').trim().slice(0, 500);
    if (text) await q('INSERT INTO v2_notes (subject, text) VALUES ($1, $2) ON CONFLICT (subject) DO UPDATE SET text = $2, updated_at = now()', [subject, text]);
    else await q('DELETE FROM v2_notes WHERE subject = $1', [subject]);
    res.json({ ok: true });
  });
  // accounts that have shared a browser
  app.get('/api/admin/devices', auth, admin, async (_req, res) => {
    const rows = (await q('SELECT v.device_hash, u.id, u.display_name AS name, u.is_active, v.last_seen FROM v2_devices v JOIN users u ON u.id = v.user_id WHERE v.device_hash IN (SELECT device_hash FROM v2_devices GROUP BY device_hash HAVING count(*) > 1) ORDER BY v.device_hash, u.id')).rows;
    const groups = new Map<string, any[]>();
    rows.forEach((r: any) => groups.set(r.device_hash, [...(groups.get(r.device_hash) || []), { id: 'u' + r.id, name: r.name, active: r.is_active, lastSeen: r.last_seen }]));
    res.json([...groups.values()].map((users, i) => ({ device: i + 1, users })));
  });
  // trusted players: how many invitations each may send. Announced.
  app.get('/api/admin/allowances', auth, admin, async (_req, res) => {
    const out: Record<string, number> = {};
    (await q('SELECT user_id, n FROM v2_invite_allowance WHERE n > 0')).rows.forEach((r: any) => (out['u' + r.user_id] = r.n));
    res.json(out);
  });
  app.post('/api/admin/invites/allow', auth, admin, async (req: any, res) => {
    const cid = String(req.body?.citizen || '');
    const n = Math.round(Number(req.body?.n));
    if (!/^u\d+$/.test(cid)) return res.status(400).json({ error: 'Pick a citizen.' });
    if (!(n >= 0 && n <= 10)) return res.status(400).json({ error: 'Between 0 and 10 invitations.' });
    await q('INSERT INTO v2_invite_allowance (user_id, n) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET n = $2', [Number(cid.slice(1)), n]);
    await d.announce(req.cid, n ? `let ${d.name(cid)} invite up to ${n} more ${n === 1 ? 'person' : 'people'}` : `took away ${d.name(cid)}'s invitations`);
    res.json({ ok: true });
  });
}
