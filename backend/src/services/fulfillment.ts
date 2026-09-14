import { stopCheckoutRecovery } from "./checkoutRecovery";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { enqueue, PRIORITY } from "../jobs/queue";
import { grantAccess, grantOfferAccess } from "./access";
import { recordActivity, upsertContactWithStatus } from "./contacts";
import { buildInstallmentSchedule, type BillingInterval } from "./pricing";
import { dispatchEvent } from "./webhooksOut";

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
      affiliate_id: number | null;
      gift_recipient_email: string;
    }>(
      `SELECT id, offer_id, member_id, email, billing_name, status, currency, total_cents,
              affiliate_id, gift_recipient_email
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

    // The contact is resolved inside the transaction, so an order can never be
    // marked paid against a person who does not exist because a later statement
    // rolled back.
    const contact = email
      ? await upsertContactWithStatus({
          email,
          name: order.billing_name || "",
          source: "customer",
          client,
        })
      : null;
    const contactId = contact?.id ?? null;

    await client.query(
      `UPDATE orders
          SET status = 'paid',
              member_id = COALESCE($2, member_id),
              contact_id = COALESCE(contact_id, $6),
              email = CASE WHEN $3 <> '' THEN $3 ELSE email END,
              stripe_payment_intent_id = COALESCE($4, stripe_payment_intent_id),
              stripe_customer_id = COALESCE($5, stripe_customer_id),
              updated_at = now()
        WHERE id = $1`,
      [
        order.id,
        memberId,
        email,
        input.paymentIntentId ?? null,
        input.stripeCustomerId ?? null,
        contactId,
      ]
    );

    if (contactId && memberId) {
      await client.query(
        `UPDATE members SET contact_id = $2 WHERE id = $1 AND contact_id IS NULL`,
        [memberId, contactId]
      );
    }

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

    // Partner commission is accrued off the queue, not computed here.
    //
    // Two reasons it must not be inline. The rules live in the database and a
    // rate lookup is not worth adding to the critical path of "the customer has
    // paid, give them what they bought"; and a bug in commission arithmetic
    // would otherwise roll back the whole fulfilment, leaving a charged
    // customer locked out of their purchase over somebody else's percentage.
    //
    // Enqueued inside this transaction so the job row and the payment it
    // describes commit together: no job for a payment that rolled back, and no
    // payment without the job. `accrueForTransaction` is idempotent, so the
    // dedupe key is belt and braces rather than the guarantee.
    const transactionId = txRes.rows[0]?.id ?? null;
    if (transactionId !== null && order.affiliate_id !== null) {
      await enqueue({
        kind: "affiliates.accrue",
        payload: { transactionId },
        priority: PRIORITY.normal,
        dedupeKey: `affiliate-accrue:${transactionId}`,
        client,
      });
    }

    let accessMemberId = memberId;
    let giftCreatedMember = false;
    if (order.gift_recipient_email) {
      const recipient = await resolveMember(client, order.gift_recipient_email, "");
      accessMemberId = recipient.memberId;
      giftCreatedMember = recipient.created;
      await client.query(`UPDATE orders SET gift_member_id = $2, gift_created_member = $3 WHERE id = $1`,
        [order.id, accessMemberId, giftCreatedMember]);
      await enqueue({ kind: "purchase.gift", payload: { orderId: order.id }, dedupeKey: `purchase-gift:${order.id}`, client });
    }

    let grantedProductIds: number[] = [];
    const activatedProductIds: number[] = [];
    const purchasedOffers = await client.query<{offer_id:number}>(`SELECT DISTINCT offer_id FROM order_items WHERE order_id=$1 AND kind IN ('offer','upsell') AND offer_id IS NOT NULL UNION SELECT $2::int WHERE $2::int IS NOT NULL`,[order.id,order.offer_id]);
    if (accessMemberId) {
      for (const purchased of purchasedOffers.rows) {
        grantedProductIds.push(...await grantOfferAccess({memberId:accessMemberId,offerId:purchased.offer_id,orderId:order.id,source:"purchase",client,activatedProductIds}));
      }
    }

    // Bumps are separate order_items pointing straight at a product, so they
    // are granted here rather than through the offer's product list.
    if (accessMemberId) {
      const bumpItems = await client.query<{ product_id: number }>(
        `SELECT DISTINCT product_id FROM order_items
          WHERE order_id = $1 AND kind = 'bump' AND product_id IS NOT NULL`,
        [order.id]
      );
      for (const item of bumpItems.rows) {
        const grant = await grantAccess({
          memberId: accessMemberId,
          productId: item.product_id,
          orderId: order.id,
          source: "purchase",
          client,
        });
        grantedProductIds.push(item.product_id);
        if (grant.transitionedToActive) activatedProductIds.push(item.product_id);
      }
    }

    // Completing any purchase stops reminders. Only a followed reminder link
    // receives recovered-revenue attribution.
    if (email) {
      for (const purchased of purchasedOffers.rows) await stopCheckoutRecovery(client, {orderId: order.id, offerId: purchased.offer_id, email});
    }

    if (contactId) {
      // Titles come from `order_items`, which copies them at checkout. A join to
      // `offers` would make a receipt from last year change its wording when the
      // offer is renamed, and read as blank once it is deleted.
      const items = await client.query<{ title: string }>(
        `SELECT title FROM order_items WHERE order_id = $1 AND title <> '' ORDER BY id`,
        [order.id]
      );
      const bought = items.rows.map((item) => item.title).join(", ");

      await recordActivity({
        contactId,
        kind: "purchase",
        title: bought ? `Bought ${bought}` : "Made a purchase",
        subjectType: "order",
        subjectId: order.id,
        meta: { amountCents: input.amountCents, currency, orderId: order.id },
        occurredAt: input.occurredAt,
        client,
      });
    }

    if (contact?.created) {
      const { publishDomainEvent } = await import("./domainEvents");
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contact.id}`,
        contactId: contact.id,
        email,
        name: order.billing_name || "",
        source: "customer",
        client,
      });
    }

    await client.query("COMMIT");

    if (createdMember && memberId !== null) {
      await dispatchEvent("member.created", {
        id: `member:${memberId}`,
        memberId,
        contactId,
        email,
        source: "purchase",
      });
    }
    if (accessMemberId !== null) {
      for (const productId of activatedProductIds) {
        await dispatchEvent("member.granted_access", {
          id: `grant:order:${order.id}:product:${productId}`,
          memberId: accessMemberId,
          contactId: order.gift_recipient_email ? null : contactId,
          productId,
          offerId: order.offer_id,
          orderId: order.id,
          source: "purchase",
        });
      }
    }

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
 * Called once, when the order's first invoice settles. Stripe drives the
 * remaining charges as a subscription with a fixed iteration count; this table
 * is what lets the member see "2 of 3 payments made" without a round trip to
 * Stripe, and what the plan reports are built from.
 *
 * `firstInstallmentPaid` is the load-bearing argument. An invoice can settle
 * without collecting anything — a trial period is exactly that — and an
 * installment is a payment, so the opening row is credited only when the money
 * moved. Crediting it on a $0 invoice hands the customer a charge they never
 * made: a three-payment contract collects two and Stripe stops.
 */
export async function createPaymentPlan(input: {
  orderId: number;
  offerId: number;
  memberId: number | null;
  email: string;
  /** What each recurring charge costs, after any discount that applies to it. */
  installmentCents: number;
  /**
   * The opening charge, when a coupon discounts only the first one and it
   * therefore differs from the rest of the schedule.
   */
  firstInstallmentCents?: number;
  installmentCount: number;
  /** Whether the opening invoice actually collected money. */
  firstInstallmentPaid: boolean;
  /**
   * The invoice that collected the opening charge.
   *
   * Recorded on installment one so `advancePaymentPlan` can recognise it. That
   * guard refuses to credit an installment against an invoice already on the
   * schedule, and without this the opening invoice was the one invoice it could
   * not see — a redelivery of it then credited installment TWO, marking a
   * payment paid that the customer never made.
   */
  firstStripeInvoiceId?: string | null;
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

    const installmentsPaid = input.firstInstallmentPaid ? 1 : 0;

    const planRes = await client.query<{ id: number }>(
      `INSERT INTO payment_plans
         (order_id, offer_id, member_id, email, installment_cents, installment_count,
          installments_paid, currency, interval, interval_count, status,
          next_charge_at, stripe_customer_id, stripe_subscription_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12,$13)
       ON CONFLICT (stripe_subscription_id) DO NOTHING
       RETURNING id`,
      [
        input.orderId,
        input.offerId,
        input.memberId,
        input.email,
        input.installmentCents,
        input.installmentCount,
        installmentsPaid,
        input.currency ?? "usd",
        input.interval,
        input.intervalCount ?? 1,
        // The next charge is the first row the customer still owes, which is
        // row one itself when the opening invoice collected nothing.
        schedule[installmentsPaid]?.dueAt ?? null,
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
      const settled = isFirst && input.firstInstallmentPaid;
      const amountCents =
        isFirst ? (input.firstInstallmentCents ?? installment.amountCents) : installment.amountCents;
      await client.query(
        `INSERT INTO payment_plan_installments
           (payment_plan_id, sequence, amount_cents, due_at, paid_at, transaction_id,
            stripe_invoice_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (payment_plan_id, sequence) DO NOTHING`,
        [
          planId,
          installment.sequence,
          amountCents,
          installment.dueAt,
          settled ? startAt : null,
          settled ? (input.firstTransactionId ?? null) : null,
          settled ? (input.firstStripeInvoiceId ?? null) : null,
          settled ? "paid" : "scheduled",
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
 * Records a refund and, when the order is now fully refunded, takes the access
 * back.
 *
 * "Fully refunded" is measured against what the order actually COLLECTED — the
 * sum of its cleared payments — and never against `total_cents`, which holds the
 * price of a single charge. One order can be three installments of a plan or
 * thirty monthly renewals, so comparing a refund to one charge's price gets it
 * wrong in both directions: refunding one $1,250 installment of a 3 x $1,250
 * plan would read as a full refund and strip every grant while two thirds of the
 * money is still ours, and a customer who has paid all three could never be
 * refunded more than the first before the order stopped counting.
 *
 * Revocation is deliberately tied to the order being made whole again rather
 * than left to the caller's reading of a single Stripe charge: a partial refund,
 * or a goodwill refund on a course someone genuinely completed, leaves them
 * their access.
 */
export async function recordRefund(input: {
  orderId: number;
  transactionId?: number | null;
  amountCents: number;
  currency?: string;
  reason?: string;
  /** Whether a refund that settles the whole order also takes the access back. */
  revokeAccessOnFullRefund: boolean;
  stripeRefundId?: string | null;
  createdByEmail?: string;
}): Promise<{ recorded: boolean; fullyRefunded: boolean; revokedCount: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Recorded before the order is touched: the unique guard on the Stripe
    // refund id is what stops a redelivered charge.refunded from adding the
    // same money to `refunded_cents` twice.
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO refunds
         (order_id, transaction_id, amount_cents, currency, reason, revoked_access,
          stripe_refund_id, created_by_email)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)
       ON CONFLICT (stripe_refund_id) DO NOTHING
       RETURNING id`,
      [
        input.orderId,
        input.transactionId ?? null,
        input.amountCents,
        input.currency ?? "usd",
        (input.reason ?? "").slice(0, 500),
        input.stripeRefundId ?? null,
        input.createdByEmail ?? "",
      ]
    );

    const refundId = inserted.rows[0]?.id;
    if (!refundId) {
      await client.query("ROLLBACK");
      return { recorded: false, fullyRefunded: false, revokedCount: 0 };
    }

    // The same money, in the ledger.
    //
    // `refunds` is the operational record — which Stripe refund, why, and
    // whether access went with it. `transactions` is the ledger every revenue
    // figure is summed from. Writing only the first made the two diverge: net
    // revenue computed from transactions alone counted every payment and no
    // refund, so a fully refunded order still read as income.
    //
    // Stored positive with `kind = 'refund'`, so net revenue is
    // SUM(payment) - SUM(refund) rather than a sum over signed amounts that a
    // reader has to know the convention for. Guarded by the refund insert above
    // rather than by its own conflict clause — this line is only reached when
    // that INSERT actually created a row, which is what makes a redelivered
    // charge.refunded a no-op here too.
    const refundedMember = await client.query<{ member_id: number | null; email: string }>(
      `SELECT member_id, email FROM orders WHERE id = $1`,
      [input.orderId]
    );

    // No Stripe id on this row: `stripe_charge_id` means the charge, and the
    // refund's own id belongs to the `refunds` row that owns it. Reconciliation
    // goes ledger -> refunds -> Stripe rather than storing one system's id in a
    // column named for another's.
    await client.query(
      `INSERT INTO transactions
         (order_id, member_id, email, kind, status, amount_cents, currency, occurred_at)
       VALUES ($1, $2, $3, 'refund', 'succeeded', $4, $5, now())`,
      [
        input.orderId,
        refundedMember.rows[0]?.member_id ?? null,
        refundedMember.rows[0]?.email ?? "",
        input.amountCents,
        input.currency ?? "usd",
      ]
    );

    // `collected` counts every payment that cleared on this order, whatever
    // became of it afterwards. A charge marked 'refunded' or 'disputed' still
    // contributed the money it took; dropping it as its status changes would
    // shrink the denominator and make a later partial refund look like a full
    // one.
    const orderRes = await client.query<{
      member_id: number | null;
      offer_id: number | null;
      refunded_cents: number;
      collected_cents: number;
    }>(
      `UPDATE orders o
          SET refunded_cents = o.refunded_cents + $2,
              status = CASE
                         WHEN collected.cents > 0 AND o.refunded_cents + $2 >= collected.cents
                           THEN 'refunded'
                         ELSE o.status
                       END,
              updated_at = now()
         FROM (SELECT COALESCE(SUM(t.amount_cents), 0)::int AS cents
                 FROM transactions t
                WHERE t.order_id = $1
                  AND t.kind = 'payment'
                  AND t.status IN ('succeeded', 'refunded', 'disputed')) collected
        WHERE o.id = $1
        RETURNING o.member_id, o.offer_id, o.refunded_cents, collected.cents AS collected_cents`,
      [input.orderId, input.amountCents]
    );

    const order = orderRes.rows[0];
    const fullyRefunded =
      order !== undefined &&
      order.collected_cents > 0 &&
      order.refunded_cents >= order.collected_cents;

    let revokedCount = 0;
    if (fullyRefunded && input.revokeAccessOnFullRefund) {
      const revoked = await client.query(
        `UPDATE access_grants
            SET status = 'revoked', revoked_at = now(), revoke_reason = 'refunded', updated_at = now()
          WHERE order_id = $1 AND status = 'active'`,
        [input.orderId]
      );
      revokedCount = revoked.rowCount ?? 0;
      await client.query(`UPDATE refunds SET revoked_access = true WHERE id = $1`, [refundId]);
    }

    await client.query("COMMIT");
    return { recorded: true, fullyRefunded, revokedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
