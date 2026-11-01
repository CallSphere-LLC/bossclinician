-- Lounge billing per the owner's brief (1 Nov 2026), switched OFF. This adds the
-- columns and a DRAFT preview; the live Lounge offers do not change here. They change
-- in backend/scripts/lounge-billing-activate.sql, released with LOUNGE_BILLING_LIVE.
ALTER TABLE offer_pricing_options ADD COLUMN IF NOT EXISTS minimum_months integer CHECK (minimum_months IS NULL OR minimum_months > 0);
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS minimum_term_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_cancel_at timestamptz,
  ADD COLUMN IF NOT EXISTS minimum_order_id integer REFERENCES orders(id);
CREATE INDEX IF NOT EXISTS subscriptions_minimum_order ON subscriptions (minimum_order_id) WHERE minimum_order_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS enrollment_terms jsonb;

-- The Boardroom's enrollment record, shown to invited applicants only.
INSERT INTO offer_checkout_requirements
  (offer_id, invitation_required, program_term, term_months, included_benefits, refund_terms, obligations_note)
SELECT o.id, true,
  $t$12 months from your enrollment date. No automatic renewal: access ends at the end of your term unless you enroll again.$t$, 12,
  $b$4 quarterly CEO strategy intensives (3-4 hours each); 8 momentum check-ins (60 minutes each); 2 private 45-minute CEO strategy sessions; 2 guest expert sessions; up to 2 voice-note questions per month, with a response targeted within 2 business days; CEO Dashboard, Living Business Plan, Executive Circle and relevant vault resources for your term. Done-for-you operations and payer credentialing are not included.$b$,
  $r$No voluntary prorated refund or automatic early release from valid installments, subject to applicable law and company nonperformance remedies.$r$,
  $n$Your payment schedule is one fixed 12-month commitment, not a cancel-anytime quarterly membership. Payment defaults carry a seven-day written notice to cure, as provided in your agreement.$n$
  FROM offers o WHERE o.slug = 'the-boss-boardroom'
ON CONFLICT (offer_id) DO UPDATE SET
  program_term = EXCLUDED.program_term, term_months = EXCLUDED.term_months, included_benefits = EXCLUDED.included_benefits,
  refund_terms = EXCLUDED.refund_terms, obligations_note = EXCLUDED.obligations_note, updated_at = now();

-- A draft copy of The Lounge, so the owner can read the new checkout in Admin's
-- preview. Draft offers cannot be bought.
DO $$
DECLARE new_id integer; source_id integer;
BEGIN
  SELECT id INTO source_id FROM offers WHERE slug = 'the-lounge';
  IF source_id IS NULL OR EXISTS (SELECT 1 FROM offers WHERE slug = 'lounge-billing-preview') THEN RETURN; END IF;
  CREATE TEMP TABLE offer_copy ON COMMIT DROP AS SELECT * FROM offers WHERE id = source_id;
  new_id := nextval(pg_get_serial_sequence('offers', 'id'));
  UPDATE offer_copy SET id = new_id, slug = 'lounge-billing-preview', title = 'The Lounge (billing preview)',
         status = 'draft', stripe_price_id = NULL, stripe_product_id = NULL, plan_access_open_ended = false,
         receipt_refund_policy = $r$7-Day Money-Back Guarantee: email support@bossclinician.com within seven calendar days of your initial payment, by 11:59 p.m. Pacific Time, for a full refund. An approved refund ends your enrollment and future payments. It does not restart on renewals.$r$;
  INSERT INTO offers SELECT * FROM offer_copy;
  INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, minimum_months, sort, active)
  VALUES (new_id, '$197/month: 6-month minimum, then month-to-month', 'subscription', 19700, 'usd', 'month', 1, 6, 1, true);
END $$;
INSERT INTO offer_checkout_requirements
  (offer_id, acknowledgments, program_term, term_months, refund_terms, refund_window_days, refund_deadline_time_zone, obligations_note)
SELECT o.id, $a$[{"key":"lounge-enrollment-terms","version":1,"text":"I have reviewed my payment option, total, term, renewal, cancellation method and 7-day guarantee shown above, and I agree to the Terms of Use.","linkLabel":"Read the Terms of Use","linkUrl":"/terms","active":true}]$a$::jsonb, $t$12 months of access from your enrollment date. No automatic renewal: access ends at 12 months unless you separately renew.$t$, 12, $g$7-Day Money-Back Guarantee: a full refund on your initial paid purchase if you email support@bossclinician.com within seven calendar days, whether or not you have viewed or downloaded resources. This is a paid purchase, not a free trial, and the guarantee does not restart on renewals. An approved refund ends your enrollment and any future payments.$g$, 7, 'America/Los_Angeles', $n$After the guarantee window the annual fee is generally nonrefundable, subject to applicable law. There is no recurring charge without a new authorization.$n$
  FROM offers o WHERE o.slug = 'lounge-billing-preview'
ON CONFLICT (offer_id) DO UPDATE SET
  acknowledgments = EXCLUDED.acknowledgments, program_term = EXCLUDED.program_term, term_months = EXCLUDED.term_months,
  refund_terms = EXCLUDED.refund_terms, refund_window_days = EXCLUDED.refund_window_days,
  refund_deadline_time_zone = EXCLUDED.refund_deadline_time_zone, obligations_note = EXCLUDED.obligations_note, updated_at = now();
