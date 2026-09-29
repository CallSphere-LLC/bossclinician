-- 087: community events that repeat, and events for one access group.
--
-- Kajabi's community meetups repeat: "Monthly Coaching Calls" is one meetup,
-- first on Fri 9 Oct 2026 at 10:00 America/Los_Angeles and then on the 9th of
-- every month, held in the community's live room and shown only to one access
-- group. Here a community event was a single session for the whole community,
-- so a monthly call had to be re-created every month and could not be kept to
-- the tier that pays for it.
--
-- The repeat rule is the one the site-wide `events` table has had since 050
-- (same columns, same values, same ranges), and it is expanded by the same
-- helper, services/events.ts: sessions are generated on the wall clock in the
-- event's own `timezone`, so a 10:00 Pacific call stays at 10:00 across the
-- November change instead of drifting to 09:00. `starts_at` stays the first
-- session of the series; the member side works out the next one.
--
-- One deliberate difference from 050: a community meetup may repeat with no
-- end (no end date and no count), because that is what Kajabi's meetups do.
-- The site-wide events keep their "a series always ends" rule; nothing here
-- changes that table.
--
-- `access_group_id` NULL is every member of the community, which is every event
-- that existed before this migration. Set, the event is shown only to members
-- in that group, and to the community's moderators — the same rule a channel's
-- access group follows.
--
-- Columns only, no data. Idempotent: ADD COLUMN IF NOT EXISTS throughout, and
-- the cross-column rule is added only if it is not already there.

-- How often the event repeats. NULL means it does not.
ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS recurrence_freq TEXT
    CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily', 'weekly', 'monthly'));

-- Every N days / weeks / months.
ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS recurrence_interval INT NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 99);

-- The last calendar day a session may fall on, in the event's own zone
-- (inclusive). NULL with a NULL count is a series with no end.
ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS recurrence_until DATE;

-- Or: how many sessions in total, the first one included.
ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS recurrence_count INT
    CHECK (recurrence_count IS NULL OR recurrence_count BETWEEN 1 AND 200);

-- The zone whose wall clock the series keeps. Only a repeating event reads it;
-- a single session is the instant in `starts_at` either way.
ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

-- The access group the event belongs to. NULL: the whole community.
ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS access_group_id INT
    REFERENCES community_access_groups(id) ON DELETE SET NULL;

-- A repeat rule needs a first session to repeat from, and ends by a date or by
-- a count but not both. The admin route says this in words first; this is the
-- backstop for anything that writes the table some other way.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_event_recurrence_shape'
  ) THEN
    ALTER TABLE community_events ADD CONSTRAINT community_event_recurrence_shape CHECK (
      recurrence_freq IS NULL
      OR (starts_at IS NOT NULL
          AND (recurrence_until IS NULL OR recurrence_count IS NULL))
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_community_events_access_group
  ON community_events (access_group_id) WHERE access_group_id IS NOT NULL;
