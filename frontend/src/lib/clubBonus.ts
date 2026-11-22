import { useEffect, useState } from "react";
import { hasMemberSessionHint } from "@/hooks/useMember";
import { memberRequest } from "@/lib/memberApi";

/**
 * The Club's Ramp-Up Rate Formula bonus as the person looking at /club or
 * /club/checkout is entitled to see it (Yvette, 22 Nov 2026, item 3; server:
 * backend/src/services/clubBonus.ts, migration 215).
 *
 *  - "open":    an identified, eligible subscriber: their own deadline.
 *  - "expired": an identified subscriber whose window has closed: the bonus
 *               is no longer offered to them.
 *  - "public":  everybody else, and the server render: the eligibility rule,
 *               never a made-up date or countdown.
 *
 * Identification is the signed `?b=` link in their Club emails (kept for this
 * browser tab only, so /club → /club/checkout keeps it and a shared computer
 * does not), or their own signed-in session. Nothing typed into a form is ever
 * used to look somebody up.
 */
export type ClubBonusStatus =
  | { state: "open"; deadline: string; deadlineAt: string }
  | { state: "expired" }
  | { state: "public" };

const PUBLIC: ClubBonusStatus = { state: "public" };
const TOKEN_KEY = "bc-club-bonus-link";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{20,64}$/;

/** The token from `?b=`, else the one this tab already saw. '' when none. */
export function clubBonusToken(search: string): string {
  let token = "";
  try {
    token = new URLSearchParams(search).get("b") ?? "";
  } catch {
    token = "";
  }
  if (TOKEN_SHAPE.test(token)) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Storage refused: the link still works on this page.
    }
    return token;
  }
  try {
    const saved = sessionStorage.getItem(TOKEN_KEY) ?? "";
    return TOKEN_SHAPE.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

export function fetchClubBonusStatus(token: string): Promise<ClubBonusStatus> {
  const query = token ? `?t=${encodeURIComponent(token)}` : "";
  return memberRequest<ClubBonusStatus>(`/club-bonus/status${query}`);
}

/** Pure, for the pages and their tests: "Your bonus expires December 6 at 11:59 p.m. Pacific Time." */
export function personalBonusLine(deadline: string): string {
  return `Your bonus expires ${deadline} at 11:59 p.m. Pacific Time.`;
}

/**
 * The status for this visitor. "public" on the server and until the answer
 * arrives, and on any failure: the public wording is always true.
 */
export function useClubBonus(): ClubBonusStatus {
  const [status, setStatus] = useState<ClubBonusStatus>(PUBLIC);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = clubBonusToken(window.location.search);
    // A signed-in member is identified by their session (sent when the client
    // already holds it); anybody else without a link is public, no request.
    if (!token && !hasMemberSessionHint()) {
      setStatus(PUBLIC);
      return;
    }
    let cancelled = false;
    fetchClubBonusStatus(token)
      .then((result) => {
        if (cancelled) return;
        setStatus(result && (result.state === "open" || result.state === "expired") ? result : PUBLIC);
      })
      .catch(() => {
        if (!cancelled) setStatus(PUBLIC);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
