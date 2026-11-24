import { forwardRef, useCallback, useEffect, useId, useMemo, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, Mail } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  retreatBalancePlansAdminApi,
  type AdminBalancePlan,
  type BalancePlanEmailPreview,
  type BalancePlanScheduleRow,
  type BalancePlanState,
} from "@/lib/retreatBalancePlansAdminApi";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { Badge, Button, ErrorNotice, Field, Input, Skeleton, type BadgeProps } from "@/pages/admin/ui/primitives";
import {
  centsToDollarInput,
  checkBalancePlan,
  fitToDeadline,
  formFromPlan,
  formatLongDate,
  formatMoney,
  isEditableState,
  isSteppedPlan,
  paidProgress,
  parseDollarsToCents,
  planChip,
  planSentence,
  sameForm,
  todayInPacific,
  type BalancePlanField,
  type BalancePlanForm,
  type DeadlineFit,
} from "./retreatBalancePlanRules";

/**
 * Payment plans on the retreat Guests screen: the status chip in each guest's
 * row and the editor the owner opens from it.
 *
 * A plan is the balance a guest still owes, split into monthly payments
 * (all equal, or with the last few larger so it is paid off by a deadline)
 * charged automatically to a card the guest adds herself. The owner sets the
 * numbers here; the guest sees nothing until the plan is opened for her, and
 * nothing is charged until she adds a card and agrees to the schedule.
 * Once a card is on file the numbers are locked (the server refuses changes).
 * A cancelled plan is editable again: saving it returns it to draft, which is
 * how a new plan is set up for the same guest.
 */

const numberStyles = "font-sans font-bold tabular-nums";
const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "");

/* ───────────────────────────── loading the plans ───────────────────────── */

/** One request for the whole retreat, indexed by member. `null` until the first answer. */
export function useBalancePlans(retreatId: number) {
  const [byMember, setByMember] = useState<Map<number, AdminBalancePlan> | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const plans = await retreatBalancePlansAdminApi.list(retreatId);
      setByMember(new Map(plans.map((plan) => [plan.memberId, plan])));
      setError("");
    } catch (e) {
      setError(errorText(e, "Could not load the payment plans."));
    }
  }, [retreatId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { byMember, error, reload };
}

/* ───────────────────────────────── the chip ────────────────────────────── */

/** The compact status in a guest's row. Not a button: the button sits beside it. */
export function BalancePlanBadge({ plan, loading = false }: { plan: AdminBalancePlan | null | undefined; loading?: boolean }) {
  if (loading) return <span className="text-xs text-ink-soft">Checking payment plan…</span>;
  const chip = planChip(plan);
  return (
    <Badge tone={chip.tone} className="tabular-nums" title={`Payment plan: ${chip.label}`}>
      <span className="sr-only">Payment plan: </span>
      {chip.label}
    </Badge>
  );
}

/* ──────────────────────────────── the editor ───────────────────────────── */

const STATE_NOTE: Record<BalancePlanState | "none", string> = {
  none: "No payment plan yet. Fill in the numbers and save. The guest sees nothing until you open the plan for her.",
  draft: "Draft. Only you can see this. The guest sees nothing until you open the plan for her.",
  open: "Open for the guest. Her dashboard shows the balance, the payment dates and a form to add her card. Nothing is charged until she adds a card and agrees to the schedule.",
  card_on_file: "The guest has added her card and agreed to the schedule. The first payment will be charged automatically on the first charge date.",
  billing: "Automatic monthly charges are running on the guest's card.",
  past_due: "A payment did not go through. The guest can replace her card from her Billing page. If the payment keeps failing, the plan reopens so she can add a card again.",
  completed: "Paid in full. Every payment on this plan has been collected and the automatic charges have stopped.",
  canceled:
    "This plan was cancelled. No more automatic charges will be made. Payments already collected were not refunded. " +
    "To set up a new plan for this guest, check the numbers below and press Save. It becomes a draft, and she sees nothing until you open it for her.",
};

const SCHEDULE_MARK: Record<BalancePlanScheduleRow["status"], { label: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  paid: { label: "Paid", tone: "green" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
  skipped: { label: "Skipped", tone: "slate" },
};

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function cardLabel(plan: AdminBalancePlan): string {
  if (!plan.cardLast4) return "";
  const brand = (plan.cardBrand ?? "").toLowerCase();
  const name = CARD_BRANDS[brand] ?? (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card");
  return `${name} ending in ${plan.cardLast4}`;
}

type Busy = "save" | "open" | "close" | "cancel" | "preview" | "send" | null;

export function RetreatBalancePlanModal({
  retreatId,
  guest,
  plan,
  onChanged,
  onClose,
}: {
  retreatId: number;
  guest: { memberId: number; name: string; email: string };
  /** The saved plan, straight from the list. Null when this guest has none yet. */
  plan: AdminBalancePlan | null;
  /** Reloads the list; the fresh plan then arrives through `plan`. */
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const who = guest.name || guest.email;
  const state: BalancePlanState | null = plan?.state ?? null;
  const editable = isEditableState(state);
  const currency = plan?.currency || "usd";

  const [form, setForm] = useState<BalancePlanForm>(() => formFromPlan(plan));
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState<BalancePlanEmailPreview | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const saved = useMemo(() => formFromPlan(plan), [plan]);
  // After an action the list is reloaded. When the SAVED numbers or the state
  // really changed, show them and drop an email preview built from the old
  // ones. A reload that changed nothing (for example after a refused save)
  // must leave what the owner has typed alone.
  const savedKey = `${state ?? "none"}|${JSON.stringify(saved)}`;
  useEffect(() => {
    setForm(formFromPlan(plan));
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the saved content, not the object
  }, [savedKey]);
  const dirty = editable && !sameForm(form, saved);
  const today = todayInPacific();
  const check = useMemo(
    () => checkBalancePlan(form, { paidHereCents: plan?.paidHereCents ?? 0, today, currency }),
    [form, plan?.paidHereCents, today, currency],
  );
  /** What "Fit to the deadline" would set, worked out from the same balance and dates the check uses. */
  const fit = useMemo(
    () =>
      fitToDeadline({
        balanceCents: check.balanceCents,
        installmentCents: check.installmentCents,
        firstChargeOn: form.firstChargeOn,
        finalDueOn: form.finalDueOn,
        today,
      }),
    [check.balanceCents, check.installmentCents, form.firstChargeOn, form.finalDueOn, today],
  );
  /** True when the boxes already hold exactly what "Fit to the deadline" would set. */
  const fitApplied =
    fit !== null &&
    ((fit.kind === "even" && !check.stepUp && check.installmentCount === fit.count) ||
      (fit.kind === "stepped" &&
        check.stepUp &&
        check.installmentCount === fit.count &&
        check.stepUpCount === fit.stepUpCount &&
        check.stepUpCents === fit.stepUpCents));
  const canFit = fit !== null && (fit.kind === "even" || fit.kind === "stepped") && !fitApplied;
  const stepUpHintId = useId();
  const stepUpFieldsId = useId();

  const set = <K extends keyof BalancePlanForm>(key: K, value: BalancePlanForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setActionError("");
  };
  /** Fills the number of payments and the larger last payments so the plan is paid off by the deadline. */
  const applyFit = () => {
    if (!fit || (fit.kind !== "even" && fit.kind !== "stepped")) return;
    const stepped = fit.kind === "stepped" ? fit : null;
    setForm((current) => ({
      ...current,
      installmentCount: String(fit.count),
      stepUp: stepped !== null,
      stepUpAmount: stepped ? centsToDollarInput(stepped.stepUpCents) : current.stepUpAmount,
      stepUpCount: stepped ? String(stepped.stepUpCount) : current.stepUpCount,
    }));
    setActionError("");
  };
  /** Leaving a dollar box tidies what was typed: "1500" becomes "1,500.00". */
  const tidyMoney = (key: "agreedTotal" | "discount" | "priorPaid" | "installment" | "stepUpAmount") => {
    const cents = parseDollarsToCents(form[key]);
    if (cents !== null) setForm((current) => ({ ...current, [key]: centsToDollarInput(cents) }));
  };
  const fieldError = (key: BalancePlanField) => check.fieldErrors[key];
  const working = busy !== null;
  /**
   * True when there is something for Save to do: a new plan, changed numbers,
   * or a cancelled plan (saving it, even unchanged, returns it to draft). Also
   * when "Open for guest" has to save what is typed before it opens the plan.
   */
  const needsSave = !plan || dirty || state === "canceled";
  /** Reasons the server gave, with the preview, for not sending the card request email yet. */
  const emailBlockers = preview?.blockers ?? [];

  /** Runs one server action, reloads the list, and puts a failure in the panel. */
  async function run(kind: Exclude<Busy, null>, action: () => Promise<unknown>, done: string, fallback: string): Promise<boolean> {
    setBusy(kind);
    setActionError("");
    try {
      await action();
      await onChanged();
      toast.success(done);
      return true;
    } catch (e) {
      setActionError(errorText(e, fallback));
      // The plan may have moved on (for example the guest just added her card).
      void onChanged();
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const input = check.input;
    if (!check.valid || !input) return;
    await run("save", () => retreatBalancePlansAdminApi.save(retreatId, guest.memberId, input), "Payment plan saved", "Could not save the payment plan.");
  }

  async function openForGuest() {
    // Unsaved numbers are saved first, so the guest can only ever see what is on this screen.
    const toSave = needsSave ? check.input : null;
    if (needsSave && (!check.valid || !toSave)) return;
    const count = toSave ? toSave.installmentCount : (plan?.installmentCount ?? 0);
    const amount = toSave ? toSave.installmentCents : (plan?.installmentCents ?? 0);
    const largerAmount = toSave ? toSave.stepUpCents : (plan?.stepUpCents ?? 0);
    const largerCount = toSave ? toSave.stepUpCount : (plan?.stepUpCount ?? 0);
    const ok = await confirm({
      title: `Open this payment plan for ${who}?`,
      description:
        `She will see the plan of ${planSentence(count, amount, currency, largerAmount, largerCount)} and a form to add her card on her retreat dashboard. ` +
        "Nothing is charged until she adds a card and agrees to the schedule. No email is sent by this step.",
      confirmLabel: "Open for guest",
    });
    if (!ok) return;
    await run(
      "open",
      async () => {
        if (toSave) await retreatBalancePlansAdminApi.save(retreatId, guest.memberId, toSave);
        await retreatBalancePlansAdminApi.open(retreatId, guest.memberId);
      },
      "Payment plan opened for the guest",
      "Could not open the payment plan.",
    );
  }

  async function hideFromGuest() {
    await run("close", () => retreatBalancePlansAdminApi.close(retreatId, guest.memberId), "Payment plan hidden from the guest", "Could not hide the payment plan.");
  }

  async function loadPreview() {
    if (preview) {
      setPreview(null);
      return;
    }
    setBusy("preview");
    setActionError("");
    try {
      setPreview(await retreatBalancePlansAdminApi.requestEmailPreview(retreatId, guest.memberId));
    } catch (e) {
      setActionError(errorText(e, "Could not load the email preview."));
    } finally {
      setBusy(null);
    }
  }

  async function sendEmail() {
    // The server says where the email goes and whether anything stops it. When
    // the preview is not open, ask first, so the address in the question below
    // is the real one and a blocked send is explained instead of attempted.
    let current = preview;
    if (!current) {
      setBusy("send");
      setActionError("");
      try {
        current = await retreatBalancePlansAdminApi.requestEmailPreview(retreatId, guest.memberId);
      } catch (e) {
        setActionError(errorText(e, "Could not check the email before sending. Nothing was sent."));
        return;
      } finally {
        setBusy(null);
      }
    }
    if (!current) return;
    if (current.blockers.length > 0) {
      // Opens the preview, which lists the reasons and keeps Send switched off.
      setPreview(current);
      return;
    }
    const to = current.to || guest.email;
    const lastSent = plan?.requestEmailSentAt ? `It was last sent on ${dateTime(plan.requestEmailSentAt)}.` : "It has not been sent to her before.";
    const ok = await confirm({
      title: `Send the card request email to ${who}?`,
      description: `It goes to ${to} and asks her to sign in to her retreat dashboard and add a card for her payment plan. ${lastSent} Nothing is charged until she adds a card and agrees to the schedule.`,
      confirmLabel: plan?.requestEmailSentAt ? "Send it again" : "Send the email",
    });
    if (!ok) return;
    await run("send", () => retreatBalancePlansAdminApi.sendRequestEmail(retreatId, guest.memberId), "Card request email sent", "Could not send the email.");
  }

  async function cancelPlan() {
    const charging = state === "billing" || state === "past_due";
    const ok = await confirm({
      title: `Cancel ${who}'s payment plan?`,
      description:
        (charging
          ? "This stops all future automatic charges on her card. "
          : "Her card will not be charged, and the plan is removed from her dashboard. ") +
        "It does not refund anything already paid, and it does not change what she owes for the retreat. " +
        "You can set up a new plan for this guest afterwards.",
      confirmLabel: "Yes, cancel the plan",
      destructive: true,
    });
    if (!ok) return;
    await run("cancel", () => retreatBalancePlansAdminApi.cancel(retreatId, guest.memberId), "Payment plan cancelled", "Could not cancel the payment plan.");
  }

  const chip = planChip(plan);
  const canCancel = state === "card_on_file" || state === "billing" || state === "past_due";

  const footer = (
    <>
      <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      {state === "open" && (
        <Button variant="secondary" size="sm" disabled={working || dirty} onClick={() => void hideFromGuest()}>
          <EyeOff aria-hidden /> Hide from guest
        </Button>
      )}
      {canCancel && (
        <Button variant="dangerGhost" size="sm" disabled={working} onClick={() => void cancelPlan()}>Cancel plan</Button>
      )}
      {editable && (
        <Button
          variant={state === "open" || !plan ? "primary" : "secondary"}
          size="sm"
          disabled={working || !check.valid || !needsSave}
          onClick={() => void save()}
        >
          {busy === "save" ? "Saving…" : !needsSave ? "Saved" : state === "canceled" ? "Save as a new draft" : "Save"}
        </Button>
      )}
      {(state === null || state === "draft") && (
        <Button size="sm" variant={plan ? "primary" : "secondary"} disabled={working || (needsSave && !check.valid)} onClick={() => void openForGuest()}>
          <Eye aria-hidden /> {needsSave ? "Save and open for guest" : "Open for guest"}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`Payment plan for ${who}`}
      description={guest.name ? guest.email : undefined}
      size="lg"
      footer={footer}
    >
      {confirmDialog}
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-start gap-3">
          <Badge tone={chip.tone} className="tabular-nums">{chip.label}</Badge>
          {plan?.isTest && <Badge tone="slate">Test guest</Badge>}
          <p className="min-w-[14rem] flex-1 text-xs leading-relaxed text-ink-soft">{STATE_NOTE[state ?? "none"]}</p>
        </div>

        {actionError && <ErrorNotice message={actionError} />}

        {plan && plan.lastError && (state === "open" || state === "draft") && (
          <div className="rounded-xl border border-gold/40 bg-gold/[0.08] p-3 text-xs text-gold">
            <p className="font-semibold">The last card could not be charged</p>
            <p className="mt-1">{plan.lastError}</p>
            <p className="mt-1">The guest needs to add a card again. Payments already collected are kept.</p>
          </div>
        )}

        {editable ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agreed retreat price" hint="After any discount" error={fieldError("agreedTotal")}>
                <MoneyInput value={form.agreedTotal} onChange={(e) => set("agreedTotal", e.target.value)} onBlur={() => tidyMoney("agreedTotal")} />
              </Field>
              <Field label="Paid before" hint="Outside this site, e.g. Kajabi" error={fieldError("priorPaid")}>
                <MoneyInput value={form.priorPaid} onChange={(e) => set("priorPaid", e.target.value)} onBlur={() => tidyMoney("priorPaid")} />
              </Field>
              <Field label="Discount amount" hint="Shown for information" error={fieldError("discount")}>
                <MoneyInput value={form.discount} onChange={(e) => set("discount", e.target.value)} onBlur={() => tidyMoney("discount")} />
              </Field>
              <Field label="Discount reason" hint="Optional">
                <Input value={form.discountNote} maxLength={200} onChange={(e) => set("discountNote", e.target.value)} />
              </Field>
              <p className="-mt-2 text-xs text-ink-soft sm:col-span-2">
                The discount is shown to the guest for information only. It is already taken off the price above, so it is not subtracted again.
              </p>
              <Field label="Monthly payment" error={fieldError("installment")}>
                <MoneyInput value={form.installment} onChange={(e) => set("installment", e.target.value)} onBlur={() => tidyMoney("installment")} />
              </Field>
              <Field label="Number of payments" hint="1 to 36" error={fieldError("installmentCount")}>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className={numberStyles}
                  value={form.installmentCount}
                  onChange={(e) => set("installmentCount", e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={check.suggestedCount === null || check.suggestedCount === check.installmentCount}
                  onClick={() => { if (check.suggestedCount !== null) set("installmentCount", String(check.suggestedCount)); }}
                >
                  Suggest number of payments
                </Button>
                <p className="min-w-[12rem] flex-1 text-xs text-ink-soft" aria-live="polite">
                  {suggestionNote(check, currency)}
                </p>
              </div>
              <div className="space-y-3 sm:col-span-2">
                <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent,#d4af37)]"
                    checked={form.stepUp}
                    aria-describedby={stepUpHintId}
                    aria-controls={form.stepUp ? stepUpFieldsId : undefined}
                    onChange={(e) => set("stepUp", e.target.checked)}
                  />
                  Make the last payments larger
                </label>
                <p id={stepUpHintId} className="-mt-2 text-xs text-ink-soft">
                  Use this when the regular amount will not clear the balance by the deadline. The first payments stay at the monthly amount and the last ones are larger.
                </p>
                {form.stepUp && (
                  <div id={stepUpFieldsId} className="grid gap-4 sm:grid-cols-2">
                    <Field label="Larger payment amount" hint="More than the monthly payment" error={fieldError("stepUpAmount")}>
                      <MoneyInput value={form.stepUpAmount} onChange={(e) => set("stepUpAmount", e.target.value)} onBlur={() => tidyMoney("stepUpAmount")} />
                    </Field>
                    <Field
                      label="How many of the last payments"
                      hint={check.installmentCount !== null && check.installmentCount > 2 ? `1 to ${check.installmentCount - 1}` : undefined}
                      error={fieldError("stepUpCount")}
                    >
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        className={numberStyles}
                        value={form.stepUpCount}
                        onChange={(e) => set("stepUpCount", e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>
              <Field label="First charge date" error={fieldError("firstChargeOn")}>
                <Input type="date" className={numberStyles} value={form.firstChargeOn} onChange={(e) => set("firstChargeOn", e.target.value)} />
              </Field>
              <Field label="Final payment deadline" hint="Optional" error={fieldError("finalDueOn")}>
                <Input type="date" className={numberStyles} value={form.finalDueOn} onChange={(e) => set("finalDueOn", e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button variant="secondary" size="sm" disabled={!canFit} onClick={applyFit}>
                  Fit to the deadline
                </Button>
                <p className="min-w-[12rem] flex-1 text-xs text-ink-soft" aria-live="polite">
                  {fitNote(fit, fitApplied, check, currency)}
                </p>
              </div>
              <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent,#d4af37)]"
                  checked={form.isTest}
                  onChange={(e) => set("isTest", e.target.checked)}
                />
                This is a test guest (do not send owner notices)
              </label>
            </div>

            <section className="rounded-xl border border-hairline bg-white/[0.03] p-4" aria-label="Plan summary">
              <h3 className="font-display text-base text-ink">Summary</h3>
              <dl className="mt-2 grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-soft">Agreed price</dt>
                <dd className={cn(numberStyles, "text-ink")}>{check.agreedTotalCents !== null ? formatMoney(check.agreedTotalCents, currency) : "Not set"}</dd>
                <dt className="text-ink-soft">Paid before</dt>
                <dd className={cn(numberStyles, "text-ink")}>{formatMoney(check.priorPaidCents, currency)}</dd>
                {plan && plan.paidHereCents > 0 && (
                  <>
                    <dt className="text-ink-soft">Paid on this site</dt>
                    <dd className={cn(numberStyles, "text-ink")}>{formatMoney(plan.paidHereCents, currency)}</dd>
                  </>
                )}
                <dt className="text-ink-soft">Balance to collect</dt>
                <dd className={cn(numberStyles, "text-ink")}>{check.balanceCents !== null ? formatMoney(check.balanceCents, currency) : "Not set"}</dd>
                <dt className="text-ink-soft">Plan</dt>
                <dd className={cn(numberStyles, "text-ink")}>
                  {check.installmentCents !== null && check.installmentCount !== null && check.stepUpReady
                    ? planSentence(check.installmentCount, check.installmentCents, currency, check.stepUpCents, check.stepUpCount)
                    : "Not set"}
                </dd>
                <dt className="text-ink-soft">Last payment</dt>
                <dd className={cn(numberStyles, "text-ink")}>{check.lastPaymentDate ? formatLongDate(check.lastPaymentDate) : "Not set"}</dd>
              </dl>

              {check.problems.length > 0 && (
                <div role="alert" className="mt-3 space-y-1.5 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-xs font-medium text-red-200">
                  {check.problems.map((problem) => <p key={problem}>{problem}</p>)}
                </div>
              )}
              {check.problems.length === 0 && check.missing.length > 0 && (
                <p className="mt-3 text-xs text-ink-soft">Still needed before you can save: {check.missing.join(", ")}.</p>
              )}
              {check.warnings.map((warning) => (
                <p key={warning} className="mt-3 text-xs font-semibold text-gold">{warning}</p>
              ))}

              {check.schedule.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink">{check.startsLate ? "Payment dates (earliest possible, if she adds her card today)" : "Payment dates"}</p>
                  <ScheduleList rows={check.schedule.map((row) => ({ ...row, mark: null }))} currency={currency} />
                  {check.deadlineIsClose && check.firstPaymentDate && (
                    <p className="mt-2 text-xs text-ink-soft">
                      If she adds her card after <span className={numberStyles}>{formatLongDate(check.firstPaymentDate)}</span>, every payment moves later by the same number of days.
                    </p>
                  )}
                </div>
              )}
            </section>

            {state === "open" && plan && (
              <section className="rounded-xl border border-hairline p-4" aria-label="Card request email">
                <h3 className="font-display text-base text-ink">Card request email</h3>
                <p className="mt-1 text-xs text-ink-soft">
                  Asks the guest to sign in and add her card. It is sent only when you press Send.{" "}
                  {plan.requestEmailSentAt ? (
                    <>Last sent <span className={numberStyles}>{dateTime(plan.requestEmailSentAt)}</span>.</>
                  ) : (
                    "Not sent yet."
                  )}
                </p>
                {dirty && <p className="mt-2 text-xs font-semibold text-gold">Save your changes first, so the email shows the new numbers.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={working || dirty} aria-expanded={preview !== null} onClick={() => void loadPreview()}>
                    <Eye aria-hidden /> {busy === "preview" ? "Loading…" : preview ? "Hide preview" : "Preview email"}
                  </Button>
                  <Button size="sm" disabled={working || dirty || emailBlockers.length > 0} onClick={() => void sendEmail()}>
                    <Mail aria-hidden /> {busy === "send" ? "Sending…" : plan.requestEmailSentAt ? "Send card request email again" : "Send card request email"}
                  </Button>
                </div>
                {busy === "preview" && <Skeleton className="mt-3 h-40" />}
                {preview && (
                  <div className="mt-3 space-y-2">
                    {emailBlockers.length > 0 && (
                      <div role="alert" className="space-y-1.5 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-xs font-medium text-red-200">
                        <p className="font-semibold">This email cannot be sent yet:</p>
                        <ul className="list-disc space-y-1 pl-4">
                          {emailBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                        </ul>
                        <p>Once these are sorted out, close this preview and open it again to check.</p>
                      </div>
                    )}
                    <dl className="grid grid-cols-[6rem_1fr] gap-1 text-xs">
                      <dt className="text-ink-soft">To:</dt><dd className="break-words text-ink">{preview.to || "No email address on her account"}</dd>
                      {preview.replyTo && (
                        <>
                          <dt className="text-ink-soft">Replies go to:</dt><dd className="break-words text-ink">{preview.replyTo}</dd>
                        </>
                      )}
                      <dt className="text-ink-soft">Subject:</dt><dd className="break-words text-ink">{preview.subject}</dd>
                    </dl>
                    <EmailFrame html={preview.html} text={preview.text} title={`Card request email to ${who}`} />
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          plan && <LockedPlan plan={plan} state={state} />
        )}
      </div>
    </Modal>
  );
}

/* ─────────────────────────────── small pieces ──────────────────────────── */

function suggestionNote(check: ReturnType<typeof checkBalancePlan>, currency: string): string {
  if (check.balanceCents === null || check.balanceCents <= 0 || check.installmentCents === null) {
    return "Enter the price and the monthly payment, and this works out how many payments clear the balance.";
  }
  if (check.stepUp) {
    // Same equation as Save: regular x (count - N) + larger x N.
    if (check.suggestedCount === null) {
      return "With the larger last payments as entered, no number of payments (up to 36) clears the balance exactly. Change an amount, or use Fit to the deadline.";
    }
    if (check.suggestedCount === check.installmentCount && check.stepUpReady) return "The number of payments clears the balance exactly.";
    return `${planSentence(check.suggestedCount, check.installmentCents, currency, check.typedStepUpCents ?? 0, check.typedStepUpCount ?? 0)} clears the balance exactly.`;
  }
  if (check.suggestedCount === null) {
    return `${formatMoney(check.balanceCents, currency)} does not divide evenly into payments of ${formatMoney(check.installmentCents, currency)} (within 36 payments). Try a different monthly payment, or make the last payments larger.`;
  }
  if (check.suggestedCount === check.installmentCount) return "The number of payments clears the balance exactly.";
  return `${planSentence(check.suggestedCount, check.installmentCents, currency)} clears the balance exactly.`;
}

/** What "Fit to the deadline" would do, in a sentence, before and after it is pressed. */
function fitNote(fit: DeadlineFit | null, applied: boolean, check: ReturnType<typeof checkBalancePlan>, currency: string): string {
  if (fit === null || check.installmentCents === null) {
    return "Enter the price, the monthly payment, the first charge date and the final payment deadline, and this works out a plan that is paid off in time.";
  }
  switch (fit.kind) {
    case "no-dates":
      return "No payment date falls on or before the final payment deadline. Choose a later deadline or an earlier first charge date.";
    case "too-much":
      return "The monthly payment is more than the balance. Lower the monthly payment.";
    case "raise":
      // One date before the deadline: time is the problem. Otherwise the balance is under two monthly payments.
      return fit.datesThatFit === 1
        ? "Only 1 monthly payment date fits on or before the deadline, so the balance cannot be cleared in time at this monthly payment. The monthly payment must be raised."
        : "The balance is less than two monthly payments, so there are no last payments to make larger. The monthly payment must be raised to the whole balance, or changed so it divides the balance.";
    case "even":
      return applied
        ? "This plan is paid off by the deadline at the regular monthly payment. No larger payments are needed."
        : `${planSentence(fit.count, check.installmentCents, currency)} is paid off by the deadline. No larger payments are needed.`;
    case "stepped": {
      const dates = `${fit.datesThatFit} monthly payment dates fit on or before the deadline`;
      return applied
        ? `${dates}, and this plan uses them to clear the balance in time.`
        : `${dates}: ${planSentence(fit.count, check.installmentCents, currency, fit.stepUpCents, fit.stepUpCount)}.`;
    }
    default:
      return "";
  }
}

/** A dollar box. Takes the id and error wiring `Field` hands to its child. */
const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <div className="relative">
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm text-ink-soft">$</span>
    <Input ref={ref} inputMode="decimal" autoComplete="off" placeholder="0.00" className={cn("pl-8", numberStyles, className)} {...props} />
  </div>
));
MoneyInput.displayName = "MoneyInput";

function ScheduleList({
  rows,
  currency,
}: {
  rows: { sequence: number; amountCents: number; dueDate: string; mark: BalancePlanScheduleRow["status"] | null }[];
  currency: string;
}) {
  return (
    <ol className="mt-1.5 divide-y divide-hairline/60 rounded-xl border border-hairline">
      {rows.map((row) => {
        const mark = row.mark ? SCHEDULE_MARK[row.mark] : null;
        return (
          <li key={row.sequence} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
            <span className={cn(numberStyles, "w-6 text-ink-soft")}>{row.sequence}</span>
            <span className={cn(numberStyles, "min-w-[9rem] flex-1 text-ink")}>{formatLongDate(row.dueDate) || "Date to be set"}</span>
            <span className={cn(numberStyles, "text-ink")}>{formatMoney(row.amountCents, currency)}</span>
            {mark && <Badge tone={mark.tone}>{mark.label}</Badge>}
          </li>
        );
      })}
    </ol>
  );
}

/** The plan once a card is on file (or it has ended): numbers only, nothing to edit. */
function LockedPlan({ plan, state }: { plan: AdminBalancePlan; state: BalancePlanState | null }) {
  const currency = plan.currency || "usd";
  const { paid, count } = paidProgress(plan);
  const card = cardLabel(plan);
  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const money = (cents: number) => formatMoney(cents, currency);
  const stepUpCents = plan.stepUpCents ?? 0;
  const stepUpCount = plan.stepUpCount ?? 0;
  const stepped = isSteppedPlan(plan.installmentCount, stepUpCents, stepUpCount);
  /** While charges are running (a failed payment included), say whether the larger last payments are in place. */
  const charging = state === "billing" || state === "past_due";

  return (
    <>
      {state !== "canceled" && state !== "completed" && (
        <p className="rounded-xl border border-hairline bg-white/[0.03] p-3 text-xs text-ink-soft">
          These numbers are locked because the guest has a card on file and agreed to exactly this schedule. They can no longer be changed here.
        </p>
      )}

      {charging && stepped && plan.scheduleInstalledAt && (
        <p role="status" className="text-xs text-ink-soft">Larger final payments are set up with the card processor.</p>
      )}
      {charging && stepped && !plan.scheduleInstalledAt && (
        <div role="alert" className="rounded-xl border border-gold/40 bg-gold/[0.08] p-3 text-xs text-gold">
          <p className="font-semibold">Larger final payments are not set up with the card processor yet</p>
          <p className="mt-1">
            The regular monthly payments are charged as planned. This site tries again every hour to set up the last{" "}
            <span className={numberStyles}>{stepUpCount}</span> larger {stepUpCount === 1 ? "payment" : "payments"}, and sends an alert if it still cannot.
            This message goes away once they are in place.
          </p>
        </div>
      )}

      <section className="rounded-xl border border-hairline p-4" aria-label="Plan numbers">
        <h3 className="font-display text-base text-ink">The plan</h3>
        <dl className="mt-2 grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink-soft">Agreed price</dt>
          <dd className={cn(numberStyles, "text-ink")}>{money(plan.agreedTotalCents)}</dd>
          {plan.discountCents > 0 && (
            <>
              <dt className="text-ink-soft">Discount (already taken off)</dt>
              <dd className="text-ink">
                <span className={numberStyles}>{money(plan.discountCents)}</span>
                {plan.discountNote ? ` · ${plan.discountNote}` : ""}
              </dd>
            </>
          )}
          <dt className="text-ink-soft">Paid before</dt>
          <dd className={cn(numberStyles, "text-ink")}>{money(plan.priorPaidCents)}</dd>
          <dt className="text-ink-soft">Paid on this site</dt>
          <dd className={cn(numberStyles, "text-ink")}>{money(plan.paidHereCents)}</dd>
          <dt className="text-ink-soft">Still to pay</dt>
          <dd className={cn(numberStyles, "text-ink")}>{money(plan.remainingCents)}</dd>
          <dt className="text-ink-soft">Plan</dt>
          <dd className={cn(numberStyles, "text-ink")}>{planSentence(plan.installmentCount, plan.installmentCents, currency, stepUpCents, stepUpCount)}</dd>
          <dt className="text-ink-soft">Payments made</dt>
          <dd className={cn(numberStyles, "text-ink")}>{paid} of {count}</dd>
          <dt className="text-ink-soft">First charge date</dt>
          <dd className={cn(numberStyles, "text-ink")}>{formatLongDate(plan.firstChargeOn) || "Not set"}</dd>
          <dt className="text-ink-soft">Final payment deadline</dt>
          <dd className={cn(numberStyles, "text-ink")}>{formatLongDate(plan.finalDueOn) || "Not set"}</dd>
        </dl>
      </section>

      {(card || plan.authorizedAt || plan.authorizationText) && (
        <section className="rounded-xl border border-hairline p-4" aria-label="Card and authorisation">
          <h3 className="font-display text-base text-ink">Card and authorisation</h3>
          <dl className="mt-2 grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-ink-soft">Card</dt>
            <dd className={cn(numberStyles, "text-ink")}>{card || "Not on file"}</dd>
            <dt className="text-ink-soft">Authorised</dt>
            <dd className={cn(numberStyles, "text-ink")}>{dateTime(plan.authorizedAt) || "Not recorded"}</dd>
          </dl>
          {plan.authorizationText && (
            <>
              <p className="mt-3 text-xs text-ink-soft">What the guest agreed to:</p>
              <blockquote className="mt-1 border-l-2 border-hairline pl-3 text-xs leading-relaxed text-ink">{plan.authorizationText}</blockquote>
            </>
          )}
        </section>
      )}

      {schedule.length > 0 && (
        <section aria-label="Payment schedule">
          <h3 className="font-display text-base text-ink">Payment schedule</h3>
          <ScheduleList rows={schedule.map((row) => ({ sequence: row.sequence, amountCents: row.amountCents, dueDate: row.dueDate, mark: row.status }))} currency={currency} />
        </section>
      )}
    </>
  );
}

/**
 * The email as the guest will see it. Same guard as the campaign preview
 * (components/admin/emailMarkup.tsx): a frame with no sandbox permissions, so
 * no scripts and no access to this page, plus a policy that loads nothing but
 * https images. The markup is the server's own layout, shown untouched; links
 * are made inert because they cannot open from inside the frame.
 */
function EmailFrame({ html, text, title }: { html: string; text: string; title: string }) {
  if (!html.trim()) {
    return <pre className="whitespace-pre-wrap rounded-xl border border-hairline bg-white/[0.03] p-4 font-sans text-sm text-ink">{text}</pre>;
  }
  const policy = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{margin:0;background:#fff}a{pointer-events:none}</style></head><body>${html}</body></html>`;
  return <iframe title={title} sandbox="" className="h-[30rem] w-full rounded-xl border border-hairline bg-white" srcDoc={srcDoc} />;
}
