// Photos for stories and finished bounties. The site shrinks each one to a small JPEG before upload; the server
// checks it really is a JPEG, strips every metadata block (so no GPS location or camera details survive), and
// keeps it in Postgres. The world only ever holds the photo's id. Ids are 120 random bits, so a photo can't be
// guessed, and GET needs no sign-in because <img> tags can't send one.
import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import type { Q } from './db';

export const IMAGES_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_images (
  id          TEXT PRIMARY KEY,
  user_id     INT NOT NULL,
  data        BYTEA NOT NULL,
  bytes       INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  removed     TEXT
);
CREATE INDEX IF NOT EXISTS v2_images_user ON v2_images (user_id);
`;
export const MAX_BYTES = 140_000;
export const MAX_PER_USER = 25;
const ID = /^im[a-z0-9]{24}$/;
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
const newId = () => 'im' + Array.from(randomBytes(24), (b) => ALPHA[b % 36]).join('');

// keep only what draws the picture: drop APP1–APP15 (EXIF, XMP, GPS, ICC…) except APP14 (Adobe colour), and comments
export function cleanJpeg(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xd9) return Buffer.concat([...out, buf.subarray(i, i + 2)]);
    if (m === 0xda) return Buffer.concat([...out, buf.subarray(i)]); // start of scan: the image data runs to the end
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const drop = (m >= 0xe1 && m <= 0xef && m !== 0xee) || m === 0xfe;
    if (!drop) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

// a photo named in an action must be the actor's own, and still up
export async function photoProblem(q: Q, userId: number, args: any): Promise<string | null> {
  const p = args?.photo;
  if (p === undefined || p === null || p === '') return null;
  if (typeof p !== 'string' || !ID.test(p)) return 'That photo isn’t right. Upload it again.';
  const r = (await q('SELECT user_id, removed FROM v2_images WHERE id = $1', [p])).rows[0];
  if (!r || r.removed) return 'That photo isn’t there any more. Upload it again.';
  if (r.user_id !== userId) return 'You can only use photos you uploaded.';
  return null;
}

type Deps = { q: Q; auth: any; admin: any; limited: (k: string, n?: number) => boolean; audit: (a: string, c: string, ok: boolean, e?: string) => any; announce: (cid: string, owner: string, reason: string) => Promise<void> };

// GET is mounted before the CORS check: <img> requests carry no Origin and need no sign-in
export function imageGet(app: Express, q: Q) {
  app.get('/api/images/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return res.status(404).end();
    const r = (await q('SELECT data, removed FROM v2_images WHERE id = $1', [id])).rows[0];
    if (!r || r.removed) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(Buffer.from(r.data));
  });
}

export function imageRoutes(app: Express, d: Deps) {
  const { q, auth, admin, limited, audit } = d;
  app.post('/api/images', auth, async (req: any, res) => {
    if (limited('img:' + req.user.id, 10)) return res.status(429).json({ error: 'Too many photos at once. Wait a minute.' });
    const raw = typeof req.body?.data === 'string' ? Buffer.from(req.body.data.replace(/^data:image\/jpeg;base64,/, ''), 'base64') : null;
    if (!raw || !raw.length) return res.status(400).json({ error: 'Pick a photo.' });
    if (raw.length > MAX_BYTES) return res.status(400).json({ error: 'That photo is too big, even after shrinking. Try another.' });
    const clean = cleanJpeg(raw);
    if (!clean) return res.status(400).json({ error: 'That isn’t a photo the realm can use. Try a JPEG or a photo from your camera.' });
    const n = (await q('SELECT count(*)::int AS n FROM v2_images WHERE user_id = $1 AND removed IS NULL', [req.user.id])).rows[0].n;
    if (n >= MAX_PER_USER) return res.status(400).json({ error: `You have ${MAX_PER_USER} photos up. Delete one from your passport first.` });
    const id = newId();
    await q('INSERT INTO v2_images (id, user_id, data, bytes) VALUES ($1, $2, $3, $4)', [id, req.user.id, clean, clean.length]);
    audit(req.cid, 'image.upload', true);
    res.json({ id });
  });
  app.get('/api/images', auth, async (req: any, res) => {
    res.json((await q('SELECT id, bytes, created_at FROM v2_images WHERE user_id = $1 AND removed IS NULL ORDER BY created_at DESC', [req.user.id])).rows);
  });
  app.post('/api/images/delete', auth, async (req: any, res) => {
    const r = await q("UPDATE v2_images SET removed = 'deleted by owner', data = '\\x'::bytea WHERE id = $1 AND user_id = $2 AND removed IS NULL RETURNING id", [String(req.body?.id || ''), req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No such photo.' });
    res.json({ ok: true });
  });
  // the Returning Officer can take any photo down, for safety; it's announced like every admin action
  app.post('/api/admin/images/remove', auth, admin, async (req: any, res) => {
    const id = String(req.body?.id || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    if (reason.length < 4) return res.status(400).json({ error: 'Give a reason. It is published.' });
    const r = await q("UPDATE v2_images SET removed = $2, data = '\\x'::bytea WHERE id = $1 AND removed IS NULL RETURNING user_id", [id, 'removed by the RO: ' + reason]);
    if (!r.rows.length) return res.status(404).json({ error: 'No such photo.' });
    await d.announce(req.cid, 'u' + r.rows[0].user_id, reason);
    res.json({ ok: true });
  });
}
