import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { CalendarClock, CreditCard, FileText, Loader2, Repeat } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { CancelSubscriptionDialog } from "@/components/member/CancelSubscriptionDialog";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { useMember } from "@/hooks/useMember";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  billingApi,
  describePlanShape,
  describeRecurringPrice,
  type CardOnFileResponse,
  type MemberInvoice,
  type MemberPaymentPlan,
  type MemberSubscription,
} from "@/lib/billingApi";

/**
 * Billing.
 *
 * Four panels, four independent loads. A member whose receipts fail to fetch
 * must still be able to see the plan that is about to renew and the card it will
 * charge, so nothing here is gated behind one combined request that can take the
 * whole page down with it.
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

  const subscriptions = useResource(
    billingApi.subscriptions,
    "We could not load your plans just now.",
  );
  const plans = useResource(
    billingApi.paymentPlans,
    "We could not load your payment plans just now.",
  );
  const card = useResource(billingApi.cardOnFile, "We could not load your card just now.");
  const invoices = useResource(billingApi.invoices, "We could not load your receipts just now.");

  const hasRecurring =
    (subscriptions.data ?? []).some((row) => row.state !== "canceled") ||
    (plans.data ?? []).some((row) => row.state === "active" || row.state === "past_due");

  return (
    <MemberShell
      title="Billing"
      description="Your payment method, any plan you are on, and every invoice we have issued you."
    >
      <Seo title="Billing | Boss Clinician" />

      <div className="grid gap-6">
        <SubscriptionsPanel resource={subscriptions} readOnly={viewingAsAdmin} />
        <PaymentPlansPanel resource={plans} />
        <CardPanel resource={card} readOnly={viewingAsAdmin} hasRecurring={hasRecurring} />
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
 * `load` must be a stable reference — every caller passes a method off the
 * `billingApi` object, so the effect runs once per mount rather than per render.
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
 * The `quiet` variant carries no padding of its own, so a text link in a list
 * needs the tap target adding back — these rows are read on a phone.
 */
const QUIET_LINK = "min-h-[44px] text-[0.72rem] tracking-[0.14em]";

/* ── Plans ──────────────────────────────────────────────────────────────── */

function SubscriptionsPanel({
  resource,
  readOnly,
}: {
  resource: Resource<MemberSubscription[]>;
  readOnly: boolean;
}) {
  const [cancelling, setCancelling] = useState<MemberSubscription | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const rows = resource.data ?? [];

  const replace = (next: MemberSubscription) => {
    resource.set((prev) => (prev ?? []).map((row) => (row.id === next.id ? next : row)));
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
    } catch {
      toast.error(
        paused
          ? "We could not pause it just now. Please try again in a moment."
          : "We could not start it again just now. Please try again in a moment.",
      );
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
              const paused = subscription.pausedAt !== null;
              // Nothing left to decide once it has ended or is already set to:
              // pausing or cancelling a plan that stops on a known date would
              // only ask the member to make the same choice twice.
              const settled =
                subscription.state === "canceled" || subscription.cancelAtPeriodEnd;

              return (
                <li
                  key={subscription.id}
                  className="flex flex-col gap-4 py-5 first:pt-1 sm:flex-row sm:items-start sm:justify-between sm:gap-8"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-white">
                      {subscription.title}
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
                    <div className="flex shrink-0 flex-wrap gap-3">
                      <LuxeButton
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void setPaused(subscription, !paused)}
                      >
                        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                        {paused ? "Start again" : "Pause"}
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
          onUpdated={replace}
          onClose={() => setCancelling(null)}
        />
      )}
    </BillingPanel>
  );
}

interface StatePill {
  label: string;
  accent: "neutral" | "gold" | "plum" | "green";
}

/**
 * A member does not need to know what the payment processor calls this state;
 * they need to know what happens next and whether anything is required of them.
 */
function describeSubscription(subscription: MemberSubscription): {
  pill: StatePill | null;
  detail: string;
} {
  const renewal = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null;

  if (subscription.state === "canceled") {
    return {
      pill: { label: "Ended", accent: "neutral" },
      detail: subscription.canceledAt
        ? `Ended ${formatDate(subscription.canceledAt)}. Nothing more will be charged.`
        : "Nothing more will be charged.",
    };
  }

  if (subscription.pausedAt !== null) {
    return {
      pill: { label: "Paused", accent: "neutral" },
      detail: `Paused since ${formatDate(subscription.pausedAt)}. Nothing is being charged while it is paused.`,
    };
  }

  if (subscription.state === "past_due" || subscription.state === "unpaid") {
    return {
      pill: { label: "Needs a payment", accent: "gold" },
      detail:
        "The last payment did not go through. Updating the card below will put it right — nothing has closed yet.",
    };
  }

  if (subscription.state === "incomplete") {
    return {
      pill: { label: "Not started", accent: "gold" },
      detail: "This has not started yet because the first payment has not gone through.",
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      pill: { label: "Ending", accent: "neutral" },
      detail: renewal
        ? `Ends ${renewal}. You keep everything until then, and will not be charged again.`
        : "You keep everything until the end of the time you have paid for.",
    };
  }

  if (subscription.state === "trialing" && subscription.trialEndsAt) {
    return {
      pill: { label: "Free trial", accent: "gold" },
      detail: `Free until ${formatDate(subscription.trialEndsAt)}, when the first payment is taken.`,
    };
  }

  return {
    pill: { label: "Active", accent: "green" },
    detail: renewal ? `Renews ${renewal}.` : "Renews automatically.",
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
              <p className="text-sm font-medium text-white">{plan.title}</p>
              <p className="mt-1.5 text-sm text-orchid">
                {plan.installmentsPaid} of {plan.installmentCount} payments made
                {plan.state === "active" && plan.nextChargeAt && (
                  <>
                    {" — next on "}
                    {formatDate(plan.nextChargeAt)},{" "}
                    {formatCurrency(plan.installmentCents, plan.currency)}
                  </>
                )}
              </p>

              <PlanProgress paid={plan.installmentsPaid} total={plan.installmentCount} />

              <p className="mt-2.5 text-xs text-orchid-faint">{describePlanState(plan)}</p>
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

  if (plan.state === "completed") {
    return `Paid in full${plan.completedAt ? ` on ${formatDate(plan.completedAt)}` : ""} — nothing more to pay. What you bought is yours to keep.`;
  }
  if (plan.state === "canceled") {
    return `${shape}. This plan was stopped, so no further payments will be taken.`;
  }
  if (plan.state === "past_due") {
    return `${shape}. The last payment did not go through — updating the card below will pick it back up.`;
  }
  return `${shape}. ${formatCurrency(plan.remainingCents, plan.currency)} left of ${formatCurrency(plan.totalCents, plan.currency)}.`;
}

/* ── Card on file ───────────────────────────────────────────────────────── */

function CardPanel({
  resource,
  readOnly,
  hasRecurring,
}: {
  resource: Resource<CardOnFileResponse>;
  readOnly: boolean;
  hasRecurring: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const card = resource.data?.card ?? null;

  const start = async () => {
    setStarting(true);
    try {
      const session = await billingApi.startCardUpdate();
      // A full navigation rather than a new tab: this is opened from an async
      // call, which a popup blocker treats as unsolicited and swallows.
      window.location.assign(session.url);
    } catch {
      toast.error("We could not open the card form just now. Please try again in a moment.");
      setStarting(false);
    }
  };

  const showButton = !readOnly && (card !== null || hasRecurring);

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
              <span className="capitalize">{card.brand}</span> ending {card.last4}
            </p>
            <p className="mt-1 text-xs text-orchid-faint">
              {card.expMonth && card.expYear
                ? `Expires ${String(card.expMonth).padStart(2, "0")}/${card.expYear}`
                : "This is the card every payment is taken from."}
            </p>
          </div>
          {showButton && (
            <LuxeButton
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={starting}
              onClick={() => void start()}
            >
              {starting && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {starting ? "Opening" : "Update card"}
            </LuxeButton>
          )}
        </div>
      ) : (
        <>
          <EmptyNote>
            Nothing here yet — the card you pay with will appear here after your first purchase.
          </EmptyNote>
          {showButton && (
            <LuxeButton
              type="button"
              variant="outline"
              size="sm"
              className="mt-5"
              disabled={starting}
              onClick={() => void start()}
            >
              {starting && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {starting ? "Opening" : "Add a card"}
            </LuxeButton>
          )}
        </>
      )}

      {card && (
        <p className="mt-4 text-xs text-orchid-faint">
          Card details are held by our payment provider, never by us.
        </p>
      )}
    </BillingPanel>
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
            Nothing here yet — your invoices and receipts will appear here after your first purchase.
          </EmptyNote>
          <LuxeButton to="/courses" variant="glass" size="sm" className="mt-5">
            Browse the courses
          </LuxeButton>
        </>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {rows.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-col gap-3 py-4 first:pt-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-white">
                  {invoice.description || "Your purchase"}
                  {invoice.state === "open" && <LuxePill accent="gold">Unpaid</LuxePill>}
                  {invoice.state === "void" && <LuxePill accent="neutral">Cancelled</LuxePill>}
                  {invoice.state === "uncollectible" && (
                    <LuxePill accent="gold">Payment outstanding</LuxePill>
                  )}
                </p>
                <p className="mt-1 text-xs text-orchid-faint">
                  {formatDate(invoice.paidAt ?? invoice.createdAt)} ·{" "}
                  {formatCurrency(invoice.amountPaidCents, invoice.currency)}
                  {invoice.number && ` · No. ${invoice.number}`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-5">
                {invoice.hostedInvoiceUrl && (
                  <LuxeButton
                    href={invoice.hostedInvoiceUrl}
                    variant="quiet"
                    target="_blank"
                    className={QUIET_LINK}
                  >
                    View
                  </LuxeButton>
                )}
                {invoice.pdfUrl && (
                  <LuxeButton
                    href={invoice.pdfUrl}
                    variant="quiet"
                    target="_blank"
                    className={QUIET_LINK}
                  >
                    Download
                  </LuxeButton>
                )}
                {!invoice.hostedInvoiceUrl && !invoice.pdfUrl && (
                  <span className="text-xs text-orchid-faint">
                    Ask us if you need a copy of this one
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </BillingPanel>
  );
}
