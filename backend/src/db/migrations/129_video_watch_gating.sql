-- =============================================================================
-- QA sheet rows 122/124 (20 Oct): watch-the-whole-video gating, and who a CE
-- certificate is for.
--
-- 1. courses.require_full_video — the course builder's "Require watching the
--    full video before the next lesson". When on, a lesson with a video or audio
--    file only completes once the member has actually played it to 95% of its
--    length (seeking ahead does not count), and the lesson after it stays locked
--    until then. Off for every existing course; on for the two CE replays
--    (Audit Proof Your Practice, The Do's & Don'ts of Clinical Documentation),
--    whose CE approval requires full viewing.
--
-- 2. lesson_progress.max_position_seconds — the furthest point in the media the
--    member has reached by playing it, never by seeking. Monotonic, credited by
--    the server no faster than real time (services/curriculum.ts
--    advancePlayedTo). Backfilled from the existing position-derived
--    watched_percent so turning the switch on for a course with history does not
--    zero everybody.
--
-- 3. includes_certificate on offers and on offer_pricing_options. A purchase
--    whose offer or pricing option says false grants the course but not its
--    certificate (services/certificates.ts certificateAccessAllowed). Default
--    true everywhere; false for the $57 "Educational Access — No CE Credit"
--    option of the free-to-$77 Audit Proof offer (created by migration 127,
--    which runs before this file) and for the separate "Educational Only"
--    Audit Proof offer.
-- =============================================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS require_full_video boolean NOT NULL DEFAULT false;

UPDATE courses
   SET require_full_video = true, updated_at = now()
 WHERE slug IN ('audit-proof-your-practice-on-demand',
                'dos-and-donts-of-clinical-documentation-replay')
   AND require_full_video = false;

ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS max_position_seconds integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lesson_progress_max_position_seconds_check'
  ) THEN
    ALTER TABLE lesson_progress
      ADD CONSTRAINT lesson_progress_max_position_seconds_check CHECK (max_position_seconds >= 0);
  END IF;
END $$;

UPDATE lesson_progress lp
   SET max_position_seconds = (lp.watched_percent * l.video_duration_seconds) / 100
  FROM course_lessons l
 WHERE l.id = lp.lesson_id
   AND l.video_duration_seconds > 0
   AND lp.watched_percent > 0
   AND lp.max_position_seconds = 0;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS includes_certificate boolean NOT NULL DEFAULT true;

ALTER TABLE offer_pricing_options
  ADD COLUMN IF NOT EXISTS includes_certificate boolean NOT NULL DEFAULT true;

UPDATE offer_pricing_options op
   SET includes_certificate = false, updated_at = now()
  FROM offers o
 WHERE o.id = op.offer_id
   AND o.slug = 'audit-proof-your-practice-on-demand-free'
   AND op.label ~* 'no\s*ce\s*credit'
   AND op.includes_certificate;

UPDATE offers
   SET includes_certificate = false, updated_at = now()
 WHERE slug = 'audit-proof-on-demand-educational'
   AND includes_certificate;
