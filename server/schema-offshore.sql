-- Offshore money, foreign exchange and defection.
--
-- Safe to run repeatedly, and additive only. Loaded last, after the diplomacy
-- and war schemas, because everything here hangs off a foreign power and
-- because the defection triggers are attached to ballot boxes defined in every
-- schema above.
--
-- There are deliberately NO foreign keys to `powers`, `foreign_trade`,
-- `treaties` or `conflict_pressure`. Every module in this Republic can be
-- removed from the build and the rest still boots; a hard reference here would
-- mean that deleting diplomacy.js takes the Treasury down with it. offshore.js
-- checks `to_regclass` before it reads those tables and says so plainly when
-- they are not there, which is the honest state of affairs in a Republic with
-- no foreign relations.

/* ------------------------------------------------------- offshore accounts

   An offshore account is a REAL account in the same closed ledger, owned by a
   citizen but held at a foreign power: owner_kind='offshore' with
   owner_id = offshore_accounts.id. Money put into one has MOVED, not vanished,
   and sum(accounts.balance) is untouched by every operation on it.

   What changes is who can see it and who can reach it. It does not appear in
   the citizen's public account on /api/economy, and the tax payrun reads
   owner_kind='citizen' and so cannot see it either. That is the whole feature:
   opacity, not disappearance.

   One account per citizen per power, by the key — a citizen who could open
   fifteen accounts at the same haven would only be making the register longer,
   not the game deeper. */
CREATE TABLE IF NOT EXISTS offshore_accounts (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  power_id      INT NOT NULL,
  frozen_at     TIMESTAMPTZ,
  frozen_reason TEXT NOT NULL DEFAULT '',
  opened_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, power_id)
);

CREATE INDEX IF NOT EXISTS idx_offshore_power ON offshore_accounts(power_id);

/* A haven that has agreed, by treaty, to say what it holds. The treaty is a
   bill like any other, so this row is only ever written from the enactment
   hook. Once a power discloses, its holdings are on the public record and it
   has stopped being a haven — which is exactly what the Republic negotiated for
   and exactly what the account holders were afraid of. */
CREATE TABLE IF NOT EXISTS offshore_havens (
  power_id   INT PRIMARY KEY,
  discloses  BOOLEAN NOT NULL DEFAULT FALSE,
  treaty_id  BIGINT,
  bill_id    INT,
  since      TIMESTAMPTZ DEFAULT now()
);

/* An inquiry is the House ordering the intelligence service to say who holds
   what abroad. It is a bill, and what it produces is an ordinary sealed intel
   report: cleared readers only, declassifying on the clock, and every read
   written to the open register. Nothing here is a new kind of secrecy — it is
   the machinery diplomacy.js already built, pointed at our own citizens, which
   is the part the House should have to vote for out loud.

   `clearances` is the list of user ids the bill clears to read the thing, fixed
   when it is proposed so that the House votes on a text that names them. */
CREATE TABLE IF NOT EXISTS offshore_inquiries (
  id          SERIAL PRIMARY KEY,
  bill_id     INT NOT NULL UNIQUE REFERENCES bills(id) ON DELETE CASCADE,
  power_id    INT,                       -- NULL = every haven
  clearances  TEXT NOT NULL DEFAULT '',  -- comma-separated user ids
  report_id   BIGINT,
  note        TEXT NOT NULL DEFAULT '',
  executed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

/* A seizure is the House taking what a citizen holds abroad. It is a bill, and
   it can fail on contact with reality: a haven that has frozen the account
   simply does not hand it over, and the row records what could not be reached
   rather than pretending the money arrived. */
CREATE TABLE IF NOT EXISTS offshore_seizures (
  id          SERIAL PRIMARY KEY,
  bill_id     INT NOT NULL UNIQUE REFERENCES bills(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  power_id    INT,                       -- NULL = every haven this citizen uses
  taken       BIGINT NOT NULL DEFAULT 0,
  unreachable BIGINT NOT NULL DEFAULT 0,
  executed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

/* ------------------------------------------------------- foreign exchange

   `rate` is units of the power's currency for one of ours: higher means our
   money buys more of theirs. It moves once a cycle, in the payrun, by a bounded
   step, and only for the three published reasons recorded in `forex_rates`.

   `trade_seen_id` and `issued_seen` are the high-water marks the last fixing
   read. Keeping them here rather than reading "this cycle's trade" means a
   fixing counts every deal exactly once even when the cycle clock is stopped,
   and means a payrun run twice cannot count the same export twice. */
CREATE TABLE IF NOT EXISTS currencies (
  power_id      INT PRIMARY KEY,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  rate          NUMERIC NOT NULL DEFAULT 1 CHECK (rate > 0),
  trade_seen_id BIGINT NOT NULL DEFAULT 0,
  issued_seen   BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

/* The published record of every move, with the inputs that caused it. A rate
   nobody can predict is a casino; this table is the difference. One row per
   power per cycle, by the key, so a payrun run twice moves nothing twice. */
CREATE TABLE IF NOT EXISTS forex_rates (
  id            BIGSERIAL PRIMARY KEY,
  power_id      INT NOT NULL,
  cycle_no      INT NOT NULL,
  rate_before   NUMERIC NOT NULL,
  rate_after    NUMERIC NOT NULL,
  trade_balance BIGINT NOT NULL DEFAULT 0,   -- our exports to them less our imports
  pressure      NUMERIC NOT NULL DEFAULT 0,  -- conflict pressure, +ve means they prevail
  issuance      BIGINT NOT NULL DEFAULT 0,   -- marks the Fed issued since the last fixing
  signal        NUMERIC NOT NULL DEFAULT 0,  -- the weighted sum, -1 .. 1
  note          TEXT NOT NULL DEFAULT '',
  at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (power_id, cycle_no)
);

/* What a citizen holds in somebody else's money. This is NOT part of the closed
   ledger and must never be: it is a claim on a foreign power, not a mark. The
   marks paid for it went to that power's account and are still in the ledger,
   which is why `sum(accounts.balance)` does not notice a conversion at all.

   CHECK (units >= 0) for the same reason the stockpile has one: selling what
   you do not hold should fail loudly rather than clamp. */
CREATE TABLE IF NOT EXISTS fx_holdings (
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  power_id INT NOT NULL,
  units    BIGINT NOT NULL DEFAULT 0 CHECK (units >= 0),
  since    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, power_id)
);

CREATE TABLE IF NOT EXISTS fx_trades (
  id       BIGSERIAL PRIMARY KEY,
  user_id  INT REFERENCES users(id) ON DELETE SET NULL,
  power_id INT NOT NULL,
  side     TEXT NOT NULL,              -- buy | sell, of the foreign currency
  marks    BIGINT NOT NULL,            -- what left or reached the citizen's account
  units    BIGINT NOT NULL,
  spread   BIGINT NOT NULL DEFAULT 0,  -- the power's cut, in marks
  rate     NUMERIC NOT NULL,
  at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_trades_user ON fx_trades(user_id);

/* ------------------------------------------------------------- defection

   A citizen renouncing the Republic and joining a foreign power. Article 1.2
   ties citizenship to membership of the Group, so this has to be an explicit
   act with an explicit route rather than something that happens by side effect.

   `status` is 'defected' or 'returned'. The partial unique index means a
   citizen can be the subject of at most one foreign power at a time —
   allegiance, like a vote, is single by database constraint and not by
   application code. */
CREATE TABLE IF NOT EXISTS defections (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  power_id        INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'defected',   -- defected | returned
  reasons         TEXT NOT NULL DEFAULT '',
  offices_lost    TEXT NOT NULL DEFAULT '',
  sequestered     BIGINT NOT NULL DEFAULT 0,          -- what was frozen, at the moment it froze
  returned_cost   BIGINT NOT NULL DEFAULT 0,
  renounced_at    TIMESTAMPTZ DEFAULT now(),
  renounced_cycle INT,
  returned_at     TIMESTAMPTZ,
  return_bill_id  INT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_defection_one_live
  ON defections(user_id) WHERE status = 'defected';

/* Readmission is a bill: the House takes a subject of a foreign power back, or
   it does not. Permanent exile ends somebody's game and this is nineteen
   friends, so the route exists — but it costs, and the House votes on it. */
CREATE TABLE IF NOT EXISTS defection_returns (
  id           SERIAL PRIMARY KEY,
  bill_id      INT NOT NULL UNIQUE REFERENCES bills(id) ON DELETE CASCADE,
  defection_id INT NOT NULL REFERENCES defections(id) ON DELETE CASCADE,
  executed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

/* ---------------------------------------------------------- the two bars

   Both of these are triggers rather than checks in offshore.js, and that is the
   whole point of them. One person, one vote is held by database constraints and
   that is the reason anyone believes a result; a rule that lives in one module's
   permission check is a rule that the next endpoint somebody writes will
   forget. These hold against every endpoint in the Republic, including the ones
   that do not exist yet.

   SQLSTATE 'RP001' is the Republic's own: a rule the database holds, raised
   with the sentence a citizen should read. server.js turns it into a 400 with
   that sentence rather than a 500 and a stack trace. */

/* Bar one: a citizen with a live defection holds no vote, no seat, no
   candidacy and no signature. Defection is the obvious attack on one person one
   vote — renounce, be counted as a foreign subject, and keep a ballot here — so
   the bar is a constraint, on every ballot box at once. */
CREATE OR REPLACE FUNCTION republic_refuse_defector() RETURNS trigger AS $$
DECLARE uid INT;
BEGIN
  uid := (to_jsonb(NEW) ->> TG_ARGV[0])::int;
  IF uid IS NOT NULL AND EXISTS (
       SELECT 1 FROM defections d WHERE d.user_id = uid AND d.status = 'defected')
  THEN
    RAISE EXCEPTION
      'A citizen who has renounced the Republic holds no vote, no seat and no signature in it.'
      USING ERRCODE = 'RP001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  pairs TEXT[][] := ARRAY[
    ['votes','voter_id'],
    ['referendum_votes','user_id'],
    ['challenge_votes','user_id'],
    ['bill_votes','user_id'],
    ['bill_seconds','user_id'],
    ['bill_petitions','user_id'],
    ['petitions','user_id'],
    ['supermajority_signatures','user_id'],
    ['emergency_end_votes','user_id'],
    ['fed_confirmations','user_id'],
    ['pm_confirmations','user_id'],
    ['no_confidence','user_id'],
    ['case_votes','user_id'],
    ['candidacies','user_id'],
    ['offices','user_id']
  ];
  i INT;
  t TEXT;
  c TEXT;
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    t := pairs[i][1];
    c := pairs[i][2];
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS republic_no_defector ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER republic_no_defector BEFORE INSERT ON %I
           FOR EACH ROW EXECUTE PROCEDURE republic_refuse_defector(%L)', t, c);
    END IF;
  END LOOP;
END $$;

/* Bar two: "domestic holdings frozen pending a bill" has to mean something
   stronger than a sweep at the moment of renunciation, or a defector withdraws
   their bank deposit the minute after and spends it.

   Every movement of money in the Republic writes a ledger row — pay() and
   settle() both do, and that is the whole reason the ledger is the truth — so
   refusing a ledger row whose PAYER is a renouncer's citizen account freezes
   them out of every route at once, including routes written later.

   Only the payer, and only the citizen account. Money arriving is deliberately
   still allowed: a refund, an army's wages or a court-ordered payment should
   not bounce off a defector, and anything that lands there is money the House
   gets to argue about. Their offshore accounts are untouched — that is the
   bargain the roadmap describes, and the reason anyone would open one.

   There is no exemption, no session flag and no back door. The one key is
   readmission: the enactment hook flips the defection to 'returned' and only
   then takes the cost, in that order, inside one transaction. */
CREATE OR REPLACE FUNCTION republic_freeze_defector() RETURNS trigger AS $$
BEGIN
  IF NEW.from_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM accounts a
         JOIN defections d ON d.user_id = a.owner_id AND d.status = 'defected'
        WHERE a.id = NEW.from_id AND a.owner_kind = 'citizen')
  THEN
    RAISE EXCEPTION
      'That citizen has renounced the Republic. Their domestic holdings are frozen until the House says otherwise.'
      USING ERRCODE = 'RP001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.ledger') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS republic_freeze_defector ON ledger;
    CREATE TRIGGER republic_freeze_defector BEFORE INSERT ON ledger
      FOR EACH ROW EXECUTE PROCEDURE republic_freeze_defector();
  END IF;
END $$;
