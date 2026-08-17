import { useState } from "react";
import { Loader2 } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import { coachingApi, type CoachingSessionDetail } from "@/lib/coachingApi";
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
 */
export function RescheduleDialog({
  open,
  onOpenChange,
  session,
  timezone,
  onTimezoneChange,
  deviceTimezone,
  viewingAsAdmin,
  onRescheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: CoachingSessionDetail;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  deviceTimezone?: string;
  viewingAsAdmin: boolean;
  onRescheduled: (session: CoachingSessionDetail) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      const updated = await coachingApi.reschedule(session.id, { startsAt: selected, timezone });
      onRescheduled(updated);
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
        session.scheduledAt
          ? `Currently ${formatFullDateTime(session.scheduledAt, timezone)}.`
          : undefined
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
        </>
      }
    >
      <TimezoneNotice
        timezone={timezone}
        onChange={onTimezoneChange}
        deviceTimezone={deviceTimezone}
      />

      <div className="mt-5">
        <SlotSearch
          sessionId={session.id}
          timezone={timezone}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

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
