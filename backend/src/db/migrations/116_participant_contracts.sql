-- Immutable PDF snapshots and per-member signing assignments.
CREATE TABLE IF NOT EXISTS participant_contracts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  storage_ref TEXT NOT NULL UNIQUE,
  pdf_sha256 CHAR(64) NOT NULL,
  created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS participant_contract_assignments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES participant_contracts(id) ON DELETE RESTRICT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ,
  signed_name TEXT,
  signed_email TEXT,
  signer_ip TEXT,
  signer_user_agent TEXT,
  disclosure_version TEXT,
  evidence_sha256 CHAR(64),
  UNIQUE(contract_id, member_id)
);
CREATE INDEX IF NOT EXISTS participant_contract_assignments_member_idx ON participant_contract_assignments(member_id, status);
CREATE TABLE IF NOT EXISTS participant_contract_events (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES participant_contract_assignments(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('assigned','viewed','signed')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  actor_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  ip TEXT,
  user_agent TEXT,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash CHAR(64),
  event_hash CHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS participant_contract_events_assignment_idx ON participant_contract_events(assignment_id,id);
