-- Lesson authoring parity: media artwork and completion prerequisites.
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requires_previous_lesson BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lesson_files_lesson_sort
  ON lesson_files (lesson_id, sort, id);
