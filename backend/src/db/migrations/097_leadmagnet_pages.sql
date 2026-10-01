-- 097 — The Kajabi opt-in / lead-magnet pages, rebuilt at their own paths.
--
-- Owner's rule: every Kajabi page exists here as our own page, and nothing
-- redirects or links to bossclinician.com. Migration 004 sent these fourteen
-- paths to /resources; the pages now exist
-- (frontend/src/pages/kajabi/leadmagnets/routes.tsx), so their redirect rows go.
--
--   /5-step-marketing -> /marketing-step-form        5-Step Marketing Plan opt-in
--   /business-plan-guide -> /business-plan-ty         Business Plan Guide opt-in
--   /insurance-guide (confirms in place)              Insurance vs Superbills opt-in
--   /kickstartguide -> /step-by-step-guide-thank-you-page   Kickstart Guide opt-in
--   /doc-registration                                 Do's & Don'ts workshop sales page
--   /dos-and-donts-ty, /dos-donts-ty                  its CE / no-CE thank-you pages
--   /replay-documentation                             the workshop replay
--   /on-demand-audit-your-private-practice            Audit Proof Your Practice on demand
--   /profile-audit-ty                                 Directory Makeover Audit thank-you
--   /opt-in                                           (Kajabi template) the free-guide index
--
-- What this file does, in order:
--   1. One tag per free guide, so everyone who asks for one can be found
--      (Contacts -> filter by tag), as Kajabi tagged them.
--   2. One form per opt-in (slug = the page path). The pages draw their own
--      boxes and post exactly these keys. Opt-ins create a contact, not a lead
--      (create_lead false — the freedom-masterclass precedent, 077): no owner
--      email per download.
--   3. One automation per form: form submitted -> email the guide. Plain
--      automations, so the wording can be changed in Admin -> Automations
--      (the 095 pattern). Links are absolute to the callsphere.site address:
--      update at domain cutover.
--   4. The fourteen redirect rows are deleted (nginx/redirects.map must lose
--      the same lines, or nginx keeps 301-ing them before the app sees them).
--   5. The Resources CMS cards that still pointed nowhere ('#') point at the
--      new pages.
--   6. The workshop and directory-audit offers send buyers to their Kajabi
--      thank-you pages, as Kajabi did (only where no thank-you address is set).
--
-- Free-guide files: the 5-Step Marketing Plan is shipped in
-- frontend/public/downloads/5-step-marketing-plan.pdf. The other three are
-- referenced at /downloads/private-practice-business-plan-guide.pdf,
-- /downloads/insurance-vs-superbills-guide.pdf and
-- /downloads/private-practice-kickstart-guide.pdf and must be copied there from
-- the Kajabi media library (they were not in the Kajabi product import).
--
-- Idempotent: tags/forms insert ON CONFLICT DO NOTHING (an admin edit is never
-- overwritten), automations are created only if their name is not there yet,
-- deletes match exact paths, updates are guarded on the placeholder value.

-- ── 1. Tags ─────────────────────────────────────────────────────────────────

INSERT INTO tags (name, slug, description) VALUES
  ('Freebie: 5-Step Marketing Plan', 'freebie-5-step-marketing-plan',
   'Asked for the free 5-Step Marketing Plan at /5-step-marketing (/marketing-step-form).'),
  ('Freebie: Business Plan Guide', 'freebie-business-plan-guide',
   'Asked for the free Private Practice Business Plan guide at /business-plan-guide.'),
  ('Freebie: Insurance vs Superbills Guide', 'freebie-insurance-vs-superbills-guide',
   'Asked for the free Insurance vs Superbills guide at /insurance-guide.'),
  ('Freebie: Private Practice Kickstart Guide', 'freebie-private-practice-kickstart-guide',
   'Asked for the free Private Practice Kickstart guide at /kickstartguide.')
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Forms ────────────────────────────────────────────────────────────────
-- `name` holds the first name (mapped to the contact's first-name column, as
-- 077's is); the tag is looked up by slug because ids differ between databases.

INSERT INTO forms (slug, name, description, fields, submit_label, success_message,
                   create_lead, published, post_action, redirect_url, spam_protection, apply_tag_ids)
VALUES
  ('marketing-step-form',
   '5-Step Marketing Plan — opt-in',
   'The free 5-Step Marketing Plan, from /marketing-step-form (the /5-step-marketing page sends people there; was Kajabi form 2149653872). The page confirms in place and links the PDF; the "5-Step Marketing Plan email" automation emails it.',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"last_name","type":"text","label":"Last Name","required":true,"contactField":"lastName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"},
     {"key":"years_in_practice","type":"select","label":"How Long Have You Been In Practice","required":true,
      "options":["0-1 year","2-3 years","4-5+ years"],"contactField":"years_in_practice"}
   ]$f$::jsonb,
   'READY TO MARKET MY PRACTICE',
   'Your 5-Step Marketing Plan is on its way.',
   false, true, 'message', '', 'honeypot',
   COALESCE((SELECT ARRAY[id] FROM tags WHERE slug = 'freebie-5-step-marketing-plan'), '{}')),

  ('business-plan-guide',
   'Private Practice Business Plan Guide — opt-in',
   'The free Private Practice Business Plan guide, from /business-plan-guide (was Kajabi form 2149360998). The page then goes to /business-plan-ty; the "Business Plan Guide email" automation emails the guide.',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"}
   ]$f$::jsonb,
   'YES, LET''S DO THIS!',
   'Your Private Practice Business Plan Guide Is All Yours!',
   false, true, 'redirect', '/business-plan-ty', 'honeypot',
   COALESCE((SELECT ARRAY[id] FROM tags WHERE slug = 'freebie-business-plan-guide'), '{}')),

  ('insurance-guide',
   'Insurance vs Superbills Guide — opt-in',
   'The free Insurance vs Superbills guide, from /insurance-guide (was Kajabi form 2148625686). The page confirms in place and links the guide; the "Insurance vs Superbills Guide email" automation emails it.',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"}
   ]$f$::jsonb,
   'DOWNLOAD NOW',
   'Your Insurance vs Superbills guide is on its way.',
   false, true, 'message', '', 'honeypot',
   COALESCE((SELECT ARRAY[id] FROM tags WHERE slug = 'freebie-insurance-vs-superbills-guide'), '{}')),

  ('kickstartguide',
   'Private Practice Kickstart Guide — opt-in',
   'The free Private Practice Kickstart guide, from /kickstartguide (was Kajabi form 2148993967). The page then goes to /step-by-step-guide-thank-you-page; the "Kickstart Guide email" automation emails the guide.',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"}
   ]$f$::jsonb,
   'YES, LET''S DO THIS!',
   'Your Private Practice Kickstart Guide Is All Yours!',
   false, true, 'redirect', '/step-by-step-guide-thank-you-page', 'honeypot',
   COALESCE((SELECT ARRAY[id] FROM tags WHERE slug = 'freebie-private-practice-kickstart-guide'), '{}'))
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Delivery emails ──────────────────────────────────────────────────────
-- form submitted -> send the guide. Sent as marketing (the 095 choice), so an
-- address that opted out is skipped by the sending gate — the page itself
-- links the same file, so nobody is left without it.

WITH form AS (SELECT id FROM forms WHERE slug = 'marketing-step-form'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $lm$5-Step Marketing Plan email$lm$,
         $lm$Emails the free 5-Step Marketing Plan PDF when the marketing-step-form form is submitted at /marketing-step-form.$lm$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $lm$5-Step Marketing Plan email$lm$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $lm${"subject":"{{firstName}}, here's your 5-Step Marketing Plan","bodyMd":"Hi {{firstName}},\n\nThank you for requesting the 5-Step Marketing Plan for Therapists in Private Practice. Your free fillable PDF is ready:\n\n[Download your 5-Step Marketing Plan →](https://bossclinician.callsphere.site/downloads/5-step-marketing-plan.pdf)\n\nWork through it once, fill it out honestly, and you'll have a focused marketing plan you can actually follow. Five steps. One clear direction. No more guessing.\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$lm$::jsonb, 0
  FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'business-plan-guide'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $lm$Business Plan Guide email$lm$,
         $lm$Emails the free Private Practice Business Plan guide when the business-plan-guide form is submitted at /business-plan-guide.$lm$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $lm$Business Plan Guide email$lm$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $lm${"subject":"{{firstName}}, your Private Practice Business Plan Guide is here","bodyMd":"Hi {{firstName}},\n\nYour Private Practice Business Plan Guide is all yours!\n\nYou're officially out of \"dreaming mode\" and stepping into \"design-and-build mode.\" This guide helps you start planning like a CEO, so your practice becomes intentional, profitable, and sustainable.\n\n[Download your Business Plan Guide →](https://bossclinician.callsphere.site/downloads/private-practice-business-plan-guide.pdf)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$lm$::jsonb, 0
  FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'insurance-guide'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $lm$Insurance vs Superbills Guide email$lm$,
         $lm$Emails the free Insurance vs Superbills guide when the insurance-guide form is submitted at /insurance-guide.$lm$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $lm$Insurance vs Superbills Guide email$lm$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $lm${"subject":"{{firstName}}, your Insurance vs Superbills guide","bodyMd":"Hi {{firstName}},\n\nHere is your free Insurance vs Superbills guide. Learn the benefits, challenges, and requirements for each approach to streamline your private practice.\n\n[Download your Insurance vs Superbills guide →](https://bossclinician.callsphere.site/downloads/insurance-vs-superbills-guide.pdf)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$lm$::jsonb, 0
  FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'kickstartguide'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $lm$Kickstart Guide email$lm$,
         $lm$Emails the free Private Practice Kickstart guide when the kickstartguide form is submitted at /kickstartguide.$lm$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $lm$Kickstart Guide email$lm$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $lm${"subject":"{{firstName}}, your Private Practice Kickstart Guide is here","bodyMd":"Hi {{firstName}},\n\nYour Private Practice Kickstart Guide is all yours! 3 Steps to Go From 9-5 to Your Own Profitable Private Practice, without the overwhelm.\n\n[Download your Kickstart Guide →](https://bossclinician.callsphere.site/downloads/private-practice-kickstart-guide.pdf)\n\nYour days of collecting the same ol' paycheck and 1 to 3% annual raises are soon to be a thing of the past.\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$lm$::jsonb, 0
  FROM new_automation;

-- ── 4. Redirects: paths that are now pages ──────────────────────────────────
-- Any row for these addresses, not only the ones 004 wrote: nginx answers from
-- the redirect map before the app, so a hand-made row would 301 the visitor
-- away from a page that now exists (077/100's reasoning).

DELETE FROM redirects
 WHERE lower(from_path) IN (
   '/5-step-marketing',
   '/marketing-step-form',
   '/business-plan-guide',
   '/business-plan-ty',
   '/insurance-guide',
   '/kickstartguide',
   '/doc-registration',
   '/dos-and-donts-ty',
   '/dos-donts-ty',
   '/on-demand-audit-your-private-practice',
   '/opt-in',
   '/replay-documentation',
   '/step-by-step-guide-thank-you-page',
   '/profile-audit-ty'
 );

-- ── 5. Resources cards ──────────────────────────────────────────────────────
-- The seeded free-guide cards on /resources link nowhere ('#'). Scoped to that
-- placeholder, so a link set by hand is kept.

UPDATE resources SET cta_url = '/insurance-guide', updated_at = now()
 WHERE cta_url = '#' AND title ILIKE '%insurance%superbill%';

UPDATE resources SET cta_url = '/kickstartguide', updated_at = now()
 WHERE cta_url = '#' AND title ILIKE 'Free Starter Guide%';

-- The planner card's page is /practice-planner (migration 100).
UPDATE resources SET cta_url = '/practice-planner', updated_at = now()
 WHERE cta_url = '#' AND title ILIKE '%profitable practice planner%';

-- ── 6. Offer thank-you pages ────────────────────────────────────────────────
-- Checkout honours offers.redirect_url (pages/Checkout.tsx `finish`). Kajabi
-- sent workshop buyers to these pages; set only where nothing is set yet.

UPDATE offers SET redirect_url = '/dos-and-donts-ty', updated_at = now()
 WHERE slug = 'dos-and-donts-of-documentation-ce' AND redirect_url = '';

UPDATE offers SET redirect_url = '/dos-donts-ty', updated_at = now()
 WHERE slug = 'dos-and-donts-of-documentation-edu' AND redirect_url = '';

UPDATE offers SET redirect_url = '/profile-audit-ty', updated_at = now()
 WHERE slug IN ('directory-makeover-audit', 'therapist-directory-audit') AND redirect_url = '';
