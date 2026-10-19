// One tiny database layer: real Postgres (Neon) in production, an in-memory Postgres (PGlite) for dev and tests.
import pg from 'pg';

export type Q = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

export async function connect(url: string | undefined): Promise<Q> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false }, max: 4 });
    return (sql, params) => pool.query(sql, params);
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  return async (sql, params) => {
    if (!params?.length && sql.includes(';')) {
      await db.exec(sql);
      return { rows: [] };
    }
    return db.query(sql, params) as any;
  };
}

// Additive and idempotent. `users` matches v1 exactly so the old logins keep working.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT DEFAULT '',
  is_admin      BOOLEAN DEFAULT FALSE,
  is_active     BOOLEAN DEFAULT TRUE,
  approved      BOOLEAN DEFAULT TRUE,
  token_version INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS v2_world (
  id         INT PRIMARY KEY,
  state      JSONB NOT NULL,
  version    INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS v2_log (
  id     BIGSERIAL PRIMARY KEY,
  at     TIMESTAMPTZ DEFAULT now(),
  actor  TEXT,
  cmd    TEXT,
  args   JSONB,
  ok     BOOLEAN,
  error  TEXT
);
CREATE TABLE IF NOT EXISTS v2_snapshots (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ DEFAULT now(),
  reason     TEXT,
  state      JSONB NOT NULL
);
`;
