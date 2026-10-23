-- QA sheet row 161 (23 Oct): "Please move the 'boardroom CEO dashboard' from
-- the boardroom coaching lesson to the boardroom course and lesson."
--
-- Row 95 (15 Oct) asked for the dashboard "inside a course I created called the
-- Boardroom" — that is the course 'The Board Room' (slug the-board-room) the
-- owner made in Admin → Courses on 16 Oct. Migration 119 put the dashboard in
-- 'The Boss Boardroom' instead: the workbook course behind the 1:1 coaching
-- programme (products.legacy_course_id, migration 120). This moves it.
--
-- 1. The whole module 'Boardroom CEO Dashboard' (with its one lesson,
--    boardroom-ceo-dashboard) changes course. Moving the module row rather than
--    copying it keeps the lesson's id, progress, notes and comments, and leaves
--    no duplicate behind. The lesson keeps tool_key 'boardroom-ceo-dashboard',
--    and member_tool_state is keyed by tool_key, so every member's saved
--    dashboard follows it unchanged.
-- 2. 'The Board Room' had no product, so nobody could be granted it and the
--    dashboard would refuse to load or save for everyone (services/toolState.ts
--    mayUseTool → hasCourseAccess). It gets a course product of its own, the
--    same shape migration 111 gave courses 62/63.
-- 3. Continuity for Boardroom clients: the Boss Boardroom offer now grants the
--    course as well, and anyone already holding the coaching product gets a
--    matching grant, so nobody who could open the dashboard yesterday loses it.
--    (Selling the course on its own needs an offer the owner creates.)
--
-- The course stays unpublished (row 99 hid its blank card from /courses);
-- grant holders open it from their Library regardless of that flag.
-- Keyed on slugs and titles, never serial ids. On a database without the
-- owner's course, every statement matches nothing.

-- 1. Move the module (only when the target has no module of that name yet).
UPDATE course_modules m
   SET course_id = target.id, sort = 0, updated_at = now()
  FROM courses source, courses target
 WHERE source.slug = 'the-boss-boardroom'
   AND target.slug = 'the-board-room'
   AND m.course_id = source.id
   AND m.title = 'Boardroom CEO Dashboard'
   AND EXISTS (SELECT 1 FROM course_lessons l WHERE l.module_id = m.id AND l.tool_key = 'boardroom-ceo-dashboard')
   AND NOT EXISTS (
     SELECT 1 FROM course_modules t WHERE t.course_id = target.id AND t.title = 'Boardroom CEO Dashboard'
   );

-- 2. A course product for 'The Board Room'.
INSERT INTO products (slug, title, subtitle, description, thumbnail_url, kind, course_id, status, sort)
SELECT c.slug, c.title, c.subtitle, c.description, COALESCE(c.image, ''), 'course', c.id, 'published',
       (SELECT COALESCE(MAX(sort), 0) + 1 FROM products)
  FROM courses c
 WHERE c.slug = 'the-board-room'
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.course_id = c.id AND p.kind = 'course')
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = c.slug);

-- 3a. The Boss Boardroom offer grants the course alongside the coaching programme.
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 1
  FROM offers o
  JOIN products p ON p.kind = 'course'
  JOIN courses c ON c.id = p.course_id AND c.slug = 'the-board-room'
 WHERE o.slug = 'the-boss-boardroom'
ON CONFLICT (offer_id, product_id) DO NOTHING;

-- 3b. Members already holding The Boss Boardroom coaching product keep the dashboard.
INSERT INTO access_grants (member_id, product_id, offer_id, order_id, source, status, granted_at, expires_at)
SELECT g.member_id, course_product.id, g.offer_id, g.order_id, g.source, g.status, g.granted_at, g.expires_at
  FROM access_grants g
  JOIN products coaching ON coaching.id = g.product_id AND coaching.slug = 'the-boss-boardroom' AND coaching.kind = 'coaching'
  JOIN products course_product ON course_product.kind = 'course'
  JOIN courses c ON c.id = course_product.course_id AND c.slug = 'the-board-room'
 WHERE g.status = 'active'
   AND (g.expires_at IS NULL OR g.expires_at > now())
ON CONFLICT (member_id, product_id) DO NOTHING;
