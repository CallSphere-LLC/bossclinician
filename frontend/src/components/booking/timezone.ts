/**
 * Timezone arithmetic and wording for the booking screens.
 *
 * `Intl.DateTimeFormat` is the whole implementation. It is the only thing in
 * the browser that knows the UTC offset of a named IANA zone at a given
 * instant, which is exactly the question a booking screen asks, and it gets DST
 * right — including the two weeks each spring when the US and Europe disagree
 * about what time it is. No date library, matching the backend's `drip.ts`.
 *
 * Nothing here ever parses a wall-clock string. Every function takes an instant
 * (an ISO-8601 UTC string, or a `Date`) plus the zone to read it in, so a member
 * in Honolulu and a member in Berlin looking at the same slot see two different
 * times for one moment — which is the point.
 */

export interface TimezoneOption {
  value: string;
  label: string;
}

/**
 * Same list as the profile screen offers, so a member who set "Central —
 * Chicago" there finds it here rather than a different set of names. Roughly
 * forty zones covers this audience; the full IANA database is four hundred
 * entries and turns a two-second decision into scrolling.
 */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Arizona — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "America/Puerto_Rico", label: "Atlantic — San Juan" },
  { value: "America/Toronto", label: "Canada — Toronto" },
  { value: "America/Winnipeg", label: "Canada — Winnipeg" },
  { value: "America/Vancouver", label: "Canada — Vancouver" },
  { value: "America/Mexico_City", label: "Mexico — Mexico City" },
  { value: "America/Bogota", label: "Colombia — Bogotá" },
  { value: "America/Sao_Paulo", label: "Brazil — São Paulo" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina — Buenos Aires" },
  { value: "Europe/London", label: "United Kingdom — London" },
  { value: "Europe/Dublin", label: "Ireland — Dublin" },
  { value: "Europe/Lisbon", label: "Portugal — Lisbon" },
  { value: "Europe/Madrid", label: "Spain — Madrid" },
  { value: "Europe/Paris", label: "France — Paris" },
  { value: "Europe/Berlin", label: "Germany — Berlin" },
  { value: "Europe/Rome", label: "Italy — Rome" },
  { value: "Europe/Amsterdam", label: "Netherlands — Amsterdam" },
  { value: "Europe/Stockholm", label: "Sweden — Stockholm" },
  { value: "Europe/Warsaw", label: "Poland — Warsaw" },
  { value: "Europe/Athens", label: "Greece — Athens" },
  { value: "Africa/Lagos", label: "Nigeria — Lagos" },
  { value: "Africa/Nairobi", label: "Kenya — Nairobi" },
  { value: "Africa/Johannesburg", label: "South Africa — Johannesburg" },
  { value: "Asia/Dubai", label: "UAE — Dubai" },
  { value: "Asia/Kolkata", label: "India — Kolkata" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Tokyo", label: "Japan — Tokyo" },
  { value: "Australia/Perth", label: "Australia — Perth" },
  { value: "Australia/Brisbane", label: "Australia — Brisbane" },
  { value: "Australia/Sydney", label: "Australia — Sydney" },
  { value: "Pacific/Auckland", label: "New Zealand — Auckland" },
  { value: "UTC", label: "UTC" },
];

export const FALLBACK_TIMEZONE = "America/New_York";

/** The device's own setting, which is the best guess available without asking. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

/**
 * Whether the browser will accept this zone at all.
 *
 * A stale saved preference (`Asia/Calcutta`, a zone renamed years ago, or a
 * typo written by an import) throws on every subsequent format call. Better to
 * find out once, here, than to blank out every time on the screen.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The list plus the member's own zone, in case it is not one of the forty. */
export function timezoneOptionsWith(timezone: string): TimezoneOption[] {
  if (!timezone || TIMEZONE_OPTIONS.some((zone) => zone.value === timezone)) {
    return TIMEZONE_OPTIONS;
  }
  return [...TIMEZONE_OPTIONS, { value: timezone, label: timezone.replace(/_/g, " ") }];
}

function toDate(instant: string | Date): Date {
  return instant instanceof Date ? instant : new Date(instant);
}

function partsOf(
  instant: string | Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Map<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone });
  const parts = new Map<string, string>();
  for (const part of formatter.formatToParts(toDate(instant))) {
    parts.set(part.type, part.value);
  }
  return parts;
}

/**
 * "Eastern Daylight Time" — the name a member recognises, and the one that
 * changes twice a year so it cannot be hard-coded next to the zone id.
 *
 * Falls back to the id with underscores stripped, because a handful of zones
 * (mostly `Etc/*` and the far Pacific) have no long name in every browser's
 * data and returning "GMT+13" beats returning nothing.
 */
export function zoneLongName(timezone: string, at: string | Date = new Date()): string {
  const name = partsOf(at, timezone, { timeZoneName: "long" }).get("timeZoneName");
  return name ?? timezone.replace(/_/g, " ");
}

/** "EDT", or "GMT-4" in the zones that have no abbreviation. */
export function zoneShortName(timezone: string, at: string | Date = new Date()): string {
  const name = partsOf(at, timezone, { timeZoneName: "short" }).get("timeZoneName");
  return name ?? timezone.replace(/_/g, " ");
}

/** "Times shown in Eastern Daylight Time (EDT)". */
export function zoneSentence(timezone: string, at: string | Date = new Date()): string {
  const long = zoneLongName(timezone, at);
  const short = zoneShortName(timezone, at);
  return long === short ? long : `${long} (${short})`;
}

/** "9:00 AM". */
export function formatTime(instant: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(instant));
}

/** "9:00 AM EDT" — the form used anywhere a time appears without a heading. */
export function formatTimeWithZone(instant: string | Date, timezone: string): string {
  return `${formatTime(instant, timezone)} ${zoneShortName(timezone, instant)}`;
}

/** "Tue 19" for a day chip. */
export function formatDayChip(instant: string | Date, timezone: string): { weekday: string; day: string } {
  const parts = partsOf(instant, timezone, { weekday: "short", day: "numeric" });
  return { weekday: parts.get("weekday") ?? "", day: parts.get("day") ?? "" };
}

/** "Tuesday, 19 August" — a heading, so it spells the weekday out. */
export function formatDayHeading(instant: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(toDate(instant));
}

/** "Tuesday, 19 August 2026 at 9:00 AM EDT" — the confirm-step restatement. */
export function formatFullDateTime(instant: string | Date, timezone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(toDate(instant));
  return `${date} at ${formatTimeWithZone(instant, timezone)}`;
}

/** "Aug 19, 9:00 AM EDT" — compact, for list rows. */
export function formatListDateTime(instant: string | Date, timezone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  }).format(toDate(instant));
  return `${date}, ${formatTimeWithZone(instant, timezone)}`;
}

/**
 * The calendar date this instant falls on *in `timezone`* — "2026-08-19".
 *
 * The grouping key for the slot picker, and the reason a 9pm Pacific slot shows
 * up under Tuesday for a Californian and under Wednesday for a Berliner. Built
 * from parts rather than a locale string because no locale is guaranteed to
 * order or pad the pieces the way this needs.
 */
export function dayKeyInZone(instant: string | Date, timezone: string): string {
  const parts = partsOf(instant, timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

/** Whole calendar days from one `YYYY-MM-DD` key to another. */
function calendarDaysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * "Today" / "Tomorrow" / "Thursday" / "In 12 days".
 *
 * Counted in calendar days *in `timezone`*, not in elapsed hours: a call at 1am
 * tomorrow is "Tomorrow" even though it is four hours away, which is how people
 * actually talk about their diary. Intl's RelativeTimeFormat cannot do this
 * because it only knows durations, not which side of midnight they land on.
 */
export function formatRelativeDay(
  instant: string | Date,
  timezone: string,
  now: Date = new Date(),
): string {
  const days = calendarDaysBetween(dayKeyInZone(now, timezone), dayKeyInZone(instant, timezone));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(
      toDate(instant),
    );
  }
  return days > 0 ? `In ${days} days` : `${Math.abs(days)} days ago`;
}

/** Midnight-to-midnight is irrelevant here; days are added in whole 24h steps. */
export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

/** "60 minutes" / "1 hour" / "1 hour 30 minutes". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minutes`;
}

/** The instant a session of `minutes` starting at `startsAt` ends. */
export function endInstant(startsAt: string, minutes: number): Date {
  return new Date(new Date(startsAt).getTime() + minutes * 60_000);
}

/**
 * Whether two zone ids name the same clock right now.
 *
 * String comparison is not enough: `America/New_York` and `US/Eastern` are the
 * same wall clock, and telling a member their device disagrees with their
 * profile when it does not is exactly the false alarm that trains people to
 * ignore the real one.
 */
export function sameClock(a: string, b: string, at: string | Date = new Date()): boolean {
  if (a === b) return true;
  try {
    return formatFullDateTime(at, a) === formatFullDateTime(at, b);
  } catch {
    return false;
  }
}
