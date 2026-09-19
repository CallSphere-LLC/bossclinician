import type { VoiceSurfacePolicy } from "@/voice/contract";
import { PUBLIC_POLICY } from "@/voice/surfaces/public";
import { MEMBER_POLICY } from "@/voice/surfaces/member";
import { ADMIN_POLICY } from "@/voice/surfaces/admin";

export { PUBLIC_POLICY } from "@/voice/surfaces/public";
export { MEMBER_POLICY } from "@/voice/surfaces/member";
export { ADMIN_POLICY } from "@/voice/surfaces/admin";

/**
 * The address roots that belong to the signed-in portal.
 *
 * This is the set of paths `App.tsx` declares inside `RequireMember`, and it has
 * to be kept level with it: a page listed here that is not really guarded would
 * hand a stranger the member concierge, and a guarded page missing from here
 * would give a member the visitor's one instead.
 *
 * `/partners` is the reason this is a list of roots matched segment-wise rather
 * than a prefix test. The public affiliate sign-up lives at `/partners` and a
 * partner's own earnings live at `/partners/dashboard`, so a plain
 * `startsWith("/partners")` would quietly promote every visitor reading the
 * sign-up page.
 */
const MEMBER_ROOTS = [
  "/account",
  "/library",
  "/downloads",
  "/my-events",
  "/community",
  "/coaching",
  "/podcasts",
  "/newsletters",
  "/partners/dashboard",
] as const;

function isUnder(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * Which policy belongs to a pathname.
 *
 * This is the browser's half of role-based access, and it is deliberately the
 * softer half: it decides what the agent is *told* about, while the server
 * re-decides who the caller is from its own cookies on every admission. Asking
 * for more than you are is not an error here either — an anonymous visitor
 * standing on `/admin` gets the public policy and a session the server would
 * have downgraded anyway.
 */
export function policyForPath(pathname: string): VoiceSurfacePolicy {
  // A caller may hand this a full location key (path + search + hash), because
  // that is what `VoiceContext.getLocation` returns.
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  if (path === "/admin" || path.startsWith("/admin/")) return ADMIN_POLICY;
  if (MEMBER_ROOTS.some((root) => isUnder(path, root))) return MEMBER_POLICY;
  return PUBLIC_POLICY;
}
