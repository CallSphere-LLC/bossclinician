-- 100 — The one-off bossclinician.com (Kajabi) pages, rebuilt at their own paths.
--
-- Owner's rule: every Kajabi page exists here as our own page, and nothing
-- redirects or links to bossclinician.com. Migration 004 sent these paths to
-- generic pages (/terms, /resources, /checkout/success, /work-with-me ...); the
-- pages now exist (frontend/src/pages/kajabi/pages/routes.tsx), so their
-- redirect rows go. nginx/redirects.map is regenerated from this table at
-- deploy, so the map loses them too.
--
-- Also creates the forms those pages post to (same keys as the page code):
--   reset-audit              /reset-audit-form  -> /practice-reset-audit-ty
--   reset-planner            /reset-planner-form (confirms in place)
--   practice-planner         /practice-planner  -> /practice-planner-thank-you
--   private-practice-for-you /private-practice-for-you quiz -> /private-practice-for-you-ty
--   masterclass-review       /masterclass-review-sheet (Kajabi assessment 2148148279)
-- Opt-ins create a contact, not a lead (the freedom-masterclass precedent):
-- create_lead = false, so no owner email per download.
--
-- Idempotent: forms insert ON CONFLICT DO NOTHING (an admin edit is never
-- overwritten), deletes match exact paths, inserts of redirect rows skip
-- existing ones.

-- ── Forms ───────────────────────────────────────────────────────────────────

INSERT INTO forms (slug, name, description, fields, submit_label, success_message,
                   create_lead, published, post_action, redirect_url)
VALUES
  ('reset-audit',
   'Practice Reset Audit — opt-in',
   'The free Practice Reset Audit workbook, from /reset-audit-form (was Kajabi form 2149653873).',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"last_name","type":"text","label":"Last Name","required":true,"contactField":"lastName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"},
     {"key":"years_in_practice","type":"select","label":"How Long Have You Been In Practice","required":true,
      "options":["0-1 year","2-3 years","4-5+ years"],"contactField":"years_in_practice"}
   ]$f$::jsonb,
   'AUDIT MY PRACTICE NOW',
   'Your Practice Reset Audit is on its way.',
   false, true, 'redirect', '/practice-reset-audit-ty'),

  ('reset-planner',
   'Practice Reset Planner — opt-in',
   'The free Practice Reset Planner, from /reset-planner-form (was Kajabi form 2149654850).',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"last_name","type":"text","label":"Last Name","required":true,"contactField":"lastName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"},
     {"key":"years_in_practice","type":"select","label":"How Long Have You Been In Practice","required":true,
      "options":["0-1 year","2-3 years","4-5+ years"],"contactField":"years_in_practice"}
   ]$f$::jsonb,
   'RESET MY PRACTICE!',
   'You''re in. Watch your inbox — The Practice Reset Planner is on its way.',
   false, true, 'message', ''),

  ('practice-planner',
   'Profitable Practice Planner — opt-in',
   'The free Profitable Practice Planner guide, from /practice-planner (was Kajabi form 2148625687).',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"}
   ]$f$::jsonb,
   'GRAB MY PLANNER NOW!',
   'Your Profitable Practice Planner Is All Yours!',
   false, true, 'redirect', '/practice-planner-thank-you'),

  ('private-practice-for-you',
   'Private Practice For You — Readiness Quiz',
   'The 6-question readiness quiz at /private-practice-for-you (was Kajabi forms 2148574641 / 2148591629 / 2148591633). `result` and q1–q6 are filled in by the quiz.',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"last_name","type":"text","label":"Last Name","required":true,"contactField":"lastName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"},
     {"key":"result","type":"hidden","label":"Quiz result","required":false},
     {"key":"q1","type":"hidden","label":"Current work situation","required":false},
     {"key":"q2","type":"hidden","label":"If you left your agency/platform income today","required":false},
     {"key":"q3","type":"hidden","label":"Business foundation in place","required":false},
     {"key":"q4","type":"hidden","label":"Where clients would come from","required":false},
     {"key":"q5","type":"hidden","label":"What is keeping you where you are","required":false},
     {"key":"q6","type":"hidden","label":"One year from now","required":false}
   ]$f$::jsonb,
   'Send Me My Result',
   'Your result is on its way.',
   false, true, 'redirect', '/private-practice-for-you-ty'),

  ('masterclass-review',
   'Masterclass Review Sheet',
   'Feedback after the Freedom Masterclass, from /masterclass-review-sheet (was Kajabi assessment 2148148279).',
   $f$[
     {"key":"credentials","type":"textarea","required":true,
      "label":"First Name, Last Name (or Last Name Initial) and Credentials (LCSW. LMFT, LPC, PMHNP, etc.) Private practice/business name (optional)"},
     {"key":"hardest_before","type":"textarea","required":true,
      "label":"Before watching the masterclass, what felt hardest about the way your practice was currently running?"},
     {"key":"aha_moment","type":"textarea","required":true,
      "label":"What was your biggest “aha” moment from the masterclass?"},
     {"key":"sustainability_confidence","type":"radio","required":true,
      "label":"After today’s training, how do you feel about your ability to make your current practice more sustainable?",
      "options":["Much more confident","Somewhat more confident","I have more clarity, but still need support",
                 "I know something needs to change, but I’m not sure where to start",
                 "I still feel overwhelmed by what needs to change"]},
     {"key":"ready_to_change","type":"textarea","required":true,
      "label":"What is one thing you’re now ready to change, reduce, simplify, or look at differently in your practice?"},
     {"key":"advice_to_therapist","type":"textarea","required":true,
      "label":"What would you say to another therapist who is fully booked or successful on paper, but knows they don’t want to keep working this way forever?"},
     {"key":"testimonial_permission","type":"radio","required":true,
      "label":"May we use your comments as a testimonial?",
      "options":["Yes, you may use my first name, credentials, and feedback.","Yes, but please use my first name only.",
                 "Yes, but please keep my feedback anonymous.","No, please keep my feedback private."]},
     {"key":"name","type":"text","label":"Full Name","required":true},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"}
   ]$f$::jsonb,
   'Submit',
   'Thank you for sharing your experience with me. I read these. And I genuinely appreciate you taking the time to reflect on what this brought up for you and your practice.',
   false, true, 'message', '')
ON CONFLICT (slug) DO NOTHING;

-- ── Redirects: paths that are now pages ─────────────────────────────────────
-- Stored lowercase (services/redirects.ts normalizePath), so Kajabi's
-- /credential-with-confidencekit-Confirmed is the lowercase row below.

DELETE FROM redirects
 WHERE from_path IN (
   '/reset-audit',
   '/reset-audit-form',
   '/practice-reset-audit-ty',
   '/reset-planner-form',
   '/practice-reset-snapshot',
   '/practice-planner',
   '/practice-planner-thank-you',
   '/terms-of-use',
   '/coaching-terms',
   '/ceu-terms-boss-clinician',
   '/retreatagreement',
   '/continuing-education-boss-clinician',
   '/profitable-private-practice-leap-accelerator',
   '/leap-accelerator-thank-you',
   '/private-practice-for-you',
   '/private-practice-for-you-ty',
   '/next-steps-consult',
   '/link-in-bio',
   '/masterclass-review-sheet',
   '/credential-with-confidencekit-confirmed',
   '/protectionpackthanks',
   '/starterconfirmed',
   '/thank-you',
   '/thank-you-audit-proof',
   '/thank-you-fullybooked',
   '/thank-you-rate-renegotiate',
   '/the-club-ty'
 );

-- Self-redirects (/practice-reset-planner -> /practice-reset-planner,
-- /privacy-policy -> /privacy-policy, ...). The runtime lookup ignores them, but
-- the generated nginx map answers each with a 301 to itself — a loop.
DELETE FROM redirects WHERE lower(from_path) = lower(to_path);

-- /privacy-policy-8b664a08-e1e5-4f19-8d9a-5cb8f33bf104 keeps its row: on Kajabi
-- it is an empty page with only a "Privacy Policy" heading, so /privacy-policy
-- is the right answer for it.

-- ── Redirects: Kajabi's per-result readiness opt-ins ────────────────────────
-- The /private-practice-for-you quiz sent each result to its own Kajabi opt-in
-- page. Ours asks for the email on the quiz's last screen, so those three
-- addresses lead back to the quiz.
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note)
VALUES
  ('/notyet-form', '/private-practice-for-you', 301, true, 'Kajabi readiness-quiz opt-in (not yet); the quiz now captures the email itself'),
  ('/almost-form', '/private-practice-for-you', 301, true, 'Kajabi readiness-quiz opt-in (almost ready); the quiz now captures the email itself'),
  ('/ready-form',  '/private-practice-for-you', 301, true, 'Kajabi readiness-quiz opt-in (ready); the quiz now captures the email itself')
ON CONFLICT (from_path) DO NOTHING;
