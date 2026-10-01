/**
 * The member session policy, browser side.
 *
 * Two clocks end a member session (see backend/src/auth/memberSessionPolicy.ts
 * for the server's half, which is the one that cannot be argued with):
 *
 *   - IDLE — 30 minutes with no mouse, keyboard, touch or scroll, no playing
 *     video and no live call. A warning comes up two minutes before, with
 *     "Stay signed in". Shared across tabs through localStorage, so reading in
 *     one tab keeps the others signed in and signing out in one ends them all.
 *   - ABSOLUTE — 12 hours after signing in, however active.
 *
 * The idle length is the server's to decide: every login and refresh returns
 * it, and `setIdleTimeoutSeconds` adopts it, so one environment variable on the
 * backend moves both halves. The constant below is only the value used before
 * the first answer arrives.
 *
 * Everything that touches storage is wrapped: private windows, blocked site
 * data and SSR all make it throw or vanish, and an idle timer that crashes the
 * page is worse than one that falls back to this tab's own memory.
 */

/** Fallback idle window until the server says otherwise. */
export const MEMBER_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** How long before the idle sign-out the warning dialog appears. */
export const MEMBER_IDLE_WARNING_MS = 2 * 60 * 1000;
/** How often the open tab checks the clocks. */
export const IDLE_CHECK_INTERVAL_MS = 5_000;
/** Activity is written to shared storage at most this often. */
export const ACTIVITY_WRITE_THROTTLE_MS = 10_000;
/** While active, the server hears "still here" at most this often. */
export const ACTIVITY_REPORT_INTERVAL_MS = 60_000;

const LAST_ACTIVITY_KEY = "bc_member_last_activity";
export const SIGNOUT_BROADCAST_KEY = "bc_member_signout";
const SIGNOUT_REASON_KEY = "bc_member_signout_reason";
/** A stored reason older than this is no longer news. */
const REASON_TTL_MS = 30 * 60 * 1000;

let idleTimeoutMs = MEMBER_IDLE_TIMEOUT_MS;
let absoluteExpiresAt: number | null = null;
let memoryLastActivity = Date.now();

export function getIdleTimeoutMs(): number {
  return idleTimeoutMs;
}

/**
 * The warning lead, shortened when QA has set a tiny idle window so the dialog
 * is never up for longer than the session it is warning about.
 */
export function getIdleWarningMs(): number {
  return Math.min(MEMBER_IDLE_WARNING_MS, Math.floor(idleTimeoutMs / 4));
}

export function getAbsoluteExpiresAt(): number | null {
  return absoluteExpiresAt;
}

export interface SessionPolicyPayload {
  idleTimeoutSeconds?: number;
  expiresAt?: string;
}

/** Adopts the policy the server sent with a login or refresh. */
export function applySessionPolicy(policy: SessionPolicyPayload | undefined | null): void {
  if (!policy) return;
  if (typeof policy.idleTimeoutSeconds === "number" && policy.idleTimeoutSeconds >= 60) {
    idleTimeoutMs = policy.idleTimeoutSeconds * 1000;
  }
  if (policy.expiresAt) {
    const at = new Date(policy.expiresAt).getTime();
    if (Number.isFinite(at)) absoluteExpiresAt = at;
  }
}

export function resetSessionPolicy(): void {
  absoluteExpiresAt = null;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The last moment any tab saw the member, in ms since the epoch. */
export function readLastActivity(): number {
  try {
    const raw = Number(storage()?.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(raw) && raw > 0) return Math.max(raw, memoryLastActivity);
  } catch {
    // fall through to this tab's own memory
  }
  return memoryLastActivity;
}

export function writeLastActivity(at = Date.now()): void {
  memoryLastActivity = at;
  try {
    storage()?.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    // Storage full or blocked: this tab still remembers.
  }
}

/** Whole seconds since the member was last seen — the refresh/heartbeat header. */
export function idleSecondsNow(): number {
  return Math.max(0, Math.floor((Date.now() - readLastActivity()) / 1000));
}

export function isLastActivityKey(key: string | null): boolean {
  return key === LAST_ACTIVITY_KEY;
}

// ---- Why the member was signed out -----------------------------------------

export type SignOutReason = "idle" | "expired";

/**
 * Remembers why a session just ended, for the sign-in page to say so. Kept in
 * sessionStorage (this tab) because the redirect happens a render later, in
 * RequireMember, which has no other way to know.
 */
export function noteSignOutReason(reason: SignOutReason): void {
  try {
    session()?.setItem(SIGNOUT_REASON_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    // The redirect still happens; only the explanation is lost.
  }
}

export function peekSignOutReason(): SignOutReason | null {
  try {
    const raw = session()?.getItem(SIGNOUT_REASON_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { reason?: string; at?: number };
    if (!parsed.at || Date.now() - parsed.at > REASON_TTL_MS) return null;
    return parsed.reason === "idle" || parsed.reason === "expired" ? parsed.reason : null;
  } catch {
    return null;
  }
}

export function clearSignOutReason(): void {
  try {
    session()?.removeItem(SIGNOUT_REASON_KEY);
  } catch {
    // nothing to clear
  }
}

/** Tells every other open tab that this session is over. */
export function broadcastSignOut(reason: SignOutReason | "manual"): void {
  try {
    storage()?.setItem(SIGNOUT_BROADCAST_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    // Other tabs will find out on their next refresh instead.
  }
}

export function parseSignOutBroadcast(value: string | null): SignOutReason | "manual" | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { reason?: string };
    if (parsed.reason === "idle" || parsed.reason === "expired" || parsed.reason === "manual") {
      return parsed.reason;
    }
  } catch {
    // ignore a value some other code wrote
  }
  return null;
}

/** The words the sign-in page shows for each reason. */
export function signOutReasonMessage(reason: string | null): string | null {
  if (reason === "idle") {
    return "You were signed out due to inactivity. Please sign in again to continue where you left off.";
  }
  if (reason === "expired") {
    return "Your session has ended. For your security we sign you out a few hours after you sign in — please sign in again to continue.";
  }
  return null;
}
