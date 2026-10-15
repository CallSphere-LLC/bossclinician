-- Owner-authored, per-lesson interactive calculators. Existing tools keep their keys.
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS tool_config JSONB NOT NULL DEFAULT '{}'::jsonb;
