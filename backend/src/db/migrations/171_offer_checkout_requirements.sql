-- 171: what an offer asks of its buyer before payment (QA rows 202 and 203).
--
-- Everything here starts OFF. An offer with no row in offer_checkout_requirements
-- and no offer_contracts.required_before_payment link checks out exactly as it
-- did before this migration. Nothing is seeded: the owner writes the checkbox
-- wording and uploads the approved agreements herself, in the admin.
--
-- offer_checkout_requirements.acknowledgments is a list of
--   {key, version, text, linkLabel, linkUrl, active}
-- `version` goes up whenever the wording or the link changes, so an order can
-- say exactly which wording its buyer ticked (services/checkoutRequirements.ts).
--
-- The program_term ... obligations_note columns are the owner's own words for
-- the enrollment record a buyer reviews beside a required agreement. Prices and
-- schedules are never stored here: they always come from the offer.
--
-- orders.checkout_acknowledgments is the snapshot of what was accepted on that
-- order: wording, version, link, time, IP and browser.
-- Idempotent; nothing to backfill.

CREATE TABLE IF NOT EXISTS offer_checkout_requirements (
  offer_id            INTEGER PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  acknowledgments     JSONB   NOT NULL DEFAULT '[]'::jsonb,
  invitation_required BOOLEAN NOT NULL DEFAULT false,
  program_term        TEXT    NOT NULL DEFAULT '',
  term_months         INTEGER CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 120),
  included_benefits   TEXT    NOT NULL DEFAULT '',
  refund_terms        TEXT    NOT NULL DEFAULT '',
  refund_window_days  INTEGER CHECK (refund_window_days IS NULL OR refund_window_days BETWEEN 0 AND 365),
  obligations_note    TEXT    NOT NULL DEFAULT '',
  updated_by          INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE offer_contracts
  ADD COLUMN IF NOT EXISTS required_before_payment BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS checkout_acknowledgments JSONB NOT NULL DEFAULT '[]'::jsonb;
