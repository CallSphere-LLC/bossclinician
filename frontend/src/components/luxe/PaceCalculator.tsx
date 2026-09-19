import { useId, useState } from "react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { cn } from "@/lib/cn";

/**
 * The Club's pace calculator — the source page's slider, with its arithmetic.
 *
 * The curriculum is 22.5 hours of work, which is the figure the source script
 * is calibrated on (3 hours a week lands on 7.5 weeks). Weeks are rounded to
 * the nearest half, as they are there, so the two pages can never quote a
 * visitor different numbers for the same position of the marker.
 *
 * Server-rendered at the default position, so the figure is on the page before
 * any script runs and the static wording it replaces is what a crawler reads.
 */

const TOTAL_CURRICULUM_HOURS = 22.5;
const MIN_HOURS = 1;
const MAX_HOURS = 5;
const STEP_HOURS = 0.5;
const DEFAULT_HOURS = 3;

/** "3" or "2.5" — never "3.0". */
function trimmed(value: number): string {
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
}

function weeksFor(hours: number): string {
  return trimmed(Math.round((TOTAL_CURRICULUM_HOURS / hours) * 2) / 2);
}

interface PaceCalculatorProps {
  /** The question above the track. */
  prompt: string;
  /** Small caps line above the figure. */
  resultLabel: string;
  className?: string;
}

export function PaceCalculator({ prompt, resultLabel, className }: PaceCalculatorProps) {
  const id = useId();
  const [hours, setHours] = useState(DEFAULT_HOURS);

  const weeks = weeksFor(hours);
  const percent = ((hours - MIN_HOURS) / (MAX_HOURS - MIN_HOURS)) * 100;
  const hoursText = `${trimmed(hours)} ${hours === 1 ? "hour" : "hours"} a week`;

  return (
    <GlassCard accent="green" interactive={false} className={cn("p-6 text-center sm:p-10", className)}>
      <label
        htmlFor={id}
        className="block text-balance font-display text-[1.15rem] font-medium leading-[1.35] text-white sm:text-[1.3rem]"
      >
        {prompt}
      </label>

      <div className="mx-auto mt-5 flex max-w-md items-center gap-3 sm:gap-5">
        <span aria-hidden className="shrink-0 whitespace-nowrap text-sm font-semibold text-orchid">
          {MIN_HOURS} hr
        </span>
        {/* 44px tall so the marker is a full touch target; the painted track is
            the 6px bar behind it, filled up to the marker. */}
        <div className="relative flex h-11 min-w-0 flex-1 items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
            style={{
              background: `linear-gradient(to right, #C9A46A ${percent}%, rgb(var(--c-ink) / 0.15) ${percent}%)`,
            }}
          />
          <input
            id={id}
            type="range"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={STEP_HOURS}
            value={hours}
            aria-valuetext={`${hoursText}, about ${weeks} weeks`}
            onChange={(event) => setHours(Number(event.target.value))}
            className="range-gold relative w-full"
            style={{ height: "2.75rem", background: "transparent" }}
          />
        </div>
        <span aria-hidden className="shrink-0 whitespace-nowrap text-sm font-semibold text-orchid">
          {MAX_HOURS} hrs
        </span>
      </div>

      <p className="mt-1 text-[0.7rem] font-bold uppercase tracking-[0.2em] text-orchid">{hoursText}</p>

      {/* Announced politely: a screen reader hears the new pace after a drag
          settles rather than on every half-hour it passes through. */}
      <div aria-live="polite" aria-atomic="true">
        <p className="mt-7 text-[0.7rem] font-bold uppercase tracking-[0.2em] text-gold/80">{resultLabel}</p>
        <p className="text-foil mt-3 font-display text-[2.4rem] font-medium leading-none tabular-nums sm:text-[3rem]">
          About {weeks} Weeks
        </p>
        <p className="copy-luxe mx-auto mt-5 max-w-lg text-pretty text-sm">
          At this pace, you could work through the core Boss Move curriculum in approximately {weeks} weeks.
        </p>
      </div>
    </GlassCard>
  );
}
