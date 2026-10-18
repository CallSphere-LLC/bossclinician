-- =============================================================================
-- 120 — One-to-one programmes live under Coaching; Stripe Payment Links.
--
-- 1. QA sheet row 99 (owner, 15-Oct): "The course section you have 'Practice
--    Reset Intensive' 'The Boss Boardroom' and 'Scale and Reclaim Suite' can you
--    move that over to the coaching area instead? Those are for 1:1 coaching".
--
--    What was in "the course section" was three bare `courses` rows (15, 16, 17)
--    left over from the July Kajabi store import: unpublished, no modules, no
--    lessons, no enrollments, and no product pointing at them. The things that
--    are sold and granted — products 10, 11 and 12 — are already kind 'coaching'
--    and point at the coaching programmes from 078 (coaching_offers
--    practice-reset-intensive, scale-and-reclaim-suite, boss-clinician-
--    boardroom), whose Clients tab already lists their buyers and the Kajabi
--    clients. Nothing about a sale, a price, an offer or a grant changes here.
--
--    Each coaching product is linked to its course row through
--    `products.legacy_course_id` — the column 051 uses for the same job on
--    downloads — matched on the shared slug. That link is what:
--      - takes the course row out of the admin Courses list (routes/admin/
--        courses.ts hides a course whose product is a download or coaching),
--        without deleting it, so its curriculum stays editable from the
--        programme's card on the Coaching page;
--      - makes anything put in that curriculum (a workbook lesson, the
--        Boardroom CEO Dashboard tool) reachable by the programme's grant
--        holders: hasCourseAccess and the drip clock read the link for coaching
--        products, and the member library opens the programme as its course
--        once it has a published lesson.
--    `course_id` is deliberately NOT used: the admin product editor treats a
--    product's course_id as the resource it sells and would show the course
--    instead of the coaching programme.
--
--    Kajabi-imported clients (coaching_enrollments) are not given access here:
--    078 is explicit that an enrollment is not an entitlement.
--
-- 2. QA sheet row 92: "Can we add a stripe pay link to check out". A Stripe
--    Payment Link per offer price, created only when the admin presses the
--    button (routes/admin/offers.ts → services/paymentLinks.ts) and fulfilled by
--    the Stripe webhook like any checkout. `pricing_option_id` NULL is the
--    offer's own (first) price; a row per extra pricing option otherwise. The
--    figures the link was minted at are kept so the admin can be told when the
--    price has since changed. Deactivated links stay as rows: a payment that
--    arrives through one after the fact must still find its offer.
--
-- Every statement is guarded, so re-running the file changes nothing.
-- =============================================================================

-- --- 1. Coaching programmes keep their course rows out of the course list ------

INSERT INTO product_type_migration_audit
  (product_id, course_id, title, before_kind, after_kind, evidence, offer_ids, grant_ids)
SELECT p.id, c.id, p.title, p.kind, p.kind,
       'Owner QA sheet row 99, 2026-10-15: move to coaching (1:1 coaching); course row linked as legacy_course_id',
       COALESCE((SELECT jsonb_agg(op.offer_id ORDER BY op.offer_id) FROM offer_products op WHERE op.product_id = p.id), '[]'::jsonb),
       COALESCE((SELECT jsonb_agg(g.id ORDER BY g.id) FROM access_grants g WHERE g.product_id = p.id), '[]'::jsonb)
  FROM products p
  JOIN courses c ON c.slug = p.slug
 WHERE p.kind = 'coaching'
   AND p.coaching_offer_id IS NOT NULL
   AND p.legacy_course_id IS NULL
   AND p.slug IN ('practice-reset-intensive', 'scale-and-reclaim-suite', 'the-boss-boardroom')
   -- Only a course row no other product sells, so a real course is never hidden.
   AND NOT EXISTS (SELECT 1 FROM products other WHERE other.course_id = c.id)
ON CONFLICT (product_id) DO NOTHING;

UPDATE products p
   SET legacy_course_id = c.id,
       updated_at = now()
  FROM courses c
 WHERE c.slug = p.slug
   AND p.kind = 'coaching'
   AND p.coaching_offer_id IS NOT NULL
   AND p.legacy_course_id IS NULL
   AND p.slug IN ('practice-reset-intensive', 'scale-and-reclaim-suite', 'the-boss-boardroom')
   AND NOT EXISTS (SELECT 1 FROM products other WHERE other.course_id = c.id);

-- --- 2. Stripe Payment Links -----------------------------------------------------

CREATE TABLE IF NOT EXISTS offer_payment_links (
  id                     SERIAL PRIMARY KEY,
  offer_id               INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  -- No foreign key on purpose: a deleted pricing option must not turn its
  -- link's row into one for the offer's own price (SET NULL would), and the
  -- row is history either way. The webhook joins it to a live option or none.
  pricing_option_id      INT,
  stripe_payment_link_id TEXT NOT NULL UNIQUE,
  stripe_price_id        TEXT NOT NULL,
  url                    TEXT NOT NULL,
  -- The price the link charges, as minted. Compared with the offer's current
  -- price to warn that the link is out of date.
  pricing_type           TEXT NOT NULL,
  amount_cents           INT NOT NULL CHECK (amount_cents >= 0),
  currency               TEXT NOT NULL DEFAULT 'usd',
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_by             TEXT NOT NULL DEFAULT '',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_offer_payment_links_offer ON offer_payment_links (offer_id, active);

-- One live link per price: a second press of "Create" while one is live is a
-- mistake the database refuses rather than a second link for the same price.
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_payment_links_one_active
  ON offer_payment_links (offer_id, COALESCE(pricing_option_id, 0)) WHERE active;

-- Orders bought through a link, keyed by the Checkout Session Stripe opened for
-- it, so a redelivered or racing webhook can never create a second order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_link_session
  ON orders (stripe_session_id) WHERE source = 'payment_link' AND stripe_session_id IS NOT NULL;
