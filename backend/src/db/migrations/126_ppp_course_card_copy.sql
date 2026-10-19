-- =============================================================================
-- Sheet row 116 follow-up (19 Oct): the /courses catalogue prints each course's
-- full description on its card, and every other card carries one or two
-- sentences plus a short "Inside you will get" list. Migration 125's long
-- Kajabi copy made the Profitable Private Practices card ~1,700px tall, so the
-- description is cut to the same shape; the four learning objectives stay as
-- the card's list and the course page's "What's inside".
-- Only fires while the description is still exactly migration 125's text.
-- =============================================================================
UPDATE courses
   SET description = 'Start or grow a private practice the right way: legally sound, ethically responsible and clinically aligned. On-demand training with Yvette Howard, LCSW, with 4 NBCC CE hours and lifetime access.',
       updated_at = now()
 WHERE slug = 'profitable-private-practices-training'
   AND description LIKE 'Launching a private practice can be both liberating and overwhelming%ACEP No. 7998.';

-- The catalogue card's price line is display text; it matches the published
-- offer profitable-private-practices-ceu ($149, one-time).
UPDATE courses
   SET price_text = '$149', updated_at = now()
 WHERE slug = 'profitable-private-practices-training' AND price_text = '';
