// Account security: password rules, hashing, lockout after repeated failures, security headers and per-user
// rate limits. See SECURITY.md for the threat model and why each of these exists.
import bcrypt from 'bcryptjs';
import type { Q } from './db';

export const SECURITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_accounts (
  user_id      INT PRIMARY KEY,
  no_password  BOOLEAN NOT NULL DEFAULT FALSE,
  failures     INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login   TIMESTAMPTZ,
  last_ip      TEXT
);
CREATE TABLE IF NOT EXISTS v2_identities (
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  user_id    INT NOT NULL,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_identities_one_per_provider ON v2_identities (user_id, provider);
CREATE TABLE IF NOT EXISTS v2_oauth_flows (
  state       TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  mode        TEXT NOT NULL,
  user_id     INT,
  browser     TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  verifier    TEXT NOT NULL,
  return_to   TEXT NOT NULL,
  result_user INT,
  result      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
`;

export const COST = 12;
// bcrypt only reads the first 72 bytes, so longer passwords are refused rather than silently truncated
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty', 'qwertyuiop', 'qwerty123', '123456789', '1234567890', '12345678', '1234567', '11111111', '00000000', 'iloveyou', 'letmein', 'welcome', 'welcome1', 'abc12345', 'football', 'baseball', 'monkey123', 'dragon123', 'sunshine', 'princess', 'trustno1', 'admin123', 'administrator', 'thereaml', 'therealm', 'mcserverlandia', 'republic', 'democracy']);
export function passwordProblem(pw: string, username = ''): string | null {
  const bytes = new TextEncoder().encode(pw).length;
  if (pw.length < 10) return 'Use at least 10 characters. A short sentence works well.';
  if (bytes > 72) return 'That password is too long (72 bytes at most).';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || COMMON.has(low.replace(/[^a-z0-9]/g, ''))) return 'That password is one of the most common. Pick another.';
  if (username && username.length >= 3 && low.includes(username.toLowerCase())) return "Don't put your username in your password.";
  if (/^(.)\1+$/.test(pw)) return 'Pick something less repetitive.';
  return null;
}
export const hash = (pw: string) => bcrypt.hash(pw, COST);
// a real hash to compare against when the username doesn't exist, so a wrong username takes as long as a wrong password
let dummy = '';
export async function dummyCompare(pw: string) {
  dummy ||= await bcrypt.hash('not-a-real-password', COST);
  await bcrypt.compare(pw, dummy);
}
export const needsRehash = (h: string) => {
  try {
    return bcrypt.getRounds(h) < COST;
  } catch {
    return true;
  }
};

// lockout: 5 wrong passwords in a row locks the account for 15 minutes, doubling each time after that, up to a day
export async function account(q: Q, userId: number) {
  await q('INSERT INTO v2_accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  return (await q('SELECT * FROM v2_accounts WHERE user_id = $1', [userId])).rows[0];
}
export function lockedFor(a: any, now: number) {
  const until = a?.locked_until ? new Date(a.locked_until).getTime() : 0;
  return until > now ? until - now : 0;
}
export async function failed(q: Q, userId: number, now: number) {
  const a = await account(q, userId);
  const n = (a.failures || 0) + 1;
  const lock = n >= 5 ? Math.min(15 * 60_000 * 2 ** (n - 5), 24 * 3600_000) : 0;
  await q('UPDATE v2_accounts SET failures = $1, locked_until = $2 WHERE user_id = $3', [n, lock ? new Date(now + lock) : null, userId]);
  return lock;
}
export async function succeeded(q: Q, userId: number, ip: string) {
  await account(q, userId);
  await q('UPDATE v2_accounts SET failures = 0, locked_until = NULL, last_login = now(), last_ip = $1 WHERE user_id = $2', [ip.slice(0, 64), userId]);
}

// headers for every API response: no caching of personal data, no sniffing, no framing, HTTPS only
export function headers(_req: any, res: any, next: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Powered-By');
  next();
}

// a sliding window per key: `limit` requests per `ms`
export function limiter(now: () => number) {
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const cut = now() - 10 * 60_000;
    hits.forEach((v, k) => (v.length && v[v.length - 1] < cut ? hits.delete(k) : null));
  }, 5 * 60_000).unref?.();
  return (key: string, limit: number, ms: number) => {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => x > t - ms);
    list.push(t);
    hits.set(key, list);
    return list.length > limit;
  };
}
