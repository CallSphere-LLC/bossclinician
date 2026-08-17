import { useCallback, useEffect, useMemo, useState } from "react";
import { MemberApiError } from "@/lib/memberApi";
import { coachingApi, type CoachingSlot } from "@/lib/coachingApi";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { addDays } from "@/components/booking/timezone";

/** Two weeks at a time: the day strip stays scrollable on a phone at this length. */
export const DAYS_PER_WINDOW = 14;

/**
 * The picker plus the fetching behind it, shared by first-time booking and by
 * rescheduling. Both spend the same offer, so both ask the same endpoint; the
 * only difference is what happens to the answer.
 *
 * The calendar the server will re-check at booking time is the one it draws
 * here, so nothing about which slots exist is decided in the browser.
 */
export function SlotSearch({
  offerSlug,
  timezone,
  horizonDays,
  selected,
  onSelect,
}: {
  offerSlug: string;
  timezone: string;
  /** How far ahead the calendar is open at all; paging stops there. */
  horizonDays: number;
  selected: string | null;
  onSelect: (startsAt: string) => void;
}) {
  // Fixed at mount so the window does not creep while the member is deciding,
  // which would otherwise reshuffle the day strip under their thumb.
  const [anchor] = useState(() => new Date());
  const [offsetDays, setOffsetDays] = useState(0);
  const [slots, setSlots] = useState<CoachingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const rangeStart = useMemo(() => addDays(anchor, offsetDays), [anchor, offsetDays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // The first window starts now rather than at midnight: a time that has
    // already passed today is not an option.
    const from = offsetDays === 0 ? anchor : rangeStart;
    const to = addDays(rangeStart, DAYS_PER_WINDOW);

    (async () => {
      try {
        const window = await coachingApi.slots(offerSlug, {
          from: from.toISOString(),
          to: to.toISOString(),
        });
        if (cancelled) return;
        setSlots(window.slots);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setSlots([]);
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load the calendar just now. Please try again.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on `timezone`. The slots are instants; changing the
    // zone re-labels them and must not throw away the one already chosen.
  }, [offerSlug, anchor, offsetDays, rangeStart]);

  const shift = useCallback((days: number) => {
    setOffsetDays((current) => Math.max(0, current + days));
  }, []);

  // The server clamps anything past the horizon back to an empty range, so
  // paging further would answer "nothing open" for a reason that has nothing to
  // do with how busy the coach is.
  const canGoForward = offsetDays + DAYS_PER_WINDOW < Math.max(horizonDays, DAYS_PER_WINDOW);

  return (
    <SlotPicker
      slots={slots}
      timezone={timezone}
      loading={loading}
      error={error}
      selected={selected}
      onSelect={onSelect}
      rangeStart={rangeStart}
      daysShown={DAYS_PER_WINDOW}
      onShiftRange={shift}
      canGoBack={offsetDays > 0}
      canGoForward={canGoForward}
    />
  );
}
