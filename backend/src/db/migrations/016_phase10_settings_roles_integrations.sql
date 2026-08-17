-- =============================================================================
-- Phase 10 — Settings, admin roles, integrations & audit
--
-- Replaces the single JSONB settings blob with typed, grouped keys; gives the
-- admin more than one user; and adds the outbound webhook delivery log the
-- integrations story depends on.
--
-- The `settings` table itself is kept — dozens of call sites read it, and the
-- brief asks for real screens, not a new storage engine. What changes is that a
-- key now has a group, a type and a description, so a screen can be generated
-- from the data rather than hand-written per field.
-- =============================================================================

-- --- settings ---------------------------------------------------------------

ALTER TABLE settings ADD COLUMN IF NOT EXISTS group_key   TEXT NOT NULL DEFAULT 'general';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS label       TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();
-- A secret is never returned to the browser in full — the API sends a masked
-- hint and accepts a replacement. Without this flag every settings screen has to
-- remember which keys are dangerous, and one day one of them will not.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS is_secret   BOOLEAN NOT NULL DEFAULT false;

INSERT INTO settings (key, value, group_key, label, description) VALUES
  ('drip',            '{"releaseTime":"06:00","timezone":"America/New_York"}', 'delivery',  'Drip release time',      'When newly unlocked lessons become available'),
  ('checkout',        '{"brandColor":"","supportEmail":"","termsUrl":"","showCoupons":true}', 'payments', 'Checkout', 'How the checkout page looks and what it collects'),
  ('customer_payments','{"sendReceipts":true,"accessOnCancel":"period_end","graceDays":3}', 'payments', 'Customer payments', 'Receipts, and what happens when someone cancels'),
  ('tax',             '{"enabled":false,"defaultRateBps":0,"rates":[]}',      'payments',  'Sales tax',              'Whether tax is collected and at what rate'),
  ('marketing_email', '{"fromName":"","fromEmail":"","replyTo":"","address":"","footer":""}', 'email', 'Marketing email', 'The from-name and physical address every marketing email must carry'),
  ('email_provider',  '{"provider":"smtp","webhookSecret":""}',              'email',     'Email delivery',         'Which service sends mail and reports opens'),
  ('member_signin',   '{"magicLinkEnabled":false,"requireVerifiedEmail":false}', 'members', 'Member sign-in',       'How customers sign in'),
  ('scheduling',      '{"minNoticeHours":24,"cancelWindowHours":24,"timezone":"America/New_York"}', 'coaching', 'Scheduling', 'Booking and cancellation windows'),
  ('form_settings',   '{"spamProtection":"honeypot","turnstileSiteKey":"","turnstileSecret":""}', 'marketing', 'Forms', 'Spam protection for public forms'),
  ('seo',             '{"allowIndexing":false,"defaultTitle":"","defaultDescription":"","ogImage":""}', 'website', 'Search engines', 'What search engines see'),
  ('branding',        '{"logoUrl":"","faviconUrl":"","primaryColor":"","fontHeading":"","fontBody":""}', 'website', 'Branding', 'Logo, colours and fonts'),
  ('notifications',   '{"notifyEmail":"","onSale":true,"onLead":true,"onDispute":true,"onJobFailure":true}', 'general', 'Notifications', 'What Yvette is emailed about'),
  ('analytics',       '{"ga4MeasurementId":"","metaPixelId":"","metaAccessToken":""}', 'integrations', 'Analytics', 'Google and Meta tracking')
ON CONFLICT (key) DO UPDATE
  SET group_key   = EXCLUDED.group_key,
      label       = EXCLUDED.label,
      description = EXCLUDED.description;

-- --- admin users & roles ----------------------------------------------------

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','invited','suspended'));
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
-- TOTP. `mfa_secret` is only meaningful while `mfa_enabled` is true; it is
-- written at enrolment and confirmed by a first successful code.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mfa_enabled   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mfa_secret    TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mfa_confirmed_at TIMESTAMPTZ;

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('owner','admin','marketing','support','coach'));

-- The existing single admin is the owner: it is the account that has been
-- running the business, and demoting it on deploy would lock Yvette out of her
-- own settings.
UPDATE admin_users SET role = 'owner' WHERE role = 'admin'
  AND id = (SELECT min(id) FROM admin_users);

/** Recovery codes, stored hashed and single-use — the same rules as every other token here. */
CREATE TABLE admin_mfa_recovery_codes (
  id            SERIAL PRIMARY KEY,
  admin_user_id INT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_invites (
  id            SERIAL PRIMARY KEY,
  email         CITEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'support',
  token_hash    TEXT UNIQUE NOT NULL,
  invited_by    INT REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/**
 * Admin sessions, so a session can be listed and revoked.
 *
 * The admin token is a stateless 7-day JWT today, which cannot be revoked at
 * all — signing somebody out means rotating the secret and signing everybody
 * out. This is the record the revoke list checks against.
 */
CREATE TABLE admin_sessions (
  id            BIGSERIAL PRIMARY KEY,
  admin_user_id INT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    TEXT UNIQUE NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_sessions_user ON admin_sessions (admin_user_id, revoked_at);

-- --- outbound webhooks ------------------------------------------------------

CREATE TABLE webhook_endpoints (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL,
  -- Events this endpoint wants. Empty = everything.
  event_types   TEXT[] NOT NULL DEFAULT '{}',
  -- Payloads are signed with this; shown once at creation and never again.
  signing_secret TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  -- Disabled automatically after this many consecutive failures, so a dead
  -- endpoint stops consuming the queue forever.
  consecutive_failures INT NOT NULL DEFAULT 0,
  disabled_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id            BIGSERIAL PRIMARY KEY,
  endpoint_id   INT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','delivered','failed','dead')),
  attempts      INT NOT NULL DEFAULT 0,
  response_status INT,
  response_body TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  next_attempt_at TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_deliveries_pending
  ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_webhook_deliveries_endpoint
  ON webhook_deliveries (endpoint_id, created_at DESC);

/** API keys for the Zapier-compatible REST surface. Hashed, like every other credential. */
CREATE TABLE api_keys (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  key_hash      TEXT UNIQUE NOT NULL,
  -- The first characters, shown in the list so a key can be identified without
  -- being recoverable.
  key_prefix    TEXT NOT NULL DEFAULT '',
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  created_by    INT REFERENCES admin_users(id) ON DELETE SET NULL,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- reporting rollups (Phase 9's foundation) -------------------------------

/**
 * Pre-aggregated daily metrics.
 *
 * The 35 reports the brief asks for all slice the same handful of facts by day.
 * Computing each from `transactions` and `orders` on every page view is what
 * makes a reports screen that takes ten seconds to paint; a nightly rollup keeps
 * them instant, and the raw tables stay the source of truth for anything that
 * needs re-deriving.
 */
CREATE TABLE report_daily (
  day           DATE NOT NULL,
  metric        TEXT NOT NULL,
  -- Optional breakdown: an offer id, a country, a payment method.
  dimension     TEXT NOT NULL DEFAULT '',
  value_cents   BIGINT NOT NULL DEFAULT 0,
  value_count   INT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'usd',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, metric, dimension)
);

CREATE INDEX idx_report_daily_metric ON report_daily (metric, day DESC);

/** A saved view of a report — the date range, comparison and breakdown chosen. */
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS slug        CITEXT;
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS created_by  INT REFERENCES admin_users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_reports_slug ON saved_reports (slug) WHERE slug IS NOT NULL;
