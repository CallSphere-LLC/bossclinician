-- =============================================================================
-- Events: a repeat rule on a live event, and a physical address as a location.
--
-- Until now a live event was one session. A weekly office hour had to be made
-- as six separate events with six registration pages, and somebody who signed
-- up for "Tuesdays in October" had signed up for one Tuesday. A rule on the
-- event — how often, every how many, and when it stops — lets one registration
-- cover the series: the public page lists the sessions, the member's own page
-- shows the next one, the calendar file carries every one of them, and the
-- reminders follow each session in turn.
--
-- The rule always ends, by date or by count. An open-ended series cannot be
-- written into a calendar file as individual sessions, and a registration that
-- never finishes is one nobody can report on.
--
-- Location is the second gap: an event could only be a link. An in-person
-- workshop now carries its address, which the public page shows and the
-- calendar file writes as LOCATION.
--
-- Idempotent throughout: every column is ADD COLUMN IF NOT EXISTS, and the one
-- cross-column rule is added only if it is not already there.
-- =============================================================================

-- How often the event repeats. NULL means it does not.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_freq TEXT
    CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily', 'weekly', 'monthly'));

-- Every N days / weeks / months.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_interval INT NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 99);

-- The last day a session may fall on, read as a calendar date in the event's
-- own time zone (inclusive). A date rather than an instant, because "until 31
-- October" is a question about the calendar, not about midnight UTC.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_until DATE;

-- Or: how many sessions in total, the first one included.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_count INT
    CHECK (recurrence_count IS NULL OR recurrence_count BETWEEN 1 AND 200);

-- 'online' is every event that existed before this migration: a link.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS location_type TEXT NOT NULL DEFAULT 'online'
    CHECK (location_type IN ('online', 'in_person'));

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS location_address TEXT NOT NULL DEFAULT '';

-- A repeat rule belongs to a live event with a start, and always ends. The
-- admin route says this in words first; this is the backstop for anything that
-- writes the table some other way.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_recurrence_shape'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT event_recurrence_shape CHECK (
      recurrence_freq IS NULL
      OR (kind = 'live' AND starts_at IS NOT NULL
          AND (recurrence_until IS NOT NULL OR recurrence_count IS NOT NULL))
    );
  END IF;
END
$$;
