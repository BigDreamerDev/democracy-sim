-- Named historical eras. A human names one deliberately; nothing here infers
-- one from a constitutional bill automatically. Independent of every other
-- schema file — it only references users(id) — so it can load anywhere.
CREATE TABLE IF NOT EXISTS eras (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  starts_cycle INT,
  description  TEXT DEFAULT '',
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
