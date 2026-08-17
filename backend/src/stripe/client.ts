import Stripe from "stripe";
import { env, stripeEnabled } from "../config/env";
import { HttpError } from "../utils/httpError";

let client: Stripe | null = null;

/**
 * Lazily constructed Stripe client. Constructing at import time would throw on
 * boot whenever STRIPE_SECRET_KEY is unset, which would take the whole API down
 * for a feature the rest of the site doesn't depend on.
 */
export function stripe(): Stripe {
  if (!stripeEnabled()) {
    throw new HttpError(503, "Payments are not configured");
  }
  if (!client) {
    client = new Stripe(env.stripe.secretKey);
  }
  return client;
}
