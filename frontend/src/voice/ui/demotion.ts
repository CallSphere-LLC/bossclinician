/**
 * demotion.ts — saying why the concierge is suddenly less able than it was.
 *
 * The server re-decides who it is talking to on every call, from its own
 * cookies, and when a sign-in has lapsed it quietly grants a lower surface than
 * the page asked for. Quiet is right for the server: it must not leak whether
 * an account exists, and it must not fail loudly at someone mid-sentence. Quiet
 * is wrong for the person, who would otherwise simply find the assistant oddly
 * unable to do the thing they just asked for, with no idea that signing in
 * again would fix it.
 *
 * So the sentence lives here, on its own, importing nothing. It is the same
 * sentence whether the person is talking or typing — one situation deserves one
 * explanation — and a leaf module is what lets the text transport say it
 * without pulling the spoken widget, and the whole of React's render tree
 * beneath it, into a page that is rendered on the server.
 */

import type { VoiceSurface } from "@/voice/contract";

/** Public < member < admin. Only a step DOWN is worth saying anything about. */
export const SURFACE_RANK: Record<VoiceSurface, number> = { public: 0, member: 1, admin: 2 };

/**
 * The line to show when the server granted less than the page asked for, or
 * `null` when it granted what was asked — which is almost always, and which
 * must produce no notice at all.
 */
export function demotedNotice(asked: VoiceSurface, granted: VoiceSurface): string | null {
  if (SURFACE_RANK[granted] >= SURFACE_RANK[asked]) return null;
  if (asked === "admin") {
    return "You are signed out of the console, so I can only show you the public pages. Sign in again and I can open your dashboard.";
  }
  return "You are signed out, so I can only show you the public pages — sign in and I can open your portal.";
}
