-- =============================================================================
-- Phase 1 — Member identity & account
--
-- Before this migration the platform had exactly one identity concept: the
-- admin. `members` existed, but only as an admin-authored record with no way to
-- authenticate as one. This adds real customer-facing identity.
--
-- Forward-only. Additive: no existing column is dropped or retyped in a way
-- that could lose a row. `members` currently holds 0 rows, so widening
-- `email` to citext is free here and would not be on a populated table.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- --- members ----------------------------------------------------------------

-- Case-insensitive email is the whole point of citext: "Yvette@x.com" and
-- "yvette@x.com" are one person, and the UNIQUE index must agree. Doing this
-- with lower() expressions instead would mean every lookup site had to
-- remember to call lower() — one omission reintroduces the duplicate.
ALTER TABLE members ALTER COLUMN email TYPE CITEXT;

ALTER TABLE members ADD COLUMN IF NOT EXISTS password_hash     TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS first_name        TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_name         TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_url        TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS timezone          TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE members ADD COLUMN IF NOT EXISTS locale            TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ;

-- The admin screens have always written 'active' | 'invited' | 'cancelled';
-- the member flows need 'suspended' and 'deleted'. Both vocabularies are
-- accepted so the existing admin code keeps working unchanged.
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_status_check;
ALTER TABLE members ADD CONSTRAINT members_status_check
  CHECK (status IN ('active', 'invited', 'cancelled', 'suspended', 'deleted'));

-- `name` predates first_name/last_name and the admin list still reads it.
-- Keep it as the display name and derive it when the member edits their
-- profile, rather than dropping a column the admin UI depends on.
COMMENT ON COLUMN members.name IS
  'Display name. Derived from first_name + last_name when set through the member account screens.';

-- --- sessions ---------------------------------------------------------------

-- Opaque refresh tokens, stored only as a hash: a database leak must not hand
-- the attacker a working session. `previous_id` is what makes reuse detection
-- possible — see the rotation rules in routes/public/memberAuth.ts.
CREATE TABLE IF NOT EXISTS member_sessions (
  id            BIGSERIAL PRIMARY KEY,
  member_id     INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash    TEXT UNIQUE NOT NULL,
  previous_id   BIGINT REFERENCES member_sessions(id) ON DELETE SET NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions (member_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_member_sessions_expiry ON member_sessions (expires_at);

-- --- single-use, hashed, TTL'd tokens ---------------------------------------

CREATE TABLE IF NOT EXISTS member_password_resets (
  id          BIGSERIAL PRIMARY KEY,
  member_id   INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_password_resets_member
  ON member_password_resets (member_id, used_at);

CREATE TABLE IF NOT EXISTS member_email_verifications (
  id          BIGSERIAL PRIMARY KEY,
  member_id   INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The address being proved. Held separately from members.email so the same
  -- table can verify an email *change* without mutating the account first.
  email       CITEXT NOT NULL,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_email_verifications_member
  ON member_email_verifications (member_id, used_at);

-- Passwordless sign-in, gated behind a setting (see settings key
-- `member_signin.magic_link_enabled`). Same single-use hashed shape as above.
CREATE TABLE IF NOT EXISTS member_magic_links (
  id          BIGSERIAL PRIMARY KEY,
  member_id   INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- login throttling -------------------------------------------------------

-- express-rate-limit keeps its counters in process memory, which resets on
-- every deploy and is not shared across replicas. Credential stuffing is worth
-- a durable counter, so login attempts are recorded here and the limit is
-- evaluated against the table.
CREATE TABLE IF NOT EXISTS member_login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  email       CITEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  successful  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_login_attempts_window
  ON member_login_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_login_attempts_email
  ON member_login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_login_attempts_ip
  ON member_login_attempts (ip, created_at DESC);

-- --- admin audit log --------------------------------------------------------

-- Phase 10 expands this to every admin mutation. It exists now because Phase 1
-- introduces impersonation ("view as member"), and an impersonation feature
-- without an audit trail is a liability rather than a feature.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  admin_user_id INT REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_email   TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL DEFAULT '',
  entity_id     TEXT NOT NULL DEFAULT '',
  before_state  JSONB,
  after_state   JSONB,
  ip            TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_time ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity
  ON admin_audit_log (entity_type, entity_id, created_at DESC);
