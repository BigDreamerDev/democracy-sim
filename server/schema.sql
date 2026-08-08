-- Republic — schema. Safe to run repeatedly.

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

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  note       TEXT DEFAULT '',
  used_by    INT REFERENCES users(id) ON DELETE SET NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  abbr       TEXT NOT NULL,
  colour     TEXT DEFAULT '#5B2E9E',
  manifesto  TEXT DEFAULT '',
  leader_id  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- PRIMARY KEY on user_id alone = one party per citizen.
CREATE TABLE IF NOT EXISTS party_members (
  user_id   INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  party_id  INT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elections (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,                    -- president | parliament | speaker | referendum
  title      TEXT NOT NULL,
  seats      INT DEFAULT 1,
  status     TEXT DEFAULT 'nominations',       -- nominations | voting | closed
  opened_at  TIMESTAMPTZ,                      -- freezes the electoral roll
  closes_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidacies (
  id          SERIAL PRIMARY KEY,
  election_id INT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id    INT REFERENCES parties(id) ON DELETE SET NULL,
  statement   TEXT DEFAULT '',
  withdrawn   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (election_id, user_id)
);

-- One vote per person per election, enforced by the database.
CREATE TABLE IF NOT EXISTS votes (
  id           SERIAL PRIMARY KEY,
  election_id  INT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  voter_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidacy_id INT NOT NULL REFERENCES candidacies(id) ON DELETE CASCADE,
  cast_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (election_id, voter_id)
);

CREATE TABLE IF NOT EXISTS offices (
  id          SERIAL PRIMARY KEY,
  office      TEXT NOT NULL,                   -- president | speaker | mp
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seat        INT,
  election_id INT REFERENCES elections(id) ON DELETE SET NULL,
  since       TIMESTAMPTZ DEFAULT now(),
  until       TIMESTAMPTZ,
  active      BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bills (
  id           SERIAL PRIMARY KEY,
  ref          TEXT UNIQUE,
  title        TEXT NOT NULL,
  kind         TEXT DEFAULT 'law',             -- law | amendment | repeal | motion | constitutional
  body         TEXT NOT NULL,
  target_law_id INT,                              -- laws.id (no FK: bills/laws are mutually referential)
  author_id    INT REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT DEFAULT 'draft',           -- draft | tabled | division | passed | failed | vetoed | enacted | withdrawn
  created_at   TIMESTAMPTZ DEFAULT now(),
  divided_at   TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  result       TEXT
);

CREATE TABLE IF NOT EXISTS bill_seconds (
  bill_id INT REFERENCES bills(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS bill_votes (
  bill_id INT REFERENCES bills(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  vote    TEXT NOT NULL,                       -- aye | no | abstain
  cast_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         SERIAL PRIMARY KEY,
  bill_id    INT REFERENCES bills(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS laws (
  id          SERIAL PRIMARY KEY,
  ref         TEXT UNIQUE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  bill_id     INT,
  enacted_at  TIMESTAMPTZ DEFAULT now(),
  repealed_at TIMESTAMPTZ,
  repealed_by INT
);

CREATE TABLE IF NOT EXISTS constitution (
  id          SERIAL PRIMARY KEY,
  version     INT NOT NULL,
  body        TEXT NOT NULL,
  ratified_at TIMESTAMPTZ DEFAULT now(),
  bill_id     INT REFERENCES bills(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id       SERIAL PRIMARY KEY,
  actor_id INT REFERENCES users(id) ON DELETE SET NULL,
  action   TEXT NOT NULL,
  detail   TEXT DEFAULT '',
  at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_votes_election ON votes(election_id);
CREATE INDEX IF NOT EXISTS idx_offices_active ON offices(active, office);
CREATE INDEX IF NOT EXISTS idx_bills_status  ON bills(status);

-- Migrations (safe on existing databases).
ALTER TABLE elections ADD COLUMN IF NOT EXISTS campaign_at TIMESTAMPTZ;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS opens_at    TIMESTAMPTZ;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS auto        BOOLEAN DEFAULT FALSE;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS cycle_no    INT;

-- Migrations for vaults created before these columns existed.
ALTER TABLE users     ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT TRUE;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 0;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
