import { Router, type Request, type Response } from "express";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { offerDeadline, type OfferDeadline } from "../../services/offerDeadline";
import { ENDED_TEXT, OPEN_TEXT, renderCountdownGif, renderMessageGif } from "../../services/countdownGif";

/**
 * The sale countdown for emails and pages (sheet row 250, COUNTDOWN.md). The
 * key is the offer's own web address (its slug).
 *
 *   GET /api/countdown/:slug/status  what the on-page timer reads (JSON)
 *   GET /api/countdown/:slug/go      where the email timer links to (302)
 *   GET /api/countdown/:slug.gif     the email timer itself (animated GIF)
 *   GET /api/countdown/:slug         the same picture, for mail tools that drop the extension
 *
 * The picture is fetched by mail clients and image proxies, not by people, so
 * it has one rule above all others: it always answers 200 with a real GIF. An
 * unknown offer, a mistyped address or a database that is not answering all
 * get the still "This offer has ended" frame. A broken-image icon in the
 * middle of a sent broadcast cannot be taken back.
 *
 * No cookies are read or set anywhere here, and the picture is exempt from the
 * site-wide rate limiter (middleware/rateLimit.ts) so a broadcast's opens can
 * never throttle the checkout they are advertising.
 */
export const countdownRouter = Router();

/** The same shape the offer editor enforces (validation/commerceSchemas.ts, slugSchema). */
const OFFER_SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;

/** The slug if it could belong to an offer, otherwise null. Nothing else reaches the database. */
export function cleanSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_SLUG_LENGTH) return null;
  return OFFER_SLUG.test(raw) ? raw : null;
}

/* ------------------------------------------------------------------------ *
 * The picture
 * ------------------------------------------------------------------------ */

let endedStill: Buffer | null = null;
let openStill: Buffer | null = null;
const endedGif = (): Buffer => (endedStill ??= renderMessageGif(ENDED_TEXT));
const openGif = (): Buffer => (openStill ??= renderMessageGif(OPEN_TEXT));

/**
 * One drawing per offer per second, shared by everybody who opens the email in
 * that second. The promise is what is kept, not the finished bytes, so a burst
 * arriving together waits on one lookup and one drawing instead of starting
 * their own.
 *
 * Bounded: an entry is only useful for the second it was made in, so when the
 * map is full the stale ones go first, and after that the oldest.
 */
interface MemoEntry {
  second: number;
  gif: Promise<Buffer>;
}
export const COUNTDOWN_MEMO_MAX = 500;
const memo = new Map<string, MemoEntry>();

function makeRoom(second: number): void {
  for (const [key, entry] of memo) {
    if (entry.second !== second) memo.delete(key);
  }
  while (memo.size >= COUNTDOWN_MEMO_MAX) {
    const oldest = memo.keys().next();
    if (oldest.done) break;
    memo.delete(oldest.value);
  }
}

/** Never rejects: whatever goes wrong, the answer is the "ended" still. */
async function drawFor(slug: string, nowMs: number): Promise<Buffer> {
  try {
    const deadline = await offerDeadline(slug);
    if (!deadline || deadline.closed) return endedGif();
    // On sale with no deadline: there is nothing to count, and "ended" would be untrue.
    if (!deadline.endsAt) return openGif();
    const endsMs = Date.parse(deadline.endsAt);
    if (!Number.isFinite(endsMs)) return endedGif();
    // Rounded up, so the picture reaches "ended" at the deadline and not a second early.
    return renderCountdownGif(Math.ceil((endsMs - nowMs) / 1000));
  } catch (err) {
    console.error("[countdown] could not draw the timer:", (err as Error)?.message ?? err);
    return endedGif();
  }
}

/** The GIF for an offer at this moment. `slug` must already have been through cleanSlug. */
export function countdownGifFor(slug: string, nowMs: number = Date.now()): Promise<Buffer> {
  const second = Math.floor(nowMs / 1000);
  const hit = memo.get(slug);
  if (hit && hit.second === second) return hit.gif;

  const gif = drawFor(slug, nowMs);
  memo.delete(slug);
  if (memo.size >= COUNTDOWN_MEMO_MAX) makeRoom(second);
  memo.set(slug, { second, gif });
  return gif;
}

/** For the tests. */
export function resetCountdownMemo(): void {
  memo.clear();
}
export function countdownMemoSize(): number {
  return memo.size;
}

function sendGif(res: Response, gif: Buffer): void {
  res.status(200);
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", String(gif.length));
  // A cached timer is a wrong timer. The extra two headers are for old proxies.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // res.end, not res.send: no ETag, so no client can be told "not modified".
  res.end(gif);
}

/* ------------------------------------------------------------------------ *
 * Redirect targets
 * ------------------------------------------------------------------------ */

/**
 * A path on this site, or null. The destinations come from the offer editor,
 * which already refuses outside addresses; this is the second lock, so that a
 * value written some other way can never turn our email link into an open
 * redirect. Our own /go address is refused too, so it cannot point at itself.
 */
export function sameSitePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.startsWith("/api/countdown/")) return null;
  return value;
}

/** Where a visitor goes when the sale is over and the offer names nowhere to send them. */
const ENDED_FALLBACK_PATH = "/store";
/** Where a visitor goes when the link names no offer we know. */
const HOME_PATH = "/";

const absolute = (path: string): string => `${env.publicSiteUrl.replace(/\/+$/, "")}${path}`;

/** The site-relative path /go sends a visitor to. Pure, so the rules can be tested without a server. */
export function goPath(deadline: OfferDeadline | null): string {
  if (!deadline) return HOME_PATH;
  if (!deadline.closed) return sameSitePath(deadline.checkoutUrl) ?? HOME_PATH;
  return sameSitePath(deadline.afterCloseUrl) ?? ENDED_FALLBACK_PATH;
}

/* ------------------------------------------------------------------------ *
 * Routes. The two named ones first: the picture's pattern would not match them
 * (it is one path segment), but the order says so without anyone having to
 * work that out.
 * ------------------------------------------------------------------------ */

countdownRouter.get(
  "/countdown/:slug/status",
  asyncHandler(async (req, res) => {
    const slug = cleanSlug(req.params.slug);
    const deadline = slug ? await offerDeadline(slug) : null;
    if (!deadline) throw notFound("We could not find that offer.");
    res.set("Cache-Control", "no-store");
    res.json({
      endsAt: deadline.endsAt,
      endsLabel: deadline.endsLabel,
      closed: deadline.closed,
      showCountdown: deadline.showCountdown,
      checkoutUrl: deadline.checkoutUrl,
      afterCloseUrl: deadline.afterCloseUrl,
      serverNow: deadline.serverNow,
    });
  })
);

countdownRouter.get("/countdown/:slug/go", (req: Request, res: Response) => {
  const redirect = (path: string): void => {
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, absolute(path));
  };
  const slug = cleanSlug(req.params.slug);
  if (!slug) {
    redirect(HOME_PATH);
    return;
  }
  // Somebody clicked a link in an email. They get a page, never an error.
  Promise.resolve()
    .then(() => offerDeadline(slug))
    .then((deadline) => redirect(goPath(deadline)))
    .catch((err: unknown) => {
      console.error("[countdown] could not resolve the sale link:", (err as Error)?.message ?? err);
      if (!res.headersSent) redirect(HOME_PATH);
    });
});

/**
 * Both picture addresses: `/countdown/my-offer.gif` and `/countdown/my-offer`.
 * One route, with the extension taken off by hand. An offer's address can never
 * contain a dot, so there is no offer this could confuse with another.
 */
countdownRouter.get("/countdown/:slug", (req: Request, res: Response) => {
  const raw = typeof req.params.slug === "string" ? req.params.slug : "";
  const slug = cleanSlug(raw.replace(/\.gif$/i, ""));
  if (!slug) {
    sendGif(res, endedGif());
    return;
  }
  countdownGifFor(slug)
    .then((gif) => sendGif(res, gif))
    .catch(() => {
      if (!res.headersSent) sendGif(res, endedGif());
    });
});
