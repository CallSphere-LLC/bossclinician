-- =============================================================================
-- Phase 8 — Affiliates / partner program
--
-- Kajabi has a full Affiliates module here (Overview, Commission, Share links,
-- My affiliates, Transactions, Announcements, Settings) and the platform has
-- none of it.
--
-- The part that decides whether the numbers are trustworthy is attribution:
-- a click has to be recorded before a purchase exists, survive the visitor
-- leaving and coming back, and be resolvable weeks later when the commission is
-- accrued. Everything below is shaped around that.
-- =============================================================================

CREATE TABLE affiliates (
  id            SERIAL PRIMARY KEY,
  contact_id    INT REFERENCES contacts(id) ON DELETE SET NULL,
  member_id     INT REFERENCES members(id) ON DELETE SET NULL,
  email         CITEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  -- The public handle in a share link: /?ref=<code>. Short and unguessable
  -- enough that codes cannot be enumerated to discover who the partners are.
  code          CITEXT UNIQUE NOT NULL,

  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','suspended','rejected')),
  approved_at   TIMESTAMPTZ,
  rejected_reason TEXT NOT NULL DEFAULT '',

  -- Defaults; an offer-level rule overrides these.
  commission_type TEXT NOT NULL DEFAULT 'percent'
                    CHECK (commission_type IN ('percent','fixed')),
  commission_rate INT NOT NULL DEFAULT 3000,   -- basis points, so 30% is 3000
  commission_fixed_cents INT NOT NULL DEFAULT 0,
  -- Whether a subscription pays out on every renewal or only the first charge.
  recurring_commission BOOLEAN NOT NULL DEFAULT false,
  cookie_window_days INT NOT NULL DEFAULT 30,

  payout_method TEXT NOT NULL DEFAULT '',
  payout_details TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',

  -- Denormalised for the list; maintained by the rollup job.
  click_count       INT NOT NULL DEFAULT 0,
  referred_count    INT NOT NULL DEFAULT 0,
  earned_cents      INT NOT NULL DEFAULT 0,
  paid_cents        INT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_affiliates_status ON affiliates (status, created_at DESC);

/** Per-offer overrides, so a $27 tripwire and a $3,500 package can pay differently. */
CREATE TABLE affiliate_commission_rules (
  id            SERIAL PRIMARY KEY,
  affiliate_id  INT REFERENCES affiliates(id) ON DELETE CASCADE,
  offer_id      INT REFERENCES offers(id) ON DELETE CASCADE,
  commission_type TEXT NOT NULL DEFAULT 'percent'
                    CHECK (commission_type IN ('percent','fixed','none')),
  commission_rate INT NOT NULL DEFAULT 0,
  commission_fixed_cents INT NOT NULL DEFAULT 0,
  recurring_commission BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A NULL affiliate_id is the program-wide rule for that offer; a NULL offer_id
  -- is that affiliate's own default. Both NULL is the program default and lives
  -- on the affiliate row instead, so it is excluded.
  CONSTRAINT rule_is_scoped CHECK (affiliate_id IS NOT NULL OR offer_id IS NOT NULL),
  UNIQUE (affiliate_id, offer_id)
);

CREATE TABLE affiliate_links (
  id            SERIAL PRIMARY KEY,
  affiliate_id  INT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  offer_id      INT REFERENCES offers(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT '',
  -- Where the link lands. Defaults to the offer's checkout, but a partner may
  -- prefer to send traffic to a sales page.
  destination_path TEXT NOT NULL DEFAULT '/',
  click_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/**
 * Every click on a share link.
 *
 * `visitor_token` is a first-party cookie value, not an IP or a fingerprint:
 * attribution has to survive a changing IP and must not depend on anything a
 * privacy tool strips. It is the only thing joining a click to a purchase that
 * happens three weeks later on a different network.
 */
CREATE TABLE affiliate_clicks (
  id            BIGSERIAL PRIMARY KEY,
  affiliate_id  INT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  link_id       INT REFERENCES affiliate_links(id) ON DELETE SET NULL,
  offer_id      INT REFERENCES offers(id) ON DELETE SET NULL,
  visitor_token TEXT NOT NULL,
  landing_path  TEXT NOT NULL DEFAULT '',
  referrer      TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The attribution lookup: newest live click for this visitor.
CREATE INDEX idx_affiliate_clicks_visitor ON affiliate_clicks (visitor_token, created_at DESC);
CREATE INDEX idx_affiliate_clicks_affiliate ON affiliate_clicks (affiliate_id, created_at DESC);

-- Which click an order was attributed to, resolved at checkout and frozen there.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id INT REFERENCES affiliates(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_click_id BIGINT REFERENCES affiliate_clicks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_affiliate ON orders (affiliate_id, created_at DESC);

/**
 * One row per commission-bearing event.
 *
 * Accrued from a `transactions` row rather than an order, so a payment plan's
 * three installments produce three commissions if the rule is recurring and one
 * if it is not — and a refund produces a negative row rather than editing the
 * original. An adjustable ledger is a ledger nobody can reconcile.
 */
CREATE TABLE affiliate_commissions (
  id            BIGSERIAL PRIMARY KEY,
  affiliate_id  INT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id      INT REFERENCES orders(id) ON DELETE SET NULL,
  transaction_id INT REFERENCES transactions(id) ON DELETE SET NULL,
  offer_id      INT REFERENCES offers(id) ON DELETE SET NULL,
  payout_id     INT,

  kind          TEXT NOT NULL DEFAULT 'sale'
                  CHECK (kind IN ('sale','renewal','clawback','adjustment')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','paid','reversed','void')),

  -- What the commission was calculated from, kept so a later rate change does
  -- not silently restate history.
  basis_cents   INT NOT NULL DEFAULT 0,
  rate_bps      INT NOT NULL DEFAULT 0,
  amount_cents  INT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'usd',

  -- Commission is not payable until the refund window closes.
  payable_at    TIMESTAMPTZ,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_affiliate_commissions ON affiliate_commissions (affiliate_id, status, created_at DESC);
-- One commission per transaction per affiliate; the accrual job is idempotent
-- against a replayed webhook because of this.
CREATE UNIQUE INDEX idx_affiliate_commissions_txn
  ON affiliate_commissions (transaction_id, kind)
  WHERE transaction_id IS NOT NULL;

CREATE TABLE affiliate_payouts (
  id            SERIAL PRIMARY KEY,
  affiliate_id  INT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount_cents  INT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'usd',
  method        TEXT NOT NULL DEFAULT '',
  reference     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','failed','cancelled')),
  period_start  TIMESTAMPTZ,
  period_end    TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE affiliate_commissions
  ADD CONSTRAINT affiliate_commissions_payout_fk
  FOREIGN KEY (payout_id) REFERENCES affiliate_payouts(id) ON DELETE SET NULL;

CREATE TABLE affiliate_announcements (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL DEFAULT '',
  published     BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/** Creative the partner can use — banners, swipe copy, screenshots. */
CREATE TABLE affiliate_assets (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','swipe','video','document')),
  url           TEXT NOT NULL DEFAULT '',
  body_md       TEXT NOT NULL DEFAULT '',
  offer_id      INT REFERENCES offers(id) ON DELETE CASCADE,
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
