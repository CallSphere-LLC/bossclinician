-- =============================================================================
-- Contacts, side by side with Kajabi (QA sheet rows 22–27, 2026-09-28)
--
-- Four changes, all to how the People list counts and describes a person. None
-- of them touches who may be emailed: every sending gate (email/provider.ts
-- `marketingBlockReason`, services/audience.ts `MAILABLE_CONTACT_SQL`) already
-- reads "anything but subscribed or unconfirmed" as "do not send", and nothing
-- here widens that.
--
-- Same conventions as the rest of this directory: IF NOT EXISTS / ON CONFLICT
-- throughout, so running it twice is a no-op.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Team and test accounts (row 22)
--
-- Kajabi's dashboard said 415 contacts and this one said 424. The nine extra
-- rows are the people who built and tested the rebuild — signup probes, a quiz
-- run, an event registration, the QA tester's own member login. Checked against
-- the live table on 2026-09-28: they are exactly the nine contacts with no
-- Kajabi contact id (`custom_fields ? 'ID'`); every one of the 415 imported
-- Kajabi contacts has one, the owner's own row (yvette@bossclinician.com, id 4)
-- included.
--
-- They are flagged rather than deleted. Several are member logins still used to
-- test the site (meenakshimiryala29@gmail.com is the tester's), and deleting a
-- contact takes its activity with it. The list, its count, the segments, the
-- filters and Insights leave them out unless somebody asks for the "Team & test
-- accounts" segment; the contact card still opens, with a badge saying why it
-- isn't in the list.
--
-- Matched by address, not id, so a restored or re-seeded database with
-- different ids still marks the right people. The flag never affects sending.
-- -----------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.is_internal IS
  'A team or test account. Hidden from the admin People list, its counts and segments by default; never affects email sending.';

UPDATE contacts
   SET is_internal = true, updated_at = now()
 WHERE lower(email::text) IN (
         'sagarshankaranusa+signup@gmail.com',
         'sagar@callsphere.ai',
         'sagar+eventtest2@callsphere.ai',
         'sagar+quiztest@callsphere.ai',
         'sagarshankaranm@gmail.com',
         'sagar+zzdm@callsphere.ai',
         'sagar+quizr6@callsphere.ai',
         'sagar@callsphere.tech',
         'meenakshimiryala29@gmail.com'
       )
   AND NOT is_internal;

-- The default list filters on this on every page load; a partial index keeps
-- the handful of flagged rows out of the way without indexing 400 falses.
CREATE INDEX IF NOT EXISTS idx_contacts_internal ON contacts (id) WHERE is_internal;

-- -----------------------------------------------------------------------------
-- 2. Marketing opt-in confirmation, kept apart from account verification
--    (rows 26/27)
--
-- Kajabi's "Opt-in status" is the email-marketing double opt-in: did this
-- person click the confirmation link that a double opt-in form sends. The
-- rebuild was answering it from `members.email_verified_at` — whether their
-- ACCOUNT address was verified — so Paige Petersen, who bought a course and
-- signed in, read "Confirmed" here and "Unconfirmed" in Kajabi. Two different
-- questions; this column is the first one's answer and nothing else.
--
-- Set when a marketing opt-in is genuinely confirmed: an administrator
-- confirming a pending mailing-list opt-in (routes/admin/contacts.ts,
-- POST /:id/confirm-email), and a double opt-in form's confirmation link once
-- one exists (the column `form_submissions.confirmed_at` is there, but no
-- public route writes it yet).
--
-- Backfilled only from that real evidence, which today is zero rows. Every
-- imported Kajabi contact is left NULL, because Kajabi shows them Unconfirmed.
--
-- HOOK for the Kajabi confirmations: if a later export or the Kajabi API names
-- people Kajabi does show as opt-in Confirmed, set them in a one-off script,
-- never here (addresses in git are customer data):
--   UPDATE contacts SET opt_in_confirmed_at = <kajabi confirmed time>
--    WHERE lower(email::text) = <address> AND opt_in_confirmed_at IS NULL;
-- -----------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_in_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.opt_in_confirmed_at IS
  'When this person confirmed their email-marketing opt-in (double opt-in). Not the member account''s email verification, which is members.email_verified_at.';

UPDATE contacts c
   SET opt_in_confirmed_at = s.confirmed_at, updated_at = now()
  FROM (
    SELECT contact_id, MIN(confirmed_at) AS confirmed_at
      FROM form_submissions
     WHERE contact_id IS NOT NULL AND confirmed_at IS NOT NULL
     GROUP BY contact_id
  ) s
 WHERE c.id = s.contact_id
   AND c.opt_in_confirmed_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. "Never subscribed" as its own email-marketing state
--
-- Kajabi's Email Marketing column distinguishes somebody who never agreed to
-- marketing from somebody who agreed and later opted out. The rebuild could not
-- say it: its nearest value, 'unconfirmed', is inside MAILABLE_CONTACT_SQL, so
-- mapping Kajabi's never-subscribed people onto it would have started emailing
-- them. 'never_subscribed' is outside every sending gate by construction —
-- provider.ts, audience.ts and the preference centre all treat any value but
-- subscribed/unconfirmed as "do not send".
--
-- The constraint lives only in migration 012 (schema.sql does not re-declare
-- it), so replacing it here sticks.
-- -----------------------------------------------------------------------------
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_marketing_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_email_marketing_status_check
  CHECK (email_marketing_status IN
    ('subscribed', 'opted_out', 'bounced', 'complained', 'unconfirmed', 'never_subscribed'));

-- -----------------------------------------------------------------------------
-- 4. The site's own time zone (row 24)
--
-- Kajabi shows every date in the site's time zone, America/Los_Angeles, and the
-- tester — in New York — saw a purchase Kajabi dated 9:47 AM as 12:47 PM here,
-- because the admin formatted in the viewer's browser zone. No setting held the
-- site's zone: `scheduling` and `drip` are New York, and they describe coaching
-- hours and lesson release, not how the admin reads a timestamp.
--
-- Its own key, not a field on `business`: that key is written back whole by the
-- settings screen, which would drop a field it doesn't know about on the next
-- save. Keys outside the settings registry already exist (billing, footer, nav),
-- and like them this one has no screen yet — change it with SQL until it does.
-- Read by GET /admin/contacts/site-time.
-- -----------------------------------------------------------------------------
INSERT INTO settings (key, value, group_key, label, description)
VALUES (
  'site_timezone',
  '{"timezone": "America/Los_Angeles"}'::jsonb,
  'internal',
  'Site time zone',
  'The time zone the admin shows dates and times in, as Kajabi did. An IANA zone name.'
)
ON CONFLICT (key) DO NOTHING;
