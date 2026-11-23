-- =============================================================================
-- 230: Retreat balance plans (card on file + automatic monthly charges).
--
-- Three Bali 2027 guests were on Kajabi-billed payment plans and Kajabi is
-- closing. The owner sets each guest's numbers in the retreat organizer, opens
-- the plan, the guest adds a card on her retreat dashboard and agrees to the
-- schedule, and the balance is then charged monthly through an ordinary Stripe
-- subscription that the existing payment_plans machinery already tracks
-- (services/retreatBalancePlans.ts).
--
-- Ships with NOTHING switched on for anybody:
--   * No plan row is created here. No guest is offered anything until the owner
--     creates a plan for her AND opens it.
--   * No card is charged by this migration, and no email is sent.
--   * The hourly job below does nothing while no plan is `card_on_file`.
--
-- Two rules the table itself enforces:
--   * The balance must divide evenly: what is still to be charged from here
--     (agreed total, less what was paid before this plan, less what earlier
--     subscriptions of this same plan already collected) is exactly
--     installment_cents x installment_count. There is never an odd final payment.
--   * A plan cannot be `card_on_file` or `billing` without a recorded
--     authorisation and a saved card.
--
-- Three columns are additions to the written brief, each for a safety reason:
--   carried_paid_cents     what earlier subscriptions of this plan collected,
--                          frozen when a defaulted plan returns to `open` with
--                          the unpaid count (keeps the even-division rule true).
--   billing_attempts       counts claims, and is part of the Stripe idempotency
--                          key for creating the subscription.
--   subscription_ended_at  when the finished plan's Stripe subscription was
--                          confirmed cancelled, so no further cycle can bill.
--
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retreat_balance_plans (
  id                       SERIAL PRIMARY KEY,
  retreat_id               INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id                INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The room price AFTER any discount.
  agreed_total_cents       INTEGER NOT NULL CHECK (agreed_total_cents > 0),
  -- Display only: already subtracted from agreed_total_cents.
  discount_cents           INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  discount_note            TEXT NOT NULL DEFAULT '',
  -- Paid before this plan existed (Kajabi).
  prior_paid_cents         INTEGER NOT NULL DEFAULT 0 CHECK (prior_paid_cents >= 0),
  -- Paid on this site by earlier subscriptions of this plan (set on a reopen).
  carried_paid_cents       INTEGER NOT NULL DEFAULT 0 CHECK (carried_paid_cents >= 0),
  installment_cents        INTEGER NOT NULL CHECK (installment_cents > 0),
  installment_count        INTEGER NOT NULL CHECK (installment_count BETWEEN 1 AND 36),
  first_charge_on          DATE NOT NULL,
  final_due_on             DATE,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'open', 'card_on_file', 'billing', 'completed', 'canceled')),
  -- No owner notices for test guests.
  is_test                  BOOLEAN NOT NULL DEFAULT false,
  stripe_customer_id       TEXT,
  stripe_payment_method_id TEXT,
  card_brand               TEXT,
  card_last4               TEXT,
  authorized_at            TIMESTAMPTZ,
  authorization_text       TEXT NOT NULL DEFAULT '',
  authorized_ip            TEXT NOT NULL DEFAULT '',
  card_added_at            TIMESTAMPTZ,
  billing_started_at       TIMESTAMPTZ,
  billing_attempts         INTEGER NOT NULL DEFAULT 0,
  subscription_ended_at    TIMESTAMPTZ,
  owner_notified_at        TIMESTAMPTZ,
  request_email_sent_at    TIMESTAMPTZ,
  last_error               TEXT NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (retreat_id, member_id),
  CONSTRAINT retreat_balance_plans_even_balance
    CHECK (agreed_total_cents - prior_paid_cents - carried_paid_cents = installment_cents * installment_count),
  CONSTRAINT retreat_balance_plans_card_needs_consent
    CHECK (status NOT IN ('card_on_file', 'billing')
           OR (authorized_at IS NOT NULL AND stripe_payment_method_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_retreat_balance_plans_member ON retreat_balance_plans (member_id);
-- The hourly job reads the few rows that are waiting to start or are billing.
CREATE INDEX IF NOT EXISTS idx_retreat_balance_plans_live
  ON retreat_balance_plans (status, first_charge_on)
  WHERE status IN ('card_on_file', 'billing');

-- The subscription a balance plan bills through is an ordinary payment plan
-- (order_id NULL, offer_id NULL), linked back here. One balance plan can have
-- several over its life: a defaulted one stays as history and a new one starts
-- when the guest adds a card again.
ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS retreat_balance_plan_id INTEGER REFERENCES retreat_balance_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_plans_retreat_balance
  ON payment_plans (retreat_balance_plan_id)
  WHERE retreat_balance_plan_id IS NOT NULL;

-- Hourly: start billing on the first charge date (Pacific) and keep the plan's
-- state in step with its subscription. A no-op while no plan has a card.
INSERT INTO job_schedules (name, kind, every_minutes, timezone)
VALUES ('retreat-balance-start', 'retreatBalance.start', 60, 'America/Los_Angeles')
ON CONFLICT (name) DO NOTHING;
