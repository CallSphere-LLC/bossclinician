-- Course builder — Combined Implementation Prompt §A, §B, §C.
--
-- Every change here is additive. Nothing is dropped, no column is retyped, and
-- every existing row stays valid: a module with no parent is a top-level
-- module exactly as it was, a lesson with no thumbnail renders as it always
-- did, and a quiz with no module is still the standalone quiz it was.

-- ── §A. Submodules ────────────────────────────────────────────────────────
-- One level of nesting under a module, which is what the approved outline
-- shows (Module → Submodule → Lesson). Self-referencing rather than a second
-- table so the ordering, drip and delete rules already written for modules
-- apply unchanged.
--
-- ON DELETE CASCADE: deleting a module must take its submodules with it.
-- Leaving them behind would orphan rows that the outline query can no longer
-- reach, and their lessons with them.
ALTER TABLE course_modules
  ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES course_modules(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_course_modules_parent ON course_modules (parent_id, sort);

-- A submodule cannot be its own parent. Deeper cycles are prevented in the
-- route, which is the only place that can see the whole chain.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_modules_no_self_parent') THEN
    ALTER TABLE course_modules
      ADD CONSTRAINT course_modules_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

-- ── §B. Lesson thumbnail ──────────────────────────────────────────────────
-- The one field the lesson editor asks for that the table had no home for.
-- Text rather than a media_assets reference, matching how `video_url` and
-- `attachment_url` already store a reference on this table — a lesson image
-- can equally be an uploaded file or an external URL.
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT '';

-- §B's "require completion before continuing". The player already records
-- completion in lesson_progress; this is the flag that makes it a gate.
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS require_completion BOOLEAN NOT NULL DEFAULT false;

-- ── §C. Quizzes inside a course ───────────────────────────────────────────
-- `assessments.lesson_id` already attaches a quiz to a lesson. The approved
-- outline puts a Quiz as a *sibling* of lessons inside a module, which needs
-- its own link and its own position in the running order.
--
-- Both stay nullable and both are kept: a quiz with neither is standalone, a
-- quiz with lesson_id is the in-lesson assessment that already worked, and a
-- quiz with module_id is a step in the outline.
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS module_id INT REFERENCES course_modules(id) ON DELETE CASCADE;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS sort INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_assessments_module ON assessments (module_id, sort);
