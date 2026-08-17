import { ApiError, getToken } from "@/lib/api";

/**
 * The events client — the public registration page and room, and the admin
 * screen behind them.
 *
 * An evergreen event has no single start time: the session a visitor is given
 * is computed when they register and belongs to them alone. Every shape here
 * therefore carries `sessionAt` on the *registration* rather than on the event,
 * and a pre-formatted `sessionLabel` beside it, so no screen has to decide for
 * itself which timezone a webinar is in.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    let details: unknown;
    try {
      const parsed = (await res.json()) as {
        error?: string;
        message?: string;
        details?: unknown;
      };
      message = parsed.error ?? parsed.message ?? message;
      details = parsed.details;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    // The room's refusals carry their reason and its date in `details`, and the
    // page needs both to say "the replay closed on the 17th" rather than "403".
    throw Object.assign(new ApiError(message, res.status), { details });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (data: unknown): RequestInit["body"] => JSON.stringify(data);

/* ── The public page ────────────────────────────────────────────────────── */

export type EventKind = "live" | "evergreen" | "replay";

export interface PublicEvent {
  slug: string;
  title: string;
  descriptionMd: string;
  coverImage: string;
  kind: EventKind;
  /** null for an always-on event, which starts whenever the visitor is ready. */
  startsAt: string | null;
  durationMinutes: number;
  timezone: string;
  registrationFormId: number | null;
  /** The next few session times, for an always-on event. */
  upcomingSessions: string[];
  hasReplay: boolean;
}

export interface EventRegistration {
  /** Proof of registration. It is what the room and the calendar file read. */
  token: string;
  sessionAt: string;
  sessionLabel: string;
  timezone: string;
  durationMinutes: number;
  roomUrl: string;
  icsUrl: string;
}

export interface RegistrationInput {
  email: string;
  name?: string;
  timezone?: string;
  /** The honeypot pair, from `useHoneypot`. */
  company?: string;
  elapsedMs?: number;
}

export type RoomState = "early" | "live" | "replay" | "expired" | "ended";

export interface RoomAccess {
  state: RoomState;
  title: string;
  url: string;
  sessionAt: string;
  sessionLabel: string;
  timezone: string;
  durationMinutes: number;
  /** When access ends — the session's end, or the replay's expiry. */
  closesAt: string | null;
}

/** The body of a 403 from the room, which says why and until when. */
export interface RoomRefusal {
  state: RoomState;
  opensAt: string | null;
  closedAt: string | null;
  sessionAt: string;
  sessionLabel: string;
  /** The event's own zone, so the door time is read in the same one as the session. */
  timezone: string;
}

/** Reads the refusal off a thrown error, or null if it was something else. */
export function roomRefusal(err: unknown): RoomRefusal | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  const details = (err as ApiError & { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return null;
  const refusal = details as Partial<RoomRefusal>;
  return refusal.state ? (refusal as RoomRefusal) : null;
}

export const eventsApi = {
  get: (slug: string) => request<PublicEvent>(`/events/${encodeURIComponent(slug)}`),
  register: (slug: string, input: RegistrationInput) =>
    request<EventRegistration>(`/events/${encodeURIComponent(slug)}/register`, {
      method: "POST",
      body: body(input),
    }),
  room: (slug: string, ticket: string) =>
    request<RoomAccess>(
      `/events/${encodeURIComponent(slug)}/room?ticket=${encodeURIComponent(ticket)}`,
    ),
  icsUrl: (ticket: string) =>
    `${API_BASE}/events/registrations/${encodeURIComponent(ticket)}/ics`,
};

/* ── The admin screen ───────────────────────────────────────────────────── */

export interface EventSummary {
  id: number;
  slug: string;
  title: string;
  kind: EventKind;
  startsAt: string | null;
  durationMinutes: number;
  timezone: string;
  published: boolean;
  evergreenIntervalMinutes: number | null;
  registrationCount: number;
  attendedCount: number;
  upcomingCount: number;
  updatedAt: string;
}

export interface EventDetail extends EventSummary {
  descriptionMd: string;
  coverImage: string;
  roomUrl: string;
  replayUrl: string;
  replayExpiresAfterHours: number | null;
  registrationFormId: number | null;
  applyTagIds: number[];
  applyTags: { id: number; name: string }[];
  attendedTagId: number | null;
  noShowTagId: number | null;
  attendedTagName: string | null;
  noShowTagName: string | null;
  formName: string | null;
}

export interface EventDraft {
  title?: string;
  descriptionMd?: string;
  coverImage?: string;
  kind?: EventKind;
  startsAt?: string | null;
  durationMinutes?: number;
  timezone?: string;
  evergreenIntervalMinutes?: number | null;
  roomUrl?: string;
  replayUrl?: string;
  replayExpiresAfterHours?: number | null;
  applyTagIds?: number[];
  attendedTagId?: number | null;
  noShowTagId?: number | null;
  published?: boolean;
}

export interface Registrant {
  id: number;
  email: string;
  name: string;
  sessionAt: string;
  sessionLabel: string;
  attended: boolean;
  attendedAt: string | null;
  watchSeconds: number;
  contactId: number | null;
  createdAt: string;
  orderTotalCents: number | null;
}

export interface EventReport {
  registered: number;
  attended: number;
  noShow: number;
  upcoming: number;
  converted: number;
  revenueCents: number;
  attendanceRate: number;
  conversionRate: number;
}

export const eventsAdminApi = {
  list: () => request<EventSummary[]>("/admin/events"),
  get: (id: number) => request<EventDetail>(`/admin/events/${id}`),
  create: (draft: EventDraft & { title: string }) =>
    request<EventSummary>("/admin/events", { method: "POST", body: body(draft) }),
  update: (id: number, draft: EventDraft) =>
    request<EventSummary>(`/admin/events/${id}`, { method: "PATCH", body: body(draft) }),
  remove: (id: number) => request<void>(`/admin/events/${id}`, { method: "DELETE" }),

  registrations: (id: number) => request<Registrant[]>(`/admin/events/${id}/registrations`),
  markAttendance: (id: number, ids: number[], attended: boolean) =>
    request<{ updated: number }>(`/admin/events/${id}/attendance`, {
      method: "POST",
      body: body({ ids, attended }),
    }),
  joinLink: (id: number, registrationId: number) =>
    request<{ path: string }>(`/admin/events/${id}/registrations/${registrationId}/link`),
  runSplit: (id: number) =>
    request<{ queued: boolean }>(`/admin/events/${id}/split`, { method: "POST" }),
  report: (id: number) => request<EventReport>(`/admin/events/${id}/report`),
};

/* ── Wording ────────────────────────────────────────────────────────────── */

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  live: "One live session",
  evergreen: "Always on",
  replay: "Watch any time",
};

export const EVENT_KIND_HINT: Record<EventKind, string> = {
  live: "Everyone joins at the same date and time.",
  evergreen: "A session starts shortly after each person signs up.",
  replay: "A recording people can watch the moment they sign up.",
};

/** "every 15 minutes" / "every hour" / "once a day" — the cadence in words. */
export function describeCadence(minutes: number | null): string {
  if (!minutes) return "";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "Once a day" : `Every ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  return `Every ${minutes} minutes`;
}

/** The cadences the screen offers, so nobody has to type a number of minutes. */
export const CADENCE_CHOICES = [15, 30, 60, 120, 240, 1440] as const;
