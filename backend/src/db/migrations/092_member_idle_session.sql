-- =============================================================================
-- 092 — member idle timeout + a 12-hour absolute session cap
--
-- QA sheet: "customer dashboard is not signing off after a certain period of
-- time". Member sessions lasted 30 days from sign-in and every open tab
-- refreshed itself forever, so nobody was ever signed out in practice.
--
-- The policy (backend/src/auth/memberSessionPolicy.ts):
--   * idle: a session that has not reported real activity for 30 minutes is
--     ended on its next refresh (revoked_reason = 'idle');
--   * absolute: expires_at is 12 hours after sign-in, carried across rotations.
-- =============================================================================

-- When the member was last actually here — input, a playing video, a live
-- call — as reported by the browser on each refresh. Distinct from
-- last_used_at, which a background refresh from an idle tab also moves.
-- Carried forward onto each rotated successor row.
ALTER TABLE member_sessions
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- Live rows from before this migration: the best evidence of activity is when
-- the row was minted (each rotation mints a new one).
UPDATE member_sessions
   SET last_active_at = COALESCE(last_used_at, created_at)
 WHERE revoked_at IS NULL
   AND last_active_at IS NULL;

-- Bring sessions issued under the old 30-day lifetime inside the new 12-hour
-- cap, measured from now so nobody is thrown out the moment this deploys.
UPDATE member_sessions
   SET expires_at = LEAST(expires_at, now() + interval '12 hours')
 WHERE revoked_at IS NULL
   AND expires_at > now() + interval '12 hours';
