-- =============================================================================
-- Phase 3 (follow-up) — why a community membership exists
--
-- Entitlement to a paid room is decided by `access_grants`, which is right: a
-- membership row is a record of standing (points, badges, role, history) and is
-- deliberately kept when a refund revokes the grant behind it, so it must never
-- be the thing that opens the door.
--
-- But three enrolment paths write a membership and no grant at all:
--   * the Stripe webhook, for a plan subscription that unlocks a community
--     (`plans.community_id`) — there is no product involved, so no grant exists
--   * an admin adding somebody by hand from /admin/community
--   * the `join_community` automation action
--
-- Judging those by grants alone locks out the very people who paid: a member on
-- a £49/mo plan whose room is marked sold gets a 404 on the room their
-- subscription is for. Recording WHY a membership exists lets the door tell an
-- entitlement that was never expressed as a grant from one that has been
-- revoked.
-- =============================================================================

ALTER TABLE community_memberships
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE community_memberships DROP CONSTRAINT IF EXISTS community_memberships_source_check;
ALTER TABLE community_memberships ADD CONSTRAINT community_memberships_source_check
  CHECK (source IN ('purchase', 'plan', 'manual', 'automation', 'free'));

-- Existing rows default to 'manual', which is the safe reading: every one of
-- them was created either by an admin or by a plan purchase, and both are
-- entitlements in their own right. Defaulting to 'purchase' would instead make
-- them depend on a grant that was never written, shutting out current members
-- the moment this deploys.

-- The subscription behind a plan-sourced membership, so cancelling the
-- subscription can close the room. Without it, a lapsed subscriber keeps a
-- membership nothing can connect back to the payment that justified it.
ALTER TABLE community_memberships
  ADD COLUMN IF NOT EXISTS subscription_id INT REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_memberships_source
  ON community_memberships (community_id, source);
