/**
 * Row 171 — who watched which lesson video, who came to which live session —
 * the pure half.
 *
 * Everything in here is a decision with no database behind it, so it can be
 * pinned by unit tests: what "watched" means, when a reminder is due, whether a
 * live-room visit counts as attending a session, and the keys that make every
 * send happen at most once. The queries live in services/engagementSweep.ts,
 * services/liveSessions.ts and routes/admin/engagement.ts.
 */

/* ------------------------------------------------------------- watch status */

export type WatchStatus = "not_started" | "partial" | "completed";

export interface WatchFacts {
  completedAt: Date | string | null;
  watchedPercent: number;
  lastPositionSeconds: number;
  /** Furthest point actually played through (never seeked to). */
  maxPositionSeconds: number;
  /** Seconds of playback credited. */
  watchedSeconds?: number;
}

/**
 * Where one member stands with one lesson video.
 *
 * Completed is the lesson's own completion, which is what unlocks the next
 * lesson and counts towards a certificate. Anything played at all — a position,
 * a percentage, seconds credited — is "partial". Opening the page without
 * pressing play is still "not started": a reminder about an unwatched video is
 * for exactly that person.
 */
export function watchStatusOf(facts: WatchFacts): WatchStatus {
  if (facts.completedAt) return "completed";
  const played =
    facts.watchedPercent > 0 ||
    facts.lastPositionSeconds > 0 ||
    facts.maxPositionSeconds > 0 ||
    (facts.watchedSeconds ?? 0) > 0;
  return played ? "partial" : "not_started";
}

/**
 * The percentage to show: the larger of the player's own figure and the
 * furthest point played through, capped at 100. Two sources because older
 * progress rows predate `max_position_seconds` (129) and newer ones on a
 * require-full-video course credit only the played-through figure.
 */
export function watchedPercentOf(facts: WatchFacts, durationSeconds: number): number {
  const played =
    durationSeconds > 0 ? Math.floor((facts.maxPositionSeconds * 100) / durationSeconds) : 0;
  return Math.max(0, Math.min(100, Math.max(facts.watchedPercent, played)));
}

/** Whether a member in `status` is who a reminder of kind `watch` is for. */
export function needsReminder(
  status: WatchStatus,
  watch: "not_completed" | "not_started"
): boolean {
  return watch === "not_started" ? status === "not_started" : status !== "completed";
}

export type StatusFilter = "all" | "not_started" | "partial" | "completed" | "not_completed";

/** Whether a row in `status` is kept by the report's status filter. */
export function matchesStatusFilter(status: WatchStatus, wanted: StatusFilter): boolean {
  if (wanted === "all") return true;
  if (wanted === "not_completed") return status !== "completed";
  return status === wanted;
}

/* ------------------------------------------------------------ reminder clock */

/**
 * How late the sweep may be and still send.
 *
 * The moment a reminder becomes due is computed, not stored, so without a
 * bound the first sweep after an automation is turned on would email every
 * member whose "3 days after" passed at any point in the course's history.
 * Only moments in the last two days count; older ones are what the "Send
 * reminder" button on the Engagement page is for.
 */
export const REMINDER_CATCHUP_HOURS = 48;

export function lessonDueAt(input: {
  grantedAt: Date;
  /** When the lesson opened for this member; null when it was open from the start. */
  releasedAt: Date | null;
  basis: "release" | "access";
  days: number;
}): Date {
  const base =
    input.basis === "access" || input.releasedAt === null
      ? input.grantedAt
      : new Date(Math.max(input.grantedAt.getTime(), input.releasedAt.getTime()));
  return new Date(base.getTime() + input.days * 86_400_000);
}

/** Due, and not so long ago that sending now would be a backlog blast. */
export function isDueNow(dueAt: Date, now: Date, catchupHours = REMINDER_CATCHUP_HOURS): boolean {
  const due = dueAt.getTime();
  return due <= now.getTime() && due > now.getTime() - catchupHours * 3_600_000;
}

/* ------------------------------------------------------------- live sessions */

/**
 * Minutes before the start a visit already counts. The room opens early
 * (services/events.ts DOORS_OPEN_MINUTES is the site-wide events' figure) and
 * somebody sitting in it when the host arrives was there.
 */
export const ATTENDANCE_EARLY_MINUTES = 10;

export function sessionEndsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + Math.max(0, durationMinutes) * 60_000);
}

/**
 * Whether one stay in the live room overlaps the session.
 *
 * A visit with no `left_at` is one whose connection never closed cleanly —
 * production has several. It is counted from its join alone: joined inside the
 * window is attended, but a ghost from a fortnight ago is not credited with
 * every session since.
 */
export function visitCoversSession(
  visit: { joinedAt: Date; leftAt: Date | null },
  startsAt: Date,
  durationMinutes: number,
  earlyMinutes = ATTENDANCE_EARLY_MINUTES
): boolean {
  const windowStart = startsAt.getTime() - earlyMinutes * 60_000;
  const windowEnd = sessionEndsAt(startsAt, durationMinutes).getTime();
  const left = (visit.leftAt ?? visit.joinedAt).getTime();
  return visit.joinedAt.getTime() <= windowEnd && left >= windowStart;
}

/**
 * How long after a session ends the sweep will still email its replay.
 *
 * The owner usually sets the replay link a day or two after the call. A link
 * set a month later is not a surprise the room should get from an automation;
 * the "Email the replay" button sends it then.
 */
export const REPLAY_SEND_WINDOW_DAYS = 7;

export function replayWindowOpen(
  endsAt: Date,
  now: Date,
  windowDays = REPLAY_SEND_WINDOW_DAYS
): boolean {
  const end = endsAt.getTime();
  return end <= now.getTime() && end > now.getTime() - windowDays * 86_400_000;
}

/**
 * Whether a community event is held in the community's own live room, which is
 * the only place this platform can see who turned up. An empty location is the
 * room (that is how the meetup editor saves "in the live room"); a Zoom link is
 * not, and its attendance is unknown rather than "nobody came".
 */
export function heldInLiveRoom(locationUrl: string, communitySlug: string): boolean {
  const location = (locationUrl ?? "").trim();
  if (location === "") return true;
  try {
    const path = new URL(location, "https://placeholder.invalid").pathname.replace(/\/+$/, "");
    return path.toLowerCase() === `/community/${communitySlug.toLowerCase()}/live`;
  } catch {
    return false;
  }
}

/** The stable id of one session, as the page and the sends refer to it. */
export function sessionKey(source: "community" | "event", eventId: number, startsAt: Date): string {
  return `${source === "community" ? "c" : "e"}${eventId}@${startsAt.toISOString()}`;
}

export function parseSessionKey(
  key: string
): { source: "community" | "event"; eventId: number; startsAt: Date } | null {
  const match = /^([ce])(\d+)@(.+)$/.exec(key);
  if (!match) return null;
  const startsAt = new Date(match[3]);
  if (Number.isNaN(startsAt.getTime())) return null;
  return {
    source: match[1] === "c" ? "community" : "event",
    eventId: Number(match[2]),
    startsAt,
  };
}

/** "Friday, October 9, 10:00 AM PDT", in the event's own zone. */
export function formatSessionDate(at: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "America/New_York" }).format(at);
  }
}

/* --------------------------------------------------------------------- links */

export function lessonLink(siteUrl: string, productSlug: string, lessonSlug: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  if (!productSlug || !lessonSlug) return `${base}/library`;
  return `${base}/library/${encodeURIComponent(productSlug)}/lessons/${encodeURIComponent(lessonSlug)}`;
}

/* ---------------------------------------------------------------- dedupe keys */

/** The day a manual send is de-duplicated on, in UTC. */
export function sendDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * One press per person per thing per day.
 *
 * Pressing "Send reminder" twice — or two admins pressing it — is one email.
 * Pressing it again tomorrow is a second reminder, which is what a second
 * press a day later means.
 */
export function manualSendKey(
  kind: "lesson_reminder" | "replay",
  ref: string,
  memberOrEmail: string | number,
  at: Date
): string {
  return `${kind}:${ref}:${String(memberOrEmail).toLowerCase()}:${sendDay(at)}`;
}

/* --------------------------------------------------------------- copy defaults */

export const DEFAULT_LESSON_REMINDER = {
  subject: "Your next lesson is waiting: {{lessonTitle}}",
  bodyMd: [
    "Hi {{firstName}},",
    "",
    "Just a friendly nudge: **{{lessonTitle}}** in {{courseTitle}} is ready for you whenever you are.",
    "",
    "[Watch the lesson]({{lessonUrl}})",
    "",
    "Yvette",
  ].join("\n"),
};

export const DEFAULT_REPLAY_EMAIL = {
  subject: "Sorry we missed you: the replay of {{sessionTitle}}",
  bodyMd: [
    "Hi {{firstName}},",
    "",
    "We missed you at **{{sessionTitle}}** on {{sessionDate}}. The replay is ready, so you can catch up on everything we covered.",
    "",
    "[Watch the replay]({{replayUrl}})",
    "",
    "Yvette",
  ].join("\n"),
};
