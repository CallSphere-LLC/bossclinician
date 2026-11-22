-- =============================================================================
-- 203: Maxed Out masterclass sequence, Yvette's two-week campaign (sheet row 244)
--
-- "Update the email sequence for 'How to Create a Private Practice That Supports
--  Your Income, Energy and Future, Without Seeing 25 to 30 Clients Forever'
--  masterclass." Sequence 'maxed-out-masterclass' (live id 488), joined from the
-- masterclass form by automation 1401 (Lounge owners are never enrolled).
--
-- * Emails 1-6: her notes say they are preserved exactly. Checked against the
--   live emails: 1, 2, 5 and 6 match her doc and stay as they are (6 keeps its
--   live subject and preview; her doc gives none for 1-6). Her Email 3 in the doc
--   still holds drafting notes, so the live, finished Email 3 is kept. Email 4
--   gains the one paragraph her doc has that the live email lacks (the Practice
--   Elevation Dashboard), word for word. The Lounge link in emails 2 and 5 moves
--   from bossclinician.mykajabi.com (Kajabi closes 23 Nov) to the site's /lounge
--   page, the same rewrite migration 188 made.
-- * Emails 7-14 from her doc, word for word, with her subjects and preview text.
-- * Cadence: "Email 1 immediately, then one email daily through Email 14", each
--   at 9 a.m. Pacific (send_at_minute, migration 202). The old delays were day
--   numbers counted as gaps (the old email 14 would have gone on about day 105).
-- * Emails 11 and 12 (founding rate $197/$247, "first 20 founding members") are
--   added switched OFF: her notes say to verify the founding offer before sending,
--   and the founding-rate wording is coming off the Lounge page (row 245). The
--   $197/month, 6-month minimum, $1,182 total does match checkout. Yvette turns
--   them on in Admin → Email sequences once confirmed; while off, email 13
--   follows email 10 the next day.
-- * Emails 13-14 (Ramp-Up Rate Formula) are skipped for anyone who already owns
--   the Ramp-Up Rate Formula (or the Lounge).
-- * A purchase no longer ends the whole run: only joining the Lounge does (the
--   exclude rules for The Lounge, Lounge VIP and VIP extra stay). Before, any
--   purchase at all, including the $97 Ramp-Up formula, stopped every email.
--
-- No active subscribers today. Nobody is enrolled; status is not touched.
-- Safe to run twice.
-- =============================================================================

DO $m203$
DECLARE
  v_seq integer;
  v_downsell_skip jsonb;
  v_subject text;
  v_preview text;
  v_body text;
BEGIN
  SELECT id INTO v_seq FROM email_sequences WHERE slug = 'maxed-out-masterclass';
  IF v_seq IS NULL THEN
    RAISE NOTICE '203: maxed-out-masterclass not found, emails left as they are';
    RETURN;
  END IF;
  v_downsell_skip := jsonb_build_object('ownsOfferIds', COALESCE((
    SELECT jsonb_agg(id ORDER BY id) FROM offers
     WHERE slug IN ('ramp-up-rate-formula', 'the-lounge', 'the-lounge-vip')), '[]'::jsonb));

  UPDATE email_sequences
     SET send_at_minute = 540, timezone = 'America/Los_Angeles', use_contact_timezone = false,
         exit_on_purchase = false,
         description = 'Yvette''s Maxed Out masterclass campaign (21 Nov 2026): registration email immediately, then one email a day at 9 a.m. Pacific through email 14. Emails 11-12 (founding rate) are off until the founding offer is confirmed. Stops when someone joins The Lounge; the Ramp-Up emails (13-14) are skipped for Ramp-Up owners.',
         updated_at = now()
   WHERE id = v_seq;

  INSERT INTO sequence_exclude_offers (sequence_id, offer_id)
  SELECT v_seq, o.id FROM offers o
   WHERE o.slug IN ('the-lounge', 'the-lounge-vip')
     AND NOT EXISTS (SELECT 1 FROM sequence_exclude_offers x
                      WHERE x.sequence_id = v_seq AND x.offer_id = o.id);

  -- Emails 1-6: copy as live; Email 1 immediately, then daily.
  UPDATE sequence_emails
     SET delay_minutes = CASE WHEN position = 1 THEN 0 ELSE 1440 END,
         enabled = true, kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position BETWEEN 1 AND 6;

  UPDATE sequence_emails
     SET body_md = regexp_replace(body_md,
           'https://bossclinician\.mykajabi\.com/lounge(\?cid=[^)[:space:]"]*)?',
           'https://www.bossclinician.com/lounge', 'g'),
         updated_at = now()
   WHERE sequence_id = v_seq AND body_md LIKE '%bossclinician.mykajabi.com/lounge%';

  -- Email 4: her added paragraph, after "...we work on inside **The Lounge**."
  UPDATE sequence_emails
     SET body_md = regexp_replace(body_md, 'inside \*\*The Lounge\*\*\.\n\n',
           'inside **The Lounge**.' || E'\n\n' || $p4$I created Practice Elevation Dashboard, a tool you will inside The Lounge, that gives you a snapshot of how you are using your time in your business and will give you a personalized view of what you need to decrease client load without an income deep so you can actually be present at the family events or take the vacation you put on hold.$p4$ || E'\n\n'),
         updated_at = now()
   WHERE sequence_id = v_seq AND position = 4
     AND strpos(body_md, 'Practice Elevation Dashboard') = 0
     AND body_md ~ 'inside \*\*The Lounge\*\*\.\n\n';

  -- 7. Email 7 — I don’t want to be a cash-pay-only practice
  v_subject := $em$You can want better income and still accept insurance.$em$;
  v_preview := $em$Let’s look at what works for your clients and your practice.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">When someone says, “Just stop taking insurance,” you might immediately think of the clients who rely on their benefits.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Then you think about your own bills.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You want more room in your schedule, but you don’t want to make a change that puts access or your income at risk.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">One established clinician I worked with wanted to attract cash-pay clients in a new market while continuing to accept insurance in her existing practice.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">She needed a plan that made room for both.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">We clarified who she wanted to reach, revised her Psychology Today profile, identified referral partners, and developed a 90-day plan that matched the pace of growth she wanted.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">By the end of our work together, she reported inquiries through her updated profile.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That was progress toward the client mix she wanted, with a clear plan for how to reach those people.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">This is the kind of decision you can bring into The Lounge.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">We look at your payer mix, collections, expenses, and workload. You can use the Insurance Panel Audit Tracker and bring your questions to a Strategy Session before deciding what to change.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Maybe your goal is to move from 25 sessions toward 20 each week while supporting your planned owner pay. We work through what would need to change for that goal to be financially realistic.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You deserve a strategy that considers the people you serve and the life you want to live.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Build your practice’s next plan inside The Lounge</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = true, skip_rules = '{}'::jsonb,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 7;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 7, 1440, v_subject, v_preview, v_body, true, '{}'::jsonb);
  END IF;
  -- 8. Email 8 — I already have a full caseload. When would I do this?
  v_subject := $em$Your last session ended. Your workday didn’t.$em$;
  v_preview := $em$Start with one piece of the work that keeps following you home.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your last client leaves, and you’re already thinking about dinner.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Then you see the inbox. A billing question. An intake that needs a response. Another task you meant to finish yesterday.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">By the time you close your laptop, the evening you wanted is almost gone.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">So when I talk about The Lounge, I understand why your first thought might be, “When am I supposed to fit that in?”</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You need a manageable place to start.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside The Lounge, you begin with your practice assessment and numbers, then choose one priority. The Practice Elevation curriculum is available at your pace, and the monthly 90-minute Strategy Session gives you a place to work through what happens as you apply it.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">For example, you might track six hours of weekly admin and set a goal of getting that down to four.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You would identify the recurring tasks, choose one process to simplify or appropriately delegate, and track the time afterward. The dashboard and systems tools help you see whether the change is actually giving you time back.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Those two hours could mean two evenings when you’re finished an hour earlier. That’s a goal to work toward—not another lesson to check off.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you miss a live session, you can use the replay during your active membership. You can focus on the part of your practice that needs attention now.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Join The Lounge to work toward fewer hours behind the scenes and a schedule with room for your life.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Start with one priority inside The Lounge</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = true, skip_rules = '{}'::jsonb,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 8;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 8, 1440, v_subject, v_preview, v_body, true, '{}'::jsonb);
  END IF;
  -- 9. Email 9 — I built my practice with free Facebook group advice
  v_subject := $em$The advice got you started. What fits your practice now?$em$;
  v_preview := $em$You can appreciate what helped you and still need more specific support.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Free advice may have helped you choose an EHR, find a biller, or get your first referrals.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You used it. You built something. Give yourself credit for that.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">But now you might ask, “Can I afford to stop working Fridays?” and receive twelve answers from people with twelve different businesses.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hire someone.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Raise your rates.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Add a group.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Take another insurance panel.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Which one actually fits your expenses, your clients, and the hours you want to work?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">One solo practice owner came to coaching because she wanted more freedom and needed help deciding what to do next.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">We talked through what she wanted her days to look like. She decided to pause her practice, and we worked on a plan for returning when she was ready.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Her outcome was a clear decision and a return plan. The support helped her work through what made sense for her life.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s why I want you to have space for your own questions inside The Lounge.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If your goal is a four-day workweek, we can examine the income, expenses, admin, and client care involved before you remove a day from your schedule. You use your business plan and dashboard to put the decision into numbers and steps you can review.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You don’t have to become a group owner or copy someone else’s model to belong here.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you’re ready to work toward a schedule and owner pay that fit your actual practice, bring your questions into The Lounge.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Make your next practice decision with support</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = true, skip_rules = '{}'::jsonb,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 9;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 9, 1440, v_subject, v_preview, v_body, true, '{}'::jsonb);
  END IF;
  -- 10. Email 10 — I love therapy, but coaches seem to make more
  v_subject := $em$You don’t have to become a coach to want more.$em$;
  v_preview := $em$Before you build another business, look at the one you already have.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You love seeing your clients make progress.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You also want to pay yourself well, take time off, and stop feeling like earning more means adding another evening of sessions.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Then you see someone selling a coaching program and wonder, “Do I have to leave therapy to have that kind of freedom?”</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">I understand why that thought comes up. I’ve invested in programs about coaching and creating offers, too.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">But starting another business brings its own work: finding an audience, developing an offer, marketing, selling, and delivering it.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Before you add that to your life, let’s look at what your existing practice could support.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside The Lounge, we review your rates, client mix, expenses, services, and unpaid working hours. The Practice Elevation curriculum and Strategy Sessions help you decide which change deserves your attention first.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If your goal is one afternoon off each week, we can evaluate what those appointments contribute, what work would still need to happen, and what would need to change to support your owner pay.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Sometimes an appropriate therapy group or supervision service belongs in that plan. Sometimes the priority is improving collections or reducing the time you spend on admin.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You get to evaluate the options against your qualifications, capacity, and goals.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can keep loving therapy and work toward a practice that asks less of your week.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Build a more sustainable practice inside The Lounge</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = true, skip_rules = '{}'::jsonb,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 10;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 10, 1440, v_subject, v_preview, v_body, true, '{}'::jsonb);
  END IF;
  -- 11. Email 11 — Short Lounge reminder (kept OFF: founding-rate claims to verify)
  v_subject := $em$What would you need to take five workdays off?$em$;
  v_preview := $em$Let’s put a real plan behind the vacation you keep postponing.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’ve thought about the trip. Maybe you’ve even checked the dates.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Then you start calculating the sessions you’d miss and close the tab.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside The Lounge, we can turn “I need a break” into a goal you can plan around: five business days without routine billing, inbox checks, or scheduled sessions.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The PTO income calculator helps you work through the money to set aside. The systems resources and coaching help you plan how necessary tasks and client coverage will be handled.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s how we begin working toward time off that feels like time off.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The founding Lounge Member rate is $197 per month, with a six-month minimum commitment totaling $1,182. After that, membership continues month-to-month unless canceled. The monthly rate for new members rises to $247 when founding enrollment closes.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If the support fits what you need, this is your invitation to start building your plan.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Review the options and join The Lounge</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = false, skip_rules = '{}'::jsonb,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 11;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 11, 1440, v_subject, v_preview, v_body, false, '{}'::jsonb);
  END IF;
  -- 12. Email 12 — Founding-rate reminder (kept OFF: founding-rate claims to verify)
  v_subject := $em$Before the Lounge founding rate changes$em$;
  v_preview := $em$Choose support for the practice you want to keep running.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">One quick reminder: the founding Lounge Member rate is for the first 20 founding members.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">While those places remain available, you can join at $197 per month with a six-month minimum commitment. Once founding enrollment closes, the monthly rate for new members becomes $247.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your founding rate stays the same while you maintain continuous membership on your selected plan.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Think about the decision you’ve been putting off.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Can you reduce two weekly sessions and still support your planned owner pay? Which panel deserves a closer look? What would need to change before you stop working through lunch?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Those are the kinds of questions we work through using your numbers, The Practice Elevation resources, and monthly Strategy Sessions.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The goal is a practice that supports your income at a workload you can sustain.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you’ve been waiting for support to turn those questions into a plan, I’d love to work with you.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Review the current founding availability and join</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = false, skip_rules = '{}'::jsonb,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 12;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 12, 1440, v_subject, v_preview, v_body, false, '{}'::jsonb);
  END IF;
  -- 13. Email 13 — Deload 1 — Not ready for The Lounge? Start here.
  v_subject := $em$Not ready for The Lounge? Start with one decision.$em$;
  v_preview := $em$You can still take a useful step toward a more sustainable caseload.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Maybe you’ve watched the masterclass, looked at The Lounge, and thought:</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">“I know something needs to change, but I’m not ready for the membership yet.”</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s okay.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can begin with one question: what would your private-pay rate need to support at the number of sessions you actually want to offer?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you chose your rate years ago—or picked it because it looked similar to everyone else’s—you may not have checked whether it still fits your expenses, income needs, and capacity.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Ramp-Up Rate Formula is a smaller, self-paced place to start.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Its rate-setting tools and calculators help you compare pricing scenarios, consider your goals and availability, and put your decisions into a workbook.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">For example, you could compare the projected revenue from 20 weekly sessions with 18 at a different average collected rate. Then account for cancellations, expenses, and time off before deciding whether the plan could support you.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The result is a clearer pricing target and a better understanding of what a lighter caseload would require.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You don’t need to change your rates today. Start by understanding your numbers.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/rampedrevenue"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Explore the Ramp-Up Rate Formula</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/rampedrevenue"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/rampedrevenue</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = true, skip_rules = v_downsell_skip,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 13;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 13, 1440, v_subject, v_preview, v_body, true, v_downsell_skip);
  END IF;
  -- 14. Email 14 — Deload 2 — Take the guesswork out of your next rate decision
  v_subject := $em$What if the rate you picked no longer fits your life?$em$;
  v_preview := $em$One focused step, without committing to the membership.$em$;
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Sometimes you know your rate needs another look.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">But then you imagine explaining a change. You worry about affordability. You wonder whether you’ll lose inquiries.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">So you leave it alone and tell yourself you’ll review it when things slow down.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can start with the calculation before deciding whether to make a change.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Ramp-Up Rate Formula gives you a focused way to work through private-pay pricing. Use the calculators and workbook to compare options and see how your session target relates to your revenue needs.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That could mean asking, “What would my private-pay fees need to look like if I wanted two fewer appointments each week?”</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your answer still needs to account for your market, collected revenue, costs, and realistic demand. But you’ll have something more useful than guessing what another therapist charges.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you accept insurance, this resource does not change contracted reimbursement. It helps you evaluate your private-pay pricing within the practice you have.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Lounge is available when you want broader, ongoing support. For now, this can be one manageable step toward a caseload and income plan that fit your life.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/rampedrevenue"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>👉 Start with the Ramp-Up Rate Formula</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/rampedrevenue"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/rampedrevenue</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  UPDATE sequence_emails
     SET subject = v_subject, preview_text = v_preview, body_md = v_body,
         delay_minutes = 1440, enabled = true, skip_rules = v_downsell_skip,
         kajabi_when = NULL, updated_at = now()
   WHERE sequence_id = v_seq AND position = 14;
  IF NOT FOUND THEN
    INSERT INTO sequence_emails
      (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
    VALUES (v_seq, 14, 1440, v_subject, v_preview, v_body, true, v_downsell_skip);
  END IF;

  UPDATE sequence_emails SET enabled = false, updated_at = now()
   WHERE sequence_id = v_seq AND position > 14 AND enabled;
END
$m203$;
