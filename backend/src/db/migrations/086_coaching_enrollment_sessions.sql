-- 086: session progress on a coaching enrollment, as Kajabi's Clients list has it.
--
-- Kajabi's Clients table on a coaching product reads Name, Email, Date Joined and
-- Program Progress ("Completed 3 of 6 sessions"). The Kajabi clients came over
-- as coaching_enrollments (078) with no session history at all, because their
-- sessions happened on Kajabi and there is no coaching_sessions row for any of
-- them, so the Clients tab could only say "from Kajabi" and no progress.
--
-- Two columns on coaching_enrollments:
--   sessions_total     — how many sessions the program held for this person, as
--                        the source knew it (Kajabi's "of 6"). NULL = not known;
--                        the roster then falls back to the program's own
--                        session_count only for enrollments that aren't from
--                        Kajabi (services/coachingRoster.ts).
--   sessions_completed — sessions completed that this app holds NO
--                        coaching_sessions row for: the history from before the
--                        move (Kajabi's "Completed 3"). Sessions booked and
--                        completed here are counted from coaching_sessions and
--                        added on top by the roster, so this column must never
--                        include them or they'd be counted twice.
--
-- The CHECK only guards the stored pair; the roster's figure (stored plus
-- completed here) is not constrained.
--
-- Schema only: no enrollment is given a number here. Re-running it changes
-- nothing.

ALTER TABLE coaching_enrollments
  ADD COLUMN IF NOT EXISTS sessions_total     integer,
  ADD COLUMN IF NOT EXISTS sessions_completed integer NOT NULL DEFAULT 0;

ALTER TABLE coaching_enrollments
  DROP CONSTRAINT IF EXISTS coaching_enrollments_sessions_check;

ALTER TABLE coaching_enrollments
  ADD CONSTRAINT coaching_enrollments_sessions_check
  CHECK (sessions_completed >= 0
         AND (sessions_total IS NULL OR sessions_completed <= sessions_total));
