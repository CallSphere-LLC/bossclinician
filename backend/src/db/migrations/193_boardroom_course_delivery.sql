-- Owner email, 2 November 2026 UTC: new Boardroom enrollments receive
-- The Board Room course, not the retired private-consulting product.
-- Keep the consulting product and all prior grants/history intact.
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o JOIN products p ON p.slug = 'the-board-room'
 WHERE o.slug = 'the-boss-boardroom' AND p.kind = 'course'
ON CONFLICT (offer_id, product_id) DO UPDATE SET sort = 0;

DELETE FROM offer_products op USING offers o, products p
 WHERE op.offer_id = o.id AND op.product_id = p.id
   AND o.slug = 'the-boss-boardroom'
   AND p.slug = 'the-boss-boardroom' AND p.kind = 'coaching'
   AND EXISTS (SELECT 1 FROM offer_products delivered JOIN products course ON course.id = delivered.product_id
                WHERE delivered.offer_id = o.id AND course.slug = 'the-board-room' AND course.kind = 'course');

-- Release every existing published lesson immediately, without publishing
-- draft lessons (the unrelated Lounge challenge remains a draft).
UPDATE course_modules m SET drip_days = NULL, drip_date = NULL, updated_at = now()
 FROM courses c WHERE m.course_id = c.id AND c.slug IN ('the-board-room', 'the-practice-elevation')
 AND (m.drip_days IS NOT NULL OR m.drip_date IS NOT NULL);
UPDATE course_lessons l SET drip_days = NULL, drip_date = NULL, publish_at = NULL,
 requires_previous_lesson = false, updated_at = now()
 FROM course_modules m, courses c WHERE l.module_id = m.id AND m.course_id = c.id
 AND c.slug IN ('the-board-room', 'the-practice-elevation') AND l.published
 AND (l.drip_days IS NOT NULL OR l.drip_date IS NOT NULL OR l.publish_at IS NOT NULL OR l.requires_previous_lesson);
