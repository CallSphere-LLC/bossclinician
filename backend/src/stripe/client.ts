import Stripe from "stripe";
import { env, stripeEnabled } from "../config/env";
import { HttpError } from "../utils/httpError";

let client: Stripe | null = null;

/**
 * The API version every request and every webhook payload is interpreted under.
 *
 * Pinned here rather than left to the account default, because the default is a
 * dashboard setting: somebody clicking "upgrade" in Stripe would otherwise
 * change the shape of the objects this codebase parses — `invoice.subscription`
 * moving to `invoice.parent`, `current_period_end` moving onto the subscription
 * item — with no deploy and no warning. The webhook reads those exact paths.
 *
 * It is deliberately the literal string and not a reference to the SDK's own
 * latest-version constant: a `stripe` package bump must fail the typecheck here
 * and be reviewed against the payload shapes, not follow the SDK silently.
 */
export const STRIPE_API_VERSION = "2026-06-24.dahlia";

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
    client = new Stripe(env.stripe.secretKey, { apiVersion: STRIPE_API_VERSION });
  }
  return client;
}
