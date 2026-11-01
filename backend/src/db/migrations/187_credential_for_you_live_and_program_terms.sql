-- 187: Yvette's second round of decisions, 31 Oct 2026 (sheet row 214 and her
-- refund and access answers). Idempotent. Sends nothing and enrols nobody.
--
-- access_grants is not read or written by this file. A term set here reaches only
-- a grant written after deploy, and a grant that already has no end date keeps it
-- (the ON CONFLICT in services/access.ts).

/* ── Per-offer settings ────────────────────────────────────────────────────── */

-- Printed at the foot of a receipt instead of the site-wide refund policy.
-- Empty means the site-wide policy, so every other offer's receipt is unchanged.
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS receipt_refund_policy TEXT NOT NULL DEFAULT '';

-- A fixed-count payment plan now follows the offer's access term (services/access.ts).
-- This marks the exception: an offer whose installment plan carries on month to
-- month after its minimum, so a calendar term would cut off a member still paying.
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS plan_access_open_ended BOOLEAN NOT NULL DEFAULT false;

-- When set, the refund deadline is the end of the day in this zone, N calendar days
-- after the payment date there. Null keeps the instant of payment plus N days.
ALTER TABLE offer_checkout_requirements
  ADD COLUMN IF NOT EXISTS refund_deadline_time_zone TEXT;

-- Once per order, so a replayed payment callback does not repeat the intake email.
CREATE TABLE IF NOT EXISTS credentialing_intake_emails (
  order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

/* ── Credential For You: the three checkouts go on sale ────────────────────── */

-- Their wording first, then the switch, so nobody can reach an old description.
-- Each REPLACE finds nothing on a re-run, and anything she has rewritten stands.
UPDATE offers
   SET description = REPLACE(
         REPLACE(
           REPLACE(
             description,
             'Your next step is to complete your credentialing intake and provide the documentation needed for your enrollment.',
             'Your next step is to complete your credentialing intake.'
           ),
           'Your credentialing timeline begins once your intake is complete and all required documents have been received.',
           'Your credentialing timeline begins once your intake is complete, your service agreement is completed, and all required documents and information have been received.'
         ),
         'Medicare, Medicaid, TRICARE, group enrollment, or other complex enrollment needs may be added separately.',
         'This package includes up to 6 commercial payer applications for one provider.'
           || E'\n\n'
           || 'Medicare, Medicaid, TRICARE/federal plans, group enrollment, additional providers, and other enrollment needs outside of this scope are not included and may require a separate service or quote.'
       ),
       receipt_refund_policy = 'All Credential For You purchases are final and non-refundable. Because credentialing services involve administrative preparation, review, onboarding, and reserved service capacity, refunds are not provided after purchase.',
       -- Q19 (migration 183) put the Terms on every offer published at the time. These
       -- were drafts, so it missed them.
       require_terms = true,
       terms_url = CASE WHEN terms_url = '' THEN '/terms' ELSE terms_url END,
       updated_at = now()
 WHERE slug IN ('credential-for-you-commercial', 'credential-for-you-medicare', 'credential-for-you-package');

-- Her required box, version 2: a buyer who ticked version 1 on an open page is asked
-- to read it again. Only the wording changes; the link and any other box stay.
UPDATE offer_checkout_requirements r
   SET acknowledgments = (
         SELECT jsonb_agg(
                  CASE WHEN item.value ->> 'key' = 'credentialing-terms'
                       THEN item.value || jsonb_build_object(
                              'version', 2,
                              'text', 'I understand that credentialing timelines and payer decisions are controlled by the payer. Boss Clinician does not guarantee payer approval, network acceptance, reimbursement rates, effective dates, or credentialing completion timelines. I understand that my credentialing timeline begins once my intake is complete, my service agreement is completed, and all required documents and information have been received. All Credential For You purchases are final and non-refundable. Because credentialing services involve administrative preparation, review, onboarding, and reserved service capacity, refunds are not provided after purchase.'
                            )
                       ELSE item.value
                  END
                  ORDER BY item.ordinality
                )
           FROM jsonb_array_elements(r.acknowledgments) WITH ORDINALITY AS item(value, ordinality)
       ),
       updated_at = now()
  FROM offers o
 WHERE o.id = r.offer_id
   AND o.slug IN ('credential-for-you-commercial', 'credential-for-you-medicare', 'credential-for-you-package')
   AND r.acknowledgments @> '[{"key":"credentialing-terms","version":1}]'::jsonb;

-- What the stored form says when opened at /f/. The page at /credentialing-intake
-- prints the same sentence from content/credentialForYou.ts.
UPDATE forms
   SET success_message = REPLACE(
         success_message,
         'Your credentialing timeline begins once your intake is complete and all required documents have been received.',
         'Your credentialing timeline begins once your intake is complete, your service agreement is completed, and all required documents and information have been received.'
       ),
       updated_at = now()
 WHERE slug = 'credential-for-you-intake';

-- The admin's going-live check refuses an offer with no products (migration 181),
-- which is why this flip is done here.
UPDATE offers
   SET status = 'published',
       updated_at = now()
 WHERE slug IN ('credential-for-you-commercial', 'credential-for-you-medicare', 'credential-for-you-package')
   AND status = 'draft';

/* ── The Club's refund deadline ────────────────────────────────────────────── */

-- 11:59 p.m. Pacific on the 14th calendar day. The Club has no requirements row yet,
-- so this may create one holding only this setting. That switches nothing on: only
-- an active box, a required contract or an invitation does (requirementsAreOn), and
-- the admin form and scripts/activate-program-agreements.js keep this column, since
-- neither names it. The Lounge has no value here and keeps its own rule.
INSERT INTO offer_checkout_requirements (offer_id, refund_deadline_time_zone)
SELECT o.id, 'America/Los_Angeles' FROM offers o WHERE o.slug = 'the-club'
ON CONFLICT (offer_id) DO UPDATE
  SET refund_deadline_time_zone = EXCLUDED.refund_deadline_time_zone;

/* ── Access terms for new purchases ────────────────────────────────────────── */

-- Six months and twelve months from each member's own start, in days because that is
-- the only unit grants have (accessExpiresAt). NULL only, so a later choice stands.
UPDATE offers SET access_expires_after_days = 183, updated_at = now()
 WHERE slug = 'the-club' AND access_expires_after_days IS NULL;

UPDATE offers SET access_expires_after_days = 365, updated_at = now()
 WHERE slug = 'the-boss-boardroom' AND access_expires_after_days IS NULL;

-- Q1: Lounge monthly is six months minimum, then month to month until cancelled. It is
-- stored as a 6-payment plan, so without this its buyers would lose access at 365 days
-- (the annual term from migration 183) while still members. Same as before this file.
UPDATE offers SET plan_access_open_ended = true, updated_at = now()
 WHERE slug IN ('the-lounge', 'the-lounge-vip') AND NOT plan_access_open_ended;
