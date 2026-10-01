-- Kajabi course content import (backend/scripts/kajabi-import/import.mjs).
--
-- The importer upserts by Kajabi id so it can be run again after a partial or
-- failed run (expired download link, full disk, a product added later) without
-- duplicating a single module, lesson or file. Every column is nullable and
-- every index is partial on `kajabi_id IS NOT NULL`, so rows created in the
-- admin are untouched and nothing here changes how the app reads these tables.
--
-- Idempotent on purpose: the importer refuses to run until these columns
-- exist, and the parent may apply this file by hand with psql before the next
-- deploy records it in schema_migrations.

ALTER TABLE products       ADD COLUMN IF NOT EXISTS kajabi_id TEXT;
ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS kajabi_id TEXT;
ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS kajabi_id TEXT;
ALTER TABLE lesson_files   ADD COLUMN IF NOT EXISTS kajabi_id TEXT;
ALTER TABLE product_files  ADD COLUMN IF NOT EXISTS kajabi_id TEXT;

-- Kajabi nests sub-modules under a module; this app has one level. The
-- importer flattens a sub-module into its own module placed directly after its
-- parent and remembers the parent here, so the nesting can be rebuilt later
-- without going back to Kajabi.
ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS kajabi_parent_id TEXT;

-- The module's poster image from Kajabi (a public /uploads path). Stored now so
-- the artwork is not lost; the member outline does not render it yet.
ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_kajabi_id
  ON products (kajabi_id) WHERE kajabi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_modules_kajabi_id
  ON course_modules (course_id, kajabi_id) WHERE kajabi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_lessons_kajabi_id
  ON course_lessons (kajabi_id) WHERE kajabi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_files_kajabi_id
  ON lesson_files (lesson_id, kajabi_id) WHERE kajabi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_files_kajabi_id
  ON product_files (product_id, kajabi_id) WHERE kajabi_id IS NOT NULL;
