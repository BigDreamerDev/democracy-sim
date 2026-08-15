-- Presidential per-cycle budgets. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS fiscal_budgets (
  id                  BIGSERIAL PRIMARY KEY,
  bill_id             INT UNIQUE REFERENCES bills(id) ON DELETE SET NULL,
  cycle_no            INT NOT NULL CHECK (cycle_no >= 1),
  proposed_by         INT REFERENCES users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  tax_free_allowance  BIGINT NOT NULL CHECK (tax_free_allowance >= 0),
  tax_rate             NUMERIC NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 1),
  tax_upper_threshold BIGINT NOT NULL CHECK (tax_upper_threshold >= 0),
  tax_rate_upper       NUMERIC NOT NULL CHECK (tax_rate_upper >= 0 AND tax_rate_upper <= 1),
  import_tariff        NUMERIC NOT NULL CHECK (import_tariff >= 0 AND import_tariff <= 1),
  departments          JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale            TEXT NOT NULL DEFAULT '',
  proposed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_budgets_one_approved_per_cycle
  ON fiscal_budgets(cycle_no) WHERE status='approved';
CREATE INDEX IF NOT EXISTS fiscal_budgets_cycle ON fiscal_budgets(cycle_no DESC,id DESC);
