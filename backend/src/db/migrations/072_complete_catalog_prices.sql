-- Match the public prices linked from bossclinician.com/all-courses,
-- checked 2026-09-19. These seven offers already have the correct checkout
-- amounts; their blank catalog labels hid the prices on /courses.
WITH source_prices(slug, cents, label) AS (VALUES
  ('fully-booked-toolkit', 6700, '$67'),
  ('credentialing-success-formula', 1700, '$17'),
  ('private-practice-starter-suite', 2700, '$27'),
  ('ramp-up-rate-formula', 9700, '$97'),
  ('provider-partnership-guide', 9700, '$97'),
  ('private-practice-protection-pack', 9700, '$97'),
  ('from-profile-to-profit', 9700, '$97 or 2 monthly payments of $50 ($100 total)')
)
UPDATE courses c SET price_text = s.label, updated_at = now()
FROM source_prices s
WHERE c.slug = s.slug
  AND EXISTS (SELECT 1 FROM offers o WHERE o.slug = s.slug
              AND o.amount_cents = s.cents AND o.currency = 'usd')
  AND c.price_text IS DISTINCT FROM s.label;

-- /profiletoprofitguide explicitly advertises two monthly $50 payments.
-- Reuse the same finite installment contract as the other native offers.
INSERT INTO offer_pricing_options
  (offer_id, label, pricing_type, amount_cents, currency, interval,
   interval_count, installment_count, sort)
SELECT o.id, '2 monthly payments of $50 ($100 total)', 'payment_plan',
       5000, 'usd', 'month', 1, 2, 1
FROM offers o WHERE o.slug = 'from-profile-to-profit'
  AND NOT EXISTS (
    SELECT 1 FROM offer_pricing_options p WHERE p.offer_id = o.id
      AND p.pricing_type = 'payment_plan' AND p.amount_cents = 5000
      AND p.interval = 'month' AND p.installment_count = 2
  );

UPDATE offers
SET checkout_headline = 'Pay $97 in full, or 2 monthly payments of $50 ($100 total).',
    updated_at = now()
WHERE slug = 'from-profile-to-profit';
