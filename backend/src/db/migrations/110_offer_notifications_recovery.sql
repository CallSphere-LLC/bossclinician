-- 110: per-offer sale notifications and abandoned-checkout reminders.
--
-- Owner's requests (sheet, 2026-10-13):
--   "Same for offers can you include that I can get notified."
--   "For the offers can you set up an abandonment email."
--
-- Both already existed site-wide: Settings -> "What you get told about" emails
-- the owner on every sale, and the cart_recovery setting runs one reminder
-- sequence for every offer. Kajabi sets both per offer, so each offer now
-- carries its own switches, layered on top of the site-wide ones:
--
--   notify_owner_on_sale      false = no sale email for this offer.
--   notify_owner_recipients   '' = the site-wide address; otherwise the
--                             addresses (comma separated) to tell instead.
--   recovery_enabled          false = no abandoned-checkout reminders for it.
--   recovery_mode             'default' = the site-wide reminders;
--                             'custom'  = recovery_overrides on top of them.
--   recovery_overrides        the same enabledN/hoursN/subjectN/bodyN keys as
--                             the cart_recovery setting (N = 0..3).
--
-- orders.owner_notified_at makes the sale email once-per-order however many
-- times Stripe redelivers the webhook. Every order already paid is stamped so
-- nothing historical can be announced late.
--
-- Idempotent: IF NOT EXISTS throughout, and the backfill only touches NULLs.

ALTER TABLE offers ADD COLUMN IF NOT EXISTS notify_owner_on_sale boolean NOT NULL DEFAULT true;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS notify_owner_recipients text NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN IF NOT EXISTS recovery_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS recovery_mode text NOT NULL DEFAULT 'default';
ALTER TABLE offers ADD COLUMN IF NOT EXISTS recovery_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offers_recovery_mode_check') THEN
    ALTER TABLE offers ADD CONSTRAINT offers_recovery_mode_check
      CHECK (recovery_mode IN ('default', 'custom'));
  END IF;
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz;

UPDATE orders SET owner_notified_at = updated_at
 WHERE owner_notified_at IS NULL AND status IN ('paid', 'refunded', 'partially_refunded');
