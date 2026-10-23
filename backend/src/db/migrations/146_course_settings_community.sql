-- Kajabi's per-course tabs (Outline · Offers · Customers · Settings), sheet row 160.
--
-- 1. A course can name the community it belongs to. The course builder's
--    Settings tab reads and writes it; it is also the room a course's live
--    sessions are hosted in. Nullable, and cleared rather than cascaded when the
--    community goes, because a course outlives any one community.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_community ON courses (community_id) WHERE community_id IS NOT NULL;

-- 2. A live session held for a course: the community event it is hosted as and
--    the lesson its replay becomes. The title and start are kept here as well so
--    the course still lists what happened after the event row is deleted.
CREATE TABLE IF NOT EXISTS course_live_sessions (
  id                 SERIAL PRIMARY KEY,
  course_id          INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  community_event_id INTEGER REFERENCES community_events(id) ON DELETE SET NULL,
  lesson_id          INTEGER REFERENCES course_lessons(id) ON DELETE SET NULL,
  title              TEXT NOT NULL DEFAULT '',
  starts_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_live_sessions_course ON course_live_sessions (course_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_live_sessions_event
  ON course_live_sessions (course_id, community_event_id) WHERE community_event_id IS NOT NULL;

-- 3. Every course is something access can be granted to. "Add a course" used to
--    create the course alone, so nobody could buy it or be given it (The Board
--    Room, course 65). The admin now makes the product with the course; this
--    backfills the ones made before that. Same shape as migration 002's
--    backfill. A course a download or coaching product already names through
--    `legacy_course_id` is left alone: that product is what sells it.
INSERT INTO products (slug, title, subtitle, description, thumbnail_url, kind, course_id, status, sort)
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM products x WHERE x.slug = c.slug)
       THEN c.slug || '-course-' || c.id
       ELSE c.slug END,
  c.title,
  COALESCE(c.subtitle, ''),
  COALESCE(c.description, ''),
  COALESCE(c.image, ''),
  'course',
  c.id,
  'published',
  c.sort
FROM courses c
WHERE NOT EXISTS (
  SELECT 1 FROM products p WHERE p.course_id = c.id OR p.legacy_course_id = c.id
)
ON CONFLICT (slug) DO NOTHING;
