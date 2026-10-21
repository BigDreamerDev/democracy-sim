import { connect, SCHEMA } from './db';
import { makeApp } from './app';

const secret = process.env.JWT_SECRET || (process.env.DATABASE_URL ? '' : 'dev-secret');
if (!secret) throw new Error('JWT_SECRET is not set.');
if (process.env.DATABASE_URL && secret.length < 24) throw new Error('JWT_SECRET is too short: use at least 32 random characters.');
const origins = (process.env.ALLOWED_ORIGINS || 'https://bigdreamerdev.github.io,http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);

const q = await connect(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) {
  // local dev: one admin and two players, password "password"
  const bcrypt = (await import('bcryptjs')).default;
  await q(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, bio TEXT DEFAULT '', is_admin BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, approved BOOLEAN DEFAULT TRUE, token_version INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());`);
  const h = await bcrypt.hash('password', 10);
  for (const [u, n, a] of [['admin', 'Uzair', true], ['amara', 'Amara', false], ['bilal', 'Bilal', false]] as const)
    await q('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [u, n, h, a]);
  console.log('[realm] dev database: admin / amara / bilal, password "password"');
}
// a brand-new database has no Returning Officer: ADMIN_USERNAME and ADMIN_PASSWORD make one on first boot.
// They do nothing once any admin exists, so remove ADMIN_PASSWORD from Render after the first sign-in.
if (process.env.DATABASE_URL && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  await q(SCHEMA);
  const has = (await q('SELECT 1 FROM users WHERE is_admin LIMIT 1')).rows.length;
  if (!has) {
    const { passwordProblem, hash } = await import('./security');
    const username = process.env.ADMIN_USERNAME.trim().toLowerCase();
    const bad = passwordProblem(process.env.ADMIN_PASSWORD, username);
    if (bad) throw new Error('ADMIN_PASSWORD: ' + bad);
    await q('INSERT INTO users (username, display_name, password_hash, is_admin, is_active, approved) VALUES ($1, $2, $3, TRUE, TRUE, TRUE) ON CONFLICT (username) DO UPDATE SET is_admin = TRUE', [username, (process.env.ADMIN_NAME || username).trim(), await hash(process.env.ADMIN_PASSWORD)]);
    console.log(`[realm] created the Returning Officer account "${username}". Remove ADMIN_PASSWORD from the environment now.`);
  }
}
// locally, any localhost port may call the API (vite moves to 5174 if 5173 is busy)
const { app, flush } = await makeApp({ q, secret, origins, devOrigins: !process.env.DATABASE_URL, saveEvery: process.env.DATABASE_URL ? 20_000 : 0 });
const port = Number(process.env.PORT || 4321);
const server = app.listen(port, () => console.log(`[realm] listening on ${port}`));
// Render sends SIGTERM before a deploy or a sleep: write anything still waiting, then stop
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.once(sig, async () => {
    server.close();
    await flush().catch((e) => console.error('[realm] final save failed', e));
    process.exit(0);
  });
