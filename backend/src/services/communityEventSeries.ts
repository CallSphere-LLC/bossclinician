import { z } from "zod";
import { badRequest } from "../utils/httpError";
import { isValidTimeZone } from "./availability";
import {
  MAX_OCCURRENCES,
  describeRecurrence,
  occurrencesFor,
  recurrenceProblem,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "./events";

/**
 * Community meetups that repeat — Kajabi's "Monthly Coaching Calls", the 9th of
 * every month at 10:00 Pacific (087).
 *
 * The rule, its wall-clock expansion and its wording are the site-wide events'
 * own, from services/events.ts, reused rather than written again: a 10:00
 * Pacific call stays at 10:00 across the November change. What a meetup adds is
 * a series with no end, because Kajabi's meetups repeat until the host stops
 * them. The events helper is built for registrations that must finish and will
 * not expand an open rule past its first session, so an open series is walked
 * here in bounded chunks, each started on the last session of the one before —
 * the same calendar the helper would produce, just never all of it at once.
 *
 * Only the upcoming sessions are ever worked out. Nothing here schedules email:
 * community events have no reminders, for a single session or a series.
 */

/** A community event's `timezone` column default, and the fallback for a bad one. */
export const COMMUNITY_EVENT_DEFAULT_TIMEZONE = "America/Los_Angeles";

/** How many upcoming sessions of a series the member calendar is sent. */
export const SERIES_PREVIEW = 4;

/** The columns a series is made of, as they are read from `community_events`. */
export interface CommunityEventSeries {
  starts_at: Date | null;
  duration_minutes: number;
  timezone: string;
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number;
  /** DATE, selected as `recurrence_until::text` so it stays a calendar day. */
  recurrence_until: string | null;
  recurrence_count: number | null;
}

/** The repeat rule on a stored row, or null for a single session. */
export function communityEventRule(row: CommunityEventSeries): RecurrenceRule | null {
  if (!row.recurrence_freq || !row.starts_at) return null;
  return {
    freq: row.recurrence_freq,
    interval: row.recurrence_interval,
    until: row.recurrence_until,
    count: row.recurrence_count,
  };
}

/** Sessions per chunk of an open series: a couple of years of a monthly call. */
const CHUNK = 24;
/** Chunks before giving up — about 4,000 sessions, a daily meetup for eleven years. */
const MAX_CHUNKS = 170;

function clockIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/**
 * The next `limit` sessions that have not finished by `now`, in order.
 *
 * "Not finished" rather than "not started", as `occurrenceAt` reads it: a call
 * that is on right now is still the one to join. A single session is a series
 * of one, so it is returned while it is still on and not after.
 */
export function upcomingSessions(
  row: CommunityEventSeries,
  now: Date,
  limit: number
): Date[] {
  const start = row.starts_at;
  if (!start || limit < 1) return [];
  const length = Math.max(0, row.duration_minutes) * 60_000;
  const unfinished = (at: Date) => at.getTime() + length >= now.getTime();

  const rule = communityEventRule(row);
  if (!rule) return unfinished(start) ? [start] : [];

  const timeZone = isValidTimeZone(row.timezone) ? row.timezone : COMMUNITY_EVENT_DEFAULT_TIMEZONE;
  if (rule.until !== null || rule.count !== null) {
    return occurrencesFor(start, timeZone, rule).filter(unfinished).slice(0, limit);
  }

  const chunk: RecurrenceRule = { ...rule, count: CHUNK };
  const clock = clockIn(start, timeZone);
  const out: Date[] = [];
  let anchor = start;
  let seen = -Infinity;
  for (let pass = 0; pass < MAX_CHUNKS; pass += 1) {
    const list = occurrencesFor(anchor, timeZone, chunk);
    for (const at of list) {
      if (at.getTime() <= seen) continue;
      seen = at.getTime();
      if (!unfinished(at)) continue;
      out.push(at);
      if (out.length >= limit) return out;
    }
    // The next chunk starts on the latest session that kept the series' own
    // wall-clock time. One that fell in a spring-forward gap was moved by the
    // zone, and starting from it would carry that move into every session after.
    let next = list.length - 1;
    while (next > 0 && clockIn(list[next], timeZone) !== clock) next -= 1;
    if (next === 0) break;
    anchor = list[next];
  }
  return out;
}

/**
 * What the calendar shows for one event: the session to show, whether there is
 * still one to come, and what the series is.
 *
 * `nextStartsAt` is the next session of a series, or null once the series is
 * over; for a single session it is simply `starts_at`, and `upcoming` keeps the
 * rule single sessions always had (not yet started, or no date at all).
 */
export function seriesView(
  row: CommunityEventSeries,
  now: Date,
  preview = SERIES_PREVIEW
): {
  recurring: boolean;
  recurrenceLabel: string;
  nextStartsAt: string | null;
  occurrences: string[];
  upcoming: boolean;
} {
  const rule = communityEventRule(row);
  if (!rule) {
    return {
      recurring: false,
      recurrenceLabel: "",
      nextStartsAt: row.starts_at ? row.starts_at.toISOString() : null,
      occurrences: [],
      upcoming: row.starts_at === null || row.starts_at >= now,
    };
  }
  const sessions = upcomingSessions(row, now, preview).map((at) => at.toISOString());
  return {
    recurring: true,
    recurrenceLabel: describeRecurrence(rule),
    nextStartsAt: sessions[0] ?? null,
    occurrences: sessions,
    upcoming: sessions.length > 0,
  };
}

/**
 * What is wrong with a meetup's repeat rule, in words, or null.
 *
 * The events helper's own checks — a first session, every 1 to 99, an end date
 * or a count but not both, no more than the most sessions a series may have —
 * with the one allowance a meetup needs: no end at all. An open series is
 * checked as if it ran to that maximum, so every other rule still applies.
 */
export function communityRecurrenceProblem(input: {
  startsAt: Date | null;
  timezone: string;
  rule: RecurrenceRule | null;
}): string | null {
  const { rule } = input;
  if (!rule) return null;
  if (!isValidTimeZone(input.timezone)) return "That time zone isn't one we recognise.";
  const startsAt =
    input.startsAt && !Number.isNaN(input.startsAt.getTime()) ? input.startsAt : null;
  const openEnded = rule.until === null && rule.count === null;
  return recurrenceProblem({
    kind: "live",
    startsAt,
    timezone: input.timezone,
    rule: openEnded ? { ...rule, count: MAX_OCCURRENCES } : rule,
  });
}

/** The repeat columns as a save writes them. */
export interface SeriesColumns {
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
  timezone: string;
}

/** The request fields that make up a series, camelCase as the admin sends them. */
export const SERIES_FIELDS = [
  "recurrenceFreq",
  "recurrenceInterval",
  "recurrenceUntil",
  "recurrenceCount",
  "timezone",
] as const;

// Numbers are only checked for being whole here; the ranges are explained in
// words by `recurrenceProblem`, as the site-wide events editor does. A blank
// select or date box arrives as "" and means "none".
const seriesInputSchema = z.object({
  recurrenceFreq: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
  recurrenceInterval: z.number().int().optional(),
  recurrenceUntil: z.string().trim().max(10).nullable().optional(),
  recurrenceCount: z.number().int().nullable().optional(),
  timezone: z.string().trim().max(80).optional(),
});

/** An instant from a request body, or null when there is none or it is not one. */
export function instantOf(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The repeat rule a save leaves on the row: the body's fields over the stored
 * ones (or the defaults, for a new event), normalised the way the site-wide
 * events editor normalises them, then checked against the first session the
 * row will have. Throws a 400 with a sentence rather than letting the table's
 * CHECK arrive as a 500.
 *
 * `touched` is whether the body named any of the fields, so an update that
 * only renames an event leaves the stored rule alone — while still being
 * refused if it clears the date a repeating event needs.
 */
export function seriesAfterSave(
  body: Record<string, unknown>,
  current: SeriesColumns | null,
  startsAt: Date | null
): { columns: SeriesColumns; touched: boolean } {
  const blanksCleared = Object.fromEntries(
    SERIES_FIELDS.filter((field) => field !== "timezone").map((field) => [
      field,
      body[field] === "" ? null : body[field],
    ])
  );
  const parsed = seriesInputSchema.safeParse({ ...blanksCleared, timezone: body.timezone });
  if (!parsed.success) throw badRequest("Check how this event repeats.", parsed.error.flatten());
  const input = parsed.data;
  const base: SeriesColumns = current ?? {
    recurrence_freq: null,
    recurrence_interval: 1,
    recurrence_until: null,
    recurrence_count: null,
    timezone: COMMUNITY_EVENT_DEFAULT_TIMEZONE,
  };
  const touched = SERIES_FIELDS.some((field) => body[field] !== undefined);

  let freq = input.recurrenceFreq !== undefined ? input.recurrenceFreq : base.recurrence_freq;
  let interval = input.recurrenceInterval ?? base.recurrence_interval;
  let until = input.recurrenceUntil !== undefined ? input.recurrenceUntil : base.recurrence_until;
  let count = input.recurrenceCount !== undefined ? input.recurrenceCount : base.recurrence_count;
  // Choosing one way to end replaces the other one that was stored.
  if (input.recurrenceUntil && input.recurrenceCount === undefined) count = null;
  if (input.recurrenceCount != null && input.recurrenceUntil === undefined) until = null;
  // Switching the rule off clears it whole, so the CHECK never sees half a rule.
  if (!freq) {
    freq = null;
    interval = 1;
    until = null;
    count = null;
  }

  let timezone = input.timezone || base.timezone;
  if (!isValidTimeZone(timezone)) {
    if (freq) throw badRequest("That time zone isn't one we recognise.");
    timezone = base.timezone;
  }

  const problem = communityRecurrenceProblem({
    startsAt,
    timezone,
    rule: freq ? { freq, interval, until, count } : null,
  });
  if (problem) throw badRequest(problem);

  return {
    columns: {
      recurrence_freq: freq,
      recurrence_interval: interval,
      recurrence_until: until,
      recurrence_count: count,
      timezone,
    },
    touched,
  };
}
