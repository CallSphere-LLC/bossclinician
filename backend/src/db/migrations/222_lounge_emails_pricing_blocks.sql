-- =============================================================================
-- 222: Lounge masterclass Emails 11-12, founding pricing blocks, VIP waitlist
--      notice, LOUNGE26 off (Yvette's answers 22 Nov 2026, round 2, item 3;
--      her revised doc "lounge-emails-revised", TEAM IMPLEMENTATION NOTES).
--      Code: services/loungeSeats.ts (LOUNGE_BLOCKS, loungeMergeValues),
--      services/emailSendGuard.ts, services/loungeWaitlist.ts.
--
-- A. Sequence 488 'maxed-out-masterclass', Emails 11 and 12: her revised
--    wording, word for word, in the existing rich-email markup. Each carries
--    {{lounge_general_pricing_block}} and {{lounge_vip_availability_block}},
--    filled at send time, each tier on its own, from lounge_seats (exact block
--    texts in loungeSeats.ts LOUNGE_BLOCKS). Email 12 gets her evergreen
--    subject and preview, and loses the "skip once General founding fills"
--    rule (the new wording is true in every state). Emails 1-10 and 13-14
--    already match her doc and are not touched. `enabled` is NOT changed:
--    Emails 11-12 stay OFF. Each UPDATE runs only while the email still holds
--    the exact body it had on 22 Nov 2026 (md5), so a re-run or a later edit
--    in Admin is never overwritten.
-- B. Coupon LOUNGE26 (id 13, $1,995 off, used once: order 201, the owner's
--    own $2 test, 8 Nov 2026) is switched off. Order 201 was never counted
--    (lounge_seats is empty on 22 Nov 2026), and from now on an order that
--    used LOUNGE26 never takes a founding place (loungeSeats.TEST_COUPON_CODES).
-- C. VIP waitlist notice, SHIPPED OFF: sequence 'lounge-vip-seat-open' (DRAFT,
--    one email) and the 10-minute job 'lounge-vip-waitlist-notify', which
--    only records openings in lounge_vip_openings while the sequence is a
--    draft. Nobody is enrolled or emailed by this migration.
--
-- SWITCH ON (parent, after testing):
--   Emails 11-12:
--     UPDATE sequence_emails e SET enabled = true, updated_at = now()
--       FROM email_sequences s
--      WHERE s.id = e.sequence_id AND s.slug = 'maxed-out-masterclass' AND e.position IN (11, 12)
--        AND e.body_md LIKE '%{{lounge_general_pricing_block}}%'
--        AND e.body_md LIKE '%{{lounge_vip_availability_block}}%';
--   (expect UPDATE 2; anything else means a body was not replaced: check before sending)
--   VIP waitlist notice (needs Yvette's OK on its subject):
--     UPDATE email_sequences SET status = 'active', updated_at = now() WHERE slug = 'lounge-vip-seat-open';
--
-- ROLLBACK NOTE: code older than this migration has no handler for the job
-- kind 'loungeVip.waitlistNotify'. If the code is rolled back, run:
--   UPDATE job_schedules SET enabled = false WHERE name = 'lounge-vip-waitlist-notify';
--
-- Idempotent; safe to re-run.
-- =============================================================================

-- A. Emails 11-12 ------------------------------------------------------------

-- Email 11 (id 1655 on live). Was: the price paragraph {{lounge.memberRate}}
-- and the button "👉 Review the options and join The Lounge".
UPDATE sequence_emails e
   SET body_md = $b11$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’ve thought about the trip. Maybe you’ve even checked the dates.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Then you start calculating the sessions you’d miss and close the tab.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside The Lounge, we can turn “I need a break” into a goal you can plan around: five business days without routine billing, inbox checks, or scheduled sessions.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">The PTO income calculator helps you work through the money to set aside. The systems resources and coaching help you plan how necessary tasks and client coverage will be handled.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">That’s how we begin working toward time off that feels like time off.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">{{lounge_general_pricing_block}}</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">{{lounge_vip_availability_block}}</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Monthly plans have a six-month minimum commitment, then continue month-to-month unless canceled. Annual prices cover one year.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Founding members keep their original rate while continuously enrolled on the same plan.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If the support fits what you need, this is your invitation to start building your plan.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review current options and availability</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$b11$,
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id AND s.slug = 'maxed-out-masterclass' AND e.position = 11
   AND md5(e.body_md) = '579c545ffea76417d7b7ce1cb4c51861';

-- Email 12 (id 1656 on live). Was: subject "Before the Lounge founding rate changes", preview
-- "Choose support for the practice you want to keep running.", a founding-
-- only body, skip rule {"loungeFoundingFullTiers":["general"]}.
UPDATE sequence_emails e
   SET subject = $s12$What would you like your practice to make room for?$s12$,
       preview_text = $p12$Review the current Lounge options and choose support for your next decision.$p12$,
       body_md = $b12$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Maybe it’s an afternoon without appointments. A vacation you can plan for. Or knowing what you can pay yourself without checking the account and hoping.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">You’ve built a practice. Now you want it to support more of your life.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Inside The Lounge, we use your numbers, The Practice Elevation resources, and monthly Strategy Sessions to work through the decisions that can move you toward that goal.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Can you reduce two weekly sessions and still support your planned owner pay? Which panel deserves a closer look? What needs to change before you stop working through lunch?</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Those questions deserve attention specific to your practice.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Here are the current membership options:</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">{{lounge_general_pricing_block}}</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">{{lounge_vip_availability_block}}</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Monthly plans have a six-month minimum commitment, then continue month-to-month unless canceled. Annual prices cover one year.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Founding members keep their original rate while continuously enrolled on the same plan. Founding availability is based on paid enrollments, not a calendar deadline.</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">If you want help turning those questions into a plan, I’d love to work with you.</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review current options and availability</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$b12$,
       skip_rules = COALESCE(e.skip_rules, '{}'::jsonb) - 'loungeFoundingFullTiers',
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id AND s.slug = 'maxed-out-masterclass' AND e.position = 12
   AND md5(e.body_md) = '91ccd55f0dcc3c61576f80f5ae9fdfba';

-- Email 11's subject and preview already are her evergreen ones; set only if different.
UPDATE sequence_emails e
   SET subject = $s11$What would you need to take five workdays off?$s11$, preview_text = $p11$Let’s put a real plan behind the vacation you keep postponing.$p11$, updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id AND s.slug = 'maxed-out-masterclass' AND e.position = 11
   AND (e.subject IS DISTINCT FROM $s11$What would you need to take five workdays off?$s11$ OR e.preview_text IS DISTINCT FROM $p11$Let’s put a real plan behind the vacation you keep postponing.$p11$)
   AND e.body_md LIKE '%{{lounge_general_pricing_block}}%';

UPDATE email_sequences
   SET description = replace(description,
         'Emails 11-12 (founding rate, by paid seat count since 22 Nov) are built but OFF until the owner approves the wording; 12 skips itself once the 20 founding Lounge Member places are filled.',
         'Emails 11-12 (her revised wording of 22 Nov, round 2) carry a General and a VIP pricing block, each chosen at send time from the paid seat count (migration 222); they are built but OFF until switched on after testing.'),
       updated_at = now()
 WHERE slug = 'maxed-out-masterclass'
   AND description LIKE '%12 skips itself once the 20 founding Lounge Member places are filled.%';

-- B. LOUNGE26 off ---------------------------------------------------------------
-- The offer checkout refuses an inactive code (services/coupons.ts), and the
-- course checkout only takes active, global codes (LOUNGE26 is offer-scoped).
-- Its Stripe coupon object is left untouched; the site applies a code only
-- after finding it active here.
UPDATE coupons SET active = false WHERE upper(code::text) = 'LOUNGE26' AND active;

-- C. VIP waitlist notice (OFF) ----------------------------------------------------

CREATE TABLE IF NOT EXISTS lounge_vip_openings (
  id            serial PRIMARY KEY,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  active_seats  integer NOT NULL DEFAULT 0,
  -- Set once, when the waitlist is told about this opening (sequence active).
  notified_at   timestamptz,
  waitlisted    integer NOT NULL DEFAULT 0,
  enrolled      integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS lounge_vip_openings_one_open ON lounge_vip_openings ((true)) WHERE closed_at IS NULL;

INSERT INTO email_sequences
  (name, slug, description, status, topic, skip_weekends,
   send_window_start_minute, send_window_end_minute, use_contact_timezone, timezone,
   exit_on_purchase, allow_reentry, send_at_minute, folder)
SELECT 'Lounge VIP - Seat Available (Waitlist)', 'lounge-vip-seat-open',
       'Migration 222 (Yvette 22 Nov 2026, item 3: "Notify waitlisted subscribers when a seat opens; no reserved priority period"). When a VIP seat opens after the six founding places are used, everyone tagged Lounge VIP Waitlist who is not a current VIP member is enrolled once per opening by the job lounge-vip-waitlist-notify. The email states VIP availability as it is when sent ({{lounge_vip_availability_block}}). DRAFT = OFF: nobody is enrolled while this is not active.',
       'draft', 'marketing', false,
       NULL, NULL, false, 'America/Los_Angeles',
       false, true, NULL, ''
 WHERE NOT EXISTS (SELECT 1 FROM email_sequences WHERE slug = 'lounge-vip-seat-open');

INSERT INTO sequence_emails
  (sequence_id, position, delay_minutes, subject, preview_text, topic, skip_rules, body_md, enabled)
SELECT s.id, 1, 0, $sn$A Lounge VIP seat has opened$sn$, '', NULL,
       jsonb_build_object('ownsOfferIds', COALESCE((SELECT jsonb_agg(o.id) FROM offers o WHERE o.slug = 'the-lounge-vip'), '[]'::jsonb)),
       $bn$<!--bc:rich-email--><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Hey {{first_name}},</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">{{lounge_vip_availability_block}}</span></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;"><b>Review current options and availability</b></span></a></p><p style="line-height: 1.38;"><a href="https://www.bossclinician.com/lounge"><span style="font-size: 11pt; color: rgb(17, 85, 204); background-color: transparent;">https://www.bossclinician.com/lounge</span></a></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">To Your Success!</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Yvette Howard, LCSW</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Private Practice Strategist | Boss Clinician, LLC</span></p><p><br></p>$bn$,
       true
  FROM email_sequences s
 WHERE s.slug = 'lounge-vip-seat-open'
   AND NOT EXISTS (SELECT 1 FROM sequence_emails e WHERE e.sequence_id = s.id);

INSERT INTO job_schedules (name, kind, every_minutes, timezone, enabled)
VALUES ('lounge-vip-waitlist-notify', 'loungeVip.waitlistNotify', 10, 'America/Los_Angeles', true)
ON CONFLICT (name) DO NOTHING;
