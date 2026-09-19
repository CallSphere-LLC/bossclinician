import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { VoiceSurfacePolicy } from "@/voice/contract";
import { ADMIN_POLICY, MEMBER_POLICY, PUBLIC_POLICY, policyForPath } from "@/voice/surfaces";

/**
 * Where the concierge is actually attached to the app.
 *
 * Two rules shape everything here, and both are easy to break by accident.
 *
 * The first is that `entry-server` renders this tree to HTML on a Node process
 * with no `window`, so nothing voice-related may be reached during that render.
 * The launcher is therefore `React.lazy` AND gated behind a state flag that only
 * an effect can set: `lazy` alone still lets React begin resolving the chunk
 * during a client render, and the concierge's own modules touch `navigator`,
 * `RTCPeerConnection` and the audio APIs at import time. Waiting for an effect
 * also keeps the whole voice bundle off the critical path of first paint, which
 * is the other thing we want.
 *
 * The second is that a live call lives in a `RTCPeerConnection` owned by the
 * launcher's React tree. If the element unmounts, the call ends. That is why
 * each mount below sits at the one node of the router tree that survives every
 * navigation inside its surface — not inside a page, and not inside a shell
 * that pages render for themselves.
 */

/** One shared chat launcher owns both typed and spoken conversations. */
const ChatWidget = lazy(() =>
  import("@/components/ChatWidget").then((module) => ({ default: module.ChatWidget })),
);

/**
 * `theme` is not decoration: the concierge's UI is drawn entirely in semantic
 * tokens — `surface-raised`, `ink`, `hairline`, `gold` — and those tokens are
 * declared on `.theme-luxe` and `.theme-console`. An element outside both still
 * renders, but against the legacy light palette, which looks right on the
 * public site and quietly wrong on the dark admin.
 *
 * The two mounts that cannot sit inside their shell carry the class themselves.
 * The wrapper is a bare `div` with no styling of its own, and the launcher
 * inside it is fixed-positioned, so it declares a theme and occupies no space.
 */
function VoiceMount({
  policy,
  theme,
}: {
  policy: VoiceSurfacePolicy;
  theme?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const concierge = (
    <Suspense fallback={null}>
      <ChatWidget key={policy.surface} />
    </Suspense>
  );
  return theme ? <div className={theme}>{concierge}</div> : concierge;
}

/**
 * The public concierge, mounted beside the app's one `<Routes>` rather than
 * inside `Layout`.
 *
 * `Layout` wraps the marketing pages, but not the cart, not checkout and not
 * the sign-in screens — all of which are public-surface addresses a visitor asks
 * to be taken to. Mounting inside `Layout` would mean "take me to the cart" tore
 * down the very call that asked for it. Sitting above the route table instead,
 * this element is reconciled in the same position for every public path, so the
 * call survives the whole visit.
 *
 * It renders nothing once the visitor crosses into the portal or the admin,
 * where the two mounts below take over with their own, larger policies.
 */
export function PublicVoiceMount() {
  const { pathname } = useLocation();
  if (policyForPath(pathname).surface !== "public") return null;
  return <VoiceMount policy={PUBLIC_POLICY} theme="theme-luxe" />;
}

/**
 * The portal's concierge, mounted on the `RequireMember` route rather than in
 * `MemberShell`.
 *
 * Every member page renders `MemberShell` itself, so the shell is a different
 * element on each screen and React unmounts it on every navigation. The guard
 * route's element is the nearest node that outlives a move from the library to
 * the account area, which is exactly the move the agent is there to make.
 */
export function MemberVoiceMount() {
  return <VoiceMount policy={MEMBER_POLICY} theme="theme-luxe" />;
}

/**
 * The owner's concierge, mounted inside `AdminLayout`'s own `.theme-console`
 * root. The admin is the one surface where the shell is BOTH the theme boundary
 * and reconciled in place across every screen, so this mount needs no wrapper of
 * its own: it is already in the themed subtree.
 */
export function AdminVoiceMount() {
  return <VoiceMount policy={ADMIN_POLICY} />;
}
