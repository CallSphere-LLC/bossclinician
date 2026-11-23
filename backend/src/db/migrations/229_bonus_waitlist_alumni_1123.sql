-- =============================================================================
-- 229: Yvette's answers 23 Nov 2026 (email 7:25 PM PST 22 Nov), items 2, 6, 7.
--
-- Item 2: "murosn@nv.ccsd.net ... is a real person who registered for the free
--   training leading into The Club, but she opted out of emails. Please remove
--   the test-account designation and keep her unsubscribed from marketing
--   emails. Her original bonus window would end November 28. Please do not
--   restart or extend it."
--   Her window (first_registered_at 14 Nov 2026 04:44 PST) goes back to rule
--   'first_registration' with the deadline computed from that first
--   registration: 28 Nov 2026 11:59:59 p.m. Pacific (the same formula as
--   clubBonusDeadline.bonusDeadlineFor: 14 calendar days, end of day PT).
--   Her address leaves settings.club_bonus.excludedEmails. Her marketing status
--   stays 'opted_out' and her email_suppressions row stays: the mail provider
--   blocks any marketing send (C1-C3 included) to her on both counts.
-- Item 6: VIP waitlist notice subject "A seat just opened inside The Lounge VIP"
--   and a first come, first served / not reserved line. The subject was the
--   only thing migration 222 held it for, so the sequence is switched ON.
-- Item 7: Yvette's own address leaves the retreat alumni sequence. New
--   settings.retreat_alumni.excludedEmails (services/retreatAlumni.ts); her
--   product-70 grant and dashboard access are not touched; no subscription
--   existed (checked 22 Nov 2026), any is ended below anyway.
-- Idempotent.
-- =============================================================================

-- Item 2
UPDATE club_bonus_windows
   SET rule = 'first_registration',
       deadline_at = ((((first_registered_at AT TIME ZONE 'America/Los_Angeles')::date + 15)::timestamp
                        AT TIME ZONE 'America/Los_Angeles') - interval '1 millisecond'),
       updated_at = now()
 WHERE lower(email) = 'murosn@nv.ccsd.net' AND rule = 'test_excluded';

UPDATE settings
   SET value = jsonb_set(value, '{excludedEmails}',
         COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text(value->'excludedEmails') e
                    WHERE lower(e) <> 'murosn@nv.ccsd.net'), '[]'::jsonb)),
       updated_at = now()
 WHERE key = 'club_bonus' AND jsonb_typeof(value->'excludedEmails') = 'array';

-- Item 6
UPDATE sequence_emails e
   SET subject = 'A seat just opened inside The Lounge VIP',
       preview_text = 'First come, first served: this email does not reserve the seat.',
       body_md = replace(e.body_md,
         '{{lounge_vip_availability_block}}</span></p>',
         '{{lounge_vip_availability_block}}</span></p><p style="line-height: 1.38;"><span style="font-size: 11pt; color: rgb(0, 0, 0); background-color: transparent;">Seats are first come, first served. Receiving this email does not reserve a seat for you; the seat goes to the first person who completes enrollment.</span></p>'),
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id AND s.slug = 'lounge-vip-seat-open' AND e.position = 1
   AND position('first come, first served' in e.body_md) = 0;

UPDATE email_sequences SET status = 'active', updated_at = now()
 WHERE slug = 'lounge-vip-seat-open' AND status = 'draft';

-- Item 7
INSERT INTO settings (key, value)
VALUES ('retreat_alumni', '{"excludedEmails": ["yvette@bossclinician.com"]}'::jsonb)
ON CONFLICT (key) DO UPDATE
   SET value = jsonb_set(COALESCE(settings.value, '{}'::jsonb), '{excludedEmails}',
         (SELECT jsonb_agg(DISTINCT e) FROM (
            SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(settings.value->'excludedEmails') = 'array'
                                                  THEN settings.value->'excludedEmails' ELSE '[]'::jsonb END) e
            UNION SELECT 'yvette@bossclinician.com') x)),
       updated_at = now();

UPDATE sequence_subscriptions ss
   SET status = 'exited', updated_at = now()
  FROM email_sequences s, contacts c
 WHERE s.id = ss.sequence_id AND s.slug = 'retreat-alumni'
   AND c.id = ss.contact_id AND lower(c.email::text) = 'yvette@bossclinician.com'
   AND ss.status = 'active';
