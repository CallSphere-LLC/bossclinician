import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { CalendarClock, CreditCard, FileText, Loader2, Repeat } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { CancelSubscriptionDialog } from "@/components/member/CancelSubscriptionDialog";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { ReceiptPdfLink } from "@/components/member/ReceiptPdfLink";
import { getStripe, luxeAppearance, stripeConfigured } from "@/components/checkout/stripeClient";
import { useMember } from "@/hooks/useMember";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  billingApi,
  billingErrorMessage,
  describePlanShape,
  describeRecurringPrice,
  receiptPaths,
  type CancelReasonOption,
  type MemberInvoice,
  type MemberPaymentPlan,
  type MemberSubscription,
  type PlanInstallment,
  type SubscriptionsResponse,
} from "@/lib/billingApi";

/**
 * Billing.
 *
 * Four panels, four independent loads. A member whose receipts fail to fetch
 * must still be able to see the plan that is about to renew and the card it
 * will charge, so nothing here is gated behind one combined request that can
 * take the whole page down with it.
 *
 * Every figure on this screen is the member's own money, which sets the bar for
 * how it is written: currency with its symbol and both decimal places, dates as
 * dates, and states as sentences about what happens next rather than the words
 * the payment processor happens to use.
 */
export default function Billing() {
  const { member } = useMember();
  // An admin looking through someone's account may read their billing but not
  // act on it. The server refuses these writes; disabling them here means the
  // refusal never has to be explained as an error.
  const viewingAsAdmin = member?.impersonatedBy != null;

  const subscriptions = useResource(loadSubscriptions, "We could not load your plans just now.");
  const plans = useResource(loadPaymentPlans, "We could not load your payment plans just now.");
  const card = useResource(loadLastCardUsed, "We could not load your card just now.");
  const invoices = useResource(loadInvoices, "We could not load your receipts just now.");

  // A card that needed a bank check (3-D Secure) comes back here through a
  // redirect rather than finishing in the form, so the card update is completed
  // from the address Stripe returns to.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setupIntentId = params.get("setup_intent");
    if (!setupIntentId || params.get("redirect_status") !== "succeeded" || viewingAsAdmin) return;
    window.history.replaceState(null, "", window.location.pathname);
    billingApi
      .confirmPaymentMethod(setupIntentId)
      .then((adopted) => toast.success(cardSavedMessage(adopted)))
      .catch((err: unknown) =>
        toast.error(
          billingErrorMessage(
            err,
            "Your card is saved, but we could not switch your plans to it just now. Please try again in a moment.",
          ),
        ),
      );
  }, [viewingAsAdmin]);

  // Someone with nothing recurring and nothing yet paid has no card to change,
  // and offering the button anyway only leads to a refusal they cannot act on.
  const hasSomethingToCharge =
    (subscriptions.data?.subscriptions ?? []).some(
      (row) => row.endedAt === null && row.status !== "canceled",
    ) || (plans.data ?? []).some((row) => row.status === "active" || row.status === "past_due");

  return (
    <MemberShell
      title="Billing"
      description="Your payment method, any plan you are on, and every invoice we have issued you."
    >
      <Seo title="Billing | Boss Clinician" />

      <div className="grid gap-6">
        <SubscriptionsPanel resource={subscriptions} readOnly={viewingAsAdmin} />
        <PaymentPlansPanel resource={plans} />
        <CardPanel
          resource={card}
          readOnly={viewingAsAdmin}
          hasSomethingToCharge={hasSomethingToCharge}
        />
        <InvoicesPanel resource={invoices} />
      </div>
    </MemberShell>
  );
}

/* ── Loading one panel's worth of data ──────────────────────────────────── */

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string;
  /** Takes an updater so a second action cannot overwrite the first's result. */
  set: Dispatch<SetStateAction<T | null>>;
}

/**
 * `load` must be a stable reference — every caller passes a function defined at
 * module scope, so the effect runs once per mount rather than per render.
 */
function useResource<T>(load: () => Promise<T>, failureMessage: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await load();
        if (cancelled) return;
        setData(next);
        setError("");
      } catch {
        if (!cancelled) setError(failureMessage);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, failureMessage]);

  return { data, loading, error, set: setData };
}

const loadSubscriptions = (): Promise<SubscriptionsResponse> => billingApi.subscriptions();

const loadPaymentPlans = async (): Promise<MemberPaymentPlan[]> =>
  (await billingApi.paymentPlans()).paymentPlans;

/** Deep enough to cover years of monthly invoices without a second page. */
const loadInvoices = async (): Promise<MemberInvoice[]> =>
  (await billingApi.invoices({ limit: 100 })).invoices;

interface CardUsed {
  brand: string;
  last4: string;
  at: string;
}

/**
 * The card the member last actually paid with.
 *
 * There is no "card on file" to read back, because we do not hold one — the
 * card lives with the payment provider and only ever comes back to us as a
 * brand and four digits attached to a payment that succeeded. That is the
 * honest thing to show: a card they will recognise, and the one an update
 * replaces.
 */
async function loadLastCardUsed(): Promise<CardUsed | null> {
  const page = await billingApi.orders({ limit: 1 });
  const latest = page.orders[0];
  if (!latest) return null;

  const detail = await billingApi.order(latest.id);
  const payment = [...detail.transactions]
    .reverse()
    .find((t) => t.kind === "payment" && t.status === "succeeded" && t.cardLast4 !== "");
  if (!payment) return null;

  return { brand: payment.cardBrand, last4: payment.cardLast4, at: payment.occurredAt };
}

/* ── Panel furniture ────────────────────────────────────────────────────── */

interface PanelProps {
  icon: typeof CreditCard;
  title: string;
  loading: boolean;
  loadingLabel: string;
  error: string;
  children: ReactNode;
}

function BillingPanel({ icon: Icon, title, loading, loadingLabel, error, children }: PanelProps) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <Icon aria-hidden className="mt-1 size-5 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl text-white">{title}</h2>

          <div aria-live="polite" className="mt-3">
            {error ? (
              <p role="alert" className="text-sm font-medium text-red-400">
                {error}
              </p>
            ) : loading ? (
              <p className="text-sm text-orchid-dim">{loadingLabel}</p>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="copy-luxe max-w-xl text-sm">{children}</p>;
}

/**
 * The `quiet` variant carries no padding of its own, so a text action in a list
 * needs the tap target adding back — these rows are read on a phone.
 */
const QUIET_LINK = "min-h-[44px] text-[0.72rem] tracking-[0.14em]";

interface StatePill {
  label: string;
  accent: "neutral" | "gold" | "plum" | "green";
}

/* ── Plans ──────────────────────────────────────────────────────────────── */

function SubscriptionsPanel({
  resource,
  readOnly,
}: {
  resource: Resource<SubscriptionsResponse>;
  readOnly: boolean;
}) {
  const [cancelling, setCancelling] = useState<MemberSubscription | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const rows = resource.data?.subscriptions ?? [];
  const reasons: CancelReasonOption[] = resource.data?.cancelReasons ?? [];

  const replace = (next: MemberSubscription) => {
    resource.set((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            subscriptions: prev.subscriptions.map((row) => (row.id === next.id ? next : row)),
          },
    );
  };

  const setPaused = async (subscription: MemberSubscription, paused: boolean) => {
    setBusyId(subscription.id);
    try {
      const next = paused
        ? await billingApi.pauseSubscription(subscription.id)
        : await billingApi.resumeSubscription(subscription.id);
      replace(next);
      toast.success(
        paused
          ? "Paused. Nothing more will be charged until you start it again."
          : "You are back on. Your next payment picks up as normal.",
      );
    } catch (err) {
      toast.error(
        billingErrorMessage(
          err,
          paused
            ? "We could not pause it just now. Please try again in a moment."
            : "We could not start it again just now. Please try again in a moment.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  /** Takes back a cancellation before the date it would take effect. */
  const keep = async (subscription: MemberSubscription) => {
    setBusyId(subscription.id);
    try {
      replace(await billingApi.keepSubscription(subscription.id));
      toast.success("You're staying on. Nothing changes, and it renews as normal.");
    } catch (err) {
      toast.error(billingErrorMessage(err, "We could not keep your plan just now. Please try again in a moment."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <BillingPanel
      icon={Repeat}
      title="Your plans"
      loading={resource.loading}
      loadingLabel="Loading your plans…"
      error={resource.error}
    >
      {rows.length === 0 ? (
        <EmptyNote>
          You are not on a recurring plan. Anything you buy outright stays yours, with no renewal to
          think about.
        </EmptyNote>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.07]">
            {rows.map((subscription) => {
              const { pill, detail } = describeSubscription(subscription);
              const busy = busyId === subscription.id;
              // Nothing left to decide once it has ended or is already set to:
              // pausing or cancelling a plan that stops on a known date would
              // only ask the member to make the same choice twice.
              const settled =
                subscription.endedAt !== null ||
                subscription.status === "canceled" ||
                subscription.cancelAtPeriodEnd;

              return (
                <li
                  key={subscription.id}
                  className="flex flex-col gap-4 py-5 first:pt-1 sm:flex-row sm:items-start sm:justify-between sm:gap-8"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-white">
                      {subscription.planName}
                      {pill && <LuxePill accent={pill.accent}>{pill.label}</LuxePill>}
                    </p>
                    <p className="mt-1.5 text-sm text-orchid">
                      {describeRecurringPrice(
                        subscription.amountCents,
                        subscription.currency,
                        subscription.interval,
                        subscription.intervalCount,
                      )}
                    </p>
                    <p className="mt-1 text-xs text-orchid-faint">{detail}</p>
                  </div>

                  {!settled && !readOnly && (
                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                      <LuxeButton
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void setPaused(subscription, !subscription.paused)}
                      >
                        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                        {subscription.paused ? "Start again" : "Pause"}
                      </LuxeButton>
                      <LuxeButton
                        type="button"
                        variant="quiet"
                        className={QUIET_LINK}
                        onClick={() => setCancelling(subscription)}
                      >
                        Cancel
                      </LuxeButton>
                    </div>
                  )}

                  {/* Set to end but not ended: changing their mind is one click. */}
                  {subscription.cancelAtPeriodEnd &&
                    subscription.endedAt === null &&
                    subscription.status !== "canceled" &&
                    !readOnly && (
                      <div className="flex shrink-0 flex-wrap items-center gap-3">
                        <LuxeButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void keep(subscription)}
                        >
                          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                          Keep my plan
                        </LuxeButton>
                      </div>
                    )}
                </li>
              );
            })}
          </ul>

          {readOnly && (
            <p className="mt-4 text-xs text-orchid-faint">
              Plans can only be changed by the person they belong to.
            </p>
          )}
        </>
      )}

      {cancelling && (
        <CancelSubscriptionDialog
          subscription={cancelling}
          reasons={reasons}
          onUpdated={replace}
          onClose={() => setCancelling(null)}
        />
      )}
    </BillingPanel>
  );
}

/**
 * A member does not need to know what the payment processor calls this state;
 * they need to know what happens next and whether anything is required of them.
 */
function describeSubscription(subscription: MemberSubscription): {
  pill: StatePill | null;
  detail: string;
} {
  const renewal = subscription.nextChargeAt ? formatDate(subscription.nextChargeAt) : null;
  const paidUntil = subscription.currentPeriodEnd
    ? formatDate(subscription.currentPeriodEnd)
    : null;

  if (subscription.endedAt !== null || subscription.status === "canceled") {
    return {
      pill: { label: "Ended", accent: "neutral" },
      detail: subscription.endedAt
        ? `Ended ${formatDate(subscription.endedAt)}. Nothing more will be charged.`
        : "Nothing more will be charged.",
    };
  }

  if (subscription.paused) {
    return {
      pill: { label: "Paused", accent: "neutral" },
      detail: subscription.pausedAt
        ? `Paused since ${formatDate(subscription.pausedAt)}. Nothing is charged while it is paused.`
        : "Nothing is charged while it is paused.",
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      pill: { label: "Ending", accent: "neutral" },
      detail: paidUntil
        ? `Ends ${paidUntil}. You keep everything until then, and will not be charged again.`
        : "You keep everything until the end of the time you have paid for.",
    };
  }

  if (subscription.status === "past_due" || subscription.status === "unpaid") {
    return {
      pill: { label: "Needs a payment", accent: "gold" },
      detail:
        "The last payment did not go through. Updating the card below will put it right — nothing has closed yet.",
    };
  }

  if (subscription.status === "incomplete") {
    return {
      pill: { label: "Not started", accent: "gold" },
      detail: "This has not started yet, because the first payment has not gone through.",
    };
  }

  if (subscription.status === "trialing" && subscription.trialEndsAt) {
    return {
      pill: { label: "Free trial", accent: "gold" },
      detail: `Free until ${formatDate(subscription.trialEndsAt)}, when the first payment is taken.`,
    };
  }

  return {
    pill: { label: "Active", accent: "green" },
    detail:
      renewal && subscription.nextChargeAmountCents !== null
        ? `Renews ${renewal} — ${formatCurrency(subscription.nextChargeAmountCents, subscription.currency)}.`
        : "Renews automatically.",
  };
}

/* ── Payment plans ──────────────────────────────────────────────────────── */

function PaymentPlansPanel({ resource }: { resource: Resource<MemberPaymentPlan[]> }) {
  const rows = resource.data ?? [];

  return (
    <BillingPanel
      icon={CalendarClock}
      title="Paying in instalments"
      loading={resource.loading}
      loadingLabel="Loading your payment plans…"
      error={resource.error}
    >
      {rows.length === 0 ? (
        <EmptyNote>
          You are not paying anything off in instalments. If you ever split a payment, the schedule
          will show up here.
        </EmptyNote>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {rows.map((plan) => (
            <li key={plan.id} className="py-5 first:pt-1">
              <p className="text-sm font-medium text-white">{plan.offerTitle}</p>
              <p className="mt-1.5 text-sm text-orchid">
                {plan.progressLabel}
                {plan.nextChargeAt !== null && plan.nextChargeAmountCents !== null && (
                  <>
                    {" — next on "}
                    {formatDate(plan.nextChargeAt)},{" "}
                    {formatCurrency(plan.nextChargeAmountCents, plan.currency)}
                  </>
                )}
              </p>

              <PlanProgress paid={plan.installmentsPaid} total={plan.installmentCount} />

              <p className="mt-2.5 text-xs text-orchid-faint">{describePlanState(plan)}</p>

              {plan.installments.length > 0 && (
                <ul className="mt-4 grid max-w-md gap-1.5">
                  {plan.installments.map((installment) => (
                    <li
                      key={installment.sequence}
                      className="flex items-baseline justify-between gap-6 text-xs"
                    >
                      <span className="text-orchid-dim">{describeInstallment(installment)}</span>
                      <span className="shrink-0 text-orchid">
                        {formatCurrency(installment.amountCents, plan.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </BillingPanel>
  );
}

/** Decoration only — the sentence above it already states the same thing. */
function PlanProgress({ paid, total }: { paid: number; total: number }) {
  const done = total > 0 ? Math.min(Math.max(paid / total, 0), 1) : 0;
  return (
    <span
      aria-hidden
      className="mt-3 block h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/[0.08]"
    >
      <span
        className="block h-full rounded-full bg-gold-foil transition-[width] duration-700 ease-luxe"
        style={{ width: `${done * 100}%` }}
      />
    </span>
  );
}

function describePlanState(plan: MemberPaymentPlan): string {
  const shape = describePlanShape(plan);

  if (plan.status === "completed") {
    return `Paid in full${plan.completedAt ? ` on ${formatDate(plan.completedAt)}` : ""} — nothing more to pay. What you bought is yours to keep.`;
  }
  if (plan.status === "canceled") {
    return `${shape}. This plan was stopped, so no further payments will be taken.`;
  }
  if (plan.status === "past_due") {
    return `${shape}. The last payment did not go through — updating the card below will pick it back up.`;
  }
  return `${shape}. ${formatCurrency(plan.remainingCents, plan.currency)} left to pay.`;
}

function describeInstallment(installment: PlanInstallment): string {
  const number = `Payment ${installment.sequence}`;

  if (installment.status === "paid") {
    if (!installment.paidAt) return `${number} · paid`;
    return `${number} · paid ${formatDate(installment.paidAt)}`;
  }
  if (installment.status === "failed") {
    if (!installment.dueAt) return `${number} · did not go through`;
    return `${number} · did not go through on ${formatDate(installment.dueAt)}`;
  }
  if (installment.status === "skipped") return `${number} · not taken`;
  if (!installment.dueAt) return `${number} · to come`;
  return `${number} · due ${formatDate(installment.dueAt)}`;
}

/* ── Card on file ───────────────────────────────────────────────────────── */

function CardPanel({
  resource,
  readOnly,
  hasSomethingToCharge,
}: {
  resource: Resource<CardUsed | null>;
  readOnly: boolean;
  hasSomethingToCharge: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const card = resource.data;

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const session = await billingApi.startPaymentMethodUpdate();
      if (session.type === "portal" && session.url !== null) {
        // A full navigation rather than a new tab: this is opened from an async
        // call, which a popup blocker treats as unsolicited and swallows.
        window.location.assign(session.url);
        return;
      }
      if (session.clientSecret !== null && stripeConfigured()) {
        setSetupSecret(session.clientSecret);
        return;
      }
      setError("We could not open the card form just now. Please try again in a moment.");
    } catch (err) {
      setError(
        billingErrorMessage(err, "We could not open the card form just now. Please try again in a moment."),
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <BillingPanel
      icon={CreditCard}
      title="Card on file"
      loading={resource.loading}
      loadingLabel="Loading your card…"
      error={resource.error}
    >
      {card ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">
              {/* Capitalised in CSS so a brand that arrives lower-cased still
                  reads as a name rather than a field value. */}
              {card.brand ? <span className="capitalize">{card.brand}</span> : "Card"} ending{" "}
              {card.last4}
            </p>
            <p className="mt-1 text-xs text-orchid-faint">
              The card your last payment was taken from, on {formatDate(card.at)}.
            </p>
          </div>
          {!readOnly && (
            <UpdateCardButton starting={starting} onClick={() => void start()} label="Update card" />
          )}
        </div>
      ) : (
        <>
          <EmptyNote>
            Nothing here yet — the card you pay with will appear here after your first payment.
          </EmptyNote>
          {!readOnly && hasSomethingToCharge && (
            <div className="mt-5">
              <UpdateCardButton
                starting={starting}
                onClick={() => void start()}
                label="Add a card"
              />
            </div>
          )}
        </>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-400">
            {error}
          </p>
        )}
      </div>

      {setupSecret && (
        <NewCardForm clientSecret={setupSecret} onDone={() => setSetupSecret(null)} />
      )}

      {readOnly ? (
        <p className="mt-4 text-xs text-orchid-faint">
          The card can only be changed by the person it belongs to.
        </p>
      ) : (
        <p className="mt-4 text-xs text-orchid-faint">
          Card details are held by our payment provider, never by us.
        </p>
      )}
    </BillingPanel>
  );
}

function UpdateCardButton({
  starting,
  onClick,
  label,
}: {
  starting: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <LuxeButton
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={starting}
      onClick={onClick}
    >
      {starting && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {starting ? "Opening" : label}
    </LuxeButton>
  );
}

/**
 * The card field, for the times the hosted portal is not available.
 *
 * The server hands back a setup secret instead of a portal link when there is
 * no portal configuration to send anyone to, and the card has to be collected
 * somewhere — never on a field of ours, always inside the provider's own frame.
 */
function NewCardForm({ clientSecret, onDone }: { clientSecret: string; onDone: () => void }) {
  const stripePromise = useMemo(() => getStripe(), []);
  const options = useMemo<StripeElementsOptions>(
    () => ({ clientSecret, appearance: luxeAppearance }),
    [clientSecret],
  );

  if (!stripePromise) {
    return (
      <p className="mt-5 text-sm text-orchid-dim">
        Card changes are unavailable at the moment. Please get in touch and we will sort it out.
      </p>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/[0.09] bg-white/[0.02] p-4 sm:p-5">
      <Elements stripe={stripePromise} options={options}>
        <NewCardFields onDone={onDone} />
      </Elements>
    </div>
  );
}

function NewCardFields({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!stripe || !elements) return;
    setSaving(true);
    setError("");

    const outcome = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/account/billing` },
      redirect: "if_required",
    });

    if (outcome.error) {
      setError(
        outcome.error.message ??
          "That card could not be saved. Please check the details or try another card.",
      );
      setSaving(false);
      return;
    }

    // Saving the card only attaches it. This makes it the card every plan
    // charges, and tries an overdue payment on it now — without it the next
    // renewal still went to the card being replaced.
    const setupIntentId = outcome.setupIntent?.id;
    if (setupIntentId) {
      try {
        const adopted = await billingApi.confirmPaymentMethod(setupIntentId);
        toast.success(cardSavedMessage(adopted));
      } catch (err) {
        setError(
          billingErrorMessage(
            err,
            "Your card is saved, but we could not switch your plans to it just now. Please try again in a moment.",
          ),
        );
        setSaving(false);
        return;
      }
    } else {
      toast.success("Your new card is saved.");
    }
    setSaving(false);
    onDone();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <PaymentElement options={{ layout: { type: "tabs", defaultCollapsed: false } }} />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <LuxeButton type="submit" variant="foil" size="sm" disabled={saving || !stripe}>
          {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {saving ? "Saving" : "Save this card"}
        </LuxeButton>
        <LuxeButton
          type="button"
          variant="quiet"
          className={QUIET_LINK}
          disabled={saving}
          onClick={onDone}
        >
          Not now
        </LuxeButton>
      </div>
    </form>
  );
}

/* ── Receipts ───────────────────────────────────────────────────────────── */

function InvoicesPanel({ resource }: { resource: Resource<MemberInvoice[]> }) {
  const rows = resource.data ?? [];

  return (
    <BillingPanel
      icon={FileText}
      title="Invoices & receipts"
      loading={resource.loading}
      loadingLabel="Loading your receipts…"
      error={resource.error}
    >
      {rows.length === 0 ? (
        <>
          <EmptyNote>
            Nothing here yet — every purchase and renewal will appear here with a receipt you can
            open or download.
          </EmptyNote>
          <LuxeButton to="/courses" variant="glass" size="sm" className="mt-5">
            Browse the courses
          </LuxeButton>
        </>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {rows.map((invoice) => {
            const pill = describeInvoice(invoice);
            const amountCents =
              invoice.status === "paid" ? invoice.amountPaidCents : invoice.amountDueCents;

            return (
              <li
                key={invoice.id}
                className="flex flex-col gap-3 py-4 first:pt-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-white">
                    {formatDate(invoice.paidAt ?? invoice.createdAt)} ·{" "}
                    {formatCurrency(amountCents, invoice.currency)}
                    {pill && <LuxePill accent={pill.accent}>{pill.label}</LuxePill>}
                  </p>
                  {invoiceDetail(invoice) && (
                    <p className="mt-1 text-xs text-orchid-faint">{invoiceDetail(invoice)}</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-5">
                  {/* A declined renewal can be paid straight away on Stripe's
                      hosted invoice page, without waiting for the next retry. */}
                  {(invoice.status === "failed" || invoice.status === "open") &&
                    invoice.hostedInvoiceUrl && (
                      <LuxeButton
                        href={invoice.hostedInvoiceUrl}
                        variant="outline"
                        size="sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Pay now
                      </LuxeButton>
                    )}
                  {/* The receipt's own address, opened in this tab. */}
                  <LuxeButton
                    to={receiptPaths({ invoiceId: invoice.id }).page}
                    variant="quiet"
                    className={QUIET_LINK}
                  >
                    View receipt
                  </LuxeButton>
                  {/* Stripe's own PDF where Stripe raised the invoice, ours
                      where we did — a one-off purchase has no Stripe invoice
                      and used to have no document of any kind. */}
                  {invoice.pdfUrl ? (
                    <LuxeButton
                      href={invoice.pdfUrl}
                      variant="quiet"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={QUIET_LINK}
                    >
                      Download
                    </LuxeButton>
                  ) : (
                    invoice.receiptPdfUrl && (
                      <ReceiptPdfLink target={{ invoiceId: invoice.id }} className={QUIET_LINK}>
                        Download PDF
                      </ReceiptPdfLink>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </BillingPanel>
  );
}

/** What happened to the plans once a new card was saved, in one sentence. */
function cardSavedMessage(adopted: { updated: number; retried: number; paid: number }): string {
  const plans =
    adopted.updated > 0
      ? `Your new card is saved and ${adopted.updated === 1 ? "your plan now uses it" : "all your plans now use it"}.`
      : "Your new card is saved.";
  if (adopted.retried === 0) return plans;
  if (adopted.paid === adopted.retried) {
    return `${plans} The payment that didn't go through has now been paid.`;
  }
  return `${plans} We tried the overdue payment on it, but it didn't go through — you'll get an email about what happens next.`;
}

function describeInvoice(invoice: MemberInvoice): StatePill | null {
  // Written by the payment-failed webhook; the card on file was declined.
  if (invoice.status === "failed") return { label: "Didn't go through", accent: "gold" };
  if (invoice.status === "open") return { label: "Not paid yet", accent: "gold" };
  if (invoice.status === "uncollectible") return { label: "Payment outstanding", accent: "gold" };
  if (invoice.status === "void") return { label: "Cancelled", accent: "neutral" };
  if (invoice.status === "draft") return { label: "Not issued yet", accent: "neutral" };
  return null;
}

/** The reference an expense claim needs, and the dates a renewal covered. */
function invoiceDetail(invoice: MemberInvoice): string {
  const parts: string[] = [];
  if (invoice.number) parts.push(`Reference ${invoice.number}`);
  if (invoice.periodStart && invoice.periodEnd) {
    parts.push(`Covers ${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}`);
  }
  return parts.join(" · ");
}
