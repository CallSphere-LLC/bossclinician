import { useCallback, useEffect, useMemo, useState } from "react";
import { MemberApiError } from "@/lib/memberApi";
import { coachingApi, type AvailabilitySlot } from "@/lib/coachingApi";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { addDays } from "@/components/booking/timezone";

/** Two weeks at a time: the day strip stays scrollable on a phone at this length. */
export const DAYS_PER_WINDOW = 14;

/**
 * The picker plus the fetching behind it, shared by first-time booking and by
 * rescheduling. Which of `creditId` / `sessionId` is set tells the server whose
 * session length to use; everything else about the two flows is identical.
 */
export function SlotSearch({
  creditId,
  sessionId,
  timezone,
  selected,
  onSelect,
}: {
  creditId?: number;
  sessionId?: number;
  timezone: string;
  selected: string | null;
  onSelect: (startsAt: string) => void;
}) {
  // Fixed at mount so the window does not creep while the member is deciding,
  // which would otherwise reshuffle the day strip under their thumb.
  const [anchor] = useState(() => new Date());
  const [offsetDays, setOffsetDays] = useState(0);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
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
        const window = await coachingApi.availability({
          creditId,
          sessionId,
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
  }, [creditId, sessionId, anchor, offsetDays, rangeStart]);

  const shift = useCallback((days: number) => {
    setOffsetDays((current) => Math.max(0, current + days));
  }, []);

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
    />
  );
}
