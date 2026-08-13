-- The Treasury and the Fed. Parts 6 and 7 of the Creation of an Economy Act,
-- and Article 21 of the Electoral Reform Act.
--
-- Safe to run repeatedly, and additive only: nothing here alters the key of an
-- existing table, so this can be applied to a live database without a migration.
-- In particular `deposits` and `loans` are left exactly as they are — they are
-- the public bank's, and private banks get their own tables rather than a new
-- column and a changed primary key.

/* ------------------------------------------------------------- the Fed */

-- Article 21.8: the President appoints, the House confirms. An appointment
-- without confirmation is of no effect, so the nomination is a row of its own
-- and the office is only written when the votes are in.
CREATE TABLE IF NOT EXISTS fed_nominations (
  id           SERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  nominated_by INT REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT DEFAULT 'open',           -- open | confirmed | refused | withdrawn
  term_ends    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  settled_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fed_confirmations (
  nomination_id INT REFERENCES fed_nominations(id) ON DELETE CASCADE,
  user_id       INT REFERENCES users(id) ON DELETE CASCADE,
  at            TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (nomination_id, user_id)
);

-- Article 21.12: the Fed publishes its reasons for every decision it takes.
-- `reasons` is NOT NULL and the endpoints refuse an empty one, so a decision
-- without a published reason cannot be recorded at all.
CREATE TABLE IF NOT EXISTS fed_decisions (
  id      SERIAL PRIMARY KEY,
  ref     TEXT UNIQUE,
  kind    TEXT NOT NULL,          -- rate | issue | retire | licence | refusal | closure
  detail  TEXT DEFAULT '',
  reasons TEXT NOT NULL,
  by_id   INT REFERENCES users(id) ON DELETE SET NULL,
  at      TIMESTAMPTZ DEFAULT now()
);

/* --------------------------------------------------------- the Treasury */

-- Part 6.20: the Treasury publishes what it has taken and what it has spent.
CREATE TABLE IF NOT EXISTS treasury_statements (
  id       SERIAL PRIMARY KEY,
  ref      TEXT UNIQUE,
  cycle_no INT,
  body     TEXT NOT NULL,
  by_id    INT REFERENCES users(id) ON DELETE SET NULL,
  at       TIMESTAMPTZ DEFAULT now()
);

/* ------------------------------------------------------- private banks */

-- Part 4.12: private banks are licensed by the Fed on conditions it sets, and
-- may be closed by it for breaking them. A bank holds a real account under
-- owner_kind='bank' with owner_id = banks.id; the public bank is the same
-- owner_kind with owner_id NULL, so the two never collide.
CREATE TABLE IF NOT EXISTS banks (
  id            SERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  founder_id    INT REFERENCES users(id) ON DELETE SET NULL,
  prospectus    TEXT DEFAULT '',
  status        TEXT DEFAULT 'applied',   -- applied | licensed | refused | closed
  reserve_ratio NUMERIC NOT NULL DEFAULT 0.2,
  deposit_rate  NUMERIC NOT NULL DEFAULT 0.02,
  loan_rate     NUMERIC NOT NULL DEFAULT 0.05,
  licensed_by   INT REFERENCES users(id) ON DELETE SET NULL,
  licensed_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  reasons       TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_deposits (
  bank_id INT REFERENCES banks(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  amount  BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  since   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (bank_id, user_id)
);

CREATE TABLE IF NOT EXISTS bank_loans (
  id          SERIAL PRIMARY KEY,
  bank_id     INT REFERENCES banks(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  principal   BIGINT NOT NULL,
  outstanding BIGINT NOT NULL,
  rate        NUMERIC NOT NULL,
  due_cycle   INT,
  status      TEXT DEFAULT 'open',      -- open | repaid | default
  taken_at    TIMESTAMPTZ DEFAULT now(),
  settled_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bank_deposits_user ON bank_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_loans_user    ON bank_loans(user_id);
CREATE INDEX IF NOT EXISTS idx_fed_decisions_at   ON fed_decisions(at);
