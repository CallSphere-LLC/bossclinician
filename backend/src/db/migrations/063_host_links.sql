-- =============================================================================
-- Host links — how an admin gets into her own live room
--
-- The live room only admits member sessions, and an admin is not a member: a
-- different table, a different origin, a different cookie. Rather than teach
-- the room a second kind of identity, the admin panel mints a one-time link
-- that signs the admin's browser into the customer site as the member account
-- carrying her email address, and lands her in the room.
--
-- Those links live beside magic links because they are the same object — a
-- hashed single-use bearer token for one member — but they must not be the same
-- *credential*. Magic links are a setting, and production has it switched off;
-- a host link has to work regardless, and a magic link must never be redeemable
-- through the host endpoint or the other way round. `purpose` is what keeps the
-- two apart: each consume endpoint claims only its own.
--
-- Every existing row is a magic link, which is what the default says.
-- =============================================================================

ALTER TABLE member_magic_links
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'signin';

ALTER TABLE member_magic_links DROP CONSTRAINT IF EXISTS member_magic_links_purpose_check;
ALTER TABLE member_magic_links ADD CONSTRAINT member_magic_links_purpose_check
  CHECK (purpose IN ('signin', 'host'));
