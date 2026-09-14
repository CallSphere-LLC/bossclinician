-- Receipts for one-off orders.
--
-- `invoices` was written by the Stripe subscription webhook and by nothing else,
-- so the only payments that ever had a receipt document were renewals. A member
-- who bought a course outright had an order, a charge and access — and a
-- purchases page that told them to write in and ask if they wanted a receipt.
--
-- The fix is not a second document: it is a row in the same table, so the member
-- receipt page, the member invoice list and the admin invoice list all keep
-- reading one place. `origin` says who raised it, which is what keeps the two
-- kinds apart in the figures that count them separately (a one-off order is
-- already counted from `orders`, and counting its receipt as well would report
-- every purchase twice).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'stripe';

-- One locally-raised receipt per order, enforced by the database rather than by
-- the code that inserts it: two receipts for one payment is the kind of thing a
-- retried webhook does at three in the morning.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_receipt_per_order
  ON invoices (order_id) WHERE origin = 'order';

-- Every purchase already made. `settled_at` is deliberately left NULL: it is the
-- webhook's claim marker for work it still has to finish, and a settled row here
-- would tell the payment-plan handler that an installment it has not yet
-- processed has already been dealt with.
INSERT INTO invoices (
  stripe_invoice_id, origin, member_id, order_id, email, number,
  amount_due_cents, amount_paid_cents, tax_cents, currency, status,
  paid_at, created_at
)
SELECT 'order:' || o.id,
       'order',
       o.member_id,
       o.id,
       o.email,
       -- A reference somebody can quote at us, stable for the life of the order:
       -- built from the order id rather than from a counter, so a re-run of this
       -- migration on another environment produces the same number.
       'R-' || to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(o.id::text, 5, '0'),
       CASE WHEN o.total_cents > 0 THEN o.total_cents ELSE o.amount_cents END,
       CASE WHEN o.total_cents > 0 THEN o.total_cents ELSE o.amount_cents END,
       o.tax_cents,
       o.currency,
       -- The money cleared. A refund is recorded against the order and shown
       -- beside it; it does not un-issue the receipt for the payment.
       'paid',
       o.updated_at,
       o.created_at
  FROM orders o
 WHERE o.status IN ('paid', 'refunded')
   -- Anything Stripe already invoiced keeps Stripe's receipt, including every
   -- payment-plan installment: a second document for the same money is worse
   -- than none.
   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM payment_plans pp WHERE pp.order_id = o.id)
ON CONFLICT (stripe_invoice_id) DO NOTHING;
