-- Purchases, as Kajabi means the word: one row per thing a person bought or was
-- given — a one-time purchase, a payment plan, a subscription, a grant, a free
-- claim — with the payments that belong to it hanging off it.
--
-- Until now the only record was `orders`, and an order is a payment. That was
-- fine for a one-time purchase, where the two are the same thing, and wrong for
-- everything else. The Kajabi import (2026-09-27) wrote one order per
-- transaction, so Norma Sanchez's Shared Room plan — one purchase, three
-- payments so far — showed as three purchases, and "Total purchases 3" where
-- Kajabi says 1. A grant has no payment at all, so it had no row anywhere and
-- simply did not appear. The owner compares the two admins side by side; both
-- of those read as the rebuild losing her data.
--
-- What lives here, and what does not:
--
--  * The purchase's own terms: which offer, what kind, what it costs as a whole
--    (a plan's setup fee plus every instalment), its billing status, who paused
--    it, whether access was revoked, the next scheduled charge. None of that is
--    derivable from the payments, which is why it needs a table and not a view.
--  * NOT the payments. Those stay in `orders` (+ `transactions`), each linked
--    back with `orders.purchase_id`. Reports, refunds, receipts and the rollups
--    keep reading orders exactly as before; nothing that counts money moves.
--
-- Rows here are written by the one-off Kajabi backfill (run by hand, outside the
-- repo, so no customer data is in git) and by nothing else yet. The rebuild's
-- own checkout is NOT required to write here: the admin reader treats an order
-- with no purchase_id as a purchase of its own, and reads a native payment plan
-- through `payment_plans.order_id` / `payment_plan_installments`. That is why
-- every column describing a plan is nullable and none of it is required.
--
-- Deliberately no data statements in this file. Creating purchases from the
-- existing orders here would race the backfill's idempotency keys and leave two
-- rows for the same Kajabi purchase.

CREATE TABLE purchases (
  id                     SERIAL PRIMARY KEY,
  contact_id             INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  member_id              INTEGER REFERENCES members(id) ON DELETE SET NULL,
  -- Null for most Kajabi purchases: their offers ("Private Room", "Shared
  -- Room") were never rebuilt as offers here, and the title below is what she
  -- recognises anyway.
  offer_id               INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  offer_title            TEXT NOT NULL DEFAULT '',
  kind                   TEXT NOT NULL
    CHECK (kind IN ('one_time', 'payment_plan', 'subscription', 'grant', 'free')),
  source                 TEXT NOT NULL DEFAULT 'checkout'
    CHECK (source IN ('kajabi', 'checkout', 'manual')),
  -- The idempotency key of whoever wrote the row (for Kajabi, built from the
  -- purchase's own facts so re-running the backfill updates rather than adds).
  external_id            TEXT,
  -- Kajabi's unified order number (#1000 onwards, July 2026). Shown only on the
  -- detail page — "Part of order no. #1004" — never on the card, as Kajabi does.
  order_no               TEXT,
  -- The union of what a Kajabi billing status and a native payment_plans status
  -- can say. 'complete' is a one-time purchase that went through; 'completed'
  -- is a plan that has been paid off. Kajabi uses both words that way.
  status                 TEXT NOT NULL DEFAULT 'complete'
    CHECK (status IN ('complete', 'active', 'paused', 'past_due', 'completed',
                      'canceled', 'granted', 'refunded')),
  purchased_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When a plan finished or was canceled ("Completed Sep 16, 2026").
  ended_at               TIMESTAMPTZ,
  quantity               INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- Kajabi's own words for the price, kept verbatim when we have them
  -- ("10 monthly payments of $400.00 USD + $500.00 USD setup fee with 30 day
  -- trial"). Empty means the reader composes it from the numbers below.
  price_text             TEXT NOT NULL DEFAULT '',
  -- The whole purchase: for a plan, setup fee + every instalment ($4,500 for
  -- 10 × $400 + $500), not what has been paid so far.
  total_cents            INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency               TEXT NOT NULL DEFAULT 'usd',
  setup_fee_cents        INTEGER NOT NULL DEFAULT 0 CHECK (setup_fee_cents >= 0),
  installment_cents      INTEGER CHECK (installment_cents IS NULL OR installment_cents >= 0),
  installments_total     INTEGER CHECK (installments_total IS NULL OR installments_total > 0),
  -- Instalments paid, not counting the setup fee: Sharon's $500 fee and one
  -- $400 payment is "1/10 payments completed". Null means "count the linked
  -- payments", which is what a native purchase without this column set gets.
  installments_paid      INTEGER CHECK (installments_paid IS NULL OR installments_paid >= 0),
  billing_interval       TEXT CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month', 'year')),
  interval_count         INTEGER NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  trial_days             INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  next_payment_at        TIMESTAMPTZ,
  next_payment_cents     INTEGER CHECK (next_payment_cents IS NULL OR next_payment_cents >= 0),
  -- Free text on purpose: Kajabi names the admin as "Yvette Howard (email)",
  -- and that admin may never have an account here to point a key at.
  paused_by              TEXT NOT NULL DEFAULT '',
  access_revoked         BOOLEAN NOT NULL DEFAULT false,
  access_revoked_by      TEXT NOT NULL DEFAULT '',
  access_starts_on       DATE,
  access_ends_on         DATE,
  gift                   BOOLEAN NOT NULL DEFAULT false,
  -- Only what the payment processor knew and the contact card does not: a card
  -- brand and last four, a billing address typed at checkout. The reader falls
  -- back to the contact's own phone and address when this is empty.
  customer_details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Source bookkeeping (Kajabi ids, their status colour, their total text).
  meta                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A plain constraint rather than a partial index: NULL external ids never
  -- collide, and `ON CONFLICT (source, external_id)` can name it directly.
  CONSTRAINT purchases_source_external_id_key UNIQUE (source, external_id)
);

CREATE INDEX idx_purchases_contact ON purchases (contact_id, purchased_at DESC);
CREATE INDEX idx_purchases_member ON purchases (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX idx_purchases_offer ON purchases (offer_id) WHERE offer_id IS NOT NULL;

-- Each payment names the purchase it paid towards. SET NULL, not CASCADE:
-- deleting a purchase row must never take money records with it; the payment
-- simply goes back to being shown as a purchase of its own.
ALTER TABLE orders
  ADD COLUMN purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_purchase ON orders (purchase_id) WHERE purchase_id IS NOT NULL;
