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

-- Her checkout wording, per payment option (sheet rows 195-196).
UPDATE offers SET checkout_headline = $h$You’re One Step Away From The Boss Clinician Lounge$h$, description = $d$Get the strategy, tools, and ongoing support to make your established practice more sustainable.

**Your membership includes:**

- The Practice Elevation four-module signature curriculum.
- Monthly 90-minute live Strategy Sessions with Yvette.
- The Boss Clinician Toolkit with templates, workbooks, and trackers.
- The Practice Elevation Dashboard.
- A guided Private Practice Business Plan.
- Private Lounge community access.
- The Replay Vault.
- Access to live Lounge challenges throughout the year.

Access to membership content and ongoing benefits continues while your membership is active.

Questions before joining? Email [support@bossclinician.com](mailto:support@bossclinician.com).$d$,
       allow_gifting = false, show_in_cart = false, require_terms = false, updated_at = now()
 WHERE slug = 'the-lounge';
UPDATE offer_pricing_options p SET label = $l$Monthly Membership — $197/month$l$, updated_at = now()
  FROM offers o WHERE o.id = p.offer_id AND o.slug = 'the-lounge' AND p.minimum_months = 6;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval_count, sort, active)
SELECT o.id, $l$Annual Membership — $1,997 for 12 months$l$, 'one_time', 199700, 'usd', 1, 2, true
  FROM offers o WHERE o.slug = 'the-lounge'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options p WHERE p.offer_id = o.id AND p.pricing_type = 'one_time' AND p.amount_cents = 199700);
UPDATE offer_checkout_requirements r SET acknowledgments = $a$[{"key": "lounge-monthly", "version": 1, "text": "I understand that I am enrolling at $197 per month with a six-month minimum commitment totaling $1,182. After six months, my membership continues monthly unless canceled.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "subscription"}, {"key": "lounge-annual", "version": 1, "text": "I understand that my $1,997 payment provides twelve months of membership and does not automatically renew.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "one_time"}]$a$::jsonb, updated_at = now()
  FROM offers o WHERE o.id = r.offer_id AND o.slug = 'the-lounge';
UPDATE offers SET checkout_headline = $h$Join The Boss Clinician Lounge VIP$h$, description = $d$Build a more sustainable practice with the Lounge curriculum, tools, and community—plus personalized feedback and private strategy support from Yvette.

**Everything Inside the Lounge**

- The Practice Elevation four-module signature curriculum.
- Monthly 90-minute live Strategy Sessions with Yvette.
- The Practice Elevation Dashboard and quarterly Practice Health Assessment.
- The Boss Clinician Toolkit with workbooks, templates, and trackers.
- A guided Private Practice Business Plan.
- Private Lounge community access.
- The Replay Vault.
- Live Lounge challenges throughout the year.

**Your Additional VIP Support**

**Private Strategy Calls**

Receive three private 30-minute calls during your first six months:

- **Kickoff Call:** Review your practice snapshot, clarify priorities, and identify your first steps.
- **90-Day Momentum Review:** Evaluate progress, work through barriers, and adjust your plan.
- **6-Month Elevation Review:** Review results and map your next six months.

After your first six months, receive one additional private 30-minute Strategic Review every six months while your VIP membership remains continuously active. Your next call is around month twelve, followed by months eighteen, twenty-four, and so on.

The same call schedule applies to monthly and annual VIP members. The initial three-call series does not restart with renewal. Calls are scheduled within their milestone windows and do not accumulate or roll over.

**Monthly Personalized Voice-Note Answer**

Submit one practice-related question each month and receive a personalized voice-note response from Yvette.

**Monthly Recorded Materials Review**

Submit one item each month—such as your professional profile, niche statement, website copy, or pricing document—and receive one recorded review with practical recommendations.

**Quarterly Priority Hot Seat**

Receive one guaranteed hot seat per quarter during a monthly group Strategy Session. Submit your question in advance for focused coaching.

**Additional VIP Access**

Access your private VIP submission portal and receive early access to new modules and resources before general release.

**What Happens After Checkout?**

Check your email for your receipt, login instructions, and VIP onboarding steps. Inside your member area, you’ll find instructions for accessing your resources, scheduling your Kickoff Call, and submitting your first question or materials.

Membership content and ongoing benefits are available during your active membership. Membership does not include lifetime access.

Questions before joining? Email [support@bossclinician.com](mailto:support@bossclinician.com).$d$,
       allow_gifting = false, show_in_cart = false, require_terms = false, updated_at = now()
 WHERE slug = 'the-lounge-vip';
UPDATE offer_pricing_options p SET label = $l$Monthly VIP Membership — $347/month$l$, updated_at = now()
  FROM offers o WHERE o.id = p.offer_id AND o.slug = 'the-lounge-vip' AND p.minimum_months = 6;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval_count, sort, active)
SELECT o.id, $l$Annual VIP Membership — $3,497 for 12 months$l$, 'one_time', 349700, 'usd', 1, 2, true
  FROM offers o WHERE o.slug = 'the-lounge-vip'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options p WHERE p.offer_id = o.id AND p.pricing_type = 'one_time' AND p.amount_cents = 349700);
UPDATE offer_checkout_requirements r SET acknowledgments = $a$[{"key": "lounge-monthly", "version": 1, "text": "I understand that I am enrolling in VIP membership at $347 per month with a six-month minimum commitment totaling $2,082. After six months, my membership continues monthly unless canceled.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "subscription"}, {"key": "lounge-annual", "version": 1, "text": "I understand that my $3,497 payment provides twelve months of VIP membership and does not automatically renew.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "one_time"}]$a$::jsonb, updated_at = now()
  FROM offers o WHERE o.id = r.offer_id AND o.slug = 'the-lounge-vip';
