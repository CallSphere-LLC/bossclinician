import { pool } from "../db/pool";
import { stripe } from "../stripe/client";
import { recoverPaidInvoice } from "./dunning";

/**
 * Putting a card a member has just saved to work.
 *
 * The member billing page collects a new card with a SetupIntent when Stripe's
 * hosted billing portal is not configured (it is not, on this account). Saving
 * the card attaches it to the Stripe customer and does nothing else: the
 * customer's default, and every subscription's, still points at the old card,
 * so the next renewal — and every retry of the payment that just failed — goes
 * to the card the member was trying to replace. This is the missing half.
 */

export class CardUpdateError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "not_ready" = "not_found"
  ) {
    super(message);
    this.name = "CardUpdateError";
  }
}

const NOT_RECOGNISED = "We couldn't find that card update. Please try adding the card again.";

/** Every Stripe customer id this member has bought under. */
export async function memberCustomerIds(memberId: number): Promise<string[]> {
  const res = await pool.query<{ customer_id: string }>(
    `SELECT DISTINCT customer_id FROM (
       SELECT stripe_customer_id AS customer_id FROM subscriptions WHERE member_id = $1
       UNION SELECT stripe_customer_id FROM payment_plans WHERE member_id = $1
       UNION SELECT stripe_customer_id FROM orders WHERE member_id = $1
     ) c WHERE customer_id IS NOT NULL`,
    [memberId]
  );
  return res.rows.map((row) => row.customer_id);
}

export interface CardAdoption {
  /** Memberships and payment plans now charging the new card. */
  updated: number;
  /** Overdue invoices tried again on the new card, and how many went through. */
  retried: number;
  paid: number;
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * Makes the card from a completed SetupIntent the one everything charges, and
 * tries any overdue invoice on it straight away.
 *
 * Ownership is the Stripe customer: the SetupIntent must belong to a customer
 * this member has bought under, so a SetupIntent id from somebody else's
 * session is refused exactly as a made-up one is.
 */
export async function adoptSavedCard(memberId: number, setupIntentId: string): Promise<CardAdoption> {
  const intent = await stripe().setupIntents.retrieve(setupIntentId);
  const customerId = idOf(intent.customer);
  const owned = await memberCustomerIds(memberId);

  if (customerId === null || !owned.includes(customerId)) throw new CardUpdateError(NOT_RECOGNISED);
  if (intent.metadata?.memberId !== undefined && intent.metadata.memberId !== String(memberId)) {
    throw new CardUpdateError(NOT_RECOGNISED);
  }
  if (intent.status !== "succeeded") {
    throw new CardUpdateError(
      "Your bank hasn't finished confirming the new card yet. Please try again in a minute.",
      "not_ready"
    );
  }
  const paymentMethodId = idOf(intent.payment_method);
  if (paymentMethodId === null) throw new CardUpdateError(NOT_RECOGNISED);

  await stripe().customers.update(
    customerId,
    { invoice_settings: { default_payment_method: paymentMethodId } },
    { idempotencyKey: `card-default-${setupIntentId}` }
  );

  const recurring = await pool.query<{ stripe_subscription_id: string }>(
    `SELECT stripe_subscription_id FROM subscriptions
      WHERE member_id = $1 AND stripe_customer_id = $2 AND stripe_subscription_id IS NOT NULL
        AND ended_at IS NULL AND status IN ('active','trialing','past_due','unpaid')
     UNION
     SELECT stripe_subscription_id FROM payment_plans
      WHERE member_id = $1 AND stripe_customer_id = $2 AND stripe_subscription_id IS NOT NULL
        AND status IN ('active','past_due')`,
    [memberId, customerId]
  );

  let updated = 0;
  for (const row of recurring.rows) {
    await stripe().subscriptions.update(
      row.stripe_subscription_id,
      { default_payment_method: paymentMethodId },
      { idempotencyKey: `card-sub-${setupIntentId}-${row.stripe_subscription_id}` }
    );
    updated += 1;
  }

  const overdue = await pool.query<{ stripe_invoice_id: string }>(
    `SELECT DISTINCT i.stripe_invoice_id
       FROM invoices i
       LEFT JOIN subscriptions s  ON s.id  = i.subscription_id
       LEFT JOIN payment_plans pp ON pp.id = i.payment_plan_id
      WHERE i.status = 'failed'
        AND i.origin <> 'order'
        AND i.dunning_ended_at IS NULL
        AND (s.stripe_customer_id = $2 OR pp.stripe_customer_id = $2)
        AND (s.member_id = $1 OR pp.member_id = $1)`,
    [memberId, customerId]
  );

  let retried = 0;
  let paid = 0;
  for (const row of overdue.rows) {
    retried += 1;
    try {
      const result = await stripe().invoices.pay(
        row.stripe_invoice_id,
        { payment_method: paymentMethodId },
        { idempotencyKey: `card-pay-${setupIntentId}-${row.stripe_invoice_id}` }
      );
      if (result.status === "paid") {
        paid += 1;
        await recoverPaidInvoice(row.stripe_invoice_id);
      }
    } catch {
      // A decline on the new card is the customer's to see on the next attempt
      // and in the payment-failed email; the card is still saved as the default.
    }
  }

  return { updated, retried, paid };
}
