-- Provider-specific IDs retain independent idempotency and reconciliation.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_capture_id TEXT UNIQUE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paypal_capture_id TEXT UNIQUE;
