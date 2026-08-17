-- =============================================================================
-- Phase 3 — how much of a lesson was actually sat through
--
-- `watched_percent` is what completes a lesson and what a CEU certificate is
-- issued against, so it is derived on the server: from the position against the
-- lesson's length, and from the wall clock between one progress report and the
-- next. The clock half needs a running total to add to, and a percentage is too
-- coarse to be that total — ten seconds of a two-hour lecture rounds to nothing,
-- and a counter that rounds to nothing never moves.
--
-- Seconds of lesson, not seconds of real time: a member listening at 2x covers
-- two seconds of lesson per second of clock, and it is the lesson being
-- measured. Additive, and `lesson_progress` holds 0 rows.
-- =============================================================================

ALTER TABLE lesson_progress ADD COLUMN IF NOT EXISTS watched_seconds INT NOT NULL DEFAULT 0
  CHECK (watched_seconds >= 0);
