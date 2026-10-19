import { connect } from './db';
import { makeApp } from './app';

const secret = process.env.JWT_SECRET || (process.env.DATABASE_URL ? '' : 'dev-secret');
if (!secret) throw new Error('JWT_SECRET is not set.');
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
const { app } = await makeApp({ q, secret, origins });
const port = Number(process.env.PORT || 4321);
app.listen(port, () => console.log(`[realm] listening on ${port}`));
