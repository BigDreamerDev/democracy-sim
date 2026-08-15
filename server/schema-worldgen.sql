-- The generated world: a stored preview, and what it turned into.
--
-- Nothing here is ever computed twice. worldgen.js generates a plan in memory,
-- deterministic from a seed, and this table is the only place it is allowed to
-- live before a Returning Officer commits it. The route that draws the preview
-- SVG and the route that turns it into real powers both read the same row, so
-- what gets committed is provably what was looked at.
--
-- Additive and idempotent, like every other schema file here.

/* One row per attempt, kept forever — a discarded world is evidence that a
   seed was tried and rejected, not a thing to tidy away. `plan` is the whole
   generation: every nation, its cells, its name, its strength. Regenerating
   the same seed produces the same `plan` byte-for-byte, but it is stored
   anyway rather than recomputed on read, so a commit acts on exactly what an
   RO saw and not on a re-run that could in principle drift if the algorithm
   changes under it later. */
CREATE TABLE IF NOT EXISTS world_generations (
  id                   BIGSERIAL PRIMARY KEY,
  seed                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'preview',   -- preview | committed | discarded
  params               JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  republic_strength    INT,
  strength_per_output  NUMERIC,
  created_by           INT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT now(),
  committed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_world_generations_status ON world_generations(status, id DESC);

/* A generated power's provenance, one row each, so `/api/world/strength/recompute`
   can re-derive `powers.strength` from the land a power holds NOW without ever
   touching the Republic's own strength — the rate here is frozen at generation
   time on purpose. A power not in this table did not come from a generator (it
   was created by hand through /api/admin/foreign/powers) and recompute leaves
   it alone. */
CREATE TABLE IF NOT EXISTS world_powers (
  power_id            INT PRIMARY KEY REFERENCES powers(id) ON DELETE CASCADE,
  generation_id       BIGINT REFERENCES world_generations(id) ON DELETE SET NULL,
  target_multiple     NUMERIC NOT NULL DEFAULT 1,
  output              NUMERIC NOT NULL DEFAULT 0,
  strength_per_output NUMERIC NOT NULL DEFAULT 0,
  capital             TEXT
);
