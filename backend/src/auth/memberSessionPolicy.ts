/**
 * The member session policy. Two clocks, both enforced here on the server and
 * mirrored in the browser (hooks/useMemberIdle.tsx), which learns the idle
 * value from the login/refresh response rather than keeping its own copy:
 *
 *   - IDLE: a session nobody has touched for this long is over. "Touched"
 *     means the browser reported real activity (input, a playing video, a live
 *     call) on a refresh — a tab left open on a lesson does not count, because
 *     its silent refreshes report how long it has been idle. A refresh cookie
 *     presented after the window is revoked with reason 'idle'.
 *   - ABSOLUTE: however active the member is, the session ends this long after
 *     sign-in. `expires_at` is set once at issue and carried across every
 *     rotation, so this is a hard deadline, not a sliding one.
 *
 * Both can be overridden by environment (minutes / hours) so QA can watch the
 * idle sign-out happen in two minutes instead of thirty.
 */
function envNumber(name: string, fallback: number, min: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min ? raw : fallback;
}

export const MEMBER_IDLE_TIMEOUT_SECONDS = Math.round(
  envNumber("MEMBER_IDLE_TIMEOUT_MINUTES", 30, 1) * 60
);
export const MEMBER_SESSION_MAX_SECONDS = Math.round(
  envNumber("MEMBER_SESSION_MAX_HOURS", 12, 1) * 60 * 60
);
/**
 * Slack on top of the idle window before the server refuses a session. The
 * browser signs itself out at exactly MEMBER_IDLE_TIMEOUT_SECONDS; the server
 * only hears about activity on a heartbeat or refresh, so without this a member
 * who pressed "Stay signed in" in the last seconds could lose the race.
 */
export const MEMBER_IDLE_GRACE_SECONDS = 60;
export const MEMBER_IDLE_LIMIT_SECONDS = MEMBER_IDLE_TIMEOUT_SECONDS + MEMBER_IDLE_GRACE_SECONDS;

/** Kept under its old name: it is the absolute cap described above. */
export const REFRESH_TOKEN_TTL_SECONDS = MEMBER_SESSION_MAX_SECONDS;

/** What the browser needs to run the same clocks. Sent with every login and refresh. */
export interface MemberSessionPolicy {
  idleTimeoutSeconds: number;
  expiresAt: string;
}

export function sessionPolicy(expiresAt?: string | Date): MemberSessionPolicy {
  return {
    idleTimeoutSeconds: MEMBER_IDLE_TIMEOUT_SECONDS,
    expiresAt: new Date(
      expiresAt ?? Date.now() + MEMBER_SESSION_MAX_SECONDS * 1000
    ).toISOString(),
  };
}

/** The header the browser reports its idle time in, on every refresh. */
export const IDLE_HEADER = "x-member-idle-seconds";

/**
 * How long the browser says it has been idle. Absent or garbled reads as 0 —
 * an old bundle that predates the header is treated as active, which is safe
 * because the check that matters runs against the stored timestamp before
 * this is ever applied.
 */
export function reportedIdleSeconds(header: string | undefined): number {
  const value = Number(header);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MEMBER_SESSION_MAX_SECONDS);
}
