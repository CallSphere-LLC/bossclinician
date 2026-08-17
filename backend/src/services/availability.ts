import { zonedWallClockToUtc } from "./drip";

/**
 * Bookable coaching slots.
 *
 * Pure: rules, exceptions and existing bookings go in, UTC instants come out.
 * No database, no `new Date()` without an argument. That is what makes "does
 * the 9am Monday slot move an hour on 8 March" a test rather than an argument.
 *
 * The one thing this must never do is apply a fixed UTC offset to the coach's
 * weekly hours. `coach_availability` stores wall-clock minutes in the coach's
 * own zone precisely because that offset changes twice a year; freezing it
 * would shift every appointment by an hour for half the year, in opposite
 * directions either side of the transition. Every rule is therefore resolved
 * per calendar day through `zonedWallClockToUtc`, which is the same machinery
 * drip.ts uses for lesson release times.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A weekly recurring window, as stored in `coach_availability`. */
export interface AvailabilityRule {
  id: number;
  /** IANA zone the minutes below are read in — the COACH's zone, not the member's. */
  timezone: string;
  /** 0 = Sunday, matching JS getDay(). */
  weekday: number;
  startMinute: number;
  endMinute: number;
  active: boolean;
}

/** A one-off exception: a holiday (available=false) or an extra Saturday (true). */
export interface AvailabilityOverride {
  id: number;
  startsAt: Date;
  endsAt: Date;
  available: boolean;
}

/** An appointment already on the calendar, whoever booked it. */
export interface BookedSession {
  id: number;
  startsAt: Date;
  durationMinutes: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  /** "2026-03-08" in the member's zone — the key the UI groups columns by. */
  day: string;
  /** "Sunday, March 8" */
  dayLabel: string;
  /** "9:00 AM EDT" */
  timeLabel: string;
  /** "Sunday, March 8 at 9:00 AM EDT" — ready to render, no client-side tz maths. */
  label: string;
}

export interface ComputeSlotsInput {
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  /** Cancelled sessions must be filtered out by the caller; these all block. */
  existingSessions: BookedSession[];
  durationMinutes: number;
  from: Date;
  to: Date;
  /** The zone every label is rendered in. Falls back to UTC if unknown. */
  memberTimezone: string;
  now: Date;
  /** Nothing may be booked sooner than this. */
  minimumNoticeMinutes?: number;
  /** Distance between consecutive slot starts. Defaults to the slot length. */
  slotIntervalMinutes?: number;
}

/* ------------------------------------------------------------------ policy */

export interface CoachingPolicy {
  /** How far ahead of a session it must be booked. */
  minimumNoticeMinutes: number;
  /** How far ahead of a session it may still be moved or cancelled for free. */
  cancellationWindowMinutes: number;
  /** Gap between offered start times, independent of how long a session runs. */
  slotIntervalMinutes: number;
  /** How far into the future the calendar is open at all. */
  bookingHorizonDays: number;
  /** Used for any availability rule stored without a zone of its own. */
  timezone: string;
  /** Meeting rooms are minted under this origin; "" means use the site URL. */
  meetingUrlBase: string;
}

export const DEFAULT_COACHING_POLICY: CoachingPolicy = {
  minimumNoticeMinutes: 24 * 60,
  cancellationWindowMinutes: 24 * 60,
  slotIntervalMinutes: 30,
  bookingHorizonDays: 60,
  timezone: "America/New_York",
  meetingUrlBase: "",
};

export function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function positiveNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.round(value), max);
}

/**
 * The `coaching` settings row, treated as untrusted.
 *
 * It is free-form JSONB the owner edits herself, so a missing key, a string
 * where a number belongs or a mistyped zone has to degrade to the default here
 * rather than throwing inside Intl on every slot of every request.
 */
export function parseCoachingPolicy(value: unknown): CoachingPolicy {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
  const meetingUrlBase =
    typeof raw.meetingUrlBase === "string" ? raw.meetingUrlBase.trim().replace(/\/+$/, "") : "";

  const noticeHours = raw.minimumNoticeHours;
  const cancelHours = raw.cancellationWindowHours;

  return {
    // Zero is a legitimate answer for both windows ("book anything, cancel any
    // time"), so these cannot go through positiveNumber.
    minimumNoticeMinutes:
      typeof noticeHours === "number" && Number.isFinite(noticeHours) && noticeHours >= 0
        ? Math.min(Math.round(noticeHours * 60), 90 * 24 * 60)
        : DEFAULT_COACHING_POLICY.minimumNoticeMinutes,
    cancellationWindowMinutes:
      typeof cancelHours === "number" && Number.isFinite(cancelHours) && cancelHours >= 0
        ? Math.min(Math.round(cancelHours * 60), 90 * 24 * 60)
        : DEFAULT_COACHING_POLICY.cancellationWindowMinutes,
    slotIntervalMinutes: positiveNumber(
      raw.slotIntervalMinutes,
      DEFAULT_COACHING_POLICY.slotIntervalMinutes,
      12 * 60
    ),
    bookingHorizonDays: positiveNumber(
      raw.bookingHorizonDays,
      DEFAULT_COACHING_POLICY.bookingHorizonDays,
      365
    ),
    timezone: isValidTimeZone(timezone) ? timezone : DEFAULT_COACHING_POLICY.timezone,
    meetingUrlBase,
  };
}

/* --------------------------------------------------------------- formatting */

interface ZoneFormatters {
  key: Intl.DateTimeFormat;
  day: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
}

// Building three DateTimeFormats costs more than formatting with them, and a
// month of slots is a few hundred calls per request.
const formatterCache = new Map<string, ZoneFormatters>();

function formatters(timeZone: string): ZoneFormatters {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const built: ZoneFormatters = {
    key: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    day: new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    time: new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  };
  formatterCache.set(timeZone, built);
  return built;
}

export interface InstantLabels {
  day: string;
  dayLabel: string;
  timeLabel: string;
  label: string;
}

/** How one instant reads to a member in their own zone. */
export function describeInstant(at: Date, timeZone: string): InstantLabels {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const fmt = formatters(zone);
  const dayLabel = fmt.day.format(at);
  const timeLabel = fmt.time.format(at);
  return {
    // en-CA renders ISO-ordered dates, which is the only reason it is used here.
    day: fmt.key.format(at),
    dayLabel,
    timeLabel,
    label: `${dayLabel} at ${timeLabel}`,
  };
}

/* ------------------------------------------------------------------ intervals */

interface Interval {
  start: number;
  end: number;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Every calendar date that could contribute a window to [from, to].
 *
 * Padded by a day either side: a Monday-morning rule in Auckland begins on the
 * preceding Sunday in UTC, and a Friday-evening rule in Los Angeles spills into
 * Saturday. No zone is more than 14 hours from UTC, so one day is enough.
 */
function civilDatesCovering(from: Date, to: Date): CivilDate[] {
  const first = Math.floor(from.getTime() / DAY_MS) * DAY_MS - DAY_MS;
  const last = Math.floor(to.getTime() / DAY_MS) * DAY_MS + DAY_MS;

  const out: CivilDate[] = [];
  for (let ms = first; ms <= last; ms += DAY_MS) {
    const d = new Date(ms);
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }
  return out;
}

/** The weekday a calendar date falls on — independent of any timezone. */
function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      out.push({ start: item.start, end: item.end });
    }
  }
  return out;
}

/** Removes `blocked` from `open`, splitting an interval that is cut in half. */
function subtractIntervals(open: Interval[], blocked: Interval[]): Interval[] {
  let current = open;
  for (const cut of blocked) {
    const next: Interval[] = [];
    for (const item of current) {
      if (cut.end <= item.start || cut.start >= item.end) {
        next.push(item);
        continue;
      }
      if (cut.start > item.start) next.push({ start: item.start, end: cut.start });
      if (cut.end < item.end) next.push({ start: cut.end, end: item.end });
    }
    current = next;
  }
  return current;
}

/**
 * The coach's weekly rules, expanded into real UTC intervals.
 *
 * The conversion happens once per (date, rule) pair rather than once per rule,
 * which is what keeps it correct across a DST transition: the same 9am rule
 * resolves to 14:00Z on the Friday and 13:00Z on the Monday after the clocks
 * change, and neither is derived from the other.
 *
 * A window whose end lands at or before its start is dropped. That is not a
 * data error — it is the hour that does not exist on a spring-forward morning,
 * and offering a slot inside it would be offering a time nobody can attend.
 */
function ruleIntervals(rules: AvailabilityRule[], from: Date, to: Date): Interval[] {
  const active = rules.filter((rule) => rule.active !== false);
  if (active.length === 0) return [];

  const out: Interval[] = [];
  for (const date of civilDatesCovering(from, to)) {
    const weekday = weekdayOf(date);
    for (const rule of active) {
      if (rule.weekday !== weekday) continue;
      const zone = isValidTimeZone(rule.timezone) ? rule.timezone : "UTC";
      const start = zonedWallClockToUtc(
        date.year,
        date.month,
        date.day,
        rule.startMinute,
        zone
      ).getTime();
      const end = zonedWallClockToUtc(date.year, date.month, date.day, rule.endMinute, zone).getTime();
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- the slots */

/**
 * Every start time a member may book in [from, to].
 *
 * Order of operations matters. Extra-availability overrides are unioned with
 * the weekly rules *before* blocked overrides are subtracted, so "open the
 * Saturday" followed by "but not that Saturday afternoon" behaves the way it
 * reads. Booked sessions and the notice window are applied last, against the
 * grid rather than against the windows, because a 30-minute booking inside a
 * three-hour window should remove one slot and not the afternoon.
 */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const durationMs = Math.round(input.durationMinutes) * MINUTE_MS;
  if (durationMs <= 0) return [];
  if (input.to.getTime() <= input.from.getTime()) return [];

  const stepMs =
    Math.round(
      input.slotIntervalMinutes && input.slotIntervalMinutes > 0
        ? input.slotIntervalMinutes
        : input.durationMinutes
    ) * MINUTE_MS;
  if (stepMs <= 0) return [];

  const extra = input.overrides
    .filter((o) => o.available)
    .map((o) => ({ start: o.startsAt.getTime(), end: o.endsAt.getTime() }))
    .filter((o) => o.end > o.start);

  const blocked = input.overrides
    .filter((o) => !o.available)
    .map((o) => ({ start: o.startsAt.getTime(), end: o.endsAt.getTime() }))
    .filter((o) => o.end > o.start);

  const open = subtractIntervals(
    mergeIntervals([...ruleIntervals(input.rules, input.from, input.to), ...extra]),
    blocked
  );

  const notice = Math.max(0, Math.round(input.minimumNoticeMinutes ?? 0)) * MINUTE_MS;
  // The past is excluded by construction rather than by a separate check: the
  // notice window is measured from now, and a zero window still starts at now.
  const earliest = Math.max(input.now.getTime() + notice, input.from.getTime());
  const latest = input.to.getTime();

  const busy = input.existingSessions.map((session) => ({
    start: session.startsAt.getTime(),
    end: session.startsAt.getTime() + Math.max(0, session.durationMinutes) * MINUTE_MS,
  }));

  const starts: number[] = [];
  for (const window of open) {
    for (let start = window.start; start + durationMs <= window.end; start += stepMs) {
      if (start < earliest || start >= latest) continue;
      const end = start + durationMs;
      if (busy.some((taken) => start < taken.end && taken.start < end)) continue;
      starts.push(start);
    }
  }

  const unique = [...new Set(starts)].sort((a, b) => a - b);
  return unique.map((start) => {
    const startsAt = new Date(start);
    return {
      startsAt,
      endsAt: new Date(start + durationMs),
      ...describeInstant(startsAt, input.memberTimezone),
    };
  });
}

/**
 * Whether one exact instant is still bookable.
 *
 * Deliberately routed through `computeSlots` rather than reimplemented: the
 * check that runs under the lock at booking time and the list the member chose
 * from must be the same function, or the two can disagree and the disagreement
 * is only ever visible as a double-booked coach.
 */
export function isSlotBookable(
  input: Omit<ComputeSlotsInput, "from" | "to">,
  startsAt: Date
): boolean {
  const slots = computeSlots({
    ...input,
    from: startsAt,
    to: new Date(startsAt.getTime() + 1),
  });
  return slots.some((slot) => slot.startsAt.getTime() === startsAt.getTime());
}
