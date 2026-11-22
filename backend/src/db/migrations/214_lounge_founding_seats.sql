-- Lounge founding pricing by paid enrolment count (Yvette, 22 Nov 2026, item 1).
-- The rule and the code that applies it: backend/src/services/loungeSeats.ts.
--
--   Lounge Member: first 20 paid members $197/month or $1,997/year; from the 21st, $247/month or $2,497/year.
--   Lounge VIP:    first 6 paid members $347/month or $3,497/year; then 6 seats, waitlist when all 6 are
--                  active, and the next member joins at $447/month or $4,497/year when a seat frees.
--
-- Prices that already exist are tagged 'founding' and keep their ids and Stripe prices, so every existing
-- subscription keeps its rate. The standard prices are new rows tagged 'standard'; the checkout shows one
-- phase at a time. Nothing here sends email: masterclass emails 11-12 get the new wording and stay OFF.
--
-- ROLLBACK NOTE: code older than this migration ignores price_phase. If the code is rolled back but this
-- migration stays, run:  UPDATE offer_pricing_options SET active = false WHERE price_phase = 'standard';

ALTER TABLE offer_pricing_options
  ADD COLUMN IF NOT EXISTS price_phase text CHECK (price_phase IS NULL OR price_phase IN ('founding', 'standard'));

-- One 'claimed' row per paid member per tier, written once on the first paid order and never removed.
-- 'held' rows reserve a place for 30 minutes between checkout and payment.
CREATE TABLE IF NOT EXISTS lounge_seats (
  id              serial PRIMARY KEY,
  tier            text NOT NULL CHECK (tier IN ('general', 'vip')),
  email           text NOT NULL CHECK (email = lower(email) AND email <> ''),
  contact_id      integer REFERENCES contacts(id) ON DELETE SET NULL,
  member_id       integer REFERENCES members(id) ON DELETE SET NULL,
  order_id        integer REFERENCES orders(id) ON DELETE SET NULL,
  phase           text NOT NULL CHECK (phase IN ('founding', 'standard')),
  status          text NOT NULL CHECK (status IN ('held', 'claimed', 'released', 'void')),
  counts_founding boolean NOT NULL DEFAULT false,
  counts_capacity boolean NOT NULL DEFAULT false,
  hold_expires_at timestamptz,
  over_limit      boolean NOT NULL DEFAULT false,
  source          text NOT NULL DEFAULT 'payment',
  claimed_at      timestamptz,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lounge_seats_one_claim ON lounge_seats (tier, email) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS lounge_seats_live_holds ON lounge_seats (tier, hold_expires_at) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS lounge_seats_order ON lounge_seats (order_id);

-- The four live prices (and the draft preview's two) are the founding prices.
UPDATE offer_pricing_options p SET price_phase = 'founding', updated_at = now()
  FROM offers o
 WHERE o.id = p.offer_id AND o.slug IN ('the-lounge', 'lounge-billing-preview', 'the-lounge-vip')
   AND p.price_phase IS NULL
   AND ((o.slug <> 'the-lounge-vip' AND p.amount_cents IN (19700, 199700))
     OR (o.slug = 'the-lounge-vip' AND p.amount_cents IN (34700, 349700)));

-- The standard prices, same terms: monthly with the 6-month minimum, annual paid upfront for 12 months.
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, minimum_months, sort, active, price_phase)
SELECT o.id, v.label, v.pricing_type, v.amount_cents, 'usd', v.interval, 1, v.minimum_months, v.sort, true, 'standard'
  FROM offers o
  JOIN (VALUES
    ('the-lounge',             $l$Monthly Membership — $247/month$l$,              'subscription', 24700,  'month', 6,    3),
    ('the-lounge',             $l$Annual Membership — $2,497 for 12 months$l$,     'one_time',     249700, NULL,    NULL, 4),
    ('lounge-billing-preview', $l$Monthly Membership — $247/month$l$,              'subscription', 24700,  'month', 6,    3),
    ('lounge-billing-preview', $l$Annual Membership — $2,497 for 12 months$l$,     'one_time',     249700, NULL,    NULL, 4),
    ('the-lounge-vip',         $l$Monthly VIP Membership — $447/month$l$,          'subscription', 44700,  'month', 6,    3),
    ('the-lounge-vip',         $l$Annual VIP Membership — $4,497 for 12 months$l$, 'one_time',     449700, NULL,    NULL, 4)
  ) AS v(slug, label, pricing_type, amount_cents, interval, minimum_months, sort) ON v.slug = o.slug
 WHERE NOT EXISTS (SELECT 1 FROM offer_pricing_options p
                    WHERE p.offer_id = o.id AND p.price_phase = 'standard' AND p.amount_cents = v.amount_cents);

-- Her checkout boxes, one set per phase. The server shows and enforces only the set of the phase on sale.
UPDATE offer_checkout_requirements r
   SET acknowledgments = (
         SELECT COALESCE(jsonb_agg(CASE WHEN item->>'key' IN ('lounge-monthly', 'lounge-annual')
                                        THEN item || '{"pricePhase":"founding"}'::jsonb ELSE item END), '[]'::jsonb)
           FROM jsonb_array_elements(r.acknowledgments) AS item),
       updated_at = now()
  FROM offers o
 WHERE o.id = r.offer_id AND o.slug IN ('the-lounge', 'lounge-billing-preview', 'the-lounge-vip')
   AND jsonb_typeof(r.acknowledgments) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.acknowledgments) AS item
                WHERE item->>'key' IN ('lounge-monthly', 'lounge-annual') AND NOT item ? 'pricePhase');

UPDATE offer_checkout_requirements r
   SET acknowledgments = r.acknowledgments || v.boxes, updated_at = now()
  FROM offers o
  JOIN (VALUES
    ('the-lounge', $a$[{"key": "lounge-monthly-standard", "version": 1, "text": "I understand that I am enrolling in The Lounge at $247 per month with a 6-month minimum commitment totaling $1,482. After the initial 6 months, my membership continues month-to-month at $247 until canceled. I have read and agree to the Terms of Use and refund policy.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "subscription", "pricePhase": "standard"}, {"key": "lounge-annual-standard", "version": 1, "text": "I understand that my $2,497 payment provides twelve months of membership and does not automatically renew.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "one_time", "pricePhase": "standard"}]$a$::jsonb),
    ('lounge-billing-preview', $a$[{"key": "lounge-monthly-standard", "version": 1, "text": "I understand that I am enrolling in The Lounge at $247 per month with a 6-month minimum commitment totaling $1,482. After the initial 6 months, my membership continues month-to-month at $247 until canceled. I have read and agree to the Terms of Use and refund policy.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "subscription", "pricePhase": "standard"}, {"key": "lounge-annual-standard", "version": 1, "text": "I understand that my $2,497 payment provides twelve months of membership and does not automatically renew.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "one_time", "pricePhase": "standard"}]$a$::jsonb),
    ('the-lounge-vip', $a$[{"key": "lounge-monthly-standard", "version": 1, "text": "I understand that I am enrolling in The Lounge VIP at $447 per month with a 6-month minimum commitment totaling $2,682. After the initial 6 months, my membership continues month-to-month at $447 until canceled. I have read and agree to the Terms of Use and refund policy.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "subscription", "pricePhase": "standard"}, {"key": "lounge-annual-standard", "version": 1, "text": "I understand that my $4,497 payment provides twelve months of VIP membership and does not automatically renew.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "one_time", "pricePhase": "standard"}]$a$::jsonb)
  ) AS v(slug, boxes) ON v.slug = o.slug
 WHERE o.id = r.offer_id AND jsonb_typeof(r.acknowledgments) = 'array'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.acknowledgments) AS item WHERE item->>'key' = 'lounge-monthly-standard');

-- Backfill: every real paid member so far, once per tier, from the site's orders and Kajabi's purchases.
-- Excluded: internal contacts, ZZ test records, free/100%-off orders, refunded orders, the free VIP offer,
-- and order 201 (the owner's own $2 LOUNGE26 test purchase, 8 Nov 2026). On 22 Nov 2026 this finds none:
-- 0 paid Lounge Members and 0 paid VIP members.
INSERT INTO lounge_seats (tier, email, contact_id, member_id, order_id, phase, status, claimed_at, source, notes)
SELECT DISTINCT ON (x.tier, x.email) x.tier, x.email, x.contact_id, x.member_id, x.order_id, 'founding', 'claimed', x.paid_at, 'backfill', x.note
  FROM (
    SELECT CASE WHEN f.slug = 'the-lounge-vip' THEN 'vip' ELSE 'general' END AS tier,
           lower(ord.email) AS email, ord.contact_id, ord.member_id, ord.id AS order_id, ord.created_at AS paid_at,
           'order ' || ord.id AS note
      FROM orders ord
      JOIN offers f ON f.id = ord.offer_id AND f.slug IN ('the-lounge', 'the-lounge-vip')
      LEFT JOIN contacts c ON c.id = ord.contact_id
     WHERE ord.status = 'paid' AND ord.total_cents > 0 AND COALESCE(ord.refunded_cents, 0) < ord.total_cents
       AND ord.id <> 201
       AND COALESCE(c.is_internal, false) = false
       AND ord.email <> '' AND lower(ord.email) NOT LIKE 'zz%' AND lower(ord.email) NOT LIKE '%+zz%'
       AND COALESCE(c.name, '') NOT ILIKE 'zz%'
    UNION ALL
    SELECT CASE WHEN f.slug = 'the-lounge-vip' THEN 'vip' ELSE 'general' END,
           lower(c.email::text), p.contact_id, p.member_id, NULL, p.purchased_at,
           'kajabi purchase ' || p.id
      FROM purchases p
      JOIN offers f ON f.id = p.offer_id AND f.slug IN ('the-lounge', 'the-lounge-vip')
      JOIN contacts c ON c.id = p.contact_id
     WHERE p.status IN ('active', 'complete', 'completed', 'paused') AND p.total_cents > 0
       AND COALESCE(c.is_internal, false) = false
       AND lower(c.email::text) NOT LIKE 'zz%' AND lower(c.email::text) NOT LIKE '%+zz%'
       AND COALESCE(c.name, '') NOT ILIKE 'zz%'
  ) x
 WHERE x.email IS NOT NULL AND x.email <> ''
 ORDER BY x.tier, x.email, x.paid_at NULLS LAST
ON CONFLICT (tier, email) WHERE status = 'claimed' DO NOTHING;

-- The VIP waitlist (shown in place of the VIP checkout once all six seats are active).
INSERT INTO tags (name, slug, description)
SELECT 'Lounge VIP Waitlist', 'lounge-vip-waitlist', 'Asked to be told when a Lounge VIP seat becomes available (VIP waitlist form).'
 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'lounge-vip-waitlist');

INSERT INTO forms
  (slug, name, description, description_md, fields, submit_label, success_message,
   create_lead, published, post_action, spam_protection, notify_on_submit, notify_emails, apply_tag_ids)
SELECT 'lounge-vip-waitlist', 'Lounge VIP Waitlist',
       'Shown on /lounge and the VIP checkout when all six VIP seats are filled. Tags the contact Lounge VIP Waitlist; sends no email to them.',
       '',
       $f$[{"key":"first_name","type":"text","label":"First Name","required":true,"contactField":"firstName"},{"key":"last_name","type":"text","label":"Last Name","required":false,"contactField":"lastName"},{"key":"email","type":"email","label":"Email","required":true,"contactField":"email"}]$f$::jsonb,
       'JOIN THE VIP WAITLIST',
       'You’re on the VIP waitlist. We’ll email you when a VIP seat becomes available.',
       false, true, 'message', 'honeypot', true, '',
       ARRAY(SELECT id FROM tags WHERE slug = 'lounge-vip-waitlist')
 WHERE NOT EXISTS (SELECT 1 FROM forms WHERE slug = 'lounge-vip-waitlist');

-- Masterclass emails 11-12 (sequence maxed-out-masterclass). Wording made true in either phase; both stay OFF.
--   Email 11: the price paragraph becomes {{lounge.memberRate}}, filled at send time from the seat count.
--   Email 12: is only about the founding rate, so it is skipped once Lounge Member founding places are filled.
UPDATE sequence_emails e
   SET body_md = replace(e.body_md,
         'The founding Lounge Member rate is $197 per month, with a six-month minimum commitment totaling $1,182. After that, membership continues month-to-month unless canceled. The monthly rate for new members rises to $247 when founding enrollment closes.',
         '{{lounge.memberRate}}'),
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id AND s.slug = 'maxed-out-masterclass' AND e.position = 11
   AND e.body_md LIKE '%The monthly rate for new members rises to $247 when founding enrollment closes.%';

UPDATE sequence_emails e
   SET body_md = replace(replace(e.body_md,
         'One quick reminder: the founding Lounge Member rate is for the first 20 founding members.',
         'One quick reminder: the founding Lounge Member rate is for the first 20 paid Lounge Members.'),
         'While those places remain available, you can join at $197 per month with a six-month minimum commitment. Once founding enrollment closes, the monthly rate for new members becomes $247.',
         'While those places remain available, you can join at $197 per month with a six-month minimum commitment, or $1,997 for 12 months paid upfront. Starting with the 21st paid member, pricing for new members increases to $247 per month or $2,497 per year.'),
       skip_rules = COALESCE(e.skip_rules, '{}'::jsonb) || '{"loungeFoundingFullTiers":["general"]}'::jsonb,
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id AND s.slug = 'maxed-out-masterclass' AND e.position = 12;

UPDATE email_sequences
   SET description = replace(description,
         'Emails 11-12 (founding rate) are off until the founding offer is confirmed.',
         'Emails 11-12 (founding rate, by paid seat count since 22 Nov) are built but OFF until the owner approves the wording; 12 skips itself once the 20 founding Lounge Member places are filled.'),
       updated_at = now()
 WHERE slug = 'maxed-out-masterclass';
