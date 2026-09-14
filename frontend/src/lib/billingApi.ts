/**
 * Billing & purchases client.
 *
 * Sits on `memberRequest` so it shares the one access token, the one
 * single-flight refresh and the one error shape with every other member screen.
 * Nothing here manages auth; it only knows the shape of the money.
 *
 * Every amount crossing this boundary is an integer of minor currency units and
 * every total is calculated server-side. Nothing in this file multiplies an
 * instalment by a count or subtracts a refund from a total: the backend owns
 * that arithmetic, and a second implementation up here is how two figures start
 * disagreeing on a customer's receipt.
 */

import { getAccessToken, memberRequest, MemberApiError } from "@/lib/memberApi";
import { formatCurrency } from "@/lib/format";

/* ── Subscriptions ──────────────────────────────────────────────────────── */

export interface MemberSubscription {
  id: number;
  /** Copied at purchase, so a renamed offer does not rewrite history. */
  planName: string;
  status: string;
  amountCents: number;
  currency: string;
  interval: string;
  intervalCount: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  endedAt: string | null;
  cancelReason: string;
  cancelFeedback: string;
  /** Null whenever nothing is due: paused, ending, or already ended. */
  nextChargeAt: string | null;
  nextChargeAmountCents: number | null;
  createdAt: string;
}

/**
 * Why someone is leaving, as a closed list.
 *
 * The options are served alongside the subscriptions rather than written out
 * here, because the endpoint validates the answer against its own enum — a
 * second copy in the frontend is a form that silently stops submitting the day
 * the two drift.
 */
export interface CancelReasonOption {
  value: string;
  label: string;
}

export interface SubscriptionsResponse {
  subscriptions: MemberSubscription[];
  cancelReasons: CancelReasonOption[];
}

export interface CancelSubscriptionInput {
  reason: string;
  /** Required for "something else", optional otherwise. Sent trimmed. */
  feedback?: string;
}

/* ── Payment plans ──────────────────────────────────────────────────────── */

export interface PlanInstallment {
  sequence: number;
  amountCents: number;
  dueAt: string | null;
  paidAt: string | null;
  status: string;
}

export interface MemberPaymentPlan {
  id: number;
  offerTitle: string;
  status: string;
  installmentCents: number;
  installmentCount: number;
  installmentsPaid: number;
  /** "2 of 3 payments made" — built server-side so every screen says it once. */
  progressLabel: string;
  currency: string;
  interval: string;
  intervalCount: number;
  remainingCents: number;
  remainingInstallmentCount: number;
  nextChargeAt: string | null;
  nextChargeAmountCents: number | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  installments: PlanInstallment[];
}

/* ── Invoices ───────────────────────────────────────────────────────────── */

export interface MemberInvoice {
  id: number;
  /** The reference an expense claim needs. Null when none was issued. */
  number: string | null;
  status: string;
  currency: string;
  amountPaidCents: number;
  amountDueCents: number;
  taxCents: number;
  /** Stripe's own copies. Null for anything invoiced outside Stripe. */
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  orderId: number | null;
  subscriptionId: number | null;
  paymentPlanId: number | null;
  /** Our own printable receipt (API). Its page is `receiptPaths`. */
  receiptUrl: string;
  /**
   * The same receipt as a PDF, for the payments we raised the document for
   * ourselves. Null for a Stripe renewal, which carries Stripe's own `pdfUrl`.
   */
  receiptPdfUrl: string | null;
}

export interface InvoicesPage {
  invoices: MemberInvoice[];
  total: number;
  limit: number;
  offset: number;
}

/* ── Purchases ──────────────────────────────────────────────────────────── */

export interface OrderItem {
  title: string;
  /** Whether this line was the offer itself, an added extra, or an upsell. */
  kind: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface MemberOrder {
  id: number;
  title: string;
  offerSlug: string | null;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  refundedCents: number;
  couponCode: string;
  source: string;
  createdAt: string;
  items: OrderItem[];
  /**
   * The receipt for this purchase, and the same thing as a PDF. Sent with the
   * order so the page never has to pair an order up with an invoice to find one
   * — which is what used to leave a purchase saying "ask us if you need a
   * receipt" under a heading promising a receipt for every purchase.
   */
  receiptUrl: string;
  receiptPdfUrl: string;
}

export interface OrderTransaction {
  id: number;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
  cardBrand: string;
  cardLast4: string;
  methodType: string;
  failureReason: string;
  occurredAt: string;
}

export interface OrderRefund {
  id: number;
  amountCents: number;
  currency: string;
  reason: string;
  /** Whether the refund also closed access to what it covered. */
  accessRemoved: boolean;
  createdAt: string;
}

export interface MemberOrderDetail extends MemberOrder {
  transactions: OrderTransaction[];
  refunds: OrderRefund[];
}

export interface OrdersPage {
  orders: MemberOrder[];
  total: number;
  limit: number;
  offset: number;
}

/* ── The card on file ───────────────────────────────────────────────────── */

/**
 * Where to send someone to type a new card.
 *
 * Stripe's hosted portal when one is configured, and a SetupIntent for our own
 * Payment Element when it is not. Exactly one of the two fields is filled in.
 */
export interface PaymentMethodSession {
  type: "portal" | "setup_intent";
  url: string | null;
  clientSecret: string | null;
}

/* ── Calls ──────────────────────────────────────────────────────────────── */

/*
 * Every path hangs off the already-authenticated `/api/member` router, and every
 * read is scoped to the signed-in member server-side — nothing here passes an
 * owner along with the row it wants.
 *
 * The billing screen also hides the write actions while an admin is viewing
 * someone's account, but that is a courtesy, not the boundary: the server
 * refuses a billing change made through an impersonated session, so nothing
 * depends on the button being disabled.
 */

interface PageQuery {
  limit?: number;
  offset?: number;
}

function pageQuery({ limit, offset }: PageQuery): string {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const billingApi = {
  subscriptions: () => memberRequest<SubscriptionsResponse>("/member/billing/subscriptions"),

  /** Ends at the close of the period already paid for, never the same day. */
  cancelSubscription: (id: number, input: CancelSubscriptionInput) =>
    memberRequest<MemberSubscription>(`/member/billing/subscriptions/${id}/cancel`, {
      method: "POST",
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

  paymentPlans: () =>
    memberRequest<{ paymentPlans: MemberPaymentPlan[] }>("/member/billing/payment-plans"),

  invoices: (page: PageQuery = {}) =>
    memberRequest<InvoicesPage>(`/member/billing/invoices${pageQuery(page)}`),

  orders: (page: PageQuery = {}) =>
    memberRequest<OrdersPage>(`/member/billing/orders${pageQuery(page)}`),

  order: (id: number) => memberRequest<MemberOrderDetail>(`/member/billing/orders/${id}`),

  /** Starts a card update; it does not save anything by itself. */
  startPaymentMethodUpdate: () =>
    memberRequest<PaymentMethodSession>("/member/billing/payment-method/session", {
      method: "POST",
    }),

  /** Takes back a cancellation that has not happened yet. */
  keepSubscription: (id: number) =>
    memberRequest<MemberSubscription>(`/member/billing/subscriptions/${id}/keep`, {
      method: "POST",
    }),

  /**
   * Finishes a card update: makes the card Stripe just saved the one every plan
   * charges, and tries any overdue payment on it straight away.
   */
  confirmPaymentMethod: (setupIntentId: string) =>
    memberRequest<CardAdoption>("/member/billing/payment-method/confirm", {
      method: "POST",
      body: JSON.stringify({ setupIntentId }),
    }),
};

/** What `confirmPaymentMethod` did with the new card. */
export interface CardAdoption {
  /** Memberships and payment plans now charging the new card. */
  updated: number;
  /** Overdue payments tried on the new card, and how many went through. */
  retried: number;
  paid: number;
}

/* ── Receipts ───────────────────────────────────────────────────────────── */

/*
 * Every receipt has a real address, and nothing here opens a window.
 *
 * Member requests are Bearer-authenticated with a token held in memory, and the
 * refresh cookie is scoped to /api/auth, so a plain link to the API would arrive
 * signed out. The receipt's permanent URL is therefore a page of this app —
 * /account/purchases/:orderId/receipt — which sits behind RequireMember (signed
 * out, it goes to /login and comes back), fetches the document with the token,
 * and shows it in the same tab. Its PDF lives at the same address plus `.pdf`,
 * and that one is served by the server: nginx sends it to the API, which answers
 * with the PDF as an attachment, authenticated by an HttpOnly cookie scoped to
 * /account/ (backend/src/auth/memberDocumentCookie.ts). So "Download PDF" is a
 * plain link. The app's own route for the `.pdf` address is only reached by
 * in-app navigation (coming back from /login); it downloads through a signed
 * link that lives for a few minutes — `downloadReceiptPdf` below.
 */

/** Which receipt: a purchase, by order, or a billing invoice. */
export type ReceiptTarget = { orderId: number } | { invoiceId: number };

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

/** The receipt's app pages and the API calls behind them. */
export function receiptPaths(target: ReceiptTarget): {
  /** Permanent, bookmarkable receipt page. */
  page: string;
  /** Permanent PDF address; opening it downloads the PDF. */
  pdfPage: string;
  html: string;
  link: string;
} {
  const page =
    "orderId" in target
      ? `/account/purchases/${target.orderId}/receipt`
      : `/account/billing/invoices/${target.invoiceId}/receipt`;
  const api =
    "orderId" in target
      ? `/member/billing/orders/${target.orderId}`
      : `/member/billing/invoices/${target.invoiceId}`;
  return { page, pdfPage: `${page}.pdf`, html: `${api}/receipt`, link: `${api}/receipt-link` };
}

/** The receipt a route names, or null for an id that cannot be one. */
export function readReceiptTarget(params: {
  orderId?: string;
  invoiceId?: string;
}): ReceiptTarget | null {
  const parse = (raw: string | undefined): number | null =>
    raw !== undefined && /^[1-9]\d{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647
      ? Number(raw)
      : null;
  const orderId = parse(params.orderId);
  if (orderId !== null) return { orderId };
  const invoiceId = parse(params.invoiceId);
  return invoiceId === null ? null : { invoiceId };
}

/**
 * The receipt document's markup.
 *
 * A document, not JSON, so it cannot travel through `memberRequest` — but one
 * ordinary call through `memberRequest` is what refreshes an expired token: a
 * second refresh implementation here would rotate the cookie behind that one's
 * back, and each would then read the other's rotation as a stolen token. A
 * refresh that fails signs the member out, and RequireMember sends them to log
 * in and back to this receipt.
 */
export async function fetchReceiptHtml(target: ReceiptTarget): Promise<string> {
  const url = `${API_BASE}${receiptPaths(target).html}`;
  const send = async (): Promise<Response> => {
    const token = getAccessToken();
    return fetch(url, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  let res = await send();
  if (res.status === 401) {
    await memberRequest<unknown>("/auth/me");
    res = await send();
  }
  if (res.status === 404) throw new MemberApiError("We couldn't find that receipt.", 404);
  if (!res.ok) throw new MemberApiError("We could not open that receipt.", res.status);
  return res.text();
}

/**
 * Downloads a receipt's PDF from this tab.
 *
 * Asks for a short-lived signed link with the member's token, then navigates
 * this tab to it. The response is an attachment, so the browser saves the file
 * and the page stays where it is — no popup to block, no blob to revoke.
 */
export async function downloadReceiptPdf(target: ReceiptTarget): Promise<void> {
  const { url } = await memberRequest<{ url: string; expiresAt: string; filename: string }>(
    receiptPaths(target).link,
    { method: "POST" },
  );
  // The server answers with its own /api path; re-rooted on API_BASE for a
  // build that talks to the API on another origin.
  window.location.assign(`${API_BASE}${url.replace(/^\/api(?=\/)/, "")}`);
}

/* ── Turning the data into English ──────────────────────────────────────── */

/*
 * These live beside the types rather than in a page because the billing screen
 * and the cancellation dialog have to describe the same plan in the same words
 * — one that reads "$49.00 a month" on the page and "$49/mo" in the dialog
 * looks like two different plans at the moment someone is deciding whether to
 * keep it.
 */

const INTERVAL_NOUN: Record<string, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

/** "a month" / "every 3 months" — reads naturally after a price. */
export function describeInterval(interval: string, count: number): string {
  const noun = INTERVAL_NOUN[interval];
  if (!noun) return count > 1 ? `every ${count} payments apart` : "regularly";
  if (count <= 1) return `a ${noun}`;
  return `every ${count} ${noun}s`;
}

/** "$49.00 a month" */
export function describeRecurringPrice(
  amountCents: number,
  currency: string,
  interval: string,
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

/**
 * The server's own wording wherever it sent some — it knows why it refused,
 * and it phrases its refusals for the customer rather than for a log.
 */
export function billingErrorMessage(err: unknown, fallback: string): string {
  return err instanceof MemberApiError && err.message ? err.message : fallback;
}
