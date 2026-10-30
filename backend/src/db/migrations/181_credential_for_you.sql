-- 181: Credential For You, the done-for-you credentialing service (sheet row 214).
--
-- Three published one-time offers and two forms. These offers deliver no course
-- or product: fulfilment grants nothing and the order is the record, so
-- offer_products stays empty on purpose (a repeat purchase for a second payer
-- must not be told "you already have access"). There are no Stripe ids either: a
-- one-time checkout builds its PaymentIntent from amount_cents.
--
-- One thing that follows: the admin's going-live check refuses an offer with no
-- products, so one of these switched to draft can't be published again until a
-- product is attached. Edits to a live offer are not affected.
--
-- The three "starting at" services (CAQH x2, Recredentialing) have no offer. Her
-- page quotes them as "Starting at" with no buy button, and her directions say a
-- price that isn't known before review goes through the request form.
--
-- These offers send no welcome email (its template says the purchase is "waiting
-- in your library", and here there is no library item), no cart reminders, and no
-- sequence. Owner sale emails stay on, as for every other offer. They stay out of
-- the cart: the required box can't be collected there.
--
-- Nothing existing is touched and nobody is emailed by this file. Idempotent by
-- slug: anything she has edited since stands on a re-run.

WITH checkout_copy AS (
  SELECT
    $next$### What happens after payment

Your next step is to complete your credentialing intake and provide the documentation needed for your enrollment.

Your credentialing timeline begins once your intake is complete and all required documents have been received.
The purchase date is not automatically the credentialing start date.

### Credentialing Disclaimer

Credentialing support does not guarantee acceptance into an insurance network, an open payer panel, a particular reimbursement rate, a specific credentialing completion date, retroactive reimbursement, payer approval, or specific contracting terms.

Insurance companies and government programs make their own enrollment and contracting decisions.

Credentialing timelines vary by payer and may be affected by panel availability, provider type, state requirements, payer processing times, missing documentation, and requests for additional information.$next$ AS tail
)
-- Seeded as drafts: the owner still has to settle this service's refund policy, how
-- documents reach us securely, and whether the Package is fixed or "starting at".
-- When she has, run this, and set CHECKOUTS_OPEN in content/credentialForYou.ts:
--   UPDATE offers SET status = 'published' WHERE slug IN ('credential-for-you-commercial',
--     'credential-for-you-medicare', 'credential-for-you-package');
INSERT INTO offers
  (slug, title, internal_title, status, pricing_type, amount_cents, currency, description,
   redirect_url, collect_phone, custom_fields,
   send_welcome_email, recovery_enabled, show_in_cart, allow_gifting, includes_certificate)
SELECT
  x.slug, x.title, x.internal_title, x.status, 'one_time', x.amount_cents, 'usd', x.body || E'\n\n' || checkout_copy.tail,
  '/credentialing-next-steps', true, x.custom_fields::jsonb,
  false, false, false, false, false
FROM checkout_copy CROSS JOIN (VALUES
  (
    'credential-for-you-commercial', 'Commercial Insurance Credentialing',
    'Credential For You — Commercial Payer', 'draft', 22500,
    $body$For providers enrolling with commercial insurance companies. Pricing applies to one payer and one provider.

### What's included

{checks}
- Provider information review
- CAQH review/update as needed
- Payer application preparation
- Application submission
- Routine status follow-up
- Response to standard payer requests
- Tracking through payer determination
- Effective-date confirmation when provided$body$,
    $fields$[{"key":"payer","label":"Payer/insurance company being requested","type":"text","required":true,"options":[]}]$fields$
  ),
  (
    'credential-for-you-medicare', 'Medicare Credentialing Support',
    'Credential For You — Medicare', 'draft', 49700,
    $body$This service is for Original Medicare enrollment, per provider.

Medicare Advantage enrollment is not automatically included because those plans may require separate payer enrollment.

### What's included

{checks}
- PECOS enrollment or applicable reassignment
- Required Medicare enrollment information
- EFT enrollment support
- Application preparation and submission
- Routine status follow-up
- Response to standard development requests
- Enrollment status tracking
- Final enrollment confirmation when available$body$,
    '[]'
  ),
  (
    'credential-for-you-package', 'Provider Credentialing Package',
    'Credential For You — Provider Credentialing Package', 'draft', 199700,
    $body$Designed for providers who want support establishing a broader insurance-based practice without managing multiple payer applications on their own.

### What's included

{checks}
- CAQH setup or review
- Up to 6 commercial payer applications
- Application preparation
- Application submission
- Routine payer follow-up
- Credentialing tracking
- Effective-date tracking
- Final credentialing status summary

Medicare, Medicaid, TRICARE, group enrollment, or other complex enrollment needs may be added separately.$body$,
    '[]'
  )
) AS x(slug, title, internal_title, status, amount_cents, body, custom_fields)
ON CONFLICT (slug) DO NOTHING;

-- Her required box, enforced at POST /checkout/offer/:slug for card, wallet,
-- PayPal and free checkouts alike (services/checkoutRequirements.ts). Her wording,
-- section 9 of the directions. The link is the only thing added to it: it sits
-- right above the payment form and opens the disclaimer in a new tab.
INSERT INTO offer_checkout_requirements (offer_id, acknowledgments)
SELECT o.id, $ack$[{
  "key": "credentialing-terms",
  "version": 1,
  "text": "I understand that credentialing timelines and payer decisions are controlled by the payer. Purchasing credentialing support does not guarantee network acceptance, reimbursement rates, effective dates, payer approval, or a specific completion date. I understand that my credentialing timeline begins once my completed intake and all required documents have been received.",
  "linkLabel": "Read the credentialing disclaimer",
  "linkUrl": "/credential-for-you#disclaimer",
  "active": true
}]$ack$::jsonb
FROM offers o
WHERE o.slug IN (
  'credential-for-you-commercial', 'credential-for-you-medicare', 'credential-for-you-package'
)
ON CONFLICT (offer_id) DO NOTHING;

-- The two forms. Their keys are one contract with content/credentialForYou.ts,
-- which draws them natively at /credentialing-request and /credentialing-intake.
-- No sequence, no tags, no double opt-in: each reply is filed under Forms and
-- emailed to the owner.
--
-- The intake never asks for banking details, a Social Security number or a date
-- of birth. Tax ID is optional and accepts only the EIN shape (12-3456789), so an
-- SSN typed there is refused rather than filed and emailed.
INSERT INTO forms
  (slug, name, description, description_md, fields, submit_label, success_message,
   create_lead, published, post_action, spam_protection, notify_on_submit, notify_emails)
SELECT * FROM (VALUES
  (
    'credential-for-you-request',
    'Credential For You — Service Request',
    'Request credentialing support or a quote for a variable-scope service.',
    '',
    $fields$[
      {"key":"name","type":"text","label":"Name","required":true},
      {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"},
      {"key":"phone","type":"text","label":"Phone","required":true,"contactField":"phone"},
      {"key":"practice_name","type":"text","label":"Practice Name","required":false},
      {"key":"state","type":"text","label":"State","required":true},
      {"key":"license_type","type":"text","label":"License Type","required":true},
      {"key":"provider_or_group","type":"radio","label":"Individual Provider or Group Practice","required":true,
       "options":["Individual Provider","Group Practice"]},
      {"key":"service","type":"select","label":"Which service do you need?","required":true,
       "options":["Commercial Insurance","Medicare","Medicaid","TRICARE / Federal Plan","Group Enrollment","Adding Provider to Existing Group","CAQH","Recredentialing","Ongoing Credentialing Maintenance","Not Sure"]},
      {"key":"payer","type":"text","label":"Insurance payer or program requested","required":false},
      {"key":"provider_count","type":"text","label":"Number of providers needing credentialing","required":true},
      {"key":"currently_enrolled","type":"radio","label":"Are you currently enrolled with this payer?","required":false,
       "options":["Yes","No","Not Sure"]},
      {"key":"message","type":"textarea","label":"Anything else we should know?","required":false}
    ]$fields$::jsonb,
    'Request Credentialing Support',
    'Thank you. Your credentialing request is in, and we will follow up with you.',
    true, true, 'message', 'honeypot', true, 'yvette@bossclinician.com'
  ),
  (
    'credential-for-you-intake',
    'Credential For You — Credentialing Intake',
    'For customers who purchased credentialing support: the information needed to begin.',
    'Please do not enter banking details, a Social Security number or a date of birth on this form.',
    $fields$[
      {"key":"name","type":"text","label":"Provider legal name","required":true},
      {"key":"email","type":"email","label":"Email used at checkout","required":true,"contactField":"email"},
      {"key":"phone","type":"text","label":"Phone","required":true,"contactField":"phone"},
      {"key":"service_purchased","type":"select","label":"Service purchased","required":true,
       "options":["Commercial Insurance Credentialing","Medicare Credentialing Support","Provider Credentialing Package","Other credentialing service"]},
      {"key":"practice_legal_name","type":"text","label":"Practice/legal business name","required":true},
      {"key":"npi_type_1","type":"text","label":"NPI Type 1","required":true,"pattern":"^[0-9]{10}$"},
      {"key":"npi_type_2","type":"text","label":"NPI Type 2 if applicable","required":false,"pattern":"^[0-9]{10}$"},
      {"key":"tax_id","type":"text","label":"Tax ID/EIN (EIN only, like 12-3456789. Leave blank rather than enter a Social Security number.)","required":false,"pattern":"^[0-9]{2}-[0-9]{7}$"},
      {"key":"practice_address","type":"textarea","label":"Practice address","required":true},
      {"key":"billing_address","type":"textarea","label":"Billing address","required":true},
      {"key":"service_locations","type":"textarea","label":"Service locations","required":true},
      {"key":"license_information","type":"textarea","label":"Professional license information","required":true},
      {"key":"malpractice_information","type":"textarea","label":"Malpractice insurance information","required":true},
      {"key":"education_training","type":"textarea","label":"Education and training history","required":true},
      {"key":"caqh_information","type":"textarea","label":"CAQH information","required":false},
      {"key":"payer_selections","type":"textarea","label":"Payer selections","required":true},
      {"key":"existing_enrollment","type":"textarea","label":"Existing enrollment information","required":false},
      {"key":"group_affiliations","type":"textarea","label":"Group affiliations","required":false},
      {"key":"other_payer_information","type":"textarea","label":"Other payer-specific information needed to determine next steps","required":false}
    ]$fields$::jsonb,
    'Submit My Credentialing Intake',
    'Thank you. Your credentialing intake is in. Your credentialing timeline begins once your intake is complete and all required documents have been received. The purchase date is not automatically the credentialing start date.',
    false, true, 'message', 'honeypot', true, 'yvette@bossclinician.com'
  )
) AS seed(slug, name, description, description_md, fields, submit_label, success_message,
          create_lead, published, post_action, spam_protection, notify_on_submit, notify_emails)
ON CONFLICT (slug) DO NOTHING;
