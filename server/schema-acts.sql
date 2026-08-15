-- The Judicial Enforcement Act and The Creation of an Economy Act.
-- Safe to run repeatedly. Loaded automatically after the main schema.

/* ---------------------------------------------------------- the judiciary */

-- Justices are held in the existing offices table under office = 'justice',
-- so impeachment, the record and the chamber all work on them unchanged.
-- This only records who is entitled to fill each seat.
CREATE TABLE IF NOT EXISTS court_seats (
  seat        INT PRIMARY KEY,                  -- 1, 2, 3
  appointer   TEXT NOT NULL,                    -- house | president | people
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  appointed_at TIMESTAMPTZ,
  term_ends   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cases (
  id           SERIAL PRIMARY KEY,
  ref          TEXT UNIQUE,
  title        TEXT NOT NULL,
  claim        TEXT NOT NULL,                   -- what the citizen says is wrong
  brought_by   INT REFERENCES users(id) ON DELETE SET NULL,
  target_kind  TEXT NOT NULL,                   -- law | bill | act
  target_law_id  INT,
  target_bill_id INT,
  target_note  TEXT DEFAULT '',                 -- for an act of an officer
  status       TEXT DEFAULT 'open',             -- open | upheld | dismissed | withdrawn
  ruling       TEXT,                            -- the Court's reasons
  ruled_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_votes (
  case_id INT REFERENCES cases(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  vote    TEXT NOT NULL,                        -- uphold | dismiss
  reason  TEXT DEFAULT '',
  at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);

/* ------------------------------------------------------------ the economy */

CREATE TABLE IF NOT EXISTS accounts (
  id         SERIAL PRIMARY KEY,
  owner_kind TEXT NOT NULL,                     -- citizen | business | treasury | fed | bank | escrow | power
  owner_id   INT,
  balance    BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_kind, owner_id)
);

-- The ledger is the truth. Balances are a running total of it and nothing else.
CREATE TABLE IF NOT EXISTS ledger (
  id         SERIAL PRIMARY KEY,
  from_id    INT REFERENCES accounts(id),
  to_id      INT REFERENCES accounts(id),
  amount     BIGINT NOT NULL CHECK (amount > 0),
  kind       TEXT NOT NULL,                     -- dividend | salary | tax | transfer | purchase | escrow | refund | fee
  note       TEXT DEFAULT '',
  at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS businesses (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  form        TEXT DEFAULT 'sole',              -- sole | company | coop
  description TEXT DEFAULT '',
  good_category TEXT,                         -- optional strategic goods mode category
  founder_id  INT REFERENCES users(id) ON DELETE SET NULL,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_members (
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE IF NOT EXISTS listings (
  id          SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  good_category TEXT,                         -- snapshot of the producer category
  unit        TEXT DEFAULT 'unit',
  price       BIGINT NOT NULL CHECK (price >= 0),
  stock       INT,                              -- NULL = unlimited
  withdrawn   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Money is held by the state between purchase and delivery, so neither side
-- has to trust the other. A dispute goes to the Court.
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  listing_id  INT REFERENCES listings(id) ON DELETE SET NULL,
  business_id INT REFERENCES businesses(id) ON DELETE SET NULL,
  buyer_id    INT REFERENCES users(id) ON DELETE SET NULL,
  price       BIGINT NOT NULL,
  status      TEXT DEFAULT 'escrow',            -- escrow | delivered | refunded | disputed
  case_id     INT REFERENCES cases(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  settled_at  TIMESTAMPTZ
);

-- What the Treasury paid out, so a cycle's dividend is never paid twice.
CREATE TABLE IF NOT EXISTS payruns (
  id       SERIAL PRIMARY KEY,
  kind     TEXT NOT NULL,                       -- dividend | salary | tax
  cycle_no INT,
  detail   TEXT DEFAULT '',
  at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (kind, cycle_no)
);

-- Article 8 of the Economy Act: office is public, and so is what it owns.
CREATE TABLE IF NOT EXISTS declarations (
  id      SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  body    TEXT NOT NULL,
  at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_from ON ledger(from_id);
CREATE INDEX IF NOT EXISTS idx_ledger_to   ON ledger(to_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

/* ------------------------------------- Part 4: banking, Part 5: the market */

-- One deposit balance per citizen at the public bank.
CREATE TABLE IF NOT EXISTS deposits (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  amount  BIGINT DEFAULT 0,
  since   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loans (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  principal   BIGINT NOT NULL,
  outstanding BIGINT NOT NULL,
  rate        NUMERIC NOT NULL,
  due_cycle   INT,
  status      TEXT DEFAULT 'open',      -- open | repaid | default
  case_id     INT REFERENCES cases(id) ON DELETE SET NULL,
  taken_at    TIMESTAMPTZ DEFAULT now(),
  settled_at  TIMESTAMPTZ
);

-- Shares. The issue lives on the business; the holdings are one row per holder.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS shares_issued BIGINT DEFAULT 0;

CREATE TABLE IF NOT EXISTS holdings (
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  holder_id   INT REFERENCES users(id) ON DELETE CASCADE,
  qty         BIGINT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (business_id, holder_id)
);

-- A limit order book. Money for a bid and shares for an ask are both reserved
-- when the order is placed, so nothing can be sold or bought twice over.
CREATE TABLE IF NOT EXISTS share_orders (
  id          SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  side        TEXT NOT NULL,            -- bid | ask
  price       BIGINT NOT NULL CHECK (price > 0),
  qty         BIGINT NOT NULL CHECK (qty > 0),
  remaining   BIGINT NOT NULL,
  status      TEXT DEFAULT 'open',      -- open | filled | cancelled
  placed_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  id          SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  buyer_id    INT REFERENCES users(id) ON DELETE SET NULL,
  seller_id   INT REFERENCES users(id) ON DELETE SET NULL,
  price       BIGINT NOT NULL,
  qty         BIGINT NOT NULL,
  at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_book ON share_orders(business_id, side, status);
CREATE INDEX IF NOT EXISTS idx_trades_biz  ON trades(business_id);

-- Strategic goods mode is additive so existing installations upgrade in place.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS good_category TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS good_category TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'unit';

-- A citizen actually owns strategic goods after delivery/payment. The source is
-- deliberately generic: domestic listings and foreign offers live in different
-- schemas, but both resolve to one stack in the citizen's inventory.
CREATE TABLE IF NOT EXISTS inventory_items (
  id            BIGSERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  good_category TEXT NOT NULL,
  unit          TEXT DEFAULT 'unit',
  quantity      INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  source_kind   TEXT NOT NULL,              -- domestic_listing | foreign_offer
  source_id     BIGINT NOT NULL,
  source_name   TEXT DEFAULT '',
  acquired_at   TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_id, source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory_items(owner_id);
