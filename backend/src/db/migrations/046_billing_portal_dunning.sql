-- Lane D2: the customer billing portal's dunning schedule and reminders.
-- Idempotent: every statement can run again on a database that already has it.

-- A payment retry schedule the owner sets, run by this site rather than by
-- Stripe's account-wide retry settings. The bookkeeping lives on the invoice the
-- failed payment belongs to, because that is what gets paid on a retry.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS retries_made INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_retry_error TEXT NOT NULL DEFAULT '';
-- Set once dunning is over for the invoice: 'paid', 'exhausted' or 'canceled'.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dunning_outcome TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dunning_ended_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS invoices_next_retry_at_idx
  ON invoices (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND dunning_ended_at IS NULL;

-- The upcoming-payment reminder covers instalments as well as memberships.
ALTER TABLE payment_plan_installments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Reminders gained an explicit on/off switch. "0 days before" used to be the
-- only way to switch one off, so a stored 0 becomes "off" with a usable number
-- behind it — nobody who had turned a reminder off finds it back on.
UPDATE settings
   SET value = value || jsonb_build_object('sendTrialReminders', false, 'trialReminderDays', 3),
       updated_at = now()
 WHERE key = 'customer_payments'
   AND NOT (value ? 'sendTrialReminders')
   AND (value->>'trialReminderDays') ~ '^[0-9]+$'
   AND (value->>'trialReminderDays')::int = 0;

UPDATE settings
   SET value = value || jsonb_build_object('sendUpcomingPaymentReminders', false, 'upcomingPaymentReminderDays', 3),
       updated_at = now()
 WHERE key = 'customer_payments'
   AND NOT (value ? 'sendUpcomingPaymentReminders')
   AND (value->>'upcomingPaymentReminderDays') ~ '^[0-9]+$'
   AND (value->>'upcomingPaymentReminderDays')::int = 0;

-- The retry sweep. Every 15 minutes: a retry is due on a day, not to the minute.
INSERT INTO job_schedules (name, kind, every_minutes, timezone)
VALUES ('billing-dunning', 'billing.dunning', 15, 'America/New_York')
ON CONFLICT (name) DO NOTHING;
