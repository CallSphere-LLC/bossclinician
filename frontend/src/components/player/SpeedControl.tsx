import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Playback speed, remembered across lessons.
 *
 * Somebody who listens at 1.5x listens to everything at 1.5x, and re-choosing it
 * at the top of every lesson is the kind of small friction that makes a course
 * feel like a website. localStorage rather than the member record because it is a
 * property of the device they are on — the phone on a walk and the desktop at a
 * desk are legitimately different speeds.
 */

const STORAGE_KEY = "bc.player.rate";

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

function readStoredRate(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return PLAYBACK_RATES.some((rate) => rate === stored) ? stored : 1;
  } catch {
    // Private browsing, or storage disabled entirely. Normal speed is fine.
    return 1;
  }
}

export function useStoredPlaybackRate(): [number, (rate: number) => void] {
  const [rate, setRate] = useState(1);

  // Read after mount rather than in the initialiser: this component renders in a
  // route that may be server-rendered later, and `window` at module scope is the
  // thing that breaks first when it is.
  useEffect(() => {
    setRate(readStoredRate());
  }, []);

  const update = useCallback((next: number) => {
    setRate(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The rate still applies to this session; it just will not be remembered.
    }
  }, []);

  return [rate, update];
}

interface SpeedControlProps {
  rate: number;
  onChange: (rate: number) => void;
  className?: string;
}

/**
 * A real `<select>`.
 *
 * A custom popover would need its own focus management and its own mobile
 * behaviour to match what the platform already does correctly, and this is a
 * six-item list of numbers. The label is visually hidden rather than absent —
 * "1.5x" alone tells a screen-reader user nothing about what it governs.
 */
export function SpeedControl({ rate, onChange, className }: SpeedControlProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Gauge aria-hidden className="size-4 shrink-0 text-orchid-faint" />
      <label htmlFor="player-speed" className="sr-only">
        Playback speed
      </label>
      <select
        id="player-speed"
        value={rate}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          "min-h-[2.75rem] rounded-full border border-white/12 bg-white/[0.04] pl-3.5 pr-9",
          "text-sm font-medium text-white outline-none transition-colors duration-300",
          "hover:border-white/20 focus-visible:border-gold/60",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
          "appearance-none bg-[length:0.65rem] bg-[right_0.9rem_center] bg-no-repeat",
          "[background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23C9A46A' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")]",
          "[&>option]:bg-night-raised [&>option]:text-ink",
        )}
      >
        {PLAYBACK_RATES.map((value) => (
          <option key={value} value={value}>
            {value}&times;
          </option>
        ))}
      </select>
    </div>
  );
}
