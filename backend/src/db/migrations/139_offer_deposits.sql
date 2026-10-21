-- A deposit is the first of installment_count charges; amount_cents is each later charge.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0 CHECK (deposit_cents BETWEEN 0 AND 99999999);
ALTER TABLE offer_pricing_options ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0 CHECK (deposit_cents BETWEEN 0 AND 99999999);
ALTER TABLE offer_pricing_options ADD COLUMN IF NOT EXISTS sales_start_at timestamptz;
ALTER TABLE offer_pricing_options ADD COLUMN IF NOT EXISTS sales_end_at timestamptz;
ALTER TABLE offer_pricing_options ADD CONSTRAINT offer_option_sales_window CHECK (sales_start_at IS NULL OR sales_end_at IS NULL OR sales_end_at > sales_start_at);
-- Freeze purchased terms before calling a provider.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_snapshot jsonb;
