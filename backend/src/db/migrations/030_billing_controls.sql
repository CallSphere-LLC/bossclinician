-- Refund confirmations use the same editable automatic-email library as receipts.
INSERT INTO email_templates (key, name, description)
VALUES ('refund_receipt', 'Refund receipt', 'Sent when money is returned to a customer')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS upcoming_reminder_for TIMESTAMPTZ;

INSERT INTO email_templates (key, name, description) VALUES
  ('trial_ending', 'Free trial ending', 'Sent shortly before the first subscription payment'),
  ('upcoming_payment', 'Upcoming payment', 'Sent before a recurring subscription payment')
ON CONFLICT (key) DO NOTHING;

INSERT INTO job_schedules (name, kind, every_minutes, timezone)
VALUES ('billing-reminders', 'billing.reminders', 60, 'America/New_York')
ON CONFLICT (name) DO NOTHING;
