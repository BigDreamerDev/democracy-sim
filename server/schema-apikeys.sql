-- Delegated credentials for third-party apps: a citizen hands one of these to
-- a stock ticker, a newspaper, a casino, whatever else people build, instead
-- of handing over their password. The raw key is never stored — only an HMAC
-- of it, checked on every request in attach() (server.js).

CREATE TABLE IF NOT EXISTS api_keys (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  -- Every key gets an implicit read scope just by being valid; this column
  -- holds only the extra, explicit scopes — right now just 'economy:pay' —
  -- comma-joined rather than a real array column, so nothing here depends on
  -- the array-parameter path of whichever Postgres client is in front.
  scopes        TEXT NOT NULL DEFAULT '',
  -- NULL means uncapped. A cap is "up to cap_amount per cap_window_ms",
  -- enforced by summing api_key_charges within the trailing window.
  cap_amount    BIGINT,
  cap_window_ms BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- Every economy:pay-scoped movement a key makes, so a spending cap can be
-- enforced against what the key has actually spent — not against whatever a
-- caller claims — the same reasoning that keeps money moving through pay()
-- rather than a hand-written UPDATE anywhere else in this codebase.
CREATE TABLE IF NOT EXISTS api_key_charges (
  id      SERIAL PRIMARY KEY,
  key_id  INT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  amount  BIGINT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_key_charges_key_at ON api_key_charges(key_id, at);
