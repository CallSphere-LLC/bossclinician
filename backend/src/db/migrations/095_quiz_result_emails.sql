-- 095 — The Practice Set Up Quiz emails each taker their result (QA sheet, 2026-10-01).
--
-- The quiz's email step promises "your personalized result plus your free action
-- plan with 3 specific next steps", and Kajabi emailed it; until now nothing here
-- did. One automation per result form (091): form submitted -> send the taker
-- their result. Copy is generated from frontend/src/content/practiceQuiz.ts (the
-- same words as the result screen). Plain automations, so the owner can edit the
-- wording in Admin -> Automations. Sent as marketing from the marketing_email
-- identity, so opted-out / suppressed addresses are skipped by the sending gate.
-- Links are absolute to the callsphere.site address: update at domain cutover.
-- Idempotent: each automation is created only if its name is not already there.

WITH form AS (SELECT id FROM forms WHERE slug = 'quiz-visionary'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Quiz result email — Visionary Builder$qz$, $qz$Emails the quiz taker their The Visionary Builder result and 3-step action plan when the quiz-visionary form is submitted by the quiz at /practice-quiz/take.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Quiz result email — Visionary Builder$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your practice builder type: The Visionary Builder","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Practice Set Up Quiz. Here is your result and your free action plan.\n\n## The Visionary Builder\n\n*You can see exactly where you want to go. The gap is in the foundation.*\n\n**What this means for you**\n\nYou have a clear vision for your practice. What's missing is the structural foundation that turns that vision into something consistent and profitable.\n\nYou're not behind. You're building. And the right framework right now will save you years of guessing, second-guessing, and starting over. You don't need more information you need a structured path that builds on itself, with someone who has already walked the road you're on.\n\n**Your action plan: 3 next steps**\n\n1. **Get your foundation right from day one.** Niche, pricing, marketing, and systems in the right order. Not all at once.\n2. **Stop building in isolation.** You need a community of clinicians at the same stage so you're not guessing alone.\n3. **Build toward sustainability from the start.** Not just getting clients building a practice you can sustain for years without burning out.\n\n**Your recommended next step: Boss Clinician Club**\n\nA 6-month structured coaching program for clinicians who are done guessing and ready to build their foundation the right way. Biweekly coaching calls, monthly growth kits, and a community of clinicians navigating the same season.\n\n[Join the Boss Clinician Club →](https://bossclinician.callsphere.site/club)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'quiz-careful'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Quiz result email — Careful Clinician$qz$, $qz$Emails the quiz taker their The Careful Clinician result and 3-step action plan when the quiz-careful form is submitted by the quiz at /practice-quiz/take.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Quiz result email — Careful Clinician$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your practice builder type: The Careful Clinician","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Practice Set Up Quiz. Here is your result and your free action plan.\n\n## The Careful Clinician\n\n*You're excellent at the clinical work. The business side still feels uncertain.*\n\n**What this means for you**\n\nYou show up for your clients with excellence. But the business decisions pricing, marketing, systems, positioning still feel shaky or more overwhelming than they should.\n\nYou're not lacking in talent or dedication. You're lacking in business infrastructure and the consistent support to execute on what you already know. You know what you need to do. What you're missing is a structure that holds you accountable and a community that keeps you moving forward even when motivation runs low.\n\n**Your action plan: 3 next steps**\n\n1. **Stop relying on motivation build a system instead.** Consistency comes from structure, not inspiration. Build the container first.\n2. **Raise your rates and stop trading time for money alone.** A full caseload at low rates is not financial peace. That math will never work.\n3. **Get into community.** You need people building at your level not ahead of you or behind you. Your exact season.\n\n**Your recommended next step: Boss Clinician Club or Lounge**\n\nIf you're still building your foundation, the Club gives you structure and curriculum. If you're established and just need monthly strategy and accountability, the Lounge is your level. Take the full offer quiz to find out which fits.\n\n[Find Your Right Offer →](https://bossclinician.callsphere.site/work-with-me)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'quiz-steady'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Quiz result email — Steady Grower$qz$, $qz$Emails the quiz taker their The Steady Grower result and 3-step action plan when the quiz-steady form is submitted by the quiz at /practice-quiz/take.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Quiz result email — Steady Grower$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your practice builder type: The Steady Grower","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Practice Set Up Quiz. Here is your result and your free action plan.\n\n## The Steady Grower\n\n*You've built something real. Now it needs restructuring to grow without costing you.*\n\n**What this means for you**\n\nYou have a practice. You have clients. You have income. But the pace is unsustainable and the structure underneath isn't built for where you want to go next.\n\nYou're not starting over you're leveling up. The work now is optimization, not creation. You've proven you can build. The question is whether what you've built can hold the next level of growth without breaking down or breaking you. The answer is yes. But not without restructuring the foundation it's sitting on.\n\n**Your action plan: 3 next steps**\n\n1. **Restructure before you scale.** \"You cannot scale on top of a broken structure.\" Audit what's actually working and rebuild around it.\n2. **Build scalable income streams.** Stop trading all your time for money. One additional offer changes everything about your income ceiling.\n3. **Protect your energy with systems.** Automate, delegate, and document. The practice should run even when you're not running it.\n\n**Your recommended next step: Boss Clinician Lounge**\n\nA monthly membership for established clinicians who are ready to scale without sacrificing their life. Monthly live coaching, done-for-you strategy resources, and a community of clinicians building at your level. Member and VIP tiers available.\n\n[Join the Boss Clinician Lounge →](https://bossclinician.callsphere.site/lounge)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;

WITH form AS (SELECT id FROM forms WHERE slug = 'quiz-reluctant'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $qz$Quiz result email — Reluctant CEO$qz$, $qz$Emails the quiz taker their The Reluctant CEO result and 3-step action plan when the quiz-reluctant form is submitted by the quiz at /practice-quiz/take.$qz$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $qz$Quiz result email — Reluctant CEO$qz$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $qz${"subject":"{{firstName}}, your practice builder type: The Reluctant CEO","bodyMd":"Hi {{firstName}},\n\nThank you for taking the Practice Set Up Quiz. Here is your result and your free action plan.\n\n## The Reluctant CEO\n\n*You built the team. Now you need to learn how to lead one.*\n\n**What this means for you**\n\nYou took the leap into group practice and built something most clinicians only dream about. But nobody taught you how to lead a team, structure owner compensation, or build systems that work without you.\n\nYou're not doing it wrong. You're doing it alone. You've built a real business and that business now needs a real CEO. Not a therapist who also does payroll. Not a manager who also sees clients. A leader who has the strategy, the peer support, and the room to make decisions from strength instead of survival mode.\n\n**Your action plan: 3 next steps**\n\n1. **Stop being the only one who holds everything together.** Leadership infrastructure documented systems, delegated decisions is the work now.\n2. **Fix your pay structure.** If your team is paid and you're not, that is a structural problem not a cash flow problem.\n3. **Get into a room with people at your level.** You've outgrown solo clinician communities. You need peers who are also running teams.\n\n**Your recommended next step: Boss Clinician Boardroom**\n\nAn exclusive annual mastermind for group practice owners who are done doing it alone. Limited to 8–12 members. Monthly strategy sessions, quarterly in-person meetups, Voxer access, and peer accountability with clinicians building at the same level.\n\n[Apply for the Boardroom →](https://bossclinician.callsphere.site/boardroom)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$qz$::jsonb, 0 FROM new_automation;
