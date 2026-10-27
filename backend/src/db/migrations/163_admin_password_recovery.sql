-- Independent from member identity; resetting a member never resets an admin.
CREATE TABLE IF NOT EXISTS admin_password_resets (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id INT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_password_resets_account
  ON admin_password_resets (admin_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_member_password_resets_created
  ON member_password_resets (member_id, created_at);

-- Reject access JWTs minted before recovery as well as revoking refresh rows.
ALTER TABLE members ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMPTZ;
