import { stripe } from "./client";

/**
 * The card statement descriptor on subscription renewals.
 *
 * A one-off charge carries the descriptor on its own PaymentIntent. A renewal is
 * raised by Stripe from the subscription's invoice, and the only place Stripe
 * reads a descriptor for it is the Product behind the price. The checkout sets
 * it when it mints a new Product, which leaves every Product that already
 * existed — and every one made in the Stripe dashboard — renewing under the
 * account's default name, whatever Settings → Payments says.
 *
 * So before a subscription is created, the Product behind its price is brought
 * in line. Remembered per process, so a busy offer costs the two reads once.
 */

const productOfPrice = new Map<string, string>();
const appliedToProduct = new Map<string, string>();

/** Test seam. */
export function forgetAppliedDescriptors(): void {
  productOfPrice.clear();
  appliedToProduct.clear();
}

export async function applyDescriptorToPrice(
  priceId: string,
  descriptor: string | undefined
): Promise<"skipped" | "unchanged" | "updated"> {
  if (!descriptor) return "skipped";

  let productId = productOfPrice.get(priceId);
  if (productId === undefined) {
    const price = await stripe().prices.retrieve(priceId);
    productId = typeof price.product === "string" ? price.product : price.product.id;
    productOfPrice.set(priceId, productId);
  }
  if (appliedToProduct.get(productId) === descriptor) return "unchanged";

  const product = await stripe().products.retrieve(productId);
  if ("deleted" in product && product.deleted) return "skipped";
  if (product.statement_descriptor === descriptor) {
    appliedToProduct.set(productId, descriptor);
    return "unchanged";
  }

  await stripe().products.update(productId, { statement_descriptor: descriptor });
  appliedToProduct.set(productId, descriptor);
  return "updated";
}
