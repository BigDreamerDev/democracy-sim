-- The Press Act.
-- Safe to run repeatedly. Loaded after schema.sql, which owns users(id) — this
-- schema needs nothing else, deliberately not schema-acts.sql's businesses.

/* A publication is not a business. It has no account, no capital requirement,
   nothing to trade — it is a named institution on the record with editors who
   may write under its name. Founding one costs nothing but a name. */
CREATE TABLE IF NOT EXISTS publications (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  founder_id  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- The same ownership-list shape as business_members: more than one editor,
-- no ranking between them.
CREATE TABLE IF NOT EXISTS publication_editors (
  publication_id INT REFERENCES publications(id) ON DELETE CASCADE,
  user_id        INT REFERENCES users(id) ON DELETE CASCADE,
  added_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (publication_id, user_id)
);

/* Drafted, then published. Nothing here is ever deleted — the same "nothing
   is deleted" rule as the rest of the record — so a published article stays
   published forever; the only state change left to it is none. Citing a bill
   or an election is informal prose ("see B042"), the same way debate on a
   bill already works — there is no foreign key to either. */
CREATE TABLE IF NOT EXISTS articles (
  id             SERIAL PRIMARY KEY,
  publication_id INT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  author_id      INT REFERENCES users(id) ON DELETE SET NULL,
  headline       TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  published      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS articles_pub_idx ON articles(publication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles(published, published_at DESC);
