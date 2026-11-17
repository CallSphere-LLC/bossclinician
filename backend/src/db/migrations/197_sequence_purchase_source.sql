-- =============================================================================
-- 197: Purchase sequences stop when the purchase does (QA row 230)
--
-- "Is there a way to end the email sequence if a customer purchases the club,
-- lounge or boardroom but cancels or card is declined?"
--
-- A run started by an "offer purchased" automation now remembers which offer
-- (and which order) started it. services/sequences.ts reads the two columns:
-- once that purchase is refunded, its access is revoked, a payment plan
-- defaults or a subscription's access ends, the run exits with the reason and
-- nothing further is sent. While access is only paused for a failing renewal,
-- the run is held and resumes if the payment goes through.
--
-- Additive and idempotent. The backfill below only stamps runs that are still
-- going, only from an automation that really starts that sequence on a
-- purchase, and only with an offer the contact actually holds or held. A run it
-- cannot place is left unstamped and behaves exactly as before.
-- =============================================================================

ALTER TABLE sequence_subscriptions
  ADD COLUMN IF NOT EXISTS source_offer_id INT REFERENCES offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_order_id INT REFERENCES orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN sequence_subscriptions.source_offer_id IS
  'The offer whose purchase started this run. When that purchase is refunded, revoked or ends, the run exits.';
COMMENT ON COLUMN sequence_subscriptions.source_order_id IS
  'The order that started this run, when known. A fully refunded order ends the run.';

-- The sweep in tickDueSubscriptions reads only live, stamped runs.
CREATE INDEX IF NOT EXISTS idx_sequence_subs_purchase_source
  ON sequence_subscriptions (source_offer_id)
  WHERE status = 'active' AND source_offer_id IS NOT NULL;

-- Backfill live runs started before this column existed.
WITH starters AS (
  SELECT DISTINCT (x.config ->> 'sequenceId')::int AS sequence_id,
                  (a.trigger_config ->> 'offerId')::int AS offer_id
    FROM automations a
    JOIN automation_actions x ON x.automation_id = a.id
   WHERE a.trigger_type = 'offer_purchased'
     AND x.action_type = 'subscribe_sequence'
     AND (x.config ->> 'sequenceId') ~ '^[0-9]+$'
     AND (a.trigger_config ->> 'offerId') ~ '^[0-9]+$'
),
placed AS (
  SELECT DISTINCT ON (s.id)
         s.id AS subscription_id, g.offer_id, g.order_id
    FROM sequence_subscriptions s
    JOIN contacts c ON c.id = s.contact_id
    JOIN starters st ON st.sequence_id = s.sequence_id
    JOIN members m ON (m.contact_id = s.contact_id OR lower(m.email::text) = lower(c.email::text))
    JOIN access_grants g ON g.member_id = m.id AND g.offer_id = st.offer_id
   WHERE s.status IN ('active', 'paused')
     AND s.source_offer_id IS NULL
   ORDER BY s.id,
            (g.status = 'active') DESC,
            g.granted_at DESC NULLS LAST,
            g.id DESC
)
UPDATE sequence_subscriptions s
   SET source_offer_id = p.offer_id,
       source_order_id = CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id)
                              THEN p.order_id END
  FROM placed p
 WHERE s.id = p.subscription_id
   AND s.source_offer_id IS NULL;
