import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { fetchCountdownStatus } from "@/lib/commerceApi";
import {
  pad2,
  spokenRemaining,
  useCountdown,
  type CountdownParts,
  type CountdownStatus,
  type OfferDeadlineInfo,
} from "@/lib/countdown";

/**
 * The sale countdown shown on the checkout, the course sales pages and funnel
 * steps (sheet row 250).
 *
 * Two ways to feed it:
 *
 *  - `deadline`: the page already holds the offer's deadline (the checkout).
 *  - `slug`: the timer asks the server itself (`/api/countdown/:slug/status`).
 *    Server-rendered pages pass both: the deadline they were rendered with
 *    supplies the wording straight away, and the fresh answer supplies the
 *    clock, because a rendered page can be minutes old by the time it is read.
 *
 * The server render and the first client paint are the same plain sentence,
 * "Offer ends Friday, December 4 at 11:59 PM PST". The ticking boxes appear
 * only after the page has mounted, so there is nothing for hydration to
 * disagree about, and a visitor without scripts still reads the true deadline.
 *
 * Nothing here moves: the digits change in place, so there is no animation to
 * switch off for people who ask for reduced motion.
 */

/* ── One status read per offer ──────────────────────────────────────────── */

interface StampedStatus {
  status: CountdownStatus;
  /** When the answer arrived, so its `serverNow` is compared with the right moment. */
  receivedAtMs: number;
}

const STATUS_TTL_MS = 15_000;
const statusReads = new Map<string, { at: number; result: Promise<StampedStatus> }>();

/**
 * A sales page shows the timer above both sets of buy buttons; they share one
 * request rather than asking twice.
 */
function loadStatus(slug: string): Promise<StampedStatus> {
  const held = statusReads.get(slug);
  if (held && Date.now() - held.at < STATUS_TTL_MS) return held.result;
  const result = fetchCountdownStatus(slug).then((status) => ({ status, receivedAtMs: Date.now() }));
  statusReads.set(slug, { at: Date.now(), result });
  result.catch(() => {
    if (statusReads.get(slug)?.result === result) statusReads.delete(slug);
  });
  return result;
}

/* ── What it looks like ─────────────────────────────────────────────────── */

const UNITS = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Min" },
  { key: "seconds", label: "Sec" },
] as const;

export interface CountdownViewProps {
  /** "Friday, December 4 at 11:59 PM PST", already in the site's timezone. */
  endsLabel: string;
  /** `null` draws the plain sentence only (server render and first paint). */
  parts: CountdownParts | null;
  /** The sale is over: one calm line, no boxes. */
  ended?: boolean;
  align?: "left" | "center";
  className?: string;
}

/**
 * The banner itself, with no clock of its own: it draws whatever it is handed.
 *
 * Figures are the body face in bold with tabular numerals, never the display
 * serif, so the boxes do not shift width as the seconds change.
 */
export function CountdownView({ endsLabel, parts, ended = false, align = "left", className }: CountdownViewProps) {
  const over = ended || parts?.done === true;
  if (!over && !endsLabel && !parts) return null;

  return (
    <div
      data-countdown={over ? "ended" : parts ? "live" : "static"}
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-2xl border border-gold/30 bg-gold/[0.07] px-4 py-4 sm:px-5",
        align === "center"
          ? "items-center text-center"
          : "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      {over ? (
        <p className="text-sm font-semibold leading-relaxed text-white">This offer has ended.</p>
      ) : (
        <p className="min-w-0 text-sm leading-relaxed">
          <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
            Offer ends
          </span>{" "}
          <span className="font-semibold tabular-nums text-white">{endsLabel}</span>
        </p>
      )}

      {parts && !over && (
        // `role="timer"` with live announcements off: a screen reader is not
        // interrupted every second. It reads the sentence below when the user
        // reaches the timer, and that sentence changes at most once a minute.
        <div role="timer" aria-live="off" aria-atomic="true" className="shrink-0">
          <span className="sr-only">{spokenRemaining(parts)}</span>
          <div aria-hidden className="grid grid-cols-4 gap-2">
            {UNITS.map((unit) => (
              <div
                key={unit.key}
                className="min-w-[3.25rem] rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center"
              >
                <span className="block text-xl font-bold leading-none tabular-nums text-white sm:text-2xl">
                  {pad2(parts[unit.key])}
                </span>
                <span className="mt-1.5 block text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-orchid-dim">
                  {unit.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The timer ──────────────────────────────────────────────────────────── */

export interface OfferCountdownProps {
  /** The deadline the page already holds. */
  deadline?: OfferDeadlineInfo | null;
  /**
   * `Date.now()` when `deadline` reached this browser. Without it the deadline
   * is taken to have arrived as the timer mounts. Not used with `slug`.
   */
  receivedAtMs?: number;
  /** The offer to ask the server about. With it, the clock comes from that answer. */
  slug?: string;
  /** Called once when the countdown reaches zero, whether or not the banner is shown. */
  onExpire?: () => void;
  /**
   * Show the banner even when the offer's "show the countdown on the checkout
   * and sales page" switch is off. For a funnel step, where the owner typed the
   * countdown line herself.
   */
  ignoreToggle?: boolean;
  align?: "left" | "center";
  className?: string;
}

export function OfferCountdown({
  deadline = null,
  receivedAtMs,
  slug,
  onExpire,
  ignoreToggle = false,
  align = "left",
  className,
}: OfferCountdownProps) {
  const [read, setRead] = useState<StampedStatus | null>(null);

  useEffect(() => {
    setRead(null);
    if (!slug) return;
    let cancelled = false;
    loadStatus(slug)
      .then((result) => {
        if (!cancelled) setRead(result);
      })
      .catch(() => {
        // An unknown offer or a failed read leaves the plain sentence (or
        // nothing). The deadline is still enforced by the server either way.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const status = slug ? (read?.status ?? null) : null;
  const closedOnArrival = status?.closed === true;

  // With a slug the clock waits for the fresh answer: the deadline a page was
  // rendered with may be old, and its `serverNow` older still.
  const endsAt = slug ? (status?.endsAt ?? null) : (deadline?.endsAt ?? null);
  const serverNow = slug ? (status?.serverNow ?? null) : (deadline?.serverNow ?? null);

  const parts = useCountdown(closedOnArrival ? null : endsAt, serverNow, {
    onExpire,
    receivedAtMs: slug ? read?.receivedAtMs : receivedAtMs || undefined,
  });

  const shown = ignoreToggle || (status ? status.showCountdown : (deadline?.showCountdown ?? false));
  if (!shown) return null;
  // The server says this offer has no deadline (any more): nothing to count.
  if (status && !status.endsAt && !closedOnArrival) return null;

  return (
    <CountdownView
      endsLabel={status?.endsLabel || deadline?.endsLabel || ""}
      parts={parts}
      ended={closedOnArrival}
      align={align}
      className={className}
    />
  );
}

export default OfferCountdown;
