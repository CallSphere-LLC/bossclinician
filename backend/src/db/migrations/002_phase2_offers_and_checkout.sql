-- =============================================================================
-- Phase 2 — Offers, checkout & billing
--
-- The commercial model Kajabi runs this business on: 20 products sold behind 57
-- offers. One product, many prices. Today the platform can only sell a `course`
-- row at a single price, which is why 17 courses exist and $0 has ever moved.
--
-- Forward-only and additive. `orders`, `coupons`, `subscriptions` and `invoices`
-- already exist and are extended in place — all four hold 0 rows today, so the
-- widening is free, but nothing here drops or retypes a column regardless.
-- =============================================================================

-- --- products ---------------------------------------------------------------

-- A product is the thing that grants access. It does not carry a price: that
-- belongs to an offer. The concrete resource is referenced by a nullable FK per
-- kind rather than a (type, id) pair, so the database can still enforce
-- referential integrity — a polymorphic integer column cannot.
CREATE TABLE products (
  id                SERIAL PRIMARY KEY,
  slug              TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  subtitle          TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  thumbnail_url     TEXT NOT NULL DEFAULT '',
  kind              TEXT NOT NULL
                      CHECK (kind IN ('course','download','community','coaching',
                                      'podcast','newsletter','access_group','bundle')),
  course_id         INT REFERENCES courses(id) ON DELETE CASCADE,
  community_id      INT REFERENCES communities(id) ON DELETE CASCADE,
  podcast_id        INT REFERENCES podcasts(id) ON DELETE CASCADE,
  newsletter_id     INT REFERENCES newsletters(id) ON DELETE CASCADE,
  coaching_offer_id INT REFERENCES coaching_offers(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','archived')),
  sort              INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A product of kind `course` must name a course; a `bundle` names none and
  -- gets its contents from product_bundle_items. Enforcing it here means a
  -- half-configured product cannot be saved and then fail at delivery time,
  -- which is the worst moment to discover it.
  CONSTRAINT products_resource_matches_kind CHECK (
    (kind = 'course'       AND course_id         IS NOT NULL) OR
    (kind = 'community'    AND community_id      IS NOT NULL) OR
    (kind = 'podcast'      AND podcast_id        IS NOT NULL) OR
    (kind = 'newsletter'   AND newsletter_id     IS NOT NULL) OR
    (kind = 'coaching'     AND coaching_offer_id IS NOT NULL) OR
    (kind IN ('download','access_group','bundle'))
  )
);

CREATE INDEX idx_products_kind   ON products (kind, status);
CREATE INDEX idx_products_course ON products (course_id);

-- Files delivered by a `download` product. Most of this business's Kajabi
-- products are this kind (Practice Protection Pack, Fully Booked Toolkit, …).
CREATE TABLE product_files (
  id            SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id      INT REFERENCES media_assets(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  -- Storage path, never handed to a browser directly. Delivery is always a
  -- signed, expiring URL minted per request — see services/downloads.ts.
  storage_path  TEXT NOT NULL,
  filename      TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  download_count INT NOT NULL DEFAULT 0,
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_files_product ON product_files (product_id, sort);

CREATE TABLE product_bundle_items (
  bundle_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id        INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort              INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_product_id, product_id),
  -- A bundle containing itself is an infinite expansion at delivery time.
  CONSTRAINT bundle_not_self CHECK (bundle_product_id <> product_id)
);

-- --- offers -----------------------------------------------------------------

CREATE TABLE offers (
  id                       SERIAL PRIMARY KEY,
  title                    TEXT NOT NULL,
  slug                     TEXT UNIQUE NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','published','archived')),
  description              TEXT NOT NULL DEFAULT '',
  checkout_headline        TEXT NOT NULL DEFAULT '',
  thumbnail_url            TEXT NOT NULL DEFAULT '',
  currency                 TEXT NOT NULL DEFAULT 'usd',

  pricing_type             TEXT NOT NULL DEFAULT 'one_time'
                             CHECK (pricing_type IN ('one_time','subscription','payment_plan','free','pwyw')),
  -- For one_time: the price. For subscription: the per-interval price.
  -- For payment_plan: the price of ONE installment, not the total — the total
  -- is amount_cents * installment_count, and storing the per-charge figure is
  -- what makes "3 x $1,250" reconcile against three Stripe charges.
  amount_cents             INT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  -- pwyw floor. Ignored for every other pricing_type.
  min_amount_cents         INT NOT NULL DEFAULT 0 CHECK (min_amount_cents >= 0),

  interval                 TEXT CHECK (interval IN ('day','week','month','year')),
  interval_count           INT NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  -- payment_plan only: how many charges before access is paid off.
  installment_count        INT CHECK (installment_count IS NULL OR installment_count > 1),
  trial_days               INT NOT NULL DEFAULT 0 CHECK (trial_days >= 0),

  collect_tax              BOOLEAN NOT NULL DEFAULT false,
  collect_address          BOOLEAN NOT NULL DEFAULT false,
  collect_phone            BOOLEAN NOT NULL DEFAULT false,
  -- Extra order-form questions: [{key,label,type,required,options[]}]
  custom_fields            JSONB NOT NULL DEFAULT '[]',
  terms_url                TEXT NOT NULL DEFAULT '',
  require_terms            BOOLEAN NOT NULL DEFAULT false,

  redirect_url             TEXT NOT NULL DEFAULT '',
  thank_you_page_id        TEXT REFERENCES pages(slug) ON DELETE SET NULL,
  -- NULL = access never expires. Otherwise access_grants.expires_at is set to
  -- purchase time + this many days.
  access_expires_after_days INT CHECK (access_expires_after_days IS NULL OR access_expires_after_days > 0),

  stripe_price_id          TEXT,
  stripe_product_id        TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A subscription with no interval, or a plan with no installment count, is
  -- unchargeable. Catching it here beats discovering it at the till.
  CONSTRAINT offers_recurring_shape CHECK (
    (pricing_type <> 'subscription'  OR interval IS NOT NULL) AND
    (pricing_type <> 'payment_plan'  OR (installment_count IS NOT NULL AND interval IS NOT NULL))
  )
);

CREATE INDEX idx_offers_status ON offers (status, created_at DESC);

CREATE TABLE offer_products (
  offer_id   INT NOT NULL REFERENCES offers(id)   ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, product_id)
);

-- Order bumps: a checkbox on the checkout page that adds a second thing to the
-- same charge. Priced independently of the offer it points at, because the
-- bump price is nearly always a discount off the standalone price.
CREATE TABLE offer_bumps (
  id            SERIAL PRIMARY KEY,
  offer_id      INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  amount_cents  INT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, product_id)
);

-- Post-purchase upsells, walked in `step` order. Declining one shows its
-- downsell if it has one, then moves to the next step.
CREATE TABLE offer_upsells (
  id                SERIAL PRIMARY KEY,
  offer_id          INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  step              INT NOT NULL DEFAULT 1 CHECK (step > 0),
  upsell_offer_id   INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  downsell_offer_id INT REFERENCES offers(id) ON DELETE SET NULL,
  headline          TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, step),
  CONSTRAINT upsell_not_self CHECK (upsell_offer_id <> offer_id)
);

-- --- coupons ----------------------------------------------------------------

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS name              TEXT NOT NULL DEFAULT '';
-- global = every offer; offers = only those in coupon_offers.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS scope             TEXT NOT NULL DEFAULT 'global';
-- forever = discount every charge of a subscription/plan; first = only charge 1.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS duration          TEXT NOT NULL DEFAULT 'first';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS starts_at         TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_per_contact   INT;

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_scope_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_scope_check CHECK (scope IN ('global','offers'));
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_duration_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_duration_check CHECK (duration IN ('first','forever'));

CREATE TABLE coupon_offers (
  coupon_id INT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  offer_id  INT NOT NULL REFERENCES offers(id)  ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, offer_id)
);

-- --- orders -----------------------------------------------------------------

-- The existing table was built around a single course. Everything below is
-- additive; course_id / course_slug / course_title stay so the legacy
-- /checkout/session path keeps working while the offer path is built beside it.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_id          INT REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS member_id         INT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_cents    INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents    INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_cents         INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_cents       INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_cents    INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id         INT REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code       TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_name      TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_phone     TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_address   JSONB NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_field_data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
-- Set on an order created by a post-purchase upsell, pointing at the order the
-- customer bought first. That link is the whole upsell revenue report.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id   INT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'checkout';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes             TEXT NOT NULL DEFAULT '';

-- stripe_session_id is UNIQUE NOT NULL today, which an admin-issued manual
-- order or an upsell charge has no value for. Made nullable, with uniqueness
-- preserved for the rows that do have one.
ALTER TABLE orders ALTER COLUMN stripe_session_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_member ON orders (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_offer  ON orders (offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_email  ON orders (lower(email), created_at DESC);

CREATE TABLE order_items (
  id             SERIAL PRIMARY KEY,
  order_id       INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  offer_id       INT REFERENCES offers(id) ON DELETE SET NULL,
  product_id     INT REFERENCES products(id) ON DELETE SET NULL,
  -- Titles are copied, not joined: a receipt from 2026 must still say what was
  -- bought after the offer is renamed or deleted.
  title          TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT 'offer'
                   CHECK (kind IN ('offer','bump','upsell')),
  quantity       INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cents     INT NOT NULL DEFAULT 0,
  amount_cents   INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

-- --- money movements --------------------------------------------------------

-- One row per actual charge. An order can have many: three installments of a
-- payment plan are one order and three transactions.
CREATE TABLE transactions (
  id                       SERIAL PRIMARY KEY,
  order_id                 INT REFERENCES orders(id) ON DELETE SET NULL,
  subscription_id          INT REFERENCES subscriptions(id) ON DELETE SET NULL,
  member_id                INT REFERENCES members(id) ON DELETE SET NULL,
  email                    TEXT NOT NULL DEFAULT '',
  kind                     TEXT NOT NULL DEFAULT 'payment'
                             CHECK (kind IN ('payment','refund','dispute','payout_adjustment')),
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','succeeded','failed','refunded','disputed')),
  amount_cents             INT NOT NULL DEFAULT 0,
  fee_cents                INT NOT NULL DEFAULT 0,
  net_cents                INT NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  payment_method_brand     TEXT NOT NULL DEFAULT '',
  payment_method_last4     TEXT NOT NULL DEFAULT '',
  payment_method_type      TEXT NOT NULL DEFAULT '',
  country                  TEXT NOT NULL DEFAULT '',
  state                    TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_charge_id         TEXT,
  failure_reason           TEXT NOT NULL DEFAULT '',
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_time   ON transactions (occurred_at DESC);
CREATE INDEX idx_transactions_order  ON transactions (order_id);
CREATE INDEX idx_transactions_member ON transactions (member_id, occurred_at DESC);

CREATE TABLE refunds (
  id                SERIAL PRIMARY KEY,
  order_id          INT REFERENCES orders(id) ON DELETE SET NULL,
  transaction_id    INT REFERENCES transactions(id) ON DELETE SET NULL,
  amount_cents      INT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency          TEXT NOT NULL DEFAULT 'usd',
  reason            TEXT NOT NULL DEFAULT '',
  -- Whether the refund also took the customer's access away.
  revoked_access    BOOLEAN NOT NULL DEFAULT false,
  stripe_refund_id  TEXT UNIQUE,
  created_by_email  TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- payment plans ----------------------------------------------------------

-- Distinct from subscriptions: a plan has an end. "3 x $1,250" stops after the
-- third charge and the customer keeps what they bought; a subscription runs
-- until cancelled and access stops with it.
CREATE TABLE payment_plans (
  id                     SERIAL PRIMARY KEY,
  order_id               INT REFERENCES orders(id) ON DELETE SET NULL,
  offer_id               INT REFERENCES offers(id) ON DELETE SET NULL,
  member_id              INT REFERENCES members(id) ON DELETE SET NULL,
  email                  TEXT NOT NULL DEFAULT '',
  installment_cents      INT NOT NULL DEFAULT 0,
  installment_count      INT NOT NULL DEFAULT 1,
  installments_paid      INT NOT NULL DEFAULT 0,
  currency               TEXT NOT NULL DEFAULT 'usd',
  interval               TEXT NOT NULL DEFAULT 'month',
  interval_count         INT NOT NULL DEFAULT 1,
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','completed','past_due','canceled')),
  next_charge_at         TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  canceled_at            TIMESTAMPTZ,
  cancel_reason          TEXT NOT NULL DEFAULT '',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_plans_status ON payment_plans (status, next_charge_at);

CREATE TABLE payment_plan_installments (
  id              SERIAL PRIMARY KEY,
  payment_plan_id INT NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  sequence        INT NOT NULL,
  amount_cents    INT NOT NULL DEFAULT 0,
  due_at          TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  transaction_id  INT REFERENCES transactions(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','paid','failed','skipped')),
  UNIQUE (payment_plan_id, sequence)
);

-- --- subscriptions ----------------------------------------------------------

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS offer_id            INT REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS interval            TEXT NOT NULL DEFAULT 'month';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS interval_count      INT NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at         TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paused_at           TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ended_at            TIMESTAMPTZ;
-- Kajabi reports on why people leave, so the reason is captured as structured
-- data at cancellation time rather than inferred later from a support inbox.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_reason       TEXT NOT NULL DEFAULT '';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_feedback     TEXT NOT NULL DEFAULT '';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS failed_payment_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_subscriptions_member ON subscriptions (member_id, status);

-- --- invoices & tax ---------------------------------------------------------

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS member_id         INT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id          INT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_plan_id   INT REFERENCES payment_plans(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS number            TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_due_cents  INT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_cents         INT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_url           TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_start      TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_end        TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_member ON invoices (member_id, created_at DESC);

CREATE TABLE tax_records (
  id             SERIAL PRIMARY KEY,
  order_id       INT REFERENCES orders(id) ON DELETE SET NULL,
  transaction_id INT REFERENCES transactions(id) ON DELETE SET NULL,
  country        TEXT NOT NULL DEFAULT '',
  state          TEXT NOT NULL DEFAULT '',
  postal_code    TEXT NOT NULL DEFAULT '',
  -- Basis points, so 8.875% is 887 (rounded) rather than a float that drifts.
  rate_bps       INT NOT NULL DEFAULT 0,
  taxable_cents  INT NOT NULL DEFAULT 0,
  tax_cents      INT NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'usd',
  provider       TEXT NOT NULL DEFAULT 'stripe',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tax_records_place ON tax_records (country, state, created_at DESC);

-- --- abandoned checkouts ----------------------------------------------------

-- The email is persisted the moment it is typed, before payment is attempted.
-- Kajabi reports real revenue recovered from the +1h/+24h/+72h emails, and
-- there is nothing to recover if the address was never stored.
CREATE TABLE abandoned_checkouts (
  id                SERIAL PRIMARY KEY,
  offer_id          INT REFERENCES offers(id) ON DELETE CASCADE,
  email             CITEXT NOT NULL,
  first_name        TEXT NOT NULL DEFAULT '',
  member_id         INT REFERENCES members(id) ON DELETE SET NULL,
  amount_cents      INT NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'usd',
  -- Set when this cart later became a paid order, which is both the exit
  -- condition for the recovery emails and the numerator of the report.
  recovered_order_id INT REFERENCES orders(id) ON DELETE SET NULL,
  recovered_at      TIMESTAMPTZ,
  -- Which of the three recovery emails have gone out.
  emails_sent       INT NOT NULL DEFAULT 0,
  last_email_at     TIMESTAMPTZ,
  session_token     TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, email)
);

CREATE INDEX idx_abandoned_pending
  ON abandoned_checkouts (recovered_at, emails_sent, created_at)
  WHERE recovered_at IS NULL;

-- --- access -----------------------------------------------------------------

-- The single source of truth for "may this member open this product". Every
-- delivery route consults this table and nothing else — not orders, not
-- subscriptions — so there is exactly one place where access can be wrong.
CREATE TABLE access_grants (
  id              SERIAL PRIMARY KEY,
  member_id       INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  product_id      INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offer_id        INT REFERENCES offers(id) ON DELETE SET NULL,
  order_id        INT REFERENCES orders(id) ON DELETE SET NULL,
  subscription_id INT REFERENCES subscriptions(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'purchase'
                    CHECK (source IN ('purchase','manual','automation','bundle','affiliate','import')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','revoked','expired')),
  -- Anchors drip scheduling: "unlock 7 days after enrollment" counts from here,
  -- not from the order date, so a manually granted member drips correctly too.
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  revoke_reason   TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One live grant per member per product. A second purchase of the same thing
  -- refreshes the existing grant rather than creating a duplicate that would
  -- double-count in every "products owned" figure.
  UNIQUE (member_id, product_id)
);

CREATE INDEX idx_access_grants_member ON access_grants (member_id, status);
CREATE INDEX idx_access_grants_expiry ON access_grants (expires_at) WHERE expires_at IS NOT NULL;

-- --- stripe event log -------------------------------------------------------

-- Every webhook body, stored before it is acted on. Two jobs: idempotency (the
-- PK rejects a replayed delivery outright) and forensics — when a payment
-- reconciles wrong, the raw event is the only record of what Stripe actually
-- said.
CREATE TABLE stripe_events (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  api_version    TEXT NOT NULL DEFAULT '',
  payload        JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received','processed','failed','ignored')),
  error          TEXT NOT NULL DEFAULT '',
  attempts       INT NOT NULL DEFAULT 0,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);

CREATE INDEX idx_stripe_events_status ON stripe_events (status, received_at DESC);
CREATE INDEX idx_stripe_events_type   ON stripe_events (type, received_at DESC);

-- --- backfill ---------------------------------------------------------------

-- Every published course becomes a product so the offer editor has something
-- to sell on day one. Offers are NOT generated: pricing is a decision, and
-- inventing 17 of them would put draft prices in front of customers.
INSERT INTO products (slug, title, subtitle, description, thumbnail_url, kind, course_id, status, sort)
SELECT
  c.slug,
  c.title,
  c.subtitle,
  c.description,
  COALESCE(c.image, ''),
  'course',
  c.id,
  CASE WHEN c.published THEN 'published' ELSE 'draft' END,
  c.sort
FROM courses c
ON CONFLICT (slug) DO NOTHING;
