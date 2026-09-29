import { useEffect, useState } from "react";
import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * Purchases as Kajabi shows them — the admin client for /admin/purchases.
 *
 * A purchase is what someone bought or was given (a one-time purchase, a
 * payment plan, a grant), not a payment: Norma Sanchez's Shared Room plan is
 * one purchase with three payments so far, and Kajabi says "1", so this does.
 * Every word on a card ("1/10 payments completed", "Payments paused", the plan
 * sentence) is composed on the server (services/purchaseModel.ts), where it is
 * unit-tested against Kajabi's own wording; the screens only lay it out and put
 * dates on the site's clock.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string): Promise<T> {
  const res = await sessionFetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

/* ── Shapes (mirror backend/src/services/purchaseModel.ts) ─────────────── */

export type PurchaseKind = "one_time" | "payment_plan" | "subscription" | "grant" | "free";

export type PurchaseStatus =
  | "complete"
  | "active"
  | "paused"
  | "past_due"
  | "completed"
  | "canceled"
  | "granted"
  | "refunded";

/** The admin's Badge tones, chosen by the server so a status is one colour everywhere. */
export type PurchaseTone = "neutral" | "plum" | "gold" | "green" | "red" | "blue" | "slate";

export interface PurchaseBilling {
  status: PurchaseStatus;
  label: string;
  tone: PurchaseTone;
  /** "1/10 payments completed". */
  progressText: string | null;
  /** Who paused it — "Yvette Howard (…)" — shown as "by …". */
  pausedBy: string | null;
  endedAt: string | null;
}

export interface PurchaseAccess {
  revoked: boolean;
  revokedBy: string | null;
  /** `YYYY-MM-DD`. */
  startsOn: string;
  endsOn: string | null;
}

export interface PurchasePlan {
  startedAt: string;
  setupFeeCents: number;
  setupFeeText: string | null;
  /** "Monthly (10 payments of $400.00 USD)". */
  billingIntervalText: string | null;
  installmentsTotal: number | null;
  paymentsCompleted: number | null;
  remainingPayments: number | null;
  /** "$250.00 USD on 2026-10-20" or "Payments paused". */
  upcomingText: string | null;
}

export interface Purchase {
  /** `12`, `order-45` or `grant-7` — the id in /admin/purchases/:id. */
  key: string;
  kind: PurchaseKind;
  status: PurchaseStatus;
  source: string;
  offerId: number | null;
  offerTitle: string;
  offerThumbnailUrl: string | null;
  purchasedAt: string;
  /** "Paid on" or "Granted on". */
  dateLabel: string;
  /** After "Total": "$127.00 USD", "Granted", or the plan sentence. */
  totalText: string;
  priceText: string;
  /** "Granted" — the pill in front of a grant's $0.00. */
  pricePill: string | null;
  quantity: number;
  currency: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  billing: PurchaseBilling | null;
  access: PurchaseAccess;
  plan: PurchasePlan | null;
  /** Kajabi's order number (#1004) — shown on the detail page only, as Kajabi does. */
  orderNo: string | null;
  gift: boolean;
  note: string;
  /**
   * The coupon, when one is recorded (our checkout's order, or the Kajabi
   * import's `meta.coupon_code`), drawn as Kajabi's "Order summary":
   * Subtotal, Discount <CODE>, Total. All three are null when there is none.
   */
  couponCode: string | null;
  discountCents: number | null;
  /** Before the discount; null for a plan, whose total is every instalment. */
  subtotalCents: number | null;
}

export interface ContactPurchaseList {
  /** Kajabi's "Total offers": a plan is one, however many instalments; a grant counts. */
  purchaseCount: number;
  purchases: Purchase[];
}

export interface PurchaseTransaction {
  key: string;
  amountCents: number;
  amountText: string;
  status: "paid" | "refunded" | "failed" | "pending" | "upcoming";
  statusText: string;
  at: string;
}

export interface PurchaseCustomer {
  name: string;
  email: string;
  address: string[];
  phone: string | null;
  /** "Visa •••• 4242", when a card is on file. */
  paymentMethod: string | null;
}

export interface PurchaseDetail {
  /** "Payment Plan", "Purchase", "Granted offer"… */
  heading: string;
  purchase: Purchase;
  contact: { id: number; name: string; email: string } | null;
  customer: PurchaseCustomer;
  items: Purchase[];
  transactions: PurchaseTransaction[];
}

/* ── Calls ────────────────────────────────────────────────────────────── */

export const purchasesApi = {
  forContact: (contactId: number) => request<ContactPurchaseList>(`/admin/purchases/contact/${contactId}`),
  count: (contactId: number) =>
    request<{ purchaseCount: number }>(`/admin/purchases/contact/${contactId}/count`),
  get: (key: string) => request<PurchaseDetail>(`/admin/purchases/${encodeURIComponent(key)}`),
};

/**
 * How many purchases a person has, counted as Kajabi counts them — for the
 * contact drawer's "Total purchases" and the profile's Lifecycle number, which
 * used to count payments (Norma: 3 where Kajabi says 1).
 *
 * Null while loading or when it could not be read; the caller shows its
 * skeleton or falls back to what it had. `refreshKey` refetches when it
 * changes (pass the loaded person, so a manual purchase updates the number).
 */
export function usePurchaseCount(contactId: number | null, refreshKey?: unknown): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (contactId === null || !Number.isInteger(contactId)) return;
    let current = true;
    purchasesApi
      .count(contactId)
      .then((body) => current && setCount(body.purchaseCount))
      .catch(() => current && setCount(null));
    return () => {
      current = false;
    };
  }, [contactId, refreshKey]);
  return count;
}

/* ── Pure helpers the screens share ───────────────────────────────────── */

/**
 * One card per Kajabi order: purchases that share an order number are drawn
 * as one card with several items, as Kajabi draws a unified order. Anything
 * without an order number is a card of its own. Order is preserved (the
 * server sends newest first).
 */
export function groupPurchaseCards(purchases: Purchase[]): Purchase[][] {
  const cards: Purchase[][] = [];
  const byOrder = new Map<string, Purchase[]>();
  for (const purchase of purchases) {
    // Plans keep their own card even when Kajabi gave them an order number.
    const groupable = purchase.orderNo !== null && (purchase.kind === "one_time" || purchase.kind === "free");
    const key = groupable ? `${purchase.source}:${purchase.orderNo}` : null;
    const existing = key ? byOrder.get(key) : undefined;
    if (existing) {
      existing.push(purchase);
      continue;
    }
    const card = [purchase];
    cards.push(card);
    if (key) byOrder.set(key, card);
  }
  return cards;
}

/** "Aug 10, 2026 - Aug 24, 2026", or just the start while access is open-ended. */
export function accessDateText(access: PurchaseAccess, formatDay: (day: string) => string): string {
  const start = formatDay(access.startsOn);
  return access.endsOn ? `${start} - ${formatDay(access.endsOn)}` : start;
}

/** The status pill colour of one Transactions row. */
export function transactionTone(status: PurchaseTransaction["status"]): PurchaseTone {
  switch (status) {
    case "paid":
      return "green";
    case "upcoming":
      return "blue";
    case "failed":
      return "red";
    case "pending":
      return "gold";
    default:
      return "slate";
  }
}
