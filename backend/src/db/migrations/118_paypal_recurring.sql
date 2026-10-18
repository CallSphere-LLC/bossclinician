-- PayPal for every offer type: one-time Orders v2 captures (117), plus
-- memberships and fixed-installment payment plans on PayPal Subscriptions.
--
-- Stripe stays the default provider. Every PayPal column is nullable or
-- defaulted, so existing rows and the Stripe paths are untouched.

-- Which provider collected (or is collecting) an order. Set when the checkout
-- opens, so an abandoned PayPal order is recognisable before it is paid.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN ('stripe', 'paypal'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT UNIQUE;
UPDATE orders SET payment_provider = 'paypal'
 WHERE payment_provider <> 'paypal' AND paypal_order_id IS NOT NULL;

-- A membership billed by PayPal. Mirrors the Stripe columns: the row is the
-- member's subscription either way, and exactly one provider id is set.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT UNIQUE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paypal_plan_id TEXT;

-- A fixed-installment plan billed by PayPal ("6 x $397").
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT UNIQUE;

-- One ledger row per PayPal subscription payment (a "sale"); the unique id is
-- the idempotency key that stops a redelivered webhook counting money twice.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paypal_sale_id TEXT UNIQUE;

-- PayPal refund ids, guarded exactly like stripe_refund_id.
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS paypal_refund_id TEXT UNIQUE;

-- PayPal Catalog Products and Billing Plans, minted lazily per offer pricing
-- option. A plan's prices are fixed once created, so a plan is keyed on a hash
-- of its whole definition (amounts, interval, trial, installment count, the
-- coupon's effect and any one-off bump fee) plus the PayPal environment:
-- repricing an offer, or a coupon, simply produces a new plan, and sandbox ids
-- can never be sent to the live API.
CREATE TABLE IF NOT EXISTS paypal_products (
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  offer_id           INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  paypal_product_id  TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, offer_id)
);

CREATE TABLE IF NOT EXISTS paypal_plans (
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  definition_hash    TEXT NOT NULL,
  paypal_plan_id     TEXT NOT NULL,
  paypal_product_id  TEXT NOT NULL,
  offer_id           INT REFERENCES offers(id) ON DELETE SET NULL,
  pricing_option_id  INT REFERENCES offer_pricing_options(id) ON DELETE SET NULL,
  definition         JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, definition_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS paypal_plans_plan_id ON paypal_plans (paypal_plan_id);
CREATE INDEX IF NOT EXISTS paypal_plans_offer ON paypal_plans (offer_id, pricing_option_id);

-- The PayPal webhook log: idempotency key and forensic record, with the same
-- claim semantics as stripe_events (see routes/public/paypalWebhook.ts).
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  id            TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  resource_id   TEXT NOT NULL DEFAULT '',
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received', 'processing', 'processed', 'failed', 'ignored')),
  error         TEXT NOT NULL DEFAULT '',
  attempts      INT NOT NULL DEFAULT 0,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at    TIMESTAMPTZ,
  processed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS paypal_webhook_events_status ON paypal_webhook_events (status, received_at DESC);
CREATE INDEX IF NOT EXISTS paypal_webhook_events_resource ON paypal_webhook_events (resource_id);
