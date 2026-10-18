import crypto from "crypto";
import type { BillingInterval } from "./pricing";
import {
  centsToUsd,
  usdToCents,
  type PayPalBillingCycle,
  type PayPalPlanBody,
  type PayPalSubscription,
  type PayPalSubscriptionTransaction,
} from "./paypalClient";

/**
 * The arithmetic of PayPal billing, kept free of the database and of PayPal
 * itself so it can be tested: what plan a recurring checkout is sold on, and
 * how many installments a subscription has paid.
 */

/* ------------------------------------------------------------------ plans */

/** PayPal's caps on interval_count per unit. */
export const MAX_INTERVAL_COUNT: Record<BillingInterval, number> = { day: 365, week: 52, month: 12, year: 1 };

/** Consecutive failures before PayPal suspends the subscription. */
export const PAYMENT_FAILURE_THRESHOLD = 3;

export class PayPalPlanError extends Error {}

export interface PlanSpecInput {
  offerId: number;
  pricingOptionId: number | null;
  title: string;
  currency: string;
  pricingType: string;
  interval: BillingInterval | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
  /** The order's priced lines, exactly as computeOrderTotal wrote them. */
  lines: Array<{ kind: string; amountCents: number }>;
  subtotalCents: number;
  discountCents: number;
  /** 'first' discounts one charge, 'forever' every charge; null without a coupon. */
  couponDuration: "first" | "forever" | null;
}

export interface PayPalPlanSpec {
  name: string;
  description: string;
  billingCycles: PayPalBillingCycle[];
  /** Bumps: one-off, charged once at activation. */
  setupFeeCents: number;
  /** The first billed cycle, after a 'first' coupon. */
  firstCycleCents: number;
  /** Every cycle after that. */
  recurringCents: number;
  /** What PayPal collects at activation: setup fee plus the first cycle unless there is a free trial. */
  dueAtActivationCents: number;
  /** Cycle sequences that are paid installments (everything but a free trial). */
  pricedSequences: number[];
  installmentCount: number | null;
  trialDays: number;
  hash: string;
}

export function frequency(interval: BillingInterval, count: number): PayPalBillingCycle["frequency"] {
  return { interval_unit: interval.toUpperCase() as PayPalBillingCycle["frequency"]["interval_unit"], interval_count: count };
}

export function price(cents: number): PayPalBillingCycle["pricing_scheme"] | undefined {
  return cents > 0 ? { fixed_price: { currency_code: "USD", value: centsToUsd(cents) } } : undefined;
}

/**
 * The PayPal billing plan for one recurring checkout, worked out from the
 * order the database priced.
 *
 * The figures follow what Stripe bills for the same order
 * (routes/public/stripeWebhook.ts `planInstallmentPricing`): the coupon's share
 * of the offer line comes off the first charge, and off every charge when the
 * coupon is 'forever'. A 'first' discount is a one-cycle TRIAL tenure at the
 * discounted price ahead of the REGULAR cycles. Bumps ride along once as the
 * plan's setup fee, net of their share of the discount, so the first payment is
 * the order's subtotal less its discount. Tax is not added to recurring
 * charges, matching the Stripe subscription path.
 *
 * A payment plan of N installments stops after N billed cycles (the discounted
 * TRIAL cycle counts as one); a membership's REGULAR cycle runs until cancelled
 * (`total_cycles: 0`).
 */
export function buildPayPalPlanSpec(input: PlanSpecInput): PayPalPlanSpec {
  if ((input.currency || "usd").toLowerCase() !== "usd") throw new PayPalPlanError("PayPal checkout supports US dollar offers only.");
  if (input.pricingType !== "subscription" && input.pricingType !== "payment_plan") throw new PayPalPlanError("This offer is not a subscription or payment plan.");
  if (!input.interval) throw new PayPalPlanError("This offer has no billing interval.");
  const intervalCount = input.intervalCount || 1;
  if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > MAX_INTERVAL_COUNT[input.interval]) {
    throw new PayPalPlanError("PayPal cannot bill on this offer's schedule. Please pay by card.");
  }
  if (!Number.isInteger(input.trialDays) || input.trialDays < 0 || input.trialDays > 365) {
    throw new PayPalPlanError("PayPal cannot run a trial this long. Please pay by card.");
  }
  const isPlan = input.pricingType === "payment_plan";
  if (isPlan && (!input.installmentCount || input.installmentCount < 2 || input.installmentCount > 999)) {
    throw new PayPalPlanError("This payment plan has no valid number of installments.");
  }

  const offerCents = input.lines.filter((line) => line.kind === "offer" || line.kind === "upsell").reduce((sum, line) => sum + line.amountCents, 0);
  const bumpCents = input.lines.filter((line) => line.kind === "bump").reduce((sum, line) => sum + line.amountCents, 0);
  const share = input.subtotalCents > 0
    ? Math.min(offerCents, Math.round((input.discountCents * offerCents) / input.subtotalCents))
    : 0;
  const firstCycleCents = Math.max(0, offerCents - share);
  const recurringCents = input.couponDuration === "forever" ? firstCycleCents : offerCents;
  const setupFeeCents = Math.max(0, bumpCents - Math.max(0, input.discountCents - share));
  if (recurringCents <= 0) throw new PayPalPlanError("This order has nothing to bill each cycle. Please pay by card.");

  const cycles: PayPalBillingCycle[] = [];
  const pricedSequences: number[] = [];
  if (input.trialDays > 0) {
    cycles.push({ frequency: frequency("day", input.trialDays), tenure_type: "TRIAL", sequence: cycles.length + 1, total_cycles: 1 });
  }
  const discountedFirst = firstCycleCents !== recurringCents;
  if (discountedFirst) {
    const sequence = cycles.length + 1;
    const scheme = price(firstCycleCents);
    cycles.push({ frequency: frequency(input.interval, intervalCount), tenure_type: "TRIAL", sequence, total_cycles: 1, ...(scheme ? { pricing_scheme: scheme } : {}) });
    // A first installment discounted to nothing is still an installment the
    // contract counts, exactly as Stripe's $0 opening invoice is.
    pricedSequences.push(sequence);
  }
  const regularSequence = cycles.length + 1;
  cycles.push({
    frequency: frequency(input.interval, intervalCount),
    tenure_type: "REGULAR",
    sequence: regularSequence,
    total_cycles: isPlan ? input.installmentCount! - (discountedFirst ? 1 : 0) : 0,
    pricing_scheme: price(recurringCents)!,
  });
  pricedSequences.push(regularSequence);

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const every = `${intervalCount > 1 ? `${intervalCount} ` : ""}${input.interval}${intervalCount > 1 ? "s" : ""}`;
  const description = (isPlan
    ? `${input.installmentCount} payments of ${money(recurringCents)} every ${every}`
    : `${money(recurringCents)} every ${every}`) + (input.trialDays > 0 ? ` after a ${input.trialDays}-day trial` : "");

  const name = (input.title || `Offer ${input.offerId}`).slice(0, 127);
  const hashed = {
    offerId: input.offerId,
    pricingOptionId: input.pricingOptionId,
    name,
    cycles,
    setupFeeCents,
    threshold: PAYMENT_FAILURE_THRESHOLD,
  };
  const hash = crypto.createHash("sha256").update(JSON.stringify(hashed)).digest("hex").slice(0, 40);

  return {
    name,
    description: description.slice(0, 127),
    billingCycles: cycles,
    setupFeeCents,
    firstCycleCents,
    recurringCents,
    dueAtActivationCents: setupFeeCents + (input.trialDays > 0 ? 0 : firstCycleCents),
    pricedSequences,
    installmentCount: isPlan ? input.installmentCount : null,
    trialDays: input.trialDays,
    hash,
  };
}

/** The plan create body for a spec, once the Catalog Product exists. */
export function payPalPlanBody(spec: PayPalPlanSpec, productId: string): PayPalPlanBody {
  return {
    product_id: productId,
    name: spec.name,
    description: spec.description,
    status: "ACTIVE",
    billing_cycles: spec.billingCycles,
    payment_preferences: {
      auto_bill_outstanding: true,
      ...(spec.setupFeeCents > 0 ? { setup_fee: { currency_code: "USD", value: centsToUsd(spec.setupFeeCents) } } : {}),
      // A bump that cannot be paid must not leave a subscription running
      // without it.
      setup_fee_failure_action: "CANCEL",
      payment_failure_threshold: PAYMENT_FAILURE_THRESHOLD,
    },
  };
}

export const toDate = (value: string | undefined | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function saleCents(sale: PayPalSubscriptionTransaction): number {
  return usdToCents(sale.amount_with_breakdown?.gross_amount?.value) ?? 0;
}

/** Billed cycles PayPal has completed, i.e. installments paid. */
export function paidCycleCount(sub: PayPalSubscription, spec: PayPalPlanSpec | null): number {
  const executions = sub.billing_info?.cycle_executions ?? [];
  const priced = spec?.pricedSequences ?? null;
  return executions
    .filter((cycle) => (priced ? priced.includes(cycle.sequence) : cycle.tenure_type === "REGULAR"))
    .reduce((sum, cycle) => sum + (cycle.cycles_completed || 0), 0);
}

/**
 * Installments paid: PayPal's cycle count, or the payments themselves when the
 * cycle count has not caught up yet. A setup fee collected as its own payment
 * at activation is not an installment.
 */
export function paidInstallmentCount(
  sub: PayPalSubscription,
  spec: PayPalPlanSpec | null,
  sales: PayPalSubscriptionTransaction[],
  openingEndsAt: number,
): number {
  const opening = sales.filter((sale) => (toDate(sale.time)?.getTime() ?? 0) <= openingEndsAt);
  // With a free trial the only opening payment is the setup fee; without one
  // it is separate only when PayPal took it as a payment of its own.
  const separateSetupFee =
    spec !== null && spec.setupFeeCents > 0 && (opening.length >= 2 || (spec.trialDays > 0 && opening.length >= 1)) ? 1 : 0;
  return Math.max(paidCycleCount(sub, spec), sales.length - separateSetupFee);
}

/** Whether PayPal is in a free trial right now (no billed cycle has completed). */
export function inFreeTrial(sub: PayPalSubscription, spec: PayPalPlanSpec | null): boolean {
  if (!spec || spec.trialDays <= 0) return false;
  return paidCycleCount(sub, spec) === 0 && (sub.billing_info?.cycle_executions ?? []).some((cycle) => cycle.sequence === 1 && cycle.tenure_type === "TRIAL" && cycle.cycles_completed === 0);
}

/** The local status for a PayPal membership. */
/** Whether PayPal reports unpaid failures (reset to 0 by a successful payment). */
export function paymentsBehind(sub: PayPalSubscription): boolean {
  return (sub.billing_info?.failed_payments_count ?? 0) > 0;
}

export function membershipStatus(sub: PayPalSubscription, spec: PayPalPlanSpec | null, pausedByMember: boolean): string {
  switch (sub.status) {
    case "ACTIVE":
      // PayPal keeps a subscription ACTIVE after a failed payment and only
      // suspends it at the failure threshold; until a payment clears it is
      // behind, exactly like a Stripe subscription in past_due.
      if (paymentsBehind(sub)) return "past_due";
      return inFreeTrial(sub, spec) ? "trialing" : "active";
    case "SUSPENDED":
      return pausedByMember ? "active" : "past_due";
    case "CANCELLED":
    case "EXPIRED":
      return "canceled";
    default:
      return "incomplete";
  }
}

