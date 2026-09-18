-- "Sign in with Google" for the admin (routes/admin/googleAuth.ts).
--
-- The same column as 065 gave members, for the same reasons: `google_sub` is
-- Google's permanent identifier for an account — the `sub` claim of its
-- id_token. The address is how a Google identity finds its admin the FIRST
-- time; after that the subject is the join, because addresses change on both
-- sides and the subject never does. It is also the takeover guard: an address
-- already joined to one subject is refused to a different one, which is what a
-- reissued mailbox or a Workspace domain that changed hands looks like.
--
-- One difference from members, and it is in the router rather than here: no
-- admin is ever CREATED by a Google sign-in. This column is only ever filled in
-- on a row an owner's invitation already made.
--
-- Nullable: an admin who only ever uses their password has nothing to put here.
--
-- The index is partial because UNIQUE over a nullable column is the intent
-- either way, and saying so keeps every NULL out of the index.
--
-- Same conventions as the rest of this directory: IF NOT EXISTS throughout, so
-- running it twice is a no-op.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_google_sub_key
  ON admin_users (google_sub)
  WHERE google_sub IS NOT NULL;

COMMENT ON COLUMN admin_users.google_sub IS
  'Google account subject (id_token `sub`). Set on first "Sign in with Google"; never the email address.';
