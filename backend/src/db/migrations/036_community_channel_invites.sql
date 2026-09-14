-- Community: per-channel invites, and an offer that grants a tier.
--
-- Two gaps found by the 4 Sep verification round, both of them promises the
-- UI already made and the schema could not keep.

/* ---------------------------------------------------- invite-only channels */

-- `community_channels.visibility = 'private'` has existed since the baseline and
-- has always been described in the admin as "Invited members only". There was
-- nowhere to record an invitation, so the member-side queries could only fall
-- back to "moderators and admins" — which means a channel created private was
-- invisible to every single member of the community, for ever, with no way to
-- let anybody in. The setting was a dead end rather than a restriction.
--
-- One row per person let into one channel. Deliberately NOT derived from a
-- purchase: this is the hand-picked list (a cohort, a pilot group, the three
-- people writing the newsletter), and the derived-from-a-grant case is what
-- access groups are for. Both are honoured, independently.
CREATE TABLE IF NOT EXISTS community_channel_members (
  channel_id integer NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  member_id  integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, member_id)
);

-- The member-side lookup is "which of these channels am I in", so the member
-- leads the index; the primary key already covers the other direction.
CREATE INDEX IF NOT EXISTS idx_channel_members_member
  ON community_channel_members (member_id);

/* ------------------------------------------------- an offer grants a tier */

-- Products and plans could already name an access group (034). An offer could
-- not, which is the half the admin actually sells: the offer editor's own copy
-- says "an offer can grant it" and there was no column for it to write to.
--
-- Read through a LIVE grant, never copied into community_access_group_members,
-- for the reason 034 gives at length: a row nobody deletes is a door that never
-- closes, and a refunded member would keep the tier. `access_grants.offer_id`
-- already records which offer produced a grant, so the tier lapses exactly when
-- the access does.
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS access_group_id integer
    REFERENCES community_access_groups(id) ON DELETE SET NULL;

-- Answers "which offers grant this tier" for the admin screen without scanning
-- the offer table; partial because almost every offer grants no tier at all.
CREATE INDEX IF NOT EXISTS idx_offers_access_group
  ON offers (access_group_id)
  WHERE access_group_id IS NOT NULL;
