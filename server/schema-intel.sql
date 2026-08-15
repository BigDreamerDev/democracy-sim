-- Collection and operations, on top of the framework in schema-diplomacy.sql.
-- Additive and idempotent like every other schema file. Loaded after
-- schema-diplomacy.sql, whose intel_service/intel_reports/powers/foreign_agents
-- this extends rather than replaces.

-- The charter, in the moment before the House votes on it. established_bill_id on
-- intel_service moves from NULL to this bill's id only on enactment — a rejected
-- or withdrawn charter never touches the service, same as any other motion.
CREATE TABLE IF NOT EXISTS intel_charters (
  bill_id                 INT PRIMARY KEY REFERENCES bills(id) ON DELETE CASCADE,
  charter                 TEXT NOT NULL DEFAULT '',
  declassify_after_cycles INT NOT NULL DEFAULT 3,
  budget_per_cycle        BIGINT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- Progression. Two numbers decide what tier of operation the agency may run, and
-- both are earned, never set: tradecraft only rises when a mission the allowlist
-- recognises succeeds, and committed_budget only rises when money actually left
-- the Treasury for one. Both are in the public /api/intel/agency response next to
-- the thresholds themselves, so the gate is something the House can watch fill in,
-- not a number kept behind the console.
ALTER TABLE intel_service ADD COLUMN IF NOT EXISTS tradecraft INT NOT NULL DEFAULT 0;
ALTER TABLE intel_service ADD COLUMN IF NOT EXISTS committed_budget BIGINT NOT NULL DEFAULT 0;
ALTER TABLE intel_service ADD COLUMN IF NOT EXISTS established_cycle INT;

-- A published, RO-adjustable stand-in for a foreign power's own counter-espionage
-- strength. Not hidden and not rolled: every mission's odds are tradecraft (plus
-- an asset's own experience) against this number, arithmetic anyone can do before
-- they commit the budget.
ALTER TABLE powers ADD COLUMN IF NOT EXISTS counter_intel INT NOT NULL DEFAULT 50;

-- A recruited human asset: the unit collection and influence missions run through.
-- target_agent_id is set only when the asset IS a foreign government official
-- turned rather than a source run against one — recruit_mole's target, and later
-- back_coup/removal's precondition.
CREATE TABLE IF NOT EXISTS intel_assets (
  id              BIGSERIAL PRIMARY KEY,
  power_id        INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  codename        TEXT NOT NULL,
  target_agent_id BIGINT REFERENCES foreign_agents(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active', -- active | blown | extracted
  experience      INT NOT NULL DEFAULT 0,
  recruited_cycle INT,
  recruited_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_intel_assets_power ON intel_assets(power_id);

-- Every operation ordered, whatever came of it. Mirrors the discipline
-- stockpile_movements holds for war: a movement that never happened is not the
-- kind of failure this codebase pretends away, and neither is a mission. Wholly
-- public — score and threshold included — because the fact and cost of a mission
-- are never secret, only the report body an operation may produce is.
CREATE TABLE IF NOT EXISTS intel_operations (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  tier         INT NOT NULL,
  power_id     INT REFERENCES powers(id) ON DELETE SET NULL,
  asset_id     BIGINT REFERENCES intel_assets(id) ON DELETE SET NULL,
  ordered_by   INT REFERENCES users(id) ON DELETE SET NULL,
  budget       BIGINT NOT NULL DEFAULT 0,
  cycle_no     INT,
  score        INT NOT NULL DEFAULT 0,
  threshold    INT NOT NULL DEFAULT 0,
  outcome      TEXT NOT NULL, -- success | failed | blown
  report_id    BIGINT REFERENCES intel_reports(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intel_operations_power ON intel_operations(power_id);
CREATE INDEX IF NOT EXISTS idx_intel_operations_kind ON intel_operations(kind);

-- A time-boxed effect a successful operation left behind (disinformation's
-- confusion, mainly), expiring on the cycle clock rather than being rolled back
-- by hand or left permanent.
CREATE TABLE IF NOT EXISTS intel_effects (
  id            BIGSERIAL PRIMARY KEY,
  power_id      INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  magnitude     INT NOT NULL DEFAULT 0,
  expires_cycle INT,
  operation_id  BIGINT REFERENCES intel_operations(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intel_effects_power ON intel_effects(power_id, kind);
