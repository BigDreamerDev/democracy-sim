// Forgotten passwords: the Returning Officer makes a single-use link for one account and forwards it privately.
// Opening it lets that person choose a new password and signs them in. The old password keeps working until the
// link is used, so a link nobody opens changes nothing. Links last 24 hours; making a new one voids the old.
// Only a hash of each code is stored. Making one is announced, like every admin act.
import { createHash, randomBytes } from 'node:crypto';
import type { Q } from './db';

export const RESETS_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_resets (
  id          BIGSERIAL PRIMARY KEY,
  code_hash   TEXT UNIQUE NOT NULL,
  user_id     INT NOT NULL,
  created_by  INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
`;
export const RESET_HOURS = 24;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const clean = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

export async function createReset(q: Q, userId: number, by: number) {
  const code = Array.from(randomBytes(24), (b) => ALPHA[b % ALPHA.length]).join('');
  await q('UPDATE v2_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const r = (await q(`INSERT INTO v2_resets (code_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, now() + interval '${RESET_HOURS} hours') RETURNING expires_at`, [sha(code), userId, by])).rows[0];
  return { code, expiresAt: r.expires_at };
}
// a link still good to use: { user_id } or null
export async function validReset(q: Q, code: unknown) {
  const c = clean(code);
  if (c.length < 16) return null;
  return (await q('SELECT user_id FROM v2_resets WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha(c)])).rows[0] || null;
}
// spend it: only one request can win
export async function useReset(q: Q, code: unknown) {
  const c = clean(code);
  if (c.length < 16) return null;
  return (await q('UPDATE v2_resets SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id', [sha(c)])).rows[0] || null;
}
