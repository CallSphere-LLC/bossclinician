-- =============================================================================
-- 232: Retreat balance plans: larger last payments ("step-up").
--
-- The owner's answer for the Bali 2027 guests: keep each guest's charge day,
-- and let the last few payments be larger so the balance is paid off by the
-- final deadline. A plan can now be "4 payments of $400, then 2 payments of
-- $600" instead of only N equal payments.
--
--   installment_count      stays the TOTAL number of payments.
--   installment_cents      stays the regular amount (the first payments).
--   step_up_cents          the amount of each of the LAST step_up_count payments.
--   step_up_count          how many final payments use step_up_cents. 0 = none.
--   schedule_installed_at  when Stripe confirmed the subscription schedule that
--                          carries the larger phase. NULL on a stepped plan that
--                          is billing means the larger payments are NOT set up
--                          yet; the hourly job retries and alerts the owner.
--
-- One column is an addition to the written brief, for the alert rule ("on the
-- first failure and then daily"):
--   schedule_alerted_at    when the owner was last told the schedule is not
--                          installed.
--
-- The even-balance rule is replaced by the stepped equation. Every existing row
-- has step_up 0 / 0, for which the new rule is exactly the old one.
--
-- Nothing is charged, sent or changed for any guest by this migration.
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD.
-- =============================================================================

ALTER TABLE retreat_balance_plans
  ADD COLUMN IF NOT EXISTS step_up_cents         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_up_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_installed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_alerted_at   TIMESTAMPTZ;

DO $m232$
BEGIN
  -- What is still to be charged from here is exactly the regular payments plus
  -- the larger ones. There is never an odd payment outside those two amounts.
  ALTER TABLE retreat_balance_plans DROP CONSTRAINT IF EXISTS retreat_balance_plans_even_balance;
  ALTER TABLE retreat_balance_plans ADD CONSTRAINT retreat_balance_plans_even_balance
    CHECK (agreed_total_cents - prior_paid_cents - carried_paid_cents
           = installment_cents * (installment_count - step_up_count) + step_up_cents * step_up_count);

  -- At least one regular payment comes first, both step-up fields are set or
  -- neither is, and a larger payment really is larger.
  ALTER TABLE retreat_balance_plans DROP CONSTRAINT IF EXISTS retreat_balance_plans_step_up_shape;
  ALTER TABLE retreat_balance_plans ADD CONSTRAINT retreat_balance_plans_step_up_shape
    CHECK (step_up_count >= 0
           AND step_up_cents >= 0
           AND step_up_count < installment_count
           AND (step_up_count = 0) = (step_up_cents = 0)
           AND (step_up_count = 0 OR step_up_cents > installment_cents));
END
$m232$;
