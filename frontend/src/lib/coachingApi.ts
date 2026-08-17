import { getAccessToken, memberRequest } from "@/lib/memberApi";

/**
 * Coaching domain client.
 *
 * Sits on top of `memberRequest` so it shares the one access token and the one
 * refresh path; nothing here touches storage or auth.
 *
 * Every instant crossing this boundary is an ISO-8601 UTC string, never a
 * wall-clock reading. The server has no business guessing which zone a member
 * is sitting in, and the client has no business guessing when the coach is
 * free — so the wire carries instants and the screen carries a named zone the
 * member chose. Booking a call an hour out is the worst bug this feature can
 * ship, and that split is what prevents it.
 *
 * Reads therefore send no `timezone`: the labels the server renders alongside
 * each instant are ignored in favour of re-rendering them in whichever zone the
 * member is currently reading. Writes do send it, because the session stores the
 * zone the member was looking at when they agreed to the time, which is the only
 * way to answer "but I booked 9am" months later.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

/** DB-side this is free text, so treat anything unrecognised as historical. */
export type CoachingSessionStatus = "scheduled" | "completed" | "cancelled" | "no_show";

/** A purchased package, with its credits drawn down. */
export interface CoachingPackage {
  creditId: number;
  /** null when the offer behind the purchase has been unpublished or deleted. */
  offerSlug: string | null;
  offerTitle: string;
  format: string;
  durationMinutes: number;
  /** An open-ended package: no ledger to draw down, so show no meter. */
  unlimited: boolean;
  sessionsTotal: number | null;
  sessionsUsed: number;
  sessionsRemaining: number | null;
  /** "3 of 6 sessions used" — the server's own sentence, printed verbatim. */
  summary: string;
  expiresAt: string | null;
  /** The server's verdict: in date, has an offer, has something left. */
  canBook: boolean;
}

export interface CoachingSessionFile {
  id: number;
  title: string;
  url: string;
}

/**
 * One booking.
 *
 * `canReschedule` / `canCancel` / `cancelRefundsCredit` are the server's
 * reckoning, not a sum done here. The client knows the policy window and could
 * do the arithmetic, but then a page left open across the cut-off would promise
 * a credit back that the server is about to refuse.
 */
export interface CoachingSession {
  id: number;
  offerSlug: string | null;
  offerTitle: string;
  status: CoachingSessionStatus;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number;
  /** The zone the member was reading when they booked, kept for reference. */
  timezone: string;
  agenda: string;
  sharedNotes: string;
  recordingUrl: string;
  meetingUrl: string;
  /** Last moment this can be moved or dropped with the credit coming back. */
  changeDeadline: string | null;
  canReschedule: boolean;
  canCancel: boolean;
  cancelRefundsCredit: boolean;
  cancelReason: string;
  files: CoachingSessionFile[];
}

/** Hours rather than minutes: every sentence on the screen is written in hours. */
export interface CoachingPolicy {
  minimumNoticeHours: number;
  /** Inside this window a session can no longer be moved, nor refunded. */
  cancellationWindowHours: number;
  bookingHorizonDays: number;
}

export interface CoachingOverview {
  /**
   * The zone the business keeps its calendar in — what the server falls back to
   * when the request names none. Shown only where it differs from the member's,
   * so "9am your time, 2pm hers" can be said out loud.
   */
  timezone: string;
  packages: CoachingPackage[];
  upcoming: CoachingSession[];
  past: CoachingSession[];
  policy: CoachingPolicy;
}

export interface CoachingSlot {
  startsAt: string;
  endsAt: string;
}

export interface SlotWindow {
  offer: {
    slug: string;
    title: string;
    format: string;
    durationMinutes: number;
  };
  timezone: string;
  from: string;
  to: string;
  minimumNoticeHours: number;
  /**
   * Flat and ungrouped on purpose: the client groups by day in the zone the
   * member is actually reading, which is the only grouping that is right.
   */
  slots: CoachingSlot[];
}

export interface BookResult {
  session: CoachingSession;
  /** The ledger after the credit moved, so no second request is needed. */
  packages: CoachingPackage[];
  message: string;
}

export interface RescheduleResult {
  session: CoachingSession;
  message: string;
}

export interface CancelResult {
  session: CoachingSession;
  packages: CoachingPackage[];
  /** What actually happened to the credit, which is what the toast reports. */
  creditRestored: boolean;
  message: string;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function sessionPath(id: number): string {
  return `/member/coaching/sessions/${encodeURIComponent(String(id))}`;
}

/**
 * The calendar file for a session, fetched rather than linked.
 *
 * `/api/member/*` authenticates on a bearer token alone — there is no cookie
 * fallback — so a plain `<a href>` to the `.ics` route navigates away from the
 * app and lands on a 401 page. The file has to be fetched with the header
 * attached and handed to the browser as a blob instead.
 *
 * A 401 here means the 15-minute access token lapsed while the page sat open.
 * Rather than keep a second refresh path — two of them would rotate the refresh
 * cookie behind each other's backs and each would read the other's rotation as
 * a stolen token — one ordinary authenticated read is made through
 * `memberRequest`, which owns the single-flight refresh, and the fetch is
 * retried with whatever token that left behind.
 */
export async function fetchSessionIcs(id: number): Promise<Blob> {
  const url = `${API_BASE}${sessionPath(id)}/ics`;

  const send = async (): Promise<Response> => {
    const token = getAccessToken();
    return fetch(url, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  let res = await send();
  if (res.status === 401) {
    await coachingApi.session(id);
    res = await send();
  }

  if (!res.ok) {
    throw new Error("We could not build that calendar file. Please try again.");
  }
  return res.blob();
}

export const coachingApi = {
  /** Deliberately unparameterised: `timezone` in the reply is the site's own. */
  overview: () => memberRequest<CoachingOverview>("/member/coaching"),

  slots: (offerSlug: string, input: { from: string; to: string }) =>
    memberRequest<SlotWindow>(
      `/member/coaching/offers/${encodeURIComponent(offerSlug)}/slots${query({ ...input })}`,
    ),

  book: (input: { offerSlug: string; startsAt: string; timezone: string; agenda: string }) =>
    memberRequest<BookResult>("/member/coaching/book", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  session: (id: number) => memberRequest<{ session: CoachingSession }>(sessionPath(id)),

  reschedule: (id: number, input: { startsAt: string; timezone: string }) =>
    memberRequest<RescheduleResult>(`${sessionPath(id)}/reschedule`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  cancel: (id: number, input: { reason: string }) =>
    memberRequest<CancelResult>(`${sessionPath(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
