-- Yvette's 15 November 2026 confirmation: six Boardroom members.
-- Display-copy correction only. Do not alter terms, pricing, invitations,
-- checkout behavior, access grants, or any capacity enforcement.
-- Forward migration preserves historical migrations and is idempotent.
UPDATE offers
 SET description = replace(description,
   'an intimate peer group of 6–8, capped at eight',
   'an intimate peer group of exactly six')
 WHERE slug = 'the-boss-boardroom'
   AND description LIKE '%an intimate peer group of 6–8, capped at eight%';
