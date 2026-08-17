-- =============================================================================
-- Phase 6 — Form builder, assessments/quizzes & events
--
-- Kajabi has 45 forms, 2 assessments and 22 events here. The platform has a
-- `forms` table with a JSONB field list and one hardcoded quiz page.
--
-- The quiz is the acquisition mechanic that matters: the live offer quiz routes
-- to four archetypes (Visionary Builder / Steady Grower / Careful Clinician /
-- Reluctant CEO), each with its own page, tag and five-email sequence. That
-- whole funnel is scored branching plus a tag, so both have to be first-class.
-- =============================================================================

-- --- forms ------------------------------------------------------------------

ALTER TABLE forms ADD COLUMN IF NOT EXISTS description_md   TEXT NOT NULL DEFAULT '';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS submit_count     INT NOT NULL DEFAULT 0;
-- redirect | message | download
ALTER TABLE forms ADD COLUMN IF NOT EXISTS post_action      TEXT NOT NULL DEFAULT 'message';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS redirect_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS download_product_file_id INT REFERENCES product_files(id) ON DELETE SET NULL;
-- Tags applied to the contact on submission — the join between a form and the
-- funnel it feeds. An array rather than a join table: a form's tag list is read
-- as a whole, every time, and never queried from the other direction.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS apply_tag_ids    INT[] NOT NULL DEFAULT '{}';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS subscribe_sequence_id INT REFERENCES email_sequences(id) ON DELETE SET NULL;
-- honeypot is always on; turnstile/recaptcha need a site key in settings.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS spam_protection  TEXT NOT NULL DEFAULT 'honeypot'
  CHECK (spam_protection IN ('honeypot','turnstile','recaptcha'));
ALTER TABLE forms ADD COLUMN IF NOT EXISTS double_opt_in    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS ip         TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
-- Set when double opt-in is on and the confirmation link has been clicked.
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS confirm_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON form_submissions (contact_id, created_at DESC);

-- --- assessments ------------------------------------------------------------

CREATE TABLE assessments (
  id            SERIAL PRIMARY KEY,
  slug          CITEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  intro_md      TEXT NOT NULL DEFAULT '',
  -- quiz  = a public lead-gen quiz that branches to a result page
  -- graded = an in-course test with a pass mark, gating a certificate
  kind          TEXT NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz','graded')),
  -- graded only. Attached to a course lesson of content_type 'assessment'.
  lesson_id     INT REFERENCES course_lessons(id) ON DELETE CASCADE,
  pass_mark     INT CHECK (pass_mark IS NULL OR pass_mark BETWEEN 0 AND 100),
  max_attempts  INT,
  show_feedback BOOLEAN NOT NULL DEFAULT true,
  -- Quiz only: capture the email before showing the result, which is the whole
  -- point of a lead-gen quiz.
  require_email BOOLEAN NOT NULL DEFAULT true,
  published     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT graded_needs_a_pass_mark CHECK (kind <> 'graded' OR pass_mark IS NOT NULL)
);

CREATE TABLE assessment_questions (
  id            SERIAL PRIMARY KEY,
  assessment_id INT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  prompt        TEXT NOT NULL,
  help_text     TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'single'
                  CHECK (kind IN ('single','multiple','scale','text')),
  required      BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assessment_questions ON assessment_questions (assessment_id, position);

CREATE TABLE assessment_answers (
  id            SERIAL PRIMARY KEY,
  question_id   INT NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  label         TEXT NOT NULL,
  -- A quiz weights answers toward an archetype; a graded test marks one correct.
  weight        INT NOT NULL DEFAULT 0,
  is_correct    BOOLEAN NOT NULL DEFAULT false,
  feedback      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_assessment_answers ON assessment_answers (question_id, position);

/**
 * Where a score lands.
 *
 * Ranges rather than one result per score: the live quiz has four archetypes
 * across a continuous range, and enumerating every total would be unmaintainable.
 * Overlapping ranges are resolved by taking the first match in `position` order.
 */
CREATE TABLE assessment_results (
  id            SERIAL PRIMARY KEY,
  assessment_id INT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL DEFAULT '',
  image_url     TEXT NOT NULL DEFAULT '',
  min_score     INT NOT NULL DEFAULT 0,
  max_score     INT NOT NULL DEFAULT 2147483647,
  -- What the result does: the tag and the sequence are the funnel.
  apply_tag_id  INT REFERENCES tags(id) ON DELETE SET NULL,
  subscribe_sequence_id INT REFERENCES email_sequences(id) ON DELETE SET NULL,
  cta_label     TEXT NOT NULL DEFAULT '',
  cta_url       TEXT NOT NULL DEFAULT '',
  UNIQUE (assessment_id, slug)
);

CREATE TABLE assessment_attempts (
  id            BIGSERIAL PRIMARY KEY,
  assessment_id INT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  contact_id    INT REFERENCES contacts(id) ON DELETE SET NULL,
  member_id     INT REFERENCES members(id) ON DELETE SET NULL,
  email         CITEXT NOT NULL DEFAULT '',
  -- [{questionId, answerIds[], text}]
  responses     JSONB NOT NULL DEFAULT '[]',
  score         INT NOT NULL DEFAULT 0,
  max_score     INT NOT NULL DEFAULT 0,
  percent       INT NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  passed        BOOLEAN,
  result_id     INT REFERENCES assessment_results(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_assessment_attempts ON assessment_attempts (assessment_id, completed_at DESC);
CREATE INDEX idx_assessment_attempts_member ON assessment_attempts (member_id, assessment_id);

-- --- events -----------------------------------------------------------------

/**
 * Live, evergreen and replay events.
 *
 * `evergreen` is the one that shapes the table: a just-in-time webinar has no
 * fixed datetime at all — it starts N minutes after whenever the visitor
 * registers, which is why `starts_at` is nullable and `evergreen_interval_minutes`
 * exists. Kajabi runs these here on "every 15 minutes" and "hourly" cadences.
 */
CREATE TABLE events (
  id            SERIAL PRIMARY KEY,
  slug          CITEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  cover_image   TEXT NOT NULL DEFAULT '',

  kind          TEXT NOT NULL DEFAULT 'live'
                  CHECK (kind IN ('live','evergreen','replay')),
  starts_at     TIMESTAMPTZ,
  duration_minutes INT NOT NULL DEFAULT 60,
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',
  -- evergreen: how often a session begins, relative to the visitor.
  evergreen_interval_minutes INT CHECK (evergreen_interval_minutes IS NULL OR evergreen_interval_minutes > 0),

  room_url      TEXT NOT NULL DEFAULT '',
  replay_url    TEXT NOT NULL DEFAULT '',
  -- Hours after the session ends before the replay stops working. The live site
  -- runs "End of Replay" events off exactly this.
  replay_expires_after_hours INT,

  registration_form_id INT REFERENCES forms(id) ON DELETE SET NULL,
  apply_tag_ids INT[] NOT NULL DEFAULT '{}',
  -- Post-event automation split: the three segments that exist as live forms.
  attended_tag_id     INT REFERENCES tags(id) ON DELETE SET NULL,
  no_show_tag_id      INT REFERENCES tags(id) ON DELETE SET NULL,

  published     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_shape CHECK (
    (kind = 'live'      AND starts_at IS NOT NULL) OR
    (kind = 'evergreen' AND evergreen_interval_minutes IS NOT NULL) OR
    (kind = 'replay')
  )
);

CREATE TABLE event_registrations (
  id            BIGSERIAL PRIMARY KEY,
  event_id      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id    INT REFERENCES contacts(id) ON DELETE SET NULL,
  member_id     INT REFERENCES members(id) ON DELETE SET NULL,
  email         CITEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  timezone      TEXT NOT NULL DEFAULT '',

  -- For an evergreen event this is the registrant's OWN session time, computed
  -- at registration. A live event copies the event's own start.
  session_at    TIMESTAMPTZ NOT NULL,
  replay_expires_at TIMESTAMPTZ,

  attended      BOOLEAN NOT NULL DEFAULT false,
  attended_at   TIMESTAMPTZ,
  watch_seconds INT NOT NULL DEFAULT 0,
  -- Which reminders have gone out, so a redelivery does not re-send them.
  reminder_24h_sent_at TIMESTAMPTZ,
  reminder_1h_sent_at  TIMESTAMPTZ,
  reminder_start_sent_at TIMESTAMPTZ,
  -- Set when the registrant bought something the event was selling, for the
  -- attended-but-didn't-buy split.
  converted_order_id INT REFERENCES orders(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, email)
);

CREATE INDEX idx_event_registrations_session ON event_registrations (session_at);
CREATE INDEX idx_event_registrations_event   ON event_registrations (event_id, created_at DESC);
-- The reminder job's scan.
CREATE INDEX idx_event_registrations_pending
  ON event_registrations (session_at)
  WHERE reminder_start_sent_at IS NULL;
