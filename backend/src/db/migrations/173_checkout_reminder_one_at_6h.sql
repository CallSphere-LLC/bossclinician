-- 173: abandoned-checkout reminders become one email, 6 hours after abandonment.
--
-- Owner's request (sheet row 204): 3 reminder emails in one day could make
-- someone opt out; send 1 after 6 hours unless she chooses otherwise.
--
-- The cart_recovery row stores every field explicitly, and stored values win
-- over code defaults, so the new defaults alone would change nothing. Only a row
-- still on the old shipped timing moves: anything she has chosen stays. Offers on
-- their own custom reminders are untouched.
--
-- Nothing here sends mail. The sweep sends a reminder only for a cart whose next
-- switched-on reminder is due, so:
--   - carts already mid-sequence (emails_sent >= 1) have no next reminder and go quiet;
--   - unsent carts under 6 hours old get their one reminder when they reach 6 hours;
--   - unsent carts already past 6 hours would be due at once on the next sweep,
--     so they are closed here without an email.
--
-- Idempotent: the first UPDATE stops matching once applied, the second only
-- touches still-open carts, and a fresh database has no row (defaults apply).

UPDATE settings
   SET value = value || jsonb_build_object(
         'hours0', 6, 'hours1', 24, 'hours2', 48, 'hours3', 72,
         'enabled1', false, 'enabled2', false, 'enabled3', false),
       updated_at = now()
 WHERE key = 'cart_recovery'
   AND value->>'hours0' = '1' AND value->>'hours1' = '6'
   AND value->>'hours2' = '10' AND value->>'hours3' = '24'
   AND value->>'enabled0' = 'true' AND value->>'enabled1' = 'true'
   AND value->>'enabled2' = 'true' AND value->>'enabled3' = 'true';

-- The admin screen shows the row's own description over the code's.
UPDATE settings
   SET description = 'By default one reminder goes out, 6 hours after the visitor''s last checkout activity. Change its timing below, or switch on more. Nobody gets more than one reminder in 24 hours, even if they left several offers. Buying stops any reminder still to come for that offer. Sales are attributed to the last reminder link followed before purchase.'
 WHERE key = 'cart_recovery';

UPDATE abandoned_checkouts a
   SET stopped_at = now(), stop_reason = 'reminder_schedule_change'
  FROM offers o
 WHERE o.id = a.offer_id
   AND o.recovery_mode <> 'custom'
   AND a.recovered_at IS NULL AND a.stopped_at IS NULL
   AND a.emails_sent = 0
   AND a.updated_at < now() - interval '6 hours';

-- The once-per-person-per-24-hours check looks carts up by address.
CREATE INDEX IF NOT EXISTS abandoned_checkouts_email ON abandoned_checkouts (email);
