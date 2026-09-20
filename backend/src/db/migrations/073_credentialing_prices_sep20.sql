-- Prices supplied by the owner on 2026-09-20, replacing the figures taken from
-- the legacy Kajabi catalogue in 070/072. Both courses now have a sales page of
-- their own on this site, and each page quotes the offer rather than a number
-- typed into the page, so these two rows are what a buyer sees and pays.
--
-- The course row's price_text is the catalogue label; the offer's amount_cents
-- is what checkout charges. They are updated together on purpose: 072 exists
-- because they had been allowed to drift apart.
WITH owner_prices(slug, cents, label, headline) AS (VALUES
  ('credentialing-success-formula', 24700, '$247', 'One-time payment. Instant access.'),
  ('credential-with-confidence',    12700, '$127', 'One-time payment. Instant access.')
), priced_offers AS (
  UPDATE offers o
  SET amount_cents = p.cents,
      currency = 'usd',
      checkout_headline = p.headline,
      updated_at = now()
  FROM owner_prices p
  WHERE o.slug = p.slug
    AND o.pricing_type = 'one_time'
    AND (o.amount_cents, o.checkout_headline) IS DISTINCT FROM (p.cents, p.headline)
  RETURNING o.slug
)
UPDATE courses c
SET price_text = p.label, updated_at = now()
FROM owner_prices p
WHERE c.slug = p.slug
  AND c.price_text IS DISTINCT FROM p.label;

-- Neither course carries an instalment plan; a stale one would contradict the
-- single figure both pages print.
DELETE FROM offer_pricing_options po
USING offers o
WHERE po.offer_id = o.id
  AND o.slug IN ('credentialing-success-formula', 'credential-with-confidence');

-- Both rows still pointed at the Kajabi landing pages these two new pages
-- replace. Nothing in the app follows `courses.url` today, but leaving a
-- competitor-of-itself URL on the row is how one gets emailed out later.
UPDATE courses
SET url = '/courses/' || slug, updated_at = now()
WHERE slug IN ('credentialing-success-formula', 'credential-with-confidence')
  AND url <> '/courses/' || slug;
