/** How far an IANA timezone is from UTC at one instant, in milliseconds. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
    const read = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second"),
    );
    return asUtc - instant.getTime();
  } catch {
    return 0;
  }
}

/** A datetime-local wall clock → the UTC instant it names in `timeZone`. */
export function wallClockToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const naive = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const instant = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  const iso = new Date(instant).toISOString();
  // Spring-forward creates wall-clock labels that never occur. Silently
  // coercing 02:30 to 01:30/03:30 schedules a message or appointment an hour
  // away from what the admin chose, so reject it and let the form ask again.
  return isoToWallClock(iso, timeZone) === local ? iso : null;
}

/** A UTC instant → the wall clock a datetime-local input shows in `timeZone`. */
export function isoToWallClock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return new Date(instant.getTime() + zoneOffsetMs(instant, timeZone)).toISOString().slice(0, 16);
}
