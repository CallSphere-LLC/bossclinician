/**
 * Billing & purchases client.
 *
 * Sits on `memberRequest` so it shares the one access token, the one
 * single-flight refresh and the one error shape with every other member
 * screen. Nothing here manages auth; it only knows the shape of the money.
 *
 * Every amount crossing this boundary is an integer of minor currency units
 * and every total is calculated server-side. The client never multiplies an
 * instalment by a count or subtracts a refund from a total: the backend owns
 * that arithmetic, and a second implementation up here is how the two figures
 * start disagreeing on a customer's receipt.
 */

import { memberRequest } from "@/lib/memberApi";
import { formatCurrency } from "@/lib/format";

/* ── Shared vocabulary ──────────────────────────────────────────────────── */

export type BillingInterval = "day" | "week" | "month" | "year";

/* ── The card on file ───────────────────────────────────────────────────── */

export interface CardOnFile {
  /** "Visa", "Mastercard" — already title-cased for display by the server. */
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export interface CardOnFileResponse {
  card: CardOnFile | null;
}

/** Where to send the member to type a new card. Always a Stripe-hosted page. */
export interface CardUpdateSession {
  url: string;
}

/* ── Subscriptions ──────────────────────────────────────────────────────── */

export type SubscriptionState =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled"
  | "incomplete"
  | "unpaid";

export interface MemberSubscription {
  id: number;
  /** Copied at purchase, so a renamed offer does not rewrite history. */
  title: string;
  state: SubscriptionState;
  amountCents: number;
  currency: string;
  interval: BillingInterval;
  intervalCount: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  pausedAt: string | null;
  canceledAt: string | null;
}

/**
 * Why someone left, captured as a fixed set rather than free text: the whole
 * point of asking is being able to count the answers later.
 *
 * The values are what the server stores; only the labels are ever on screen.
 */
export const CANCEL_REASONS = [
  { value: "too_expensive", label: "It costs more than I can spend right now" },
  { value: "not_using", label: "I am not using it" },
  { value: "missing_feature", label: "Something I needed is missing" },
  { value: "found_alternative", label: "I found something that suits me better" },
  { value: "temporary_pause", label: "I only need a break for a while" },
  { value: "other", label: "Something else" },
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number]["value"];

export interface CancelSubscriptionInput {
  reason: CancelReason;
  /** Optional free text. Sent trimmed, or omitted when the member left it blank. */
  feedback?: string;
}

/* ── Payment plans ──────────────────────────────────────────────────────── */

export type PaymentPlanState = "active" | "completed" | "past_due" | "canceled";

export interface MemberPaymentPlan {
  id: number;
  title: string;
  state: PaymentPlanState;
  installmentCents: number;
  installmentCount: number;
  installmentsPaid: number;
  /** Server-calculated so it always reconciles with the charges taken. */
  totalCents: number;
  remainingCents: number;
  currency: string;
  interval: BillingInterval;
  intervalCount: number;
  nextChargeAt: string | null;
  completedAt: string | null;
}

/* ── Invoices ───────────────────────────────────────────────────────────── */

export type InvoiceState = "paid" | "open" | "void" | "uncollectible" | "draft";

export interface MemberInvoice {
  id: number;
  /** Human invoice number for an expense claim. Empty when none was issued. */
  number: string;
  description: string;
  amountPaidCents: number;
  currency: string;
  state: InvoiceState;
  paidAt: string | null;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Stripe-hosted, unguessable, safe to link straight from the page. */
  hostedInvoiceUrl: string;
  pdfUrl: string;
}

/* ── Purchases ──────────────────────────────────────────────────────────── */

export type PurchaseState = "paid" | "pending" | "failed" | "expired";

export interface PurchaseItem {
  id: number;
  title: string;
  quantity: number;
  amountCents: number;
  /** Where this landed in the library. Empty when it is not a thing to open. */
  libraryPath: string;
}

export interface PurchaseRefund {
  id: number;
  amountCents: number;
  refundedAt: string;
  /** Whether the refund also closed access to what was bought. */
  revokedAccess: boolean;
}

export interface MemberPurchase {
  id: number;
  title: string;
  purchasedAt: string;
  state: PurchaseState;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  refundedCents: number;
  currency: string;
  /** The code the member typed, shown back to them beside their discount. */
  couponCode: string;
  cardBrand: string;
  cardLast4: string;
  items: PurchaseItem[];
  refunds: PurchaseRefund[];
  /** Stripe-hosted receipt. Empty for an order Yvette entered by hand. */
  receiptUrl: string;
}

/* ── Calls ──────────────────────────────────────────────────────────────── */

/*
 * Every path here hangs off the already-authenticated `/api/member` router, and
 * every read is scoped to the signed-in member server-side — the client never
 * passes an owner along with a row it wants.
 *
 * The billing screen also hides the write actions while an admin is viewing
 * someone's account, but that is a courtesy, not the boundary: the server
 * refuses a state change made through an impersonated session, so nothing here
 * depends on the button being disabled.
 */
export const billingApi = {
  cardOnFile: () => memberRequest<CardOnFileResponse>("/member/billing/payment-method"),

  /** Returns the hosted page to send the member to; it does not save a card. */
  startCardUpdate: () =>
    memberRequest<CardUpdateSession>("/member/billing/payment-method", { method: "PUT" }),

  subscriptions: () => memberRequest<MemberSubscription[]>("/member/billing/subscriptions"),

  /** Cancels at the end of the period already paid for, never mid-period. */
  cancelSubscription: (id: number, input: CancelSubscriptionInput) =>
    memberRequest<MemberSubscription>(`/member/billing/subscriptions/${id}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    }),

  pauseSubscription: (id: number) =>
    memberRequest<MemberSubscription>(`/member/billing/subscriptions/${id}/pause`, {
      method: "POST",
    }),

  resumeSubscription: (id: number) =>
    memberRequest<MemberSubscription>(`/member/billing/subscriptions/${id}/resume`, {
      method: "POST",
    }),

  paymentPlans: () => memberRequest<MemberPaymentPlan[]>("/member/billing/payment-plans"),

  invoices: () => memberRequest<MemberInvoice[]>("/member/billing/invoices"),

  purchases: () => memberRequest<MemberPurchase[]>("/member/purchases"),
};

/* ── Turning the data into English ──────────────────────────────────────── */

/*
 * These live beside the types rather than in a page because the billing screen
 * and the cancellation dialog have to describe the same subscription in the
 * same words — a plan that reads "$49.00 a month" on the page and "$49/mo" in
 * the dialog looks like two different plans at the moment someone is deciding
 * whether to keep it.
 */

const INTERVAL_NOUN: Record<BillingInterval, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

/** "a month" / "every 3 months" — reads naturally after a price. */
export function describeInterval(interval: BillingInterval, count: number): string {
  const noun = INTERVAL_NOUN[interval];
  if (count <= 1) return `a ${noun}`;
  return `every ${count} ${noun}s`;
}

/** "$49.00 a month" */
export function describeRecurringPrice(
  amountCents: number,
  currency: string,
  interval: BillingInterval,
  intervalCount: number,
): string {
  return `${formatCurrency(amountCents, currency)} ${describeInterval(interval, intervalCount)}`;
}

/** "3 payments of $1,250.00, one a month" */
export function describePlanShape(plan: MemberPaymentPlan): string {
  const each = formatCurrency(plan.installmentCents, plan.currency);
  const cadence =
    plan.intervalCount <= 1
      ? `one ${describeInterval(plan.interval, 1)}`
      : describeInterval(plan.interval, plan.intervalCount);
  return `${plan.installmentCount} payments of ${each}, ${cadence}`;
}
