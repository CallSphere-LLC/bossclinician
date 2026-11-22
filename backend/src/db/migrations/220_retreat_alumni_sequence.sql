-- =============================================================================
-- 220: Post-retreat alumni email sequence (sheet row 249, Yvette's item 12)
--
-- "Please add this as an email sequence for those who purchase the retreat.
-- The emails are general so that I can use them for all future retreats."
--
-- Four emails, word for word from "FlourisHealer - Four Post-Retreat Alumni
-- Emails", sent Day +3, +7, +14 and +21 after EACH retreat's END DATE at
-- 9:00 a.m. in the retreat's own time zone (owner-approved schedule of
-- 22 Nov 2026; Bali 15-20 Jun 2027 -> 23 Jun, 27 Jun, 4 Jul, 11 Jul 2027).
-- Source text: services/retreatAlumniEmails.ts (a test pins the two together).
--
-- Engine support, additive (NULL everywhere = exactly the old behaviour):
--   email_sequences.anchor_kind          'retreat_end' or NULL (classic delays)
--   sequence_emails.anchor_offset_days   days after the anchor date
--   sequence_emails.topic                per-email preference topic; NULL = the
--                                        sequence's. '' = relationship mail
--                                        (only a full unsubscribe, bounce or
--                                        complaint stops it)
--   sequence_subscriptions.anchor_retreat_id  which retreat a run is timed from
--
-- New, owned by this feature:
--   retreat_alumni_settings   per retreat: the Email 4 "what's next" link (blank
--                             = Email 4 is HELD), the featured retreat whose
--                             buyers do not get Email 4 (visible "Join Us Again"
--                             cards with a booked_product_id count too), an on/off per retreat
--   retreat_alumni_enrolments one row per (retreat, guest) ever enrolled, so a
--                             guest is never put through the same retreat twice
--   job_schedules 'retreat-alumni-enrol'  hourly enrolment sweep
--
-- EVERYTHING SHIPS OFF: the sequence is 'draft' (enrollContact refuses a draft
-- sequence and the tick never sends one) and the enrolment job is disabled.
-- Nobody is enrolled by this migration. The existing attendee automation
-- (Retreat Deposit sequence 493, tag automations 1350/1351) and the Bali Love
-- Note campaigns 1433-1436 are not touched.
--
-- Switch on (after Yvette approves the preview):
--   UPDATE retreat_alumni_settings SET next_url = 'https://...', updated_at = now()
--    WHERE retreat_id = (SELECT id FROM retreats WHERE slug = 'bali-2027');
--   UPDATE email_sequences SET status = 'active', updated_at = now()
--    WHERE slug = 'retreat-alumni';
--   UPDATE job_schedules SET enabled = true, next_run_at = now(), updated_at = now()
--    WHERE name = 'retreat-alumni-enrol';
--
-- Depends on migrations 218 (retreats) and 219 (retreat_feedback, retreat_interest,
-- retreat_offer_cards).
-- Idempotent; safe to re-run.
-- =============================================================================

-- 1. Engine columns ----------------------------------------------------------

ALTER TABLE email_sequences
  ADD COLUMN IF NOT EXISTS anchor_kind TEXT
    CHECK (anchor_kind IS NULL OR anchor_kind IN ('retreat_end'));
COMMENT ON COLUMN email_sequences.anchor_kind IS
  'NULL: each email''s delay counts from the previous one. retreat_end: each email goes anchor_offset_days after the run''s retreat end date, at send_at_minute in the retreat''s time zone.';

ALTER TABLE sequence_emails
  ADD COLUMN IF NOT EXISTS anchor_offset_days INT
    CHECK (anchor_offset_days IS NULL OR anchor_offset_days BETWEEN -365 AND 365);
COMMENT ON COLUMN sequence_emails.anchor_offset_days IS
  'For an anchored sequence: days after the anchor date (retreat end) this email goes. Ignored otherwise.';

ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS topic TEXT;
COMMENT ON COLUMN sequence_emails.topic IS
  'Preference topic for this email. NULL: the sequence''s topic. Empty: relationship mail, stopped only by a full unsubscribe, bounce or complaint.';

ALTER TABLE sequence_subscriptions ADD COLUMN IF NOT EXISTS anchor_retreat_id INT;
COMMENT ON COLUMN sequence_subscriptions.anchor_retreat_id IS
  'For an anchored sequence: the retreat whose end date times this run.';

CREATE INDEX IF NOT EXISTS idx_sequence_subs_anchor_retreat
  ON sequence_subscriptions (anchor_retreat_id) WHERE anchor_retreat_id IS NOT NULL;

-- 2. Retreat-dependent pieces (need migration 218's retreats table) ----------

DO $m220$
BEGIN
  IF to_regclass('public.retreats') IS NULL THEN
    RAISE NOTICE '220: retreats table not found (migration 218); retreat pieces skipped';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sequence_subscriptions_anchor_retreat_fk') THEN
    ALTER TABLE sequence_subscriptions
      ADD CONSTRAINT sequence_subscriptions_anchor_retreat_fk
      FOREIGN KEY (anchor_retreat_id) REFERENCES retreats(id) ON DELETE SET NULL;
  END IF;

  CREATE TABLE IF NOT EXISTS retreat_alumni_settings (
    retreat_id          INT PRIMARY KEY REFERENCES retreats(id) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    -- Email 4's button. Must be an https link to an approved live offer or
    -- interest page; blank holds Email 4 (up to 3 days, then it is skipped).
    next_url            TEXT NOT NULL DEFAULT '',
    -- Guests who already hold access to this retreat's product get no Email 4.
    featured_retreat_id INT REFERENCES retreats(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS retreat_alumni_enrolments (
    retreat_id      INT NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
    contact_id      INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    sequence_id     INT NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
    subscription_id BIGINT REFERENCES sequence_subscriptions(id) ON DELETE SET NULL,
    source_offer_id INT REFERENCES offers(id) ON DELETE SET NULL,
    source_order_id INT REFERENCES orders(id) ON DELETE SET NULL,
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (retreat_id, contact_id)
  );

  -- Bali gets its settings row now (blank link = Email 4 held). A retreat with
  -- no row is enabled with no Email 4 link.
  INSERT INTO retreat_alumni_settings (retreat_id)
  SELECT r.id FROM retreats r WHERE r.slug = 'bali-2027'
  ON CONFLICT (retreat_id) DO NOTHING;
END
$m220$;

-- 3. The sequence, as a DRAFT ------------------------------------------------

INSERT INTO email_sequences
  (name, slug, description, status, topic, skip_weekends,
   send_window_start_minute, send_window_end_minute, use_contact_timezone, timezone,
   exit_on_purchase, allow_reentry, send_at_minute, anchor_kind, folder)
SELECT 'Retreat Alumni - Post-Retreat Emails', 'retreat-alumni',
       'Owner document of 22 Nov 2026 (sheet row 249). For every retreat: Day +3, +7, +14, +21 after the retreat END DATE, 9:00 a.m. in the retreat''s time zone. Guests are enrolled by the hourly retreat-alumni-enrol job from the retreat''s end date: anybody holding active, unrefunded access to the retreat''s booking product (retreats.booking_product_id; Bali: product 70). A refund or revoke ends the run. Email 2 is skipped once feedback is in, Email 3 once interest is given, Emails 3-4 for anybody who declined invitations, Email 4 for buyers of the featured retreat; Email 4 waits for its link (retreat_alumni_settings.next_url). Timing lives in anchor_offset_days, not the wait shown per email.',
       'draft', 'marketing', false,
       NULL, NULL, false, 'America/Los_Angeles',
       false, true, 540, 'retreat_end', 'Retreats'
 WHERE NOT EXISTS (SELECT 1 FROM email_sequences s WHERE s.slug = 'retreat-alumni');

INSERT INTO sequence_emails
  (sequence_id, position, anchor_offset_days, delay_minutes, subject, preview_text,
   topic, skip_rules, body_md, enabled)
SELECT s.id, v.position, v.offset_days, v.delay_minutes, v.subject, v.preview_text,
       v.topic, v.skip_rules, v.body_md, true
  FROM email_sequences s
 CROSS JOIN (VALUES
  (1, 3, 4320, $subj$We made those memories together$subj$,
   $prev$Your FlourisHealer gallery is waiting.$prev$,
   $topic$$topic$, $rules${}$rules$::jsonb,
   $body$Hey {{firstName}},

You're home, but I hope you're still carrying little moments from our time together. The laughter. The conversations that didn't need an explanation. The simple joy of being somewhere beautiful without having to be everything for everyone.

Thank you for choosing to experience FlourisHealer with us. It means so much that you made room for yourself and trusted us to be part of that time.

I created a private space for our retreat memories. You can view the photos and videos, upload your own favorites, and revisit the moments that made you smile.

[OPEN OUR RETREAT MEMORIES]({{retreatMemoriesUrl}} "button")

You're welcome to share the pictures you love. Please be mindful of other guests' privacy before posting images of them, and remember that the gallery is for our retreat group—not a public marketing album.

With so much love,
Yvette
FlourisHealer Retreats$body$),
  (2, 7, 5760, $subj$Can I ask you something about our retreat?$subj$,
   $prev$Your reflections will help me make the next experience even more thoughtful.$prev$,
   $topic$$topic$, $rules${"retreat":{"feedbackSubmitted":true}}$rules$::jsonb,
   $body$Hey {{firstName}},

There's something I care about just as much as the beautiful photos: how the experience actually felt for you.

What was your favorite moment? What made you feel cared for? What would you love to see us do differently? I would genuinely appreciate hearing all of it.

I've added a short, optional reflection to your FlourisHealer dashboard. You can share your feedback privately, and if you ever want to share a public testimonial, there's a separate choice for that. No pressure to make it public.

[SHARE YOUR EXPERIENCE]({{retreatFeedbackUrl}} "button")

Thank you again for taking this journey with us. Your reflections help me build experiences that feel even more intentional for the women who come next.

With love,
Yvette$body$),
  (3, 14, 10080, $subj$Where should FlourisHealer take you next?$subj$,
   $prev$Another getaway, a domestic business retreat, or maybe both?$prev$,
   $topic$marketing$topic$, $rules${"retreat":{"interestSet":true,"marketingOptedOut":true}}$rules$::jsonb,
   $body$Hey {{firstName}},

One of my favorite parts of hosting FlourisHealer is seeing how quickly a group of women can feel connected when they finally make space to enjoy life together.

I want to keep creating those experiences—and I would love to know what would excite you next.

Would you be dreaming about another international getaway where you can simply enjoy the destination and be poured into? Or would a domestic business retreat with strategy, a content day, and meaningful connection be more your speed? Maybe both.

Inside your guest dashboard, you can tell me which experiences you'd like to hear about and choose whether to receive future invitations. No new retreat booking is required to share your preference.

[TELL ME WHAT INTERESTS YOU]({{retreatInterestUrl}} "button")

Wherever we go next, I want the experience to feel worth making time for.

With love,
Yvette$body$),
  (4, 21, 10080, $subj$It's always your turn to make room for you$subj$,
   $prev$First access to whatever FlourisHealer creates next.$prev$,
   $topic$marketing$topic$, $rules${"retreat":{"marketingOptedOut":true,"bookedFeatured":true}}$rules$::jsonb,
   $body$Hey {{firstName}},

I hope you've kept at least a little of that FlourisHealer feeling with you—the freedom to laugh, connect, rest, and enjoy yourself without explaining why you deserve it.

If you've been thinking, "I want to do something like that again," I have a place for you to hear what's coming next.

FlourisHealer will continue to offer international experiences focused on time away and meaningful connection, along with domestic business retreats designed for strategy, content creation, and community.

If we've announced a retreat that feels like your next yes, you can explore the full details and decide whether it's right for you. If dates aren't announced yet, you can join the first-access list instead.

[EXPLORE WHAT'S NEXT / JOIN FIRST ACCESS]({{retreatNextUrl}} "button")

No rush. I'm simply keeping the door open. You've already shown yourself that making space for you is possible.

With so much love,
Yvette
FlourisHealer Retreats$body$)
 ) AS v(position, offset_days, delay_minutes, subject, preview_text, topic, skip_rules, body_md)
 WHERE s.slug = 'retreat-alumni'
   AND NOT EXISTS (SELECT 1 FROM sequence_emails e WHERE e.sequence_id = s.id);

-- 4. The enrolment sweep, DISABLED -------------------------------------------

INSERT INTO job_schedules (name, kind, every_minutes, timezone, enabled)
VALUES ('retreat-alumni-enrol', 'retreatAlumni.enrol', 60, 'America/Los_Angeles', false)
ON CONFLICT (name) DO NOTHING;
