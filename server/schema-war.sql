-- The war system: supply, not manoeuvre.
--
-- The group decided this deliberately. There are no unit positions, no orders,
-- no movement and no battles resolved by dice. What a war costs you here is
-- equipment you had to buy, upkeep you have to keep paying, and the political
-- argument about where the money comes from. Losing looks like a readiness
-- figure sliding for three cycles while the House refuses to fund it.
--
-- Additive and idempotent, like every other schema file here.

/* What the Republic holds, by the same eight categories the goods economy
   already uses. One row per category — a stockpile is a quantity, not a pile of
   individual crates, and modelling crates would buy nothing but joins. */
CREATE TABLE IF NOT EXISTS stockpile (
  category   TEXT PRIMARY KEY,
  quantity   BIGINT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ DEFAULT now()
);

/* Every movement in and out, so the stockpile is a running total of a record
   rather than a number somebody set. The same discipline as the ledger, for the
   same reason: a quantity nobody can audit is a quantity that will drift. */
CREATE TABLE IF NOT EXISTS stockpile_movements (
  id         BIGSERIAL PRIMARY KEY,
  category   TEXT NOT NULL,
  quantity   BIGINT NOT NULL,            -- signed: positive in, negative out
  kind       TEXT NOT NULL,              -- procurement | upkeep | loss | grant
  note       TEXT DEFAULT '',
  cycle_no   INT,
  by_id      INT REFERENCES users(id) ON DELETE SET NULL,
  at         TIMESTAMPTZ DEFAULT now()
);

/* A formation is a standing commitment, not a piece on a board. It has a size
   and a readiness, and that is all — where it is and what it is doing are
   things the players say to each other, not things the database owns. */
CREATE TABLE IF NOT EXISTS formations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  arm         TEXT NOT NULL DEFAULT 'army',   -- army | navy | air
  size        INT NOT NULL DEFAULT 1 CHECK (size > 0),
  readiness   NUMERIC NOT NULL DEFAULT 100 CHECK (readiness >= 0 AND readiness <= 100),
  raised_at   TIMESTAMPTZ DEFAULT now(),
  disbanded_at TIMESTAMPTZ,
  raised_by   INT REFERENCES users(id) ON DELETE SET NULL
);

/* One row per cycle the upkeep ran, so it cannot run twice and so the House can
   read the history of what the forces cost and what they went short of. */
CREATE TABLE IF NOT EXISTS upkeep_runs (
  cycle_no  INT PRIMARY KEY,
  paid      BIGINT NOT NULL DEFAULT 0,
  shortfall TEXT NOT NULL DEFAULT '',
  detail    TEXT NOT NULL DEFAULT '',
  at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stockpile_moves_at ON stockpile_movements(at);

/* ---------------------------------------------------- conflict pressure

   A conflict is a countdown, not a battle. Each cycle it moves by a fixed
   amount decided by whose forces are better supplied, and when it crosses a
   threshold it escalates a stage. Nothing here is random: a Republic that is
   losing can see it coming several cycles out, which is the only way a war
   works in a group chat where people check in twice a day.

   Additive to the existing foreign_conflicts table, which diplomacy.js owns.
   Kept in its own table rather than as columns so that a build running
   diplomacy without war.js is untouched. */
CREATE TABLE IF NOT EXISTS conflict_pressure (
  conflict_id  BIGINT PRIMARY KEY REFERENCES foreign_conflicts(id) ON DELETE CASCADE,
  pressure     NUMERIC NOT NULL DEFAULT 0,     -- -100 (we prevail) .. +100 (they do)
  stage        TEXT NOT NULL DEFAULT 'grievance', -- grievance | ultimatum | blockade | open_war
  last_cycle   INT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conflict_log (
  id          BIGSERIAL PRIMARY KEY,
  conflict_id BIGINT REFERENCES foreign_conflicts(id) ON DELETE CASCADE,
  cycle_no    INT,
  pressure    NUMERIC,
  stage       TEXT,
  note        TEXT DEFAULT '',
  at          TIMESTAMPTZ DEFAULT now()
);

/* What a foreign power can bring to bear. Set by the Returning Officer when the
   power is created, or by its own LLM government over time. Deliberately one
   number: this system is about whether YOUR forces are supplied, not about
   modelling theirs. */
ALTER TABLE powers ADD COLUMN IF NOT EXISTS strength INT NOT NULL DEFAULT 20;

CREATE INDEX IF NOT EXISTS idx_conflict_log_conflict ON conflict_log(conflict_id);
