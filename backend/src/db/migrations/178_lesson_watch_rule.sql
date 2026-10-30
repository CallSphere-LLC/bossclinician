-- QA sheet row 210: the owner chooses, video by video, which must be watched in
-- full and which can be skipped.
--
-- 'inherit'   follows the course (courses.require_full_video, or a completion
--             certificate), which is what every lesson did before this column.
-- 'required'  must be watched in full, whatever the course says.
-- 'skippable' nothing waits for it and it does not count against finishing.
--
-- Every existing lesson takes 'inherit', so no behaviour changes until the owner
-- picks something. No lesson is reclassified here, on purpose: she chooses.
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS watch_rule text NOT NULL DEFAULT 'inherit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_lessons_watch_rule_check'
  ) THEN
    ALTER TABLE course_lessons
      ADD CONSTRAINT course_lessons_watch_rule_check
      CHECK (watch_rule IN ('inherit', 'required', 'skippable'));
  END IF;
END;
$$;
