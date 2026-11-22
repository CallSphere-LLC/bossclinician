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

/** "December 6": the deadline's own Pacific date, whatever zone the reader is in. */
export function formatBonusDeadline(deadline: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BONUS_TIME_ZONE,
    month: "long",
    day: "numeric",
  }).format(deadline);
}

/* --------------------------------------------------------------- reminders */

export type ReminderKey = "C1" | "C2" | "C3";

/** C1 three days before, C2 one day before, C3 on the final day (her item 3). */
export const REMINDER_DAYS_BEFORE: Record<ReminderKey, number> = { C1: 3, C2: 1, C3: 0 };

/** Position of each reminder in the reminder sequence (migration 215). */
export const REMINDER_POSITION: Record<ReminderKey, number> = { C1: 1, C2: 2, C3: 3 };

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
 * registration came in after it) is simply not sent: nobody gets "3 days left"
 * with one day left.
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

/**
 * Whether `now` falls on a reminder day (Pacific) of an open window. The Club
 * sequence's own promotional email on such a day is skipped so a subscriber
 * never gets two promotional emails the same day (her doc: "Replace overlapping
 * promotional emails and maintain spacing").
 */
export function isReminderDay(deadline: Date, now: Date): boolean {
  if (!withinBonusWindow(deadline, now)) return false;
  const today = pacificDate(now);
  return reminderSlots(deadline).some((slot) => sameDate(slot.date, today));
}
