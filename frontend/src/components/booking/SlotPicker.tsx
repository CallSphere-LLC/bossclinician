import { useEffect, useMemo, useState } from "react";
import { CalendarX2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AvailabilitySlot } from "@/lib/coachingApi";
import {
  addDays,
  dayKeyInZone,
  formatDayChip,
  formatDayHeading,
  formatTime,
  zoneShortName,
} from "@/components/booking/timezone";

interface DayGroup {
  key: string;
  /** The first slot of the day, used for every label so the zone does the work. */
  sample: string;
  slots: AvailabilitySlot[];
}

/**
 * Slots, grouped into days *in the member's zone*.
 *
 * The server sends a flat list of instants precisely so this grouping happens
 * here: a 9pm-Pacific slot belongs to Tuesday for a Californian and to
 * Wednesday for a Berliner, and only the screen knows which of those is being
 * read. Grouping server-side is how a booking screen ends up showing an empty
 * Tuesday that is actually full.
 */
function groupByDay(slots: AvailabilitySlot[], timezone: string): Map<string, DayGroup> {
  const groups = new Map<string, DayGroup>();
  const sorted = [...slots].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  for (const slot of sorted) {
    const key = dayKeyInZone(slot.startsAt, timezone);
    const existing = groups.get(key);
    if (existing) existing.slots.push(slot);
    else groups.set(key, { key, sample: slot.startsAt, slots: [slot] });
  }
  return groups;
}

export function SlotPicker({
  slots,
  timezone,
  loading,
  error,
  selected,
  onSelect,
  rangeStart,
  daysShown,
  onShiftRange,
  canGoBack,
}: {
  slots: AvailabilitySlot[];
  timezone: string;
  loading: boolean;
  error: string;
  /** ISO instant of the chosen slot, or null. */
  selected: string | null;
  onSelect: (startsAt: string) => void;
  rangeStart: Date;
  daysShown: number;
  onShiftRange: (days: number) => void;
  canGoBack: boolean;
}) {
  const groups = useMemo(() => groupByDay(slots, timezone), [slots, timezone]);

  // Every day in the window, so empty ones still show as unavailable rather
  // than silently collapsing the strip and shifting the days people just aimed
  // at. `dayKeyInZone` is what ties a strip cell to its group.
  const days = useMemo(() => {
    return Array.from({ length: daysShown }, (_, index) => {
      const instant = addDays(rangeStart, index);
      const key = dayKeyInZone(instant, timezone);
      return { key, instant, group: groups.get(key) ?? null };
    });
  }, [daysShown, rangeStart, timezone, groups]);

  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Land on the first day that actually has slots — a member arriving on an
  // empty Monday should not have to hunt for the Tuesday that is open. Also
  // re-runs when the zone changes, since the day boundaries move with it.
  useEffect(() => {
    const selectedKey = selected ? dayKeyInZone(selected, timezone) : null;
    if (selectedKey && groups.has(selectedKey)) {
      setActiveKey(selectedKey);
      return;
    }
    const firstOpen = days.find((day) => day.group && day.group.slots.length > 0);
    setActiveKey(firstOpen?.key ?? days[0]?.key ?? null);
  }, [days, groups, selected, timezone]);

  const active = days.find((day) => day.key === activeKey) ?? null;
  const activeSlots = active?.group?.slots ?? [];
  const totalSlots = slots.length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onShiftRange(-daysShown)}
          disabled={!canGoBack || loading}
          className={arrowClass}
          aria-label="Show earlier dates"
        >
          <ChevronLeft aria-hidden className="size-4" />
          <span className="hidden sm:inline">Earlier</span>
        </button>

        <p className="min-w-0 truncate text-center text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-orchid-dim">
          {formatDayHeading(rangeStart, timezone)} —{" "}
          {formatDayHeading(addDays(rangeStart, daysShown - 1), timezone)}
        </p>

        <button
          type="button"
          onClick={() => onShiftRange(daysShown)}
          disabled={loading}
          className={arrowClass}
          aria-label="Show later dates"
        >
          <span className="hidden sm:inline">Later</span>
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>

      {/* A scrolling strip rather than a month grid: on a phone a grid gives
          every date a 30px target, and this audience books from a phone. */}
      <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul aria-label="Available dates" className="flex gap-2">
          {days.map((day) => {
            const count = day.group?.slots.length ?? 0;
            const isActive = day.key === activeKey;
            const chip = formatDayChip(day.instant, timezone);
            return (
              <li key={day.key} className="shrink-0">
                {/* `aria-pressed` rather than tab semantics: tabs would owe the
                    keyboard arrow-key handling that a two-week strip of dates
                    does not benefit from, and half-built tabs read worse than
                    honest toggle buttons. */}
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-controls="slot-picker-times"
                  aria-label={`${formatDayHeading(day.instant, timezone)} — ${
                    count === 0 ? "no times open" : `${count} times open`
                  }`}
                  disabled={count === 0}
                  onClick={() => setActiveKey(day.key)}
                  className={cn(
                    "flex min-h-[4.25rem] w-[3.9rem] flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-2",
                    "transition-colors duration-300",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    isActive
                      ? "border-gold/60 bg-gold/[0.12]"
                      : "border-white/12 bg-white/[0.03] hover:border-white/25",
                    count === 0 && "cursor-not-allowed opacity-35 hover:border-white/12",
                  )}
                >
                  <span
                    className={cn(
                      "text-[0.6rem] font-semibold uppercase tracking-[0.12em]",
                      isActive ? "text-gold" : "text-orchid-faint",
                    )}
                  >
                    {chip.weekday}
                  </span>
                  <span
                    className={cn(
                      "font-display text-lg leading-none",
                      isActive ? "text-white" : "text-white/75",
                    )}
                  >
                    {chip.day}
                  </span>
                  <span className="text-[0.58rem] uppercase tracking-[0.1em] text-orchid-faint">
                    {count === 0 ? "—" : count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div id="slot-picker-times" aria-live="polite" className="mt-5">
        {loading && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Checking what is open…
          </p>
        )}

        {!loading && error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}

        {!loading && !error && totalSlots === 0 && (
          <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-10 text-center">
            <CalendarX2 aria-hidden className="size-6 text-orchid-dim" />
            <p className="mt-3 text-sm text-white">Nothing open in these dates.</p>
            <p className="copy-luxe mt-1.5 max-w-xs text-balance text-sm">
              Try the next fortnight — Yvette opens her calendar a few weeks at a time.
            </p>
          </div>
        )}

        {!loading && !error && totalSlots > 0 && active && (
          <>
            <h4 className="font-display text-base text-white">
              {formatDayHeading(active.instant, timezone)}
            </h4>
            {activeSlots.length === 0 ? (
              <p className="mt-2 text-sm text-orchid-dim">No times open on this day.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {activeSlots.map((slot) => {
                  const isChosen = slot.startsAt === selected;
                  return (
                    <li key={slot.startsAt}>
                      <button
                        type="button"
                        onClick={() => onSelect(slot.startsAt)}
                        aria-pressed={isChosen}
                        className={cn(
                          "flex min-h-[2.75rem] w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-3",
                          "text-sm font-medium transition-colors duration-300",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                          isChosen
                            ? "border-gold bg-gold/[0.16] text-white"
                            : "border-white/12 bg-white/[0.03] text-white/85 hover:border-gold/45 hover:bg-white/[0.07]",
                        )}
                      >
                        {formatTime(slot.startsAt, timezone)}
                        {/* The abbreviation rides along on every single time, so
                            no button can be read out of context. */}
                        <span className="text-[0.62rem] uppercase tracking-[0.08em] text-orchid-faint">
                          {zoneShortName(timezone, slot.startsAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const arrowClass = cn(
  "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full border border-white/12 px-4",
  "text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-orchid",
  "transition-colors duration-300 hover:border-gold/45 hover:text-white",
  "disabled:pointer-events-none disabled:opacity-40",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
);
