-- =============================================================================
-- Phase 2 (follow-up) — make `invoice.paid` recoverable
--
-- `handleInvoicePaid` wrote the invoice row as `paid` before doing any of the
-- work that invoice implies — settling the order, granting access, advancing the
-- payment plan. If anything downstream threw, the handler returned 500 and
-- Stripe retried, but the retry found the invoice already marked paid, took the
-- "already recorded, nothing to advance" branch, and reported success.
--
-- Net effect: the money was taken, the event was closed as processed, and the
-- order sat `pending` with no access granted. For a recurring order there was no
-- second way in — `orders.stripe_payment_intent_id` is null at that point, so
-- `charge.succeeded` cannot find the order either.
--
-- Two columns fix it. `settled_at` distinguishes "we have seen this invoice"
-- from "we have finished acting on it", so a retry after a partial failure runs
-- again. `stripe_invoice_id` on the installment makes that rerun safe for the
-- one downstream step that is not naturally idempotent: crediting an
-- installment advances a counter, and doing it twice would mark a plan paid off
-- a payment early.
-- =============================================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- Existing paid invoices predate this column and their work did complete;
-- leaving them null would make the next delivery of an old event redo it.
UPDATE invoices SET settled_at = COALESCE(paid_at, created_at)
 WHERE settled_at IS NULL AND status = 'paid';

CREATE INDEX IF NOT EXISTS idx_invoices_unsettled
  ON invoices (created_at) WHERE settled_at IS NULL;

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

-- One installment per invoice. Partial, because the rows created up front by
-- the schedule have no invoice yet and must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_installments_invoice
  ON payment_plan_installments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
