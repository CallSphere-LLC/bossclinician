import { isoToWallClock, wallClockToIso } from "@/lib/zonedDateTime";

/**
 * The arithmetic behind "post at a time" in the member-side channel composer.
 *
 * A host picks a wall-clock time in a `datetime-local` box. That box has no
 * timezone of its own, and the browser's is the wrong one to assume: a host
 * whose account says Los Angeles but who is travelling in New York means 9am in
 * the timezone they set on their account, which is also the one every other
 * date on their member pages is shown in. So the conversion is done against the
 * member's own `timezone`, falling back to the browser's only when the account
 * has none.
 *
 * Kept free of React so it can be tested as plain functions.
 */

/** The member's timezone, or the browser's, or UTC — never an invalid name. */
export function scheduleTimeZone(memberTimeZone: string | null | undefined): string {
  const candidates = [
    memberTimeZone ?? "",
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      } catch {
        return "";
      }
    })(),
  ];
  for (const zone of candidates) {
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return zone;
    } catch {
      // Not a zone this runtime knows; try the next one.
    }
  }
  return "UTC";
}

/**
 * The box's starting value: an hour from now, rounded up to the next five
 * minutes, in the member's timezone. "In a bit" is what "post at a time" almost
 * always means, and an empty box is a worse start than a sensible one.
 */
export function defaultScheduleWallClock(timeZone: string, now: Date = new Date()): string {
  const step = 5 * 60_000;
  const inAnHour = Math.ceil((now.getTime() + 60 * 60_000) / step) * step;
  return isoToWallClock(new Date(inAnHour).toISOString(), timeZone);
}

export type ScheduleReading = { ok: true; iso: string } | { ok: false; error: string };

/**
 * What the host typed → the instant to send, or the reason it cannot be sent.
 *
 * Every refusal is a sentence the composer shows next to the box. The endpoint
 * refuses a past time too, but saying so before the round trip is the difference
 * between a field that explains itself and a Save that bounces.
 */
export function readScheduleWallClock(
  local: string,
  timeZone: string,
  now: Date = new Date(),
): ScheduleReading {
  if (!local.trim()) return { ok: false, error: "Pick a date and time, or post it now." };
  const iso = wallClockToIso(local, timeZone);
  if (iso === null) {
    return {
      ok: false,
      error: "That time doesn't exist in your timezone (the clocks change then). Pick another.",
    };
  }
  if (new Date(iso).getTime() <= now.getTime()) {
    return { ok: false, error: "Choose a time in the future, or post it now." };
  }
  return { ok: true, iso };
}

/** "Sep 12, 2026, 9:00 AM PDT" — in the member's timezone, with its name on it. */
export function formatScheduled(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(iso)) + ` (${timeZoneLabel(timeZone, new Date(iso))})`;
  } catch {
    return new Date(iso).toISOString();
  }
}

/** A short name for the zone at that instant — "PDT", or "GMT+5:30" where there is none. */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
