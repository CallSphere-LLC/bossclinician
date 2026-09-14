-- End every legacy browser bearer at rollout; copied seven-day credentials must
-- not survive moving storage. Existing administrators sign in once again.
ALTER TABLE admin_sessions ADD COLUMN refresh_hash TEXT UNIQUE;
UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;
