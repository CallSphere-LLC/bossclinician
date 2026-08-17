-- =============================================================================
-- Phase 5 — Email sequences, broadcasts & the automation engine
--
-- Kajabi runs 142 automations and multi-email sequences for this business. The
-- platform has one-off campaigns and a six-action engine fired synchronously
-- from inside request handlers.
--
-- Deliverability is the part that decides whether any of it is worth building:
-- the admin currently reports opens and clicks as zero, and always will on raw
-- SMTP, because nothing reports back. `email_events` is where a provider's
-- webhooks land, and every open/click/bounce figure in Phase 9 reads from it.
-- =============================================================================

-- --- delivery ---------------------------------------------------------------

/**
 * One row per message the platform sends, transactional or marketing.
 *
 * The provider's own id is the join key for its webhooks. Without a single
 * table of sends there is nowhere for a bounce to land, and a bounced address
 * keeps being mailed until the domain's reputation is gone.
 */
CREATE TABLE email_messages (
  id            BIGSERIAL PRIMARY KEY,
  contact_id    INT REFERENCES contacts(id) ON DELETE SET NULL,
  member_id     INT REFERENCES members(id) ON DELETE SET NULL,
  to_email      CITEXT NOT NULL,

  -- What produced it, for reporting and for the "stop sending me this" rules.
  source_type   TEXT NOT NULL DEFAULT 'transactional'
                  CHECK (source_type IN ('transactional','broadcast','sequence','automation','digest')),
  source_id     INT,
  topic         TEXT NOT NULL DEFAULT '',

  subject       TEXT NOT NULL DEFAULT '',
  provider      TEXT NOT NULL DEFAULT 'smtp',
  provider_message_id TEXT,

  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','delivered','bounced','complained','failed','suppressed')),
  error         TEXT NOT NULL DEFAULT '',

  sent_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  first_clicked_at TIMESTAMPTZ,
  open_count    INT NOT NULL DEFAULT 0,
  click_count   INT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_messages_source  ON email_messages (source_type, source_id, created_at DESC);
CREATE INDEX idx_email_messages_contact ON email_messages (contact_id, created_at DESC);
CREATE UNIQUE INDEX idx_email_messages_provider
  ON email_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

/** Raw provider events. Kept separate so a replayed webhook cannot double-count. */
CREATE TABLE email_events (
  id          BIGSERIAL PRIMARY KEY,
  message_id  BIGINT REFERENCES email_messages(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  kind        TEXT NOT NULL
                CHECK (kind IN ('delivered','opened','clicked','bounced','complained','unsubscribed','failed')),
  url         TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  payload     JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_events_message ON email_events (message_id, kind);
CREATE UNIQUE INDEX idx_email_events_provider
  ON email_events (provider_event_id) WHERE provider_event_id IS NOT NULL;

/**
 * The suppression list.
 *
 * Separate from `contacts.email_marketing_status` on purpose: an address can be
 * suppressed before any contact exists for it, and it must stay suppressed if
 * the contact is later deleted and re-imported. A hard bounce that comes back
 * because somebody re-uploaded a CSV is how a sending domain dies.
 */
CREATE TABLE email_suppressions (
  email      CITEXT PRIMARY KEY,
  reason     TEXT NOT NULL DEFAULT 'bounce'
               CHECK (reason IN ('bounce','complaint','manual','unsubscribe','invalid')),
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- per-topic preferences --------------------------------------------------

/**
 * Granular unsubscribe, keyed on email rather than member.
 *
 * A contact who never made an account still has to be able to turn off the
 * newsletter, and `member_email_preferences` (Phase 3) cannot express that.
 */
CREATE TABLE contact_email_preferences (
  id         SERIAL PRIMARY KEY,
  contact_id INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  subscribed BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, topic)
);

-- --- sequences --------------------------------------------------------------

CREATE TABLE email_sequences (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         CITEXT UNIQUE NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  topic        TEXT NOT NULL DEFAULT 'marketing',

  -- Sending rules that apply to the whole sequence.
  skip_weekends BOOLEAN NOT NULL DEFAULT false,
  send_window_start_minute INT CHECK (send_window_start_minute IS NULL OR send_window_start_minute BETWEEN 0 AND 1439),
  send_window_end_minute   INT CHECK (send_window_end_minute IS NULL OR send_window_end_minute BETWEEN 0 AND 1439),
  -- When true, each email lands at the same local hour for every recipient
  -- rather than all at once in the site's zone.
  use_contact_timezone BOOLEAN NOT NULL DEFAULT true,
  timezone     TEXT NOT NULL DEFAULT 'America/New_York',

  -- Leaving the sequence early. `exit_on_purchase` is the one everybody wants:
  -- continuing to sell something to a person who has just bought it is the
  -- fastest way to earn an unsubscribe.
  exit_on_purchase BOOLEAN NOT NULL DEFAULT true,
  exit_tag_id  INT REFERENCES tags(id) ON DELETE SET NULL,
  -- Tag applied when a contact reaches the end. The live funnel does exactly this.
  completion_tag_id INT REFERENCES tags(id) ON DELETE SET NULL,
  -- false = a contact may only ever go through this once.
  allow_reentry BOOLEAN NOT NULL DEFAULT false,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sequence_emails (
  id           SERIAL PRIMARY KEY,
  sequence_id  INT NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  position     INT NOT NULL,
  -- Delay from the PREVIOUS email, not from enrolment: reordering or inserting
  -- an email then does not silently reschedule everything after it.
  delay_minutes INT NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  subject      TEXT NOT NULL DEFAULT '',
  preview_text TEXT NOT NULL DEFAULT '',
  body_md      TEXT NOT NULL DEFAULT '',
  from_name    TEXT NOT NULL DEFAULT '',
  from_email   TEXT NOT NULL DEFAULT '',
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, position)
);

CREATE TABLE sequence_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  sequence_id  INT NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  contact_id   INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paused','completed','exited','cancelled')),
  -- The position of the NEXT email to send.
  position     INT NOT NULL DEFAULT 1,
  next_send_at TIMESTAMPTZ,
  exit_reason  TEXT NOT NULL DEFAULT '',
  entered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One live run per contact per sequence. Re-entry ends the old row first.
  UNIQUE (sequence_id, contact_id)
);

-- The tick query: everything due, cheapest possible scan.
CREATE INDEX idx_sequence_subs_due ON sequence_subscriptions (next_send_at)
  WHERE status = 'active';

-- --- broadcasts -------------------------------------------------------------

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS folder        TEXT NOT NULL DEFAULT '';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS segment_id    INT REFERENCES segments(id) ON DELETE SET NULL;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS topic         TEXT NOT NULL DEFAULT 'marketing';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS from_name     TEXT NOT NULL DEFAULT '';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS from_email    TEXT NOT NULL DEFAULT '';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS plain_text    TEXT NOT NULL DEFAULT '';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS timezone      TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS use_contact_timezone BOOLEAN NOT NULL DEFAULT false;
-- A/B on the subject line only. Testing bodies needs a winner rule nobody here
-- has asked for, and a half-built experiment is worse than none.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS subject_b     TEXT NOT NULL DEFAULT '';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ab_split_percent INT NOT NULL DEFAULT 0
  CHECK (ab_split_percent BETWEEN 0 AND 50);
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS unsubscribed_count INT NOT NULL DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS bounced_count      INT NOT NULL DEFAULT 0;

ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS message_id BIGINT REFERENCES email_messages(id) ON DELETE SET NULL;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS variant    TEXT NOT NULL DEFAULT 'a';

-- --- automations ------------------------------------------------------------

-- The existing `automations` table stays; these widen it to the brief's shape.
ALTER TABLE automations ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}';
ALTER TABLE automations ADD COLUMN IF NOT EXISTS last_error     TEXT NOT NULL DEFAULT '';
-- A rule that adds a tag whose own rule adds the first tag back will otherwise
-- run until the queue is full. Enforced per contact per automation per window.
ALTER TABLE automations ADD COLUMN IF NOT EXISTS max_runs_per_contact_per_day INT NOT NULL DEFAULT 25;

ALTER TABLE automation_actions ADD COLUMN IF NOT EXISTS delay_minutes INT NOT NULL DEFAULT 0
  CHECK (delay_minutes >= 0);
-- Structured "only if" for a single action, evaluated when the action runs
-- rather than when the automation fired — a wait of three days may have made
-- the original condition untrue.
ALTER TABLE automation_actions ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}';

ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS trigger_payload JSONB NOT NULL DEFAULT '{}';
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_automation_runs_contact
  ON automation_runs (contact_id, created_at DESC);
-- The loop guard's query.
CREATE INDEX IF NOT EXISTS idx_automation_runs_guard
  ON automation_runs (automation_id, contact_id, created_at DESC);

-- --- editable system templates ----------------------------------------------

/**
 * The transactional emails, editable without a deploy.
 *
 * `key` is what the code asks for; a missing row falls back to the compiled-in
 * template, so deleting one degrades to the shipped copy rather than to silence.
 */
CREATE TABLE email_templates (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  body_md     TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO email_templates (key, name, description) VALUES
  ('welcome',              'Welcome',                'Sent when someone creates an account'),
  ('verify_email',         'Confirm your email',     'The address confirmation link'),
  ('password_reset',       'Password reset',         'The forgotten-password link'),
  ('set_password',         'Finish your account',    'For a buyer who has no password yet'),
  ('purchase_receipt',     'Purchase receipt',       'Sent after a successful payment'),
  ('invoice',              'Invoice',                'A subscription or plan invoice'),
  ('access_granted',       'Access granted',         'When something is added to a library'),
  ('payment_failed',       'Payment failed',         'Dunning'),
  ('subscription_cancelled','Subscription cancelled','Confirmation of a cancellation'),
  ('coaching_reminder',    'Coaching reminder',      'Before a booked session'),
  ('community_digest',     'Community digest',       'The periodic activity summary'),
  ('certificate_issued',   'Certificate issued',     'When a course is completed')
ON CONFLICT (key) DO NOTHING;
