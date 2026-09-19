/**
 * VoiceTourBar — the way out of the walkthrough.
 *
 * Being shown around is pleasant right up until you want to do something else,
 * so while a tour is running there is always a small, quiet marker saying which
 * stop this is and offering to stop. Nothing about it demands attention: it
 * sits in the far corner, away from the cursor that is doing the pointing and
 * away from the captions.
 *
 * The walkthrough itself belongs to the tools slice — where it is going, what
 * it says, when it moves on, and the record of having stopped. This only
 * reflects that state and gives the person a door out of it, so pausing or
 * ending from here goes back through the engine rather than being acted on
 * locally; a walkthrough someone stopped by hand must not be offered again.
 */

import { useSyncExternalStore } from "react";
import { Pause, Play, X } from "lucide-react";
import {
  endTour,
  getTourServerSnapshot,
  getTourSnapshot,
  pauseTour,
  resumeTour,
  subscribeTour,
} from "@/voice/tools";

export function VoiceTourBar() {
  const tour = useSyncExternalStore(subscribeTour, getTourSnapshot, getTourServerSnapshot);

  if (!tour || tour.total <= 0) return null;

  const stop = Math.min(tour.index + 1, tour.total);
  const paused = tour.paused === true;

  return (
    <div className="fixed bottom-4 left-4 z-[78] w-[min(18rem,calc(100vw-2rem))] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-raised/95 px-3 py-2 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.7)] backdrop-blur">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-gold">
          Stop {stop} of {tour.total}
        </span>
        {tour.label && (
          <span className="min-w-0 flex-1 truncate text-[0.72rem] text-ink-soft">{tour.label}</span>
        )}
        <button
          type="button"
          onClick={() => (paused ? resumeTour() : pauseTour())}
          className="ml-auto shrink-0 rounded-full p-1.5 text-ink-soft transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          aria-label={paused ? "Carry on with the walkthrough" : "Pause the walkthrough"}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => endTour()}
          className="shrink-0 rounded-full p-1.5 text-ink-soft transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          aria-label="Stop the walkthrough"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
