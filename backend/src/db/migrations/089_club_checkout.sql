-- The Club checkout on this site (QA sheet, 2026-10-01).
--
-- /club's "Join the Club" buttons used to leave for Kajabi's hosted checkout
-- (www.bossclinician.com/offers/tzgjALKU/checkout). They now open /club/checkout,
-- which sells offer 39 ("the-club") through the site's own Stripe checkout.
-- Kajabi's public checkout API for tzgjALKU, read 2026-10-01:
--   * $1,997.00 one-time payment (recommended)  = offers.amount_cents 199700
--   * $397.00 every month for 6 months           = offer_pricing_options id 9
--     (payment_plan, 39700 x 6, monthly) — both already match; not touched here.
--   * name + address required, service agreement required, not giftable.
--
-- Offer 39 was a DRAFT (088), and the public offer API answers 404 for drafts,
-- so it is published here. Publishing alone is not enough: every checkout
-- refuses (503) while an attached course has no published lesson content, and
-- the one product 088 attached — The Boss Move (course 52) — has no lessons yet
-- (Kajabi's lesson content has not been imported). So, until it does:
--   * the Club's own deliverable — the 6-month coaching programme, coaching
--     offer 21 "boss-clinician-club" — is attached as a coaching product
--     (coaching products are always deliverable: a grant puts the buyer on the
--     coaching roster and "Open your coaching" in their library);
--   * The Boss Move stays attached: its Kajabi lessons are imported with this
--     release (backend/scripts/kajabi-import).
--
-- No emails, no Stripe calls (the Stripe price for the monthly plan is minted
-- on the first sale, as for every recurring offer). Idempotent: every
-- statement is guarded.

-- 1. The Club coaching programme as a product.
INSERT INTO products (slug, title, subtitle, description, kind, coaching_offer_id, status, sort)
SELECT 'the-club-coaching', $kj$The Club — 6-Month Coaching Program$kj$, '', co.description,
       'coaching', co.id, 'published', 19
  FROM coaching_offers co
 WHERE co.slug = 'boss-clinician-club'
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = 'the-club-coaching');

-- 2. The Club offer grants it.
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0
  FROM offers o
  JOIN products p ON p.slug = 'the-club-coaching'
 WHERE o.slug = 'the-club'
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

-- 3. (Removed before release: The Boss Move stays on the offer. Its 56 Kajabi
--    lessons are imported alongside this release, 2026-10-01.)

-- 4. Kajabi's order form, then publish. Only from draft, so a later archive or
--    admin edit is never undone by a re-run.
UPDATE offers
   SET require_terms = true,
       allow_gifting = false,
       collect_address = true,
       status = 'published',
       updated_at = now()
 WHERE slug = 'the-club' AND status = 'draft'
   AND EXISTS (SELECT 1 FROM offer_products op WHERE op.offer_id = offers.id);
