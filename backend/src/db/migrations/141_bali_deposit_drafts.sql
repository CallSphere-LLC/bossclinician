
-- Owner-specified future options, kept hidden until the total and final due date are confirmed.
-- Existing live prices are untouched: the owner is concurrently editing this offer.
INSERT INTO offer_pricing_options(offer_id,label,pricing_type,amount_cents,deposit_cents,currency,interval,interval_count,installment_count,active,recommended,sort,sales_start_at,sales_end_at)
SELECT id,'December 2026: $500 deposit + 6 monthly payments','payment_plan',83400,50000,currency,'month',1,7,false,false,20,'2026-12-01T08:00:00Z','2027-01-01T08:00:00Z'
FROM offers WHERE slug='bali-private-room'
AND NOT EXISTS (SELECT 1 FROM offer_pricing_options p WHERE p.offer_id=offers.id AND p.label='December 2026: $500 deposit + 6 monthly payments');
INSERT INTO offer_pricing_options(offer_id,label,pricing_type,amount_cents,deposit_cents,currency,interval,interval_count,installment_count,active,recommended,sort,sales_start_at,sales_end_at)
SELECT id,'January 2027: $500 deposit + 5 monthly payments','payment_plan',100000,50000,currency,'month',1,6,false,false,21,'2027-01-01T08:00:00Z','2027-02-01T08:00:00Z'
FROM offers WHERE slug='bali-private-room'
AND NOT EXISTS (SELECT 1 FROM offer_pricing_options p WHERE p.offer_id=offers.id AND p.label='January 2027: $500 deposit + 5 monthly payments');
