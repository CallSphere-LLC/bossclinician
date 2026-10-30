-- 172: agreements signed before payment, and invitations to enroll (QA row 202).
--
-- order_agreement_signatures: a buyer may be a guest with no member account, and
-- participant_contract_assignments needs a member, so the signature is recorded
-- against the order when checkout opens it, before any charge. When the payment
-- succeeds, fulfillment turns it into an ordinary signed assignment (with the
-- same audit chain as signing on the Contracts page) so the member and the admin
-- see it in the usual places. This row stays as the record of that enrollment,
-- including the payment terms accepted, even if the same person enrolls again.
--
-- offer_enrollment_invitations: an offer can be limited to people the owner has
-- approved (The Boardroom). Only a hash of the link's token is stored. A row is
-- only ever created by an admin pressing the button; deploying sends nothing.
-- Idempotent; nothing to backfill.

CREATE TABLE IF NOT EXISTS offer_enrollment_invitations (
  id                 BIGSERIAL PRIMARY KEY,
  offer_id           INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  email              TEXT    NOT NULL,
  full_name          TEXT    NOT NULL DEFAULT '',
  token_hash         CHAR(64) NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  completed_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  completed_at       TIMESTAMPTZ,
  created_by         INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offer_enrollment_invitations_offer_idx
  ON offer_enrollment_invitations (offer_id, id DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS enrollment_invitation_id BIGINT REFERENCES offer_enrollment_invitations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS order_agreement_signatures (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  offer_id           INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  offer_title        TEXT    NOT NULL DEFAULT '',
  contract_id        BIGINT  NOT NULL REFERENCES participant_contracts(id) ON DELETE RESTRICT,
  contract_title     TEXT    NOT NULL,
  pdf_sha256         CHAR(64) NOT NULL,
  signer_member_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  signed_name        TEXT    NOT NULL,
  signed_email       TEXT    NOT NULL,
  signer_ip          TEXT    NOT NULL DEFAULT '',
  signer_user_agent  TEXT    NOT NULL DEFAULT '',
  disclosure_version TEXT    NOT NULL,
  disclosure_text    TEXT    NOT NULL,
  intent_text        TEXT    NOT NULL,
  enrollment_terms   JSONB   NOT NULL DEFAULT '{}'::jsonb,
  evidence_sha256    CHAR(64) NOT NULL,
  signed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignment_id      BIGINT REFERENCES participant_contract_assignments(id) ON DELETE SET NULL,
  copy_emailed_at    TIMESTAMPTZ,
  UNIQUE (order_id, contract_id)
);
CREATE INDEX IF NOT EXISTS order_agreement_signatures_email_idx
  ON order_agreement_signatures (signed_email, id DESC);
CREATE INDEX IF NOT EXISTS order_agreement_signatures_contract_idx
  ON order_agreement_signatures (contract_id, id DESC);
