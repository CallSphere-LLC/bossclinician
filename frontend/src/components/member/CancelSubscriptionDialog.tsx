import { useState, type FormEvent } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { Loader2, PauseCircle, X } from "lucide-react";
import { toast } from "sonner";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeTextarea } from "@/components/luxe/LuxeField";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import {
  billingApi,
  billingErrorMessage,
  describeRecurringPrice,
  type CancelReasonOption,
  type MemberSubscription,
} from "@/lib/billingApi";

/**
 * Cancellation, asked honestly.
 *
 * Two things this dialog refuses to do. It does not bury what cancelling
 * actually means — access runs to the date already paid for and then stops, and
 * that sentence is in the first paragraph rather than a footnote. And it does
 * not hide the pause option behind the cancel confirmation, because a slow
 * month is the most common reason someone lands here and pausing is usually
 * what they actually wanted; making them cancel to discover that costs them
 * their place and costs the business the plan.
 *
 * The reason is required because it is the only structured record of why people
 * leave. The free-text box beside it is optional except under "something else",
 * where it is the whole answer — a required essay everywhere else just teaches
 * people to type "n/a".
 */

/** The one option whose free text the server insists on. */
const REASON_NEEDING_DETAIL = "other";

interface CancelSubscriptionDialogProps {
  subscription: MemberSubscription;
  /** Served with the subscriptions, so the form offers what the server accepts. */
  reasons: CancelReasonOption[];
  /** Called with the server's updated plan after either cancelling or pausing. */
  onUpdated: (next: MemberSubscription) => void;
  onClose: () => void;
}

export function CancelSubscriptionDialog({
  subscription,
  reasons,
  onUpdated,
  onClose,
}: CancelSubscriptionDialogProps) {
  const reduceMotion = useReducedMotion();
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState<"cancel" | "pause" | null>(null);

  const price = describeRecurringPrice(
    subscription.amountCents,
    subscription.currency,
    subscription.interval,
    subscription.intervalCount,
  );

  const paidUntil = subscription.currentPeriodEnd
    ? formatDate(subscription.currentPeriodEnd)
    : null;

  // Nothing to pause on a plan that is already paused or already ending.
  const canPause = !subscription.paused && !subscription.cancelAtPeriodEnd;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    if (!reason) {
      setReasonError("Please pick one so we know what to put right.");
      return;
    }
    setReasonError("");

    const trimmed = feedback.trim();
    if (reason === REASON_NEEDING_DETAIL && trimmed === "") {
      setFeedbackError("Please tell us a little about why you are cancelling.");
      return;
    }
    setFeedbackError("");

    setBusy("cancel");
    try {
      const next = await billingApi.cancelSubscription(subscription.id, {
        reason,
        ...(trimmed ? { feedback: trimmed } : {}),
      });
      onUpdated(next);
      toast.success(
        paidUntil
          ? `Cancelled. You keep everything until ${paidUntil}.`
          : "Cancelled. You will not be charged again.",
      );
      onClose();
    } catch (err) {
      setFormError(
        billingErrorMessage(err, "We could not cancel it just now. Please try again in a moment."),
      );
    } finally {
      setBusy(null);
    }
  };

  const pause = async () => {
    setFormError("");
    setBusy("pause");
    try {
      const next = await billingApi.pauseSubscription(subscription.id);
      onUpdated(next);
      toast.success("Paused. Nothing more will be charged until you start it again.");
      onClose();
    } catch (err) {
      setFormError(
        billingErrorMessage(err, "We could not pause it just now. Please try again in a moment."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        // Esc, the overlay and the close button all mean "keep my plan".
        if (!open && busy === null) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-night-deep/80 backdrop-blur-sm" />

        <RadixDialog.Content asChild>
          {/* The portal escapes `.theme-luxe`, so this panel names its own dark
              colours rather than the themeable surface tokens, which would
              resolve to the light palette out here. */}
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={cn(
              "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-xl",
              "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl",
              "border border-white/10 bg-night-raised shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)]",
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-7">
              <div className="min-w-0">
                <RadixDialog.Title className="font-display text-xl text-white">
                  Cancel {subscription.planName}?
                </RadixDialog.Title>
                <RadixDialog.Description className="mt-1.5 text-sm text-orchid-dim">
                  {price}
                </RadixDialog.Description>
              </div>
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close and keep my plan"
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-full text-white/50",
                    "transition-colors duration-300 hover:bg-white/[0.07] hover:text-white",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  )}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </RadixDialog.Close>
            </div>

            <form
              onSubmit={(event) => void onSubmit(event)}
              noValidate
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                <p className="copy-luxe text-sm">
                  {paidUntil ? (
                    <>
                      You have already paid up to <strong className="text-white">{paidUntil}</strong>
                      . Everything stays open until that date — then it closes, and you will not be
                      charged again.
                    </>
                  ) : (
                    <>
                      You will not be charged again. Everything stays open for the time you have
                      already paid for, and closes at the end of it.
                    </>
                  )}
                </p>
                <p className="copy-luxe mt-2.5 text-sm">
                  Anything you bought outright is untouched — this only ends the recurring part.
                </p>

                {canPause && (
                  <div className="mt-6 rounded-2xl border border-gold/25 bg-gold/[0.06] p-4 sm:p-5">
                    <div className="flex items-start gap-3.5">
                      <PauseCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
                      <div className="min-w-0">
                        <h3 className="font-display text-base text-white">
                          Only need a break? Pause instead.
                        </h3>
                        <p className="copy-luxe mt-1.5 text-sm">
                          Pausing stops the payments and holds your place. Nothing is charged while
                          you are paused, you are not billed for the gap afterwards, and you can
                          start again whenever you are ready.
                        </p>
                        <LuxeButton
                          type="button"
                          variant="glass"
                          size="sm"
                          className="mt-4"
                          disabled={busy !== null}
                          onClick={() => void pause()}
                        >
                          {busy === "pause" && (
                            <Loader2 aria-hidden className="size-4 animate-spin" />
                          )}
                          {busy === "pause" ? "Pausing" : "Pause my plan instead"}
                        </LuxeButton>
                      </div>
                    </div>
                  </div>
                )}

                <fieldset className="mt-7">
                  <legend className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-orchid">
                    Why are you cancelling?{" "}
                    <span aria-hidden className="text-gold">
                      *
                    </span>
                    <span className="sr-only">(required)</span>
                  </legend>

                  <div className="mt-3.5 grid gap-2">
                    {reasons.map((option) => {
                      const selected = reason === option.value;
                      return (
                        <label
                          key={option.value}
                          className={cn(
                            "flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3",
                            "text-sm transition-colors duration-300",
                            selected
                              ? "border-gold/50 bg-gold/[0.08] text-white"
                              : "border-white/10 bg-white/[0.03] text-orchid hover:border-white/25 hover:text-white",
                          )}
                        >
                          <input
                            type="radio"
                            name="cancelReason"
                            value={option.value}
                            checked={selected}
                            onChange={() => {
                              setReason(option.value);
                              setReasonError("");
                              setFeedbackError("");
                            }}
                            className="size-4 shrink-0 accent-gold"
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>

                  <div aria-live="polite" className="min-h-[1.25rem]">
                    {reasonError && (
                      <p role="alert" className="mt-2 text-xs font-medium text-red-400">
                        {reasonError}
                      </p>
                    )}
                  </div>
                </fieldset>

                <div className="mt-4">
                  <LuxeTextarea
                    label={
                      reason === REASON_NEEDING_DETAIL
                        ? "What made you decide to cancel?"
                        : "Anything else you would like Yvette to know?"
                    }
                    name="cancelFeedback"
                    rows={3}
                    value={feedback}
                    required={reason === REASON_NEEDING_DETAIL}
                    error={feedbackError}
                    hint={
                      reason === REASON_NEEDING_DETAIL
                        ? "A sentence is plenty."
                        : "Optional — but it is read, and it is how things get better."
                    }
                    maxLength={2000}
                    onChange={(event) => {
                      setFeedback(event.target.value);
                      setFeedbackError("");
                    }}
                  />
                </div>
              </div>

              <div className="border-t border-white/[0.07] px-5 py-4 sm:px-7">
                <div aria-live="polite" className="min-h-[1.25rem]">
                  {formError && (
                    <p role="alert" className="mb-3 text-sm font-medium text-red-400">
                      {formError}
                    </p>
                  )}
                </div>

                {/* Confirm sits second and quieter: plainly available, but the
                    emphasis belongs on the choice that keeps someone's access. */}
                <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
                  <LuxeButton
                    type="button"
                    variant="foil"
                    size="sm"
                    disabled={busy !== null}
                    onClick={onClose}
                  >
                    Keep my plan
                  </LuxeButton>
                  <LuxeButton type="submit" variant="outline" size="sm" disabled={busy !== null}>
                    {busy === "cancel" && <Loader2 aria-hidden className="size-4 animate-spin" />}
                    {busy === "cancel" ? "Cancelling" : "Cancel my plan"}
                  </LuxeButton>
                </div>
              </div>
            </form>
          </motion.div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
