-- 149: contracts an offer asks its buyer to sign.
--
-- services/offerContracts.ts reads this inside fulfillPayment: every contract
-- linked to an offer in a paid order is assigned to the member who receives
-- access (the gift recipient on a gift), exactly as a manual assignment from
-- Coaching > Contracts would be. UNIQUE(contract_id, member_id) on
-- participant_contract_assignments keeps a repeat purchase from assigning the
-- same contract twice.
--
-- source_order_id / source_offer_id record which purchase created an
-- assignment, so admin and member screens can say "included with <offer>".
-- Both are NULL for a manual assignment. Idempotent; nothing to backfill.

CREATE TABLE IF NOT EXISTS offer_contracts (
  offer_id    INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  contract_id BIGINT  NOT NULL REFERENCES participant_contracts(id) ON DELETE CASCADE,
  created_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, contract_id)
);

CREATE INDEX IF NOT EXISTS offer_contracts_contract_idx ON offer_contracts (contract_id);

ALTER TABLE participant_contract_assignments
  ADD COLUMN IF NOT EXISTS source_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL;
