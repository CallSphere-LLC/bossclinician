/**
 * Storefront commerce client — offers, quotes, checkout, upsells and receipts.
 *
 * Sits on `memberRequest` for anything where being signed in changes the answer
 * (an order has to attach to the buyer's account, a coupon's once-per-customer
 * rule needs to know who is asking, and an offer can say "you already own
 * this"), and on plain `fetch` for the two calls that must work with no session
 * at all: the abandoned-cart ping and reading a guest's own receipt back with
 * the token issued at checkout.
 *
 * Every amount that crosses this boundary is an integer of minor currency units
 * calculated by the server, and most arrive pre-formatted beside the integer.
 * Nothing here multiplies, discounts or taxes anything: the price shown has to
 * be the price charged, and the only way to guarantee that is for one side to do
 * all the arithmetic. `/quote` exists precisely so the page never has to.
 */

import { MemberApiError, memberRequest } from "@/lib/memberApi";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

/* ── Shared vocabulary ──────────────────────────────────────────────────── */

export type PricingType = "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";
export type BillingInterval = "day" | "week" | "month" | "year";

/**
 * The shape of the commitment, separate from the figures on this order.
 *
 * `installmentCents` is one charge of a payment plan and `planTotalCents` the
 * whole contract — both are sent because showing only one of them is how a
 * customer comes to believe $1,250 was the total.
 */
export interface OfferBilling {
  pricingType: PricingType;
  interval: BillingInterval | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
  installmentCents: number | null;
  planTotalCents: number | null;
  minAmountCents: number | null;
}

export interface CustomFieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

export interface OfferOrderForm {
  collectTax: boolean;
  collectAddress: boolean;
  collectPhone: boolean;
  requireTerms: boolean;
  termsUrl: string;
  customFields: CustomFieldDef[];
}

export interface OfferProduct {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  kind: string;
}

export interface OfferBump {
  id: number;
  productId: number;
  title: string;
  description: string;
  amountCents: number;
  formattedAmount: string;
  product: {
    slug: string;
    title: string;
    thumbnailUrl: string;
    kind: string;
  };
}

export interface OfferUpsell {
  step: number;
  headline: string;
  body: string;
  offer: {
    slug: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    currency: string;
    pricingType: PricingType;
    amountCents: number;
  };
  downsell: {
    slug: string;
    title: string | null;
    amountCents: number | null;
  } | null;
}

export interface QuoteLine {
  kind: "offer" | "bump" | "upsell";
  offerId: number | null;
  productId: number | null;
  title: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  /** Server-rendered strings for the figures a buyer reads. */
  formatted: {
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
  };
}

export interface AppliedCoupon {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  /** 'first' discounts only the first charge; 'forever' discounts every one. */
  duration: "first" | "forever";
}

export interface OfferQuote extends Quote {
  offerSlug: string;
  billing: OfferBilling;
  taxRateBps: number;
  /** The bumps the server actually priced, which may be fewer than were sent. */
  appliedBumpProductIds: number[];
  coupon: AppliedCoupon | null;
  /** Set instead of an HTTP error when a code exists but cannot be used here. */
  couponError: string | null;
}

export interface PublicOffer {
  id: number;
  slug: string;
  title: string;
  description: string;
  checkoutHeadline: string;
  thumbnailUrl: string;
  currency: string;
  amountCents: number;
  billing: OfferBilling;
  orderForm: OfferOrderForm;
  redirectUrl: string;
  thankYouPageSlug: string | null;
  accessExpiresAfterDays: number | null;
  products: OfferProduct[];
  bumps: OfferBump[];
  upsells: OfferUpsell[];
  /** The offer at list price, so the summary paints before any quote returns. */
  quote: Quote;
  alreadyOwned: boolean;
}

export interface BillingAddressInput {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface QuoteInput {
  couponCode?: string;
  bumpProductIds?: number[];
  pwywAmountCents?: number;
  /** Only the tax lookup uses this, and only the server decides the rate. */
  address?: BillingAddressInput;
}

export interface CheckoutInput extends QuoteInput {
  email: string;
  name?: string;
  phone?: string;
  customFields?: Record<string, string>;
  acceptedTerms?: boolean;
}

export type ClientSecretType = "payment_intent" | "setup_intent" | null;

export interface CheckoutResult extends Quote {
  orderId: number;
  /** Proof of owning this order, for the upsell and the receipt read-back. */
  orderToken: string;
  offerSlug: string;
  billing: OfferBilling;
  redirectUrl: string | null;
  thankYouPageSlug: string | null;
  /** 'paid' only ever comes back for a genuinely free enrolment. */
  status: "paid" | "pending";
  requiresPayment: boolean;
  clientSecret: string | null;
  clientSecretType: ClientSecretType;
  subscriptionId?: string;
  memberCreated?: boolean;
}

export interface UpsellResult {
  /**
   * 'processing' means Stripe took the charge and the webhook has yet to land;
   * 'requires_action' means the bank wants the customer to authenticate.
   */
  status: "paid" | "processing" | "requires_action";
  orderId: number;
  orderToken: string;
  clientSecret: string | null;
  clientSecretType: ClientSecretType;
  /** Absent on the already-paid replay, which has nothing new to quote. */
  totalCents?: number;
  formatted?: Quote["formatted"];
}

export interface OrderReceiptItem {
  title: string;
  kind: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface OrderReceipt {
  orderId: number;
  /** Whatever the database holds. Only the webhook can make this 'paid'. */
  status: string;
  email: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  couponCode: string;
  createdAt: string;
  offerSlug: string | null;
  offerTitle: string | null;
  redirectUrl: string | null;
  thankYouPageSlug: string | null;
  items: OrderReceiptItem[];
}

/* ── Plain-fetch transport ──────────────────────────────────────────────── */

async function publicError(res: Response): Promise<MemberApiError> {
  let message = "Something went wrong. Please try again in a moment.";
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: string; message?: string; details?: unknown };
    message = body.error ?? body.message ?? message;
    details = body.details;
  } catch {
    // A non-JSON error page (nginx 502, an offline proxy) keeps the readable default.
  }
  return new MemberApiError(message, res.status, details);
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw await publicError(res);
  return (await res.json()) as T;
}

/* ── Calls ──────────────────────────────────────────────────────────────── */

export const commerceApi = {
  /** The sales side of an offer: price, order-form fields, bumps and upsells. */
  getOffer: (slug: string) => memberRequest<PublicOffer>(`/offers/${encodeURIComponent(slug)}`),

  /**
   * Re-prices the order after a coupon keystroke or a bump toggle.
   *
   * A coupon that cannot be used comes back as `couponError` on a 200 with the
   * untouched total, so a mistyped code never turns into an error the form has
   * to recover from mid-checkout.
   */
  quote: (slug: string, input: QuoteInput = {}) =>
    memberRequest<OfferQuote>(`/offers/${encodeURIComponent(slug)}/quote`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /**
   * Opens the order and returns whatever Stripe needs to collect the money.
   *
   * The order is written `pending`; nothing has been paid when this resolves.
   */
  createCheckout: (slug: string, input: CheckoutInput) =>
    memberRequest<CheckoutResult>(`/checkout/offer/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /**
   * Stores the email typed into the order form before anyone has decided to buy.
   *
   * Deliberately unable to fail in a way the page can see: this fires from an
   * onBlur handler during a checkout, and there is no outcome worth interrupting
   * that for. `keepalive` so it still lands if the tab is closing.
   */
  captureAbandoned: async (slug: string, email: string, firstName?: string): Promise<void> => {
    try {
      await fetch(`${API_BASE}/checkout/abandoned`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerSlug: slug, email, ...(firstName ? { firstName } : {}) }),
        keepalive: true,
      });
    } catch {
      // Recovery email marketing is not worth a broken checkout.
    }
  },

  /** One-click post-purchase charge against the card the parent order used. */
  buyUpsell: (
    slug: string,
    step: number,
    input: { parentOrderId: number; orderToken?: string }
  ) =>
    memberRequest<UpsellResult>(
      `/checkout/offer/${encodeURIComponent(slug)}/upsell/${step}`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  /**
   * Reads an order back.
   *
   * With a receipt token this is a plain public GET, because a guest who has
   * just paid has no session to authenticate with and should not need one to see
   * what they bought. Without one it goes through the member client, where the
   * signed-in session is the proof of ownership instead.
   */
  getOrder: (id: number, token?: string) =>
    token
      ? publicGet<OrderReceipt>(`/checkout/order/${id}?token=${encodeURIComponent(token)}`)
      : memberRequest<OrderReceipt>(`/checkout/order/${id}`),
};

/** The message to show a buyer for a failed call, never a stack or a status code. */
export function commerceErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again in a moment."
): string {
  if (err instanceof MemberApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
