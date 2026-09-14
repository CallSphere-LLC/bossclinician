-- Each sent reminder is independently attributable; completing a checkout is
-- separate from recovering a sale through a reminder link.
ALTER TABLE abandoned_checkouts ADD COLUMN IF NOT EXISTS stopped_at timestamptz;
ALTER TABLE abandoned_checkouts ADD COLUMN IF NOT EXISTS stop_reason text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS checkout_reminders (
  id serial PRIMARY KEY,
  abandoned_checkout_id integer NOT NULL REFERENCES abandoned_checkouts(id) ON DELETE CASCADE,
  step integer NOT NULL CHECK(step BETWEEN 0 AND 3),
  email_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  sent_at timestamptz,
  clicked_at timestamptz,
  subject text NOT NULL DEFAULT '',
  UNIQUE(abandoned_checkout_id, step)
);
ALTER TABLE abandoned_checkouts ADD COLUMN IF NOT EXISTS recovered_reminder_id integer REFERENCES checkout_reminders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS checkout_reminders_clicked ON checkout_reminders(abandoned_checkout_id, clicked_at DESC) WHERE clicked_at IS NOT NULL;
