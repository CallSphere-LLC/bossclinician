-- 105 — Bali retreat payment plans, and purchases land on their Kajabi thank-you pages (2026-10-01).
--
-- Bali: Kajabi sells each room as a $500 deposit then 9 monthly payments after a
-- 30-day trial. Our checkout cannot charge a deposit on the first invoice, so 103
-- switched those options off and left pay-in-full only. This adds the closest
-- plan the checkout supports: 9 equal monthly payments, first one today, so the
-- last lands before the June 8, 2027 balance deadline (Private 9 x $612 = $5,508,
-- close to Kajabi's $5,504 plan total; Shared 9 x $500 = $4,500).
-- Idempotent: inserted only when the offer has no active option with that label.

INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, interval, interval_count, installment_count, trial_days, recommended, active, sort)
SELECT o.id, v.label, 'payment_plan', v.cents, 'month', 1, 9, 0, false, true, 1
  FROM (VALUES ('bali-private-room', '$612.00 every month for 9 months ($5,508 total)', 61200),
               ('bali-shared-room',  '$500.00 every month for 9 months ($4,500 total)', 50000)) AS v(slug, label, cents)
  JOIN offers o ON o.slug = v.slug
 WHERE NOT EXISTS (SELECT 1 FROM offer_pricing_options x WHERE x.offer_id = o.id AND x.label = v.label);

-- Purchases go to the offer's own thank-you page (rebuilt from Kajabi in 100), as
-- they did on Kajabi. Only where no redirect is set yet, so an admin choice stays.
UPDATE offers o
   SET redirect_url = v.url, updated_at = now()
  FROM (VALUES ('credential-with-confidence',       '/credential-with-confidencekit-Confirmed'),
               ('private-practice-protection-pack', '/protectionpackthanks'),
               ('private-practice-starter-suite',   '/starterconfirmed'),
               ('the-club',                         '/the-club-ty'),
               ('fully-booked-toolkit',             '/thank-you-fullybooked'),
               ('rate-negotiation-letter-template', '/thank-you-rate-renegotiate'),
               ('audit-proof-on-demand',            '/thank-you-audit-proof'),
               ('audit-proof-on-demand-educational','/thank-you-audit-proof')) AS v(slug, url)
 WHERE o.slug = v.slug AND COALESCE(o.redirect_url, '') = '';
