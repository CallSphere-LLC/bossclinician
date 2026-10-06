-- =============================================================================
-- 107 — Kajabi marketing import: columns (QA sheet, 2026-10-05)
--
-- The admin Email Campaigns, Funnels, Automations, Events and Forms pages show
-- the client's real Kajabi history. The rows themselves are written by
-- backend/scripts/kajabi-import/import-marketing.mjs (idempotent by kajabi_id);
-- this file only adds the columns that script fills, so it is pure DDL and safe
-- to run twice: the script applies it itself before importing, and migrate.ts
-- then records it here as a no-op on the next deploy.
--
-- Every column is nullable with no default except where noted, so rows made in
-- this app are untouched (NULL source = "made here"). Kajabi ids are bigints;
-- each table gets a partial unique index on kajabi_id, which is what the
-- importer's ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL upserts infer.
--
-- Read by: the admin lists (SELECT * / to_jsonb(f) — formsV2.ts reads the
-- forms columns through to_jsonb so it works with or without them), and the
-- frontend's campaigns/emailList.ts, formsApi.ts and automationFilters.ts.
--
-- Nothing here is read by a sender. The broadcast/anchor/registration tickers
-- select status 'scheduled'/'sending' only, the sequence tick needs an active
-- subscription, event reminders need event_reminders rows on a published
-- event, and both automation engines run status = 'active' only.
-- =============================================================================

-- Email Campaigns (broadcasts + event emails; Kajabi sequences go to email_sequences)
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kajabi_id       bigint;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS source          text;
-- EmailBroadcast | EventOccurrenceAction (EmailSequence never lands here)
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kajabi_type     text;
-- Kajabi's own status (sent / scheduled / draft). A Kajabi "scheduled" email is
-- held here as status 'draft' with no scheduled_at: Kajabi still sends it.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kajabi_status   text;
-- The Kajabi event an event email belongs to (also linked by anchor_event_id).
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kajabi_event_id bigint;
-- Kajabi's "To" line ("All Subscribers", "Has any of these tag(s): …"). The
-- importer sets `audience` itself to 'kajabi_import', a key audiencePredicate()
-- does not know, so Send on an imported row (or a copy of one) refuses with
-- "Nobody in that audience" until somebody picks a real audience.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kajabi_audience text;
-- When Kajabi has it scheduled to go out (Kajabi sends it, not this app).
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kajabi_scheduled_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_kajabi_id_key
  ON email_campaigns (kajabi_id) WHERE kajabi_id IS NOT NULL;

-- Email Sequences. The four counts are Kajabi's totals for the sequence; NULL
-- (not 0) on sequences made here, so their stat cells read "—" rather than a
-- misleading zero (campaigns/emailList.ts sequenceStats).
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS kajabi_id          bigint;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS source             text;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS recipient_count    integer;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS opened_count       integer;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS clicked_count      integer;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS unsubscribed_count integer;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS kajabi_subscribers integer;
-- Kajabi's entry rules, as it words them ("Offer is purchased: The Club").
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS kajabi_triggers    jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS email_sequences_kajabi_id_key
  ON email_sequences (kajabi_id) WHERE kajabi_id IS NOT NULL;

ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS kajabi_id          bigint;
ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS source             text;
-- Kajabi's schedule word for word ("Day 6 @ 10:00 AM PDT"); delay_minutes holds
-- the day gap, the time of day is only kept here.
ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS kajabi_when        text;
ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS kajabi_sent_count  integer;
ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS kajabi_opened_pct  numeric(5,1);
ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS kajabi_clicked_pct numeric(5,1);
ALTER TABLE sequence_emails ADD COLUMN IF NOT EXISTS kajabi_unsub_pct   numeric(5,1);
CREATE UNIQUE INDEX IF NOT EXISTS sequence_emails_kajabi_id_key
  ON sequence_emails (kajabi_id) WHERE kajabi_id IS NOT NULL;

-- Events
ALTER TABLE events ADD COLUMN IF NOT EXISTS kajabi_id         bigint;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source            text;
-- Kajabi's repeat phrase ("Every 4 days", "Hourly"); Kajabi's series never end.
ALTER TABLE events ADD COLUMN IF NOT EXISTS kajabi_recurrence text;
CREATE UNIQUE INDEX IF NOT EXISTS events_kajabi_id_key
  ON events (kajabi_id) WHERE kajabi_id IS NOT NULL;

-- Kajabi's registrations list has no row ids; the importer is idempotent on the
-- existing UNIQUE (event_id, email) and leaves kajabi_id NULL. The column is
-- here so a later export that does carry ids has somewhere to put them.
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS kajabi_id bigint;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS source    text;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_kajabi_id_key
  ON event_registrations (kajabi_id) WHERE kajabi_id IS NOT NULL;

-- Funnels
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS kajabi_id       bigint;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS source          text;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS kajabi_status   text;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS kajabi_visitors integer;
CREATE UNIQUE INDEX IF NOT EXISTS funnels_kajabi_id_key
  ON funnels (kajabi_id) WHERE kajabi_id IS NOT NULL;

ALTER TABLE funnel_steps ADD COLUMN IF NOT EXISTS kajabi_id bigint;
ALTER TABLE funnel_steps ADD COLUMN IF NOT EXISTS source    text;
CREATE UNIQUE INDEX IF NOT EXISTS funnel_steps_kajabi_id_key
  ON funnel_steps (kajabi_id) WHERE kajabi_id IS NOT NULL;

-- Forms. kajabi_submissions_count is what the list adds to the local replies
-- (formsApi.ts totalSubmissions); the importer brings every Kajabi reply over
-- as a form_submissions row, so it sets this to 0 to avoid counting them twice.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS kajabi_id               bigint;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS source                  text;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS kajabi_submissions_count integer;
-- 'single' | 'double' (formsApi.ts OptInKind)
ALTER TABLE forms ADD COLUMN IF NOT EXISTS kajabi_opt_in           text;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS kajabi_title            text;
CREATE UNIQUE INDEX IF NOT EXISTS forms_kajabi_id_key
  ON forms (kajabi_id) WHERE kajabi_id IS NOT NULL;

ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS kajabi_id bigint;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS source    text;
CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_kajabi_id_key
  ON form_submissions (kajabi_id) WHERE kajabi_id IS NOT NULL;

-- Automations (imported paused; the builder badges source = 'kajabi')
ALTER TABLE automations ADD COLUMN IF NOT EXISTS kajabi_id bigint;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS source    text;
CREATE UNIQUE INDEX IF NOT EXISTS automations_kajabi_id_key
  ON automations (kajabi_id) WHERE kajabi_id IS NOT NULL;
