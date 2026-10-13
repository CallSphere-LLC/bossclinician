-- Kajabi-parity lesson release states and quiz-gated certificates.
--
-- Kajabi lets the owner put every lesson in one of Draft / Published /
-- Scheduled / Drip, and separately "Lock" it until the previous lesson is done.
-- Draft (published = false), Drip (drip_days / drip_date) and Lock
-- (requires_previous_lesson) already exist on course_lessons. Two things were
-- missing:
--
--   1. Scheduled: a lesson that becomes available at an exact date and time.
--      `publish_at` is that instant (NULL = no schedule). Until it passes, the
--      member sees the lesson in the outline as locked ("Opens Tuesday,
--      October 20, 9:00 AM EDT") and every content, media, attachment,
--      progress and assessment route refuses it — enforced in
--      services/curriculum.ts, which all of them go through.
--
--   2. Certificate gating: `courses.certificate_requires_pass`. When true (the
--      default), a certificate is only issued once every published graded quiz
--      in the course has a passing attempt, at the pass mark set on that quiz.
--      Courses without graded quizzes are unaffected by the default.
--
-- Nothing here changes any existing lesson's availability: publish_at starts
-- NULL everywhere and no lesson is locked by this migration. The owner turns
-- "Lock all lessons in order" on per course in the course builder.
-- Idempotent.

ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS certificate_requires_pass BOOLEAN NOT NULL DEFAULT true;

-- "Has this member passed the quiz on lesson X" is answered from the existing
-- idx_assessment_attempts_member (member_id, assessment_id); no new index.
