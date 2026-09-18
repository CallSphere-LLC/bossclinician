-- Lessons created before the curriculum route started deriving a slug took the
-- column default, the empty string. The member player addresses a lesson by
-- slug, so such a lesson cannot be opened, and the library's "Pick up where you
-- left off" card links to /library/<course>/lessons/ — a 404.
--
-- Same derivation as lessonSlug() in routes/admin/curriculum.ts. The id is
-- appended only where the plain slug is already taken in that section, which
-- keeps UNIQUE (module_id, slug) satisfied whatever the titles are.
WITH candidates AS (
  SELECT id,
         module_id,
         COALESCE(
           NULLIF(
             trim(BOTH '-' FROM left(
               trim(BOTH '-' FROM regexp_replace(lower(trim(title)), '[^a-z0-9]+', '-', 'g')),
               80)),
             ''),
           'lesson') AS base
    FROM course_lessons
   WHERE slug = ''
)
UPDATE course_lessons l
   SET slug = CASE
                WHEN EXISTS (SELECT 1 FROM course_lessons o
                              WHERE o.module_id = c.module_id AND o.id <> c.id AND o.slug = c.base)
                  OR EXISTS (SELECT 1 FROM candidates c2
                              WHERE c2.module_id = c.module_id AND c2.id <> c.id AND c2.base = c.base)
                THEN c.base || '-' || c.id
                ELSE c.base
              END,
       updated_at = now()
  FROM candidates c
 WHERE l.id = c.id;
