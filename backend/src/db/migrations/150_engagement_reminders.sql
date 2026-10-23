-- =============================================================================
-- QA sheet row 171 (23 Oct): "Is there a way to see if a participant watched a
-- video and to send a reminder via email, or if they didn't show up on a live
-- session to send a replay?"
--
-- What already existed: lesson_progress (watched_percent, max_position_seconds,
-- completed_at, last_viewed_at) per member and lesson; community_live_visits
-- (who was in a community's live room, and when); community_event_rsvps; and,
-- for the site-wide webinar events, event_registrations.attended plus
-- events.replay_url. Nothing showed the first to the owner, and nothing turned
-- the second into an email.
--
-- This file adds only storage. Nothing here sends anything:
--
-- 1. community_event_replays — the replay link for ONE session of a community
--    meetup. Per session, not per event, because "Monthly Coaching Calls" is a
--    repeating series and every month has its own recording. Set by the owner
--    on Analytics → Engagement → Live sessions. (Site-wide events keep using
--    events.replay_url, which they already had.)
--
-- 2. engagement_sends — the ledger behind the two buttons on that page, "Send
--    reminder" (a lesson video) and "Email the replay" (a live session). One
--    row per person per thing per day: `dedupe_key` is unique, so a double
--    click, a retried request or a second admin pressing the same button the
--    same day collapses into the first row instead of a second email. A row is
--    claimed queued → sending in one statement before the provider is called,
--    and a failure is recorded, never retried automatically (at most once).
--
-- 3. job_schedules 'engagement-sweep' — every 30 minutes, runs the two
--    automation triggers added in automations/engineV2.ts ("a lesson video is
--    not watched N days after it opened", "someone misses a live session /
--    a replay is ready"). The sweep is a strict no-op unless the owner has an
--    ACTIVE automation using one of those triggers, and every new automation is
--    created paused, so shipping the schedule enabled sends nothing by itself.
--
-- Idempotent throughout.
-- =============================================================================

CREATE TABLE IF NOT EXISTS community_event_replays (
  id                 SERIAL PRIMARY KEY,
  event_id           INT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  -- The session's start instant: `starts_at` for a single event, one of the
  -- series' generated occurrences for a repeating one.
  session_starts_at  TIMESTAMPTZ NOT NULL,
  replay_url         TEXT NOT NULL DEFAULT '',
  updated_by         INT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, session_starts_at)
);

CREATE TABLE IF NOT EXISTS engagement_sends (
  id                 BIGSERIAL PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('lesson_reminder', 'replay')),
  -- kind + what it is about + who + the day: one press per person per day.
  dedupe_key         TEXT NOT NULL UNIQUE,
  member_id          INT REFERENCES members(id) ON DELETE SET NULL,
  contact_id         INT REFERENCES contacts(id) ON DELETE SET NULL,
  email              CITEXT NOT NULL,
  -- What the email is about, for the page's "recently sent" list.
  lesson_id          INT REFERENCES course_lessons(id) ON DELETE SET NULL,
  community_event_id INT REFERENCES community_events(id) ON DELETE SET NULL,
  event_id           INT REFERENCES events(id) ON DELETE SET NULL,
  session_starts_at  TIMESTAMPTZ,
  subject            TEXT NOT NULL,
  body_md            TEXT NOT NULL,
  -- {{lessonUrl}}, {{replayUrl}} and friends, frozen at the moment of the press.
  merge_values       JSONB NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sending', 'sent', 'suppressed', 'failed')),
  error              TEXT NOT NULL DEFAULT '',
  email_message_id   BIGINT,
  created_by         INT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_engagement_sends_recent
  ON engagement_sends (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_sends_lesson
  ON engagement_sends (lesson_id, created_at DESC) WHERE lesson_id IS NOT NULL;

-- Live-room visits are looked up by community and time window per session.
-- (idx_live_visits_community already covers (community_id, joined_at DESC).)

INSERT INTO job_schedules (name, kind, every_minutes, timezone, enabled)
VALUES ('engagement-sweep', 'engagement.sweep', 30, 'UTC', true)
ON CONFLICT (name) DO NOTHING;
