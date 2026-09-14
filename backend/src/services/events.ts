import crypto from "crypto";
import { env } from "../config/env";
import { zonedWallClockToUtc } from "./drip";

/**
 * Event timing: when a registrant's session starts, how long the replay lasts,
 * and whether the room is open right now.
 *
 * Everything that decides a time is pure — instants in, instants out, no
 * `new Date()` without an argument — because the hard case cannot be reproduced
 * on demand otherwise. An evergreen webinar on an hourly cadence, registered
 * for at 01:30 on the morning the clocks change, has to start at a moment that
 * exists exactly once.
 *
 * The zone arithmetic is `zonedWallClockToUtc` from the drip engine, reused
 * rather than reimplemented. "The next quarter-hour boundary in New York" and
 * "6am in New York" are the same question, and a second implementation is a
 * second thing to get wrong twice a year.
 */

export type EventKind = "live" | "evergreen" | "replay";

export interface EventSchedule {
  kind: EventKind;
  /** Null for evergreen and replay — there is no one time it happens. */
  startsAt: Date | null;
  durationMinutes: number;
  timezone: string;
  evergreenIntervalMinutes: number | null;
  /** Null means the replay never expires. */
  replayExpiresAfterHours: number | null;
  /** A live event that repeats. Absent or null for a single session. */
  recurrence?: RecurrenceRule | null;
}

/**
 * How soon after registering an evergreen session may begin.
 *
 * Without it, registering four seconds before the boundary hands somebody a
 * session that starts in four seconds — no time to read the confirmation, let
 * alone get a coffee. Kajabi's just-in-time webinars behave the same way: the
 * boundary you are already standing on does not count.
 */
const EVERGREEN_MIN_LEAD_MINUTES = 2;

/** Doors open before the hour, the way a real webinar's do. */
export const DOORS_OPEN_MINUTES = 10;

/** A sane cadence for an evergreen event whose interval is missing or nonsense. */
const DEFAULT_INTERVAL_MINUTES = 60;

interface ZonedReading {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
}

/** The wall-clock reading in `timeZone` at `date`. */
function readInZone(date: Date, timeZone: string): ZonedReading {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    minuteOfDay: get("hour") * 60 + get("minute"),
  };
}

/* -------------------------------------------------------------- recurrence */

/**
 * A live event that repeats: daily, weekly or monthly, every N, until a date or
 * for a number of sessions.
 *
 * Sessions are generated on the wall clock in the event's own zone, never by
 * adding milliseconds. A 6:00 PM Eastern weekly session stays at 6:00 PM on
 * both sides of the November fall-back; seven times 86,400,000 would move it to
 * 5:00 PM for every week after the change. This is also why the calendar file
 * carries each session as its own entry rather than a UTC RRULE — a UTC rule
 * expands in UTC and drifts by the same hour in every calendar that reads it.
 *
 * A rule always ends. An open-ended series cannot be written out as sessions,
 * and a registration that never finishes cannot be reported on.
 */

export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Every N days, weeks or months. */
  interval: number;
  /** The last calendar date a session may fall on, YYYY-MM-DD in the event's zone (inclusive). */
  until: string | null;
  /** How many sessions in all, the first included. */
  count: number | null;
}

/** The most sessions one series may have — enough for a daily event for half a year. */
export const MAX_OCCURRENCES = 200;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function expandOccurrences(
  startsAt: Date,
  timeZone: string,
  rule: RecurrenceRule,
  cap: number
): Date[] {
  const first = readInZone(startsAt, timeZone);
  const interval = Number.isInteger(rule.interval) && rule.interval > 0 ? rule.interval : 1;
  const limit = Math.min(rule.count ?? cap, cap);
  const until = rule.until && DATE_ONLY.test(rule.until) ? rule.until : null;

  const out: Date[] = [];
  // A monthly rule on the 31st skips the months that do not have one — the
  // same answer RRULE gives — so the loop allows for misses.
  const maxSteps = limit * 12 + 12;
  for (let step = 0; step < maxSteps && out.length < limit; step += 1) {
    let year: number;
    let month: number;
    const day = first.day;

    if (rule.freq === "monthly") {
      const probe = new Date(Date.UTC(first.year, first.month - 1 + step * interval, 1, 12));
      year = probe.getUTCFullYear();
      month = probe.getUTCMonth() + 1;
      if (until && dateKey(year, month, 1) > until) break;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (day > daysInMonth) continue;
      if (until && dateKey(year, month, day) > until) break;
      out.push(
        step === 0 ? startsAt : zonedWallClockToUtc(year, month, day, first.minuteOfDay, timeZone)
      );
      continue;
    }

    const days = (rule.freq === "weekly" ? 7 : 1) * step * interval;
    // Anchored at midday so the calendar arithmetic cannot be moved by a
    // transition, then read back as a date.
    const probe = new Date(Date.UTC(first.year, first.month - 1, first.day + days, 12));
    year = probe.getUTCFullYear();
    month = probe.getUTCMonth() + 1;
    const probeDay = probe.getUTCDate();
    if (until && dateKey(year, month, probeDay) > until) break;
    out.push(
      step === 0 ? startsAt : zonedWallClockToUtc(year, month, probeDay, first.minuteOfDay, timeZone)
    );
  }
  return out.length > 0 ? out : [startsAt];
}

/**
 * Every session of an event, in order. A single-session event is a series of
 * one, so callers never need a second code path.
 */
export function occurrencesFor(
  startsAt: Date,
  timeZone: string,
  rule: RecurrenceRule | null | undefined
): Date[] {
  if (!rule || (rule.count === null && rule.until === null)) return [startsAt];
  return expandOccurrences(startsAt, timeZone, rule, MAX_OCCURRENCES);
}

/**
 * The session a registration is about at `now`: the first one that has not yet
 * finished, or the last one once the whole series is over.
 *
 * `notBefore` is the registration's own first session, so somebody who joined
 * a series half way through is never shown — or reminded about — the sessions
 * that happened before they signed up.
 */
export function occurrenceAt(
  occurrences: Date[],
  durationMinutes: number,
  now: Date,
  notBefore?: Date | null
): Date | null {
  const eligible = notBefore
    ? occurrences.filter((at) => at.getTime() >= notBefore.getTime())
    : occurrences;
  const series = eligible.length > 0 ? eligible : occurrences;
  if (series.length === 0) return null;
  const length = durationMinutes * 60_000;
  return series.find((at) => at.getTime() + length >= now.getTime()) ?? series[series.length - 1];
}

const FREQ_UNIT: Record<RecurrenceFreq, string> = { daily: "day", weekly: "week", monthly: "month" };

/** "Every week, 6 sessions" / "Every 2 weeks until October 31, 2026". */
export function describeRecurrence(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return "";
  const unit = FREQ_UNIT[rule.freq] ?? "week";
  const head = rule.interval > 1 ? `Every ${rule.interval} ${unit}s` : `Every ${unit}`;
  if (rule.count !== null) {
    return `${head}, ${rule.count} ${rule.count === 1 ? "session" : "sessions"}`;
  }
  const match = rule.until ? DATE_ONLY.exec(rule.until) : null;
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

/**
 * What is wrong with a repeat rule, in words about the event, or null.
 *
 * The table has a CHECK constraint as a backstop; this is the sentence the
 * editor shows instead of a constraint name.
 */
export function recurrenceProblem(input: {
  kind: string;
  startsAt: Date | null;
  timezone: string;
  rule: RecurrenceRule | null;
}): string | null {
  const { rule } = input;
  if (!rule) return null;
  if (input.kind !== "live") {
    return "Only a live event can repeat. An always-on event already runs on its own cadence.";
  }
  if (!input.startsAt) return "A repeating event needs the date and time of its first session.";
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99) {
    return "Repeat every 1 to 99 days, weeks or months.";
  }
  if (rule.until !== null && rule.count !== null) {
    return "Choose an end date or a number of sessions, not both.";
  }
  if (rule.until === null && rule.count === null) {
    return "Say when the repeats stop: an end date, or a number of sessions.";
  }
  if (rule.count !== null && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > MAX_OCCURRENCES)) {
    return `A series can have between 1 and ${MAX_OCCURRENCES} sessions.`;
  }
  if (rule.until !== null) {
    const match = DATE_ONLY.exec(rule.until);
    const probe = match
      ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      : null;
    if (!match || !probe || probe.getUTCDate() !== Number(match[3])) {
      return "The end date isn't a real date.";
    }
    const first = readInZone(input.startsAt, input.timezone);
    if (rule.until < dateKey(first.year, first.month, first.day)) {
      return "The end date is before the first session.";
    }
    const expanded = expandOccurrences(input.startsAt, input.timezone, rule, MAX_OCCURRENCES + 1);
    if (expanded.length > MAX_OCCURRENCES) {
      return `That end date makes more than ${MAX_OCCURRENCES} sessions. Pick an earlier date, or a number of sessions instead.`;
    }
  }
  return null;
}

/**
 * The instant this registrant's session starts.
 *
 * A live event has one start and everybody shares it. A replay is available the
 * moment they sign up. An evergreen event starts at the next cadence boundary —
 * measured in local wall-clock minutes past midnight, so an "every 15 minutes"
 * webinar starts on :00/:15/:30/:45 in the event's own zone rather than on some
 * offset inherited from whenever the row was created.
 *
 * The advance is a loop rather than one calculation because a wall-clock
 * boundary is not guaranteed to move forward: on the day the clocks go back,
 * 01:30 happens twice, and the naive next boundary can land in the past. The
 * loop keeps stepping until the candidate is genuinely ahead of the registrant.
 * A repeated hour is therefore skipped rather than run twice, which is what a
 * wall-clock cadence means and what a calendar app does with the same rule.
 */
export function sessionTimeFor(event: EventSchedule, registeredAt: Date): Date {
  if (event.kind === "live") {
    // The `event_shape` constraint guarantees a live event has a start; the
    // fallback only keeps a half-written draft from producing an invalid date.
    if (!event.startsAt) return registeredAt;
    if (!event.recurrence) return event.startsAt;
    // A series: the next session that has not finished yet, so signing up in
    // week three books week three rather than a Tuesday that has gone.
    return (
      occurrenceAt(
        occurrencesFor(event.startsAt, event.timezone, event.recurrence),
        event.durationMinutes,
        registeredAt
      ) ?? event.startsAt
    );
  }
  if (event.kind === "replay") return registeredAt;

  const interval =
    event.evergreenIntervalMinutes !== null && event.evergreenIntervalMinutes > 0
      ? event.evergreenIntervalMinutes
      : DEFAULT_INTERVAL_MINUTES;

  const reading = readInZone(registeredAt, event.timezone);
  const earliest = registeredAt.getTime() + EVERGREEN_MIN_LEAD_MINUTES * 60_000;

  // Enough passes to cross a whole day plus a DST hour, so no cadence can spin
  // the loop; day overflow past 1440 minutes is normalised by Date.UTC inside
  // zonedWallClockToUtc.
  const passes = Math.min(2000, Math.ceil(1440 / interval) + 8);
  let slot = Math.floor(reading.minuteOfDay / interval) * interval;

  for (let pass = 0; pass < passes; pass += 1) {
    const candidate = zonedWallClockToUtc(
      reading.year,
      reading.month,
      reading.day,
      slot,
      event.timezone
    );
    if (candidate.getTime() >= earliest) return candidate;
    slot += interval;
  }

  // Unreachable for any real cadence; a plain offset beats returning something
  // in the past if a zone ever behaves in a way this has not imagined.
  return new Date(earliest);
}

/** When the replay stops working, or null when it never does. */
export function replayExpiryFor(event: EventSchedule, sessionAt: Date): Date | null {
  if (event.replayExpiresAfterHours === null) return null;
  const endsAt = sessionAt.getTime() + event.durationMinutes * 60_000;
  return new Date(endsAt + event.replayExpiresAfterHours * 3_600_000);
}

export interface RegistrationWindow {
  sessionAt: Date;
  durationMinutes: number;
  replayExpiresAt: Date | null;
  /** Whether a replay recording exists at all. */
  hasReplay: boolean;
}

export type RoomState = "early" | "live" | "replay" | "expired" | "ended";

export interface RoomAccess {
  open: boolean;
  state: RoomState;
  /** When the doors open. Set only while `state` is "early". */
  opensAt: Date | null;
  /** When access ends: the session's end, or the replay's expiry. */
  closesAt: Date | null;
}

/**
 * Whether this registrant may be in the room at `now`.
 *
 * Four refusals, and they are not interchangeable. "Too early" is answered with
 * the time to come back; "the replay closed" is answered with the date it
 * closed, which is the difference between a page somebody trusts and one they
 * email about. A missing recording is neither — the session simply happened and
 * there is nothing left to watch.
 */
export function isRoomOpen(registration: RegistrationWindow, now: Date): RoomAccess {
  const startsAt = registration.sessionAt.getTime();
  const doorsAt = new Date(startsAt - DOORS_OPEN_MINUTES * 60_000);
  const endsAt = new Date(startsAt + registration.durationMinutes * 60_000);

  if (now.getTime() < doorsAt.getTime()) {
    return { open: false, state: "early", opensAt: doorsAt, closesAt: endsAt };
  }

  if (now.getTime() <= endsAt.getTime()) {
    return { open: true, state: "live", opensAt: null, closesAt: endsAt };
  }

  if (!registration.hasReplay) {
    return { open: false, state: "ended", opensAt: null, closesAt: endsAt };
  }

  if (
    registration.replayExpiresAt !== null &&
    now.getTime() > registration.replayExpiresAt.getTime()
  ) {
    return { open: false, state: "expired", opensAt: null, closesAt: registration.replayExpiresAt };
  }

  return { open: true, state: "replay", opensAt: null, closesAt: registration.replayExpiresAt };
}

/* ---------------------------------------------------------------- calendar */

/** Escapes the four characters iCalendar gives meaning to inside a value. */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Long values are folded at 74 octets with a leading space on the continuation,
 * per RFC 5545. Outlook is the one that cares: an unfolded 400-character
 * description makes it reject the whole file rather than the one line.
 */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) parts.push(` ${line.slice(i, i + 73)}`);
  return parts.join("\r\n");
}

export interface CalendarInvite {
  uid: string;
  title: string;
  description: string;
  url: string;
  startsAt: Date;
  durationMinutes: number;
  /** Stamped as DTSTAMP. Passed in so the output is reproducible in a test. */
  generatedAt?: Date;
  /** A physical address, written as LOCATION. Empty for an online event. */
  location?: string;
  /**
   * Every session of a repeating event. When there is more than one, each is
   * written as its own VEVENT; `startsAt` is ignored in favour of the list.
   */
  occurrences?: Date[];
}

/** "event-7-registration-42@bossclinician" → "event-7-registration-42-s3@bossclinician". */
function occurrenceUid(uid: string, index: number): string {
  const at = uid.lastIndexOf("@");
  return at === -1 ? `${uid}-s${index + 1}` : `${uid.slice(0, at)}-s${index + 1}${uid.slice(at)}`;
}

/**
 * A calendar file: one VEVENT, or one per session of a repeating event.
 *
 * Times are written in UTC rather than with a VTIMEZONE block: the instant is
 * unambiguous, every calendar client renders it in the reader's own zone, and
 * shipping a timezone definition is a way to be wrong in a client nobody here
 * can test against.
 *
 * A series is written as separate VEVENTs rather than an RRULE for the same
 * reason. A rule anchored on a UTC DTSTART expands in UTC, so a weekly 6:00 PM
 * Eastern session would show at 5:00 PM in every calendar after the clocks go
 * back. The sessions here are already computed on the event's own wall clock,
 * so writing each one out is exactly right in every client.
 */
export function buildIcs(invite: CalendarInvite): string {
  const sessions =
    invite.occurrences && invite.occurrences.length > 0 ? invite.occurrences : [invite.startsAt];
  const stamp = icsStamp(invite.generatedAt ?? invite.startsAt);
  const location = invite.location?.trim() ?? "";

  const events = sessions.flatMap((startsAt, index) => {
    const endsAt = new Date(startsAt.getTime() + invite.durationMinutes * 60_000);
    return [
      "BEGIN:VEVENT",
      `UID:${sessions.length === 1 ? invite.uid : occurrenceUid(invite.uid, index)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(startsAt)}`,
      `DTEND:${icsStamp(endsAt)}`,
      `SUMMARY:${icsEscape(invite.title)}`,
      `DESCRIPTION:${icsEscape(invite.description)}`,
      ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
      `URL:${icsEscape(invite.url)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(invite.title)}`,
      "END:VALARM",
      "END:VEVENT",
    ];
  });

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Boss Clinician//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ];
  // CRLF, which the spec requires and several clients enforce.
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/* ------------------------------------------------------- registration links */

/**
 * The link in a confirmation email has to work in a browser that has never
 * signed in to anything, so it carries its own proof. A signed registration id
 * rather than a random column: nothing to store, nothing to leak from the
 * table, and a link that cannot be enumerated by counting.
 *
 * HKDF over JWT_SECRET with its own `info` string, exactly as auth/secrets.ts
 * and services/signedUrls.ts do — a room link and a session token are then not
 * interchangeable, and no new environment variable has to be deployed.
 */
const REGISTRATION_INFO = "bossclinician/event-registration/v1";

/** Bumped if the payload layout changes, so old links fail closed. */
const TOKEN_VERSION = "e1";

let signingKey: Buffer | null = null;

function key(): Buffer {
  if (signingKey === null) {
    signingKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(REGISTRATION_INFO, "utf8"),
        32
      )
    );
  }
  return signingKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

/** The token that stands for one registration in a link. */
export function signRegistration(registrationId: number): string {
  const body = Buffer.from(`${TOKEN_VERSION}.${registrationId}`, "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The registration a token names, or null if it has been tampered with. */
export function verifyRegistration(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;

  const expected = sign(body);
  // Lengths first: timingSafeEqual throws rather than returning false when they
  // differ.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  const fields = Buffer.from(body, "base64url").toString("utf8").split(".");
  if (fields.length !== 2 || fields[0] !== TOKEN_VERSION) return null;

  const id = Number(fields[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/* ------------------------------------------------------------------ labels */

/**
 * "Tuesday, 3 March at 2:00 PM EST" — the one spelling of a session time.
 *
 * Every surface that tells somebody when to turn up reads from here: the
 * confirmation, the three reminders and the room's own countdown. The zone
 * label is included deliberately; a webinar time with no zone on it is the
 * reason people arrive three hours late.
 */
export function describeSession(sessionAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(sessionAt);
}

/* --------------------------------------------------------------- reminders */

/**
 * Event reminders: when one fires, and whether it may still be sent.
 *
 * The page has always promised these — "I'll hold you a place and remind you
 * before we start" — and until now the only reminders that existed were three
 * hard-coded steps buried in a job file, with no configuration, no record of
 * what went, and no way to tell a reminder that was sent from one that was
 * rejected by the mail provider. The configuration now lives on the event; the
 * arithmetic that decides *when* lives here, pure, because the two ways to get
 * it wrong are both unreproducible after the fact: a reminder that lands an
 * hour out across a DST boundary, and a reminder that fires for a webinar which
 * finished last week because the scheduler was restarted.
 */

export type ReminderKind = "registration" | "before";

export interface ReminderSpec {
  kind: ReminderKind;
  /** Minutes before the session starts. Always 0 for a registration reminder. */
  offsetMinutes: number;
}

/**
 * How late a reminder may be and still be worth sending.
 *
 * The scheduler ticks every few minutes, so a minute or two of lateness is
 * ordinary. An hour is not: it means the worker was down, and the whole point
 * of a cap is that coming back up must not fire a backlog of reminders whose
 * moment has gone. They are recorded as skipped instead, which is a fact
 * somebody can look at rather than an email somebody has to apologise for.
 */
export const REMINDER_MAX_LATENESS_MINUTES = 60;

/**
 * The same cap for a registration confirmation, which is more forgiving.
 *
 * A confirmation three hours late is still the answer to "did that go
 * through?", whereas a reminder three hours late for a webinar that started two
 * hours ago is noise. The blast hazard is handled elsewhere and by
 * construction: confirmations are only ever scheduled for registrations taken
 * *after* the reminder was configured, so switching one on cannot mail the
 * back catalogue.
 */
export const REGISTRATION_REMINDER_MAX_LATENESS_MINUTES = 360;

/** Whole days, so "2 days before" is a wall-clock question rather than 2880 minutes. */
function isWholeDays(offsetMinutes: number): boolean {
  return offsetMinutes >= 1440 && offsetMinutes % 1440 === 0;
}

/**
 * The same wall-clock time, N calendar days earlier, in `timeZone`.
 *
 * Subtracting 86,400,000 milliseconds is not the same question. A 6:00 PM
 * Eastern webinar on 8 November wants its day-before reminder at 6:00 PM on the
 * 7th — but the clocks go back on the 1st in some years and forward in March,
 * and any pair of dates that straddles a transition is an hour out under
 * millisecond arithmetic. An hour out is exactly the error that makes somebody
 * distrust every time the platform ever shows them.
 */
function sameTimeDaysEarlier(at: Date, days: number, timeZone: string): Date {
  const reading = readInZone(at, timeZone);
  // Anchored at midday so the day arithmetic cannot itself be moved by a
  // transition, then read back as a calendar date.
  const shifted = new Date(Date.UTC(reading.year, reading.month - 1, reading.day - days, 12));
  return zonedWallClockToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    reading.minuteOfDay,
    timeZone
  );
}

/**
 * The instant a reminder is due.
 *
 * A registration confirmation is due when they registered. Everything else is
 * measured back from *this registrant's own* session — which for an evergreen
 * event is their session and nobody else's — in the event's own zone.
 */
export function reminderFireTime(
  spec: ReminderSpec,
  input: { sessionAt: Date; registeredAt: Date; timezone: string }
): Date {
  if (spec.kind === "registration") return input.registeredAt;
  if (spec.offsetMinutes <= 0) return input.sessionAt;
  if (isWholeDays(spec.offsetMinutes)) {
    return sameTimeDaysEarlier(input.sessionAt, spec.offsetMinutes / 1440, input.timezone);
  }
  return new Date(input.sessionAt.getTime() - spec.offsetMinutes * 60_000);
}

/**
 * "send" now, "wait" for later, or "skip" because the moment has gone.
 *
 * One function, two callers, on purpose. The scheduler asks it when it writes
 * the plan — so a reminder configured after its own moment has passed is
 * recorded as skipped rather than queued — and asks it again immediately before
 * sending, because a row can sit in the queue across a restart that lasts
 * longer than the reminder means anything for. Two copies of this rule would be
 * two chances to send yesterday's reminders today.
 */
export type ReminderVerdict = "send" | "wait" | "skip";

export function reminderVerdict(input: {
  kind: ReminderKind;
  offsetMinutes: number;
  scheduledFor: Date;
  sessionAt: Date;
  durationMinutes: number;
  now: Date;
}): ReminderVerdict {
  const now = input.now.getTime();
  const due = input.scheduledFor.getTime();
  const session = input.sessionAt.getTime();

  if (now < due) return "wait";

  // The session is over. Nothing that says "before we start" or "you're
  // registered" is true any more, whatever the queue still holds.
  if (now >= session + input.durationMinutes * 60_000) return "skip";

  // A reminder that promises time to prepare must not arrive after the start.
  // The one deliberately scheduled *at* the start is exempt: "we're live, come
  // on in" is still true five minutes in.
  if (input.kind === "before" && input.offsetMinutes > 0 && now >= session) return "skip";

  const cap =
    input.kind === "registration"
      ? REGISTRATION_REMINDER_MAX_LATENESS_MINUTES
      : REMINDER_MAX_LATENESS_MINUTES;
  if (now - due > cap * 60_000) return "skip";

  return "send";
}

/**
 * The offset in words — the label the editor, the public page and the member's
 * own list all read, so the promise made at signup and the promise shown later
 * are the same sentence.
 */
export function describeReminderOffset(spec: ReminderSpec): string {
  if (spec.kind === "registration") return "as soon as they sign up";
  const minutes = spec.offsetMinutes;
  if (minutes <= 0) return "when it starts";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return `${minutes} minutes before`;
}

/**
 * The reminder set a new event starts with.
 *
 * Chosen to match what the platform's copy already promises and what the
 * hard-coded job used to do — the day before, the hour before, and the moment
 * the doors open — plus the confirmation that was promised and never actually
 * sent. Defaults rather than requirements: every one of them can be turned off
 * or removed on the event.
 */
export const DEFAULT_EVENT_REMINDERS: ReminderSpec[] = [
  { kind: "registration", offsetMinutes: 0 },
  { kind: "before", offsetMinutes: 1440 },
  { kind: "before", offsetMinutes: 60 },
  { kind: "before", offsetMinutes: 0 },
];
