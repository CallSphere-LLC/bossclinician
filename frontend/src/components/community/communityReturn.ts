import { useEffect, useState } from "react";

/**
 * Where "Back" goes from inside a community.
 *
 * QA sheet: "/community/the-boss back button not working". The community's own
 * back link pointed at `/community`, the picker — and the picker, seeing only
 * one room, redirects straight back into it (see pages/member/Community.tsx).
 * With a single community, which is nearly everybody, the link went nowhere.
 *
 * So the member shell remembers the last member page outside the community,
 * and the community offers a way back to exactly that: the library, the
 * account area, a coaching session. With no such page on record (a community
 * link opened in a new tab, a bookmark) it falls back to the library, the
 * member area's home. sessionStorage, so it is per tab and gone with it.
 */

const RETURN_KEY = "bc_community_return_to";
export const COMMUNITY_RETURN_FALLBACK = "/library";

/** Paths the member shell renders that are not part of a community. */
function isCommunityPath(path: string): boolean {
  return path === "/community" || path.startsWith("/community/") || path.startsWith("/community?");
}

/** Called by MemberShell on every navigation. */
export function rememberCommunityReturn(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//") || isCommunityPath(path)) return;
  if (path.startsWith("/login") || path.startsWith("/logout")) return;
  try {
    window.sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // No storage: the fallback still gets the member out.
  }
}

function readCommunityReturn(): string {
  try {
    const stored = window.sessionStorage.getItem(RETURN_KEY);
    if (stored && stored.startsWith("/") && !stored.startsWith("//") && !isCommunityPath(stored)) {
      return stored;
    }
  } catch {
    // fall through
  }
  return COMMUNITY_RETURN_FALLBACK;
}

const LABELS: Array<[string, string]> = [
  ["/library", "Back to your library"],
  ["/downloads", "Back to downloads"],
  ["/account", "Back to your account"],
  ["/coaching", "Back to coaching"],
  ["/my-events", "Back to events"],
  ["/podcasts", "Back to podcasts"],
  ["/newsletters", "Back to newsletters"],
  ["/partners", "Back to the partner dashboard"],
];

export function communityReturnLabel(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  for (const [prefix, label] of LABELS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return label;
  }
  return "Back";
}

/**
 * The way out of the community, read after mount so the server render and the
 * first client render agree (the server has no sessionStorage).
 */
export function useCommunityReturn(): { to: string; label: string } {
  const [to, setTo] = useState(COMMUNITY_RETURN_FALLBACK);
  useEffect(() => {
    setTo(readCommunityReturn());
  }, []);
  return { to, label: communityReturnLabel(to) };
}
