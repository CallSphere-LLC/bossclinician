-- Turns on the Lounge's real billing. To release: copy this to the next migration
-- number and set LOUNGE_BILLING_LIVE = true in frontend/src/content/lounge.ts, in one
-- commit. Not run automatically. Existing manual grants and any earlier order are untouched.
UPDATE offer_pricing_options p
   SET pricing_type = 'subscription', installment_count = NULL, minimum_months = 6, stripe_price_id = NULL,
       label = CASE o.slug WHEN 'the-lounge' THEN '$197/month: 6-month minimum, then month-to-month'
                           ELSE '$347/month: 6-month minimum, then month-to-month' END,
       updated_at = now()
  FROM offers o
 WHERE o.id = p.offer_id AND o.slug IN ('the-lounge', 'the-lounge-vip')
   AND p.pricing_type = 'payment_plan' AND p.installment_count = 6 AND p.interval = 'month';

UPDATE offers SET plan_access_open_ended = false, receipt_refund_policy = $r$7-Day Money-Back Guarantee: email support@bossclinician.com within seven calendar days of your initial payment, by 11:59 p.m. Pacific Time, for a full refund. An approved refund ends your enrollment and future payments. It does not restart on renewals.$r$, updated_at = now()
 WHERE slug IN ('the-lounge', 'the-lounge-vip');

INSERT INTO offer_checkout_requirements
  (offer_id, acknowledgments, program_term, term_months, refund_terms, refund_window_days, refund_deadline_time_zone, obligations_note)
SELECT o.id, $a$[{"key":"lounge-enrollment-terms","version":1,"text":"I have reviewed my payment option, total, term, renewal, cancellation method and 7-day guarantee shown above, and I agree to the Terms of Use.","linkLabel":"Read the Terms of Use","linkUrl":"/terms","active":true}]$a$::jsonb, $t$12 months of access from your enrollment date. No automatic renewal: access ends at 12 months unless you separately renew.$t$, 12, $g$7-Day Money-Back Guarantee: a full refund on your initial paid purchase if you email support@bossclinician.com within seven calendar days, whether or not you have viewed or downloaded resources. This is a paid purchase, not a free trial, and the guarantee does not restart on renewals. An approved refund ends your enrollment and any future payments.$g$, 7, 'America/Los_Angeles', $n$After the guarantee window the annual fee is generally nonrefundable, subject to applicable law. There is no recurring charge without a new authorization.$n$
  FROM offers o WHERE o.slug IN ('the-lounge', 'the-lounge-vip')
ON CONFLICT (offer_id) DO UPDATE SET
  acknowledgments = EXCLUDED.acknowledgments, program_term = EXCLUDED.program_term, term_months = EXCLUDED.term_months,
  refund_terms = EXCLUDED.refund_terms, refund_window_days = EXCLUDED.refund_window_days,
  refund_deadline_time_zone = EXCLUDED.refund_deadline_time_zone, obligations_note = EXCLUDED.obligations_note, updated_at = now();
