-- =============================================================================
-- Phase 3 — Product delivery: the member experience
--
-- 17 courses exist with 0 lessons and no way for anyone to consume anything.
-- This adds the tables behind the library, the course player, downloads,
-- certificates, member-facing community and coaching booking.
--
-- Forward-only and additive. `course_lessons` and `course_modules` are extended
-- in place; both hold 0 rows.
-- =============================================================================

-- --- lessons ----------------------------------------------------------------

-- A lesson used to be "some markdown, maybe a video URL, maybe one attachment".
-- Kajabi lessons are typed, so the player can render the right thing rather
-- than guessing from whether video_url happens to be blank.
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE course_lessons DROP CONSTRAINT IF EXISTS course_lessons_content_type_check;
ALTER TABLE course_lessons ADD CONSTRAINT course_lessons_content_type_check
  CHECK (content_type IN ('video','audio','text','pdf','embed','assessment'));

ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS slug            TEXT NOT NULL DEFAULT '';
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS audio_url       TEXT NOT NULL DEFAULT '';
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS embed_html      TEXT NOT NULL DEFAULT '';
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS transcript      TEXT NOT NULL DEFAULT '';
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS captions_url    TEXT NOT NULL DEFAULT '';
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS video_duration_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS notes_enabled    BOOLEAN NOT NULL DEFAULT true;

-- Drip. Two mutually exclusive modes, both nullable so the default is "open now".
--   drip_days   : unlock this many days after the access grant was created
--   drip_date   : unlock at a fixed wall-clock date
-- The time of day comes from the site-wide `drip.release_time` setting, which
-- is exactly how Kajabi models it — the owner sets one release hour, not one
-- per lesson.
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS drip_days INT
  CHECK (drip_days IS NULL OR drip_days >= 0);
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS drip_date TIMESTAMPTZ;

-- Slugs must be unique inside a module so /library/:product/:lesson resolves.
UPDATE course_lessons SET slug = 'lesson-' || id WHERE slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_lessons_slug ON course_lessons (module_id, slug);

ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS drip_days INT
  CHECK (drip_days IS NULL OR drip_days >= 0);
ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS drip_date TIMESTAMPTZ;

-- Files attached to a lesson. Separate from product_files: those are the whole
-- deliverable of a download product, these are the workbook beside a video.
CREATE TABLE lesson_files (
  id           SERIAL PRIMARY KEY,
  lesson_id    INT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  media_id     INT REFERENCES media_assets(id) ON DELETE SET NULL,
  title        TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL,
  filename     TEXT NOT NULL DEFAULT '',
  mime         TEXT NOT NULL DEFAULT '',
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  sort         INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lesson_files_lesson ON lesson_files (lesson_id, sort);

-- --- progress ---------------------------------------------------------------

-- Resume-at-timestamp is the reason `last_position_seconds` exists and the
-- reason this is keyed on (member, lesson) rather than being an event log: the
-- player writes it every few seconds and only ever reads the latest value.
CREATE TABLE lesson_progress (
  id                    SERIAL PRIMARY KEY,
  member_id             INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  lesson_id             INT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  last_position_seconds INT NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  -- Highest fraction ever watched, 0-100. Monotonic: scrubbing backwards must
  -- not un-earn the 90% that triggers auto-complete.
  watched_percent       INT NOT NULL DEFAULT 0 CHECK (watched_percent BETWEEN 0 AND 100),
  completed_at          TIMESTAMPTZ,
  first_viewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, lesson_id)
);

CREATE INDEX idx_lesson_progress_member ON lesson_progress (member_id, last_viewed_at DESC);
CREATE INDEX idx_lesson_progress_lesson ON lesson_progress (lesson_id, completed_at);

-- Per-course rollup, so /library can paint progress rings without walking every
-- lesson for every card. Written by the same transaction that writes progress.
CREATE TABLE course_progress (
  id                SERIAL PRIMARY KEY,
  member_id         INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  course_id         INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lessons_total     INT NOT NULL DEFAULT 0,
  lessons_completed INT NOT NULL DEFAULT 0,
  percent           INT NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  last_lesson_id    INT REFERENCES course_lessons(id) ON DELETE SET NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, course_id)
);

CREATE INDEX idx_course_progress_member ON course_progress (member_id, updated_at DESC);

-- --- lesson comments & notes ------------------------------------------------

CREATE TABLE lesson_comments (
  id             SERIAL PRIMARY KEY,
  lesson_id      INT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  member_id      INT REFERENCES members(id) ON DELETE SET NULL,
  -- Set when the reply came from the admin rather than a member.
  admin_user_id  INT REFERENCES admin_users(id) ON DELETE SET NULL,
  author_name    TEXT NOT NULL DEFAULT '',
  parent_id      INT REFERENCES lesson_comments(id) ON DELETE CASCADE,
  body           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'visible'
                   CHECK (status IN ('visible','hidden','pending','deleted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lesson_comments_lesson ON lesson_comments (lesson_id, created_at);

-- Private to the member who wrote them. Never surfaced on any admin screen —
-- people write things in a course notebook they would not write in public.
CREATE TABLE lesson_notes (
  id         SERIAL PRIMARY KEY,
  lesson_id  INT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  member_id  INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, lesson_id)
);

-- --- downloads --------------------------------------------------------------

-- Every issued download link. Two jobs: the count Yvette sees per file, and an
-- audit trail when a paid PDF turns up somewhere it shouldn't.
CREATE TABLE download_events (
  id              SERIAL PRIMARY KEY,
  member_id       INT REFERENCES members(id) ON DELETE SET NULL,
  product_file_id INT REFERENCES product_files(id) ON DELETE CASCADE,
  lesson_file_id  INT REFERENCES lesson_files(id) ON DELETE CASCADE,
  ip              TEXT NOT NULL DEFAULT '',
  user_agent      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT download_targets_one_file CHECK (
    (product_file_id IS NOT NULL AND lesson_file_id IS NULL) OR
    (product_file_id IS NULL AND lesson_file_id IS NOT NULL)
  )
);

CREATE INDEX idx_download_events_member ON download_events (member_id, created_at DESC);

-- --- certificates -----------------------------------------------------------

-- This business sells CEU courses, so a certificate is a compliance artefact,
-- not decoration: the credit hours and provider number have to be on it.
CREATE TABLE certificate_templates (
  id                SERIAL PRIMARY KEY,
  product_id        INT REFERENCES products(id) ON DELETE CASCADE,
  course_id         INT REFERENCES courses(id) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT 'Certificate of Completion',
  body              TEXT NOT NULL DEFAULT '',
  signature_image   TEXT NOT NULL DEFAULT '',
  signature_name    TEXT NOT NULL DEFAULT '',
  signature_title   TEXT NOT NULL DEFAULT '',
  logo_url          TEXT NOT NULL DEFAULT '',
  -- CEU fields. Quarter-hours as an integer, because 1.5 CE hours is common and
  -- a float in a compliance record is asking for a rounding dispute.
  ceu_credit_quarter_hours INT NOT NULL DEFAULT 0,
  ceu_provider_number      TEXT NOT NULL DEFAULT '',
  ceu_provider_name        TEXT NOT NULL DEFAULT '',
  -- 'completion' issues at 100% of lessons; 'assessment' requires a pass.
  issue_on          TEXT NOT NULL DEFAULT 'completion'
                      CHECK (issue_on IN ('completion','assessment','manual')),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE certificates (
  id                SERIAL PRIMARY KEY,
  template_id       INT REFERENCES certificate_templates(id) ON DELETE SET NULL,
  member_id         INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  product_id        INT REFERENCES products(id) ON DELETE SET NULL,
  course_id         INT REFERENCES courses(id) ON DELETE SET NULL,
  -- Public, unguessable, printed on the PDF and resolvable at /verify/:code.
  -- Anyone holding the certificate can be checked without an account.
  verification_code TEXT UNIQUE NOT NULL,
  recipient_name    TEXT NOT NULL DEFAULT '',
  course_title      TEXT NOT NULL DEFAULT '',
  ceu_credit_quarter_hours INT NOT NULL DEFAULT 0,
  ceu_provider_number      TEXT NOT NULL DEFAULT '',
  completed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  pdf_path          TEXT NOT NULL DEFAULT '',
  UNIQUE (member_id, course_id)
);

CREATE INDEX idx_certificates_member ON certificates (member_id, issued_at DESC);

-- --- community (member-facing) ----------------------------------------------

-- The admin already has channels, posts, comments, challenges, badges and a
-- leaderboard. What was missing is everything a member needs: polls, RSVPs,
-- mentions, notifications, reporting and a profile.

ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_kind_check;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_kind_check
  CHECK (kind IN ('text','image','video','poll','link'));
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS locked        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS reaction_count INT NOT NULL DEFAULT 0;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES community_comments(id) ON DELETE CASCADE;
ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS bio          TEXT NOT NULL DEFAULT '';
ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS headline     TEXT NOT NULL DEFAULT '';
ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS banned_at    TIMESTAMPTZ;
ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE community_poll_options (
  id         SERIAL PRIMARY KEY,
  post_id    INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sort       INT NOT NULL DEFAULT 0,
  vote_count INT NOT NULL DEFAULT 0
);

CREATE TABLE community_poll_votes (
  id        SERIAL PRIMARY KEY,
  option_id INT NOT NULL REFERENCES community_poll_options(id) ON DELETE CASCADE,
  post_id   INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  member_id INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One vote per person per poll, enforced on the POST rather than the option
  -- so changing your mind replaces rather than adds.
  UNIQUE (post_id, member_id)
);

CREATE TABLE community_event_rsvps (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  member_id  INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going','maybe','declined')),
  attended   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, member_id)
);

CREATE TABLE community_reports (
  id           SERIAL PRIMARY KEY,
  post_id      INT REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id   INT REFERENCES community_comments(id) ON DELETE CASCADE,
  reporter_id  INT REFERENCES members(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX idx_community_reports_open ON community_reports (status, created_at DESC);

CREATE TABLE member_badges (
  id         SERIAL PRIMARY KEY,
  member_id  INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  badge_id   INT NOT NULL REFERENCES community_badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, badge_id)
);

-- In-app notifications. `read_at IS NULL` is the unread badge; the email digest
-- job reads the same rows, so a member never gets an email about something they
-- already saw in the app.
CREATE TABLE member_notifications (
  id          SERIAL PRIMARY KEY,
  member_id   INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  actor_id    INT REFERENCES members(id) ON DELETE SET NULL,
  read_at     TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_member_notifications_unread
  ON member_notifications (member_id, created_at DESC) WHERE read_at IS NULL;

-- --- coaching ---------------------------------------------------------------

-- Weekly recurring availability, expressed in the coach's own timezone. Storing
-- a UTC offset instead would silently break twice a year at DST boundaries.
CREATE TABLE coach_availability (
  id          SERIAL PRIMARY KEY,
  admin_user_id INT REFERENCES admin_users(id) ON DELETE CASCADE,
  timezone    TEXT NOT NULL DEFAULT 'America/New_York',
  -- 0 = Sunday, matching JS getDay().
  weekday     INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute   INT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT availability_ends_after_start CHECK (end_minute > start_minute)
);

-- One-off exceptions: holidays, or an extra Saturday.
CREATE TABLE coach_availability_overrides (
  id            SERIAL PRIMARY KEY,
  admin_user_id INT REFERENCES admin_users(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  -- false = blocked out, true = extra availability.
  available     BOOLEAN NOT NULL DEFAULT false,
  note          TEXT NOT NULL DEFAULT '',
  CONSTRAINT override_ends_after_start CHECK (ends_at > starts_at)
);

-- Credit tracking: "3 of 6 sessions used". Created when a coaching offer is
-- purchased; decremented when a session is booked, restored on a cancellation
-- inside the policy window.
CREATE TABLE coaching_credits (
  id               SERIAL PRIMARY KEY,
  member_id        INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  coaching_offer_id INT REFERENCES coaching_offers(id) ON DELETE SET NULL,
  product_id       INT REFERENCES products(id) ON DELETE SET NULL,
  order_id         INT REFERENCES orders(id) ON DELETE SET NULL,
  sessions_total   INT NOT NULL DEFAULT 0,
  sessions_used    INT NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credits_not_overdrawn CHECK (sessions_used <= sessions_total)
);

CREATE INDEX idx_coaching_credits_member ON coaching_credits (member_id);

ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS credit_id      INT REFERENCES coaching_credits(id) ON DELETE SET NULL;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS timezone       TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS shared_notes   TEXT NOT NULL DEFAULT '';
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS recording_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS booked_at      TIMESTAMPTZ;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS cancel_reason  TEXT NOT NULL DEFAULT '';
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS reminder_1h_sent_at  TIMESTAMPTZ;

CREATE TABLE coaching_session_files (
  id          SERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES coaching_sessions(id) ON DELETE CASCADE,
  media_id    INT REFERENCES media_assets(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- podcast & newsletter (member-facing) -----------------------------------

-- The admin already mints private feed tokens. This is the member's own view of
-- theirs, so they can copy their personal RSS URL into Apple or Spotify.
ALTER TABLE podcast_feed_tokens ADD COLUMN IF NOT EXISTS label       TEXT NOT NULL DEFAULT '';
ALTER TABLE podcast_feed_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS transcript TEXT NOT NULL DEFAULT '';
ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS cover_image TEXT NOT NULL DEFAULT '';

-- Per-topic email preferences, so "unsubscribe" can mean "stop the community
-- digest" rather than "never email me again" — which is what the one-switch
-- version always ends up meaning.
CREATE TABLE member_email_preferences (
  id            SERIAL PRIMARY KEY,
  member_id     INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  subscribed    BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, topic)
);

CREATE TABLE newsletter_subscriptions (
  id            SERIAL PRIMARY KEY,
  newsletter_id INT NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  member_id     INT REFERENCES members(id) ON DELETE CASCADE,
  email         CITEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'subscribed'
                  CHECK (status IN ('subscribed','unsubscribed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (newsletter_id, email)
);
