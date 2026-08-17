/**
 * The proof-of-purchase a buyer carries from checkout into the upsell flow.
 *
 * A guest has no account, so the only thing that says "this order is mine" is
 * the HMAC the server issued at checkout. Inside the app it travels through
 * router state with `sessionStorage` behind it, so a reload or a back-button
 * press mid-upsell does not strand someone who has already paid. It is
 * session-scoped on purpose: it dies with the tab, which is exactly as long as
 * the upsell flow lives.
 *
 * The confirmation URL is the one place it appears in a query string, because
 * Stripe redirects a bank-authenticated buyer back to a URL we hand it before
 * the payment starts — that address has to describe the order on its own.
 */

export interface CheckoutReceipt {
  orderId: number;
  orderToken: string;
}

function storageKey(offerSlug: string): string {
  return `bossclinician.checkout.receipt.${offerSlug}`;
}

export function rememberReceipt(offerSlug: string, receipt: CheckoutReceipt): void {
  try {
    window.sessionStorage.setItem(storageKey(offerSlug), JSON.stringify(receipt));
  } catch {
    // Private browsing and storage-full both land here. The router state still
    // carries the receipt through a normal forward navigation.
  }
}

export function recallReceipt(offerSlug: string): CheckoutReceipt | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(offerSlug));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { orderId, orderToken } = parsed as Partial<CheckoutReceipt>;
    if (typeof orderId !== "number" || typeof orderToken !== "string") return null;
    return { orderId, orderToken };
  } catch {
    return null;
  }
}

export function forgetReceipt(offerSlug: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(offerSlug));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Where a finished order sends the buyer, with the proof they need to read it. */
export function successPath(receipt: CheckoutReceipt): string {
  return `/checkout/success?order=${receipt.orderId}&token=${encodeURIComponent(receipt.orderToken)}`;
}
