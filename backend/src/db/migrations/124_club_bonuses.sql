-- =============================================================================
-- Sheet row 111 (19 Oct): The Club's bonuses are now the First 30 Days
-- Success Planner (Bonus #1) and the fast-action Ramp-Up Rate Pricing Formula.
-- The Niche Clarity Accelerator and the Boss Move Kickstart Call are no longer
-- offered as bonuses. The /club/checkout page carries its own copy
-- (frontend/src/content/club.ts); this keeps the offer's description, which
-- /checkout/the-club and the admin offer editor show, saying the same thing.
-- Idempotent: only the block between the bonus heading and the NBCC note is
-- replaced, and only while it still names the old bonuses.
-- =============================================================================
UPDATE offers
   SET description = regexp_replace(
         description,
         'Plus these bonuses, included when you enroll:.*?(The Boss Move is approved by NBCC)',
         E'Plus these bonuses, included when you enroll:\n'
         || E'\U0001F381 BONUS #1: The First 30 Days Success Planner\n'
         || E'Your first month inside The Club already mapped out. Use the planner to stay focused on the right milestones, track your progress, and know what to work on next as you begin building your practice. Designed to help you implement \u2014 not just consume more information.\n'
         || E'\U0001F381 FAST ACTION BONUS: The Ramp-Up Rate Pricing Formula\n'
         || E'Enroll within 72 hours and get the complete rate-setting system free: the Rate-Setting Blueprint, mindset reset training, Ramp-Up Rate Calculator, Rate Comparison Calculator, and workbook, so you charge with confidence from your very first client. ($197 value, sold separately. Does not carry NBCC credit.)\n'
         || E'\\1',
         ''),
       updated_at = now()
 WHERE slug = 'the-club'
   AND description LIKE '%BONUS #2: The Boss Move Kickstart Call%';
