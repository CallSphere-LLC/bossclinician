-- =============================================================================
-- 221: Club bonus, round 2 (Yvette's answers 22 Nov 2026 10:39 AM, items 1-2;
--      revised doc "AUTOMATION AND CALENDAR HANDOFF" + EMAIL C1-C3).
--      Code: services/clubBonus.ts, services/clubBonusDeadline.ts,
--      services/sequences.ts (skip rule clubBonusReplaces).
--
-- A. Test accounts. "The four existing registrants are test accounts ... None
--    should receive the bonus. Please do not restart their bonus windows or
--    grant the Ramp-Up Rate training to the November 8 account. Exclude these
--    accounts from participant counts and bonus reminders."
--    The four saved windows (all 'legacy_pending', deadline NULL) become rule
--    'test_excluded' with NO deadline (nothing restarted), and their addresses
--    go into settings.club_bonus.excludedEmails, which the code checks live at
--    checkout fulfilment, on /club, before every reminder and in counts
--    (clubBonusExclusion / isClubBonusTestAccount / CLUB_BONUS_PARTICIPANT_SQL;
--    contacts.is_internal counts as excluded too). contacts.is_internal is NOT
--    set here: it also hides a contact from the admin People list, audience
--    totals and reports, and two of the four are Yvette's own addresses
--    (one has a real 2025 order). The November 8 Club order is order 200
--    (yhowardlcsw@gmail.com, member 119); it was never given the Ramp-Up Rate
--    Formula and club_bonus_orders is empty, so there is nothing to revoke.
--    legacyPendingGetsBonus goes false: no existing registrant gets the bonus.
-- B. C1-C3 copy: the revised subject, preview and body, word for word, in
--    place of migration 215's draft. Deadline fields {{bonus_deadline_date}},
--    {{bonus_deadline_time}}, {{bonus_deadline_timezone}} are filled from the
--    saved club_bonus_windows.deadline_at (the one checkout uses); a send with
--    any blank or unresolved token is blocked. Schedule (code): C1 five days
--    before the deadline date, C2 two days before, C3 on the deadline date,
--    9 a.m. Pacific. The emails stay DISABLED and the sequence stays DRAFT.
-- C. Club nurture 'practice-prep-to-the-club': Email 8 gets
--    {"clubBonusReplaces": "C1"}, Email 11 {"clubBonusReplaces": "C2"} ("Replace
--    Email 8 with C1 and replace Email 11 with C2"). Inert while the reminders
--    are off, and for anybody without a dated window (today: nobody).
--
-- Nothing here sends an email, enrols anybody or grants anything. Safe to run
-- twice; safe on an empty database.
-- =============================================================================

-- A1. Allow the new rule.
DO $m221a$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'club_bonus_windows'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%rule%'
  LOOP
    EXECUTE format('ALTER TABLE club_bonus_windows DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$m221a$;
ALTER TABLE club_bonus_windows ADD CONSTRAINT club_bonus_windows_rule_check CHECK (rule IN
  ('first_registration', 'legacy_pending', 'legacy_plain', 'legacy_go_live', 'manual', 'test_excluded'));

DO $m221$
DECLARE
  v_test text[] := ARRAY[
    'yvette@bossclinician.com',
    'yhowardlcsw@gmail.com',
    'sagar+pp1107@callsphere.ai',
    'murosn@nv.ccsd.net'
  ];
  v_seq  integer;
  v_main integer;
BEGIN
  -- A2. The exclusion list (merged with whatever is already there).
  UPDATE settings
     SET value = jsonb_set(
           value || '{"legacyPendingGetsBonus": false}'::jsonb,
           '{excludedEmails}',
           (SELECT COALESCE(jsonb_agg(e ORDER BY e), '[]'::jsonb)
              FROM (SELECT DISTINCT lower(e) AS e
                      FROM (SELECT jsonb_array_elements_text(
                                     CASE WHEN jsonb_typeof(value->'excludedEmails') = 'array'
                                          THEN value->'excludedEmails' ELSE '[]'::jsonb END) AS e
                            UNION ALL SELECT unnest(v_test)) s) d)),
         updated_at = now()
   WHERE key = 'club_bonus';

  -- A3. Their windows: test accounts, no deadline, never restarted.
  UPDATE club_bonus_windows
     SET rule = 'test_excluded', deadline_at = NULL, updated_at = now()
   WHERE email = ANY(v_test)
     AND rule <> 'test_excluded';

  -- B. The revised C1-C3 (draft sequence, emails disabled on purpose).
  SELECT id INTO v_seq FROM email_sequences WHERE slug = 'club-bonus-reminders';
  IF v_seq IS NOT NULL THEN
    UPDATE email_sequences
       SET description = 'Ramp-Up Rate Formula bonus reminders for Club training registrants (revised 22 Nov 2026): C1 five days before, C2 two days before and C3 on the date of each subscriber''s own bonus deadline (11:59 p.m. Pacific, 14 calendar days after the first training registration), at 9 a.m. Pacific. Sent automatically from each saved deadline (migrations 215/221) - do NOT add people to this sequence by hand, and leave the three emails disabled (the dispatcher sends them anyway; disabled keeps the ordinary engine from sending them without a date). Status is the on/off switch: Active sends, anything else sends nothing. Never sent to Club buyers, test accounts or after the deadline; a send with an unfilled field is blocked.',
           updated_at = now()
     WHERE id = v_seq;

    UPDATE sequence_emails
       SET subject = $em$Your Ramp-Up Rate bonus window ends in five days$em$, preview_text = $em$Join The Club before your deadline to receive the bonus training.$em$,
           body_md = $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can picture your own practice. But when you try to choose a session fee, you’re still wondering, “Will this cover what I need—and will anyone pay it?”</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That decision deserves more than copying another therapist’s rate.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside The Club, The Boss Move helps you work through your financial plan, client acquisition, and launch systems. The Ramp-Up Rate training gives you additional support thinking through your private-pay pricing and how it connects to your income needs and available client hours.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Join The Club by {{bonus_deadline_date}} at {{bonus_deadline_time}} {{bonus_deadline_timezone}} to receive the Ramp-Up Rate training as your registration bonus.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your bonus window ends in five days. Enrollment in The Club stays open after that; this deadline applies only to the bonus.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You can prepare while you’re still employed and build toward a practice that supports your responsibilities and the schedule you want.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review The Club and join with your bonus</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/club</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To your success,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$, enabled = false, updated_at = now()
     WHERE sequence_id = v_seq AND position = 1;
    UPDATE sequence_emails
       SET subject = $em$Two days left to join The Club with your bonus$em$, preview_text = $em$Put a plan behind the fee you’re considering.$em$,
           body_md = $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Maybe you’ve chosen a fee for your future practice. But have you worked through what happens when a week includes cancellations, unpaid admin, or time away?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You don’t have to have every answer before you ask for support.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Club helps you connect your financial planning, approach to finding clients, and business systems. The Ramp-Up Rate training adds a focused way to think through private-pay pricing alongside the income and workload you’re planning for.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Your opportunity to receive that training as a bonus when you join The Club ends on {{bonus_deadline_date}} at {{bonus_deadline_time}} {{bonus_deadline_timezone}}.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s two days from now.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The goal is to understand what your practice needs to support, so your next decision is grounded in your life and your numbers.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Club will remain open after your deadline. Only this bonus offer ends.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>See The Club details and join with your bonus</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/club</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To your success,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$, enabled = false, updated_at = now()
     WHERE sequence_id = v_seq AND position = 2;
    UPDATE sequence_emails
       SET subject = $em$Your Ramp-Up Rate bonus expires today$em$, preview_text = $em$Your personal bonus deadline is inside.$em$,
           body_md = $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">A quick reminder: your Ramp-Up Rate training bonus expires today, {{bonus_deadline_date}}, at {{bonus_deadline_time}} {{bonus_deadline_timezone}}.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you’re ready to start or rebuild your practice with support, join The Club before that time to receive the bonus.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Through The Boss Move, you’ll work on your financial plan, how you’ll reach potential clients, and the systems behind welcoming them. The bonus training provides additional support with private-pay pricing as you put those pieces together.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You may be hoping for fewer agency hours, more say over your schedule, or a practice you understand how to run. Those goals need a plan—and you can get help building it.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Enrollment in The Club remains open after today. This is the deadline for your bonus, not your last chance to join the program.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review The Club and join before your bonus expires</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/club</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To your success,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$, enabled = false, updated_at = now()
     WHERE sequence_id = v_seq AND position = 3;
  END IF;

  -- C. Email 8 -> C1, Email 11 -> C2 (matched by position AND subject).
  SELECT id INTO v_main FROM email_sequences WHERE slug = 'practice-prep-to-the-club';
  IF v_main IS NOT NULL THEN
    UPDATE sequence_emails
       SET skip_rules = COALESCE(skip_rules, '{}'::jsonb) || '{"clubBonusReplaces": "C1"}'::jsonb,
           updated_at = now()
     WHERE sequence_id = v_main AND position = 8
       AND subject LIKE 'We need to talk about your agency%'
       AND (skip_rules->>'clubBonusReplaces') IS DISTINCT FROM 'C1';
    UPDATE sequence_emails
       SET skip_rules = COALESCE(skip_rules, '{}'::jsonb) || '{"clubBonusReplaces": "C2"}'::jsonb,
           updated_at = now()
     WHERE sequence_id = v_main AND position = 11
       AND subject LIKE 'Let%s build the practice you keep thinking about'
       AND (skip_rules->>'clubBonusReplaces') IS DISTINCT FROM 'C2';
  END IF;
END
$m221$;

-- =============================================================================
-- SWITCH (run by hand after the tests; none of this runs here).
--
-- Turn C1-C3 ON (also turns on the Club sequence's replacement/spacing skips):
--   UPDATE email_sequences SET status = 'active', updated_at = now()
--    WHERE slug = 'club-bonus-reminders';
-- OFF again:
--   UPDATE email_sequences SET status = 'draft', updated_at = now()
--    WHERE slug = 'club-bonus-reminders';
--
-- Exclude another test address later (no deploy needed; cached up to 60 s):
--   UPDATE settings SET value = jsonb_set(value, '{excludedEmails}',
--          COALESCE(value->'excludedEmails', '[]'::jsonb) || '["someone@example.com"]'::jsonb)
--    WHERE key = 'club_bonus';
-- =============================================================================
