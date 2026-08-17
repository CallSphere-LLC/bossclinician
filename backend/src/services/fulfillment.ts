import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { grantOfferAccess } from "./access";
import { buildInstallmentSchedule, type BillingInterval } from "./pricing";

/**
 * Turning a successful payment into everything the customer bought.
 *
 * This is the one place an order becomes `paid`. It is called from the Stripe
 * webhook and from the admin's "record a manual payment" action, and it must
 * behave identically for both.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **Idempotent.** Stripe retries webhooks, and it retries them after a
 *     timeout even when the first delivery succeeded. Fulfilling twice would
 *     mean two receipts, two access grants and a doubled revenue figure. Every
 *     write below is guarded so a second delivery changes nothing and reports
 *     success.
 *  2. **Atomic.** Marking an order paid without granting access leaves a
 *     customer who has been charged and cannot open what they bought — the
 *     worst possible failure. The whole sequence runs in one transaction.
 */

export interface FulfillPaymentInput {
  orderId: number;
  /** Stripe's id for the charge. The idempotency key for the whole operation. */
  paymentIntentId?: string | null;
  chargeId?: string | null;
  amountCents: number;
  currency?: string;
  email?: string | null;
  /** Card brand/last4/type, for the receipt and the payments report. */
  paymentMethod?: {
    brand?: string;
    last4?: string;
    type?: string;
  };
  country?: string;
  state?: string;
  stripeCustomerId?: string | null;
  occurredAt?: Date;
}

export interface FulfillResult {
  /** False when this delivery was a duplicate and nothing changed. */
  fulfilled: boolean;
  orderId: number;
  memberId: number | null;
  grantedProductIds: number[];
  transactionId: number | null;
  /** Set when the order created a brand-new account that needs a password link. */
  createdMember: boolean;
}

const NOOP_RESULT = (orderId: number): FulfillResult => ({
  fulfilled: false,
  orderId,
  memberId: null,
  grantedProductIds: [],
  transactionId: null,
  createdMember: false,
});

/**
 * Finds or creates the member an order belongs to.
 *
 * A guest checkout creates an account with no password. That is deliberate:
 * the buyer gets a set-password link by email, and until they use it the row
 * still owns their purchase, so paying and then setting a password never loses
 * the order. `verifyPassword` in auth/password.ts handles the null hash without
 * leaking that the account is claimable.
 */
async function resolveMember(
  client: PoolClient,
  email: string,
  billingName: string
): Promise<{ memberId: number; created: boolean }> {
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM members WHERE email = $1`,
    [email]
  );
  if (existing.rows[0]) return { memberId: existing.rows[0].id, created: false };

  const parts = billingName.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");

  const created = await client.query<{ id: number }>(
    `INSERT INTO members (email, name, first_name, last_name, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [email, billingName.trim(), firstName, lastName]
  );
  return { memberId: created.rows[0].id, created: true };
}

/**
 * Records a payment against an order and delivers what it bought.
 *
 * Returns `fulfilled: false` for a replayed webhook rather than throwing —
 * a duplicate delivery is a normal, expected event, not an error, and
 * responding 500 to it would make Stripe retry forever.
 */
export async function fulfillPayment(input: FulfillPaymentInput): Promise<FulfillResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locking the order row serialises concurrent deliveries of the same event.
    // Without it, two retries arriving together both read status = 'pending'
    // and both fulfil.
    const orderRes = await client.query<{
      id: number;
      offer_id: number | null;
      member_id: number | null;
      email: string;
      billing_name: string;
      status: string;
      currency: string;
      total_cents: number;
    }>(
      `SELECT id, offer_id, member_id, email, billing_name, status, currency, total_cents
         FROM orders WHERE id = $1 FOR UPDATE`,
      [input.orderId]
    );

    const order = orderRes.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return NOOP_RESULT(input.orderId);
    }

    if (order.status === "paid") {
      await client.query("ROLLBACK");
      return NOOP_RESULT(order.id);
    }

    const email = (input.email || order.email || "").toLowerCase().trim();
    const currency = input.currency || order.currency || "usd";

    let memberId = order.member_id;
    let createdMember = false;
    if (!memberId && email) {
      const resolved = await resolveMember(client, email, order.billing_name || "");
      memberId = resolved.memberId;
      createdMember = resolved.created;
    }

    await client.query(
      `UPDATE orders
          SET status = 'paid',
              member_id = COALESCE($2, member_id),
              email = CASE WHEN $3 <> '' THEN $3 ELSE email END,
              stripe_payment_intent_id = COALESCE($4, stripe_payment_intent_id),
              stripe_customer_id = COALESCE($5, stripe_customer_id),
              updated_at = now()
        WHERE id = $1`,
      [order.id, memberId, email, input.paymentIntentId ?? null, input.stripeCustomerId ?? null]
    );

    // ON CONFLICT on the payment intent is the second idempotency guard: even
    // if the order row were somehow re-opened, the same charge cannot be
    // recorded as revenue twice.
    const txRes = await client.query<{ id: number }>(
      `INSERT INTO transactions
         (order_id, member_id, email, kind, status, amount_cents, currency,
          payment_method_brand, payment_method_last4, payment_method_type,
          country, state, stripe_payment_intent_id, stripe_charge_id, occurred_at)
       VALUES ($1,$2,$3,'payment','succeeded',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (stripe_payment_intent_id) DO NOTHING
       RETURNING id`,
      [
        order.id,
        memberId,
        email,
        input.amountCents,
        currency,
        input.paymentMethod?.brand ?? "",
        input.paymentMethod?.last4 ?? "",
        input.paymentMethod?.type ?? "",
        input.country ?? "",
        input.state ?? "",
        input.paymentIntentId ?? null,
        input.chargeId ?? null,
        input.occurredAt ?? new Date(),
      ]
    );

    let grantedProductIds: number[] = [];
    if (memberId && order.offer_id) {
      grantedProductIds = await grantOfferAccess({
        memberId,
        offerId: order.offer_id,
        orderId: order.id,
        source: "purchase",
        client,
      });
    }

    // Bumps are separate order_items pointing straight at a product, so they
    // are granted here rather than through the offer's product list.
    if (memberId) {
      const bumpItems = await client.query<{ product_id: number }>(
        `SELECT DISTINCT product_id FROM order_items
          WHERE order_id = $1 AND kind = 'bump' AND product_id IS NOT NULL`,
        [order.id]
      );
      for (const item of bumpItems.rows) {
        await client.query(
          `INSERT INTO access_grants (member_id, product_id, order_id, source, status)
           VALUES ($1, $2, $3, 'purchase', 'active')
           ON CONFLICT (member_id, product_id) DO UPDATE
             SET status = 'active', revoked_at = NULL, updated_at = now()`,
          [memberId, item.product_id, order.id]
        );
        grantedProductIds.push(item.product_id);
      }
    }

    // A cart that was abandoned and later paid is the numerator of the
    // "revenue recovered" report.
    if (email && order.offer_id) {
      await client.query(
        `UPDATE abandoned_checkouts
            SET recovered_order_id = $1, recovered_at = now(), updated_at = now()
          WHERE offer_id = $2 AND email = $3 AND recovered_at IS NULL`,
        [order.id, order.offer_id, email]
      );
    }

    await client.query("COMMIT");

    return {
      fulfilled: true,
      orderId: order.id,
      memberId,
      grantedProductIds,
      transactionId: txRes.rows[0]?.id ?? null,
      createdMember,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sets up the installment schedule for a payment-plan order.
 *
 * Called once, after the first installment is fulfilled. Stripe drives the
 * remaining charges as a subscription with a fixed iteration count; this table
 * is what lets the member see "2 of 3 payments made" without a round trip to
 * Stripe, and what the plan reports are built from.
 */
export async function createPaymentPlan(input: {
  orderId: number;
  offerId: number;
  memberId: number | null;
  email: string;
  installmentCents: number;
  installmentCount: number;
  interval: BillingInterval;
  intervalCount?: number;
  currency?: string;
  startAt?: Date;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  firstTransactionId?: number | null;
}): Promise<number | null> {
  const startAt = input.startAt ?? new Date();
  const schedule = buildInstallmentSchedule({
    totalCents: input.installmentCents * input.installmentCount,
    installmentCount: input.installmentCount,
    interval: input.interval,
    intervalCount: input.intervalCount ?? 1,
    startAt,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const planRes = await client.query<{ id: number }>(
      `INSERT INTO payment_plans
         (order_id, offer_id, member_id, email, installment_cents, installment_count,
          installments_paid, currency, interval, interval_count, status,
          next_charge_at, stripe_customer_id, stripe_subscription_id)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,'active',$10,$11,$12)
       ON CONFLICT (stripe_subscription_id) DO NOTHING
       RETURNING id`,
      [
        input.orderId,
        input.offerId,
        input.memberId,
        input.email,
        input.installmentCents,
        input.installmentCount,
        input.currency ?? "usd",
        input.interval,
        input.intervalCount ?? 1,
        schedule[1]?.dueAt ?? null,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
      ]
    );

    const planId = planRes.rows[0]?.id;
    if (!planId) {
      // A duplicate delivery of the same subscription. Nothing to do.
      await client.query("ROLLBACK");
      return null;
    }

    for (const installment of schedule) {
      const isFirst = installment.sequence === 1;
      await client.query(
        `INSERT INTO payment_plan_installments
           (payment_plan_id, sequence, amount_cents, due_at, paid_at, transaction_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (payment_plan_id, sequence) DO NOTHING`,
        [
          planId,
          installment.sequence,
          installment.amountCents,
          installment.dueAt,
          isFirst ? startAt : null,
          isFirst ? (input.firstTransactionId ?? null) : null,
          isFirst ? "paid" : "scheduled",
        ]
      );
    }

    await client.query("COMMIT");
    return planId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records a refund and, when asked, takes the access back.
 *
 * Access revocation is a choice rather than automatic: a partial refund, or a
 * goodwill refund on a course someone genuinely completed, should usually leave
 * them their access. The caller decides; this records what was decided.
 */
export async function recordRefund(input: {
  orderId: number;
  transactionId?: number | null;
  amountCents: number;
  currency?: string;
  reason?: string;
  revokeAccess: boolean;
  stripeRefundId?: string | null;
  createdByEmail?: string;
}): Promise<{ recorded: boolean; revokedCount: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO refunds
         (order_id, transaction_id, amount_cents, currency, reason, revoked_access,
          stripe_refund_id, created_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (stripe_refund_id) DO NOTHING
       RETURNING id`,
      [
        input.orderId,
        input.transactionId ?? null,
        input.amountCents,
        input.currency ?? "usd",
        (input.reason ?? "").slice(0, 500),
        input.revokeAccess,
        input.stripeRefundId ?? null,
        input.createdByEmail ?? "",
      ]
    );

    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      return { recorded: false, revokedCount: 0 };
    }

    const orderRes = await client.query<{
      member_id: number | null;
      offer_id: number | null;
      total_cents: number;
    }>(
      `UPDATE orders
          SET refunded_cents = refunded_cents + $2,
              status = CASE
                         WHEN refunded_cents + $2 >= total_cents THEN 'refunded'
                         ELSE status
                       END,
              updated_at = now()
        WHERE id = $1
        RETURNING member_id, offer_id, total_cents`,
      [input.orderId, input.amountCents]
    );

    let revokedCount = 0;
    const order = orderRes.rows[0];
    if (input.revokeAccess && order?.member_id) {
      const revoked = await client.query(
        `UPDATE access_grants
            SET status = 'revoked', revoked_at = now(), revoke_reason = 'refunded', updated_at = now()
          WHERE member_id = $1 AND order_id = $2 AND status = 'active'`,
        [order.member_id, input.orderId]
      );
      revokedCount = revoked.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return { recorded: true, revokedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
