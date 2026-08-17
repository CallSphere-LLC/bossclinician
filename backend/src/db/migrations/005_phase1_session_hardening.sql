-- =============================================================================
-- Phase 1 (follow-up) — session hardening + a CRUD-factory defect
--
-- Both changes come out of the pre-deploy security review.
-- =============================================================================

-- Why a session was revoked, which the reuse-detection branch has to know.
--
-- Rotation and logout both set `revoked_at`, and treating them alike is what
-- made ordinary behaviour look like token theft:
--
--   * Two tabs refreshing at the same instant: the first rotates the row, the
--     second finds it revoked and burns every session the member has. Both
--     devices are signed out for doing nothing wrong.
--   * "Sign out this device" from another device: the signed-out device's next
--     silent refresh presents its now-revoked token, which was read as theft
--     and signed out the device that issued the revocation too.
--
-- Recording the reason lets rotation be forgiven inside a short grace window
-- while a genuinely replayed token still burns the chain.
ALTER TABLE member_sessions
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT NOT NULL DEFAULT '';

-- Finding the live successor of a rotated row has to be an indexed lookup: it
-- happens on the hot path of every concurrent refresh.
CREATE INDEX IF NOT EXISTS idx_member_sessions_previous
  ON member_sessions (previous_id) WHERE previous_id IS NOT NULL;

-- createCrudRepo.update() always writes `updated_at`, so every table reachable
-- through the shared CRUD factory needs the column. `automation_actions` is
-- exposed through it and does not have one, so editing an automation's action
-- fails at runtime with a missing-column error.
ALTER TABLE automation_actions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
