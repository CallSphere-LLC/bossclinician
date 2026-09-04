-- Separate human browser sign-ins from internal API acceptance clients.
-- Every token still has a server-side session row so it can be revoked; the
-- security screen only describes sessions a person could recognise as a device.
ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS interactive BOOLEAN NOT NULL DEFAULT true;

UPDATE admin_sessions
   SET interactive = false,
       revoked_at = COALESCE(revoked_at, now())
 WHERE ip IN ('127.0.0.1', '::1', '::ffff:127.0.0.1')
    OR user_agent ~* '^(node|curl|wget|codex)';

CREATE INDEX IF NOT EXISTS idx_admin_sessions_visible
  ON admin_sessions (admin_user_id, last_used_at DESC)
  WHERE interactive = true AND revoked_at IS NULL;
