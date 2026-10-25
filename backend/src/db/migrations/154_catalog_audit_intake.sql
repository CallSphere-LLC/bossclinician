-- QA Bugs 174-175: reclassify the existing purchases; retain their offer and grants.
-- The template already has a verified Google copy link in product_files.
UPDATE products
   SET kind = 'download', legacy_course_id = course_id, course_id = NULL,
       instructions = 'Open the Insurance Rate Increase Letter Templates link and make your own copy before editing.',
       updated_at = now()
 WHERE slug = 'rate-negotiation-letter-template'
   AND kind = 'course' AND course_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM product_files f WHERE f.product_id = products.id);

-- The audit already has access_group fulfillment and no lessons. Keep that kind:
-- a paid service is delivered by Yvette, not by a fabricated course resource.
UPDATE products SET legacy_course_id = course_id, course_id = NULL, updated_at = now()
 WHERE slug = 'directory-makeover-audit' AND kind = 'access_group' AND course_id IS NOT NULL;

-- A real, site-owned intake form. It is created only if the slug is free.
-- The form asks only for the links and preferences promised in the owner copy.
INSERT INTO forms
  (slug, name, description, fields, submit_label, success_message,
   create_lead, published, post_action, spam_protection, notify_on_submit, notify_emails)
SELECT
  'directory-makeover-audit-intake',
  'Directory Makeover Audit ? Intake',
  'For customers who purchased a Directory Makeover Audit. Share the directory profiles and what you would like improved.',
  $fields$[
    {"key":"audit_order_token","type":"hidden","label":"Purchase verification","required":false},
    {"key":"name","type":"text","label":"Your name","required":true},
    {"key":"email","type":"email","label":"Email used at checkout","required":true,"contactField":"email"},
    {"key":"profile_links","type":"textarea","label":"Directory profile link(s) to audit","required":true},
    {"key":"platforms","type":"checkboxes","label":"Which platforms should I review?","required":true,
     "options":["Psychology Today","TherapyDen","Therapy for Black Girls","Zencare","Mental Health Match","Inclusive Therapists","Other"]},
    {"key":"goals","type":"textarea","label":"What would you most like to improve about your profile?","required":true},
    {"key":"preferences","type":"textarea","label":"Anything else I should know before I begin?","required":false}
  ]$fields$::jsonb,
  'Send my intake',
  'Thank you. Your audit intake is in; Yvette can begin your review.',
  false, true, 'message', 'honeypot', true, 'yvette@bossclinician.com'
WHERE NOT EXISTS (SELECT 1 FROM forms WHERE slug = 'directory-makeover-audit-intake');

-- A once-per-order claim for the transactional intake message. The purchase
-- handler uses this to avoid duplicate sends from replayed payment callbacks.
CREATE TABLE IF NOT EXISTS directory_audit_intake_emails (
  order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
