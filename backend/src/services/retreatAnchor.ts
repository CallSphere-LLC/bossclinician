import { zonedWallClockToUtc } from "./drip";

/**
 * Event-anchored sequence timing (sheet row 249, Yvette's item 12, migration 220).
 *
 * The post-retreat alumni emails go out on Day +3, +7, +14 and +21 counted from
 * each retreat's END DATE, at the owner's send minute in the retreat's own time
 * zone — never from when somebody was enrolled and never from the previous
 * email. Bali ends Sunday 20 June 2027, so 9 a.m. Pacific on 23 June, 27 June,
 * 4 July and 11 July 2027.
 *
 * Pure and import-light on purpose (only the drip engine's DST-safe wall-clock
 * converter): the date is the part that silently goes wrong twice a year.
 *
 * The end date is handled as the text 'YYYY-MM-DD' and the offset is added on
 * the calendar, never in milliseconds. node-postgres turns a DATE column into a
 * Date at LOCAL midnight of the server, which in any zone west of UTC is the day
 * before — so callers select `end_date::text`.
 */

export const RETREAT_END_ANCHOR = "retreat_end";

/** The anchor kinds the engine understands. NULL on a sequence means "classic delays". */
export const SEQUENCE_ANCHOR_KINDS = [RETREAT_END_ANCHOR] as const;
export type SequenceAnchorKind = (typeof SEQUENCE_ANCHOR_KINDS)[number];

export function isAnchorKind(value: unknown): value is SequenceAnchorKind {
  return typeof value === "string" && (SEQUENCE_ANCHOR_KINDS as readonly string[]).includes(value);
}

/** The default send minute when a sequence has none: 9:00 a.m. */
export const DEFAULT_ANCHOR_SEND_MINUTE = 9 * 60;

/**
 * How late an anchored email may still go out. An email whose date passed
 * longer ago than this (the sequence was switched on late, the retreat date was
 * moved back, the Email 4 link was never filled in) is skipped rather than sent
 * as a "three days after" email three weeks after.
 */
export const ANCHOR_LATE_LIMIT_MINUTES = 72 * 60;

/** How long an email held for a missing link waits before it looks again. */
export const ANCHOR_HOLD_RECHECK_MINUTES = 6 * 60;

export interface RetreatAnchor {
  id: number;
  slug: string;
  title: string;
  /** 'YYYY-MM-DD', the last day of the retreat. */
  endDate: string;
  /** IANA zone; the retreat's own, default America/Los_Angeles. */
  timezone: string;
  /** false: the dashboard the emails link to is not live yet (emails hold). */
  published?: boolean | null;
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})/;

/** Reads 'YYYY-MM-DD' (or the date part of an ISO string). null when unreadable. */
export function parseDateText(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_TEXT.exec(String(value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return "America/Los_Angeles";
  }
}

/**
 * When an email anchored `offsetDays` after `endDate` goes out: that calendar
 * day, at `sendAtMinute` local time in `timeZone`. DST-safe — 9 a.m. stays
 * 9 a.m. on either side of a clock change.
 */
export function anchoredSendAt(
  endDate: string,
  offsetDays: number,
  sendAtMinute: number | null | undefined,
  timeZone: string
): Date {
  const parts = parseDateText(endDate);
  if (!parts) throw new Error(`Unreadable retreat end date: ${String(endDate)}`);
  const minute =
    typeof sendAtMinute === "number" && Number.isInteger(sendAtMinute) && sendAtMinute >= 0 && sendAtMinute < 1440
      ? sendAtMinute
      : DEFAULT_ANCHOR_SEND_MINUTE;
  const offset = Number.isInteger(offsetDays) ? offsetDays : 0;
  // Day overflow ("20 June + 21") is normalised by Date.UTC inside the converter.
  return zonedWallClockToUtc(parts.year, parts.month, parts.day + offset, minute, validZone(timeZone));
}

export interface AnchoredEmailRef {
  position: number;
  anchorOffsetDays: number | null;
}

/**
 * The first email (at or after `fromPosition`) that is not already too late to
 * send, with its send time. null when every remaining email's date is more than
 * `ANCHOR_LATE_LIMIT_MINUTES` in the past.
 */
export function firstSendableAnchoredEmail<T extends AnchoredEmailRef>(
  emails: readonly T[],
  anchor: { endDate: string; timezone: string },
  sendAtMinute: number | null | undefined,
  now: Date,
  fromPosition = 0
): { email: T; sendAt: Date } | null {
  const ordered = [...emails]
    .filter((e) => e.position >= fromPosition)
    .sort((a, b) => a.position - b.position);
  for (const email of ordered) {
    const sendAt = anchoredSendAt(anchor.endDate, email.anchorOffsetDays ?? 0, sendAtMinute, anchor.timezone);
    if (now.getTime() - sendAt.getTime() <= ANCHOR_LATE_LIMIT_MINUTES * 60_000) {
      return { email, sendAt };
    }
  }
  return null;
}

/** Whether a due anchored email has slipped past the point where it may still go. */
export function isTooLate(sendAt: Date, now: Date): boolean {
  return now.getTime() - sendAt.getTime() > ANCHOR_LATE_LIMIT_MINUTES * 60_000;
}

/* --------------------------------------------------------------- merge tags */

/**
 * The per-retreat merge tokens the alumni emails use. A guest's own dashboard is
 * the same path for every guest; the member area resolves who is signed in.
 */
export const RETREAT_MERGE_KEYS = [
  "retreatTitle",
  "retreatDashboardUrl",
  "retreatMemoriesUrl",
  "retreatFeedbackUrl",
  "retreatInterestUrl",
  "retreatNextUrl",
] as const;
export type RetreatMergeKey = (typeof RETREAT_MERGE_KEYS)[number];

export function retreatMergeValues(input: {
  siteUrl: string;
  slug: string;
  title: string;
  /** Owner-set "explore what's next / join first access" URL. Blank holds Email 4. */
  nextUrl: string;
}): Record<RetreatMergeKey, string> {
  const site = input.siteUrl.replace(/\/+$/, "");
  const dashboard = `${site}/retreats/dashboard/${encodeURIComponent(input.slug)}`;
  const next = input.nextUrl.trim();
  return {
    retreatTitle: input.title,
    retreatDashboardUrl: dashboard,
    retreatMemoriesUrl: `${dashboard}/memories`,
    retreatFeedbackUrl: `${dashboard}/feedback`,
    retreatInterestUrl: `${dashboard}/interest`,
    // Only an absolute https link is a link: anything else would print the
    // button's markdown literally, so it counts as "not set".
    retreatNextUrl: /^https:\/\/\S+$/i.test(next) ? next : "",
  };
}

/** The retreat tokens an email's subject, preview or body uses but cannot fill. */
export function missingRetreatTokens(texts: readonly string[], values: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const text of texts) {
    for (const match of String(text ?? "").matchAll(/\{\{\s*(retreat\w+)\s*\}\}/g)) {
      const key = match[1];
      if (!(values[key] ?? "").trim()) missing.add(key);
    }
  }
  return [...missing];
}

/* --------------------------------------------------------------- skip rules */

/**
 * The retreat half of `sequence_emails.skip_rules`, kept under its own key so
 * the classic `{ownsOfferIds, submittedFormIds, hasTagIds}` shape is untouched:
 *
 *   { "retreat": { "feedbackSubmitted": true, "interestSet": true,
 *                  "marketingOptedOut": true, "bookedFeatured": true } }
 *
 * Only read for runs anchored to a retreat.
 */
export interface RetreatSkipRules {
  feedbackSubmitted: boolean;
  interestSet: boolean;
  marketingOptedOut: boolean;
  bookedFeatured: boolean;
}

export function parseRetreatSkipRules(raw: unknown): RetreatSkipRules {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const retreat =
    source.retreat && typeof source.retreat === "object" && !Array.isArray(source.retreat)
      ? (source.retreat as Record<string, unknown>)
      : {};
  return {
    feedbackSubmitted: retreat.feedbackSubmitted === true,
    interestSet: retreat.interestSet === true,
    marketingOptedOut: retreat.marketingOptedOut === true,
    bookedFeatured: retreat.bookedFeatured === true,
  };
}

export function hasRetreatSkipRules(rules: RetreatSkipRules): boolean {
  return rules.feedbackSubmitted || rules.interestSet || rules.marketingOptedOut || rules.bookedFeatured;
}

/**
 * The `retreat_interest.interest` answers that mean "no future invitations".
 * The dashboard offers International / Domestic / Both / Not at this time
 * (owner brief). Compared lower-case with anything but letters removed, so
 * 'not_now', 'Not now' and 'Not at this time' all match.
 */
export const NOT_NOW_INTEREST_VALUES = ["notnow", "notatthistime", "none", "no"] as const;

export function isNotNowInterest(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  return (NOT_NOW_INTEREST_VALUES as readonly string[]).includes(key);
}

export interface RetreatGuestFacts {
  feedbackSubmitted: boolean;
  /** A preference was recorded for this retreat (any answer). */
  interestSet: boolean;
  /** marketing_opt_in = false, or the answer was "not at this time". */
  marketingOptedOut: boolean;
  /** Already holds access to the retreat Email 4 features. */
  bookedFeatured: boolean;
}

/** Why the guest should not get this email, or '' when they should. Pure. */
export function retreatSkipReason(rules: RetreatSkipRules, facts: RetreatGuestFacts): string {
  if (rules.feedbackSubmitted && facts.feedbackSubmitted) return "already shared retreat feedback";
  if (rules.marketingOptedOut && facts.marketingOptedOut) return "declined future retreat invitations";
  if (rules.interestSet && facts.interestSet) return "already shared retreat interest";
  if (rules.bookedFeatured && facts.bookedFeatured) return "already booked the featured retreat";
  return "";
}
