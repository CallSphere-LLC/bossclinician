-- =============================================================================
-- 204: "Are you ready for private practice" quiz emails (sheet row 246)
--
-- "Update and add the additional emails to the are you ready for private
--  practice quiz." Quiz form 'private-practice-for-you'; automations route by the
-- result, unchanged:
--   A Not Quite Yet  → 'email-sequence-for-quiz-not-yet-ready'     (live id 476)
--   B Almost Ready   → 'email-sequence-for-quiz-you-re-just-about-ready' (478)
--   C Ready to Build → 'email-sequence-for-quiz-you-re-ready-to-start'   (477)
--
-- * Each result gets her three emails, word for word with subject and preview:
--   Email 1 immediately, Email 2 on day 2, Email 3 on day 4, at 9 a.m. Pacific
--   (send_at_minute, migration 202). The old emails 4-8 (the old sales emails and
--   day-14 downsell her doc replaces) are switched off, not deleted.
-- * Emails 2 and 3 are skipped for anyone who has registered for the Club
--   training (form 'practicepreptraining') or owns The Club (skip_rules).
-- * Registering for the training ends the quiz run (exclude rule on that form)
--   and automation 1444 starts the training campaign once (no re-entry). Buying
--   The Club ends it too; other purchases no longer do.
-- * Repeat quiz submissions do not start a second run (re-entry off, and the
--   result automations skip anyone already in another result's sequence).
--
-- Existing subscribers: one person is mid-way through C at position 8 (the old
-- last email). Positions 1-3 are the only enabled emails now, so at their
-- scheduled time the run simply finishes without sending anything.
-- Nobody is enrolled; status is not touched. Safe to run twice.
-- =============================================================================

DO $m204$
DECLARE
  v_not_yet integer;
  v_almost integer;
  v_ready integer;
  v_club integer;
  v_form integer;
  v_invite_skip jsonb;
  v_seq integer;
  v_subject text;
  v_preview text;
  v_body text;
BEGIN
  SELECT id INTO v_not_yet FROM email_sequences WHERE slug = 'email-sequence-for-quiz-not-yet-ready';
  SELECT id INTO v_almost FROM email_sequences WHERE slug = 'email-sequence-for-quiz-you-re-just-about-ready';
  SELECT id INTO v_ready FROM email_sequences WHERE slug = 'email-sequence-for-quiz-you-re-ready-to-start';
  SELECT id INTO v_club FROM offers WHERE slug = 'the-club';
  SELECT id INTO v_form FROM forms WHERE slug = 'practicepreptraining';
  v_invite_skip := jsonb_build_object(
    'ownsOfferIds', to_jsonb(array_remove(ARRAY[v_club], NULL)),
    'submittedFormIds', to_jsonb(array_remove(ARRAY[v_form], NULL)));

  FOREACH v_seq IN ARRAY array_remove(ARRAY[v_not_yet, v_almost, v_ready], NULL) LOOP
    UPDATE email_sequences
       SET send_at_minute = 540, timezone = 'America/Los_Angeles', use_contact_timezone = false,
           exit_on_purchase = false,
           description = 'Private Practice For You quiz (21 Nov 2026): result email immediately, then two invitations to the free Club training on days 2 and 4 at 9 a.m. Pacific, skipped for anyone already registered or in The Club. Registering for the training or buying The Club ends the run.',
           updated_at = now()
     WHERE id = v_seq;
    IF v_club IS NOT NULL THEN
      INSERT INTO sequence_exclude_offers (sequence_id, offer_id)
      SELECT v_seq, v_club
       WHERE NOT EXISTS (SELECT 1 FROM sequence_exclude_offers x
                          WHERE x.sequence_id = v_seq AND x.offer_id = v_club);
    END IF;
    IF v_form IS NOT NULL THEN
      INSERT INTO sequence_exclude_forms (sequence_id, form_id)
      SELECT v_seq, v_form
       WHERE NOT EXISTS (SELECT 1 FROM sequence_exclude_forms x
                          WHERE x.sequence_id = v_seq AND x.form_id = v_form);
    END IF;
    UPDATE sequence_emails SET enabled = false, updated_at = now()
     WHERE sequence_id = v_seq AND position > 3 AND enabled;
  END LOOP;


  -- A result
  IF v_not_yet IS NOT NULL THEN
    -- 1A Not Quite Yet — Send Day 0
    v_subject := $em$Your quiz result and a place to begin$em$;
    v_preview := $em$You can prepare at a pace that fits your life.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your quiz result is Not Quite Yet.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your answers suggest there are areas worth exploring before you decide on your next move. You may want your own practice and still need your current paycheck, benefits, or breathing room.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’re allowed to take those responsibilities seriously.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">I started my practice in 2018 while working part-time in dialysis. I wanted independence, and I was still trying to protect the security of employment. I understand why you want to think this through.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Start by naming the question you need answered first. Is it what your practice would need to earn? How you would find clients? Or how to make time to prepare?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Over the next few days, I’ll share a free training that can help you explore those decisions as you consider a practice that supports your income and schedule goals.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Reply and tell me which question feels most important right now.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 0, enabled = true, skip_rules = '{}'::jsonb,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_not_yet AND position = 1;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_not_yet, 1, 0, v_subject, v_preview, v_body, true, '{}'::jsonb);
    END IF;
    -- 2A Not Quite Yet — Send Day 2
    v_subject := $em$You can explore private practice while keeping your job$em$;
    v_preview := $em$Start with the question that makes the next step feel uncertain.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your result was Not Quite Yet, and I want to give you room to explore what preparation could look like.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Maybe your paycheck is already spoken for before it reaches your account. Maybe you’re thinking about the appointments your insurance covers or how little energy you have left at the end of a clinical day.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">It makes sense to bring those concerns into your planning.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Kristan L., LCSW, shared that she launched her practice with my help while still employed full-time. Her experience shows one possible way to begin building alongside a job. Your next step can fit your own responsibilities.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">My free private practice training is a place to begin thinking through the decisions behind starting or restarting. Watch with one question in mind—what would I need to understand or put in place before taking my next step?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That could be your income needs, your approach to attracting clients, or the work involved in opening. Getting clearer can help you choose preparation that fits your current responsibilities.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Register for the free training and explore your next step</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/practicepreptraining</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 2880, enabled = true, skip_rules = v_invite_skip,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_not_yet AND position = 2;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_not_yet, 2, 2880, v_subject, v_preview, v_body, true, v_invite_skip);
    END IF;
    -- 3A Not Quite Yet — Send Day 4
    v_subject := $em$Which question would help you feel clearer?$em$;
    v_preview := $em$You can learn before deciding whether to move forward.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You may still be wondering whether private practice fits this season of your life.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s a question worth taking seriously. You can want more flexibility and still need to protect the stability you have today.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you’d like to explore the preparation involved, my free training is available. You can watch with the concern that matters most to you in mind, whether that’s income, clients, or finding time to begin.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">My own path involved building while employed and learning through experience. I created the Club so clinicians could get guidance with the decisions I once struggled through. The free training gives you a first step toward exploring that work.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Use it to identify what you need to investigate next. Your next step might be gathering numbers, exploring a business model, or deciding when you can give preparation more attention.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You get to make that decision with your own goals and responsibilities in view.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Register for the free private practice training</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/practicepreptraining</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 2880, enabled = true, skip_rules = v_invite_skip,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_not_yet AND position = 3;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_not_yet, 3, 2880, v_subject, v_preview, v_body, true, v_invite_skip);
    END IF;
  END IF;

  -- B result
  IF v_almost IS NOT NULL THEN
    -- 1B Almost Ready — Send Day 0
    v_subject := $em$Your result is Almost Ready. What needs to feel clearer?$em$;
    v_preview := $em$Let’s identify the decision you’re still circling.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your quiz result is Almost Ready.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You may have already taken some steps toward practice ownership. Then a question about clients, money, or getting everything in place brings you back to wondering whether you’re ready.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That back-and-forth can be tiring, especially when you’re trying to prepare around a full clinical schedule.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">I pieced together business advice while building my practice. Some of the gaps became expensive lessons. That experience is why preparation matters so much in the way I teach now.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Treat this result as a starting point for identifying what still needs attention. You can use what you’ve already done and get specific about your next decision.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Over the next few days, I’ll share a free training to help you think through preparing your practice, including the income you need, how clients will find you, and the steps involved in getting started.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The goal is to build toward a practice that gives you more say over your work and supports your life.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Reply and tell me what’s keeping you in that “almost” place.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 0, enabled = true, skip_rules = '{}'::jsonb,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_almost AND position = 1;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_almost, 1, 0, v_subject, v_preview, v_body, true, '{}'::jsonb);
    END IF;
    -- 2B Almost Ready — Send Day 2
    v_subject := $em$What would help you move beyond Almost Ready?$em$;
    v_preview := $em$Give the decision holding you up some focused attention.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’ve thought about the practice, maybe researched websites or saved advice about insurance. Yet when you sit down to take action, you still wonder what should come first.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">I remember looking at other therapists’ websites and leaving with more things I thought mine needed. I still had to get clear about who I wanted to reach.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Christina Mason, LCSW, CADC, described having a vision and needing support to bring it to life. After working with me, she established North Star Wellness LLC. She described gaining “the clarity, confidence, and direction” she needed.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">My free private practice training can help you step back and think through preparing your business. Bring the decision that keeps pulling you back into research.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Consider how your financial needs, client acquisition plan, and launch preparation fit together. That preparation supports the practice you want to build and the control you want over your schedule and income.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can use the training to identify your next question or action. The Club provides further structure and coaching when you’re ready to work through implementation.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Register for the free training</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/practicepreptraining</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 2880, enabled = true, skip_rules = v_invite_skip,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_almost AND position = 2;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_almost, 2, 2880, v_subject, v_preview, v_body, true, v_invite_skip);
    END IF;
    -- 3B Almost Ready — Send Day 4
    v_subject := $em$You can give that unanswered question a place to go$em$;
    v_preview := $em$Take a step toward a plan you can use.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Being almost ready can start to feel like being stuck, especially when you keep revisiting the same decision after work.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Maybe you’re wondering how to attract your first clients or how much your practice needs to earn before you reduce your employment hours.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Christina’s experience resonates here because she already had a vision. Support helped her turn it into an established practice. Think about the decision that would help you put your own vision into motion.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can give that question focused attention in my free private practice training. Bring it with you as you consider the preparation behind opening or rebuilding.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The aim is to help you identify your next steps toward a practice that supports your life. If you want help applying what you learn, the Club’s roadmap and coaching support the financial planning, client acquisition, and systems work involved.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Start with the training and see what needs attention in your plan.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Register for the free training</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/practicepreptraining</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 2880, enabled = true, skip_rules = v_invite_skip,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_almost AND position = 3;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_almost, 3, 2880, v_subject, v_preview, v_body, true, v_invite_skip);
    END IF;
  END IF;

  -- C result
  IF v_ready IS NOT NULL THEN
    -- 1C Ready to Build — Send Day 0
    v_subject := $em$Your result is Ready to Build. Choose your next step.$em$;
    v_preview := $em$Turn that readiness into a practical preparation plan.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your quiz result is Ready to Build.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your answers suggest you’re ready to explore concrete steps toward your own practice. You might feel excited and a little nervous about putting your plans into motion.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Starting something of your own can bring both feelings at once.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">I worked on platforms while building my own practice. Looking closely at the numbers helped me reconsider how I wanted to structure my business. Being busy had left me with more decisions to make.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">As you prepare, think about what you want your practice to make possible. Which hours would you like to work? Who do you want to serve? What would the business need to contribute to your household?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Those answers can guide the decisions you make before opening or rebuilding.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">In my next email, I’ll share a free training to help you organize your next steps toward a practice that supports your income and schedule goals.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Reply and tell me the first part of your practice you want to put in place.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 0, enabled = true, skip_rules = '{}'::jsonb,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_ready AND position = 1;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_ready, 1, 0, v_subject, v_preview, v_body, true, '{}'::jsonb);
    END IF;
    -- 2C Ready to Build — Send Day 2
    v_subject := $em$Before you announce your practice, work through the plan$em$;
    v_preview := $em$Use your readiness to choose practical next steps.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’re ready to start building. Now the list begins—rates, website, insurance, paperwork, and finding clients.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">It can feel exciting to make the practice real and overwhelming to realize how many decisions come with it.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Joanne Tran shared, “Yvette has been such a vital part of my journey” as she described starting her private practice. Having a place to bring the business questions can matter when you’re putting your plans into action.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">My free private practice training gives you a place to think through that preparation before you spend your next weekend trying to do everything at once.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">As you watch, consider what needs to happen for your practice to begin serving clients and working toward your income and schedule goals. What will you offer? How will people find you? What financial responsibilities need to shape your plan?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Club supports implementation through The Boss Move curriculum, tools, and coaching. The training is a chance to explore the work ahead and consider that support.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Register for the free training and prepare your next move</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/practicepreptraining</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 2880, enabled = true, skip_rules = v_invite_skip,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_ready AND position = 2;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_ready, 2, 2880, v_subject, v_preview, v_body, true, v_invite_skip);
    END IF;
    -- 3C Ready to Build — Send Day 4
    v_subject := $em$What do you want to have in place before your first inquiry?$em$;
    v_preview := $em$Let your next action support the practice you want to run.$em$;
    v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Imagine someone reaching out about therapy and knowing what you’ll do next.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can describe your services, explain the next step, and use a process you’ve already thought through.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s the kind of preparation worth making room for as you build. Alongside your financial and client acquisition plans, it helps you move toward an operating practice that supports your goals.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Kristan’s testimonial describes building a practice alongside full-time employment, then using her experience with practice income to inform her next career decision. You can begin by identifying the milestones you want to work toward.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">My free training is a place to think through the decisions ahead and choose what to work on next. If you want structured help implementing, you can also learn more about the Club after the training.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you haven’t registered yet, here’s your invitation.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Register for the free private practice training</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/practicepreptraining"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/practicepreptraining</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">With you on this,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician</span></p><p><br></p>$em$;
    UPDATE sequence_emails
       SET subject = v_subject, preview_text = v_preview, body_md = v_body,
           delay_minutes = 2880, enabled = true, skip_rules = v_invite_skip,
           kajabi_when = NULL, updated_at = now()
     WHERE sequence_id = v_ready AND position = 3;
    IF NOT FOUND THEN
      INSERT INTO sequence_emails
        (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
      VALUES (v_ready, 3, 2880, v_subject, v_preview, v_body, true, v_invite_skip);
    END IF;
  END IF;
END
$m204$;
