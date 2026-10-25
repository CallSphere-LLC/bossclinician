-- QA Bugs rows 173 and 181. Add the existing private living plan to The Board
-- Room, then give Boardroom members the four core Practice Elevation modules
-- through their original lessons. No lesson, media, assessment or saved member
-- data is copied; future edits to those modules remain visible to both groups.
-- The Practice Elevation challenge is unpublished and is not linked here.
--
-- The Board Room course and its dashboard module were set up by migration 147.
-- The source living plan lesson was set up by migration 152. All lookups use
-- slugs/tool keys so a fresh database without either course is a no-op.
-- Existing lessons are never overwritten. Re-running this file is idempotent.

-- Row 173: same living-business-plan tool, therefore the same per-member
-- document whether that member opens it here or in Practice Elevation.
INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort,
   tool_key, tool_config)
SELECT target_module.id, source_lesson.title,
       'meet-your-business-live-plan',
       COALESCE(NULLIF(source_lesson.body_md, ''),
         'Build and update your private living business plan below. Your entries save to your own account and follow you across devices.'),
       source_lesson.content_type, true,
       (SELECT COALESCE(MAX(existing.sort), 0) + 1
          FROM course_lessons existing
         WHERE existing.module_id = target_module.id),
       source_lesson.tool_key, source_lesson.tool_config
  FROM courses target_course
  JOIN course_modules target_module ON target_module.course_id = target_course.id
  JOIN course_lessons dashboard ON dashboard.module_id = target_module.id
    AND dashboard.tool_key = 'boardroom-ceo-dashboard'
  JOIN courses source_course ON source_course.slug = 'the-practice-elevation'
  JOIN course_modules source_module ON source_module.course_id = source_course.id
  JOIN course_lessons source_lesson ON source_lesson.module_id = source_module.id
    AND source_lesson.slug = 'meet-your-business-live-plan'
    AND source_lesson.tool_key = 'living-business-plan'
    AND source_lesson.published
 WHERE target_course.slug = 'the-board-room'
   AND target_module.title = 'Boardroom CEO Dashboard'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l
      WHERE l.module_id = target_module.id
        AND (l.slug = 'meet-your-business-live-plan'
             OR l.tool_key = 'living-business-plan')
   );

-- Row 181: an index lesson in Boardroom. Each link opens the actual first
-- lesson of that Practice Elevation module; the course outline supplies its
-- subsections and remaining lessons. The course access below makes the links
-- usable by Boardroom purchasers without exposing any other member's state.
INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort)
SELECT m.id, 'Executive Resources', 'executive-resources',
$body$Your Boardroom access includes the four core modules of The Practice Elevation. Open a module below, then use the course outline to continue through its lessons, worksheets and resources.

1. [Module 1: Audit what is broken and find your starting point](/library/the-practice-elevation/lessons/welcome-to-module-1)
2. [Module 2: Restructure your rates and income sources](/library/the-practice-elevation/lessons/welcome-to-module-2)
3. [Module 3: Build systems and get out of your own way](/library/the-practice-elevation/lessons/welcome-to-lesson-3)
4. [Module 4: Pay yourself and protect what you built](/library/the-practice-elevation/lessons/welcome-to-module-4)

[Open The Practice Elevation course outline](/library/the-practice-elevation)

Your work in the interactive tools and assessments is saved to your own account.$body$,
       'text', true,
       (SELECT COALESCE(MAX(existing.sort), 0) + 1
          FROM course_lessons existing
         WHERE existing.module_id = m.id)
  FROM courses c
  JOIN course_modules m ON m.course_id = c.id
  JOIN course_lessons dashboard ON dashboard.module_id = m.id
    AND dashboard.tool_key = 'boardroom-ceo-dashboard'
 WHERE c.slug = 'the-board-room'
   AND m.title = 'Boardroom CEO Dashboard'
   AND EXISTS (
     SELECT 1 FROM courses src
     JOIN course_modules sm ON sm.course_id = src.id
     JOIN course_lessons sl ON sl.module_id = sm.id
     WHERE src.slug = 'the-practice-elevation'
       AND sl.published
       AND (sm.kajabi_id, sl.slug) IN (
         ('2157478356', 'welcome-to-module-1'),
         ('2157478357', 'welcome-to-module-2'),
         ('2157478358', 'welcome-to-lesson-3'),
         ('2157526875', 'welcome-to-module-4')
       )
     GROUP BY src.id
     HAVING COUNT(DISTINCT sm.kajabi_id) = 4
   )
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l
      WHERE l.module_id = m.id AND l.slug = 'executive-resources'
   );

-- Future purchases through the Boardroom offer receive the source course
-- product, so its real lesson permissions and protected files still apply.
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id,
       (SELECT COALESCE(MAX(op.sort), 0) + 1
          FROM offer_products op WHERE op.offer_id = o.id)
  FROM offers o
  JOIN products p ON p.slug = 'the-practice-elevation' AND p.kind = 'course'
  JOIN courses c ON c.id = p.course_id AND c.slug = 'the-practice-elevation'
 WHERE o.slug = 'the-boss-boardroom'
   AND EXISTS (
     SELECT 1 FROM course_lessons l
     JOIN course_modules m ON m.id = l.module_id
     JOIN courses bc ON bc.id = m.course_id
     WHERE bc.slug = 'the-board-room' AND l.slug = 'executive-resources'
   )
ON CONFLICT (offer_id, product_id) DO NOTHING;

-- Existing Boardroom course holders receive the same access, preserving their
-- source, order, offer and expiration. A deliberately revoked/expired Practice
-- Elevation grant is not reactivated.
INSERT INTO access_grants
  (member_id, product_id, offer_id, order_id, source, status,
   granted_at, expires_at)
SELECT g.member_id, practice_product.id, g.offer_id, g.order_id,
       g.source, 'active', g.granted_at, g.expires_at
  FROM access_grants g
  JOIN products boardroom_product ON boardroom_product.id = g.product_id
    AND boardroom_product.kind = 'course'
  JOIN courses boardroom_course ON boardroom_course.id = boardroom_product.course_id
    AND boardroom_course.slug = 'the-board-room'
  JOIN products practice_product ON practice_product.slug = 'the-practice-elevation'
    AND practice_product.kind = 'course'
  JOIN courses practice_course ON practice_course.id = practice_product.course_id
    AND practice_course.slug = 'the-practice-elevation'
 WHERE g.status = 'active'
   AND (g.expires_at IS NULL OR g.expires_at > now())
   AND EXISTS (
     SELECT 1 FROM course_lessons l
     JOIN course_modules m ON m.id = l.module_id
     WHERE m.course_id = boardroom_course.id AND l.slug = 'executive-resources'
   )
ON CONFLICT (member_id, product_id) DO NOTHING;
