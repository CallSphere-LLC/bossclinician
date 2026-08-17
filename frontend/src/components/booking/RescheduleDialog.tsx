import { useState } from "react";
import { Loader2 } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import { coachingApi, type CoachingPolicy, type CoachingSession } from "@/lib/coachingApi";
import { LuxeDialog } from "@/components/booking/LuxeDialog";
import { SlotSearch } from "@/components/booking/SlotSearch";
import { TimezoneNotice } from "@/components/booking/TimezoneNotice";
import { formatFullDateTime, formatListDateTime } from "@/components/booking/timezone";

/**
 * Moving a booked call.
 *
 * The same picker and the same timezone banner as first-time booking, because
 * the mistake being guarded against is identical: nobody should move a call to
 * 6am because the screen quietly changed which clock it was drawing.
 *
 * The call keeps its id, its credit and its meeting room — only the time moves —
 * so nothing here spends or returns a session.
 */
export function RescheduleDialog({
  open,
  onOpenChange,
  session,
  policy,
  timezone,
  onTimezoneChange,
  deviceTimezone,
  viewingAsAdmin,
  onRescheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: CoachingSession;
  policy: CoachingPolicy;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  deviceTimezone?: string;
  viewingAsAdmin: boolean;
  onRescheduled: (session: CoachingSession) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await coachingApi.reschedule(session.id, { startsAt: selected, timezone });
      onRescheduled(result.session);
      onOpenChange(false);
      setSelected(null);
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not move that call just now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LuxeDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Move this call"
      description={
        session.startsAt ? `Currently ${formatFullDateTime(session.startsAt, timezone)}.` : undefined
      }
      footer={
        <>
          <LuxeButton
            type="button"
            variant="glass"
            size="sm"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Leave it as it is
          </LuxeButton>
          {session.offerSlug !== null && (
            <LuxeButton
              type="button"
              variant="foil"
              size="sm"
              disabled={!selected || submitting || viewingAsAdmin}
              onClick={() => void submit()}
            >
              {submitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {submitting
                ? "Moving"
                : selected
                  ? `Move to ${formatListDateTime(selected, timezone)}`
                  : "Pick a new time"}
            </LuxeButton>
          )}
        </>
      }
    >
      {session.offerSlug === null ? (
        // The package behind this call is no longer on sale, so there is no
        // calendar to draw. Saying so beats an empty grid that looks broken.
        <p className="copy-luxe text-sm">
          This call was booked against a package we no longer run, so it cannot be moved from here.
          Email us and we will find you another time.
        </p>
      ) : (
        <>
          <TimezoneNotice
            timezone={timezone}
            onChange={onTimezoneChange}
            deviceTimezone={deviceTimezone}
          />

          <div className="mt-5">
            <SlotSearch
              offerSlug={session.offerSlug}
              timezone={timezone}
              horizonDays={policy.bookingHorizonDays}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        </>
      )}

      <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {viewingAsAdmin && (
          <p className="text-sm font-medium text-amber-300">
            You are viewing this account as an administrator, so you cannot move their call.
          </p>
        )}
      </div>
    </LuxeDialog>
  );
}
