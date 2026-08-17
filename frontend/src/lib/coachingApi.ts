import { memberRequest } from "@/lib/memberApi";

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
 */

export type CoachingFormat = "individual" | "group";

/** A purchased package, with its credits drawn down. */
export interface CoachingPackage {
  creditId: number;
  offerId: number | null;
  title: string;
  description: string;
  format: CoachingFormat;
  durationMinutes: number;
  /** 0 means the package is open-ended — show no meter, not "0 of 0". */
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  expiresAt: string | null;
  /** Server's verdict: credits left, not expired, and bookable right now. */
  bookable: boolean;
  /** Why it is not bookable, in words a member can act on. Empty when it is. */
  unavailableReason: string;
}

export type CoachingSessionStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export interface CoachingSessionSummary {
  id: number;
  offerTitle: string;
  scheduledAt: string | null;
  durationMinutes: number;
  status: CoachingSessionStatus;
  /** The zone the member was looking at when they booked, for reference. */
  timezone: string;
  meetingUrl: string;
  agenda: string;
  hasRecording: boolean;
}

export interface CoachingSessionFile {
  id: number;
  title: string;
  url: string;
}

/**
 * Whether this session can still be moved or dropped, and what happens to the
 * credit if it is.
 *
 * Computed server-side on purpose. The client knows the policy window and could
 * do the arithmetic, but then a page left open across the cut-off would promise
 * a refund the server is about to refuse.
 */
export interface CancellationState {
  canCancel: boolean;
  canReschedule: boolean;
  creditWillReturn: boolean;
  hoursUntilStart: number | null;
}

export interface CancellationPolicy {
  /** Cancel at least this far ahead and the session goes back on the package. */
  creditReturnHours: number;
  /** Sessions can be moved up to this many hours before they start. */
  rescheduleHours: number;
  /** The owner's own wording, shown verbatim before anyone confirms. */
  summary: string;
}

export interface CoachingSessionDetail extends CoachingSessionSummary {
  creditId: number | null;
  sharedNotes: string;
  recordingUrl: string;
  files: CoachingSessionFile[];
  /**
   * Token-bearing `.ics` link. Unguessable and public by design: a phone's
   * calendar app fetches it without the member's bearer token, which an
   * authenticated-only endpoint could never satisfy. Empty when the session has
   * no time yet.
   */
  calendarUrl: string;
  cancelReason: string;
  cancellation: CancellationState;
  policy: CancellationPolicy;
}

export interface CoachingOverview {
  packages: CoachingPackage[];
  upcoming: CoachingSessionSummary[];
  past: CoachingSessionSummary[];
  policy: CancellationPolicy;
  /** The zone the coach keeps her calendar in. Shown only when it differs. */
  coachTimezone: string;
}

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityWindow {
  /** Flat and unsorted-by-day on purpose: the client groups by day in the zone
   * the member is actually reading, which is the only grouping that is right. */
  slots: AvailabilitySlot[];
  durationMinutes: number;
  coachTimezone: string;
}

export interface AvailabilityQuery {
  /** Which package is being spent — sets the session length. */
  creditId?: number;
  /** Set instead of `creditId` when moving an existing booking. */
  sessionId?: number;
  from: string;
  to: string;
}

export interface CancelResult {
  session: CoachingSessionDetail;
  /** What actually happened, which is what the toast must report. */
  creditReturned: boolean;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export const coachingApi = {
  overview: () => memberRequest<CoachingOverview>("/member/coaching"),

  availability: (input: AvailabilityQuery) =>
    memberRequest<AvailabilityWindow>(`/member/coaching/availability${query({ ...input })}`),

  book: (input: { creditId: number; startsAt: string; timezone: string; agenda: string }) =>
    memberRequest<CoachingSessionDetail>("/member/coaching/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  session: (id: number) => memberRequest<CoachingSessionDetail>(`/member/coaching/sessions/${id}`),

  updateSession: (id: number, input: { agenda?: string; sharedNotes?: string }) =>
    memberRequest<CoachingSessionDetail>(`/member/coaching/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  reschedule: (id: number, input: { startsAt: string; timezone: string }) =>
    memberRequest<CoachingSessionDetail>(`/member/coaching/sessions/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  cancel: (id: number, input: { reason: string }) =>
    memberRequest<CancelResult>(`/member/coaching/sessions/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
