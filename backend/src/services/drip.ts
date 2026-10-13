/**
 * Drip scheduling.
 *
 * A lesson unlocks either N days after the member got access, or on a fixed
 * date. Both land at a site-wide release time of day — one hour set by the
 * owner, not one per lesson, which is exactly how Kajabi models it.
 *
 * Everything here is pure: times go in, times come out. No database, no
 * `new Date()` without an argument. That is what makes "does lesson 4 unlock on
 * the 3rd or the 4th for a member in Honolulu" a test rather than an argument.
 *
 * No date library is used because none is installed and this needs one thing a
 * library would provide — the UTC offset of a named IANA zone at a given
 * instant — which `Intl.DateTimeFormat` already answers correctly, including
 * across DST transitions.
 */

export interface DripConfig {
  /** Unlock this many days after access was granted. null = not day-based. */
  dripDays: number | null;
  /** Unlock at this fixed instant. null = not date-based. */
  dripDate: Date | null;
}

export interface DripSettings {
  /** Minutes past midnight in `timezone`. 9am = 540. */
  releaseMinute: number;
  /** IANA zone the release time is expressed in, e.g. "America/New_York". */
  timezone: string;
}

export const DEFAULT_DRIP_SETTINGS: DripSettings = {
  releaseMinute: 6 * 60,
  timezone: "America/New_York",
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading in `timeZone` at instant `date`. */
function partsInZone(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const out: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }

  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** The zone's offset from UTC, in milliseconds, at instant `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Milliseconds are not in the formatted parts, so they are added back to keep
  // the offset a whole-second quantity rather than drifting by up to 999ms.
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Converts a wall-clock time in a named zone to the UTC instant it refers to.
 *
 * Two passes, because the offset depends on the instant and the instant depends
 * on the offset. The first guess uses the offset at the naive-UTC reading; the
 * second corrects it. That resolves every case except the one hour that does
 * not exist on a spring-forward date, where the result lands on the following
 * hour — the same thing a calendar app does, and the only sane answer when the
 * requested time genuinely never occurs.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  minutesPastMidnight: number,
  timeZone: string
): Date {
  const hour = Math.floor(minutesPastMidnight / 60);
  const minute = minutesPastMidnight % 60;

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(firstGuess, timeZone));
}

/** Midnight-anchored day arithmetic in a zone, immune to DST hour changes. */
function addDaysInZone(from: Date, days: number, timeZone: string): ZonedParts {
  const p = partsInZone(from, timeZone);
  // Date arithmetic is done on the calendar, not on milliseconds: adding
  // 7 * 86_400_000 across a spring-forward boundary lands an hour early and
  // would release a lesson on the wrong local day.
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/**
 * The instant a lesson becomes available, or null when it is open immediately.
 *
 * `dripDate` wins over `dripDays` when both are somehow set: a fixed date is an
 * explicit editorial decision ("this module opens on launch day"), whereas the
 * day count is the default cadence.
 */
export function unlockAt(
  config: DripConfig,
  grantedAt: Date,
  settings: DripSettings = DEFAULT_DRIP_SETTINGS
): Date | null {
  if (config.dripDate) {
    const p = partsInZone(config.dripDate, settings.timezone);
    return zonedWallClockToUtc(p.year, p.month, p.day, settings.releaseMinute, settings.timezone);
  }

  if (config.dripDays === null || config.dripDays === undefined) return null;
  if (config.dripDays <= 0) return null;

  const target = addDaysInZone(grantedAt, config.dripDays, settings.timezone);
  return zonedWallClockToUtc(
    target.year,
    target.month,
    target.day,
    settings.releaseMinute,
    settings.timezone
  );
}

export interface DripState {
  unlocked: boolean;
  /** null when the item is open now, or when it has already unlocked. */
  unlocksAt: Date | null;
}

/**
 * Whether a lesson is open, accounting for its module's schedule too.
 *
 * A lesson inside a module that has not dripped yet is locked no matter what
 * the lesson itself says — otherwise "open module 2 on day 14" would leak any
 * lesson inside it that forgot to set its own delay.
 */
export function resolveDripState(input: {
  lesson: DripConfig;
  module?: DripConfig | null;
  grantedAt: Date;
  now: Date;
  settings?: DripSettings;
}): DripState {
  const settings = input.settings ?? DEFAULT_DRIP_SETTINGS;

  const candidates: Date[] = [];
  const lessonUnlock = unlockAt(input.lesson, input.grantedAt, settings);
  if (lessonUnlock) candidates.push(lessonUnlock);

  if (input.module) {
    const moduleUnlock = unlockAt(input.module, input.grantedAt, settings);
    if (moduleUnlock) candidates.push(moduleUnlock);
  }

  if (candidates.length === 0) return { unlocked: true, unlocksAt: null };

  // The later of the two gates is the one that actually holds the door shut.
  const effective = candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));

  if (input.now.getTime() >= effective.getTime()) {
    return { unlocked: true, unlocksAt: null };
  }
  return { unlocked: false, unlocksAt: effective };
}

/** Why a lesson's release clock is holding it back. */
export type ReleaseReason = "drip" | "scheduled";

export interface ReleaseState extends DripState {
  /** null when the lesson is open. */
  reason: ReleaseReason | null;
}

/**
 * Drip plus Kajabi's "Scheduled" status: the whole release clock of one lesson.
 *
 * `publishAt` is an exact instant the owner picked, date and time, so it is not
 * snapped to the site-wide release hour the way a drip date is. A scheduled
 * lesson is not released yet for anybody — including a free taster, which is
 * exempt from drip only because it already plays on the sales page, and a
 * lesson nobody has released does not.
 *
 * When both hold the door, the later one is the reason given, because it is the
 * one that actually decides when the lesson opens.
 */
export function resolveRelease(input: {
  lesson: DripConfig;
  module?: DripConfig | null;
  publishAt?: Date | null;
  preview?: boolean;
  grantedAt: Date;
  now: Date;
  settings?: DripSettings;
}): ReleaseState {
  const drip = resolveDripState(input);
  const dripHeld = !drip.unlocked && input.preview !== true;
  const publishAt = input.publishAt ?? null;
  const scheduled = publishAt !== null && input.now.getTime() < publishAt.getTime();

  if (scheduled && (!dripHeld || (drip.unlocksAt?.getTime() ?? 0) <= publishAt.getTime())) {
    return { unlocked: false, unlocksAt: publishAt, reason: "scheduled" };
  }
  if (dripHeld) return { unlocked: false, unlocksAt: drip.unlocksAt, reason: "drip" };
  return { unlocked: true, unlocksAt: null, reason: null };
}

/** "Tuesday, October 20, 9:00 AM EDT" — a scheduled lesson's exact opening. */
export function describeScheduled(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** "Unlocks Tuesday, 3 March" — for the locked badge in the player sidebar. */
export function describeUnlock(unlocksAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(unlocksAt);
}

/** Parses the "HH:MM" the settings screen stores into minutes past midnight. */
export function parseReleaseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return DEFAULT_DRIP_SETTINGS.releaseMinute;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return DEFAULT_DRIP_SETTINGS.releaseMinute;
  return hours * 60 + minutes;
}
