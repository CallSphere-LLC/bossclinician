-- =============================================================================
-- 215: The Club's Ramp-Up Rate Formula bonus, per-subscriber deadline
--      (Yvette's answers 22 Nov 2026, item 3). Code: services/clubBonus.ts,
--      services/clubBonusDeadline.ts, routes/public/clubBonus.ts.
--
-- "Give each subscriber until 11:59 p.m. Pacific Time, 14 calendar days after
--  their first registration for the Club training, to enroll and receive the
--  bonus." Club enrollment itself stays open (the training is evergreen).
--
-- A. club_bonus_windows: one saved window per subscriber (lower-cased email),
--    written once, from the FIRST Practice Prep Training registration
--    (form 'practicepreptraining'); registering again never moves it.
--    deadline_at NULL = undecided. Everybody who registered BEFORE this
--    migration ran is saved with deadline_at NULL and rule 'legacy_pending':
--    nobody is silently expired. Undecided people see the public wording (no
--    date, no expiry message), get no C1-C3, and a Club purchase by them
--    still includes the bonus (settings.club_bonus.legacyPendingGetsBonus).
--    How they enter the offer is Yvette's decision: see "EXISTING
--    REGISTRANTS" at the end of this file for the one-line choices.
-- B. club_bonus_orders: the included / not-included decision for each paid
--    Club order, made from the order's created_at (checkout submission), and
--    what was granted. The Ramp-Up Rate Formula is product
--    'ramp-up-rate-formula'; before this, a Club purchase never granted it.
-- C. club_bonus_reminder_sends: the C1-C3 ledger (once per window, reminder
--    and deadline; never backfilled, never after the deadline).
-- D. Sequence 'club-bonus-reminders' holds the C1-C3 copy (her row-243 doc,
--    rewritten only where enrollment-close wording had to describe the
--    bonus ending). It ships as DRAFT = OFF. Its status is the switch; nobody
--    is ever enrolled in it (services/clubBonus.ts sends from it).
-- E. Club sequence 497 ('practice-prep-to-the-club'):
--    * emails 3-17 get skip rule {"clubBonusReminderDay": true}: while the
--      reminders are ON, the sequence's own promotional email is skipped on a
--      subscriber's C1/C2/C3 day (her doc: "Replace overlapping promotional
--      emails and maintain spacing"). With the reminders OFF it skips nothing,
--      so this changes nothing for anybody until they are switched on.
--    * emails 3-14 link /club?b={{clubBonusToken}} (the subscriber's own
--      signed token; an empty b= for anybody without a window, which is just
--      /club). The
--      visible URL text is unchanged. One active subscriber, who gets the
--      same email at the same time with a different link target.
-- F. Offer the-club's description (shown on /checkout/the-club and in the
--    admin) drops "Enroll within 72 hours" for her bonus copy.
--
-- Nothing here sends an email or enrols anybody. Safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS club_bonus_windows (
  id                  BIGSERIAL PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND email <> ''),
  contact_id          INT REFERENCES contacts(id) ON DELETE SET NULL,
  first_registered_at TIMESTAMPTZ NOT NULL,
  first_submission_id INT,
  -- 23:59:59.999 America/Los_Angeles on the 14th calendar day; NULL = undecided.
  deadline_at         TIMESTAMPTZ,
  rule                TEXT NOT NULL CHECK (rule IN
                        ('first_registration', 'legacy_pending', 'legacy_plain',
                         'legacy_go_live', 'manual')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_bonus_windows_deadline_idx
  ON club_bonus_windows (deadline_at) WHERE deadline_at IS NOT NULL;
COMMENT ON TABLE club_bonus_windows IS
  'Club Ramp-Up Rate Formula bonus window per subscriber (migration 215). Written once from the first training registration; deadline_at NULL = undecided existing registrant.';

CREATE TABLE IF NOT EXISTS club_bonus_orders (
  order_id           INT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  email              TEXT NOT NULL DEFAULT '',
  window_id          BIGINT REFERENCES club_bonus_windows(id) ON DELETE SET NULL,
  included           BOOLEAN NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  granted_product_id INT REFERENCES products(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_bonus_reminder_sends (
  window_id        BIGINT NOT NULL REFERENCES club_bonus_windows(id) ON DELETE CASCADE,
  reminder         TEXT NOT NULL CHECK (reminder IN ('C1', 'C2', 'C3')),
  deadline_at      TIMESTAMPTZ NOT NULL,
  email_message_id INT,
  outcome          TEXT NOT NULL DEFAULT '',
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (window_id, reminder, deadline_at)
);

DO $m215$
DECLARE
  v_form    integer;
  v_go_live timestamptz;
  v_club    integer;
  v_seq     integer;
  v_main    integer;
  v_body    text;
BEGIN
  SELECT id INTO v_form FROM forms WHERE slug = 'practicepreptraining';
  SELECT id INTO v_club FROM offers WHERE slug = 'the-club';

  -- Settings. goLiveAt is set once, the first time this runs, and is the line
  -- between "existing registrant" and "new registrant".
  INSERT INTO settings (key, value, group_key, label, description, is_secret)
  VALUES ('club_bonus',
          jsonb_build_object(
            'goLiveAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'registrationFormIds', CASE WHEN v_form IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_form) END,
            'legacyPendingGetsBonus', true),
          'marketing', 'Club bonus deadline',
          'Ramp-Up Rate Formula bonus: 14 calendar days (Pacific) from the first Practice Prep Training registration. Migration 215.',
          false)
  ON CONFLICT (key) DO NOTHING;
  SELECT (value->>'goLiveAt')::timestamptz INTO v_go_live FROM settings WHERE key = 'club_bonus';

  -- A. Existing registrants: saved, undecided (never expired by this file).
  IF v_form IS NOT NULL THEN
    INSERT INTO club_bonus_windows
      (email, contact_id, first_registered_at, first_submission_id, deadline_at, rule)
    SELECT DISTINCT ON (lower(COALESCE(c.email::text, fs.email)))
           lower(COALESCE(c.email::text, fs.email)), fs.contact_id, fs.created_at, fs.id,
           NULL, 'legacy_pending'
      FROM form_submissions fs
      LEFT JOIN contacts c ON c.id = fs.contact_id
     WHERE fs.form_id = v_form
       AND fs.created_at < v_go_live
       AND COALESCE(c.email::text, fs.email, '') <> ''
     ORDER BY lower(COALESCE(c.email::text, fs.email)), fs.created_at, fs.id
    ON CONFLICT (email) DO NOTHING;
  END IF;

  -- D. The C1-C3 reminder copy, OFF (draft). The three emails are stored
  --    enabled = false ON PURPOSE: that makes it impossible for the ordinary
  --    sequence engine to send them (nobody can be enrolled into a sequence
  --    with no enabled emails), so they only ever go out from the deadline
  --    dispatcher, which reads them regardless of that flag and always has a
  --    date to put in them. Edit the copy freely; leave them "disabled".
  INSERT INTO email_sequences
    (name, slug, description, status, topic, skip_weekends, use_contact_timezone,
     timezone, send_at_minute, exit_on_purchase, allow_reentry, folder)
  VALUES
    ('Club bonus reminders (C1-C3)', 'club-bonus-reminders',
     'Ramp-Up Rate Formula bonus reminders for Club training registrants: C1 three days before, C2 one day before and C3 on the last day of each subscriber''s own 14-day bonus window, at 9 a.m. Pacific. Sent automatically from each saved deadline (migration 215) - do NOT add people to this sequence by hand, and leave the three emails disabled (the dispatcher sends them anyway; disabled keeps the ordinary engine from sending them without a date). Status is the on/off switch: Active sends, anything else sends nothing. Skipped for Club owners.',
     'draft', 'marketing', false, false, 'America/Los_Angeles', 540, true, false, '')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_seq FROM email_sequences WHERE slug = 'club-bonus-reminders';

  IF v_club IS NOT NULL THEN
    INSERT INTO sequence_exclude_offers (sequence_id, offer_id)
    SELECT v_seq, v_club
     WHERE NOT EXISTS (SELECT 1 FROM sequence_exclude_offers x
                        WHERE x.sequence_id = v_seq AND x.offer_id = v_club);
  END IF;

  -- C1 (three days before). Doc subject was "A quick heads-up about Club enrollment".
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Join The Club by {{clubBonusDeadline}} at 11:59 p.m. Pacific Time to receive the Ramp-Up Rate Formula with your enrollment.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside, you’ll work toward a financial transition plan, a client acquisition strategy, and systems to welcome clients. The Boss Move, planning tools, coaching, and community support you as you build or rebuild your practice.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you want guidance with the decisions between where you are and the practice you want, review the current program details before your bonus window closes. The Club remains open for enrollment. The deadline in your training emails applies to the Ramp-Up Rate Formula enrollment bonus.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review the Club and join</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/club</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To your success,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  INSERT INTO sequence_emails (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
  VALUES (v_seq, 1, 0, $em$A quick heads-up about your Ramp-Up Rate Formula bonus$em$, '', v_body, false, '{}'::jsonb)
  ON CONFLICT (sequence_id, position) DO NOTHING;

  -- C2 (one day before). Doc subject was "Club enrollment closes [ENROLLMENT_CLOSE_DATE]".
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You may be excited about starting and still have questions about how you’ll make room for it.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The Club gives you a roadmap for working through your financial transition, client acquisition, and launch systems. You can prepare while you’re employed and use coaching to work through implementation questions.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Join The Club by {{clubBonusDeadline}} at 11:59 p.m. Pacific Time to receive the Ramp-Up Rate Formula with your enrollment. Review the investment and support available as you decide whether this is the next step for you.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>See the Club details</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/club</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To your success,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  INSERT INTO sequence_emails (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
  VALUES (v_seq, 2, 2880, $em$Your Ramp-Up Rate Formula bonus ends {{clubBonusDeadline}}$em$, '', v_body, false, '{}'::jsonb)
  ON CONFLICT (sequence_id, position) DO NOTHING;

  -- C3 (the last day). Doc subject was "Club enrollment closes today".
  v_body := $em$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Join The Club by today, {{clubBonusDeadline}}, at 11:59 p.m. Pacific Time to receive the Ramp-Up Rate Formula with your enrollment.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you’re ready to work on the practice you’ve been thinking about, I’d love to support you.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’ll work through the financial plan behind your transition, the strategy for reaching clients, and the systems needed to welcome them. Those are concrete pieces you can build toward greater control over your work and future.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review the details and join before your bonus window closes</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/club?b={{clubBonusToken}}"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/club</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To your success,</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$em$;
  INSERT INTO sequence_emails (sequence_id, position, delay_minutes, subject, preview_text, body_md, enabled, skip_rules)
  VALUES (v_seq, 3, 1440, $em$Your Ramp-Up Rate Formula bonus ends today$em$, '', v_body, false, '{}'::jsonb)
  ON CONFLICT (sequence_id, position) DO NOTHING;

  -- E. The Club sequence: reminder-day skip (inert while reminders are off)
  --    and the subscriber's own /club link.
  SELECT id INTO v_main FROM email_sequences WHERE slug = 'practice-prep-to-the-club';
  IF v_main IS NOT NULL THEN
    UPDATE sequence_emails
       SET skip_rules = COALESCE(skip_rules, '{}'::jsonb) || '{"clubBonusReminderDay": true}'::jsonb,
           updated_at = now()
     WHERE sequence_id = v_main AND position BETWEEN 3 AND 17
       AND NOT (COALESCE(skip_rules, '{}'::jsonb) ? 'clubBonusReminderDay');

    UPDATE sequence_emails
       SET body_md = replace(body_md, 'href="https://www.bossclinician.com/club"', 'href="https://www.bossclinician.com/club?b={{clubBonusToken}}"'),
           updated_at = now()
     WHERE sequence_id = v_main AND position BETWEEN 3 AND 14
       AND body_md LIKE '%href="https://www.bossclinician.com/club"%';
  END IF;

  -- F. The offer description: her bonus copy in place of the 72-hour bonus.
  UPDATE offers
     SET description = regexp_replace(
           replace(description, E'Plus these bonuses, included when you enroll:\n', E'Plus these bonuses:\n'),
           E'\U0001F381 FAST ACTION BONUS: The Ramp-Up Rate Pricing Formula\n[^\n]*\n',
           E'\U0001F381 YOUR TRAINING REGISTRATION BONUS: The Ramp-Up Rate Formula\n'
           || E'Starting your practice comes with enough decisions. Your fee does not have to be another number you choose out of fear or by copying someone else.\n'
           || E'Use the Ramp-Up Rate Formula to connect your fee to the income your practice needs to support and the number of clients you want to see.\n'
           || E'Join The Club within 14 days of your first registration for the free training to receive this bonus with your enrollment. (Does not carry NBCC credit.)\n'),
         updated_at = now()
   WHERE slug = 'the-club'
     AND description LIKE '%FAST ACTION BONUS: The Ramp-Up Rate Pricing Formula%';
END
$m215$;

-- =============================================================================
-- SWITCHES (run by hand, after live verification; none of these run here).
--
-- Turn C1-C3 ON (and the Club sequence's same-day skip with them):
--   UPDATE email_sequences SET status = 'active', updated_at = now()
--    WHERE slug = 'club-bonus-reminders';
-- Turn them OFF again:
--   UPDATE email_sequences SET status = 'draft', updated_at = now()
--    WHERE slug = 'club-bonus-reminders';
--
-- EXISTING REGISTRANTS (rule 'legacy_pending', deadline_at NULL). Pick one:
--  (a) the plain rule (some are already past it):
--   UPDATE club_bonus_windows
--      SET deadline_at = ((((first_registered_at AT TIME ZONE 'America/Los_Angeles')::date + 15)::timestamp
--                          AT TIME ZONE 'America/Los_Angeles') - interval '1 millisecond'),
--          rule = 'legacy_plain', updated_at = now()
--    WHERE rule = 'legacy_pending';
--  (b) 14 days from go-live (everyone gets a fresh window from launch day):
--   UPDATE club_bonus_windows
--      SET deadline_at = (((((SELECT (value->>'goLiveAt')::timestamptz FROM settings WHERE key='club_bonus')
--                            AT TIME ZONE 'America/Los_Angeles')::date + 15)::timestamp
--                          AT TIME ZONE 'America/Los_Angeles') - interval '1 millisecond'),
--          rule = 'legacy_go_live', updated_at = now()
--    WHERE rule = 'legacy_pending';
--  (c) leave them undecided but stop including the bonus on their purchases:
--   UPDATE settings SET value = value || '{"legacyPendingGetsBonus": false}'::jsonb
--    WHERE key = 'club_bonus';
-- =============================================================================
