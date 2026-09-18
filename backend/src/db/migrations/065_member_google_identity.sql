-- "Continue with Google" for members (routes/auth/googleAuth.ts).
--
-- `google_sub` is Google's permanent identifier for an account — the `sub`
-- claim of its id_token. The address is how a Google identity finds its member
-- the FIRST time; after that the subject is the join, because addresses change
-- on both sides and the subject never does. It is also the takeover guard: an
-- address already joined to one subject is refused to a different one, which is
-- what a reissued mailbox or a Workspace domain that changed hands looks like.
--
-- Nullable: most members will never use Google, and a password or magic-link
-- member has nothing to put here.
--
-- The index is partial because UNIQUE over a nullable column is the intent
-- either way, and saying so keeps every NULL out of the index rather than
-- storing one entry per member who signs in some other way.
--
-- Same conventions as the rest of this directory: IF NOT EXISTS throughout, so
-- running it twice is a no-op.
ALTER TABLE members ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS members_google_sub_key
  ON members (google_sub)
  WHERE google_sub IS NOT NULL;

COMMENT ON COLUMN members.google_sub IS
  'Google account subject (id_token `sub`). Set on first "Continue with Google"; never the email address.';
