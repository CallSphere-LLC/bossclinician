import { memberRequest } from "@/lib/memberApi";

/**
 * The events a member signed up for.
 *
 * A file of its own rather than another method on `memberApi`, following
 * `publishingApi`: that file stays the single copy of the token and refresh
 * logic, and everything else is a thin typed call through it.
 */

/** One email still to come for this registration. */
export interface MemberEventReminder {
  /** "1 day before", "1 hour before" — the same wording the admin sees. */
  label: string;
  at: string;
  status: "queued" | "sent" | "failed" | "skipped";
}

export interface MemberEvent {
  registrationId: number;
  eventId: number;
  slug: string;
  title: string;
  coverImage: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  timezone: string;
  /** Already formatted in the zone the registration was taken in. */
  sessionLabel: string;
  upcoming: boolean;
  /** True while the room is actually open, which is when the link is handed out. */
  live: boolean;
  attended: boolean;
  /**
   * The room's own word for where this registration stands, from the same
   * function the door uses: "early", "live", "replay", "ended" or "expired".
   */
  state: "early" | "live" | "replay" | "expired" | "ended";
  /** Empty unless the room is open — a dead link is worse than none. */
  roomUrl: string;
  /** When the link appears on this page. The other half of not handing it over early. */
  roomOpensAt: string;
  roomOpensLabel: string;
  icsUrl: string;
  /** Empty unless a replay exists and is still inside its window. */
  replayUrl: string;
  /** Whether a recording exists at all, which is not the same as being able to watch it now. */
  hasReplay: boolean;
  replayExpiresAt: string | null;
  /** The emails still to come, so the promise of a reminder is checkable. */
  reminders: MemberEventReminder[];
  registeredAt: string;
  /** "Every week, 6 sessions", or empty for a single session. */
  recurrenceLabel?: string;
  /** Their sessions still to come in a series, labelled in their own zone. */
  occurrences?: { startsAt: string; label: string }[];
  locationType?: "online" | "in_person";
  /** The address, for an in-person event. */
  locationAddress?: string;
}

export interface MemberEventsResponse {
  upcoming: MemberEvent[];
  past: MemberEvent[];
}

export const memberEventsApi = {
  list: () => memberRequest<MemberEventsResponse>("/member/events"),
};
