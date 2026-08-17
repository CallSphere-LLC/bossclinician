-- =============================================================================
-- Phase 2 (follow-up) — serialised webhook event claims
--
-- `stripe_events` was the idempotency key for the whole webhook file, but the
-- claim it granted was released the instant the claiming statement committed:
-- the row went to 'received', autocommit dropped the row lock, and the handler
-- then ran for however long it ran with nothing holding the event.
--
-- Stripe retries a delivery it has had no answer to in about ten seconds, which
-- is well inside the time a handler can take. The retry found a 'received' row,
-- which the conflict clause treated as re-claimable, and two handlers ran the
-- same event at once. Every write whose guard was weaker than a unique key
-- doubled: a partial refund was counted twice and revoked access the customer
-- had paid for, one decline sent two dunning emails, and a failed payment wrote
-- a transaction row per delivery.
--
-- A claim therefore needs a state of its own that outlives the statement that
-- takes it, plus a timestamp — because a process that dies mid-handler must not
-- wedge the event forever, and the only way to tell "still running" from "died
-- an hour ago" is when the claim was taken.
-- =============================================================================

ALTER TABLE stripe_events DROP CONSTRAINT IF EXISTS stripe_events_status_check;
ALTER TABLE stripe_events ADD CONSTRAINT stripe_events_status_check
  CHECK (status IN ('received','processing','processed','failed','ignored'));

-- When the delivery currently holding this event took it. A 'processing' row
-- older than the handler timeout is a crashed delivery and may be taken over;
-- NULL means the row predates claims, and `received_at` stands in for it.
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- --- invoice dunning --------------------------------------------------------

-- Stripe's own attempt number for the invoice, and the key that separates a
-- second decline from a second delivery of the first one. `invoices.status`
-- cannot do it: an invoice is paid once but can be declined many times, so
-- status alone reads every redelivered failure as new dunning to send.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0;
