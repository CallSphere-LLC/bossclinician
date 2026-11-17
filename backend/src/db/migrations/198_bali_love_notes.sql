-- =============================================================================
-- 198 — Bali 2027 retreat "Love Notes" carried over from Kajabi (QA sheet row 231)
--
-- Yvette: "In Kajabi I have it set up for retreat recipients to receive emails ...
-- a broadcast sent to each customer 1x a month up to the time of the trip ...
-- the broadcast sequence is labeled as 'love note'."
--
-- What Kajabi had (folder "Retreat Email Broadcast Leading to Bali", all from
-- yvette@kjbm.bossclinician.com, audience = tag "Bali 2027 Attendee"):
--   Note 1  Aug 15 2026  sent (4)        -> imported row, read only
--   Note 2  Sep 15 2026  sent (4)        -> imported row, read only
--   Note 3  Oct 15 2026  scheduled in Kajabi (Kajabi was still live then)
--   Note 4  Nov 15 2026  scheduled in Kajabi (Kajabi was still live then)
--   Note 5  Dec 15 2026  scheduled in Kajabi   |
--   Note 6  Jan 15 2027  scheduled in Kajabi   |  Kajabi closes Nov 23 2026, so
--   Note 7  Feb 15 2027  scheduled in Kajabi   |  these never go unless we send them
--   Note 8  Apr 15 2027  scheduled in Kajabi   |
-- Trip: arrive Jun 15 2027, depart Jun 20 2027 (final balance due Jun 8).
--
-- Why dated broadcasts to the tag, not a sequence: every note is written to the
-- calendar ("Happy New Year", "halfway", "4 months. Have you booked?"), so a
-- per-person delay would send a January buyer "10 months until Bali". A
-- broadcast resolves its audience when it goes out, so anyone tagged by then
-- gets that month's note and nobody is ever sent an earlier one again.
--
-- This migration:
--   1. Adds Notes 5-8 as NEW, editable campaigns (the imported rows 1383-1386
--      are read-only history and are left untouched), audience = the tag only,
--      send time pre-filled with Kajabi's exact moment, status 'draft'. Nothing
--      sends until someone presses Schedule on each one (or the parent runs the
--      arming UPDATE in the release notes). tickBroadcasts() only picks up
--      status = 'scheduled'.
--   2. Turns on the two imported automations "Bali Shared/Private Room is
--      purchased -> add tag Bali 2027 Attendee", so new buyers are on the list.
--      Their only step adds a tag; they send nothing. Only if they are still
--      exactly as imported (paused, never edited since 2026-10-06), so a re-run
--      never undoes an owner's later choice.
--
-- Fail-closed: no tag -> nothing inserted; `audience` is a key with no
-- predicate, so if the tag list is ever emptied the send refuses ("Nobody in
-- that audience") instead of falling through to the whole list.
-- Idempotent: each insert is guarded by name. A fresh/CI database is a no-op:
-- it has the tag (012 seeds it) but none of the imported Kajabi broadcasts or
-- automations each step requires.
-- Bodies: Kajabi's import kept Word markup ("<o:p> </o:p>") and escaped
-- "\[ link \]" brackets, which the markdown renderer would print literally;
-- they are cleaned here, wording unchanged.
-- =============================================================================

DO $migration$
DECLARE
  bali_tag integer;
BEGIN
  SELECT id INTO bali_tag FROM tags WHERE slug = 'bali-2027-attendee';
  IF bali_tag IS NULL THEN
    RAISE NOTICE '198: tag bali-2027-attendee not found; nothing to do';
    RETURN;
  END IF;

  -- Tue 15 Dec 2026 6:00 PM PST (Kajabi broadcast, imported as campaign 1386)
  INSERT INTO email_campaigns
    (name, subject, body_md, audience, include_tag_ids, status, scheduled_at,
     timezone, folder, topic, anchor_kind, from_name, from_email)
  SELECT
    $name$Bali Love Note 5 — December (6 months)$name$,
    $subj$Hey Flourisher, we are halfway to Bali$subj$,
    $lovenote$Hey Flourisher,

Six months. We are officially halfway there.

I know December asks a lot of you. The clients navigating hard holidays. The family gatherings you are holding together. The year-end everything. So this love note is short on tasks and long on permission.

Rest where you can this month. Say no to one thing. Let something be imperfect. Consider it your Bali training.

Two housekeeping notes:

– **Payment Plan Closing:** For any friends or colleagues still thinking about joining us, the monthly payment plan closes January 31, 2027. After that, registration is pay in full only. If you know a woman who needs this retreat, now is the time to send her my way.

– **Flight Booking Opens Soon:** Next month is officially flight booking season. My full guide with routes, timing, and tips lands in your inbox in January.

Merry everything, Flourisher. The next time we hit a milestone, it will be single digits.

With so much love,

Yvette Howard, LCSW

Private Practice Strategist | Boss Clinician | FlourisHealer$lovenote$,
    'bali_2027_attendee_tag', ARRAY[bali_tag], 'draft', timestamptz '2026-12-16 02:00:00+00',
    'America/Los_Angeles', 'Retreat Email Broadcast Leading to Bali', 'marketing',
    'absolute', '', ''
  -- Only where that Kajabi broadcast was imported (production); a fresh or CI
  -- database also has the tag (seeded by 012) but never these rows.
  WHERE EXISTS (SELECT 1 FROM email_campaigns WHERE kajabi_id = 32265294)
    AND NOT EXISTS (
    SELECT 1 FROM email_campaigns WHERE name = $name$Bali Love Note 5 — December (6 months)$name$
  );

  -- Fri 15 Jan 2027 6:00 PM PST (Kajabi broadcast, imported as campaign 1385)
  INSERT INTO email_campaigns
    (name, subject, body_md, audience, include_tag_ids, status, scheduled_at,
     timezone, folder, topic, anchor_kind, from_name, from_email)
  SELECT
    $name$Bali Love Note 6 — January (5 months)$name$,
    $subj$Hey Flourisher, it is officially flight booking season$subj$,
    $lovenote$Hey Flourisher,

Happy New Year. This is the year you go to Bali. And January through March is the sweet spot for booking international flights for June, so it is officially time.

– **Airport:** I Gusti Ngurah Rai International Airport (DPS), Bali, Indonesia

– **Arrive:** June 15, 2027. Aim to land by mid afternoon so you arrive in time for our welcome dinner. Our luxury shuttle picks you up.

– **Depart:** June 20, 2027

– **Important:** Bali is on the other side of the world. You will likely depart the US on June 13 or 14 to land on the 15th. Triple check the arrival date before you book.

– **Tips:** Set price alerts on Google Flights now. Most routes connect through Taipei, Seoul, Tokyo, Singapore, or Doha. Consider a buffer day if your connections are tight.

Once you book, submit your flight details in my Flight Tracker so I can coordinate your airport pickup: **[FLIGHT TRACKER](https://form.jotform.com/262157915507057)**

One more note. The monthly payment plan for new registrations closes January 31. If you have a friend on the fence, this is her final call.

It is getting real, Flourisher.

With so much love,

Yvette Howard, LCSW

Private Practice Strategist | Boss Clinician | FlourisHealer$lovenote$,
    'bali_2027_attendee_tag', ARRAY[bali_tag], 'draft', timestamptz '2027-01-16 02:00:00+00',
    'America/Los_Angeles', 'Retreat Email Broadcast Leading to Bali', 'marketing',
    'absolute', '', ''
  -- Only where that Kajabi broadcast was imported (production); a fresh or CI
  -- database also has the tag (seeded by 012) but never these rows.
  WHERE EXISTS (SELECT 1 FROM email_campaigns WHERE kajabi_id = 32265307)
    AND NOT EXISTS (
    SELECT 1 FROM email_campaigns WHERE name = $name$Bali Love Note 6 — January (5 months)$name$
  );

  -- Mon 15 Feb 2027 6:00 PM PST (Kajabi broadcast, imported as campaign 1384)
  INSERT INTO email_campaigns
    (name, subject, body_md, audience, include_tag_ids, status, scheduled_at,
     timezone, folder, topic, anchor_kind, from_name, from_email)
  SELECT
    $name$Bali Love Note 7 — February (4 months)$name$,
    $subj$Hey Flourisher, 4 months. Have you booked?$subj$,
    $lovenote$Hey Flourisher,

Four months away. This is a love note with a loving push.

– **Flights:** If you have booked, submit your details in the Flight Tracker today so your airport pickup is arranged: **[FLIGHT TRACKER](https://form.jotform.com/262157915507057)**. If you have not booked, prices for June typically start climbing from here. This month is your window.

– **Travel Insurance:** Final call. If you are flying across the world, protect the investment. Trawick International at trawickinternational.com.

– **Payments:** Keep your plan on track. Your final balance is due June 8, and staying current now keeps that deadline stress free.

Everything else is handled. The villa is secured. The chef is planning. The experiences are booked. All you have to do is get yourself on the plane and I will take it from there.

With so much love,

Yvette Howard, LCSW

Private Practice Strategist | Boss Clinician | FlourisHealer$lovenote$,
    'bali_2027_attendee_tag', ARRAY[bali_tag], 'draft', timestamptz '2027-02-16 02:00:00+00',
    'America/Los_Angeles', 'Retreat Email Broadcast Leading to Bali', 'marketing',
    'absolute', '', ''
  -- Only where that Kajabi broadcast was imported (production); a fresh or CI
  -- database also has the tag (seeded by 012) but never these rows.
  WHERE EXISTS (SELECT 1 FROM email_campaigns WHERE kajabi_id = 32265415)
    AND NOT EXISTS (
    SELECT 1 FROM email_campaigns WHERE name = $name$Bali Love Note 7 — February (4 months)$name$
  );

  -- Thu 15 Apr 2027 6:00 PM PDT (Kajabi broadcast, imported as campaign 1383)
  INSERT INTO email_campaigns
    (name, subject, body_md, audience, include_tag_ids, status, scheduled_at,
     timezone, folder, topic, anchor_kind, from_name, from_email)
  SELECT
    $name$Bali Love Note 8 — April (2 months)$name$,
    $subj$Hey Flourisher, 2 months. Final stretch checklist$subj$,
    $lovenote$Hey Flourisher,

Two months, Flourisher. TWO MONTHS.

Here is your final stretch checklist:

– **Final Payment:** All balances must be paid in full by June 8, 2027. Log in this month and confirm your remaining payments will complete by then. If anything looks off, reply to this email now. I am always easier to talk to before a deadline than after one.

– **Flight Details:** If your itinerary is not in the Flight Tracker yet, this is the month. Airport pickups are being scheduled: **[Flight Tracker](https://form.jotform.com/262157915507057)**

– **Packing Preview:** Your full packing list arrives in May. For now, two fun assignments. Find one bright, colorful outfit for our photo dinner. And make sure you have a swimsuit you feel amazing in. Two infinity pools and a beach day are waiting.

– **Phone Plan:** Look into your carrier's international options or grab an eSIM like **[Holafly](https://esim.holafly.com/?tw_source=google&tw_adid=792870720165&tw_campaign=23459038719&utm_source=google&utm_medium=cpc&utm_id=23459038719&cq_src=google_ads&cq_cmp=23459038719&cq_term=holafly&cq_plac=&cq_net=g&cq_plt=gp&utm_campaign=HLF-B2C_GOO_AME_USA_EN_SEA_BRA_PURE_PURCH_PULL_PROSP_AO_ADM&utm_adgroup=GOO_AME_USA_EN_SEA_BRA_PURE_NA_NA_NA_NA_PURE_PURCH_PULL_PROSP_AO&gad_source=1&gad_campaignid=23459038719&gbraid=0AAAAACm4AmF9yCcS1gZtKd7N46P2-Nfam&gclid=Cj0KCQjwm8bTBhDWARIsAC9Hi8kJ6ge7TmIvL_qS5bZ7lzmxm-H8FhFZda5bFyRevQ-vIgsqkja94GsaAoykEALw_wcB)** before you fly.

The countdown is in single digits of weeks now. Almost time to exhale.

With so much love,

Yvette Howard, LCSW

Private Practice Strategist | Boss Clinician | FlourisHealer$lovenote$,
    'bali_2027_attendee_tag', ARRAY[bali_tag], 'draft', timestamptz '2027-04-16 01:00:00+00',
    'America/Los_Angeles', 'Retreat Email Broadcast Leading to Bali', 'marketing',
    'absolute', '', ''
  -- Only where that Kajabi broadcast was imported (production); a fresh or CI
  -- database also has the tag (seeded by 012) but never these rows.
  WHERE EXISTS (SELECT 1 FROM email_campaigns WHERE kajabi_id = 32265495)
    AND NOT EXISTS (
    SELECT 1 FROM email_campaigns WHERE name = $name$Bali Love Note 8 — April (2 months)$name$
  );

  -- New buyers -> tag. Steps add the tag only; checked so a later edit wins.
  UPDATE automations a
     SET status = 'active', updated_at = now()
   WHERE a.source = 'kajabi'
     AND a.kajabi_id IN (2155583012, 2155583013)
     AND a.trigger_type = 'offer_purchased'
     AND a.status = 'paused'
     AND a.run_count = 0
     AND a.updated_at < timestamptz '2026-11-01 00:00:00+00'
     AND EXISTS (
       SELECT 1 FROM offers o
        WHERE o.id = (a.trigger_config->>'offerId')::int
          AND o.slug IN ('bali-shared-room', 'bali-private-room')
     )
     AND NOT EXISTS (
       SELECT 1 FROM automation_actions x
        WHERE x.automation_id = a.id
          AND NOT (x.action_type = 'add_tag' AND (x.config->>'tagId')::int = bali_tag)
     )
     AND EXISTS (SELECT 1 FROM automation_actions x WHERE x.automation_id = a.id);
END
$migration$;
