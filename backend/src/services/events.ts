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
    return event.startsAt ?? registeredAt;
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
}

/**
 * A one-event .ics file.
 *
 * Times are written in UTC rather than with a VTIMEZONE block: the instant is
 * unambiguous, every calendar client renders it in the reader's own zone, and
 * shipping a timezone definition is a way to be wrong in a client nobody here
 * can test against.
 */
export function buildIcs(invite: CalendarInvite): string {
  const endsAt = new Date(invite.startsAt.getTime() + invite.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Boss Clinician//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
    `DTSTAMP:${icsStamp(invite.generatedAt ?? invite.startsAt)}`,
    `DTSTART:${icsStamp(invite.startsAt)}`,
    `DTEND:${icsStamp(endsAt)}`,
    `SUMMARY:${icsEscape(invite.title)}`,
    `DESCRIPTION:${icsEscape(invite.description)}`,
    `URL:${icsEscape(invite.url)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(invite.title)}`,
    "END:VALARM",
    "END:VEVENT",
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
