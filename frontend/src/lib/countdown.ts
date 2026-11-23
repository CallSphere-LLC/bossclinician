import { useEffect, useRef, useState } from "react";

/**
 * Sale deadline countdown: the maths, the ticker and the hook (sheet row 250).
 *
 * The deadline belongs to the server. Every figure here is worked out from the
 * server's own clock (`serverNow`, sent beside the deadline), so a visitor whose
 * device clock is wrong still sees the right time left. Nothing ticks during a
 * server render or the first client paint: the hook answers `null` until the
 * page has mounted, which is what keeps server-rendered sales pages free of
 * hydration mismatches.
 */

/** The `deadline` object on a public offer and on a course's offers. */
export interface OfferDeadlineInfo {
  /** ISO instant the sale closes. */
  endsAt: string;
  /** The same instant in the site's timezone: "Friday, December 4 at 11:59 PM PST". */
  endsLabel: string;
  /** ISO instant the server answered at. */
  serverNow: string;
  /** The owner's "show the countdown on the checkout and sales page" switch. */
  showCountdown: boolean;
}

/**
 * The `deadline` on each of a course's offers (`GET /api/courses/:slug`).
 *
 * A sales page lists an offer whose sale has ended as long as it names
 * somewhere to go, so it also says whether the sale is over and where its
 * button should lead. The checkout never sees these two: a closed offer
 * answers 410 there instead.
 */
export interface CourseOfferDeadlineInfo extends OfferDeadlineInfo {
  /** The sale had ended when the server answered. */
  closed?: boolean;
  /** Site path for latecomers, usually the regular-price checkout; '' when none. */
  afterCloseUrl?: string;
}

/** True when the server said this offer's sale is over. Never worked out from the device clock. */
export function saleClosed(deadline: Pick<CourseOfferDeadlineInfo, "closed"> | null | undefined): boolean {
  return deadline?.closed === true;
}

/**
 * Where a closed offer's button leads: a path on this site, or '' when the
 * offer is still open or names nowhere. One leading slash, never `//host` or
 * `/\host`, which a browser would read as another website.
 */
export function afterClosePath(deadline: CourseOfferDeadlineInfo | null | undefined): string {
  if (!saleClosed(deadline)) return "";
  const path = deadline?.afterCloseUrl;
  return typeof path === "string" && /^\/(?![/\\])[^\s\\]*$/.test(path) ? path : "";
}

/**
 * The offer whose timer a sales page shows: of the offers that can be bought,
 * have the countdown switched on and are still on sale, the one closing first.
 * An ended sale is never chosen, so the banner cannot sit on "ended" above
 * buttons that still work.
 */
export function timedOffer<T extends { available: boolean; deadline?: CourseOfferDeadlineInfo | null }>(
  offers: readonly T[],
): (T & { deadline: CourseOfferDeadlineInfo }) | undefined {
  const endsAt = (offer: T) => Date.parse(offer.deadline?.endsAt ?? "");
  return offers
    .filter(
      (offer): offer is T & { deadline: CourseOfferDeadlineInfo } =>
        offer.available &&
        !!offer.deadline &&
        offer.deadline.showCountdown &&
        !saleClosed(offer.deadline) &&
        Number.isFinite(endsAt(offer)),
    )
    .sort((a, b) => endsAt(a) - endsAt(b))[0];
}

/** What `GET /api/countdown/:slug/status` answers with. */
export interface CountdownStatus {
  endsAt: string | null;
  endsLabel: string;
  closed: boolean;
  showCountdown: boolean;
  checkoutUrl: string;
  afterCloseUrl: string;
  serverNow: string;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once nothing is left. */
  done: boolean;
}

const SECOND = 1000;

/**
 * Time left, split for display.
 *
 * Rounded up to the whole second, so the boxes read 00:00:01 through the last
 * second and reach zero at the same moment `done` turns true. Days are not
 * capped: a sale four months out reads 120 days, not 99.
 */
export function remainingParts(endsAtMs: number, nowMs: number): CountdownParts {
  const left = endsAtMs - nowMs;
  if (!Number.isFinite(left) || left <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  }
  const total = Math.ceil(left / SECOND);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    done: false,
  };
}

/**
 * How far the server's clock is ahead of this device's, in milliseconds.
 *
 * Add it to `Date.now()` to get the server's idea of now. Zero when the server
 * time cannot be read, which falls back to trusting the device.
 */
export function clockOffsetMs(serverNow: string | null | undefined, clientNowMs: number): number {
  const server = Date.parse(serverNow ?? "");
  return Number.isFinite(server) ? server - clientNowMs : 0;
}

/** Two digits for the boxes; a three-digit day count is left as it is. */
export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The time left as a sentence for screen readers.
 *
 * Seconds are left out on purpose, so the sentence changes at most once a
 * minute instead of being rewritten under the reader every second.
 */
export function spokenRemaining(parts: CountdownParts): string {
  if (parts.done) return "This offer has ended.";
  const bits: string[] = [];
  if (parts.days > 0) bits.push(plural(parts.days, "day"));
  if (parts.hours > 0) bits.push(plural(parts.hours, "hour"));
  if (parts.minutes > 0) bits.push(plural(parts.minutes, "minute"));
  if (bits.length === 0) return "Less than a minute left.";
  const last = bits.pop() as string;
  return `${bits.length > 0 ? `${bits.join(", ")} and ${last}` : last} left.`;
}

export interface CountdownTicker {
  /** Server time the countdown ends, in epoch milliseconds. */
  endsAtMs: number;
  /** From `clockOffsetMs`. */
  offsetMs: number;
  onTick: (parts: CountdownParts) => void;
  /** Called once, when the countdown reaches zero (or starts already past it). */
  onExpire?: () => void;
}

/**
 * Runs a countdown outside React. Returns the function that stops it.
 *
 * The time left is read from the clock on every tick rather than decremented,
 * so a tab that slept for an hour wakes up showing the right time. Each tick is
 * scheduled for the next whole second of time left, the timer stops itself at
 * zero, and `onExpire` fires exactly once.
 */
export function startCountdown({ endsAtMs, offsetMs, onTick, onExpire }: CountdownTicker): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const serverNowMs = Date.now() + offsetMs;
    const left = endsAtMs - serverNowMs;
    const parts = remainingParts(endsAtMs, serverNowMs);
    onTick(parts);
    if (parts.done) {
      stopped = true;
      onExpire?.();
      return;
    }
    const untilNextSecond = left % SECOND;
    timer = setTimeout(tick, untilNextSecond === 0 ? SECOND : untilNextSecond);
  };

  tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export interface UseCountdownOptions {
  /** Called once when this deadline reaches zero. */
  onExpire?: () => void;
  /**
   * When `serverNow` reached this browser (`Date.now()` at that moment). Give it
   * whenever the answer may have been held for a while before the timer starts.
   * Left out, the answer is taken to have just arrived.
   */
  receivedAtMs?: number;
}

/**
 * The live time left until `endsAt`.
 *
 * `null` on the server, on the first client render and when there is no usable
 * deadline; ticking parts from the first effect onwards. Stops at zero.
 */
export function useCountdown(
  endsAt: string | null | undefined,
  serverNow: string | null | undefined,
  options: UseCountdownOptions = {},
): CountdownParts | null {
  const [parts, setParts] = useState<CountdownParts | null>(null);
  const { onExpire, receivedAtMs } = options;

  // The newest callback without restarting the timer each time a parent renders.
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const endsAtMs = Date.parse(endsAt ?? "");
    if (!Number.isFinite(endsAtMs)) {
      setParts(null);
      return;
    }
    return startCountdown({
      endsAtMs,
      offsetMs: clockOffsetMs(serverNow, receivedAtMs ?? Date.now()),
      onTick: setParts,
      onExpire: () => expire.current?.(),
    });
  }, [endsAt, serverNow, receivedAtMs]);

  return parts;
}

/* ── Funnel step bodies ─────────────────────────────────────────────────── */

export type CountdownBlock =
  | { kind: "markdown"; text: string }
  | { kind: "countdown"; slug: string };

/** A whole line that reads `{countdown some-offer-slug}`. The slug itself is checked by `cleanCountdownSlug`. */
const COUNTDOWN_LINE = /^\{countdown ([^{}]+)\}\s*$/;
/** The same shape the server accepts (backend routes/public/countdown.ts, `cleanSlug`). */
const OFFER_SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * The offer slug typed on a countdown line, as the server will accept it, or
 * null when it could not be an offer's address.
 *
 * Trimmed and lowercased first (an owner typing `Early-Bird` means the offer
 * `early-bird`), then held to the server's own pattern, so the page never asks
 * for a timer the server would refuse.
 */
export function cleanCountdownSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return null;
  return OFFER_SLUG.test(slug) ? slug : null;
}

/**
 * Splits a funnel step's Markdown at its `{countdown offer-slug}` lines.
 *
 * Only a line that is exactly that, on its own, counts: the same words inside a
 * sentence or inside a fenced code block stay as text. Everything between the
 * markers comes back untouched, in order, and empty stretches are dropped, so a
 * body with no marker is a single Markdown block exactly as before.
 */
export function splitCountdownBlocks(markdown: string): CountdownBlock[] {
  const blocks: CountdownBlock[] = [];
  let pending: string[] = [];
  let fenced = false;

  const flush = () => {
    const text = pending.join("\n");
    pending = [];
    if (text.trim() !== "") blocks.push({ kind: "markdown", text });
  };

  for (const line of (markdown ?? "").split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced;
    const match = fenced ? null : COUNTDOWN_LINE.exec(line);
    const slug = match ? cleanCountdownSlug(match[1]) : null;
    if (slug) {
      flush();
      blocks.push({ kind: "countdown", slug });
    } else {
      pending.push(line);
    }
  }
  flush();
  return blocks;
}
