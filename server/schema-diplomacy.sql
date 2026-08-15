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

/* A Republic seller can make a private commercial offer to one foreign
   government instead of waiting for that government to discover an ordinary
   public listing. Stock is reserved when the offer is filed and restored if it
   is rejected or cancelled, so accepting a stale offer can never create goods.
   `unit_price` is in the TARGET POWER'S currency; settlement converts at the
   live fixing when that government accepts. */
CREATE TABLE IF NOT EXISTS foreign_export_offers (
  id             BIGSERIAL PRIMARY KEY,
  power_id       INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  seller_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id    INT REFERENCES businesses(id) ON DELETE SET NULL,
  source_kind    TEXT NOT NULL CHECK (source_kind IN ('listing','inventory')),
  source_id      BIGINT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  good_category  TEXT NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'unit',
  quantity       INT NOT NULL CHECK (quantity > 0),
  unit_price     BIGINT NOT NULL CHECK (unit_price >= 0),
  note           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  trade_id       BIGINT REFERENCES foreign_trade(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  decided_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_foreign_export_offers_power ON foreign_export_offers(power_id,status,id);
CREATE INDEX IF NOT EXISTS idx_foreign_export_offers_seller ON foreign_export_offers(seller_user_id,status,id);

/* Goods bought directly from Republic sellers belong to the foreign power
   afterwards. This deliberately stays category/item based rather than
   pretending the foreign economy has factories or citizen inventories it does
   not otherwise simulate. */
CREATE TABLE IF NOT EXISTS foreign_goods_stockpile (
  power_id      INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  good_category TEXT NOT NULL,
  title         TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit',
  quantity      BIGINT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (power_id,good_category,title,unit)
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

/* A defector may hold one of a foreign government's own seats, played by
   themselves rather than a model. NULL for every seat still LLM-controlled,
   which is most of them, always. The partial unique index is the one-person-
   one-seat rule — held at the database, the same discipline "one person, one
   vote" gets in schema.sql, so nothing here has to trust application code to
   stop a citizen claiming a second crown while they already sit as somebody's
   minister. */
ALTER TABLE foreign_agents ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_foreign_agent_human_seat ON foreign_agents(user_id) WHERE user_id IS NOT NULL;

/* What a human-controlled seat submitted for the cycle currently being
   decided. One row per agent per cycle, so resubmitting before the turn runs
   simply replaces it. runGovernmentTurn reads this instead of calling a model
   for any agent with user_id set, and defaults to 'nothing' when nobody
   submitted before the turn ran — an AFK defector must not freeze a
   government the way an empty stockpile must not silently arm nobody. */
CREATE TABLE IF NOT EXISTS foreign_agent_submissions (
  agent_id     BIGINT NOT NULL REFERENCES foreign_agents(id),
  cycle_number INT NOT NULL,
  action_kind  TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale    TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, cycle_number)
);

/* A defector's request to hold a seat, queued when every cabinet role of
   their power's archetype is already claimed by another citizen. Nothing
   here resolves a queued petition automatically — same principle as a
   conflict never resolving itself: a foreign cabinet filling up around a
   petitioner is a fact for the RO to see, not an event for the server to
   decide on its own. */
CREATE TABLE IF NOT EXISTS foreign_role_petitions (
  id            BIGSERIAL PRIMARY KEY,
  power_id      INT NOT NULL REFERENCES powers(id),
  user_id       INT NOT NULL REFERENCES users(id),
  /* No FK to defections(id): that table belongs to schema-offshore.sql, which
     bootstrap() loads AFTER this file (offshore hangs off a foreign power and
     everything above it, diplomacy included). A forward reference here would
     break boot on a fresh database. The id is recorded for audit; nothing
     enforces it points at a real row. */
  defection_id  BIGINT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'cabinet', -- 'cabinet' | 'succession'
  desired_role  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
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

/* What the chosen action actually did, and what the government refused on the
   way there. Without it the Returning Officer can see that a turn happened and
   not what came of it, which is the whole of debugging a cabinet. */
ALTER TABLE foreign_government_turns ADD COLUMN IF NOT EXISTS result JSONB;

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
   happened in. A power account now represents that government's reserve of
   Republic marks; its domestic currency is tracked separately by offshore.sql. */
ALTER TABLE foreign_trade ADD COLUMN IF NOT EXISTS cycle_no INT DEFAULT 0;
ALTER TABLE foreign_trade ADD COLUMN IF NOT EXISTS foreign_units BIGINT NOT NULL DEFAULT 0;
ALTER TABLE foreign_trade ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;

/* -------------------------------------------- foreign intelligence services

   Foreign governments may create their own intelligence service and recruit
   actual players. Recruitment is private to the government and the player who
   receives it; accepting an offer is the consent boundary. A Republic citizen
   does not have to defect to spy for somebody, and a defector does not become
   an agent merely by defecting. */
CREATE TABLE IF NOT EXISTS foreign_intel_agencies (
  power_id          INT PRIMARY KEY REFERENCES powers(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  tradecraft        INT NOT NULL DEFAULT 0 CHECK (tradecraft >= 0),
  committed_budget  BIGINT NOT NULL DEFAULT 0 CHECK (committed_budget >= 0),
  established_cycle INT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  established_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_intel_recruitments (
  id              BIGSERIAL PRIMARY KEY,
  power_id        INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  codename        TEXT NOT NULL,
  pitch           TEXT NOT NULL DEFAULT '',
  signing_bonus   BIGINT NOT NULL DEFAULT 0 CHECK (signing_bonus >= 0),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  UNIQUE (power_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_foreign_intel_recruit_user ON foreign_intel_recruitments(user_id,status,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_foreign_intel_pending_recruit
  ON foreign_intel_recruitments(power_id,user_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS foreign_intel_agents (
  id             BIGSERIAL PRIMARY KEY,
  power_id       INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recruitment_id BIGINT REFERENCES foreign_intel_recruitments(id) ON DELETE SET NULL,
  codename       TEXT NOT NULL,
  experience     INT NOT NULL DEFAULT 0 CHECK (experience >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resigned','dismissed','burned')),
  recruited_at   TIMESTAMPTZ DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  UNIQUE (power_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_foreign_intel_agents_power ON foreign_intel_agents(power_id,status,id);
CREATE INDEX IF NOT EXISTS idx_foreign_intel_agents_user ON foreign_intel_agents(user_id,status,id);

CREATE TABLE IF NOT EXISTS foreign_intel_operations (
  id              BIGSERIAL PRIMARY KEY,
  power_id        INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  agent_id        BIGINT REFERENCES foreign_intel_agents(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  budget          BIGINT NOT NULL DEFAULT 0 CHECK (budget >= 0), -- local currency
  budget_marks    BIGINT NOT NULL DEFAULT 0 CHECK (budget_marks >= 0),
  cycle_no        INT,
  score           INT NOT NULL DEFAULT 0,
  threshold       INT NOT NULL DEFAULT 0,
  outcome         TEXT NOT NULL CHECK (outcome IN ('success','failed','burned')),
  report          TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (power_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_foreign_intel_ops_power ON foreign_intel_operations(power_id,id);

/* ------------------------------------------------ persistent relationships

   `powers.standing` remains the compact public label, but the durable state is
   directional. A NULL counterparty is this power's relationship with the
   Republic; a concrete counterparty is reserved for foreign-to-foreign ties. */
CREATE TABLE IF NOT EXISTS foreign_relations (
  id                    BIGSERIAL PRIMARY KEY,
  power_id              INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  counterparty_power_id INT REFERENCES powers(id) ON DELETE CASCADE,
  trust                  INT NOT NULL DEFAULT 0,
  fear                   INT NOT NULL DEFAULT 0,
  respect                INT NOT NULL DEFAULT 0,
  grievance              INT NOT NULL DEFAULT 0,
  trade_dependency       INT NOT NULL DEFAULT 0,
  ideological_affinity   INT NOT NULL DEFAULT 0,
  updated_cycle          INT NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ DEFAULT now(),
  CHECK (counterparty_power_id IS NULL OR counterparty_power_id <> power_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_foreign_relations_pair
  ON foreign_relations(power_id,COALESCE(counterparty_power_id,0));

CREATE TABLE IF NOT EXISTS foreign_relation_events (
  id                    BIGSERIAL PRIMARY KEY,
  power_id              INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  counterparty_power_id INT REFERENCES powers(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  summary               TEXT NOT NULL,
  trust_delta           INT NOT NULL DEFAULT 0,
  fear_delta            INT NOT NULL DEFAULT 0,
  respect_delta         INT NOT NULL DEFAULT 0,
  grievance_delta       INT NOT NULL DEFAULT 0,
  trade_delta           INT NOT NULL DEFAULT 0,
  public                BOOLEAN NOT NULL DEFAULT TRUE,
  cycle_no              INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_foreign_relation_events_pair
  ON foreign_relation_events(power_id,counterparty_power_id,id DESC);

/* ------------------------------------------------ executable treaty policy */
CREATE TABLE IF NOT EXISTS foreign_treaty_compliance (
  id          BIGSERIAL PRIMARY KEY,
  treaty_id   BIGINT NOT NULL REFERENCES treaties(id) ON DELETE CASCADE,
  cycle_no    INT NOT NULL,
  obligation  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('met','breached','waived')),
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (treaty_id,cycle_no,obligation)
);

ALTER TABLE foreign_conflicts ADD COLUMN IF NOT EXISTS measures JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS republic_sanctions (
  id           BIGSERIAL PRIMARY KEY,
  power_id     INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  bill_id      INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  lift_bill_id INT REFERENCES bills(id) ON DELETE SET NULL,
  measures     JSONB NOT NULL DEFAULT '{}'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  enacted_at   TIMESTAMPTZ,
  lifted_at    TIMESTAMPTZ,
  UNIQUE (bill_id)
);
CREATE INDEX IF NOT EXISTS idx_republic_sanctions_power ON republic_sanctions(power_id,active,id DESC);

/* ------------------------------------------------ embassies/private diplomacy */
CREATE TABLE IF NOT EXISTS foreign_embassies (
  power_id                    INT PRIMARY KEY REFERENCES powers(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed','recalled','expelled')),
  republic_ambassador_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  foreign_ambassador_name     TEXT NOT NULL DEFAULT '',
  opened_cycle                INT,
  updated_at                  TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS foreign_private_dispatches (
  id             BIGSERIAL PRIMARY KEY,
  power_id       INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  in_reply_to    BIGINT REFERENCES foreign_private_dispatches(id) ON DELETE SET NULL,
  author_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  leaked_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_foreign_private_dispatches_power ON foreign_private_dispatches(power_id,id DESC);

/* Foreign states can now talk to each other without routing every interaction
   through the Republic. Proposals require the other cabinet to accept/reject. */
CREATE TABLE IF NOT EXISTS foreign_bilateral_dispatches (
  id            BIGSERIAL PRIMARY KEY,
  from_power_id INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  to_power_id   INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  CHECK (from_power_id <> to_power_id)
);
CREATE TABLE IF NOT EXISTS foreign_bilateral_agreements (
  id              BIGSERIAL PRIMARY KEY,
  proposer_id     INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  counterparty_id INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('trade','non_aggression','mutual_defence','currency_swap')),
  title           TEXT NOT NULL,
  terms           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','denounced')),
  proposed_cycle  INT NOT NULL DEFAULT 0,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (proposer_id <> counterparty_id)
);
CREATE INDEX IF NOT EXISTS idx_foreign_bilateral_agreements_party
  ON foreign_bilateral_agreements(proposer_id,counterparty_id,status,id DESC);

CREATE TABLE IF NOT EXISTS foreign_bilateral_conflicts (
  id            BIGSERIAL PRIMARY KEY,
  aggressor_id  INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  target_id     INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('sanction','ultimatum','war')),
  grievance     TEXT NOT NULL,
  demands       TEXT NOT NULL DEFAULT '',
  measures      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','withdrawn')),
  outcome       TEXT NOT NULL DEFAULT '',
  cycle_no      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  CHECK (aggressor_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_foreign_bilateral_conflicts_pair
  ON foreign_bilateral_conflicts(aggressor_id,target_id,status,id DESC);

/* Foreign powers can hold one another's currencies for bilateral settlement. */
CREATE TABLE IF NOT EXISTS foreign_currency_reserves (
  holder_power_id   INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  currency_power_id INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  units             BIGINT NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (holder_power_id,currency_power_id),
  CHECK (holder_power_id <> currency_power_id)
);

/* ------------------------------------------------ foreign domestic economy & shipments */
CREATE TABLE IF NOT EXISTS foreign_economies (
  power_id            INT PRIMARY KEY REFERENCES powers(id) ON DELETE CASCADE,
  population_index    INT NOT NULL DEFAULT 100 CHECK (population_index > 0),
  consumption_scale   NUMERIC NOT NULL DEFAULT 1 CHECK (consumption_scale >= 0),
  last_cycle          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS foreign_production (
  power_id      INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  good_category TEXT NOT NULL,
  capacity      INT NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  base_price    BIGINT NOT NULL DEFAULT 10 CHECK (base_price >= 0),
  PRIMARY KEY (power_id,good_category)
);
CREATE TABLE IF NOT EXISTS foreign_economy_events (
  id            BIGSERIAL PRIMARY KEY,
  power_id      INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  cycle_no      INT NOT NULL,
  kind          TEXT NOT NULL,
  good_category TEXT,
  quantity      BIGINT NOT NULL DEFAULT 0,
  detail        TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreign_shipments (
  id                    BIGSERIAL PRIMARY KEY,
  origin_power_id       INT REFERENCES powers(id) ON DELETE SET NULL,
  destination_power_id  INT REFERENCES powers(id) ON DELETE SET NULL,
  republic_direction    TEXT CHECK (republic_direction IN ('import','export')),
  trade_id              BIGINT REFERENCES foreign_trade(id) ON DELETE SET NULL,
  recipient_user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  recipient_business_id INT REFERENCES businesses(id) ON DELETE SET NULL,
  recipient_stockpile    BOOLEAN NOT NULL DEFAULT FALSE,
  good_category         TEXT,
  title                 TEXT NOT NULL,
  unit                  TEXT NOT NULL DEFAULT 'unit',
  quantity              BIGINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  value_marks           BIGINT NOT NULL DEFAULT 0,
  departed_cycle        INT NOT NULL,
  eta_cycle             INT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','delayed','arrived','seized','lost')),
  risk                   INT NOT NULL DEFAULT 0,
  detail                 TEXT NOT NULL DEFAULT '',
  arrived_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_foreign_shipments_status ON foreign_shipments(status,eta_cycle,id);
CREATE TABLE IF NOT EXISTS foreign_bilateral_trade (
  id              BIGSERIAL PRIMARY KEY,
  buyer_power_id  INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  seller_power_id INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  good_category   TEXT NOT NULL,
  quantity        BIGINT NOT NULL CHECK (quantity > 0),
  seller_units    BIGINT NOT NULL DEFAULT 0,
  buyer_units     BIGINT NOT NULL DEFAULT 0,
  value_marks     BIGINT NOT NULL DEFAULT 0,
  cycle_no        INT NOT NULL,
  shipment_id     BIGINT REFERENCES foreign_shipments(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (buyer_power_id <> seller_power_id)
);



/* Crises are negotiations with a deadline rather than a one-shot declaration. */
CREATE TABLE IF NOT EXISTS diplomatic_crises (
  id             BIGSERIAL PRIMARY KEY,
  power_id       INT NOT NULL REFERENCES powers(id) ON DELETE CASCADE,
  conflict_id    BIGINT REFERENCES foreign_conflicts(id) ON DELETE SET NULL,
  treaty_id      BIGINT REFERENCES treaties(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  demand         TEXT NOT NULL,
  republic_offer TEXT NOT NULL DEFAULT '',
  foreign_reply  TEXT NOT NULL DEFAULT '',
  deadline_cycle INT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','offered','settled','failed','withdrawn')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_diplomatic_crises_power ON diplomatic_crises(power_id,status,id DESC);

ALTER TABLE foreign_intel_operations ADD COLUMN IF NOT EXISTS detected BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE foreign_intel_operations ADD COLUMN IF NOT EXISTS attributed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE foreign_intel_operations ADD COLUMN IF NOT EXISTS consequence TEXT NOT NULL DEFAULT '';
ALTER TABLE foreign_intel_agents ADD COLUMN IF NOT EXISTS loyalty INT NOT NULL DEFAULT 50;
ALTER TABLE foreign_intel_agents ADD COLUMN IF NOT EXISTS double_agent BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS foreign_agent_turns (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL REFERENCES foreign_intel_agents(id) ON DELETE CASCADE,
  offered_by   INT REFERENCES users(id) ON DELETE SET NULL,
  pitch        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_foreign_agent_turn_pending ON foreign_agent_turns(agent_id) WHERE status='pending';

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
   M49 map code; `subdivision_code` is an opaque subdivision id (`s0001`), NOT
   an ISO 3166-2 code — an ISO code names a real place on its own, and these
   rows are read straight out onto a public map. The pairing lives in
   server/subdivision-codes.json and never leaves the Returning Officer's
   routes.

   Deployments written before that change hold ISO codes here. They are
   renumbered by ensureOpaqueSubdivisionCodes() in diplomacy.js, on the first
   read after boot, because the mapping is a JSON file this schema cannot see.
   The old whole-country table stays in place so an existing deployment upgrades
   without losing data. */
CREATE TABLE IF NOT EXISTS republic_subdivisions (
  subdivision_code TEXT PRIMARY KEY,
  country_code     TEXT NOT NULL,
  assigned_at      TIMESTAMPTZ DEFAULT now(),
  assigned_by      INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_republic_subdivisions_country ON republic_subdivisions(country_code);

/* Foreign powers can also hold subdivisions. Whole-country rows in `territories`
   remain as a backwards-compatible legacy representation. Subdivision ids are
   globally unique, so the primary key also prevents two powers owning the same
   subdivision. Cross-checks against Republic ownership live in the admin
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
