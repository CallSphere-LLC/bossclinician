import { useState } from "react";
import { Check, Globe } from "lucide-react";
import { LuxeSelect } from "@/components/luxe/LuxeField";
import { cn } from "@/lib/cn";
import {
  sameClock,
  timezoneOptionsWith,
  zoneLongName,
  zoneSentence,
} from "@/components/booking/timezone";

/**
 * The zone every time on the screen is being read in, said out loud.
 *
 * This is the most important sentence on the booking screens. A member who
 * books 9am believing it is their 9am, and finds the coach waiting at 6am,
 * has been failed by a page that knew the answer and did not say it. So the
 * zone is named in full ("Eastern Daylight Time"), it sits above the times
 * rather than under them, and changing it takes one tap.
 *
 * When the device disagrees with the saved preference the mismatch is raised
 * unprompted — that is the case where a member is most likely to be wrong and
 * least likely to check.
 */
/**
 * The same sentence without the control, for a second place on a page that
 * already carries one banner. Restating the zone next to the times themselves
 * is worth the repetition; a second way to change it is not.
 */
export function ZoneLine({ timezone, className }: { timezone: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm text-orchid", className)}>
      <Globe aria-hidden className="size-3.5 shrink-0 text-gold" />
      Times shown in <span className="font-semibold text-white">{zoneSentence(timezone)}</span>
    </p>
  );
}

export function TimezoneNotice({
  timezone,
  onChange,
  deviceTimezone,
  className,
}: {
  timezone: string;
  onChange: (timezone: string) => void;
  /** The browser's own setting, when it is worth offering. */
  deviceTimezone?: string;
  className?: string;
}) {
  const [picking, setPicking] = useState(false);
  const mismatch =
    deviceTimezone !== undefined && !sameClock(deviceTimezone, timezone) ? deviceTimezone : null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-gold/25 bg-gold/[0.06] px-4 py-3.5 sm:px-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Globe aria-hidden className="size-4 shrink-0 text-gold" />
        {/* Polite rather than assertive: the sentence changes as a result of the
            member's own tap, so it needs announcing but not interrupting. */}
        <p aria-live="polite" className="min-w-0 text-sm text-white">
          Times shown in <strong className="font-semibold text-gold">{zoneSentence(timezone)}</strong>
        </p>
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          className={cn(
            "ml-auto inline-flex min-h-[2.75rem] items-center rounded-full px-4",
            "text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-orchid",
            "transition-colors duration-300 hover:bg-white/[0.06] hover:text-white",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          {picking ? "Done" : "Change"}
        </button>
      </div>

      {picking && (
        <div className="mt-4 max-w-sm">
          <LuxeSelect
            label="Show times in"
            value={timezone}
            onChange={(event) => onChange(event.target.value)}
          >
            {timezoneOptionsWith(timezone).map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </LuxeSelect>
        </div>
      )}

      {mismatch && !picking && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gold/20 pt-3">
          <p className="min-w-0 text-sm text-orchid">
            This device is set to {zoneLongName(mismatch)}.
          </p>
          <button
            type="button"
            onClick={() => onChange(mismatch)}
            className={cn(
              "inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-gold/40 px-4",
              "text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-gold",
              "transition-colors duration-300 hover:bg-gold/[0.12]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            )}
          >
            <Check aria-hidden className="size-3.5" />
            Use that instead
          </button>
        </div>
      )}
    </div>
  );
}
