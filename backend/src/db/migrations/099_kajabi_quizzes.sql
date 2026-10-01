-- =============================================================================
-- 099 — The Kajabi quizzes run on this site (QA sheet, 2026-10-01)
--
-- Owner's rule: nothing redirects or links to bossclinician.com, and every
-- Kajabi page exists here as our own. These quiz pages used to 301 to
-- /practice-quiz or /retreats; they are now real pages at the same addresses
-- (frontend/src/pages/kajabi/quizzes, copy in frontend/src/content/
-- offerQuiz.ts, hiringQuiz.ts, retreatQuiz.ts, bossAssessment.ts):
--
--   /offer-quiz              Which Boss Clinician Offer Is Right for You? (6 q, 3 results)
--   /hiring-quiz, /hire-form Are You Ready to Hire Your First Clinician? (7 q, 3 results)
--   /retreat-needed-quiz     Burnout Self-Assessment (6 q, 3 results)
--   /retreat-thank-you-page  retreat reservation thank-you
--   /boss-assessment         Group Practice Self-Assessment sign-up
--   /visionary-form, /careful-form, /steady-form, /reluctant-form,
--   /practice-set-up-quiz-ty the Practice Set Up Quiz's result forms (091) and
--                            thank-you page, at their Kajabi addresses
--
-- This migration, in order:
--   1. tags   — one per new form, slug = the form's slug (ids differ per
--               database, so everything below looks them up by slug);
--   2. forms  — one per quiz result (the result and the answers ride along as
--               hidden questions, as in 091), plus /hire-form and
--               /boss-assessment with their Kajabi drop-downs, which are saved
--               on the contact as custom fields;
--   3. automations — form submitted -> send the taker their result, generated
--               from the content files (the same words as the result screen),
--               like 095. Marketing topic, so opted-out / suppressed addresses
--               are skipped. Links are absolute to the callsphere.site address:
--               update at domain cutover. /hire-form has none (the result email
--               comes from the result form /hiring-quiz files). The
--               /boss-assessment email is created PAUSED: the PDF it delivers is
--               not on this site yet (see its description);
--   4. the Practice Set Up Quiz's Careful Clinician email (095) points its
--      "Find Your Right Offer" button at /offer-quiz, its Kajabi target, now
--      that the offer quiz exists here;
--   5. the redirect rows for these eleven paths are deleted.
--
-- create_lead is off, as in 091: a lead would email the owner for every quiz
-- taker. Idempotent: tags and forms ON CONFLICT DO NOTHING, automations only
-- if their name is not already there.
-- =============================================================================

-- 1. Tags

INSERT INTO tags (name, slug, description)
VALUES
  ($qz$Offer Quiz — Boss Clinician Club$qz$, 'offer-quiz-club', $qz$Given by the offer-quiz-club form (migration 099).$qz$),
  ($qz$Offer Quiz — Boss Clinician Lounge$qz$, 'offer-quiz-lounge', $qz$Given by the offer-quiz-lounge form (migration 099).$qz$),
  ($qz$Offer Quiz — Boss Clinician Boardroom$qz$, 'offer-quiz-boardroom', $qz$Given by the offer-quiz-boardroom form (migration 099).$qz$),
  ($qz$Hiring Quiz — Ready$qz$, 'hiring-quiz-ready', $qz$Given by the hiring-quiz-ready form (migration 099).$qz$),
  ($qz$Hiring Quiz — Almost Ready$qz$, 'hiring-quiz-almost', $qz$Given by the hiring-quiz-almost form (migration 099).$qz$),
  ($qz$Hiring Quiz — Not Yet$qz$, 'hiring-quiz-not-yet', $qz$Given by the hiring-quiz-not-yet form (migration 099).$qz$),
  ($qz$Burnout Assessment — The Depleted Pourer$qz$, 'retreat-quiz-depleted', $qz$Given by the retreat-quiz-depleted form (migration 099).$qz$),
  ($qz$Burnout Assessment — The Functional Giver$qz$, 'retreat-quiz-functional', $qz$Given by the retreat-quiz-functional form (migration 099).$qz$),
  ($qz$Burnout Assessment — The Replenished Woman$qz$, 'retreat-quiz-replenished', $qz$Given by the retreat-quiz-replenished form (migration 099).$qz$),
  ($qz$Hiring Quiz — Signed Up$qz$, 'hire-form', $qz$Given by the hire-form form (migration 099).$qz$),
  ($qz$Group Practice Self-Assessment$qz$, 'boss-assessment', $qz$Given by the boss-assessment form (migration 099).$qz$)
ON CONFLICT (slug) DO NOTHING;

-- 2. Forms

INSERT INTO forms (
  slug, name, description, fields, submit_label, success_message,
  create_lead, published, post_action, spam_protection, apply_tag_ids
)
SELECT
  v.slug, v.name, v.description, v.fields::jsonb, v.submit_label, v.success_message,
  false, true, 'message', 'honeypot',
  COALESCE((SELECT ARRAY[t.id] FROM tags t WHERE t.slug = v.slug), '{}')
FROM (VALUES
  ('offer-quiz-club', $qz$Offer Quiz — Boss Clinician Club$qz$,
   $qz$Offer quiz result form for Boss Clinician Club. Filled in by the optional "email my result" form under the result at /offer-quiz; the page draws its own fields, so edits to the questions here do not change the quiz.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Offer match","type":"hidden","required":false},{"key":"scores","label":"Score by offer","type":"hidden","required":false},{"key":"q1","label":"Q1 · How would you describe where you are in your private practice right now?","type":"hidden","required":false},{"key":"q2","label":"Q2 · What is your biggest challenge in your practice right now?","type":"hidden","required":false},{"key":"q3","label":"Q3 · How long have you been in private practice?","type":"hidden","required":false},{"key":"q4","label":"Q4 · Which of these sounds most like you right now?","type":"hidden","required":false},{"key":"q5","label":"Q5 · What does your income situation look like right now?","type":"hidden","required":false},{"key":"q6","label":"Q6 · What kind of support would move the needle most for you right now?","type":"hidden","required":false}]$qz$,
   $qz$EMAIL MY RESULT$qz$, $qz$Your result is on its way.$qz$),
  ('offer-quiz-lounge', $qz$Offer Quiz — Boss Clinician Lounge$qz$,
   $qz$Offer quiz result form for Boss Clinician Lounge. Filled in by the optional "email my result" form under the result at /offer-quiz; the page draws its own fields, so edits to the questions here do not change the quiz.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Offer match","type":"hidden","required":false},{"key":"scores","label":"Score by offer","type":"hidden","required":false},{"key":"q1","label":"Q1 · How would you describe where you are in your private practice right now?","type":"hidden","required":false},{"key":"q2","label":"Q2 · What is your biggest challenge in your practice right now?","type":"hidden","required":false},{"key":"q3","label":"Q3 · How long have you been in private practice?","type":"hidden","required":false},{"key":"q4","label":"Q4 · Which of these sounds most like you right now?","type":"hidden","required":false},{"key":"q5","label":"Q5 · What does your income situation look like right now?","type":"hidden","required":false},{"key":"q6","label":"Q6 · What kind of support would move the needle most for you right now?","type":"hidden","required":false}]$qz$,
   $qz$EMAIL MY RESULT$qz$, $qz$Your result is on its way.$qz$),
  ('offer-quiz-boardroom', $qz$Offer Quiz — Boss Clinician Boardroom$qz$,
   $qz$Offer quiz result form for Boss Clinician Boardroom. Filled in by the optional "email my result" form under the result at /offer-quiz; the page draws its own fields, so edits to the questions here do not change the quiz.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Offer match","type":"hidden","required":false},{"key":"scores","label":"Score by offer","type":"hidden","required":false},{"key":"q1","label":"Q1 · How would you describe where you are in your private practice right now?","type":"hidden","required":false},{"key":"q2","label":"Q2 · What is your biggest challenge in your practice right now?","type":"hidden","required":false},{"key":"q3","label":"Q3 · How long have you been in private practice?","type":"hidden","required":false},{"key":"q4","label":"Q4 · Which of these sounds most like you right now?","type":"hidden","required":false},{"key":"q5","label":"Q5 · What does your income situation look like right now?","type":"hidden","required":false},{"key":"q6","label":"Q6 · What kind of support would move the needle most for you right now?","type":"hidden","required":false}]$qz$,
   $qz$EMAIL MY RESULT$qz$, $qz$Your result is on its way.$qz$),
  ('hiring-quiz-ready', $qz$Hiring Quiz — Ready$qz$,
   $qz$Hiring quiz result form for "You're Ready — Let's Build This Right.". Filled in by /hiring-quiz: automatically for a visitor who came through /hire-form, otherwise by the optional "email my result" form under the result. The page draws its own fields, so edits to the questions here do not change the quiz.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Hiring readiness","type":"hidden","required":false},{"key":"score","label":"Score","type":"hidden","required":false},{"key":"q1","label":"Q1 · Your practice is consistently full — you're regularly turning away clients or have a waitlist.","type":"hidden","required":false},{"key":"q2","label":"Q2 · You have a clear understanding of your monthly revenue and expenses, including what you'd need to cover a n…","type":"hidden","required":false},{"key":"q3","label":"Q3 · Your practice has documented systems for client intake, scheduling, billing, and clinical onboarding that a…","type":"hidden","required":false},{"key":"q4","label":"Q4 · You have a consistent referral source or marketing system that generates more demand than you alone can han…","type":"hidden","required":false},{"key":"q5","label":"Q5 · You have a clear vision of what type of clinician you want to hire, what specialty or population they would…","type":"hidden","required":false},{"key":"q6","label":"Q6 · You understand the legal and financial requirements of hiring in your state — including whether you want a…","type":"hidden","required":false},{"key":"q7","label":"Q7 · You are prepared for the reality that a new hire will likely not be profitable in the first 60–90 days, and…","type":"hidden","required":false}]$qz$,
   $qz$EMAIL MY RESULT$qz$, $qz$Your result is on its way.$qz$),
  ('hiring-quiz-almost', $qz$Hiring Quiz — Almost Ready$qz$,
   $qz$Hiring quiz result form for "Almost Ready — A Few Gaps to Close First.". Filled in by /hiring-quiz: automatically for a visitor who came through /hire-form, otherwise by the optional "email my result" form under the result. The page draws its own fields, so edits to the questions here do not change the quiz.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Hiring readiness","type":"hidden","required":false},{"key":"score","label":"Score","type":"hidden","required":false},{"key":"q1","label":"Q1 · Your practice is consistently full — you're regularly turning away clients or have a waitlist.","type":"hidden","required":false},{"key":"q2","label":"Q2 · You have a clear understanding of your monthly revenue and expenses, including what you'd need to cover a n…","type":"hidden","required":false},{"key":"q3","label":"Q3 · Your practice has documented systems for client intake, scheduling, billing, and clinical onboarding that a…","type":"hidden","required":false},{"key":"q4","label":"Q4 · You have a consistent referral source or marketing system that generates more demand than you alone can han…","type":"hidden","required":false},{"key":"q5","label":"Q5 · You have a clear vision of what type of clinician you want to hire, what specialty or population they would…","type":"hidden","required":false},{"key":"q6","label":"Q6 · You understand the legal and financial requirements of hiring in your state — including whether you want a…","type":"hidden","required":false},{"key":"q7","label":"Q7 · You are prepared for the reality that a new hire will likely not be profitable in the first 60–90 days, and…","type":"hidden","required":false}]$qz$,
   $qz$EMAIL MY RESULT$qz$, $qz$Your result is on its way.$qz$),
  ('hiring-quiz-not-yet', $qz$Hiring Quiz — Not Yet$qz$,
   $qz$Hiring quiz result form for "Not Yet — But That's Honest, and That's Good.". Filled in by /hiring-quiz: automatically for a visitor who came through /hire-form, otherwise by the optional "email my result" form under the result. The page draws its own fields, so edits to the questions here do not change the quiz.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Hiring readiness","type":"hidden","required":false},{"key":"score","label":"Score","type":"hidden","required":false},{"key":"q1","label":"Q1 · Your practice is consistently full — you're regularly turning away clients or have a waitlist.","type":"hidden","required":false},{"key":"q2","label":"Q2 · You have a clear understanding of your monthly revenue and expenses, including what you'd need to cover a n…","type":"hidden","required":false},{"key":"q3","label":"Q3 · Your practice has documented systems for client intake, scheduling, billing, and clinical onboarding that a…","type":"hidden","required":false},{"key":"q4","label":"Q4 · You have a consistent referral source or marketing system that generates more demand than you alone can han…","type":"hidden","required":false},{"key":"q5","label":"Q5 · You have a clear vision of what type of clinician you want to hire, what specialty or population they would…","type":"hidden","required":false},{"key":"q6","label":"Q6 · You understand the legal and financial requirements of hiring in your state — including whether you want a…","type":"hidden","required":false},{"key":"q7","label":"Q7 · You are prepared for the reality that a new hire will likely not be profitable in the first 60–90 days, and…","type":"hidden","required":false}]$qz$,
   $qz$EMAIL MY RESULT$qz$, $qz$Your result is on its way.$qz$),
  ('retreat-quiz-depleted', $qz$Burnout Assessment — The Depleted Pourer$qz$,
   $qz$Burnout Self-Assessment result form for The Depleted Pourer. Filled in by the optional "keep your results" form under the result at /retreat-needed-quiz; the page draws its own fields, so edits to the questions here do not change the assessment.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Assessment result","type":"hidden","required":false},{"key":"score","label":"Score","type":"hidden","required":false},{"key":"q1","label":"Q1 · It is 9 PM. Clients are seen, family is handled, tasks are done. What happens next?","type":"hidden","required":false},{"key":"q2","label":"Q2 · When was the last time someone else planned, prepared, and handled everything so you could just receive?","type":"hidden","required":false},{"key":"q3","label":"Q3 · Finish this sentence honestly. \"I will finally rest after...\"","type":"hidden","required":false},{"key":"q4","label":"Q4 · Your closest friendships and connections right now feel...","type":"hidden","required":false},{"key":"q5","label":"Q5 · When you imagine spending real money on your own restoration, the first voice in your head says...","type":"hidden","required":false},{"key":"q6","label":"Q6 · Be honest. How are you actually doing?","type":"hidden","required":false}]$qz$,
   $qz$Email My Results$qz$, $qz$Your results are on their way.$qz$),
  ('retreat-quiz-functional', $qz$Burnout Assessment — The Functional Giver$qz$,
   $qz$Burnout Self-Assessment result form for The Functional Giver. Filled in by the optional "keep your results" form under the result at /retreat-needed-quiz; the page draws its own fields, so edits to the questions here do not change the assessment.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Assessment result","type":"hidden","required":false},{"key":"score","label":"Score","type":"hidden","required":false},{"key":"q1","label":"Q1 · It is 9 PM. Clients are seen, family is handled, tasks are done. What happens next?","type":"hidden","required":false},{"key":"q2","label":"Q2 · When was the last time someone else planned, prepared, and handled everything so you could just receive?","type":"hidden","required":false},{"key":"q3","label":"Q3 · Finish this sentence honestly. \"I will finally rest after...\"","type":"hidden","required":false},{"key":"q4","label":"Q4 · Your closest friendships and connections right now feel...","type":"hidden","required":false},{"key":"q5","label":"Q5 · When you imagine spending real money on your own restoration, the first voice in your head says...","type":"hidden","required":false},{"key":"q6","label":"Q6 · Be honest. How are you actually doing?","type":"hidden","required":false}]$qz$,
   $qz$Email My Results$qz$, $qz$Your results are on their way.$qz$),
  ('retreat-quiz-replenished', $qz$Burnout Assessment — The Replenished Woman$qz$,
   $qz$Burnout Self-Assessment result form for The Replenished Woman. Filled in by the optional "keep your results" form under the result at /retreat-needed-quiz; the page draws its own fields, so edits to the questions here do not change the assessment.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"result","label":"Assessment result","type":"hidden","required":false},{"key":"score","label":"Score","type":"hidden","required":false},{"key":"q1","label":"Q1 · It is 9 PM. Clients are seen, family is handled, tasks are done. What happens next?","type":"hidden","required":false},{"key":"q2","label":"Q2 · When was the last time someone else planned, prepared, and handled everything so you could just receive?","type":"hidden","required":false},{"key":"q3","label":"Q3 · Finish this sentence honestly. \"I will finally rest after...\"","type":"hidden","required":false},{"key":"q4","label":"Q4 · Your closest friendships and connections right now feel...","type":"hidden","required":false},{"key":"q5","label":"Q5 · When you imagine spending real money on your own restoration, the first voice in your head says...","type":"hidden","required":false},{"key":"q6","label":"Q6 · Be honest. How are you actually doing?","type":"hidden","required":false}]$qz$,
   $qz$Email My Results$qz$, $qz$Your results are on their way.$qz$),
  ('hire-form', $qz$Hiring Quiz — Sign-up (/hire-form)$qz$,
   $qz$The sign-up in front of the hiring quiz, at /hire-form (Kajabi's form of the same name). Sends the visitor on to /hiring-quiz, which files their result under the matching Hiring Quiz result form. The page draws its own fields: keep the keys and options here in step with frontend/src/content/hiringQuiz.ts.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"years_in_practice","label":"How Long Have You Been In Practice","type":"select","required":true,"options":["0-1 year","2-3 years","4-5+ years"],"contactField":"years_in_practice"},{"key":"years_group_owner","label":"How Long Have You Been A Group Practice Owner","type":"select","required":true,"options":["I haven't hired just yet, but feel ready","1-2 years","3-4 years","5-10+ years"],"contactField":"years_group_owner"}]$qz$,
   $qz$I WANT TO KNOW IF I AM READY!$qz$, $qz$Thank you — on to the quiz.$qz$),
  ('boss-assessment', $qz$Group Practice Self-Assessment (/boss-assessment)$qz$,
   $qz$The Group Practice Self-Assessment sign-up at /boss-assessment (Kajabi's form of the same name). The PDF it promises is not on this site yet: upload it, put its link in the automation "Boss assessment — send the Group Practice Self-Assessment" and switch that automation on. The page draws its own fields: keep the keys and options here in step with frontend/src/content/bossAssessment.ts.$qz$,
   $qz$[{"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},{"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},{"key":"last_name","label":"Last Name","type":"text","required":true,"contactField":"lastName"},{"key":"years_group_owner","label":"How Long Have You Been A Group Practice Owner","type":"select","required":true,"options":["I haven't hired just yet, but feel ready","1-2 years","3-4 years","5-10+ years"],"contactField":"years_group_owner"},{"key":"team_size","label":"How Many Employees/Contractors Do You Have","type":"select","required":true,"options":["1-2","3-5","5-10","10+"],"contactField":"team_size"}]$qz$,
   $qz$I'M READY TO MAKE A CHANGE$qz$, $qz$Thank you. Your free fillable Group Practice Self-Assessment will be sent to the email address you entered — keep an eye on your inbox, and your spam folder just in case.$qz$)
) AS v(slug, name, description, fields, submit_label, success_message)
ON CONFLICT (slug) DO NOTHING;

-- 3. Result emails

WITH form AS (SELECT id FROM forms WHERE slug = 'offer-quiz-club'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Offer quiz result email — Boss Clinician Club$qz$, $qz$Emails the quiz taker their Boss Clinician Club match when the offer-quiz-club form is submitted from the result at /offer-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Offer quiz result email — Boss Clinician Club$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Boss Clinician offer match: Boss Clinician Club","bodyMd":"Hi {{firstName}},\n\nThank you for taking the \"Which Boss Clinician Offer Is Right for You?\" quiz. Here is your result.\n\n## Boss Clinician Club\n\n*Your foundation starts here.*\n\n**6-Month Coaching Program**\n\nBased on your answers, you're in the building season — and what you need most right now is structure, not hustle. The Boss Clinician Club is a 6-month coaching program designed specifically for clinicians who are starting or rebuilding their practice and want to get it right from the beginning.\n\nYou'll move through a guided curriculum with biweekly coaching calls, monthly tools and kits, and a community of clinicians navigating the same season. No more guessing. No more doing it alone.\n\n**What you get inside the Club**\n\n- A step-by-step 6-month curriculum built around the B.O.S.S Blueprint\n- Biweekly group coaching calls with Yvette\n- Monthly growth kits — templates, scripts, and done-for-you resources\n- Community access with clinicians at the same stage\n- Natural graduation path to the Boss Clinician Lounge\n\n[Join the Boss Clinician Club →](https://bossclinician.callsphere.site/club)\n\nNot sure yet? [Book a free Practice Alignment Call](https://tidycal.com/profitwithyvette/alignwithyvette) and we'll figure it out together.\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'offer-quiz-lounge'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Offer quiz result email — Boss Clinician Lounge$qz$, $qz$Emails the quiz taker their Boss Clinician Lounge match when the offer-quiz-lounge form is submitted from the result at /offer-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Offer quiz result email — Boss Clinician Lounge$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Boss Clinician offer match: Boss Clinician Lounge","bodyMd":"Hi {{firstName}},\n\nThank you for taking the \"Which Boss Clinician Offer Is Right for You?\" quiz. Here is your result.\n\n## Boss Clinician Lounge\n\n*Scale past the ceiling — without burning out.*\n\n**Monthly Membership**\n\nBased on your answers, you've already built something real — and now you need a strategy to work less, earn more, and stop feeling capped. The Boss Clinician Lounge is a monthly membership for established clinicians who are ready to scale their practice without sacrificing their life.\n\nYou'll get live monthly coaching, done-for-you resources, and a community of clinicians who are in the same season — fully booked, building toward something bigger, and done doing it alone.\n\n**What you get inside the Lounge**\n\n- Monthly live coaching calls with Yvette\n- Monthly strategy kits — pricing, marketing, systems, CEO mindset\n- Community access with clinicians at your level\n- VIP upgrade option for priority hot seat and personal reviews\n- Access to the full Boss Clinician resource library\n\n[Join the Boss Clinician Lounge →](https://bossclinician.callsphere.site/lounge)\n\nNot sure yet? [Book a free Practice Alignment Call](https://tidycal.com/profitwithyvette/alignwithyvette) and we'll figure it out together.\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'offer-quiz-boardroom'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Offer quiz result email — Boss Clinician Boardroom$qz$, $qz$Emails the quiz taker their Boss Clinician Boardroom match when the offer-quiz-boardroom form is submitted from the result at /offer-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Offer quiz result email — Boss Clinician Boardroom$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Boss Clinician offer match: Boss Clinician Boardroom","bodyMd":"Hi {{firstName}},\n\nThank you for taking the \"Which Boss Clinician Offer Is Right for You?\" quiz. Here is your result.\n\n## Boss Clinician Boardroom\n\n*Peer-level strategy for the group practice owner who's done doing it alone.*\n\n**Mastermind**\n\nBased on your answers, you've built something real — a team, a practice, a vision. What you need now isn't more content or another course. You need a room full of people building at the same level, with Yvette guiding the strategy.\n\nThe Boss Clinician Boardroom is an exclusive mastermind for group practice owners and scaling clinicians who are ready to bring their real numbers, real challenges, and real goals — and leave with a real plan.\n\n**What you get inside the Boardroom**\n\n- Small group mastermind — 8 to 12 members maximum\n- Monthly group strategy sessions with Yvette\n- Quarterly in-person meetups\n- Voxer access for async support between sessions\n- Peer accountability partnerships with group practice owners at your level\n- Guest expert sessions on team leadership, finance, and scaling\n\n[Apply for the Boss Clinician Boardroom →](https://bossclinician.callsphere.site/boardroom)\n\nNot sure yet? [Book a free Practice Alignment Call](https://tidycal.com/profitwithyvette/alignwithyvette) and we'll figure it out together.\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'hiring-quiz-ready'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Hiring quiz result email — Ready$qz$, $qz$Emails the quiz taker their "You're Ready — Let's Build This Right." result and next steps when the hiring-quiz-ready form is submitted by /hiring-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Hiring quiz result email — Ready$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, are you ready to hire? Your result: Ready","bodyMd":"Hi {{firstName}},\n\nThank you for taking the \"Are You Ready to Hire Your First Clinician?\" quiz. Here is your result and your action plan.\n\n## You're Ready — Let's Build This Right.\n\n*Your practice has the foundation to support a new hire.*\n\nBased on your answers, your practice has the core elements in place to make hiring a success — consistent demand, financial clarity, systems, and a real vision for growth. You're not hiring out of desperation. You're hiring from a position of strength. That's exactly the right foundation.\n\nThe work now is about doing this strategically — finding the right clinician, structuring compensation correctly, onboarding them well, and building a team culture that actually sticks. That's exactly what the Boss Clinician Boardroom helps you navigate.\n\n**Your Next Steps**\n\n1. Define your ideal hire — specialty, population, schedule, and compensation structure\n2. Confirm your W2 vs. 1099 decision with a legal or HR professional before posting\n3. Create an onboarding packet before you start interviewing\n4. Build a credentialing timeline so the new hire is billing as quickly as possible\n5. Join the Boss Clinician Boardroom for peer-level support through the hiring process\n\nThe Boss Clinician Boardroom is for group practice owners who are ready to grow — and want to do it right. Get peer-level strategy, CEO leadership development, and a room full of practice owners navigating exactly what you're navigating.\n\n[Apply for the Boss Clinician Boardroom →](https://bossclinician.callsphere.site/boardroom)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'hiring-quiz-almost'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Hiring quiz result email — Almost Ready$qz$, $qz$Emails the quiz taker their "Almost Ready — A Few Gaps to Close First." result and next steps when the hiring-quiz-almost form is submitted by /hiring-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Hiring quiz result email — Almost Ready$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, are you ready to hire? Your result: Almost Ready","bodyMd":"Hi {{firstName}},\n\nThank you for taking the \"Are You Ready to Hire Your First Clinician?\" quiz. Here is your result and your action plan.\n\n## Almost Ready — A Few Gaps to Close First.\n\n*Strong foundation with a few important areas to strengthen before hiring.*\n\nYour practice is on the right track, but your quiz results point to a few gaps that could make hiring harder than it needs to be — whether that's financial clarity, referral consistency, or systems that don't yet exist on paper. Hiring before these are solid can create more chaos than relief.\n\nThe good news: these gaps are completely fixable, and closing them before you hire protects both you and any clinician you bring on. Here's where to focus first.\n\n**Your Next Steps**\n\n1. Identify your lowest-scoring area and focus there for 30–60 days before hiring\n2. If your systems aren't documented — start there. Document your intake, billing, and scheduling process\n3. If your financials aren't clear — build a simple P&L and model what hiring would look like monthly\n4. If your referral pipeline isn't consistent — shore that up before adding overhead\n5. Download the Group Practice Self-Assessment for a deeper diagnostic on your specific blockers\n\nThe Boss Clinician Boardroom helps group practice owners close exactly these gaps — with peer support, expert strategy, and real accountability. It's designed for clinicians in exactly this season.\n\n[Apply for the Boss Clinician Boardroom →](https://bossclinician.callsphere.site/boardroom)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'hiring-quiz-not-yet'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Hiring quiz result email — Not Yet$qz$, $qz$Emails the quiz taker their "Not Yet — But That's Honest, and That's Good." result and next steps when the hiring-quiz-not-yet form is submitted by /hiring-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Hiring quiz result email — Not Yet$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, are you ready to hire? Your result: Not Yet","bodyMd":"Hi {{firstName}},\n\nThank you for taking the \"Are You Ready to Hire Your First Clinician?\" quiz. Here is your result and your action plan.\n\n## Not Yet — But That's Honest, and That's Good.\n\n*Your practice needs a stronger solo foundation before adding a team member.*\n\nBased on your answers, your practice isn't quite ready for a hire — and that's actually the most important thing to know before you bring someone on. Hiring before the foundation is solid is one of the most common and costly mistakes group practice owners make.\n\nThe work right now is building the practice that makes hiring possible — consistent income, real systems, and a referral pipeline that generates demand beyond what you alone can serve. That's not a setback. That's strategy.\n\n**Your Next Steps**\n\n1. Focus on reaching and maintaining a full, consistent caseload for 3+ consecutive months\n2. Build and document your core systems — intake, scheduling, billing, clinical onboarding\n3. Create a simple referral system that generates consistent new inquiries\n4. Get clear on your financials — know your monthly revenue, expenses, and profit margin\n5. Start with the free Practice Reset Audit to identify exactly what needs restructuring first\n\nThe Boss Clinician Lounge is your next step — a monthly membership for established clinicians ready to strengthen their structure, stabilize their income, and build toward sustainable growth, including a future team.\n\n[Join the Boss Clinician Lounge →](https://bossclinician.callsphere.site/lounge)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'retreat-quiz-depleted'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Burnout assessment result email — The Depleted Pourer$qz$, $qz$Emails the taker their The Depleted Pourer result and the retreat details when the retreat-quiz-depleted form is submitted from the result at /retreat-needed-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Burnout assessment result email — The Depleted Pourer$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Burnout Self-Assessment result: The Depleted Pourer","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Burnout Self-Assessment for Women Mental Health Professionals. Here are your results.\n\n## The Depleted Pourer\n\n*Running on empty and still pouring*\n\nYou are the woman everyone counts on, and it is costing you more than anyone sees. You hold space all day, come home and hold more, and the version of rest you get still has a job attached. Here is the truth you already know as a clinician: you cannot keep giving from an empty cup, and no one is coming to fill it for you. You have to choose it. Six days where everything is handled and your only job is to receive is not a luxury for a woman in your season. It is the intervention.\n\n**Release. Restore. Reconnect.**\n\nJune 15-20, 2027 · Ubud, Bali · A private luxury villa for women mental health professionals. Six days where you are not responsible for anyone but yourself.\n\n[Discover the Retreat →](https://bossclinician.callsphere.site/retreats)\n\n*This is a reflective self-assessment, not a clinical diagnostic tool.*\n\nWith care,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'retreat-quiz-functional'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Burnout assessment result email — The Functional Giver$qz$, $qz$Emails the taker their The Functional Giver result and the retreat details when the retreat-quiz-functional form is submitted from the result at /retreat-needed-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Burnout assessment result email — The Functional Giver$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Burnout Self-Assessment result: The Functional Giver","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Burnout Self-Assessment for Women Mental Health Professionals. Here are your results.\n\n## The Functional Giver\n\n*Holding it together, quietly running low*\n\nFrom the outside you are fine. Practice running, family handled, everyone taken care of. But you felt these questions land, which means some part of you knows the mask is doing more work than it used to. You do not need to hit empty before you choose yourself. The women who get ahead of burnout are the ones who rest BEFORE the breaking point. Six days of being fully poured into is how you protect everything you have built, including you.\n\n**Release. Restore. Reconnect.**\n\nJune 15-20, 2027 · Ubud, Bali · A private luxury villa for women mental health professionals. Six days where you are not responsible for anyone but yourself.\n\n[Discover the Retreat →](https://bossclinician.callsphere.site/retreats)\n\n*This is a reflective self-assessment, not a clinical diagnostic tool.*\n\nWith care,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'retreat-quiz-replenished'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Burnout assessment result email — The Replenished Woman$qz$, $qz$Emails the taker their The Replenished Woman result and the retreat details when the retreat-quiz-replenished form is submitted from the result at /retreat-needed-quiz.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Burnout assessment result email — The Replenished Woman$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Burnout Self-Assessment result: The Replenished Woman","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Burnout Self-Assessment for Women Mental Health Professionals. Here are your results.\n\n## The Replenished Woman\n\n*Pouring from a full cup*\n\nYou have done the work most women in this field never do. You rest without guilt, you invest in yourself, and you know restoration is a practice, not a reward. Women like you do not come to retreats to recover. You come to deepen, to connect with women on your level, and to experience the kind of luxury rest you cannot create alone. You would not just attend this sisterhood. You would elevate it.\n\n**Release. Restore. Reconnect.**\n\nJune 15-20, 2027 · Ubud, Bali · A private luxury villa for women mental health professionals. Six days where you are not responsible for anyone but yourself.\n\n[Discover the Retreat →](https://bossclinician.callsphere.site/retreats)\n\n*This is a reflective self-assessment, not a clinical diagnostic tool.*\n\nWith care,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'boss-assessment'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Boss assessment — send the Group Practice Self-Assessment$qz$, $qz$PAUSED until the PDF is on this site. Emails the Group Practice Self-Assessment to everyone who submits /boss-assessment. Upload the PDF, replace ADD-THE-PDF-LINK-HERE in the email with its link, then switch this automation on.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'paused'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Boss assessment — send the Group Practice Self-Assessment$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your Group Practice Self-Assessment","bodyMd":"Hi {{firstName}},\n\nThank you for requesting the Group Practice Self-Assessment: *Are You Running Your Practice — or Is It Running You?*\n\nA self-assessment for group practice owners who built the team — but still can't step back.\n\n[Download your free fillable PDF →](ADD-THE-PDF-LINK-HERE)\n\nWhen you have scored yourself, the Boss Clinician Boardroom is where group practice owners work through exactly these blockers together.\n\n[Apply for the Boss Clinician Boardroom →](https://bossclinician.callsphere.site/boardroom)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

-- 4. The practice quiz's Careful Clinician email: its offer button goes to the offer quiz, as on Kajabi.
UPDATE automation_actions aa
   SET config = jsonb_set(
         aa.config, '{bodyMd}',
         to_jsonb(replace(aa.config->>'bodyMd',
           '(https://bossclinician.callsphere.site/work-with-me)',
           '(https://bossclinician.callsphere.site/offer-quiz)'))),
       updated_at = now()
  FROM automations a
 WHERE a.id = aa.automation_id
   AND a.name = $qz$Quiz result email — Careful Clinician$qz$
   AND aa.action_type = 'send_email'
   AND aa.config->>'bodyMd' LIKE '%(https://bossclinician.callsphere.site/work-with-me)%';

-- 5. These paths are pages now, not redirects.
DELETE FROM redirects WHERE from_path IN (
  '/offer-quiz',
  '/hiring-quiz',
  '/hire-form',
  '/retreat-needed-quiz',
  '/retreat-thank-you-page',
  '/boss-assessment',
  '/visionary-form',
  '/careful-form',
  '/steady-form',
  '/reluctant-form',
  '/practice-set-up-quiz-ty'
);
