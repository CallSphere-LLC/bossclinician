-- One checkout may offer several ways to pay while still granting one offer's
-- products. The original columns on `offers` remain the first/default option,
-- preserving every existing checkout URL and Stripe Price.
CREATE TABLE IF NOT EXISTS offer_pricing_options (
  id                 SERIAL PRIMARY KEY,
  offer_id           INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  label              TEXT NOT NULL DEFAULT '',
  pricing_type       TEXT NOT NULL
                       CHECK (pricing_type IN ('one_time','subscription','payment_plan','free','pwyw')),
  amount_cents       INT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  min_amount_cents   INT NOT NULL DEFAULT 0 CHECK (min_amount_cents >= 0),
  currency           TEXT NOT NULL DEFAULT 'usd',
  interval           TEXT CHECK (interval IN ('day','week','month','year')),
  interval_count     INT NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 365),
  installment_count  INT CHECK (installment_count BETWEEN 2 AND 60),
  trial_days         INT NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 365),
  recommended        BOOLEAN NOT NULL DEFAULT false,
  active             BOOLEAN NOT NULL DEFAULT true,
  stripe_price_id    TEXT,
  stripe_product_id  TEXT,
  sort               INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_pricing_options_offer
  ON offer_pricing_options (offer_id, active, sort, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_pricing_options_recommended
  ON offer_pricing_options (offer_id) WHERE recommended AND active;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pricing_option_id INT
    REFERENCES offer_pricing_options(id) ON DELETE SET NULL;
