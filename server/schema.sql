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

-- Bills may now name a person (impeachment) as well as a law.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS target_user_id INT;

-- A challenge is the people striking down a bill the House already passed.
CREATE TABLE IF NOT EXISTS challenges (
  id         SERIAL PRIMARY KEY,
  bill_id    INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  opened_by  INT REFERENCES users(id) ON DELETE SET NULL,
  status     TEXT DEFAULT 'open',              -- open | struck | kept | void
  opened_at  TIMESTAMPTZ DEFAULT now(),
  closes_at  TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  result     TEXT
);

-- One vote per citizen per challenge, enforced by the database like every other vote.
CREATE TABLE IF NOT EXISTS challenge_votes (
  challenge_id INT REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  vote         TEXT NOT NULL,                  -- reject | keep
  cast_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_open ON challenges(status);
-- At most one live challenge per bill.
CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_one_open ON challenges(bill_id) WHERE status='open';

-- The House impeaches: a bill can name a person instead of a law.
ALTER TABLE bills     ADD COLUMN IF NOT EXISTS target_user_id INT;
-- A referendum is bound to the law it is trying to strike down.
ALTER TABLE elections ADD COLUMN IF NOT EXISTS target_law_id INT;

-- Referendums ask a question rather than choosing a person, so they get their
-- own ballot box. One row per citizen per referendum, enforced by the key.
CREATE TABLE IF NOT EXISTS referendum_votes (
  election_id INT REFERENCES elections(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  choice      TEXT NOT NULL,                    -- keep | reject
  cast_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (election_id, user_id)
);

-- Citizens calling for a referendum on a law they did not get to vote on.
CREATE TABLE IF NOT EXISTS petitions (
  law_id  INT REFERENCES laws(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (law_id, user_id)
);

-- A bill can now come from outside the House, on the signatures of citizens.
ALTER TABLE bills     ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'house';   -- house | initiative
ALTER TABLE elections ADD COLUMN IF NOT EXISTS target_bill_id INT;            -- a referendum on a proposal

CREATE TABLE IF NOT EXISTS bill_petitions (
  bill_id INT REFERENCES bills(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (bill_id, user_id)
);

-- Diplomacy metadata attached to bills proposed on behalf of a foreign power.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS foreign_power_id INT;

/* Article 12 — Extraordinary Circumstances.

   Declared jointly: the President moves it, the House votes on it. It suspends
   only what it names (12.2), lapses on its own at a stated time (12.1), and the
   House alone can end it at any moment without the President's consent (12.3). */
CREATE TABLE IF NOT EXISTS emergencies (
  id          SERIAL PRIMARY KEY,
  bill_id     INT REFERENCES bills(id) ON DELETE SET NULL,
  declared_by INT REFERENCES users(id) ON DELETE SET NULL,
  reasons     TEXT NOT NULL,
  powers      TEXT NOT NULL DEFAULT '',      -- comma-separated, from a fixed list
  status      TEXT DEFAULT 'proposed',       -- proposed | in_force | lapsed | ended | refused
  declared_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  ended_by    TEXT,                          -- house | president | lapsed
  created_at  TIMESTAMPTZ DEFAULT now()
);

/* The House ending it. A simple majority of sitting members, counted the moment
   each one votes — no Speaker required, because 12.3 says "at any moment". */
CREATE TABLE IF NOT EXISTS emergency_end_votes (
  emergency_id INT REFERENCES emergencies(id) ON DELETE CASCADE,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (emergency_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_emergency_status ON emergencies(status);

/* Article 2 — the Sovereignty of the People.

   The Constitution's most powerful mechanism, and the one with no machinery
   behind it until now. A Supermajority is two thirds of ALL citizens, not of
   those who turned up, and Articles 4.6, 10.5, 10.6 and 12.3 all lean on it:
   appointing a Speaker over a deadlocked House, removing any officer at all,
   dissolving the House, ending a declaration of extraordinary circumstances.

   It is a standing motion rather than a poll: signatures accumulate until the
   threshold is met, and the act happens the moment it is. Nobody schedules it,
   nobody closes it, and no officer is asked. */
CREATE TABLE IF NOT EXISTS supermajorities (
  id             SERIAL PRIMARY KEY,
  kind           TEXT NOT NULL,   -- appoint_speaker | remove_officer | dissolve_house | end_emergency | resolution
  target_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  target_office  TEXT,
  reasons        TEXT NOT NULL,
  opened_by      INT REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT DEFAULT 'open',   -- open | carried | lapsed | withdrawn
  outcome        TEXT,
  carried_at     TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supermajority_signatures (
  motion_id INT REFERENCES supermajorities(id) ON DELETE CASCADE,
  user_id   INT REFERENCES users(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (motion_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_super_status ON supermajorities(status);
