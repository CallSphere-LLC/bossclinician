import type { ErrorRequestHandler, Response } from "express";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";
import { siteTimeZone } from "./siteTime";

/**
 * An offer's sale deadline (migration 231, QA sheet row 250).
 *
 * The owner sets "Sale ends" on an offer and, optionally, where a visitor goes
 * once it has passed: the original-price offer, or a page on this site. Every
 * surface that shows the countdown, and every place that can start an order,
 * reads the answer from here so they cannot disagree about whether the sale is
 * still on.
 *
 * The rule: an order started before the deadline may still finish paying.
 * Webhooks, PayPal captures and the order status page never ask this module
 * anything. Only NEW orders are refused.
 *
 * This file must not import routes/public/offers (that file imports this one).
 * `OfferRow.sales_end_at` over there is the selected pricing option's window,
 * a different thing; the offer's own deadline is only ever loaded here.
 */

export interface OfferDeadline {
  offerId: number;
  slug: string;
  title: string;
  /** ISO, null = no deadline. */
  endsAt: string | null;
  /** "Friday, December 4 at 11:59 PM PST" in the site time zone, '' when none. */
  endsLabel: string;
  /** The deadline has passed. */
  closed: boolean;
  showCountdown: boolean;
  /** Site-relative path of this offer's checkout. */
  checkoutUrl: string;
  /**
   * Site-relative path to send visitors to once closed: the fallback offer's
   * checkout if it is published and open, else the offer's own path, else ''.
   */
  afterCloseUrl: string;
  /** ISO. */
  serverNow: string;
}

/** What the checkout page and the course sales page need to draw the timer. */
export interface PublicDeadline {
  endsAt: string;
  endsLabel: string;
  serverNow: string;
  showCountdown: boolean;
}

export const OFFER_CLOSED_CODE = "offer_closed";
export const OFFER_CLOSED_MESSAGE = "This offer has ended.";

/**
 * 410 Gone: the sale is over. `redirectTo` is where the page should send the
 * visitor ('' when the owner set no destination).
 *
 * The shared error handler answers `{ error, details }`, so `code` and
 * `redirectTo` are carried in `details` as well; `offerClosedHandler` below
 * puts them at the top level for the routers that mount it.
 */
export class OfferClosedError extends HttpError {
  code = OFFER_CLOSED_CODE;
  redirectTo: string;

  constructor(redirectTo: string, message = OFFER_CLOSED_MESSAGE) {
    super(410, message, { code: OFFER_CLOSED_CODE, redirectTo });
    this.redirectTo = redirectTo;
  }
}

/** The JSON a closed offer answers with. */
export function offerClosedBody(err: OfferClosedError): Record<string, unknown> {
  return {
    error: err.message,
    code: err.code,
    redirectTo: err.redirectTo,
    details: { code: err.code, redirectTo: err.redirectTo },
  };
}

/** Answers 410 for a closed offer. Never cached: the page must re-ask. */
export function sendOfferClosed(res: Response, err: OfferClosedError): void {
  res.set("Cache-Control", "no-store");
  res.status(410).json(offerClosedBody(err));
}

/**
 * Router-level error middleware: a closed offer becomes
 * `{ error, code: "offer_closed", redirectTo }`; anything else passes through
 * to the shared handler untouched.
 */
export const offerClosedHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof OfferClosedError && !res.headersSent) {
    sendOfferClosed(res, err);
    return;
  }
  next(err);
};

/* -------------------------------------------------------------------- pure */

type Instant = Date | string | null | undefined;

function toDate(value: Instant): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "Friday, December 4 at 11:59 PM PST".
 *
 * Built from the formatter's parts rather than its finished string: different
 * ICU versions join the date and the time with "at" or with a comma, and put a
 * narrow no-break space before AM/PM, and this label is printed in emails and
 * in an image's alt text where it has to read the same everywhere. The zone
 * label is included for the reason events.ts `describeSession` gives: a time
 * with no zone on it is how people arrive three hours late.
 */
export function formatEndsLabel(endsAt: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(endsAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    (parts.find((entry) => entry.type === type)?.value ?? "").replace(/[  \s]+/g, " ").trim();
  return `${part("weekday")}, ${part("month")} ${part("day")} at ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} ${part("timeZoneName")}`
    .replace(/\s+/g, " ")
    .trim();
}

/** Closed from the deadline's own instant onward, as the option windows are (`sales_end_at > now()` is open). */
export function deadlinePassed(endsAt: Instant, now: Date): boolean {
  const end = toDate(endsAt);
  return end !== null && now.getTime() >= end.getTime();
}

/**
 * A path on this site, or ''.
 *
 * The countdown link in an email redirects to this, so it must not be able to
 * leave the site: it starts with one "/", and "//host", "/\host" (which
 * browsers read as "//host"), a backslash anywhere, control characters and
 * whitespace are all refused. Checked when the owner saves it and again every
 * time it is read.
 */
export function safeSitePath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const path = raw.trim();
  if (path === "" || path.length > 500) return "";
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000- \u007f]/.test(path)) return "";
  return path;
}

export function offerCheckoutPath(slug: string): string {
  return `/checkout/${encodeURIComponent(slug)}`;
}

/** One offer's deadline columns, joined to the fallback offer it names. */
export interface OfferDeadlineRow {
  id: number;
  slug: string;
  title: string;
  status?: string | null;
  sales_end_at?: Instant;
  show_countdown?: boolean | null;
  after_close_path?: string | null;
  fallback_id?: number | null;
  fallback_slug?: string | null;
  fallback_status?: string | null;
  fallback_sales_end_at?: Instant;
}

/**
 * Where a visitor goes once this offer has closed.
 *
 * The fallback offer's checkout, but only while that offer can actually be
 * bought: published, not past its own deadline, and not this same offer (the
 * database refuses that too). Otherwise the owner's own path, otherwise ''.
 * Sending somebody from one ended sale to another ended sale, or to a draft
 * that answers "not found", is worse than a plain "this offer has ended".
 */
export function resolveAfterCloseUrl(row: OfferDeadlineRow, now: Date): string {
  const fallbackUsable =
    row.fallback_id !== null &&
    row.fallback_id !== undefined &&
    row.fallback_id !== row.id &&
    typeof row.fallback_slug === "string" &&
    row.fallback_slug !== "" &&
    row.fallback_status === "published" &&
    !deadlinePassed(row.fallback_sales_end_at, now);
  if (fallbackUsable) return offerCheckoutPath(row.fallback_slug as string);
  const path = safeSitePath(row.after_close_path);
  // The offer's own checkout is not somewhere to send people it has just turned away.
  return path === offerCheckoutPath(row.slug) || path === `/checkout/${row.slug}` ? "" : path;
}

export function buildOfferDeadline(row: OfferDeadlineRow, timeZone: string, now: Date): OfferDeadline {
  const end = toDate(row.sales_end_at);
  return {
    offerId: row.id,
    slug: row.slug,
    title: row.title,
    endsAt: end ? end.toISOString() : null,
    endsLabel: end ? formatEndsLabel(end, timeZone) : "",
    closed: deadlinePassed(end, now),
    showCountdown: row.show_countdown !== false,
    checkoutUrl: offerCheckoutPath(row.slug),
    afterCloseUrl: resolveAfterCloseUrl(row, now),
    serverNow: now.toISOString(),
  };
}

/**
 * The timer a page shows: the OFFER's own sale deadline, or null when the
 * owner set none.
 *
 * A pricing option's own `sales_end_at` (migration 139) never moves the timer.
 * It still closes that option on its date (the Bali payment-plan option closes
 * quietly), but the checkout shows one clock for the whole offer, so choosing a
 * different way to pay cannot change what it counts down to. The option's date
 * is still accepted here so callers do not change; it is not used.
 */
export function publicDeadline(
  deadline: Pick<OfferDeadline, "endsAt" | "showCountdown" | "serverNow"> | null,
  _optionSalesEndAt: Instant,
  timeZone: string,
  now: Date = new Date(),
): PublicDeadline | null {
  const end = toDate(deadline?.endsAt ?? null);
  if (!end) return null;
  return {
    endsAt: end.toISOString(),
    endsLabel: formatEndsLabel(end, timeZone),
    serverNow: deadline?.serverNow ?? now.toISOString(),
    showCountdown: deadline ? deadline.showCountdown : true,
  };
}

/* ---------------------------------------------------------------- database */

const DEADLINE_SELECT = `SELECT o.id, o.slug::text AS slug, o.title, o.status, o.sales_end_at, o.show_countdown,
       o.after_close_path, f.id AS fallback_id, f.slug::text AS fallback_slug,
       f.status AS fallback_status, f.sales_end_at AS fallback_sales_end_at
  FROM offers o
  LEFT JOIN offers f ON f.id = o.after_close_offer_id`;

/**
 * The deadline of one offer, by slug or id. Null when the offer does not exist
 * or is not published: a draft is not for sale, so it has no sale to end.
 * `anyStatus` is for the admin's own screens only.
 */
export async function offerDeadline(
  slugOrId: string | number,
  options: { anyStatus?: boolean } = {},
): Promise<OfferDeadline | null> {
  const byId = typeof slugOrId === "number";
  if (typeof slugOrId === "number" && (!Number.isSafeInteger(slugOrId) || slugOrId < 1)) return null;
  if (typeof slugOrId === "string" && slugOrId.trim() === "") return null;
  const result = await pool.query<OfferDeadlineRow>(
    `${DEADLINE_SELECT} WHERE ${byId ? "o.id = $1" : "o.slug = $1"}`,
    [slugOrId],
  );
  const row = result.rows[0];
  if (!row || row.id === undefined || row.id === null) return null;
  if (!options.anyStatus && row.status !== "published") return null;
  return buildOfferDeadline(row, await siteTimeZone(), new Date());
}

/** The same answer for several offers in one query, keyed by offer id. */
export async function offerDeadlinesByIds(
  offerIds: number[],
  options: { anyStatus?: boolean } = {},
): Promise<Map<number, OfferDeadline>> {
  const out = new Map<number, OfferDeadline>();
  if (offerIds.length === 0) return out;
  const result = await pool.query<OfferDeadlineRow>(`${DEADLINE_SELECT} WHERE o.id = ANY($1::int[])`, [offerIds]);
  const timeZone = await siteTimeZone();
  const now = new Date();
  for (const row of result.rows) {
    if (row.id === undefined || row.id === null) continue;
    if (!options.anyStatus && row.status !== "published") continue;
    out.set(row.id, buildOfferDeadline(row, timeZone, now));
  }
  return out;
}

/**
 * Refuses a NEW order on an offer whose deadline has passed: throws 410
 * `{ error: "This offer has ended.", code: "offer_closed", redirectTo }`.
 *
 * Quiet for an offer that does not exist or is not published; every caller
 * already answers that case itself. Call it only where an order is about to be
 * created or quoted, never where an existing order is being paid.
 */
export async function assertOfferOpen(offerId: number, message?: string): Promise<void> {
  const deadline = await offerDeadline(offerId);
  if (deadline?.closed) throw new OfferClosedError(deadline.afterCloseUrl, message);
}
