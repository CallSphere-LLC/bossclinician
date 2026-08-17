-- =============================================================================
-- Phase 2 (follow-up) — coupon redemption ledger
--
-- `coupons.max_redemptions` was compared against `coupons.redeemed`, and nothing
-- anywhere incremented `redeemed`. The cap therefore did not exist: a coupon
-- limited to 50 uses worked for the 51st customer and every one after, and a
-- 100%-off code was an unlimited free-grant generator bounded only by the
-- checkout rate limit.
--
-- Counting paid orders instead is not sufficient either. An order is `pending`
-- for the seconds between the charge and Stripe's webhook, so two checkouts
-- started together both see a usage count of zero — which is also how
-- `max_per_contact` was bypassed.
--
-- This ledger is written inside the same transaction that creates the order,
-- while the coupon row is held under `FOR UPDATE`. The row exists before the
-- customer reaches Stripe, so concurrent checkouts serialise on it.
-- =============================================================================

CREATE TABLE coupon_redemptions (
  id          SERIAL PRIMARY KEY,
  coupon_id   INT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id    INT REFERENCES orders(id) ON DELETE CASCADE,
  member_id   INT REFERENCES members(id) ON DELETE SET NULL,
  email       CITEXT NOT NULL DEFAULT '',
  -- What the discount was worth, so revenue reporting can attribute it without
  -- recomputing historical coupon terms that may since have been edited.
  amount_cents INT NOT NULL DEFAULT 0,
  -- Set when the order it belonged to failed or expired. Released redemptions
  -- do not count against the cap: an abandoned checkout must not burn one of
  -- fifty launch codes.
  released_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coupon_redemptions_coupon
  ON coupon_redemptions (coupon_id) WHERE released_at IS NULL;
CREATE INDEX idx_coupon_redemptions_contact
  ON coupon_redemptions (coupon_id, email) WHERE released_at IS NULL;
CREATE UNIQUE INDEX idx_coupon_redemptions_order
  ON coupon_redemptions (order_id) WHERE order_id IS NOT NULL;

-- `coupons.redeemed` stays as the denormalised counter the admin list reads,
-- now with something that actually maintains it.
COMMENT ON COLUMN coupons.redeemed IS
  'Live redemption count, maintained from coupon_redemptions. Authoritative count is that table.';
