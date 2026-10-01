-- 103: one price everywhere, and the live Kajabi catalogue published here.
--
-- Owner's rule (2026-10-01): the price is what Kajabi's live checkout charges,
-- because that is what real customers pay today, and every page on this site
-- states that same price. Source of truth, fetched 2026-10-01 for every offer
-- token linked anywhere on www.bossclinician.com (sitemap crawl):
--   GET https://www.bossclinician.com/api/offers/<token>/checkout?source=embedded
-- Raw responses: /var/tmp/bc-prices-1001/<token>.json on server-64gbRam.
--
-- 1. Prices that disagreed with Kajabi's checkout (before -> after):
--      Credentialing Success Formula (bhkvLZTX)  $247 -> $17
--      Credential With Confidence Kit (uGqHXnvS) $127 -> $27
--      Provider Partnership Guide (9npNMM3P)     $97  -> $47
--    The courses catalogue's price_text follows (courses 3, 4, 7).
--    Two extra ways to pay that Kajabi's checkout does not sell are switched
--    off (kept, not deleted: orders reference pricing options):
--      From Profile to Profit  "2 monthly payments of $50" (Kajabi: $97 only)
--      Client Consultation Call Script "$24 now + $24 after 7 days" (Kajabi:
--        $37 only; its 2-payment offer E5ayb8f7 returns offer_not_found)
--    Every other offer already matched Kajabi to the cent (see the report).
--
-- 2. The Boss Boardroom is $12,000 (GSWsHBTx) or "4 quarterly payments of
--    $3,000" (bossclinician.com/work-with-me). 088 stored the second as an
--    open-ended subscription every 3 months, which would never stop billing;
--    it becomes a 4-payment plan. The application form (074) said $18,000 and
--    offered 2 x $9,000 / 6 x $3,000 / 12 x $1,500, none of which exist; it now
--    offers the two real ways to pay (frontend/src/content/boardroom.ts carries
--    the identical strings: the server validates replies against this row).
--    The Boardroom coaching program gets Kajabi's price and 24 sessions.
--
-- 3. Publishing. Everything Kajabi sells live that has something to deliver
--    here is published. Rules the checkout enforces (services/downloadReadiness)
--    and the admin publish guard (routes/admin/offers.ts assertPublishable):
--    a course product needs a published lesson with content, a download needs
--    its file on disk, and an offer needs at least one product.
--      * Products: The Boss Move, Profitable Private Practices training, The
--        Lounge VIP, The Practice Elevation (courses, lessons imported by 094),
--        Supervisory Billing Documentation Packet and The Private Practice
--        Planner (downloads, files verified in the running pod 2026-10-01).
--      * Practice Reset Intensive, Scale and Reclaim Suite and The Boss
--        Boardroom were `course` products on empty courses (15/16/17), so their
--        checkouts would 503. They are coaching programs: the products become
--        `coaching` products on coaching programs 23/24/22, exactly like the
--        Club's coaching product (69), and programs 23/24 are published.
--      * The Directory Makeover Audit (S7FaR5BM / ETdu5ctJ / wCanMVm6, $67 /
--        $97 / $147) is a done-for-you service whose product was an empty
--        course; the product becomes an email-delivered one and the offer sells.
--      * The Lounge VIP offer also grants what the Lounge offer grants (the
--        Lounge community group and Credential With Confidence): VIP is sold as
--        "Everything in the Lounge Membership", but 088 linked only two courses.
--      * Offers: The Lounge, The Lounge VIP, Practice Reset Intensive, Scale and
--        Reclaim Suite, The Boss Boardroom, Directory Makeover Audit,
--        Supervisory Billing Documentation Packet, The Private Practice
--        Planner, Profitable Private Practices (CEU course), Bali Private Room
--        and Bali Shared Room.
--    Left as drafts on purpose (nothing to deliver, or not a live sale): the
--    Private Practice Blueprint-VIP, Do's and Don'ts of Documentation (Edu/CE),
--    Audit Proof on-demand (x2), Audit Proof Your Practice (x2) and Therapist
--    Directory Audit (no product attached); "The Lounge VIP" free offer (would
--    give the VIP course away); Practice Foundations Intensives (unlinked
--    duplicate of Practice Reset Intensive).
--
-- 4. Bali retreat. Kajabi (boofdeo2) sells the Private Room as $5,500 in full,
--    or a $500 deposit today then 9 x $556 after a 30-day trial. Checkout here
--    has no deposit / setup-fee charge, so the deposit plan cannot be offered
--    truthfully: the offers go live at their pay-in-full price, the plan options
--    are switched off, and the checkout copy no longer promises a $500 charge.
--    A retreat place is delivered by email, so both offers grant one product
--    (`access_group` kind with no group: the library says "delivered outside the
--    library - check your email").
--
--    Also fixed: the free "how to improve relations" Lounge offer granted the
--    (empty) Directory Makeover Audit course instead of its group product, so
--    every sign-up was refused.
--    Still broken and NOT fixable from data: the published Rate Renegotiate
--    Letter Templates offer ($7) grants a course with no lessons and no file
--    exists here, so its checkout refuses to sell until the templates are
--    uploaded (as a download) or lessons are added.
--
-- 5. The developer's "ZZ Test - buyer welcome" automation is paused, and the
--    marketing Reply-To becomes Yvette's real mailbox (the one on the legal
--    pages); the From address is the sending domain and is left alone.
--
-- No emails, no Stripe calls, no jobs. Stripe price ids are cleared on every
-- repriced row (as PUT /admin/offers/:id does) so checkout mints fresh ones.
-- Idempotent: every statement is guarded on the value it replaces.

-- ── 1. Prices: Kajabi checkout is the truth ─────────────────────────────────
UPDATE offers SET amount_cents = 1700, stripe_price_id = NULL, updated_at = now()
 WHERE slug = 'credentialing-success-formula' AND pricing_type = 'one_time' AND amount_cents = 24700;
UPDATE offers SET amount_cents = 2700, stripe_price_id = NULL, updated_at = now()
 WHERE slug = 'credential-with-confidence' AND pricing_type = 'one_time' AND amount_cents = 12700;
UPDATE offers SET amount_cents = 4700, stripe_price_id = NULL, updated_at = now()
 WHERE slug = 'provider-partnership-guide' AND pricing_type = 'one_time' AND amount_cents = 9700;

UPDATE courses SET price_text = '$17', updated_at = now()
 WHERE slug = 'credentialing-success-formula' AND price_text = '$247';
UPDATE courses SET price_text = '$27', updated_at = now()
 WHERE slug = 'credential-with-confidence' AND price_text = '$127';
UPDATE courses SET price_text = '$47', updated_at = now()
 WHERE slug = 'provider-partnership-guide' AND price_text = '$97';

-- Ways to pay that Kajabi's checkout does not offer.
UPDATE offer_pricing_options op SET active = false, recommended = false, updated_at = now()
  FROM offers o
 WHERE op.offer_id = o.id AND o.slug = 'from-profile-to-profit'
   AND op.pricing_type = 'payment_plan' AND op.amount_cents = 5000 AND op.installment_count = 2
   AND op.active;
UPDATE offer_pricing_options op SET active = false, recommended = false, updated_at = now()
  FROM offers o
 WHERE op.offer_id = o.id AND o.slug = 'client-consultation-call-script'
   AND op.pricing_type = 'payment_plan' AND op.amount_cents = 2400 AND op.installment_count = 2
   AND op.active;
UPDATE courses SET price_text = '$97', updated_at = now()
 WHERE slug = 'from-profile-to-profit' AND price_text = '$97 or 2 monthly payments of $50 ($100 total)';
UPDATE courses SET price_text = '$37', updated_at = now()
 WHERE slug = 'client-consultation-call-script' AND price_text = '$37 or $24 now + $24 after 7 days ($48 total)';

-- ── 2. The Boss Boardroom: $12,000, or 4 quarterly payments of $3,000 ───────
UPDATE offer_pricing_options op
   SET label = '4 quarterly payments of $3,000 ($12,000 total)',
       pricing_type = 'payment_plan', interval = 'month', interval_count = 3, installment_count = 4,
       stripe_price_id = NULL, updated_at = now()
  FROM offers o
 WHERE op.offer_id = o.id AND o.slug = 'the-boss-boardroom'
   AND op.pricing_type = 'subscription' AND op.amount_cents = 300000
   AND op.interval = 'month' AND op.interval_count = 3;

UPDATE coaching_offers SET price_cents = 1200000, session_count = 24, updated_at = now()
 WHERE slug = 'boss-clinician-boardroom' AND price_cents = 0;

UPDATE forms f
   SET fields = (
         SELECT jsonb_agg(
                  CASE
                    WHEN x.e->>'key' = 'payment_preference' THEN
                      jsonb_set(x.e, '{options}',
                        '["Pay in full — $12,000", "4 quarterly payments of $3,000", "I''d like to discuss the options before deciding"]'::jsonb)
                    WHEN x.e->>'key' = 'commitment' THEN
                      jsonb_set(x.e, '{label}', to_jsonb(replace(x.e->>'label', '$18,000', '$12,000')))
                    ELSE x.e
                  END
                  ORDER BY x.ord)
           FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS x(e, ord)
       ),
       updated_at = now()
 WHERE f.slug = 'boardroom-application'
   AND f.fields::text LIKE '%$18,000%';

-- ── 3a. Coaching programs sold as coaching, not as empty courses ────────────
UPDATE products p
   SET kind = 'coaching', coaching_offer_id = co.id, course_id = NULL, updated_at = now()
  FROM coaching_offers co,
       (VALUES ('practice-reset-intensive', 'practice-reset-intensive'),
               ('scale-and-reclaim-suite',  'scale-and-reclaim-suite'),
               ('the-boss-boardroom',       'boss-clinician-boardroom')) AS v(product_slug, program_slug)
 WHERE p.slug = v.product_slug AND co.slug = v.program_slug
   AND p.kind = 'course'
   AND NOT EXISTS (
         SELECT 1 FROM course_modules m JOIN course_lessons l ON l.module_id = m.id
          WHERE m.course_id = p.course_id);

UPDATE coaching_offers SET published = true, updated_at = now()
 WHERE slug IN ('practice-reset-intensive', 'scale-and-reclaim-suite')
   AND published = false AND archived_at IS NULL;

-- The Directory Makeover Audit is a done-for-you review of the buyer's
-- directory profiles, not a course: its course (1) has never had a lesson, so
-- every checkout was refused. As an `access_group` product with no group the
-- library tells the buyer it is delivered outside the library (by email). The
-- course row stays linked so /courses/directory-makeover-audit keeps selling it
-- (services/courseOffers.ts joins on the product's course).
UPDATE products p SET kind = 'access_group', updated_at = now()
 WHERE p.slug = 'directory-makeover-audit' AND p.kind = 'course'
   AND NOT EXISTS (
         SELECT 1 FROM course_modules m JOIN course_lessons l ON l.module_id = m.id
          WHERE m.course_id = p.course_id);

-- The Lounge VIP is sold as "Everything in the Lounge Membership" plus VIP, but
-- 088 gave its offer only the two courses: a VIP buyer would get no Lounge room.
-- It grants what the Lounge offer grants (the Lounge group, Credential With
-- Confidence) as well.
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT vip.id, op.product_id, 10 + op.sort
  FROM offers vip, offers member
  JOIN offer_products op ON op.offer_id = member.id
 WHERE vip.slug = 'the-lounge-vip' AND member.slug = 'the-lounge'
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = vip.id AND x.product_id = op.product_id);

-- ── 3b. Products Kajabi sells, now with content here ────────────────────────
UPDATE products SET status = 'published', updated_at = now()
 WHERE status = 'draft'
   AND slug IN ('the-boss-move', 'profitable-private-practices-training', 'the-lounge-vip',
                'the-practice-elevation', 'supervisory-billing-documentation-packet',
                'the-private-practice-planner', 'practice-reset-intensive',
                'scale-and-reclaim-suite', 'the-boss-boardroom');

-- ── 4. Bali retreat: a place delivered by email, sold at pay-in-full ─────────
INSERT INTO products (slug, title, subtitle, description, kind, status, sort)
SELECT 'bali-retreat-2027',
       'Release. Restore. Reconnect. Retreat in Bali',
       'June 15–20, 2027 · Ubud, Bali',
       'Your place at the Release. Restore. Reconnect. Retreat in Bali, June 15–20, 2027. Your trip details and next steps come by email; questions any time to retreats@bossclinician.com.',
       'access_group', 'published', 40
 WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = 'bali-retreat-2027');

INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0
  FROM offers o, products p
 WHERE o.slug IN ('bali-private-room', 'bali-shared-room') AND p.slug = 'bali-retreat-2027'
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

-- The "$500 deposit today, then $X/month" plans: no deposit charge exists here.
UPDATE offer_pricing_options op SET active = false, recommended = false, updated_at = now()
  FROM offers o
 WHERE op.offer_id = o.id AND o.slug IN ('bali-private-room', 'bali-shared-room')
   AND op.pricing_type = 'payment_plan' AND op.label LIKE '$500.00 deposit today%' AND op.active;

UPDATE offers
   SET description = 'Reserve your place at the Release. Restore. Reconnect. Retreat in Bali, June 15–20, 2027. All payments are non-refundable. By completing your purchase, you confirm that you have read and agree to the full Retreat Terms of Service and Trip Agreement. Travel insurance is strongly recommended — visit trawickinternational.com.',
       updated_at = now()
 WHERE slug IN ('bali-private-room', 'bali-shared-room')
   AND description LIKE '%your card will be charged $500 today%';

-- ── 3c. Offers: publish the live Kajabi offers that now deliver something ───
UPDATE offers o SET status = 'published', updated_at = now()
 WHERE o.status = 'draft'
   AND o.slug IN ('the-lounge', 'the-lounge-vip', 'practice-reset-intensive', 'directory-makeover-audit',
                  'scale-and-reclaim-suite', 'the-boss-boardroom',
                  'supervisory-billing-documentation-packet', 'the-private-practice-planner',
                  'profitable-private-practices-ceu', 'bali-private-room', 'bali-shared-room')
   AND EXISTS (SELECT 1 FROM offer_products op WHERE op.offer_id = o.id)
   -- Never publish an offer whose checkout would refuse to sell: every course
   -- it grants needs a published lesson with content.
   AND NOT EXISTS (
         SELECT 1 FROM offer_products op JOIN products p ON p.id = op.product_id
          WHERE op.offer_id = o.id AND p.kind = 'course'
            AND NOT EXISTS (
                  SELECT 1 FROM course_modules m JOIN course_lessons l ON l.module_id = m.id
                   WHERE m.course_id = p.course_id AND l.published = true
                     AND (length(trim(l.body_md)) > 0 OR l.video_url <> '' OR l.audio_url <> ''
                          OR l.attachment_url <> '' OR l.embed_html <> '')));

-- The free "how to improve relations" offer (088) is meant to grant its own
-- Lounge group product, but it grants the Directory Makeover Audit course,
-- which has no lessons, so its checkout refuses every sign-up. Point it back.
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0
  FROM offers o, products p
 WHERE o.slug = 'community-14-group-13' AND p.slug = 'community-14-group-13'
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);
DELETE FROM offer_products op
 USING offers o, products p
 WHERE op.offer_id = o.id AND op.product_id = p.id
   AND o.slug = 'community-14-group-13' AND p.slug = 'directory-makeover-audit';

-- ── 5. Housekeeping ─────────────────────────────────────────────────────────
UPDATE automations SET status = 'paused', updated_at = now()
 WHERE name = 'ZZ Test — buyer welcome' AND status = 'active';

UPDATE settings
   SET value = jsonb_set(value, '{replyTo}', '"yvette@bossclinician.com"'::jsonb), updated_at = now()
 WHERE key = 'marketing_email' AND value->>'replyTo' = 'yvette@bossclinician.callsphere.site';
