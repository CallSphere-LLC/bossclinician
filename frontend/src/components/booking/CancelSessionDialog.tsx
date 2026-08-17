import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeTextarea } from "@/components/luxe/LuxeField";
import { MemberApiError } from "@/lib/memberApi";
import {
  coachingApi,
  type CancelResult,
  type CoachingPolicy,
  type CoachingSession,
} from "@/lib/coachingApi";
import { cn } from "@/lib/cn";
import { LuxeDialog } from "@/components/booking/LuxeDialog";
import { creditReturnSentence, hoursInWords } from "@/components/booking/policyText";
import { formatFullDateTime } from "@/components/booking/timezone";

/**
 * Cancelling a call, with the consequence stated before the button is pressed.
 *
 * The one thing this dialog must not do is be coy about the credit. "Are you
 * sure?" is not a question anybody can answer — whether the session comes back
 * or is spent is the only fact that decides it, so it is the largest thing in
 * the box and it comes from the server's own reckoning rather than a sum done
 * here that could disagree.
 */
export function CancelSessionDialog({
  open,
  onOpenChange,
  session,
  policy,
  timezone,
  viewingAsAdmin,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: CoachingSession;
  policy: CoachingPolicy;
  timezone: string;
  viewingAsAdmin: boolean;
  onCancelled: (result: CancelResult) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const returns = session.cancelRefundsCredit;

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const result = await coachingApi.cancel(session.id, { reason: reason.trim() });
      onCancelled(result);
      onOpenChange(false);
      setReason("");
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not cancel that just now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LuxeDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel this call?"
      description={session.startsAt ? formatFullDateTime(session.startsAt, timezone) : undefined}
      footer={
        <>
          <LuxeButton
            type="button"
            variant="glass"
            size="sm"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Keep this call
          </LuxeButton>
          <LuxeButton
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting || viewingAsAdmin}
            onClick={() => void submit()}
            className="border-red-400/50 text-red-200 hover:border-red-400 hover:bg-red-500/[0.12] hover:text-white"
          >
            {submitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {submitting ? "Cancelling" : "Yes, cancel it"}
          </LuxeButton>
        </>
      }
    >
      <div
        className={cn(
          "flex gap-4 rounded-2xl border p-4",
          returns
            ? "border-green-bright/30 bg-green-bright/[0.08]"
            : "border-amber-400/35 bg-amber-400/[0.08]",
        )}
      >
        <span aria-hidden className="mt-0.5 shrink-0">
          {returns ? (
            <RotateCcw className="size-5 text-green-bright" />
          ) : (
            <AlertTriangle className="size-5 text-amber-300" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-white">
            {returns
              ? "This session goes back on your package."
              : "This session will count as used."}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-orchid">
            {returns
              ? `You are cancelling more than ${hoursInWords(policy.cancellationWindowHours)} ahead, so you can book it again whenever suits you.`
              : `The call starts inside ${hoursInWords(policy.cancellationWindowHours)}, which is too late for the session to return to your package.`}
          </p>
        </div>
      </div>

      <p className="copy-luxe mt-4 text-sm">{creditReturnSentence(policy)}</p>

      <div className="mt-5">
        <LuxeTextarea
          label="Anything you want Yvette to know? (optional)"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
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
            You are viewing this account as an administrator, so you cannot cancel their call.
          </p>
        )}
      </div>
    </LuxeDialog>
  );
}
