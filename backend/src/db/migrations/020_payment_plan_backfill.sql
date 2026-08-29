-- =============================================================================
-- Payment plans — repair the plans opened before the opening invoice was closed
--
-- Two columns exist so that a redelivered opening invoice cannot be mistaken for
-- the next instalment: `invoices.settled_at`, which tells "we have seen this
-- invoice" from "we have finished acting on it", and
-- `payment_plan_installments.stripe_invoice_id`, which names the invoice that
-- paid each instalment. Migration 008 added both.
--
-- The plan branch of `handleInvoicePaid` set neither. It opened the plan and
-- returned, so every plan created between 008 and that fix has an opening
-- invoice with a NULL `settled_at` and an instalment 1 with a NULL
-- `stripe_invoice_id`. The damage that combination does is not theoretical:
-- Stripe redelivers, the redelivery re-claims the unsettled invoice, finds the
-- order already paid and the plan already open, falls through to the renewal
-- path, and credits instalment TWO with the opening invoice's money. A customer
-- who has paid one instalment of three is recorded as having paid two — and on a
-- two-instalment plan the plan is marked complete and Stripe stops billing.
--
-- What follows repairs only rows it can prove. "The opening invoice of this
-- plan" means the earliest invoice carrying that plan's id, and the plan id is
-- stamped on an invoice by exactly one statement in the webhook, which runs only
-- after the plan has been created. No Stripe invoice id is invented: every value
-- written below is copied from an invoice row that already exists. Anything that
-- cannot be proved is left alone and counted in the notices at the end, where a
-- deliberate gap is more use than a confident guess.
--
-- Re-runnable. Every statement is guarded on the column still being NULL, so a
-- second run changes nothing.
-- =============================================================================

DO $$
DECLARE
  stamped        INT := 0;
  settled        INT := 0;
  no_invoice     INT := 0;
  nothing_paid   INT := 0;
  already_taken  INT := 0;
  still_unsettled INT := 0;
BEGIN
  -- --- 1. Name the invoice that paid instalment one -------------------------
  --
  -- Only where instalment 1 is already recorded as paid and the opening invoice
  -- actually collected money: a $0 opening invoice (a trial, or a plan whose
  -- first charge is deferred) did not pay instalment 1, and writing its id onto
  -- that row would be a claim about money that never moved.
  --
  -- The NOT EXISTS is the unique index on `stripe_invoice_id` speaking in
  -- advance. If some other instalment of this plan already carries the opening
  -- invoice's id, that plan has already been miscredited and the fix for it is
  -- a person looking at the two rows, not an UPDATE that would fail the whole
  -- migration.
  WITH opening AS (
    SELECT DISTINCT ON (i.payment_plan_id)
           i.payment_plan_id            AS plan_id,
           i.stripe_invoice_id          AS stripe_invoice_id,
           i.amount_paid_cents          AS amount_paid_cents,
           i.status                     AS status
      FROM invoices i
     WHERE i.payment_plan_id IS NOT NULL
     ORDER BY i.payment_plan_id, COALESCE(i.paid_at, i.created_at), i.id
  ),
  updated AS (
    UPDATE payment_plan_installments pi
       SET stripe_invoice_id = o.stripe_invoice_id
      FROM opening o
     WHERE pi.payment_plan_id = o.plan_id
       AND pi.sequence = 1
       AND pi.stripe_invoice_id IS NULL
       AND pi.status = 'paid'
       AND o.status = 'paid'
       AND o.amount_paid_cents > 0
       AND NOT EXISTS (
             SELECT 1 FROM payment_plan_installments taken
              WHERE taken.stripe_invoice_id = o.stripe_invoice_id
           )
    RETURNING 1
  )
  SELECT count(*) INTO stamped FROM updated;

  -- --- 2. Close the opening invoice -----------------------------------------
  --
  -- Keyed on instalment 1 naming the invoice rather than on "earliest invoice
  -- for the plan", so the only invoices closed here are ones an instalment row
  -- vouches for — the set stamped above, plus any stamped by the webhook since
  -- the fix. That is the whole point of the exercise: an invoice with a
  -- `settled_at` is refused by `upsertInvoice` before the handler can run, which
  -- is what stops the redelivery reaching the renewal path at all.
  --
  -- `settled_at` is backdated to when the invoice was actually paid rather than
  -- set to now(), because it is a record of when the work completed and the work
  -- completed then. Reports that ask what happened last March must not see a
  -- year of plan openings land on the day of this deploy.
  WITH closed AS (
    UPDATE invoices i
       SET settled_at = COALESCE(i.paid_at, i.created_at)
      FROM payment_plan_installments pi
     WHERE pi.sequence = 1
       AND pi.stripe_invoice_id = i.stripe_invoice_id
       AND i.settled_at IS NULL
       AND i.status = 'paid'
    RETURNING 1
  )
  SELECT count(*) INTO settled FROM closed;

  -- --- 3. What is left, and why ---------------------------------------------

  -- No invoice row is linked to the plan at all, so there is nothing to prove
  -- which Stripe invoice opened it. Recoverable only from the Stripe dashboard.
  SELECT count(*) INTO no_invoice
    FROM payment_plans p
   WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.payment_plan_id = p.id);

  -- The opening invoice collected nothing, so instalment 1 was never paid by it
  -- and must not be stamped with it. These plans are not exposed to the
  -- miscredit above: a $0 invoice is refused by the counter before it can
  -- advance anything.
  SELECT count(*) INTO nothing_paid
    FROM payment_plans p
    JOIN LATERAL (
      SELECT i.amount_paid_cents
        FROM invoices i
       WHERE i.payment_plan_id = p.id
       ORDER BY COALESCE(i.paid_at, i.created_at), i.id
       LIMIT 1
    ) first_invoice ON TRUE
   WHERE first_invoice.amount_paid_cents <= 0;

  -- The opening invoice's id is already on some other instalment of the same
  -- plan: the miscredit has already happened here and needs a human to unwind
  -- the counter. Left untouched deliberately.
  SELECT count(*) INTO already_taken
    FROM payment_plans p
    JOIN LATERAL (
      SELECT i.stripe_invoice_id
        FROM invoices i
       WHERE i.payment_plan_id = p.id
       ORDER BY COALESCE(i.paid_at, i.created_at), i.id
       LIMIT 1
    ) first_invoice ON TRUE
    JOIN payment_plan_installments pi
      ON pi.payment_plan_id = p.id
     AND pi.stripe_invoice_id = first_invoice.stripe_invoice_id
     AND pi.sequence <> 1;

  SELECT count(*) INTO still_unsettled
    FROM invoices i
   WHERE i.payment_plan_id IS NOT NULL AND i.settled_at IS NULL AND i.status = 'paid';

  RAISE NOTICE 'payment plan backfill: % instalment(s) given their opening invoice id, % opening invoice(s) closed', stamped, settled;
  RAISE NOTICE 'payment plan backfill: left alone — % plan(s) with no invoice row, % plan(s) whose opening invoice collected nothing, % plan(s) already miscredited to a later instalment', no_invoice, nothing_paid, already_taken;
  RAISE NOTICE 'payment plan backfill: % paid plan invoice(s) still unsettled (later instalments that genuinely did not finish, plus the plans above)', still_unsettled;
END $$;
