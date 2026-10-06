import { createContext, useContext, type ReactNode } from "react";
import type { OfferQuote, PublicOffer, QuoteInput } from "@/lib/commerceApi";

/**
 * The admin's "Preview checkout" — what the checkout components need to know
 * when they are being looked at rather than used.
 *
 * Absent (null) on every real checkout. Present only under the admin route
 * `/admin/offers/:id/checkout-preview` (pages/admin/CheckoutPreview.tsx), where
 * it swaps where the offer and its quotes come from (admin-authenticated,
 * read-only endpoints that also answer for drafts) and tells the form that
 * nothing it does may leave the browser: no abandoned-cart capture, no
 * checkout, no PaymentIntent, no Stripe.js at all.
 */
export interface CheckoutPreviewSource {
  /** The offer, already loaded by the preview page. */
  getOffer: () => Promise<PublicOffer>;
  /** `/quote`, answered by the admin preview endpoint instead of the public one. */
  quote: (slug: string, input: QuoteInput) => Promise<OfferQuote>;
  /** The public checkout settings (button colours, coupon field, support email). */
  checkoutSettings: Record<string, unknown>;
}

const CheckoutPreviewContext = createContext<CheckoutPreviewSource | null>(null);

export function CheckoutPreviewProvider({
  value,
  children,
}: {
  value: CheckoutPreviewSource;
  children: ReactNode;
}) {
  return <CheckoutPreviewContext.Provider value={value}>{children}</CheckoutPreviewContext.Provider>;
}

/** The preview source, or null on a real checkout. */
export function useCheckoutPreview(): CheckoutPreviewSource | null {
  return useContext(CheckoutPreviewContext);
}

/** What the form says when "Add to cart" or "View cart" is pressed in a preview. */
export const PREVIEW_CART_NOTICE =
  "Preview only — buyers can add this to their cart from here. The cart isn't part of the preview, so nothing was added.";

/** What the form says when "Pay" is pressed in a preview. */
export const PREVIEW_SUBMIT_NOTICE =
  "Preview only — payments are disabled here, so nothing was charged, ordered or saved. Buyers press this button to pay.";

/**
 * Which page the preview draws. The Club offer opens on its own page
 * (`/club/checkout`, which is where /club sends buyers); every other offer, and
 * the Club with `?page=checkout`, on the ordinary `/checkout/:offerSlug` form.
 */
export type CheckoutPreviewPage = "checkout" | "club";

/**
 * The preview address in the admin app. Kept here, beside the context, so
 * the offers list and editor can link to it without pulling the preview page
 * (and the checkout bundle) into the console.
 */
export function checkoutPreviewPath(offerId: number | string): string {
  return `/admin/offers/${encodeURIComponent(String(offerId))}/checkout-preview`;
}

/** Opens the preview in a new tab, which is where Kajabi opens its Preview too. */
export function openCheckoutPreview(offerId: number | string): void {
  window.open(checkoutPreviewPath(offerId), "_blank", "noopener");
}
