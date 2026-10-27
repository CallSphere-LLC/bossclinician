-- BC193: reuse each linked course's existing artwork on the member shelf.
-- Never overwrite a product thumbnail that an administrator has supplied.
UPDATE products p
SET thumbnail_url = c.image, updated_at = now()
FROM courses c
WHERE c.id = p.course_id AND p.kind = 'course'
  AND p.slug IN ('the-boss-move', 'the-practice-elevation', 'the-lounge-vip')
  AND c.slug = p.slug
  AND NULLIF(btrim(p.thumbnail_url), '') IS NULL
  AND NULLIF(btrim(c.image), '') IS NOT NULL;

-- BC197: published paid Lounge offers share onboarding, with conditional VIP copy.
-- Club already names /the-club-ty. Draft/free offers and all billing stay intact.
UPDATE offers SET redirect_url = '/lounge-confirmed', updated_at = now()
WHERE slug IN ('the-lounge', 'the-lounge-vip') AND status = 'published'
  AND COALESCE(redirect_url, '') <> '/lounge-confirmed';
