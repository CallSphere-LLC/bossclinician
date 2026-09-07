import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The KPI card — Part II §12–§17.
 *
 * One component, used on every module page as well as the dashboard, because
 * §17 is explicit that this is a *system* and not a dashboard decoration. The
 * prop signature is the one the spec names.
 *
 * Three decisions worth keeping:
 *
 * - Trend is never carried by colour alone (§51). Every card states the
 *   direction as an arrow glyph *and* a sign on the number, so the meaning
 *   survives a greyscale print, a red-green colour deficiency, and forced-
 *   colours mode. Colour is the third channel, not the only one.
 *
 * - `change === null` is a real, common state — the period before had nothing
 *   in it — and it is not the same as 0%. Rendering "+∞%" or "0%" for it both
 *   lie, so it renders as "No comparison" and reads as absent.
 *
 * - The sparkline is hand-drawn SVG rather than a Recharts instance. Six of
 *   these sit above the fold and each Recharts chart brings a ResponsiveContainer
 *   with a resize observer; a 40-point polyline does not need any of it.
 */

export type Trend = "up" | "down" | "flat";

/** Which direction is good. Refunds going up is not a success. */
export type TrendSense = "higher-is-better" | "lower-is-better" | "neutral";

export interface KPICardProps {
  /** Metric label — the muted line above the value (§12). */
  title: string;
  /** Already formatted for display: "$42,680", "324", "48.2%". */
  value: ReactNode;
  /** Percentage change against the comparison period, or null when there is
   *  no comparable previous period. */
  change?: number | null;
  /** "vs previous 30 days" (§12). */
  comparison?: string;
  /** Derived from `change` when omitted. */
  trend?: Trend;
  /** Whether up is good for this metric. Defaults to higher-is-better. */
  sense?: TrendSense;
  sparkline?: number[];
  icon?: ReactNode;
  /** Makes the whole card a link (§16). */
  to?: string;
  /** A short sentence under the value, for cards that need one. */
  hint?: string;
  /** Draws the card in the accent rather than neutral (§13, "main highlight"). */
  highlight?: boolean;
  loading?: boolean;
  className?: string;
}

function trendFrom(change: number | null | undefined): Trend {
  if (change === null || change === undefined || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

/**
 * Direction → meaning. A 12% rise in revenue and a 12% rise in refunds are the
 * same arrow and opposite news, so the arrow and the colour are chosen
 * separately: the arrow reports the direction, the colour reports whether that
 * direction is good.
 */
function toneFor(trend: Trend, sense: TrendSense): "pos" | "neg" | "flat" {
  if (trend === "flat" || sense === "neutral") return "flat";
  const good = sense === "lower-is-better" ? trend === "down" : trend === "up";
  return good ? "pos" : "neg";
}

const TREND_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
} as const;

export function KPICard({
  title,
  value,
  change,
  comparison,
  trend,
  sense = "higher-is-better",
  sparkline,
  icon,
  to,
  hint,
  highlight = false,
  loading = false,
  className,
}: KPICardProps) {
  const resolvedTrend = trend ?? trendFrom(change);
  const tone = toneFor(resolvedTrend, sense);
  const TrendIcon = TREND_ICON[resolvedTrend];
  const hasChange = change !== null && change !== undefined;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        {/* Two lines' worth of height whether or not the label wraps: without
            it a card titled "Subscription Revenue" pushes its own value a line
            lower than the five cards beside it, and the row of figures no
            longer reads as a row (§15). */}
        <p className="min-h-[2.1rem] text-[0.8rem] font-medium leading-tight text-ink-soft">
          {title}
        </p>
        {icon && (
          <span
            aria-hidden
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-[0.95rem]",
              highlight ? "bg-accent/15 text-accent" : "bg-raise text-ink-soft",
            )}
          >
            {icon}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 h-8 w-28 animate-pulse rounded-md bg-raise-strong" />
      ) : (
        <p
          className={cn(
            // §46 puts the KPI value at 24–32px; §13 warns against huge metric
            // cards, so this sits at the lower end and lets the label do the
            // explaining.
            "mt-2.5 font-numeric text-[1.7rem] font-semibold leading-none tracking-tight text-ink tabular-nums",
            highlight && "text-accent",
          )}
        >
          {value}
        </p>
      )}

      {sparkline && sparkline.length > 1 && !loading && (
        <Sparkline points={sparkline} tone={tone} highlight={highlight} />
      )}

      {(hasChange || comparison || hint) && !loading && (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {hasChange && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[0.78rem] font-semibold tabular-nums",
                tone === "pos" && "text-pos",
                tone === "neg" && "text-neg",
                tone === "flat" && "text-ink-soft",
              )}
            >
              <TrendIcon aria-hidden className="size-3.5" />
              {/* The sign is spelled out so direction survives without colour. */}
              {change > 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          )}
          {/* "No comparison" and "vs previous 30 days" together said the same
              thing twice and read as a contradiction — there is no comparison,
              so naming the period it would have been against is noise. */}
          {!hasChange && comparison && (
            <span className="text-[0.78rem] font-medium text-ink-soft">
              Nothing in the previous period
            </span>
          )}
          {hasChange && comparison && (
            <span className="text-[0.72rem] text-ink-soft">{comparison}</span>
          )}
          {hint && <span className="text-[0.72rem] text-ink-soft">{hint}</span>}
        </div>
      )}
    </>
  );

  // §13: 8–14px radius, 1px border, very soft shadow.
  const shell = cn(
    "relative flex flex-col rounded-xl border border-hairline bg-surface p-4 shadow-console transition-all duration-200",
    highlight && "border-accent/35",
    className,
  );

  if (!to) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      to={to}
      // §16: subtle border emphasis and slight elevation. Nothing exaggerated —
      // six of these lifting at once on a mouse sweep is the "excessive
      // animation" §2 rules out.
      className={cn(
        shell,
        "group cursor-pointer hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-console-pop",
        "focus-visible:border-accent/45",
        "motion-reduce:hover:translate-y-0 motion-reduce:transition-none",
      )}
    >
      {body}
      <ArrowRight
        aria-hidden
        className="absolute bottom-4 right-4 size-3.5 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

/* ------------------------------------------------------------- Sparkline */

/**
 * A 40×(fixed) polyline with a soft fill under it.
 *
 * Normalised to its own min/max rather than to zero: these are 24px tall, and
 * anchoring a $41,900–$42,700 series to zero draws a flat line and says
 * nothing. The card's job here is shape, not magnitude — the magnitude is the
 * number above it.
 */
function Sparkline({
  points,
  tone,
  highlight,
}: {
  points: number[];
  tone: "pos" | "neg" | "flat";
  highlight: boolean;
}) {
  const gradientId = useId();
  const width = 120;
  const height = 26;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);

  const coords = points.map((value, i) => {
    const x = i * step;
    // 1px inset top and bottom so a peak is not clipped by the viewBox edge.
    const y = height - 1 - ((value - min) / span) * (height - 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const stroke = highlight
    ? "rgb(var(--c-accent))"
    : tone === "pos"
      ? "rgb(var(--c-pos))"
      : tone === "neg"
        ? "rgb(var(--c-neg))"
        : "rgb(var(--c-ink-soft))";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-3 h-[26px] w-full"
      // Decorative: the trend is already stated in text beneath it, so a
      // screen reader announcing 30 unlabelled numbers would only add noise.
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${coords.join(" ")} ${width},${height}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------------- KPI grid */

/**
 * The responsive KPI grid — §15.
 *
 * Mobile 1–2 across, tablet 2–3, desktop up to 6. `auto-rows-fr` is what keeps
 * a card whose label wraps to two lines from being taller than its neighbours,
 * which §15 calls out ("cards should scale naturally without becoming tall").
 */
export function KPIGrid({
  children,
  columns = 6,
  className,
}: {
  children: ReactNode;
  /** Widest breakpoint's column count. 6 for the primary row, 3–4 for module pages. */
  columns?: 3 | 4 | 5 | 6;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        columns === 5 && "lg:grid-cols-3 xl:grid-cols-5",
        columns === 6 && "lg:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
