-- Credentials previously scoped to the shared site must not be replayable at
-- the dedicated admin origin. Sign in once at the new host after rollout.
UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;
