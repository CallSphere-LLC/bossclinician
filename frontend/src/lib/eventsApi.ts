import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

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
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

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
  /**
   * The reminders this event really sends, in words — "1 day before", "1 hour
   * before". Empty means it sends none, and the page then says nothing about
   * reminders rather than promising one.
   */
  reminderSchedule: string[];
  /** "Every week, 6 sessions" for a repeating event; empty for a single session. */
  recurrenceLabel?: string;
  /** A repeating event's sessions still to come, as ISO instants. */
  occurrences?: string[];
  locationType?: LocationType;
  /** The address of an in-person event; empty otherwise. */
  locationAddress?: string;
  /** Whether the event has an online link at all. */
  hasJoinLink?: boolean;
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
  /** What the confirmation may truthfully say happens next. */
  reminderSchedule: string[];
  /** A place in a series covers every session from this one on. */
  recurrenceLabel?: string;
  occurrences?: string[];
  locationType?: LocationType;
  locationAddress?: string;
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
  recurrenceFreq?: RecurrenceFreq | null;
  recurrenceInterval?: number;
  /** YYYY-MM-DD in the event's own zone. */
  recurrenceUntil?: string | null;
  recurrenceCount?: number | null;
  locationType?: LocationType;
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
  /** Sent with the event itself: a reminder panel that needs a second request is a panel nobody reads. */
  reminders: EventReminderWithStats[];
  locationAddress?: string;
  /** Every session of a live event, worked out by the server. One entry for a single session. */
  occurrences?: string[];
  recurrenceLabel?: string;
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
  recurrenceFreq?: RecurrenceFreq | null;
  recurrenceInterval?: number;
  recurrenceUntil?: string | null;
  recurrenceCount?: number | null;
  locationType?: LocationType;
  locationAddress?: string;
}

/* ── Repeats and location ───────────────────────────────────────────────── */

export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export type LocationType = "online" | "in_person";

export const RECURRENCE_FREQ_CHOICES: { value: RecurrenceFreq; label: string; unit: string }[] = [
  { value: "daily", label: "Every day", unit: "day" },
  { value: "weekly", label: "Every week", unit: "week" },
  { value: "monthly", label: "Every month", unit: "month" },
];

/** The most sessions one series may have. Matches the server's MAX_OCCURRENCES. */
export const MAX_OCCURRENCES = 200;

/**
 * "Every week, 6 sessions" / "Every 2 weeks until October 31, 2026" — the same
 * wording `describeRecurrence` writes on the server, so the create dialog's
 * preview and the saved event say the same sentence. `eventsApi.test.ts` holds
 * the two to the same assertions.
 */
export function describeRecurrence(
  rule: { freq: RecurrenceFreq; interval: number; until: string | null; count: number | null } | null,
): string {
  if (!rule) return "";
  const unit = RECURRENCE_FREQ_CHOICES.find((choice) => choice.value === rule.freq)?.unit ?? "week";
  const head = rule.interval > 1 ? `Every ${rule.interval} ${unit}s` : `Every ${unit}`;
  if (rule.count !== null) {
    return `${head}, ${rule.count} ${rule.count === 1 ? "session" : "sessions"}`;
  }
  const match = rule.until ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(rule.until) : null;
  if (match) {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
    return `${head} until ${label}`;
  }
  return head;
}

/* ── Reminders ──────────────────────────────────────────────────────────── */

export type ReminderKind = "registration" | "before";

/**
 * What has happened to one reminder across everybody signed up.
 *
 * `sent` and `delivered` are two different truths and both are shown: sent
 * means the provider accepted the message, delivered means it arrived. A screen
 * that showed only the first would have looked perfectly healthy through the
 * whole period the sending account was suspended and nothing reached anybody.
 */
export interface ReminderStats {
  reminderId: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  lastProblem: string;
  nextAt: string | null;
  delivered: number;
  bounced: number;
}

export interface EventReminder {
  id: number;
  eventId: number;
  kind: ReminderKind;
  /** Minutes before the session starts. Zero on a 'before' reminder means "as it starts". */
  offsetMinutes: number;
  subject: string;
  bodyMd: string;
  enabled: boolean;
  /** The offset in words, written by the server so every surface agrees. */
  label: string;
}

export type EventReminderWithStats = EventReminder & { stats: ReminderStats };

export interface ReminderDraft {
  kind: ReminderKind;
  offsetMinutes?: number;
  subject?: string;
  bodyMd?: string;
}

/**
 * The moments the editor offers, so nobody has to think in minutes.
 *
 * Deliberately a short list of the ones people actually use. A free-form number
 * of minutes is available through the API for anyone who needs "90 minutes
 * before", but a dropdown with 1,440 options is a dropdown nobody uses.
 */
export const REMINDER_CHOICES: { kind: ReminderKind; offsetMinutes: number; label: string }[] = [
  { kind: "registration", offsetMinutes: 0, label: "As soon as they sign up" },
  { kind: "before", offsetMinutes: 7 * 1440, label: "1 week before" },
  { kind: "before", offsetMinutes: 2 * 1440, label: "2 days before" },
  { kind: "before", offsetMinutes: 1440, label: "1 day before" },
  { kind: "before", offsetMinutes: 180, label: "3 hours before" },
  { kind: "before", offsetMinutes: 60, label: "1 hour before" },
  { kind: "before", offsetMinutes: 15, label: "15 minutes before" },
  { kind: "before", offsetMinutes: 0, label: "When it starts" },
];

/** "1 day before" / "when it starts" — the same wording the server writes. */
export function describeReminderOffset(kind: ReminderKind, offsetMinutes: number): string {
  if (kind === "registration") return "as soon as they sign up";
  if (offsetMinutes <= 0) return "when it starts";
  if (offsetMinutes % 1440 === 0) {
    const days = offsetMinutes / 1440;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (offsetMinutes % 60 === 0) {
    const hours = offsetMinutes / 60;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return `${offsetMinutes} minutes before`;
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

/**
 * What a write returns: the stored row, without the registration counts, which
 * are subqueries the list pays for and a save does not. Re-read with `list` or
 * `get` when the counts matter.
 */
export type SavedEvent = Omit<
  EventSummary,
  "registrationCount" | "attendedCount" | "upcomingCount"
>;

export const eventsAdminApi = {
  list: () => request<EventSummary[]>("/admin/events"),
  get: (id: number) => request<EventDetail>(`/admin/events/${id}`),
  create: (draft: EventDraft & { title: string }) =>
    request<SavedEvent>("/admin/events", { method: "POST", body: body(draft) }),
  update: (id: number, draft: EventDraft) =>
    request<SavedEvent>(`/admin/events/${id}`, { method: "PATCH", body: body(draft) }),
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

  reminders: (id: number) =>
    request<{ reminders: EventReminder[]; stats: ReminderStats[] }>(
      `/admin/events/${id}/reminders`,
    ),
  addReminder: (id: number, draft: ReminderDraft) =>
    request<EventReminder>(`/admin/events/${id}/reminders`, {
      method: "POST",
      body: body(draft),
    }),
  updateReminder: (
    id: number,
    reminderId: number,
    draft: { subject?: string; bodyMd?: string; enabled?: boolean },
  ) =>
    request<EventReminder>(`/admin/events/${id}/reminders/${reminderId}`, {
      method: "PATCH",
      body: body(draft),
    }),
  removeReminder: (id: number, reminderId: number) =>
    request<void>(`/admin/events/${id}/reminders/${reminderId}`, { method: "DELETE" }),
  retryReminder: (id: number, reminderId: number) =>
    request<{ requeued: number }>(`/admin/events/${id}/reminders/${reminderId}/retry`, {
      method: "POST",
    }),
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

/** The zone a new event is created in when nobody picks one. */
export const EVENT_DEFAULT_TIMEZONE = "America/New_York";

/**
 * The date of a live event written out in its own zone, with the zone named.
 *
 * The component options are spelled out rather than using `dateStyle` and
 * `timeStyle`. ECMA-402 forbids combining either of those with a component
 * option such as `timeZoneName`, and the constructor rejects the combination at
 * runtime while TypeScript accepts it — `Intl.DateTimeFormatOptions` permits it
 * statically. This function used to ask for all three, so the `try` threw on
 * every render, for every event, in every browser, and the `catch` reformatted
 * with no `timeZone` at all. An 18:00 Eastern event read as "3:00 PM" on a
 * Pacific laptop and "10:00 PM" on a UTC one: not a stored-data problem, and
 * not a shift anyone could reproduce consistently, because the answer depended
 * on who was looking.
 *
 * These are the same options `describeSession` uses on the server, so the list
 * now agrees with the dialog, the public page, the reminder emails and the
 * registrant table.
 */
export function describeStart(iso: string | null, timeZone: string): string {
  if (!iso) return "No date yet";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "No date yet";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || EVENT_DEFAULT_TIMEZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(instant);
  } catch {
    // Only reachable if the stored zone is not a zone the browser knows. Say so
    // in the label: a time shown in the wrong zone without a marker is worse
    // than one that admits which zone it is in.
    return `${new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(instant)} UTC`;
  }
}
