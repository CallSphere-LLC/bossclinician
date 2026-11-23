import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Stripe, StripeElements, StripeElementsOptions } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { appearanceForTheme, getStripe, stripeConfigured } from "@/components/checkout/stripeClient";
import { cn } from "@/lib/cn";
import { useSiteTheme } from "@/lib/siteTheme";
import {
  formatCents,
  formatRetreatDate,
  memberRetreatsApi,
  type BalancePlanScheduleRow,
  type BalancePlanView,
} from "@/lib/retreatsApi";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, FIGURE, LINK } from "./retreatUi";

/**
 * A guest's retreat balance plan, shown in the dashboard's Payments section in
 * place of the read-only summary once the owner has opened one for her.
 *
 * While the plan is `open` the guest adds a card and agrees to the schedule:
 * "Add your card" asks the server for a SetupIntent, Stripe's Payment Element
 * collects the card inside Stripe's own frame, and the server is then told
 * which SetupIntent succeeded along with her agreement. The server saves the
 * card, and takes the first payment straight away when it is already due.
 *
 * What she agrees to is what the server stores. The SetupIntent comes back
 * with the plan as it stands at that moment, and the figures, the schedule,
 * the button and the consent sentence beside the card form are all shown from
 * THAT plan, not from the dashboard load that may be hours old. The sentence
 * displayed is sent back with her agreement; if it is no longer the plan's
 * sentence the server saves nothing and she starts again from the new one.
 *
 * Money is live, so every request here is guarded against a second click, and
 * the owner's preview (`readOnly`) reaches neither the API, the address bar nor
 * browser storage.
 */
export interface BalancePlanPanelProps {
  plan: BalancePlanView;
  slug: string;
  supportEmail: string;
  roomLabel?: string | null;
  /** The owner's preview: figures and schedule only, no card form, no requests. */
  readOnly: boolean;
  onReload?: () => void;
}

const BILLING_PATH = "/account/billing";

const COPY = {
  needsAgreement: "Please tick the box to agree to the payment schedule before you save your card.",
  stillLoading: "The card form is still loading. Please try again in a moment.",
  cardNotSaved: "That card could not be saved. Please check the details or try another card.",
  cardNotConfirmed: "Your card could not be confirmed. Please try again or use another card.",
  declined: "That card was declined. Please try again with another card.",
  refused: "We could not save your card. Please try again.",
  unfinished: "We could not finish saving your card just now. Your card details are safe with Stripe. Please try again.",
  couldNotOpen: "We could not open the card form just now. Please try again in a moment.",
  bankDidNotApprove: "Your bank did not approve that card, so nothing was saved. Please try again or use another card.",
  agreeAgain: "We could not match that card to your agreement, so nothing was saved. Please add your card again.",
  bankStillChecking: "Your bank hasn't finished confirming the card yet. Please try again in a minute.",
};

/* ───────────────────────── the pure, testable parts ───────────────────────── */

/** What the server said once a SetupIntent had succeeded at Stripe. */
export type ConfirmOutcome =
  | { kind: "confirmed"; balancePlan: BalancePlanView; charged: boolean }
  /**
   * Refused or declined (402, a changed schedule's 409, other 4xx): the guest
   * starts again with a fresh SetupIntent and the plan as it now stands.
   */
  | { kind: "declined"; message: string }
  /**
   * No answer (network, 5xx), or the bank has not finished confirming the card
   * (409 `setup_pending`): the same SetupIntent can be sent again, with the
   * same sentence she agreed to.
   */
  | { kind: "unfinished"; message: string; setupIntentId: string; authorizationText: string };

export type CardSubmitOutcome =
  | ConfirmOutcome
  /** The agreement box is not ticked. Nothing was sent anywhere. */
  | { kind: "needs_agreement"; message: string }
  /** Stripe did not accept the card details; the same form can be corrected and sent again. */
  | { kind: "card_error"; message: string };

/** "seti_123_secret_abc" → "seti_123" ("" when it is not a SetupIntent secret). */
export function setupIntentIdFromSecret(clientSecret: string): string {
  const id = clientSecret.split("_secret_")[0] ?? "";
  return id.startsWith("seti_") ? id : "";
}

export function balancePlanReturnUrl(origin: string, slug: string): string {
  return `${origin}/retreats/dashboard/${encodeURIComponent(slug)}/payments`;
}

/** The next payment still to be taken, if the schedule has one. */
export function nextScheduledPayment(plan: BalancePlanView): BalancePlanScheduleRow | null {
  return plan.schedule.find((row) => row.status === "scheduled") ?? null;
}

/** "visa" → "Visa". Stripe sends card brands in lower case. */
export function cardBrandLabel(brand: string): string {
  const known: Record<string, string> = {
    amex: "American Express",
    diners: "Diners Club",
    jcb: "JCB",
    unionpay: "UnionPay",
    mastercard: "Mastercard",
  };
  const key = brand.trim().toLowerCase();
  if (!key || key === "unknown") return "Card";
  return known[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function statusOf(error: unknown): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return 0;
}

function sentenceOf(error: unknown): string {
  return statusOf(error) > 0 && error instanceof Error ? error.message : "";
}

/** The server's `details.code` on a refusal ("" when it sent none). */
function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "details" in error) {
    const details = (error as { details: unknown }).details;
    if (details && typeof details === "object" && "code" in details) {
      const code = (details as { code: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return "";
}

/**
 * Tells the server which SetupIntent succeeded, with the guest's agreement and
 * the consent sentence exactly as it was displayed to her.
 * Never throws: every failure comes back as a sentence the guest can read.
 */
export async function confirmBalancePlanCard(slug: string, setupIntentId: string, authorizationText: string): Promise<ConfirmOutcome> {
  try {
    const result = await memberRetreatsApi.balancePlanConfirm(slug, setupIntentId, authorizationText);
    return { kind: "confirmed", balancePlan: result.balancePlan, charged: result.charged };
  } catch (error) {
    const status = statusOf(error);
    if (status === 0 || status >= 500 || status === 408 || status === 429) {
      return { kind: "unfinished", message: COPY.unfinished, setupIntentId, authorizationText };
    }
    // The card is fine and so is the agreement; the bank is simply not done.
    // The SetupIntent is kept, because a new one would mean a second bank check.
    if (status === 409 && codeOf(error) === "setup_pending") {
      return { kind: "unfinished", message: sentenceOf(error) || COPY.bankStillChecking, setupIntentId, authorizationText };
    }
    // Everything else, a changed schedule (409 `schedule_changed`) included.
    return { kind: "declined", message: sentenceOf(error) || (status === 402 ? COPY.declined : COPY.refused) };
  }
}

/**
 * The whole "save my card" step: agreement first, then Stripe, then our server.
 * Without the agreement ticked neither Stripe nor the server is contacted.
 */
export async function submitBalancePlanCard(input: {
  agreed: boolean;
  stripe: Pick<Stripe, "confirmSetup"> | null;
  elements: StripeElements | null;
  slug: string;
  clientSecret: string;
  /** The consent sentence exactly as it is displayed beside the tick box. */
  authorizationText: string;
  returnUrl: string;
}): Promise<CardSubmitOutcome> {
  if (!input.agreed) return { kind: "needs_agreement", message: COPY.needsAgreement };
  if (!input.stripe || !input.elements) return { kind: "card_error", message: COPY.stillLoading };

  // A card that needs a bank check leaves this page and comes back by redirect.
  // This note is how the returning page knows the box was ticked for this card,
  // and which sentence was beside it.
  rememberAgreement(input.slug, setupIntentIdFromSecret(input.clientSecret), input.authorizationText);

  let setupIntentId = "";
  try {
    const outcome = await input.stripe.confirmSetup({
      elements: input.elements,
      redirect: "if_required",
      confirmParams: { return_url: input.returnUrl },
    });
    if (outcome.error) {
      forgetAgreement(input.slug);
      return { kind: "card_error", message: outcome.error.message ?? COPY.cardNotSaved };
    }
    if (outcome.setupIntent?.status !== "succeeded") {
      forgetAgreement(input.slug);
      return { kind: "card_error", message: COPY.cardNotConfirmed };
    }
    setupIntentId = outcome.setupIntent.id;
  } catch {
    forgetAgreement(input.slug);
    return { kind: "card_error", message: COPY.cardNotSaved };
  }

  return confirmBalancePlanCard(input.slug, setupIntentId, input.authorizationText);
}

/* ─────────────── the note that survives a bank-check redirect ─────────────── */

const agreementKey = (slug: string) => `bc-balance-plan-agreed:${slug}`;

/** Which card the box was ticked for, and the sentence that was beside the box. */
interface AgreementNote {
  setupIntentId: string;
  authorizationText: string;
}

function rememberAgreement(slug: string, setupIntentId: string, authorizationText: string): void {
  if (!setupIntentId || !authorizationText) return;
  try {
    const note: AgreementNote = { setupIntentId, authorizationText };
    window.sessionStorage.setItem(agreementKey(slug), JSON.stringify(note));
  } catch {
    /* Private windows and tests have no storage; only the redirect path needs it. */
  }
}

/** Null when there is no note, or one without a sentence (it cannot prove what she agreed to). */
function recallAgreement(slug: string): AgreementNote | null {
  try {
    const raw = window.sessionStorage.getItem(agreementKey(slug));
    if (!raw) return null;
    const note = JSON.parse(raw) as Partial<AgreementNote> | null;
    if (!note || typeof note !== "object") return null;
    if (typeof note.setupIntentId !== "string" || !note.setupIntentId) return null;
    if (typeof note.authorizationText !== "string" || !note.authorizationText) return null;
    return { setupIntentId: note.setupIntentId, authorizationText: note.authorizationText };
  } catch {
    return null;
  }
}

function forgetAgreement(slug: string): void {
  try {
    window.sessionStorage.removeItem(agreementKey(slug));
  } catch {
    /* Nothing to forget. */
  }
}

/**
 * Reads what Stripe put in the address after a bank check, and removes it so a
 * reload or the back button cannot send the same card twice.
 */
function takeStripeReturn(): { setupIntentId: string; succeeded: boolean } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const setupIntentId = params.get("setup_intent");
  if (!setupIntentId) return null;
  const succeeded = params.get("redirect_status") === "succeeded";
  params.delete("setup_intent");
  params.delete("setup_intent_client_secret");
  params.delete("redirect_status");
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  return { setupIntentId, succeeded };
}

/* ─────────────────────────────── the panel ─────────────────────────────── */

const ALERT = "rounded-xl border border-amber-300/50 bg-amber-400/[0.12] px-4 py-3 text-sm font-medium text-amber-200";

export function BalancePlanPanel({ plan, slug, supportEmail, roomLabel, readOnly, onReload }: BalancePlanPanelProps) {
  // The server's answer to "confirm" is shown at once; the reloaded dashboard replaces it.
  const [confirmed, setConfirmed] = useState<BalancePlanView | null>(null);
  // The plan as the server sent it with the SetupIntent. While the card form is
  // open, everything on this panel is shown from it, so the figures, the dates
  // and the consent sentence she reads are the ones her agreement is checked
  // against. It lives and dies with the card form (OpenPlanForm sets and clears
  // it), and is deliberately NOT dropped when the dashboard reloads behind it.
  const [fresh, setFresh] = useState<BalancePlanView | null>(null);
  const [notice, setNotice] = useState<{ charged: boolean; amount: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => setConfirmed(null), [plan]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const view = confirmed ?? fresh ?? plan;
  const money = (cents: number) => formatCents(cents, view.currency);
  const next = nextScheduledPayment(view);

  function handleConfirmed(result: { balancePlan: BalancePlanView; charged: boolean }) {
    setConfirmed(result.balancePlan);
    setFresh(null);
    // The amount of the plan the server has just saved, which is the one charged.
    setNotice({ charged: result.charged, amount: formatCents(result.balancePlan.installmentCents, result.balancePlan.currency) });
    onReload?.();
  }

  return (
    <div className="flex flex-col gap-5">
      <div aria-live="polite">
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="rounded-xl border border-emerald-300/40 bg-emerald-400/[0.10] px-4 py-3 text-sm font-medium text-emerald-200 outline-none">
            {notice.charged ? (
              <>
                Your card is saved and your first payment of <span className={FIGURE}>{notice.amount}</span> went through. Thank you.
              </>
            ) : (
              "Your card is saved. Thank you."
            )}
          </p>
        )}
      </div>

      {view.state === "past_due" && (
        <div role="alert" className={cn(ALERT, "flex flex-col gap-3")}>
          <p>Your last payment did not go through. Please update your card so we can try again.</p>
          <div>
            <Link to={BILLING_PATH} className={cn(BUTTON_PRIMARY, "h-auto whitespace-normal py-2.5 text-center")}>
              Update your card
            </Link>
          </div>
        </div>
      )}

      {view.state === "completed" && <p className="text-base font-semibold text-emerald-200">Paid in full. Thank you.</p>}

      {view.state === "open" && <OpenIntro plan={view} />}

      {view.state === "card_on_file" && (
        <p>
          <CardOnFile card={view.card} />{" "}
          {next && (
            <>
              Your first payment of <span className={FIGURE}>{money(next.amountCents)}</span> will be charged on{" "}
              <span className={FIGURE}>{formatRetreatDate(next.dueDate)}</span>.
            </>
          )}
        </p>
      )}

      {(view.state === "billing" || view.state === "past_due") && (
        <div className="flex flex-col gap-2">
          <p>
            <CardOnFile card={view.card} />
          </p>
          {view.state === "billing" && next && (
            <p>
              Your next payment of <span className={FIGURE}>{money(next.amountCents)}</span> will be charged on{" "}
              <span className={FIGURE}>{formatRetreatDate(next.dueDate)}</span>.
            </p>
          )}
          {view.state === "billing" && (
            <p>
              <Link to={BILLING_PATH} className={LINK}>
                Update your card
              </Link>
            </p>
          )}
        </div>
      )}

      <PlanFigures plan={view} roomLabel={roomLabel ?? null} />
      <PlanSchedule plan={view} />

      {view.state === "open" &&
        (readOnly ? (
          <div className="rounded-xl border border-dashed border-white/25 px-4 py-3 text-sm">
            <p className="italic text-orchid-dim">
              Preview only. Your guest sees an “Add your card” button here, then a secure card form and this agreement to tick. No card can be added from the preview.
            </p>
            {view.authorizationText && <p className="mt-2 text-white/90">{view.authorizationText}</p>}
          </div>
        ) : (
          <OpenPlanForm plan={view} slug={slug} onFresh={setFresh} onConfirmed={handleConfirmed} onReload={onReload} />
        ))}

      <p className="text-xs text-orchid-dim">
        Card details are held securely by Stripe, our payment provider, never by us. Questions?{" "}
        <a className={LINK} href={`mailto:${supportEmail}`}>
          {supportEmail}
        </a>
      </p>
    </div>
  );
}

function OpenIntro({ plan }: { plan: BalancePlanView }) {
  const first = nextScheduledPayment(plan);
  const amount = formatCents(first?.amountCents ?? plan.installmentCents, plan.currency);
  return (
    <p>
      Add your card to pay your remaining balance in monthly payments.{" "}
      {plan.chargesToday ? (
        <>
          Your first payment of <span className={FIGURE}>{amount}</span> is charged today, as soon as you save your card. The rest follow automatically on the dates below.
        </>
      ) : (
        <>
          Your first payment of <span className={FIGURE}>{amount}</span> will be charged on{" "}
          <span className={FIGURE}>{formatRetreatDate(first?.dueDate ?? plan.firstChargeDate)}</span>, and the rest follow automatically on the dates below.
        </>
      )}
    </p>
  );
}

function CardOnFile({ card }: { card: BalancePlanView["card"] }) {
  if (!card) return <>Your card is on file.</>;
  return (
    <>
      Card on file: <span className="font-semibold text-white">{cardBrandLabel(card.brand)}</span> ending{" "}
      <span className={FIGURE}>{card.last4}</span>.
    </>
  );
}

function PlanFigures({ plan, roomLabel }: { plan: BalancePlanView; roomLabel: string | null }) {
  const money = (cents: number) => formatCents(cents, plan.currency);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {roomLabel && <Figure label="Your room" value={roomLabel} />}
      <Figure label="Agreed retreat price" value={money(plan.agreedTotalCents)} />
      {plan.discountCents > 0 && <Figure label="Discount (already included)" value={money(plan.discountCents)} note={plan.discountNote} />}
      <Figure label="Paid so far" value={money(plan.priorPaidCents + plan.paidHereCents)} />
      <Figure label="Balance remaining" value={money(plan.remainingCents)} />
      {plan.state !== "completed" && plan.installmentCount > 0 && (
        <Figure
          label="Monthly payments"
          value={`${money(plan.installmentCents)} × ${plan.installmentCount} ${plan.installmentCount === 1 ? "payment" : "payments"}`}
        />
      )}
      {plan.finalDueDate && <Figure label="Final payment deadline" value={formatRetreatDate(plan.finalDueDate)} />}
    </dl>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-white/10 px-4 py-3">
      <dt className="text-xs text-orchid-dim">{label}</dt>
      <dd className={cn("mt-0.5 text-base", FIGURE)}>{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-orchid-dim">{note}</dd>}
    </div>
  );
}

const ROW_STATUS: Record<BalancePlanScheduleRow["status"], { label: string; className: string }> = {
  paid: { label: "Paid", className: "text-emerald-200" },
  scheduled: { label: "Scheduled", className: "text-orchid-dim" },
  failed: { label: "Did not go through", className: "font-medium text-amber-200" },
  skipped: { label: "Not taken", className: "text-orchid-dim" },
};

/** The same table the read-only payments summary uses for its instalments. */
function PlanSchedule({ plan }: { plan: BalancePlanView }) {
  if (plan.schedule.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-sm">
        <caption className="sr-only">Payment schedule</caption>
        <thead className="text-xs text-orchid-dim">
          <tr>
            <th scope="col" className="py-2 pr-4 font-semibold">Payment</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Due</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Amount</th>
            <th scope="col" className="py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.07]">
          {plan.schedule.map((row) => {
            const status = ROW_STATUS[row.status] ?? ROW_STATUS.scheduled;
            return (
              <tr key={row.sequence}>
                <td className={cn("py-2 pr-4", FIGURE)}>{row.sequence}</td>
                <td className="py-2 pr-4 text-white/85">{formatRetreatDate(row.dueDate)}</td>
                <td className={cn("py-2 pr-4", FIGURE)}>{formatCents(row.amountCents, plan.currency)}</td>
                <td className="py-2">
                  <span className={status.className}>{status.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────── adding a card (state open) ────────────────────── */

type Stage = "start" | "opening" | "card" | "finishing" | "retry";

function OpenPlanForm({
  plan,
  slug,
  onFresh,
  onConfirmed,
  onReload,
}: {
  /** What the panel is showing: the plan sent with the SetupIntent while the card form is open. */
  plan: BalancePlanView;
  slug: string;
  /** Hands the panel the plan that came with a new SetupIntent; null when the card form closes. */
  onFresh: (plan: BalancePlanView | null) => void;
  onConfirmed: (result: { balancePlan: BalancePlanView; charged: boolean }) => void;
  onReload?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("start");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // A SetupIntent that succeeded at Stripe but is not saved here yet, with the sentence she agreed to.
  const [pending, setPending] = useState<{ setupIntentId: string; authorizationText: string } | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const returnHandled = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const refocusStart = useRef(false);

  // When the card form closes, focus goes back to the button that opened it.
  useEffect(() => {
    if (stage !== "start" || !refocusStart.current) return;
    refocusStart.current = false;
    startButton.current?.focus();
  }, [stage]);

  function settle(outcome: ConfirmOutcome) {
    if (outcome.kind === "confirmed") {
      forgetAgreement(slug);
      onConfirmed(outcome);
      return;
    }
    setError(outcome.message);
    if (outcome.kind === "unfinished") {
      // No reload here: a failed reload could take this "Try again" away with it.
      // The same SetupIntent goes again, with the same sentence she agreed to.
      setPending({ setupIntentId: outcome.setupIntentId, authorizationText: outcome.authorizationText });
      setStage("retry");
      return;
    }
    // A refused card cannot be sent again, and a changed schedule has to be read
    // again: the next try needs a fresh SetupIntent and the plan as it now stands.
    forgetAgreement(slug);
    setClientSecret(null);
    onFresh(null);
    setPending(null);
    refocusStart.current = true;
    setStage("start");
    // The plan may have moved on at the server (or picked up a new problem note).
    onReload?.();
  }
  // The latest `settle`, for the answer that arrives after the effect below has long since run.
  const settleRef = useRef(settle);
  useEffect(() => {
    settleRef.current = settle;
  });

  // Back from a bank check (3-D Secure). The card was confirmed at Stripe while
  // this page was away, so the last step, telling our server, happens here, once.
  useEffect(() => {
    if (returnHandled.current) return;
    const returned = takeStripeReturn();
    if (!returned) return;
    returnHandled.current = true;

    const agreement = recallAgreement(slug);
    forgetAgreement(slug);
    document.getElementById("payments")?.scrollIntoView({ block: "start" });

    if (!returned.succeeded) {
      setError(COPY.bankDidNotApprove);
      return;
    }
    if (!agreement || agreement.setupIntentId !== returned.setupIntentId) {
      // No proof the box was ticked for this card, or of the sentence beside it: ask again rather than assume.
      setError(COPY.agreeAgain);
      return;
    }
    inFlight.current = true;
    setStage("finishing");
    // The sentence sent is the one she ticked before the bank check, kept in the
    // note. If the plan changed while she was away the server says so (409).
    // Deliberately not cancelled on cleanup: this is the only answer we will get.
    void confirmBalancePlanCard(slug, returned.setupIntentId, agreement.authorizationText).then((outcome) => {
      inFlight.current = false;
      settleRef.current(outcome);
    });
  }, [slug]);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStage("opening");
    setError("");
    try {
      const session = await memberRetreatsApi.balancePlanSetupIntent(slug);
      // No card form without the plan it belongs to: the form must never fall
      // back to the sentence from the earlier dashboard load.
      if (!session.clientSecret || !session.balancePlan || session.balancePlan.state !== "open" || !session.balancePlan.authorizationText) {
        throw new Error("");
      }
      onFresh(session.balancePlan);
      setClientSecret(session.clientSecret);
      setStage("card");
    } catch (caught) {
      setError(sentenceOf(caught) || COPY.couldNotOpen);
      setStage("start");
    } finally {
      inFlight.current = false;
    }
  }

  async function retry() {
    if (inFlight.current || !pending) return;
    inFlight.current = true;
    setStage("finishing");
    setError("");
    const outcome = await confirmBalancePlanCard(slug, pending.setupIntentId, pending.authorizationText);
    inFlight.current = false;
    settle(outcome);
  }

  // One sentence at a time: our own message for this try, else the note the server kept from the last one.
  const alert = error || (stage === "start" || stage === "opening" || stage === "card" ? plan.problem : "");

  if (!stripeConfigured()) {
    return (
      <p role="alert" className={ALERT}>
        Card payments are unavailable at the moment. Please email us and we will sort it out.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {alert && (
          <p role="alert" className={ALERT}>
            {alert}
          </p>
        )}
      </div>

      {(stage === "start" || stage === "opening") && (
        <div>
          <button ref={startButton} type="button" className={BUTTON_PRIMARY} disabled={stage === "opening"} onClick={() => void start()}>
            {stage === "opening" && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {stage === "opening" ? "Opening the card form" : "Add your card"}
          </button>
        </div>
      )}

      {stage === "card" && clientSecret && (
        <CardFormFrame
          key={clientSecret}
          plan={plan}
          slug={slug}
          clientSecret={clientSecret}
          onSettled={settle}
          onCancel={() => {
            forgetAgreement(slug);
            setClientSecret(null);
            onFresh(null);
            setError("");
            refocusStart.current = true;
            setStage("start");
          }}
        />
      )}

      {stage === "finishing" && (
        <p role="status" className="flex items-center gap-2.5 text-sm text-orchid-dim">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Saving your card. Please keep this page open.
        </p>
      )}

      {stage === "retry" && (
        <div>
          <button type="button" className={BUTTON_PRIMARY} onClick={() => void retry()}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

/** Stripe's Elements provider around the card fields; Stripe.js loads only once the guest asks for the form. */
function CardFormFrame(props: BalancePlanCardFieldsProps) {
  const stripePromise = useMemo(() => getStripe(), []);
  const siteTheme = useSiteTheme();
  const options = useMemo<StripeElementsOptions>(
    () => ({ clientSecret: props.clientSecret, appearance: appearanceForTheme(siteTheme) }),
    [props.clientSecret, siteTheme],
  );
  if (!stripePromise) return null;
  return (
    <div className="sm:rounded-xl sm:border sm:border-white/10 sm:p-5">
      <Elements stripe={stripePromise} options={options}>
        <BalancePlanCardFields {...props} />
      </Elements>
    </div>
  );
}

export interface BalancePlanCardFieldsProps {
  /** The plan that came back with this SetupIntent, never the earlier dashboard load. */
  plan: BalancePlanView;
  slug: string;
  clientSecret: string;
  onSettled: (outcome: ConfirmOutcome) => void;
  onCancel: () => void;
}

/** The card fields, the agreement and the save button. Must render inside Stripe's `<Elements>`. */
export function BalancePlanCardFields({ plan, slug, clientSecret, onSettled, onCancel }: BalancePlanCardFieldsProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const checkboxRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const agreeId = useId();
  const errorId = `${agreeId}-error`;

  const firstAmount = formatCents(nextScheduledPayment(plan)?.amountCents ?? plan.installmentCents, plan.currency);
  const submitLabel = plan.chargesToday ? `Save card and pay ${firstAmount} now` : "Save card";
  // One variable for the sentence on screen and the sentence sent: they cannot differ.
  const consentSentence = plan.authorizationText;

  // The button that opened this form is gone; put focus on the form that replaced it.
  useEffect(() => {
    formRef.current?.focus();
  }, []);

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    const outcome = await submitBalancePlanCard({
      agreed,
      stripe,
      elements,
      slug,
      clientSecret,
      authorizationText: consentSentence,
      returnUrl: balancePlanReturnUrl(window.location.origin, slug),
    });
    inFlight.current = false;
    setSaving(false);
    if (outcome.kind === "needs_agreement") {
      setError(outcome.message);
      checkboxRef.current?.focus();
      return;
    }
    if (outcome.kind === "card_error") {
      setError(outcome.message);
      return;
    }
    onSettled(outcome);
  }

  return (
    <form
      ref={formRef}
      tabIndex={-1}
      className="flex flex-col gap-4 outline-none"
      noValidate
      aria-label="Add your card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <PaymentElement options={{ layout: { type: "tabs", defaultCollapsed: false } }} />

      <label htmlFor={agreeId} className="flex min-h-[2.75rem] cursor-pointer items-start gap-3 text-sm text-white/90">
        <input
          ref={checkboxRef}
          id={agreeId}
          type="checkbox"
          required
          aria-required="true"
          aria-describedby={error ? errorId : undefined}
          checked={agreed}
          disabled={saving}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[#C9A24B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        />
        <span>{consentSentence}</span>
      </label>

      <div aria-live="polite">
        {error && (
          <p id={errorId} role="alert" className={ALERT}>
            {error}
          </p>
        )}
        {saving && (
          <p role="status" className="text-xs text-orchid-dim">
            Saving your card. Please keep this page open.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className={cn(BUTTON_PRIMARY, "h-auto w-full whitespace-normal py-2.5 text-center sm:w-auto")}
          disabled={saving || !stripe || !elements}
        >
          {saving && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />}
          {submitLabel}
        </button>
        <button type="button" className={cn(BUTTON_OUTLINE, "w-full sm:w-auto")} disabled={saving} onClick={onCancel}>
          Not now
        </button>
      </div>
    </form>
  );
}
