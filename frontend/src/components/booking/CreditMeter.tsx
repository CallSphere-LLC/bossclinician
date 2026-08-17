import { cn } from "@/lib/cn";

/**
 * "3 of 6 sessions used", as a bar.
 *
 * `role="progressbar"` with a spelled-out `aria-valuetext`, because "50%" tells
 * a screen-reader user nothing they came here for — how many calls are left
 * does. The visible label carries the same words, so both audiences read the
 * same sentence.
 */
export function CreditMeter({
  used,
  total,
  className,
}: {
  used: number;
  /** null for an open-ended package, which has no ledger to draw down. */
  total: number | null;
  className?: string;
}) {
  // An open-ended package (session_count 0) has nothing to fill. A bar pinned
  // at either end would be a lie in both directions.
  if (total === null || total <= 0) {
    return (
      <p className={cn("text-sm text-orchid", className)}>
        <span className="font-semibold text-white">{used}</span>{" "}
        {used === 1 ? "session" : "sessions"} booked — this package is open-ended.
      </p>
    );
  }

  const clamped = Math.min(Math.max(used, 0), total);
  const remaining = total - clamped;
  const percent = (clamped / total) * 100;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-orchid">
          <span className="font-semibold text-white">
            {clamped} of {total}
          </span>{" "}
          sessions used
        </p>
        <p className="text-xs uppercase tracking-[0.14em] text-orchid-faint">
          {remaining === 0 ? "None left" : `${remaining} left`}
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} of ${total} sessions used, ${remaining} remaining`}
        className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-luxe",
            remaining === 0 ? "bg-orchid-dim" : "bg-gold-foil",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
