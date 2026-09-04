import { memberRequest } from "@/lib/memberApi";

/**
 * The events a member signed up for.
 *
 * A file of its own rather than another method on `memberApi`, following
 * `publishingApi`: that file stays the single copy of the token and refresh
 * logic, and everything else is a thin typed call through it.
 */

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
  /** Empty unless the room is open — a dead link is worse than none. */
  roomUrl: string;
  icsUrl: string;
  /** Empty unless a replay exists and is still inside its window. */
  replayUrl: string;
  replayExpiresAt: string | null;
  registeredAt: string;
}

export interface MemberEventsResponse {
  upcoming: MemberEvent[];
  past: MemberEvent[];
}

export const memberEventsApi = {
  list: () => memberRequest<MemberEventsResponse>("/member/events"),
};
