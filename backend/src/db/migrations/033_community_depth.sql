-- Community: guidelines gate, scheduled posts, and direct messages.
-- Sections 2.3, 2.8 and 2.9 of the 4 Sep brief.

/* ------------------------------------------------------------- guidelines */

-- Kajabi shows the guidelines in a modal a member must accept before they can
-- post, and Yvette's real ones use headings, emoji and an email address — so
-- this is markdown, not a single paragraph.
ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS guidelines_md text NOT NULL DEFAULT '',
  -- Bumped whenever the text changes, which is what re-opens the gate: rules
  -- somebody accepted in March are not the rules they are being held to now.
  ADD COLUMN IF NOT EXISTS guidelines_updated_at timestamptz;

ALTER TABLE community_memberships
  ADD COLUMN IF NOT EXISTS guidelines_accepted_at timestamptz;

/* --------------------------------------------------------- scheduled posts */

-- Null means "published when it was written", which every existing row is.
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS publish_at timestamptz;

-- A partial index, because the sweeper only ever asks for the handful of posts
-- that are waiting, never for the thousands that have already gone out.
CREATE INDEX IF NOT EXISTS idx_community_posts_scheduled
  ON community_posts (publish_at)
  WHERE status = 'scheduled';

/* --------------------------------------------------------- file attachments */

-- The brief asks the composer for image, video, FILE and poll. The first two
-- and the last were already here; a document — a worksheet, a template, a PDF
-- somebody wants to hand round — had no kind to be.
ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_kind_check;
ALTER TABLE community_posts
  ADD CONSTRAINT community_posts_kind_check
  CHECK (kind IN ('text', 'image', 'video', 'poll', 'link', 'file'));

-- What to call the attachment in the list, since a stored filename is often a
-- hash and "download 7f3a9c.pdf" tells nobody anything.
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS media_label text NOT NULL DEFAULT '';

/* ------------------------------------------------------- direct messages */

-- One row per pair, with the two member ids ordered so that (3,7) and (7,3)
-- cannot both exist. Without that ordering two people opening a conversation
-- with each other at the same moment create two threads and each sees half
-- the messages.
CREATE TABLE IF NOT EXISTS community_dm_threads (
  id             bigserial PRIMARY KEY,
  community_id   integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_a_id    integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_b_id    integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_dm_threads_order_check CHECK (member_a_id < member_b_id),
  CONSTRAINT community_dm_threads_unique UNIQUE (community_id, member_a_id, member_b_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_threads_for_member_a
  ON community_dm_threads (member_a_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_threads_for_member_b
  ON community_dm_threads (member_b_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS community_dm_messages (
  id          bigserial PRIMARY KEY,
  thread_id   bigint NOT NULL REFERENCES community_dm_threads(id) ON DELETE CASCADE,
  sender_id   integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  body        text NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_dm_messages_body_check CHECK (length(body) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread
  ON community_dm_messages (thread_id, created_at);

-- Counts the unread badge without scanning a whole conversation.
CREATE INDEX IF NOT EXISTS idx_dm_messages_unread
  ON community_dm_messages (thread_id, sender_id)
  WHERE read_at IS NULL;

/* ------------------------------------------------- scheduled post sweeper */

-- Every two minutes: a post scheduled for 9:00 should not appear at 9:29.
-- The sweeper is idempotent (it only promotes rows already past their moment),
-- so a missed tick costs lateness rather than correctness.
INSERT INTO job_schedules (name, kind, every_minutes, next_run_at, payload)
VALUES ('community-scheduled-posts', 'community.publishScheduled', 2, now(), '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;
