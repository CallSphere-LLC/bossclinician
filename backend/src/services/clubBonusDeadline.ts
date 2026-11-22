import { zonedWallClockToUtc } from "./drip";

/**
 * The Club's Ramp-Up Rate Formula bonus window (Yvette, 22 Nov 2026, item 3).
 *
 * "Give each subscriber until 11:59 p.m. Pacific Time, 14 calendar days after
 *  their first registration for the Club training, to enroll and receive the
 *  bonus ... someone registering on November 22 would have until December 6 at
 *  11:59 p.m. Pacific Time. ... Use the America/Los_Angeles time zone to
 *  account for daylight saving time."
 *
 * Pure on purpose: no database, no environment, so the arithmetic that decides
 * whether somebody gets a $197 bonus is tested on its own.
 *
 * The rule is calendar arithmetic in Los Angeles, never "+ 14 × 24 hours":
 *  - take the Pacific calendar date of the first registration (a 11:30 p.m. PT
 *    sign-up is already the next day in UTC, and still counts as its own day);
 *  - add 14 calendar days;
 *  - the window closes at the end of that day, Pacific: the last instant before
 *    00:00 on the 15th day, whatever the UTC offset is on that date.
 */

export const BONUS_TIME_ZONE = "America/Los_Angeles";

/** Calendar days after the first registration that the bonus stays open. */
export const BONUS_WINDOW_DAYS = 14;

/** 9 a.m. Pacific, the Club sequence's own send time (migration 202). */
export const REMINDER_SEND_MINUTE = 9 * 60;

/**
 * How long after its 9 a.m. slot a reminder may still go out. A tick that was
 * down for an hour still delivers; switching the reminders on days later never
 * sends a stale "3 days left" (there is no backfill past this).
 */
export const REMINDER_GRACE_MINUTES = 6 * 60;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** The calendar date an instant falls on in Los Angeles. */
export function pacificDate(at: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BONUS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** A calendar date `days` on, with month/year overflow handled by Date.UTC. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function sameDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Midnight that begins `date` in Los Angeles, as a UTC instant. */
function pacificMidnight(date: CalendarDate): Date {
  return zonedWallClockToUtc(date.year, date.month, date.day, 0, BONUS_TIME_ZONE);
}

/**
 * The bonus deadline for somebody whose FIRST registration was at `firstRegisteredAt`:
 * 23:59:59.999 Pacific on the 14th calendar day after it.
 */
export function bonusDeadlineFor(firstRegisteredAt: Date): Date {
  const lastDay = addCalendarDays(pacificDate(firstRegisteredAt), BONUS_WINDOW_DAYS);
  const close = pacificMidnight(addCalendarDays(lastDay, 1));
  return new Date(close.getTime() - 1);
}

/**
 * The deadline for a contact whose registrations are `registrations`: always
 * the earliest one, so registering again never restarts the window.
 */
export function bonusDeadlineForRegistrations(registrations: Date[]): Date | null {
  const valid = registrations.filter((d) => Number.isFinite(d.getTime()));
  if (valid.length === 0) return null;
  const first = valid.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  return bonusDeadlineFor(first);
}

/** Whether something done at `at` is inside the window (11:59 p.m. counts; midnight does not). */
export function withinBonusWindow(deadline: Date, at: Date): boolean {
  return at.getTime() <= deadline.getTime();
}

/** "December 6": the deadline's own Pacific date, whatever zone the reader is in (Club page / checkout). */
export function formatBonusDeadline(deadline: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BONUS_TIME_ZONE,
    month: "long",
    day: "numeric",
  }).format(deadline);
}

/* ------------------------------------------------- the email's deadline */

/** The zone's name as the Club page and checkout write it ("11:59 p.m. Pacific Time"). */
export const BONUS_TIME_ZONE_LABEL = "Pacific Time";

/**
 * Migration 221 (Yvette, 22 Nov round 2, item 2): the three deadline fields of
 * the revised C1-C3, all from the SAME saved `deadline_at` that checkout
 * eligibility uses (club_bonus_windows.deadline_at), never recomputed:
 *   {{bonus_deadline_date}}     "December 6, 2026"
 *   {{bonus_deadline_time}}     "11:59 p.m."
 *   {{bonus_deadline_timezone}} "Pacific Time"
 * Rendered in Los Angeles whatever zone the server or reader is in, so the
 * email says what /club and /club/checkout say ("December 6 at 11:59 p.m.
 * Pacific Time"), with the year added because an email is read later.
 */
export function bonusDeadlineMergeValues(deadline: Date): {
  bonus_deadline_date: string;
  bonus_deadline_time: string;
  bonus_deadline_timezone: string;
} {
  if (!Number.isFinite(deadline.getTime())) {
    return { bonus_deadline_date: "", bonus_deadline_time: "", bonus_deadline_timezone: "" };
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: BONUS_TIME_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(deadline);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BONUS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(deadline);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const dayPeriod = get("dayPeriod").toUpperCase();
  const period = dayPeriod === "AM" ? "a.m." : dayPeriod === "PM" ? "p.m." : "";
  const hour = get("hour");
  const minute = get("minute");
  return {
    bonus_deadline_date: date,
    bonus_deadline_time: hour && minute && period ? `${hour}:${minute} ${period}` : "",
    bonus_deadline_timezone: BONUS_TIME_ZONE_LABEL,
  };
}

/* ------------------------------------------- the placeholder hard guard */

/** first_name / firstname are the renderer's aliases for firstName (email/provider.ts). */
function valueFor(key: string, values: Record<string, string>): string {
  const resolved = /^(firstname|first_name)$/i.test(key) ? "firstName" : key;
  return values[resolved] ?? "";
}

/**
 * Every reason a reminder must NOT go out as written, or [] when it may.
 *
 * `renderTokens` quietly blanks a token it has no value for, so the danger is
 * not a literal "{{bonus_deadline_date}}" but "Join The Club by  at  " — every
 * token in the subject, preview and body must have a non-empty value BEFORE
 * rendering. Also refused: a doc-style placeholder ("[ENROLLMENT_CLOSE_DATE]"),
 * a brace left behind, and the doc's own instruction lines ("Send: ...").
 * Pure, so it is tested without the renderer.
 */
export function unresolvedPlaceholders(templates: string[], values: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const template of templates) {
    const text = template ?? "";
    for (const match of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      if (!valueFor(match[1], values).trim()) problems.push(`{{${match[1]}}} has no value`);
    }
    // Whatever is left once the well-formed tokens are taken out.
    const rest = text.replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
    if (/\{\{|\}\}/.test(rest)) problems.push("malformed {{ }} token");
    const bracket = rest.match(/\[[A-Z][A-Z0-9_ ]{2,}\]/);
    if (bracket) problems.push(`placeholder ${bracket[0]}`);
    const plain = rest.replace(/<[^>]*>/g, "\n");
    const note = plain.match(/(^|\n)\s*(Subject|Preview|Send|Note|TODO|Internal)\s*:/i);
    if (note) problems.push(`internal note "${note[2]}:"`);
  }
  return [...new Set(problems)];
}

/* --------------------------------------------------------------- reminders */

export type ReminderKey = "C1" | "C2" | "C3";

/**
 * Revised doc (22 Nov round 2): "Schedule C1 five days before the deadline,
 * C2 two days before, and C3 on the deadline date before expiry." Calendar
 * days in Los Angeles, counted from the deadline's own date.
 */
export const REMINDER_DAYS_BEFORE: Record<ReminderKey, number> = { C1: 5, C2: 2, C3: 0 };

/** How far ahead of a deadline the dispatcher must look to see every slot. */
export const REMINDER_LOOKAHEAD_DAYS = Math.max(...Object.values(REMINDER_DAYS_BEFORE)) + 1;

/** Position of each reminder in the reminder sequence (migration 215). */
export const REMINDER_POSITION: Record<ReminderKey, number> = { C1: 1, C2: 2, C3: 3 };

/**
 * "Maintain at least 24 hours between promotional emails." Every Club email
 * goes in the same 9 a.m. Pacific slot, so consecutive days are exactly 24
 * hours apart on paper and a few minutes less in practice (each send happens on
 * a scheduler tick). A strict 24-hour test would suppress every next-day email
 * over tick jitter, so two promotions conflict when they fall on the same
 * Pacific calendar day OR less than this many hours apart.
 */
export const MIN_PROMOTION_GAP_HOURS = 23;

export interface ReminderSlot {
  key: ReminderKey;
  /** The Pacific date it belongs to. */
  date: CalendarDate;
  /** 9 a.m. Pacific on that date. */
  sendAt: Date;
}

/** The three reminder slots for a deadline, in order. */
export function reminderSlots(deadline: Date): ReminderSlot[] {
  const lastDay = pacificDate(deadline);
  return (Object.keys(REMINDER_DAYS_BEFORE) as ReminderKey[]).map((key) => {
    const date = addCalendarDays(lastDay, -REMINDER_DAYS_BEFORE[key]);
    return {
      key,
      date,
      sendAt: zonedWallClockToUtc(date.year, date.month, date.day, REMINDER_SEND_MINUTE, BONUS_TIME_ZONE),
    };
  });
}

/**
 * The reminder that should go out at `now`, or null.
 *
 * Due from its 9 a.m. slot for `REMINDER_GRACE_MINUTES`, and never once the
 * window has closed. A slot that was missed (the reminders were off, or the
 * registration came in after it) is simply not sent: nobody gets "five days
 * left" with two days left. C3's slot is 9 a.m. on the deadline's own date, so
 * it always arrives on the displayed calendar date, before 11:59 p.m.
 */
export function dueReminder(
  deadline: Date,
  now: Date,
  graceMinutes: number = REMINDER_GRACE_MINUTES
): ReminderSlot | null {
  if (!withinBonusWindow(deadline, now)) return null;
  for (const slot of reminderSlots(deadline)) {
    const opens = slot.sendAt.getTime();
    if (now.getTime() >= opens && now.getTime() < opens + graceMinutes * 60_000) return slot;
  }
  return null;
}

/** Whether `now` falls on a reminder day (Pacific) of an open window. */
export function isReminderDay(deadline: Date, now: Date): boolean {
  if (!withinBonusWindow(deadline, now)) return false;
  const today = pacificDate(now);
  return reminderSlots(deadline).some((slot) => sameDate(slot.date, today));
}

/** What the C1-C3 ledger (club_bonus_reminder_sends) says about one window. */
export type ReminderLedger = Partial<Record<ReminderKey, { sentAt: Date; sent: boolean }>>;

/**
 * When each reminder goes (or went) out for this subscriber, leaving out the
 * ones that will not: a reminder already sent counts at its real send time;
 * one not yet sent counts at its slot while that slot can still be sent
 * (before its grace runs out, inside the window). A reminder the ledger shows
 * as not sent (suppressed, skipped for spacing, blocked) or a missed slot is
 * gone.
 */
export function liveReminderTimes(
  deadline: Date,
  now: Date,
  ledger: ReminderLedger,
  graceMinutes: number = REMINDER_GRACE_MINUTES
): Partial<Record<ReminderKey, Date>> {
  const live: Partial<Record<ReminderKey, Date>> = {};
  for (const slot of reminderSlots(deadline)) {
    const entry = ledger[slot.key];
    if (entry) {
      if (entry.sent) live[slot.key] = entry.sentAt;
      continue;
    }
    const closes = slot.sendAt.getTime() + graceMinutes * 60_000;
    if (now.getTime() < closes && withinBonusWindow(deadline, slot.sendAt) && withinBonusWindow(deadline, now)) {
      live[slot.key] = slot.sendAt;
    }
  }
  return live;
}

/** Same Pacific calendar day, or less than MIN_PROMOTION_GAP_HOURS apart. */
export function tooClose(a: Date, b: Date): boolean {
  return (
    sameDate(pacificDate(a), pacificDate(b)) ||
    Math.abs(a.getTime() - b.getTime()) < MIN_PROMOTION_GAP_HOURS * 3_600_000
  );
}

/**
 * Why an ORDINARY Club promotion due at `now` is suppressed for a subscriber
 * with a bonus window, or '' to send it (revised doc: "Replace Email 8 with C1
 * and replace Email 11 with C2 ... preserve at least 24 hours between
 * promotions; suppress a conflicting ordinary promotion rather than delaying a
 * reminder past expiry").
 *
 *  - `replaces`: this email is replaced by that reminder (Email 8 → C1,
 *    Email 11 → C2) whenever the reminder has gone or will still go. If the
 *    reminder can no longer go (missed, suppressed), the email is sent.
 *  - always: suppressed when a live reminder is too close to now.
 */
export function promotionConflict(
  deadline: Date,
  now: Date,
  ledger: ReminderLedger,
  replaces?: ReminderKey
): string {
  const live = liveReminderTimes(deadline, now, ledger);
  if (replaces && live[replaces]) return `replaced by ${replaces} bonus reminder`;
  for (const key of Object.keys(live) as ReminderKey[]) {
    const at = live[key];
    if (at && tooClose(at, now)) return `${key} bonus reminder within 24 hours`;
  }
  return "";
}

