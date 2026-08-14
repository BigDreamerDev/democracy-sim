-- Diplomacy and multi-agent foreign governments. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS powers (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  adjective   TEXT DEFAULT '',
  key_hash    TEXT NOT NULL,
  colour      TEXT DEFAULT '#5B2E9E',
  standing    TEXT DEFAULT 'neutral',
  recognised  BOOLEAN DEFAULT FALSE,
  persona     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS foreign_dispatches (
  id               BIGSERIAL PRIMARY KEY,
  power_id         INT NOT NULL REFERENCES powers(id),
  direction        TEXT NOT NULL, -- incoming | outgoing
  message_kind     TEXT NOT NULL DEFAULT 'dispatch', -- dispatch | treaty_proposal | trade_proposal | ultimatum | other
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  in_reply_to      BIGINT REFERENCES foreign_dispatches(id),
  author_user_id   INT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (power_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS treaties (
  id                   BIGSERIAL PRIMARY KEY,
  power_id             INT NOT NULL REFERENCES powers(id),
  bill_id              INT NOT NULL UNIQUE REFERENCES bills(id),
  title                TEXT NOT NULL,
  articles             TEXT NOT NULL,
  terms                JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_after_cycles INT,
  proposed_cycle       INT,
  foreign_ratified_at  TIMESTAMPTZ,
  denounced_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_offers (
  id              BIGSERIAL PRIMARY KEY,
  power_id        INT NOT NULL REFERENCES powers(id),
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  good_category   TEXT,
  unit            TEXT DEFAULT 'unit',
  price           BIGINT NOT NULL CHECK (price >= 0),
  stock           INT CHECK (stock IS NULL OR stock >= 0),
  withdrawn       BOOLEAN DEFAULT FALSE,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (power_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS foreign_trade (
  id          BIGSERIAL PRIMARY KEY,
  power_id    INT NOT NULL REFERENCES powers(id),
  direction   TEXT NOT NULL, -- import | export
  amount      BIGINT NOT NULL CHECK (amount >= 0),
  tax         BIGINT NOT NULL DEFAULT 0 CHECK (tax >= 0),
  citizen_id  INT REFERENCES users(id) ON DELETE SET NULL,
  business_id INT REFERENCES businesses(id) ON DELETE SET NULL,
  offer_id    BIGINT REFERENCES foreign_offers(id),
  listing_id  INT REFERENCES listings(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_conflicts (
  id              BIGSERIAL PRIMARY KEY,
  power_id        INT NOT NULL REFERENCES powers(id),
  bill_id         INT REFERENCES bills(id),
  response_bill_id INT REFERENCES bills(id),
  breach_treaty_id BIGINT REFERENCES treaties(id),
  kind            TEXT NOT NULL,
  grievance       TEXT NOT NULL,
  demands         TEXT DEFAULT '',
  expires_at      TIMESTAMPTZ,
  status          TEXT DEFAULT 'open',
  response        TEXT,
  outcome         TEXT,
  citation        TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  UNIQUE (power_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS foreign_action_usage (
  power_id     INT NOT NULL REFERENCES powers(id),
  cycle_no     INT NOT NULL,
  action_key   TEXT NOT NULL,
  slot         INT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (power_id, cycle_no, action_key),
  UNIQUE (power_id, cycle_no, slot)
);

CREATE TABLE IF NOT EXISTS foreign_memories (
  id          BIGSERIAL PRIMARY KEY,
  power_id    INT NOT NULL REFERENCES powers(id),
  agent_id    BIGINT,
  kind        TEXT NOT NULL, -- national | role
  body        JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_governments (
  power_id           INT PRIMARY KEY REFERENCES powers(id),
  decision_method    TEXT NOT NULL DEFAULT 'executive',
  decision_threshold NUMERIC NOT NULL DEFAULT 0.5,
  max_rounds         INT NOT NULL DEFAULT 2,
  config             JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS foreign_agents (
  id             BIGSERIAL PRIMARY KEY,
  power_id       INT NOT NULL REFERENCES powers(id),
  role           TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  model_provider TEXT NOT NULL DEFAULT 'mock',
  model_name     TEXT NOT NULL DEFAULT 'mock',
  system_prompt  TEXT NOT NULL DEFAULT '',
  vote_weight    NUMERIC NOT NULL DEFAULT 1,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (power_id, role)
);

CREATE TABLE IF NOT EXISTS foreign_government_turns (
  id                 BIGSERIAL PRIMARY KEY,
  power_id           INT NOT NULL REFERENCES powers(id),
  cycle_number       INT NOT NULL,
  state_as_of        TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open',
  chosen_proposal_id BIGINT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  UNIQUE (power_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS foreign_agent_proposals (
  id          BIGSERIAL PRIMARY KEY,
  turn_id     BIGINT NOT NULL REFERENCES foreign_government_turns(id),
  agent_id    BIGINT NOT NULL REFERENCES foreign_agents(id),
  action_kind TEXT NOT NULL,
  payload     JSONB NOT NULL,
  rationale   TEXT DEFAULT '',
  priority    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_agent_votes (
  proposal_id BIGINT NOT NULL REFERENCES foreign_agent_proposals(id),
  agent_id    BIGINT NOT NULL REFERENCES foreign_agents(id),
  vote        TEXT NOT NULL,
  reasoning   TEXT DEFAULT '',
  round_no    INT NOT NULL DEFAULT 1,
  PRIMARY KEY (proposal_id, agent_id, round_no)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_power ON foreign_dispatches(power_id, id);
CREATE INDEX IF NOT EXISTS idx_treaty_power ON treaties(power_id);
CREATE INDEX IF NOT EXISTS idx_offer_power ON foreign_offers(power_id);
CREATE INDEX IF NOT EXISTS idx_conflict_power ON foreign_conflicts(power_id);

-- Strategic goods mode is additive so existing diplomacy installations upgrade in place.
ALTER TABLE foreign_offers ADD COLUMN IF NOT EXISTS good_category TEXT;
ALTER TABLE foreign_offers ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'unit';

ALTER TABLE foreign_dispatches ADD COLUMN IF NOT EXISTS message_kind TEXT NOT NULL DEFAULT 'dispatch';

/* The export cap is measured per cycle, so a trade has to know which cycle it
   happened in. Foreign powers also hold a real account: 'power' joins citizen,
   business, treasury, bank and escrow as an owner kind. */
ALTER TABLE foreign_trade ADD COLUMN IF NOT EXISTS cycle_no INT DEFAULT 0;

/* ------------------------------------------------------------- the world

   Real coastlines, invented countries. A territory is one shape on the map,
   identified by the numeric code in docs/world-map.js, and it belongs to at
   most one power — which is what the primary key on `code` says, so two powers
   cannot claim the same ground and no application code has to check.

   Unclaimed territory is simply an absent row. There is no "neutral power"
   holding the rest of the world, because a neutral power would need an account,
   a standing and a cabinet, and the map would start by lying about how many
   states exist. */
CREATE TABLE IF NOT EXISTS territories (
  code       TEXT PRIMARY KEY,
  power_id   INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_territories_power ON territories(power_id);

/* The Republic is not a foreign power and therefore must never be represented
   by a row in `powers`. Starting territory assigned by the Returning Officer is
   kept separately. A code may appear in only one of the two territory tables;
   the admin routes enforce that cross-table rule. */
CREATE TABLE IF NOT EXISTS republic_territories (
  code        TEXT PRIMARY KEY,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  assigned_by INT REFERENCES users(id) ON DELETE SET NULL
);

/* Subdivision-level starting territory. `country_code` is the existing opaque
   M49 map code; `subdivision_code` is an ISO 3166-2 code. The old whole-country
   table stays in place so an existing deployment upgrades without losing data. */
CREATE TABLE IF NOT EXISTS republic_subdivisions (
  subdivision_code TEXT PRIMARY KEY,
  country_code     TEXT NOT NULL,
  assigned_at      TIMESTAMPTZ DEFAULT now(),
  assigned_by      INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_republic_subdivisions_country ON republic_subdivisions(country_code);

/* Foreign powers can also hold subdivisions. Whole-country rows in `territories`
   remain as a backwards-compatible legacy representation. ISO subdivision codes
   are globally unique, so the primary key also prevents two powers owning the
   same subdivision. Cross-checks against Republic ownership live in the admin
   assignment routes. */
CREATE TABLE IF NOT EXISTS foreign_subdivisions (
  subdivision_code TEXT PRIMARY KEY,
  country_code     TEXT NOT NULL,
  power_id         INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  assigned_at      TIMESTAMPTZ DEFAULT now(),
  assigned_by      INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_foreign_subdivisions_country ON foreign_subdivisions(country_code);
CREATE INDEX IF NOT EXISTS idx_foreign_subdivisions_power ON foreign_subdivisions(power_id);

/* ------------------------------------------------- the intelligence service

   FRAMEWORK ONLY. The tables and the rules about who may see what are here;
   collection, analysis and any actual secrets are not built yet. This exists so
   that when they are, the hard questions are already answered rather than
   improvised under pressure.

   The hard question is this. Everything else in the Republic is on the public
   record — that is the point of it, and every other secrecy exception has been
   refused. An intelligence service is the one thing that cannot work that way
   and also be a spy service. So the compromise is drawn deliberately narrow:

     - WHAT is secret: the content of a report, and only for a fixed number of
       cycles set in `declassify_after_cycles`. Nothing is secret forever.
     - WHAT IS NEVER SECRET: that a report exists, when it was filed, who filed
       it, who read it, and what it cost. `intel_reads` is an open register.
       Anyone may see that the Director briefed the Prime Minister on Tuesday;
       only the cleared may see what was said.
     - Secrecy is a delay, not a vault. Every report declassifies itself onto
       the public record. A service whose files never open is a service that
       cannot be held to account for lying in them. */

CREATE TABLE IF NOT EXISTS intel_service (
  id                      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  established_bill_id     INT REFERENCES bills(id) ON DELETE SET NULL,
  charter                 TEXT NOT NULL DEFAULT '',
  declassify_after_cycles INT NOT NULL DEFAULT 3,
  budget_per_cycle        BIGINT NOT NULL DEFAULT 0,
  abolished_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now()
);

/* Who may read a secret while it is secret. A row here, and nothing else, is
   clearance — offices do not confer it by themselves, so "the Prime Minister
   can obviously see everything" has to be written down and can be revoked. */
CREATE TABLE IF NOT EXISTS intel_clearance (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by INT REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL DEFAULT '',
  since      TIMESTAMPTZ DEFAULT now(),
  until      TIMESTAMPTZ
);

/* A filed report. `body` is withheld until `declassifies_at_cycle`; everything
   else about it is public from the moment it exists.

   `confidence` and `sourcing` are not decoration. Intelligence that arrives as
   plain fact makes for a bad game and worse politics: the interesting decisions
   come from acting on something that is probably true. A report that cannot be
   wrong is not intelligence, it is an oracle. */
CREATE TABLE IF NOT EXISTS intel_reports (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE,
  power_id              INT REFERENCES powers(id) ON DELETE SET NULL,
  subject               TEXT NOT NULL,
  body                  TEXT NOT NULL DEFAULT '',
  confidence            TEXT NOT NULL DEFAULT 'moderate',  -- low | moderate | high
  sourcing              TEXT NOT NULL DEFAULT '',          -- how it was come by, in the open
  filed_by              INT REFERENCES users(id) ON DELETE SET NULL,
  filed_cycle           INT,
  declassifies_at_cycle INT,
  declassified          BOOLEAN NOT NULL DEFAULT FALSE,
  was_accurate          BOOLEAN,                            -- settled after the fact, in public
  created_at            TIMESTAMPTZ DEFAULT now()
);

/* The open register of who read what. Public even while the report is not. */
CREATE TABLE IF NOT EXISTS intel_reads (
  report_id BIGINT REFERENCES intel_reports(id) ON DELETE CASCADE,
  user_id   INT REFERENCES users(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_intel_reports_cycle ON intel_reports(declassifies_at_cycle);
