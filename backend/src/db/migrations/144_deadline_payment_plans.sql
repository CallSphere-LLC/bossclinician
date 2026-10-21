ALTER TABLE offer_pricing_options ADD COLUMN IF NOT EXISTS plan_total_cents integer;
ALTER TABLE offer_pricing_options ADD COLUMN IF NOT EXISTS balance_due_by date;
ALTER TABLE offer_pricing_options ADD CONSTRAINT deadline_plan_valid CHECK (
  (plan_total_cents IS NULL AND balance_due_by IS NULL) OR
  (plan_total_cents > deposit_cents AND deposit_cents > 0 AND balance_due_by IS NOT NULL
   AND pricing_type='payment_plan' AND interval='month' AND interval_count=1 AND trial_days=0)
);

-- New checkouts only. Existing orders retain their signed billing snapshots.
UPDATE offer_pricing_options SET active=false,updated_at=now()
WHERE offer_id IN(SELECT id FROM offers WHERE slug IN('bali-private-room','bali-shared-room')) AND pricing_type='payment_plan';
INSERT INTO offer_pricing_options(offer_id,label,pricing_type,amount_cents,deposit_cents,currency,interval,interval_count,installment_count,trial_days,active,recommended,sort,sales_end_at,plan_total_cents,balance_due_by)
SELECT id,'$500 deposit + monthly payments; paid by June 8, 2027','payment_plan',100000,50000,'usd','month',1,6,0,true,false,10,'2027-02-01T08:00:00Z',550000,'2027-06-08'
FROM offers WHERE slug='bali-private-room';
-- Preserve the separate shared-room price while applying the same cutoff and
-- payoff rules to its new enrollments.
INSERT INTO offer_pricing_options(offer_id,label,pricing_type,amount_cents,deposit_cents,currency,interval,interval_count,installment_count,trial_days,active,recommended,sort,sales_end_at,plan_total_cents,balance_due_by)
SELECT id,'$500 deposit + monthly payments; paid by June 8, 2027','payment_plan',80000,50000,'usd','month',1,6,0,true,false,10,'2027-02-01T08:00:00Z',amount_cents,'2027-06-08'
FROM offers WHERE slug='bali-shared-room';
UPDATE offers SET amount_cents=550000,updated_at=now() WHERE slug='bali-private-room';
