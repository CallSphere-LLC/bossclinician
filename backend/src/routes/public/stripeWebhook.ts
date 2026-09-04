import { Router } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { stripe } from "../../stripe/client";
import { env, stripeEnabled } from "../../config/env";
import { sendMail } from "../../email/mailer";
import { orderPaidNotification } from "../../email/templates";
import {
  disputeAlert,
  paymentFailedDunning,
  paymentPlanCompleted,
  paymentPlanDefaulted,
  paymentPlanDefaultedAlert,
  paymentPlanOverchargeAlert,
  purchaseReceipt,
  refundReceipt,
  type ReceiptLine,
} from "../../email/commerceTemplates";
import { fireTriggerAsync } from "../../automations/engine";
import {
  createPaymentPlan,
  fulfillPayment,
  recordRefund,
  type FulfillResult,
} from "../../services/fulfillment";
import { releaseRedemption } from "../../services/coupons";
import { grantAccess, grantOfferAccess, revokeOfferAccess } from "../../services/access";
import { sendSetPasswordLink } from "../../services/setPasswordLink";
import { deliverPurchase, notifyOwnerOfSale } from "../../services/purchaseDelivery";
import { addInterval, type BillingInterval } from "../../services/pricing";
import { automationIdentity, publishDomainEvent } from "../../services/domainEvents";
import { dispatchEvent } from "../../services/webhooksOut";
import { upsertContactWithStatus } from "../../services/contacts";
import { readSetting } from "../../services/settings";
import { withStoredTemplate } from "../../email/templateStore";

/**
 * Stripe webhook receiver — the only place money becomes access.
 *
 * Requires the raw request body for signature verification, so app.ts mounts
 * express.raw() on this path ahead of the JSON body parser. If the body has
 * already been parsed to an object, verification will (correctly) fail.
 *
 * Four rules hold across every handler below:
 *
 *  1. **The raw event is stored before anything acts on it.** `stripe_events` is
 *     both the idempotency key and the only forensic record of what Stripe
 *     actually said when a payment later reconciles wrong.
 *  2. **Orders are never marked paid here.** `services/fulfillment.ts` owns that
 *     transition, because the admin's "record a manual payment" action has to
 *     produce byte-identical results and two implementations would drift.
 *  3. **Entitlement is only ever written through `services/access.ts`.** No
 *     handler decides access by reading `orders` or `subscriptions`.
 *  4. **Failure returns 500.** Stripe retries on 500 and gives up on 2xx, so
 *     swallowing an error is how a paid customer silently never gets access.
 */
export const stripeWebhookRouter = Router();

/** Postgres int4 ceiling: an id it cannot hold is bad data, not a failed query. */
const MAX_INT4 = 2_147_483_647;

/* --------------------------------------------------------------- settings */

/**
 * Billing behaviour Yvette can change without a deploy.
 *
 * Defaults are the conservative reading in both directions: no grace period
 * (access stops when the subscription does, which is what the customer agreed
 * to), and a full refund takes back what it paid for.
 */
const billingSettingsSchema = z.object({
  /** Extra days of access after a subscription ends. 0 = it ends with the period. */
  cancelGraceDays: z.number().int().min(0).max(365).default(0),
  revokeAccessOnFullRefund: z.boolean().default(true),
});

type BillingSettings = z.infer<typeof billingSettingsSchema>;

const DEFAULT_BILLING_SETTINGS: BillingSettings = billingSettingsSchema.parse({});

/**
 * A half-edited settings row must not be able to stop a payment being fulfilled,
 * so anything unparseable falls back to the defaults rather than throwing.
 */
async function billingSettings(): Promise<BillingSettings> {
  const res = await pool.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'billing'`
  );
  const parsed = billingSettingsSchema.safeParse(res.rows[0]?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_BILLING_SETTINGS;
}

/* --------------------------------------------------------------- metadata */

/**
 * The checkout's metadata, validated rather than trusted.
 *
 * These keys are written by routes/public/checkoutOffer.ts and come back on the
 * event, but they arrive as free-text strings that have made a round trip
 * through a third party, and `Number("")` is 0 — an id that would silently
 * address the wrong row. Every field is parsed, and a field that fails parsing
 * becomes `undefined` instead of poisoning the whole object.
 */
const metadataId = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .refine((n) => n > 0 && n <= MAX_INT4)
  .optional()
  .catch(undefined);

const offerMetadataSchema = z.object({
  orderId: metadataId,
  offerId: metadataId,
  parentOrderId: metadataId,
  pricingType: z
    .enum(["one_time", "subscription", "payment_plan", "free", "pwyw"])
    .optional()
    .catch(undefined),
  installmentCount: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .refine((n) => n > 1)
    .optional()
    .catch(undefined),
  installmentCents: z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number)
    .refine((n) => n >= 0)
    .optional()
    .catch(undefined),
});

type OfferMetadata = z.infer<typeof offerMetadataSchema>;

const EMPTY_METADATA: OfferMetadata = offerMetadataSchema.parse({});

function readMetadata(raw: Stripe.Metadata | null | undefined): OfferMetadata {
  const parsed = offerMetadataSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_METADATA;
}

/* ---------------------------------------------------------------- helpers */

/** Stripe timestamps are Unix seconds; every column here is TIMESTAMPTZ. */
function toDate(unix: number | null | undefined): Date | null {
  return typeof unix === "number" ? new Date(unix * 1000) : null;
}

/**
 * Stripe sends an id where the API would send an expanded object. Webhook
 * payloads are never expanded, but the types allow both and reading `.id` off a
 * string yields undefined rather than an error, which is how an id ends up NULL.
 */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[stripe:webhook] ${message}`);
}

/* ----------------------------------------------------------- the event log */

type EventClaim =
  | { claimed: true; attempts: number }
  /** `inFlight` distinguishes work another delivery is doing from work that is done. */
  | { claimed: false; inFlight: boolean };

/**
 * How long one delivery may hold an event before another may take it over.
 *
 * The claim has to be reclaimable at all, or a process killed mid-handler
 * wedges its event until somebody notices by hand. The window is far longer
 * than any handler here takes and far shorter than the three days Stripe keeps
 * retrying, so the takeover is done by an ordinary retry.
 */
const CLAIM_TIMEOUT_SECONDS = 15 * 60;

/**
 * Records the raw event and claims the exclusive right to process it.
 *
 * **This is the idempotency backbone of the whole file.** `stripe_events.id` is
 * the primary key, so a redelivery of an event already carried to completion
 * cannot insert and cannot pass the DO UPDATE's WHERE — no row comes back, the
 * caller acknowledges 200, and nothing downstream runs a second time. Every
 * "did this already happen?" question below ultimately rests on this.
 *
 * The claim is a state the handler holds, not a moment the statement passes
 * through, and the difference is the whole point. A row marked 'received' and
 * committed releases its lock immediately, which claims nothing: Stripe retries
 * a delivery it has had no answer to in about ten seconds, the handler is still
 * running, and the retry finds a row it is allowed to re-claim. Two handlers on
 * one event is not a theoretical race — it is the ordinary shape of a timeout
 * retry — and it doubles every write whose guard is weaker than a unique key.
 * 'processing' is therefore held for as long as the handler runs; only
 * `markProcessed` and `markFailed` give it back, and only a claim older than
 * `CLAIM_TIMEOUT_SECONDS` (the process died holding it) can be taken.
 *
 * The conflict is DO UPDATE rather than DO NOTHING for one specific reason: an
 * attempt that FAILED returned 500 precisely so Stripe would retry, and DO
 * NOTHING would make that retry look like a duplicate and drop it. 'processed'
 * and 'ignored' are final, 'failed' is re-claimable at once, and a stale
 * 'processing' — or a 'received' row, one stored without a claim, whose age is
 * taken from `received_at` — is re-claimable once its holder has timed out.
 */
async function claimEvent(event: Stripe.Event): Promise<EventClaim> {
  const res = await pool.query<{ attempts: number }>(
    `INSERT INTO stripe_events (id, type, api_version, payload, status, claimed_at)
     VALUES ($1, $2, $3, $4, 'processing', now())
     ON CONFLICT (id) DO UPDATE
       SET status = 'processing', claimed_at = now()
       WHERE stripe_events.status = 'failed'
          OR (stripe_events.status IN ('processing', 'received')
              AND COALESCE(stripe_events.claimed_at, stripe_events.received_at)
                  < now() - $5::int * INTERVAL '1 second')
     RETURNING attempts`,
    [
      event.id,
      event.type,
      event.api_version ?? "",
      JSON.stringify(event),
      CLAIM_TIMEOUT_SECONDS,
    ]
  );

  const row = res.rows[0];
  if (row) return { claimed: true, attempts: row.attempts };

  // Why the claim was refused decides what Stripe is told, so it is read back
  // rather than assumed. Finished work is worth a 200 — that is what stops the
  // retries — but a delivery still in flight has no outcome yet, and answering
  // 200 on its behalf would promise a result this request has not seen and
  // cannot produce if the other one dies.
  const existing = await pool.query<{ status: string }>(
    `SELECT status FROM stripe_events WHERE id = $1`,
    [event.id]
  );
  const status = existing.rows[0]?.status ?? "";
  return { claimed: false, inFlight: status === "processing" || status === "received" };
}

async function markProcessed(eventId: string, handled: boolean): Promise<void> {
  await pool.query(
    `UPDATE stripe_events
        SET status = $2, processed_at = now(), error = ''
      WHERE id = $1`,
    [eventId, handled ? "processed" : "ignored"]
  );
}

async function markFailed(eventId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await pool.query(
    `UPDATE stripe_events
        SET status = 'failed', error = $2, attempts = attempts + 1
      WHERE id = $1`,
    [eventId, truncate(message, 2000)]
  );
}

/* ------------------------------------------------------------------ orders */

interface OrderRow {
  id: number;
  offer_id: number | null;
  member_id: number | null;
  email: string;
  billing_name: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_cents: number;
  coupon_code: string;
  course_title: string;
  offer_title: string | null;
}

const ORDER_SELECT = `
  SELECT o.id, o.offer_id, o.member_id, o.email, o.billing_name, o.status, o.currency,
         o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.refunded_cents,
         o.coupon_code, o.course_title, f.title AS offer_title
    FROM orders o
    LEFT JOIN offers f ON f.id = o.offer_id`;

async function loadOrderById(id: number): Promise<OrderRow | null> {
  const res = await pool.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  return res.rows[0] ?? null;
}

async function loadOrderByPaymentIntent(paymentIntentId: string): Promise<OrderRow | null> {
  const res = await pool.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.stripe_payment_intent_id = $1`,
    [paymentIntentId]
  );
  return res.rows[0] ?? null;
}

async function loadOrderBySession(sessionId: string): Promise<OrderRow | null> {
  const res = await pool.query<OrderRow>(`${ORDER_SELECT} WHERE o.stripe_session_id = $1`, [
    sessionId,
  ]);
  return res.rows[0] ?? null;
}

/** What the buyer thinks they bought, for receipts and automation payloads. */
function describe(order: OrderRow): string {
  return order.offer_title || order.course_title || `Order #${order.id}`;
}

/**
 * The order a payment belongs to.
 *
 * The metadata id is preferred over the Stripe id because it is the link the
 * checkout established deliberately; the Stripe id lookup covers the legacy
 * hosted-checkout path, which predates the metadata and has no orderId to send.
 */
async function resolveOrder(
  meta: OfferMetadata,
  paymentIntentId: string | null
): Promise<OrderRow | null> {
  if (meta.orderId !== undefined) {
    const byMetadata = await loadOrderById(meta.orderId);
    if (byMetadata) return byMetadata;
  }
  if (paymentIntentId) return loadOrderByPaymentIntent(paymentIntentId);
  return null;
}

/* -------------------------------------------------------- payment settling */

interface PaymentFacts {
  paymentIntentId: string | null;
  chargeId: string | null;
  amountCents: number;
  currency: string;
  email: string | null;
  stripeCustomerId: string | null;
  paymentMethod?: { brand?: string; last4?: string; type?: string };
  country?: string;
  state?: string;
  occurredAt: Date;
}

/**
 * The buyer's copy of the transaction, the welcome, and the way into the account
 * if the purchase just created one.
 *
 * Delegated to `services/purchaseDelivery.ts` rather than written here, because
 * the $0 checkout and the admin's manual grant complete a purchase without ever
 * reaching this file and owe the buyer exactly the same things. Fire-and-forget:
 * the money has moved and the access has been granted by the time this runs, so
 * a mail outage must not turn a completed purchase into a retried webhook that
 * tries to fulfil it all over again.
 */
async function sendPurchaseEmails(order: OrderRow, result: FulfillResult): Promise<void> {
  await deliverPurchase({
    orderId: order.id,
    memberId: result.memberId,
    createdMember: result.createdMember,
  });
}

/**
 * Records a payment against an order and sends what a first payment sends.
 *
 * `fulfillPayment` is idempotent and reports `fulfilled: false` for a delivery
 * that changed nothing, which is what gates the emails: a replay must not
 * produce a second receipt or a second set-password link.
 */
async function settleOrderPayment(
  order: OrderRow,
  facts: PaymentFacts
): Promise<FulfillResult> {
  const result = await fulfillPayment({
    orderId: order.id,
    paymentIntentId: facts.paymentIntentId,
    chargeId: facts.chargeId,
    amountCents: facts.amountCents,
    currency: facts.currency,
    email: facts.email ?? order.email,
    paymentMethod: facts.paymentMethod,
    country: facts.country,
    state: facts.state,
    stripeCustomerId: facts.stripeCustomerId,
    occurredAt: facts.occurredAt,
  });

  if (!result.fulfilled) {
    log(`order ${order.id} was already fulfilled; nothing to do`);
    return result;
  }

  log(`order ${order.id} paid — granted products [${result.grantedProductIds.join(", ")}]`);
  await sendPurchaseEmails(order, result);
  notifyOwnerOfSale({
    description: describe(order),
    email: order.email,
    amountCents: order.total_cents,
    currency: order.currency,
  });
  fireTriggerAsync("order_paid", {
    email: order.email,
    courseTitle: describe(order),
    amountCents: order.total_cents,
  });

  return result;
}

/**
 * Fills in the card details a PaymentIntent event does not carry.
 *
 * `payment_intent.succeeded` sends `latest_charge` as a bare id, so the brand and
 * last four only exist on the Charge object. Whichever of the two events loses
 * the race still has something the winner did not, and this is the cheap half:
 * purely cosmetic, for the payments report, and never the thing that fulfils.
 */
async function enrichTransaction(paymentIntentId: string, facts: PaymentFacts): Promise<void> {
  await pool.query(
    `UPDATE transactions
        SET payment_method_brand = CASE WHEN payment_method_brand = '' THEN $2 ELSE payment_method_brand END,
            payment_method_last4 = CASE WHEN payment_method_last4 = '' THEN $3 ELSE payment_method_last4 END,
            payment_method_type  = CASE WHEN payment_method_type  = '' THEN $4 ELSE payment_method_type  END,
            country              = CASE WHEN country = '' THEN $5 ELSE country END,
            state                = CASE WHEN state   = '' THEN $6 ELSE state   END,
            stripe_charge_id     = COALESCE(stripe_charge_id, $7)
      WHERE stripe_payment_intent_id = $1`,
    [
      paymentIntentId,
      facts.paymentMethod?.brand ?? "",
      facts.paymentMethod?.last4 ?? "",
      facts.paymentMethod?.type ?? "",
      facts.country ?? "",
      facts.state ?? "",
      facts.chargeId,
    ]
  );
}

/**
 * Records a declined attempt.
 *
 * Deliberately keyed on the charge and NOT on the PaymentIntent: a declined
 * PaymentIntent can be retried with another card and succeed on the same id, and
 * `transactions.stripe_payment_intent_id` is UNIQUE — a failure row holding that
 * id would make `fulfillPayment`'s own insert a no-op and leave the eventual
 * success recorded as a failure, with the revenue reports built on top of it.
 *
 * Not every decline has a charge, though: one refused before Stripe creates it —
 * a failed authentication, a card the network rejects outright — carries a NULL,
 * and `=` against NULL is unknown, so a charge-id guard silently matches nothing
 * and every replay writes another row into the money ledger. `IS NOT DISTINCT
 * FROM` makes the comparison hold for NULL too, and the attempt is then
 * identified by the intent's own creation instant, which is fixed for the life
 * of the PaymentIntent and therefore identical on every delivery of it.
 */
async function recordFailedAttempt(input: {
  orderId: number | null;
  memberId: number | null;
  email: string;
  amountCents: number;
  currency: string;
  chargeId: string | null;
  reason: string;
  occurredAt: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO transactions
       (order_id, member_id, email, kind, status, amount_cents,
        currency, stripe_charge_id, failure_reason, occurred_at)
     SELECT $1, $2, $3, 'payment', 'failed', $4, $5, $6, $7, $8
      WHERE NOT EXISTS (
              SELECT 1 FROM transactions t
               WHERE t.stripe_charge_id IS NOT DISTINCT FROM $6::text
                 AND (t.stripe_charge_id IS NOT NULL
                      OR (t.kind = 'payment'
                          AND t.status = 'failed'
                          AND t.order_id IS NOT DISTINCT FROM $1::int
                          AND t.amount_cents = $4::int
                          AND t.occurred_at = $8::timestamptz))
            )`,
    [
      input.orderId,
      input.memberId,
      input.email,
      input.amountCents,
      input.currency,
      input.chargeId,
      truncate(input.reason, 500),
      input.occurredAt,
    ]
  );
}

/* --------------------------------------------------------- checkout events */

/**
 * The legacy hosted-checkout subscription path.
 *
 * Offer checkout drives subscriptions through the Payment Element and never
 * creates a Checkout Session, so this only ever fires for `plans` sold by
 * routes/public/checkout.ts. A trial means there is no payment yet and
 * payment_status never reaches "paid", so the subscription is recorded here and
 * customer.subscription.* keeps it in step from then on.
 */
async function mirrorLegacyPlanSubscription(session: Stripe.Checkout.Session): Promise<void> {
  const subscriptionId = idOf(session.subscription);
  if (!subscriptionId) return;

  const email = (session.customer_details?.email ?? session.customer_email ?? "")
    .trim()
    .toLowerCase();
  const planIdRaw = session.metadata?.planId ?? "";
  const planId = /^\d{1,10}$/.test(planIdRaw) && Number(planIdRaw) <= MAX_INT4
    ? Number(planIdRaw)
    : null;

  let memberId: number | null = null;
  let memberWasCreated = false;
  let contactId: number | null = null;
  let contactWasCreated = false;
  if (email) {
    const member = await pool.query<{ id: number; created: boolean }>(
      `INSERT INTO members (email, name, status) VALUES ($1, '', 'active')
       ON CONFLICT (email) DO UPDATE SET updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [email]
    );
    memberId = member.rows[0]?.id ?? null;
    memberWasCreated = member.rows[0]?.created ?? false;
    const contact = await upsertContactWithStatus({ email, source: "customer" });
    contactId = contact.id;
    contactWasCreated = contact.created;
    if (memberId !== null) {
      await pool.query(
        `UPDATE members SET contact_id = COALESCE(contact_id, $2), updated_at = now() WHERE id = $1`,
        [memberId, contactId],
      );
    }
  }

  const subscription = await pool.query<{ id: number; created: boolean }>(
    `INSERT INTO subscriptions
       (member_id, plan_id, email, stripe_customer_id, stripe_subscription_id,
        status, amount_cents, currency)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
     ON CONFLICT (stripe_subscription_id) DO UPDATE
       SET member_id = COALESCE(EXCLUDED.member_id, subscriptions.member_id),
           plan_id   = COALESCE(EXCLUDED.plan_id, subscriptions.plan_id),
           status    = 'active',
           updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [
      memberId,
      planId,
      email,
      idOf(session.customer),
      subscriptionId,
      session.amount_total ?? 0,
      session.currency ?? "usd",
    ]
  );

  // A paid plan can unlock a community; enrol on purchase rather than on first
  // visit, so the welcome post is there when they arrive.
  if (planId !== null && memberId !== null) {
    await pool.query(
      // source 'plan': the subscription is the entitlement, so the door reads
      // this row rather than looking for a grant that a plan never creates.
      `INSERT INTO community_memberships (community_id, member_id, source, subscription_id)
       SELECT p.community_id, $2, 'plan',
              (SELECT s.id FROM subscriptions s WHERE s.stripe_subscription_id = $3)
         FROM plans p
        WHERE p.id = $1 AND p.community_id IS NOT NULL
       ON CONFLICT (community_id, member_id) DO UPDATE
         SET source = 'plan',
             subscription_id = COALESCE(EXCLUDED.subscription_id, community_memberships.subscription_id)`,
      [planId, memberId, subscriptionId]
    );

    // Plans use the same catalogue entitlements as offers. Binding each grant
    // to the local subscription makes cancellation, pause and dunning revoke
    // exactly what this subscription supplied without touching outright buys.
    const planProducts = await pool.query<{ product_id: number }>(
      `SELECT product_id FROM plan_products WHERE plan_id = $1 ORDER BY sort, product_id`,
      [planId],
    );
    for (const item of planProducts.rows) {
      await grantAccess({
        memberId,
        productId: item.product_id,
        subscriptionId: subscription.rows[0].id,
        source: "plan",
      });
    }
  }

  if (contactWasCreated && contactId !== null) {
    await publishDomainEvent("contact_created", {
      eventKey: `contact-created:${contactId}`,
      contactId,
      email,
      source: "customer",
    });
  }
  if (memberWasCreated && memberId !== null) {
    await dispatchEvent("member.created", {
      id: `member:${memberId}`,
      memberId,
      contactId,
      email,
      source: "legacy-plan-checkout",
    });
  }
  if (subscription.rows[0]?.created) {
    await dispatchEvent("subscription.started", {
      id: `subscription:${subscription.rows[0].id}`,
      subscriptionId: subscription.rows[0].id,
      planId,
      memberId,
      contactId,
      email,
      status: "active",
    });
  }
}

/** A Checkout Session that has actually been paid, whatever collected it. */
async function settleSessionPayment(session: Stripe.Checkout.Session): Promise<void> {
  const meta = readMetadata(session.metadata);
  const paymentIntentId = idOf(session.payment_intent);

  const order =
    (meta.orderId !== undefined ? await loadOrderById(meta.orderId) : null) ??
    (await loadOrderBySession(session.id)) ??
    (paymentIntentId ? await loadOrderByPaymentIntent(paymentIntentId) : null);

  if (!order) {
    log(`session ${session.id} paid but no matching order — nothing fulfilled`);
    return;
  }

  const address = session.customer_details?.address ?? null;
  await settleOrderPayment(order, {
    paymentIntentId,
    chargeId: null,
    amountCents: session.amount_total ?? order.total_cents,
    currency: session.currency ?? order.currency,
    email: session.customer_details?.email ?? session.customer_email ?? null,
    stripeCustomerId: idOf(session.customer),
    country: address?.country ?? "",
    state: address?.state ?? "",
    occurredAt: toDate(session.created) ?? new Date(),
  });
}

async function handleSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode === "subscription") {
    await mirrorLegacyPlanSubscription(session);
    return;
  }

  // `complete` and unpaid is the normal shape for a delayed method such as a
  // bank debit. checkout.session.async_payment_succeeded is the event that says
  // the money arrived, and acting here would grant access on an unpaid order.
  if (session.payment_status !== "paid") {
    log(`session ${session.id} completed but payment_status=${session.payment_status}; waiting`);
    return;
  }

  await settleSessionPayment(session);
}

/**
 * Ends a pending order and gives back anything it was holding.
 *
 * The coupon redemption is the part that matters: it is claimed when the order
 * is created, so a checkout that expires or fails must return it. Otherwise
 * every abandoned cart permanently consumes one of a limited code's uses.
 */
async function closePendingOrder(
  orderId: number | null,
  sessionId: string,
  status: "expired" | "failed"
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const closed = await client.query<{ id: number }>(
      `UPDATE orders SET status = $3, updated_at = now()
        WHERE (id = $1 OR stripe_session_id = $2) AND status = 'pending'
        RETURNING id`,
      [orderId, sessionId, status]
    );
    for (const row of closed.rows) {
      await releaseRedemption(client, row.id);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function handleSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const meta = readMetadata(session.metadata);
  await closePendingOrder(meta.orderId ?? null, session.id, "expired");
}

async function handleSessionAsyncFailed(session: Stripe.Checkout.Session): Promise<void> {
  const meta = readMetadata(session.metadata);
  await closePendingOrder(meta.orderId ?? null, session.id, "failed");
}

/* ---------------------------------------------------------- payment intents */

async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const meta = readMetadata(intent.metadata);
  const order = await resolveOrder(meta, intent.id);

  // A PaymentIntent raised by an invoice has no order of its own; invoice.paid
  // owns the subscription and payment-plan side of the ledger.
  if (!order) {
    log(`payment_intent ${intent.id} has no order — leaving it to invoice.paid`);
    return;
  }

  await settleOrderPayment(order, {
    paymentIntentId: intent.id,
    chargeId: idOf(intent.latest_charge),
    amountCents: intent.amount_received || intent.amount,
    currency: intent.currency,
    email: intent.receipt_email,
    stripeCustomerId: idOf(intent.customer),
    occurredAt: toDate(intent.created) ?? new Date(),
  });
}

/**
 * The same payment, seen as a Charge.
 *
 * Handled as well as payment_intent.succeeded because only this payload carries
 * the card brand and last four, and Stripe does not guarantee which of the two
 * arrives first. `fulfillPayment` is idempotent, so whichever wins fulfils and
 * the loser either enriches the transaction or does nothing at all.
 */
async function handleChargeSucceeded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = idOf(charge.payment_intent);
  const meta = readMetadata(charge.metadata);
  const order = await resolveOrder(meta, paymentIntentId);
  if (!order) return;

  const card = charge.payment_method_details?.card ?? null;
  const address = charge.billing_details?.address ?? null;
  const facts: PaymentFacts = {
    paymentIntentId,
    chargeId: charge.id,
    amountCents: charge.amount_captured || charge.amount,
    currency: charge.currency,
    email: charge.billing_details?.email ?? charge.receipt_email,
    stripeCustomerId: idOf(charge.customer),
    paymentMethod: {
      brand: card?.brand ?? "",
      last4: card?.last4 ?? "",
      type: charge.payment_method_details?.type ?? "",
    },
    country: address?.country ?? "",
    state: address?.state ?? "",
    occurredAt: toDate(charge.created) ?? new Date(),
  };

  const result = await settleOrderPayment(order, facts);
  if (!result.fulfilled && paymentIntentId) {
    await enrichTransaction(paymentIntentId, facts);
  }
}

async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const meta = readMetadata(intent.metadata);
  const order = await resolveOrder(meta, intent.id);
  const reason =
    intent.last_payment_error?.message ??
    intent.last_payment_error?.code ??
    "The payment was declined";

  if (order) {
    // Never touch a paid order: a failed attempt can arrive after a successful
    // retry, and un-paying an order would revoke access somebody has paid for.
    //
    // The coupon redemption is released in the same transaction. This is the
    // most-travelled way an order dies — an ordinary card decline in the
    // Payment Element — and holding the redemption would mean the shopper who
    // was declined is told "you've already used that code" when they retry with
    // another card, while a limited code silently loses a use to a sale that
    // never happened.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const failed = await client.query<{ id: number }>(
        `UPDATE orders SET status = 'failed', updated_at = now()
          WHERE id = $1 AND status <> 'paid'
          RETURNING id`,
        [order.id]
      );
      if (failed.rows[0]) await releaseRedemption(client, failed.rows[0].id);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  await recordFailedAttempt({
    orderId: order?.id ?? null,
    memberId: order?.member_id ?? null,
    email: order?.email ?? intent.receipt_email ?? "",
    amountCents: intent.amount,
    currency: intent.currency,
    chargeId: idOf(intent.latest_charge),
    reason,
    occurredAt: toDate(intent.created) ?? new Date(),
  });

  // Subscription declines also emit invoice.payment_failed. Let that richer,
  // attempt-numbered event be the sole automation occurrence so one card
  // decline cannot start the same dunning automation twice.
  const invoiceRef = (intent as unknown as { invoice?: string | { id?: string } | null }).invoice;
  const relatedInvoice = typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id ?? null;
  if (!relatedInvoice) {
    const identity = await automationIdentity(
      order?.member_id ?? null,
      order?.email ?? intent.receipt_email ?? "",
      order?.billing_name ?? "",
    );
    await publishDomainEvent("payment_failed", {
      eventKey: `payment-failed:intent:${intent.id}:${idOf(intent.latest_charge) ?? intent.created}`,
      contactId: identity.contactId,
      email: identity.email,
      name: identity.name,
      subjectId: order?.offer_id ?? null,
      source: "stripe",
      facts: {
        orderId: order?.id ?? 0,
        amountCents: intent.amount,
        currency: intent.currency,
        reason,
      },
    });
  }

  log(`payment_intent ${intent.id} failed: ${reason}`);
}

/* ---------------------------------------------------------------- invoices */

interface PlanRow {
  id: number;
  order_id: number | null;
  offer_id: number | null;
  member_id: number | null;
  email: string;
  installment_cents: number;
  installment_count: number;
  installments_paid: number;
  currency: string;
  status: string;
}

const PLAN_COLUMNS = `id, order_id, offer_id, member_id, email, installment_cents,
                      installment_count, installments_paid, currency, status`;

async function loadPlan(stripeSubscriptionId: string): Promise<PlanRow | null> {
  const res = await pool.query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM payment_plans WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );
  return res.rows[0] ?? null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // The flat `invoice.subscription` field was replaced by the polymorphic
  // `parent` object, which is why the API version is pinned in stripe/client.ts.
  return idOf(invoice.parent?.subscription_details?.subscription);
}

function invoiceMetadata(invoice: Stripe.Invoice): OfferMetadata {
  // An immutable snapshot of the subscription's metadata taken when the invoice
  // was finalised — the offer and order ids without an API call to fetch them.
  return readMetadata(invoice.parent?.subscription_details?.metadata);
}

function invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  for (const payment of invoice.payments?.data ?? []) {
    const intentId = idOf(payment.payment?.payment_intent);
    if (intentId) return intentId;
  }
  return null;
}

async function localSubscriptionId(stripeSubscriptionId: string): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Mirrors the invoice and claims the right to act on it.
 *
 * `invoices.stripe_invoice_id` is UNIQUE, and the guard on the conflict path
 * makes this the per-invoice idempotency key: an invoice already recorded as
 * paid returns no row, and the caller stops. That matters more than the
 * event-level guard for payment plans, because advancing an installment counter
 * is the one operation here that is not naturally idempotent — a second run
 * would consume the customer's next payment before they had made it.
 *
 * "Not paid yet" is the whole of that key for a payment, because an invoice is
 * paid once. It is not the whole of it for a failure: an invoice can genuinely
 * be declined several times, so status alone cannot tell the second decline
 * apart from the second delivery of the first, and the caller sends a dunning
 * email on whatever it is told is new. Stripe's attempt number is what separates
 * them, and a failure therefore has to be newer than the one already recorded.
 */
async function upsertInvoice(input: {
  stripeInvoiceId: string;
  subscriptionId: number | null;
  paymentPlanId: number | null;
  memberId: number | null;
  orderId: number | null;
  number: string;
  email: string;
  amountDueCents: number;
  amountPaidCents: number;
  taxCents: number;
  currency: string;
  status: "paid" | "failed";
  /** Stripe's count of payment attempts on this invoice; the failure key. */
  attemptCount: number;
  hostedInvoiceUrl: string;
  pdfUrl: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
}): Promise<boolean> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO invoices
       (stripe_invoice_id, subscription_id, payment_plan_id, member_id, order_id, number,
        email, amount_due_cents, amount_paid_cents, tax_cents, currency, status,
        hosted_invoice_url, pdf_url, period_start, period_end, paid_at, attempt_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       subscription_id   = COALESCE(EXCLUDED.subscription_id, invoices.subscription_id),
       payment_plan_id   = COALESCE(EXCLUDED.payment_plan_id, invoices.payment_plan_id),
       member_id         = COALESCE(EXCLUDED.member_id, invoices.member_id),
       order_id          = COALESCE(EXCLUDED.order_id, invoices.order_id),
       number            = EXCLUDED.number,
       email             = EXCLUDED.email,
       amount_due_cents  = EXCLUDED.amount_due_cents,
       amount_paid_cents = EXCLUDED.amount_paid_cents,
       tax_cents         = EXCLUDED.tax_cents,
       currency          = EXCLUDED.currency,
       status            = EXCLUDED.status,
       hosted_invoice_url = EXCLUDED.hosted_invoice_url,
       pdf_url           = EXCLUDED.pdf_url,
       period_start      = COALESCE(EXCLUDED.period_start, invoices.period_start),
       period_end        = COALESCE(EXCLUDED.period_end, invoices.period_end),
       paid_at           = COALESCE(EXCLUDED.paid_at, invoices.paid_at),
       attempt_count     = GREATEST(invoices.attempt_count, EXCLUDED.attempt_count)
     -- Claimed on settled_at, not on status. Writing the invoice row is the
     -- FIRST thing this handler does and settling the order is the last, so
     -- having recorded an invoice is not evidence the work it implies ever
     -- finished. Keying the claim on the row existing meant a handler that
     -- threw half way was never retried successfully: the redelivery saw a paid
     -- invoice, reported nothing to do, and left the order pending with the
     -- money taken.
     WHERE invoices.settled_at IS NULL
       AND (EXCLUDED.status <> 'failed' OR invoices.attempt_count < EXCLUDED.attempt_count)
     RETURNING id`,
    [
      input.stripeInvoiceId,
      input.subscriptionId,
      input.paymentPlanId,
      input.memberId,
      input.orderId,
      input.number,
      input.email,
      input.amountDueCents,
      input.amountPaidCents,
      input.taxCents,
      input.currency,
      input.status,
      input.hostedInvoiceUrl,
      input.pdfUrl,
      input.periodStart,
      input.periodEnd,
      input.paidAt,
      input.attemptCount,
    ]
  );
  return res.rows.length > 0;
}

/**
 * Records a recurring charge that is not the first one on its order.
 *
 * These cannot go through `fulfillPayment`: it exists to move an order from
 * pending to paid exactly once, and installment two of a plan is a second charge
 * against an order that is already paid. The order-level rule still holds —
 * nothing here writes `orders.status`.
 */
async function recordRecurringPayment(input: {
  orderId: number | null;
  subscriptionId: number | null;
  memberId: number | null;
  email: string;
  amountCents: number;
  currency: string;
  paymentIntentId: string | null;
  occurredAt: Date;
}): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO transactions
       (order_id, subscription_id, member_id, email, kind, status, amount_cents,
        currency, stripe_payment_intent_id, occurred_at)
     VALUES ($1,$2,$3,$4,'payment','succeeded',$5,$6,$7,$8)
     ON CONFLICT (stripe_payment_intent_id) DO NOTHING
     RETURNING id`,
    [
      input.orderId,
      input.subscriptionId,
      input.memberId,
      input.email,
      input.amountCents,
      input.currency,
      input.paymentIntentId,
      input.occurredAt,
    ]
  );
  return res.rows[0]?.id ?? null;
}

/** Sends a renewal/installment receipt once the idempotent ledger row exists. */
async function sendRecurringReceipt(
  invoice: Stripe.Invoice,
  order: OrderRow | null,
  plan: PlanRow | null,
  collectedCents: number,
): Promise<void> {
  const settings = await readSetting("customer_payments");
  const rule = String(settings.receiptRule ?? "every");
  if (settings.sendReceipts === false || rule === "first" || (rule === "nonzero" && collectedCents <= 0)) {
    return;
  }
  const to = invoice.customer_email ?? order?.email ?? plan?.email ?? "";
  if (!to) return;
  const title = order ? describe(order) : "Your payment";
  const fallback = purchaseReceipt({
    buyerName: order?.billing_name ?? "",
    orderId: order?.id ?? plan?.order_id ?? 0,
    lines: [{ title, quantity: 1, amountCents: collectedCents }],
    subtotalCents: collectedCents,
    discountCents: 0,
    couponCode: "",
    taxCents: 0,
    totalCents: collectedCents,
    currency: invoice.currency,
  });
  const portalLine = invoice.hosted_invoice_url
    ? `\n\nView the invoice: ${invoice.hosted_invoice_url}`
    : `\n\nView your invoices: ${env.publicSiteUrl}/account/billing`;
  const content = await withStoredTemplate(
    "purchase_receipt",
    {
      firstName: (order?.billing_name ?? "").split(/\s+/)[0] ?? "",
      name: order?.billing_name ?? "",
      email: to,
      offer: title,
      orderId: String(order?.id ?? plan?.order_id ?? ""),
      total: fallback.subject,
    },
    { ...fallback, text: `${fallback.text}${portalLine}` },
  );
  await sendMail({ to, ...content });
}

/** The first payment's transaction, for linking installment 1 of a plan. */
async function firstTransactionForOrder(orderId: number): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM transactions
      WHERE order_id = $1 AND kind = 'payment' AND status = 'succeeded'
      ORDER BY id LIMIT 1`,
    [orderId]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * What one charge of a payment plan actually costs this customer.
 *
 * `offers.amount_cents` is the list price of one installment, and it is the
 * wrong figure the moment a coupon is applied: the card is charged the
 * discounted amount, so a schedule built from the list price tells a customer on
 * 3 x $1,250 with 20% off that they still owe $2,500 when they owe $2,000, and
 * later emails them that they paid $3,750 when they paid $3,000. The order is
 * where the discount was actually worked out, so the schedule follows the order.
 *
 * Bumps and tax are excluded deliberately. A bump is a one-off that rides along
 * on the first invoice and is never charged again, so folding it into the
 * per-installment figure would inflate every remaining payment.
 *
 * The two figures differ only for a coupon that discounts a single charge:
 * Stripe applies it once, so the opening installment is discounted and the rest
 * are billed in full.
 */
async function planInstallmentPricing(
  order: OrderRow,
  listCents: number
): Promise<{ recurringCents: number; firstCents: number }> {
  const res = await pool.query<{ offer_cents: number; coupon_duration: string | null }>(
    `SELECT COALESCE((SELECT SUM(i.amount_cents)::int
                        FROM order_items i
                       WHERE i.order_id = o.id AND i.kind = 'offer'), 0) AS offer_cents,
            c.duration AS coupon_duration
       FROM orders o
       LEFT JOIN coupons c ON c.id = o.coupon_id
      WHERE o.id = $1`,
    [order.id]
  );

  const row = res.rows[0];
  // The legacy course path writes no order_items, so the offer's own price is
  // the only statement of what the recurring line costs.
  const offerCents = row && row.offer_cents > 0 ? row.offer_cents : listCents;

  // The coupon came off the whole order; the offer line's share of it is the
  // part that comes off this charge.
  const share =
    order.subtotal_cents > 0
      ? Math.min(offerCents, Math.round((order.discount_cents * offerCents) / order.subtotal_cents))
      : 0;
  const firstCents = Math.max(0, offerCents - share);

  return {
    firstCents,
    recurringCents: row?.coupon_duration === "forever" ? firstCents : offerCents,
  };
}

/**
 * Sets up the installment schedule when a payment plan's opening invoice settles.
 *
 * The plan's shape is read from the offer rather than from the event's metadata:
 * metadata is a string round-tripped through a third party, and `offers` is where
 * "3 x $1,250" is actually defined. Metadata only stands in if the offer has
 * since been deleted. The prices come from the order, which is the only place
 * that knows what this customer was charged.
 */
async function startPaymentPlan(input: {
  order: OrderRow;
  meta: OfferMetadata;
  /**
   * The member the plan belongs to, taken from the fulfilment that just ran
   * rather than from the order as it was read: a guest checkout has no member
   * until the first payment creates one, and a plan with a null member_id is
   * invisible on the billing page and untouchable when the plan defaults.
   */
  memberId: number | null;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  /** What the opening invoice collected. Zero means no installment was paid. */
  collectedCents: number;
  /** The opening invoice, stamped on installment one so a replay of it cannot advance the plan. */
  stripeInvoiceId: string;
  startAt: Date;
}): Promise<number | null> {
  const offerId = input.order.offer_id ?? input.meta.offerId ?? null;
  if (offerId === null) return null;

  const offerRes = await pool.query<{
    amount_cents: number;
    currency: string;
    interval: BillingInterval | null;
    interval_count: number;
    installment_count: number | null;
  }>(
    `SELECT amount_cents, currency, interval, interval_count, installment_count
       FROM offers WHERE id = $1`,
    [offerId]
  );
  const offer = offerRes.rows[0];

  const installmentCount = offer?.installment_count ?? input.meta.installmentCount;
  const listCents = offer?.amount_cents ?? input.meta.installmentCents;
  if (installmentCount === undefined || installmentCount === null) {
    log(`offer ${offerId} has no installment_count; cannot build a plan schedule`);
    return null;
  }
  if (listCents === undefined || listCents === null) return null;

  const pricing = await planInstallmentPricing(input.order, listCents);

  return createPaymentPlan({
    orderId: input.order.id,
    offerId,
    memberId: input.memberId ?? input.order.member_id,
    email: input.order.email,
    installmentCents: pricing.recurringCents,
    firstInstallmentCents: pricing.firstCents,
    installmentCount,
    firstInstallmentPaid: input.collectedCents > 0,
    firstStripeInvoiceId: input.stripeInvoiceId,
    interval: offer?.interval ?? "month",
    intervalCount: offer?.interval_count ?? 1,
    currency: offer?.currency ?? input.order.currency,
    startAt: input.startAt,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    firstTransactionId: await firstTransactionForOrder(input.order.id),
  });
}

/**
 * Advances a payment plan by exactly one installment, and stops it at the end.
 *
 * This is the whole difference between a payment plan and a subscription, and
 * getting it wrong bills a customer forever. Two invariants:
 *
 *  - **`installments_paid` never passes `installment_count`.** The plan stops
 *    itself in Stripe — routes/public/checkoutOffer.ts creates the subscription
 *    with `cancel_at` set to the final installment date — so an invoice arriving
 *    after the last one means that safeguard has failed and somebody who has
 *    finished paying is being charged again. The counter is left alone (the
 *    plan's own records stay truthful) and the admin is paged, because no code
 *    here can un-charge a card.
 *  - **One invoice advances one installment.** The row lock plus
 *    `status <> 'paid'` on the installment means a concurrent or replayed
 *    delivery updates nothing rather than eating the customer's next payment.
 */
async function advancePaymentPlan(input: {
  stripeSubscriptionId: string;
  /**
   * The idempotency key for this credit.
   *
   * Everything else in the invoice handler is naturally idempotent, but this is
   * not: it advances a counter by one. A retry after a partial failure would
   * credit a second installment and mark the plan paid off a payment early, so
   * the invoice is recorded on the row and a repeat becomes a no-op.
   */
  stripeInvoiceId: string;
  transactionId: number | null;
  amountCents: number;
  currency: string;
  paidAt: Date;
}): Promise<void> {
  const client: PoolClient = await pool.connect();
  let completedPlan: PlanRow | null = null;
  let overcharged: PlanRow | null = null;

  try {
    await client.query("BEGIN");

    const planRes = await client.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM payment_plans
        WHERE stripe_subscription_id = $1
        FOR UPDATE`,
      [input.stripeSubscriptionId]
    );
    const plan = planRes.rows[0];
    if (!plan) {
      await client.query("ROLLBACK");
      return;
    }

    const nextSequence = plan.installments_paid + 1;
    if (plan.status === "completed" || nextSequence > plan.installment_count) {
      await client.query("ROLLBACK");
      overcharged = plan;
    } else {
      const marked = await client.query<{ id: number }>(
        `UPDATE payment_plan_installments
            SET status = 'paid',
                paid_at = $3,
                transaction_id = COALESCE($4, transaction_id),
                stripe_invoice_id = $5
          WHERE payment_plan_id = $1 AND sequence = $2 AND status <> 'paid'
            -- The unique index on stripe_invoice_id would reject a second
            -- credit for the same invoice anyway; refusing it here turns that
            -- into a quiet no-op instead of an exception that fails the whole
            -- delivery and sends Stripe back round again.
            AND NOT EXISTS (
              SELECT 1 FROM payment_plan_installments prior
               WHERE prior.stripe_invoice_id = $5
            )
          RETURNING id`,
        [plan.id, nextSequence, input.paidAt, input.transactionId, input.stripeInvoiceId]
      );

      if (!marked.rows[0]) {
        // Somebody else already recorded this installment.
        await client.query("ROLLBACK");
      } else {
        const isFinal = nextSequence >= plan.installment_count;
        const nextDue = await client.query<{ due_at: Date | null }>(
          `SELECT due_at FROM payment_plan_installments
            WHERE payment_plan_id = $1 AND sequence = $2`,
          [plan.id, nextSequence + 1]
        );

        await client.query(
          `UPDATE payment_plans
              SET installments_paid = $2,
                  status = $3,
                  completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END,
                  next_charge_at = $4,
                  updated_at = now()
            WHERE id = $1`,
          [
            plan.id,
            nextSequence,
            isFinal ? "completed" : "active",
            isFinal ? null : (nextDue.rows[0]?.due_at ?? null),
          ]
        );

        await client.query("COMMIT");
        log(
          `plan ${plan.id}: installment ${nextSequence} of ${plan.installment_count} paid${
            isFinal ? " — plan complete, no further charges" : ""
          }`
        );
        if (isFinal) completedPlan = plan;
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (overcharged !== null && env.notifyEmail) {
    void sendMail({
      to: env.notifyEmail,
      ...paymentPlanOverchargeAlert({
        buyerEmail: overcharged.email,
        amountCents: input.amountCents,
        currency: input.currency,
        installmentCount: overcharged.installment_count,
        installmentsPaid: overcharged.installments_paid,
        stripeSubscriptionId: input.stripeSubscriptionId,
      }),
    });
  }

  if (completedPlan !== null && completedPlan.email) {
    const order = completedPlan.order_id ? await loadOrderById(completedPlan.order_id) : null;
    const paidToDate = await planPaidToDate(completedPlan.id);
    void sendMail({
      topic: "payment_plan_completed",
      sourceId: completedPlan.order_id ?? null,
      memberId: completedPlan.member_id ?? null,
      to: completedPlan.email,
      ...paymentPlanCompleted({
        buyerName: order?.billing_name ?? "",
        description: order ? describe(order) : "your payment plan",
        installmentCount: completedPlan.installment_count,
        totalPaidCents: paidToDate,
        currency: completedPlan.currency,
      }),
    });

    // Paying off an instalment plan is the end of a months-long relationship
    // with a customer who has now spent the full price, and it was previously
    // invisible to automations: no tag, no sequence, no upsell. Keyed by plan,
    // so the replayed invoice webhooks behind it cannot fire it twice.
    const identity = await automationIdentity(
      completedPlan.member_id ?? order?.member_id ?? null,
      completedPlan.email,
      order?.billing_name ?? "",
    );
    await publishDomainEvent("payment_plan_completed", {
      eventKey: `payment-plan-completed:${completedPlan.id}`,
      contactId: identity.contactId,
      email: identity.email,
      name: identity.name,
      subjectId: order?.offer_id ?? completedPlan.offer_id ?? null,
      source: "stripe",
      facts: {
        paymentPlanId: completedPlan.id,
        orderId: completedPlan.order_id ?? 0,
        offerId: order?.offer_id ?? completedPlan.offer_id ?? 0,
        installmentCount: completedPlan.installment_count,
        totalPaidCents: paidToDate,
        currency: completedPlan.currency,
      },
    });
  }
}

/**
 * What a plan has actually taken from the customer.
 *
 * Summed from the installments rather than multiplied out of
 * `installment_cents`, which is the shape of the contract and not a record of
 * the money: a coupon that discounted the opening charge, or the rounding
 * remainder the schedule puts on the final one, both make the multiplication
 * disagree with the card statement. Telling somebody they have paid $3,750 when
 * they paid $3,000 is the kind of receipt that starts a chargeback.
 */
async function planPaidToDate(planId: number): Promise<number> {
  const res = await pool.query<{ cents: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS cents
       FROM payment_plan_installments
      WHERE payment_plan_id = $1 AND status = 'paid'`,
    [planId]
  );
  return res.rows[0]?.cents ?? 0;
}

/**
 * Ties the access an order granted to the subscription that pays for it.
 *
 * `fulfillPayment` grants against the order, which is right — the order is what
 * was bought — but it leaves `subscription_id` NULL, and that column is the only
 * precise handle on "the access this subscription is paying for". Without it,
 * cancelling would have to revoke by offer, which would also take back a
 * separate outright purchase of the same thing. Revocation reads exactly what
 * this writes.
 *
 * It takes two events to write it — the one that creates the grant and the one
 * that creates the `subscriptions` row — and Stripe guarantees nothing about
 * which arrives first, so both call this and the second one to arrive completes
 * the link. Matching only NULLs is what makes that safe to run twice, and what
 * keeps it off a grant a later outright purchase has since taken over.
 */
async function linkGrantsToSubscription(orderId: number, subscriptionId: number): Promise<void> {
  await pool.query(
    `UPDATE access_grants
        SET subscription_id = $2, updated_at = now()
      WHERE order_id = $1 AND subscription_id IS NULL`,
    [orderId, subscriptionId]
  );
}

/**
 * Records that everything an invoice implies has been done.
 *
 * Written last, on purpose. Until it is set, a redelivery re-claims the invoice
 * and runs the handler again — which is what makes a partial failure
 * recoverable rather than silently final.
 */
async function markInvoiceSettled(stripeInvoiceId: string): Promise<void> {
  await pool.query(
    `UPDATE invoices SET settled_at = now() WHERE stripe_invoice_id = $1 AND settled_at IS NULL`,
    [stripeInvoiceId]
  );
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  const meta = invoiceMetadata(invoice);
  const paymentIntentId = invoicePaymentIntentId(invoice);
  const paidAt =
    toDate(invoice.status_transitions?.paid_at) ?? toDate(invoice.created) ?? new Date();

  const plan = stripeSubscriptionId ? await loadPlan(stripeSubscriptionId) : null;
  const isPlan = plan !== null || meta.pricingType === "payment_plan";
  const order =
    meta.orderId !== undefined
      ? await loadOrderById(meta.orderId)
      : plan?.order_id
        ? await loadOrderById(plan.order_id)
        : null;

  // A payment plan is not a subscription and deliberately has no subscriptions
  // row: it lives in payment_plans, and invoices reach it through
  // payment_plan_id. See the migration's note on the two being distinct.
  const subscriptionId =
    !isPlan && stripeSubscriptionId ? await localSubscriptionId(stripeSubscriptionId) : null;

  const claimed = await upsertInvoice({
    stripeInvoiceId: invoice.id,
    subscriptionId,
    paymentPlanId: plan?.id ?? null,
    memberId: order?.member_id ?? plan?.member_id ?? null,
    orderId: order?.id ?? null,
    number: invoice.number ?? "",
    email: invoice.customer_email ?? order?.email ?? "",
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    taxCents: (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0),
    currency: invoice.currency,
    status: "paid",
    attemptCount: invoice.attempt_count || 1,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? "",
    pdfUrl: invoice.invoice_pdf ?? "",
    periodStart: toDate(invoice.period_start),
    periodEnd: toDate(invoice.period_end),
    paidAt,
  });

  if (!claimed) {
    log(`invoice ${invoice.id} is already settled; nothing to advance`);
    return;
  }

  // A payment clears whatever dunning state the subscription was in.
  if (subscriptionId !== null) {
    await pool.query(
      `UPDATE subscriptions
          SET status = 'active',
              failed_payment_count = 0,
              current_period_start = COALESCE($2, current_period_start),
              current_period_end = COALESCE($3, current_period_end),
              updated_at = now()
        WHERE id = $1`,
      [subscriptionId, toDate(invoice.period_start), toDate(invoice.period_end)]
    );
  }

  // Money that actually moved. Stripe marks a $0 invoice `paid` — a trial's
  // opening invoice is exactly that — so `paid` and `charged` are separate
  // questions, and everything that credits a customer for a payment keys on
  // this one.
  const collectedCents = invoice.amount_paid;

  // Delivery is the other question, and it is answered by the order still being
  // unpaid rather than by billing_reason or by the amount. Two reasons: if the
  // opening invoice were ever missed, the next one must still fulfil the
  // purchase rather than treat it as a renewal; and a trial collects nothing and
  // still has to hand over the product, because for the length of the trial the
  // product IS what the customer signed up for.
  const opensTheOrder = order !== null && order.status !== "paid";

  let fulfilledMemberId: number | null = null;

  if (opensTheOrder && order !== null) {
    const result = await settleOrderPayment(order, {
      paymentIntentId,
      chargeId: null,
      amountCents: collectedCents,
      currency: invoice.currency,
      email: invoice.customer_email ?? order.email,
      stripeCustomerId: idOf(invoice.customer),
      occurredAt: paidAt,
    });

    // Whether THIS delivery was the one that granted the access is beside the
    // point — charge.succeeded may have got there first and reported nothing
    // done. The link is owed by the grants that exist, so it is written whenever
    // the subscription is known and skipped only when it is not.
    if (subscriptionId !== null) {
      await linkGrantsToSubscription(order.id, subscriptionId);
    }

    fulfilledMemberId = result.memberId;
  }

  // Opening the plan is keyed on the plan not existing yet, NOT on this delivery
  // having been the one that settled the order. The two came apart whenever the
  // first delivery threw after `fulfillPayment` committed: the retry found the
  // order already paid, skipped this block for good, and the plan was never
  // created at all — no schedule for the member to see, nothing for a later
  // installment to advance, and no plan for `endPaymentPlanAccess` to find, so a
  // customer who stopped paying after the opening charge kept the whole product.
  // ...but only on the invoice that actually opened the order. `plan === null`
  // is true on every later installment too whenever the plan was never created
  // — `startPaymentPlan` answers null when the offer has been deleted or its
  // `installment_count` cleared — and without this guard installment two walked
  // in here, opened a brand new plan dated from itself with "installment 1
  // paid", and returned before `recordRecurringPayment`. The customer's money
  // was collected and appeared in no transaction row: missing from every revenue
  // report and from the affiliate's commission. An earlier settled invoice
  // against the same order is proof this is not the opening one.
  const opensThePlan =
    isPlan && stripeSubscriptionId && plan === null && order !== null
      ? (
          await pool.query(
            `SELECT 1 FROM invoices
              WHERE order_id = $1 AND stripe_invoice_id <> $2 AND settled_at IS NOT NULL
              LIMIT 1`,
            [order.id, invoice.id]
          )
        ).rowCount === 0
      : false;

  if (opensThePlan && order !== null && stripeSubscriptionId) {
    const planId = await startPaymentPlan({
      order,
      meta,
      memberId: fulfilledMemberId,
      stripeSubscriptionId,
      stripeCustomerId: idOf(invoice.customer),
      collectedCents,
      stripeInvoiceId: invoice.id,
      startAt: paidAt,
    });
    if (planId !== null) {
      await pool.query(`UPDATE invoices SET payment_plan_id = $2 WHERE stripe_invoice_id = $1`, [
        invoice.id,
        planId,
      ]);
      log(
        `plan ${planId} opened for order ${order.id}${
          collectedCents > 0
            ? ": installment 1 of the schedule paid"
            : " with nothing collected: the schedule starts at installment 1, unpaid"
        }`
      );
      await markInvoiceSettled(invoice.id);
      return;
    }

    // No plan, and the invoice is deliberately left unsettled.
    //
    // Settling it here was the quiet version of this failure: the invoice was
    // closed as fully handled, so no redelivery and no manual replay could ever
    // build the schedule, and a customer who had paid the first of three
    // installments had no plan behind them — nothing to advance, nothing for
    // `endPaymentPlanAccess` to cancel if they stopped paying. The money itself
    // is safe either way (the order's own transaction was written by
    // `settleOrderPayment` above); it is the schedule that is missing, and the
    // cause is always something a person has to put back — an offer deleted, or
    // its installment count cleared — after which replaying the invoice from
    // Stripe finishes the job.
    log(
      `order ${order.id}: payment plan could NOT be opened (offer missing or has no installment count) — invoice ${invoice.id} left unsettled so it can be replayed`
    );
    if (env.notifyEmail) {
      void sendMail({
        to: env.notifyEmail,
        subject: "A payment plan could not be set up",
        text: [
          `A payment plan purchase was paid for but the instalment schedule could not be created.`,
          ``,
          `Customer: ${invoice.customer_email ?? order.email}`,
          `Order: ${order.id}`,
          `Stripe invoice: ${invoice.id}`,
          ``,
          `This happens when the offer behind the purchase has been deleted, or its`,
          `number of instalments has been cleared. Put that back, then resend the`,
          `invoice event from the Stripe dashboard and the schedule will be built.`,
        ].join("\n"),
      });
    }
    return;
  }

  if (opensTheOrder) {
    // Written here as it is on every other path out of this handler. Leaving it
    // unset meant a redelivery re-claimed the opening invoice, found the order
    // already paid, fell through to the renewal branch below and credited the
    // plan an installment nobody had paid — see migration 008, which added
    // `settled_at` for exactly this and never had it set on this branch.
    await markInvoiceSettled(invoice.id);
    return;
  }

  // Every charge after the first: recorded as its own transaction, because one
  // order can be three installments or thirty monthly renewals.
  const transactionId = await recordRecurringPayment({
    orderId: order?.id ?? plan?.order_id ?? null,
    subscriptionId,
    memberId: order?.member_id ?? plan?.member_id ?? null,
    email: invoice.customer_email ?? order?.email ?? plan?.email ?? "",
    amountCents: collectedCents,
    currency: invoice.currency,
    paymentIntentId,
    occurredAt: paidAt,
  });

  if (transactionId !== null) {
    await sendRecurringReceipt(invoice, order, plan, collectedCents).catch((error: unknown) => {
      // Money and access are already correct. A mail outage must not replay the
      // payment workflow, and the invoice remains available in the portal.
      console.error(`[stripe] recurring receipt for ${invoice.id} failed:`, error);
    });
  }

  if (isPlan && stripeSubscriptionId) {
    // An installment is a payment, so only money advances the counter. A $0
    // invoice that consumed one would leave a three-payment contract collecting
    // two before Stripe stopped billing.
    if (collectedCents <= 0) {
      log(`invoice ${invoice.id} collected nothing; the plan's counter stays put`);
      return;
    }
    await advancePaymentPlan({
      stripeSubscriptionId,
      stripeInvoiceId: invoice.id,
      transactionId,
      amountCents: collectedCents,
      currency: invoice.currency,
      paidAt,
    });
    await markInvoiceSettled(invoice.id);
    return;
  }

  // A renewal of a membership whose access expires has to push the expiry out,
  // or the member loses what they have just paid for. grantOfferAccess never
  // shortens an existing grant, so this is safe on a lifetime one too.
  const offerId = order?.offer_id ?? meta.offerId ?? null;
  if (order?.member_id && offerId !== null) {
    await grantOfferAccess({
      memberId: order.member_id,
      offerId,
      orderId: order.id,
      subscriptionId,
      source: "purchase",
    });
  }

  await markInvoiceSettled(invoice.id);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  const meta = invoiceMetadata(invoice);
  const plan = stripeSubscriptionId ? await loadPlan(stripeSubscriptionId) : null;
  const isPlan = plan !== null || meta.pricingType === "payment_plan";
  const order =
    meta.orderId !== undefined
      ? await loadOrderById(meta.orderId)
      : plan?.order_id
        ? await loadOrderById(plan.order_id)
        : null;

  const subscriptionId =
    !isPlan && stripeSubscriptionId ? await localSubscriptionId(stripeSubscriptionId) : null;

  // Which decline this is. Stripe is the authority on how many times it has
  // tried, and every count here is raised to that number rather than
  // incremented: `+ 1` is not idempotent, and a handler that throws after the
  // increment returns 500, is retried, and counts one decline twice —
  // inflating the number that decides when somebody loses access.
  let attempt = invoice.attempt_count || 1;

  const claimed = await upsertInvoice({
    stripeInvoiceId: invoice.id,
    subscriptionId,
    paymentPlanId: plan?.id ?? null,
    memberId: order?.member_id ?? plan?.member_id ?? null,
    orderId: order?.id ?? null,
    number: invoice.number ?? "",
    email: invoice.customer_email ?? order?.email ?? "",
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    taxCents: (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0),
    currency: invoice.currency,
    status: "failed",
    attemptCount: attempt,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? "",
    pdfUrl: invoice.invoice_pdf ?? "",
    periodStart: toDate(invoice.period_start),
    periodEnd: toDate(invoice.period_end),
    paidAt: null,
  });

  // This decline has already been dealt with — the invoice has since been paid,
  // or this attempt is one the invoice already records. Stripe does not
  // guarantee delivery order, so a first attempt can arrive after the retry that
  // succeeded, and "your payment didn't go through" is the worst possible email
  // to send somebody whose payment went through; a repeat of an attempt already
  // dunned for is the second-worst.
  if (!claimed) {
    log(`invoice ${invoice.id} failure ignored: attempt ${attempt} is already recorded`);
    return;
  }

  if (subscriptionId !== null) {
    const bumped = await pool.query<{ failed_payment_count: number }>(
      `UPDATE subscriptions
          SET failed_payment_count = GREATEST(failed_payment_count, $2),
              status = 'past_due',
              updated_at = now()
        WHERE id = $1
        RETURNING failed_payment_count`,
      [subscriptionId, attempt]
    );
    attempt = bumped.rows[0]?.failed_payment_count ?? attempt;

    const paymentSettings = await readSetting("customer_payments");
    if (paymentSettings.revokeOnFirstFailedPayment === true) {
      const owner = await pool.query<{ member_id: number | null; offer_id: number | null }>(
        `SELECT member_id, offer_id FROM subscriptions WHERE id = $1`,
        [subscriptionId],
      );
      const linked = owner.rows[0];
      if (linked?.member_id && linked.offer_id) {
        await revokeOfferAccess({
          memberId: linked.member_id,
          offerId: linked.offer_id,
          reason: "recurring payment failed",
        });
      }
    }
  }

  if (plan !== null) {
    // The installment stays unpaid and the counter stays put, so a successful
    // retry lands on the same sequence rather than skipping it.
    await pool.query(
      `UPDATE payment_plan_installments
          SET status = 'failed'
        WHERE payment_plan_id = $1 AND sequence = $2 AND status = 'scheduled'`,
      [plan.id, plan.installments_paid + 1]
    );
    await pool.query(
      `UPDATE payment_plans SET status = 'past_due', updated_at = now()
        WHERE id = $1 AND status = 'active'`,
      [plan.id]
    );
  }

  // No `transactions` row for a failed invoice, deliberately. That table is the
  // money ledger — one row per movement — and a decline moved nothing; the
  // invoice row above already records it, with the URL to fix the card, and it
  // records it idempotently, which an insert with no natural key here could not.
  // A declined one-time PaymentIntent is the different case: there is no invoice
  // to carry the record, which is what recordFailedAttempt exists for.

  const buyerEmail = invoice.customer_email ?? order?.email ?? plan?.email ?? "";
  if (buyerEmail) {
    void sendMail({
      topic: "payment_failed",
      sourceId: order?.id ?? plan?.order_id ?? null,
      memberId: order?.member_id ?? plan?.member_id ?? null,
      to: buyerEmail,
      ...paymentFailedDunning({
        buyerName: order?.billing_name ?? "",
        description: order ? describe(order) : "your subscription",
        amountCents: invoice.amount_due,
        currency: invoice.currency,
        attempt,
        payInvoiceUrl: invoice.hosted_invoice_url ?? "",
        nextAttemptAt: toDate(invoice.next_payment_attempt),
      }),
    });
  }

  const identity = await automationIdentity(
    order?.member_id ?? plan?.member_id ?? null,
    buyerEmail,
    order?.billing_name ?? "",
  );
  await publishDomainEvent("payment_failed", {
    eventKey: `payment-failed:invoice:${invoice.id}:attempt:${attempt}`,
    contactId: identity.contactId,
    email: identity.email,
    name: identity.name,
    subjectId: order?.offer_id ?? plan?.offer_id ?? null,
    source: "stripe",
    facts: {
      invoiceId: invoice.id,
      orderId: order?.id ?? plan?.order_id ?? 0,
      amountCents: invoice.amount_due,
      currency: invoice.currency,
      attempt,
    },
  });

  log(
    `invoice ${invoice.id} failed (attempt ${attempt}); dunning sent to ${buyerEmail || "nobody"}`
  );
}

/* ----------------------------------------------------------- subscriptions */

/**
 * The statuses that mean the subscription is no longer paying for anything.
 *
 * `unpaid` is included deliberately: it is where Stripe parks a subscription
 * once dunning is exhausted, and treating it as still-live is how somebody keeps
 * access for months after their card stopped working.
 */
const ACCESS_ENDING_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** Recorded on the grants a defaulted plan takes back, so the reason survives. */
const PLAN_DEFAULT_REASON = "payment plan defaulted";

/**
 * What becomes of a payment plan's access when its Stripe subscription ends.
 *
 * Every plan's subscription ends — that is what `cancel_at` is for — so "the
 * subscription is over" says nothing on its own about whether the customer paid.
 * Two opposite outcomes arrive as the same event, and reading them the wrong way
 * round either robs a paying customer or gives the product away:
 *
 *  - **COMPLETED — nothing outstanding.** The subscription was cancelled
 *    *because* the customer finished paying. A plan is a purchase in
 *    installments, not a rental: "3 x $1,250" buys the same $3,750 course as one
 *    payment does, and what they bought is theirs. Access is kept.
 *  - **DEFAULTED — installments still owed.** Dunning ran out, or the
 *    subscription was cancelled part-way through. The member is holding a $3,750
 *    product having paid $1,250, and unless this fires nothing in the system
 *    ever notices. Access goes back, the plan is marked cancelled, and both the
 *    customer and the admin are told.
 *
 * Outstanding *money* is the test rather than the installment counter, because
 * the two can disagree: a plan discounted to nothing bills $0 invoices, which
 * never advance the counter and are not owed either.
 *
 * What goes back is what the offer granted. A bump bought on the same order was
 * paid for outright on the first invoice and is granted without an offer, so it
 * stays — the customer owes nothing on it.
 *
 * The plan row is locked for the decision, so a final invoice.paid arriving at
 * the same moment either commits first — and this reads a settled plan — or
 * waits behind it.
 */
async function endPaymentPlanAccess(input: {
  stripeSubscriptionId: string;
  reason: string;
}): Promise<void> {
  const client: PoolClient = await pool.connect();
  let defaulted: { plan: PlanRow; outstandingCents: number; revokedCount: number } | null = null;

  try {
    await client.query("BEGIN");

    const planRes = await client.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM payment_plans
        WHERE stripe_subscription_id = $1
        FOR UPDATE`,
      [input.stripeSubscriptionId]
    );
    const plan = planRes.rows[0];
    if (!plan) {
      // The opening charge never cleared, so no plan was ever opened and no
      // access was ever granted against one.
      await client.query("ROLLBACK");
      return;
    }

    const owed = await client.query<{ cents: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS cents
         FROM payment_plan_installments
        WHERE payment_plan_id = $1 AND status <> 'paid'`,
      [plan.id]
    );
    const outstandingCents = owed.rows[0]?.cents ?? 0;

    if (outstandingCents <= 0) {
      await client.query("ROLLBACK");
      log(
        `plan ${plan.id} ended paid up (${plan.installments_paid} of ` +
          `${plan.installment_count} installments); access kept`
      );
      return;
    }

    const marked = await client.query<{ id: number }>(
      `UPDATE payment_plans
          SET status = 'canceled',
              canceled_at = COALESCE(canceled_at, now()),
              cancel_reason = $2,
              next_charge_at = NULL,
              updated_at = now()
        WHERE id = $1 AND status <> 'canceled'
        RETURNING id`,
      [plan.id, truncate(input.reason, 500)]
    );
    if (!marked.rows[0]) {
      // A second delivery of the same ending; the first one took it back.
      await client.query("ROLLBACK");
      return;
    }

    // Charges that will never be attempted now the subscription is gone. Left
    // 'scheduled', they would keep the member's billing page promising a next
    // payment date on a plan that is over.
    await client.query(
      `UPDATE payment_plan_installments
          SET status = 'skipped'
        WHERE payment_plan_id = $1 AND status IN ('scheduled', 'failed')`,
      [plan.id]
    );

    let revokedCount = 0;
    if (plan.member_id !== null && plan.offer_id !== null) {
      revokedCount = await revokeOfferAccess({
        memberId: plan.member_id,
        offerId: plan.offer_id,
        reason: PLAN_DEFAULT_REASON,
        client,
      });
    }

    await client.query("COMMIT");
    defaulted = { plan, outstandingCents, revokedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (defaulted === null) return;

  const { plan, outstandingCents, revokedCount } = defaulted;
  log(
    `plan ${plan.id} defaulted: ${plan.installments_paid} of ${plan.installment_count} ` +
      `installments paid, ${outstandingCents} outstanding — revoked ${revokedCount} grant(s)`
  );

  const order = plan.order_id ? await loadOrderById(plan.order_id) : null;
  const description = order ? describe(order) : "your purchase";

  // Fire-and-forget, as everywhere else here: the entitlement decision is
  // committed, and an SMTP outage must not turn it into a retried webhook that
  // starts the whole sequence again.
  if (plan.email) {
    void sendMail({
      to: plan.email,
      ...paymentPlanDefaulted({
        buyerName: order?.billing_name ?? "",
        description,
        installmentsPaid: plan.installments_paid,
        installmentCount: plan.installment_count,
        outstandingCents,
        currency: plan.currency,
      }),
    });
  }

  if (env.notifyEmail) {
    void sendMail({
      to: env.notifyEmail,
      ...paymentPlanDefaultedAlert({
        buyerEmail: plan.email,
        description,
        installmentsPaid: plan.installments_paid,
        installmentCount: plan.installment_count,
        outstandingCents,
        currency: plan.currency,
        revokedCount,
        stripeSubscriptionId: input.stripeSubscriptionId,
      }),
    });
  }
}

/**
 * Ends the access a subscription was paying for, honouring the grace period.
 *
 * Only ever reached for a real subscription: `handleSubscriptionChange` sends
 * payment plans to `endPaymentPlanAccess` instead, because "the subscription
 * ended" means the opposite thing for something that was bought rather than
 * rented.
 *
 * It only revokes grants this subscription created, which is the subtle half:
 * `grantAccess` overwrites `order_id` when the same product is later bought
 * outright, so a grant pointing at a different order is access the member paid
 * for separately and must keep.
 */
async function endSubscriptionAccess(input: {
  stripeSubscriptionId: string;
  localSubscriptionId: number | null;
  orderId: number | null;
  periodEnd: Date | null;
  reason: string;
}): Promise<void> {
  if (input.localSubscriptionId === null) return;

  const { cancelGraceDays } = await billingSettings();

  // They paid for the period they are in, so access runs to the end of it, plus
  // whatever grace Yvette has configured on top.
  const base = input.periodEnd ?? new Date();
  const endsAt = cancelGraceDays > 0 ? addInterval(base, "day", cancelGraceDays) : base;

  if (endsAt.getTime() <= Date.now()) {
    const revoked = await pool.query(
      `UPDATE access_grants
          SET status = 'revoked', revoked_at = now(), revoke_reason = $2, updated_at = now()
        WHERE subscription_id = $1
          AND status = 'active'
          AND ($3::int IS NULL OR order_id IS NULL OR order_id = $3)`,
      [input.localSubscriptionId, truncate(input.reason, 500), input.orderId]
    );
    log(
      `subscription ${input.stripeSubscriptionId} ended: revoked ${revoked.rowCount ?? 0} grant(s)`
    );
    return;
  }

  // Still inside the paid period or the grace window: let it lapse on its own
  // rather than revoking now. LEAST never extends access that already ends
  // sooner, and a grant with no expiry gets one for the first time here.
  const clipped = await pool.query(
    `UPDATE access_grants
        SET expires_at = CASE
                           WHEN expires_at IS NULL THEN $2
                           ELSE LEAST(expires_at, $2)
                         END,
            revoke_reason = $3,
            updated_at = now()
      WHERE subscription_id = $1
        AND status = 'active'
        AND ($4::int IS NULL OR order_id IS NULL OR order_id = $4)`,
    [input.localSubscriptionId, endsAt, truncate(input.reason, 500), input.orderId]
  );
  log(
    `subscription ${input.stripeSubscriptionId} ending: ${clipped.rowCount ?? 0} ` +
      `grant(s) expire ${endsAt.toISOString()}`
  );
}

async function handleSubscriptionChange(
  sub: Stripe.Subscription,
  deleted: boolean
): Promise<void> {
  const meta = readMetadata(sub.metadata);

  // A payment plan's Stripe subscription is bookkeeping for a fixed number of
  // charges, not a membership, so it is never mirrored into `subscriptions`.
  // Recognising it from the metadata matters because subscription.created
  // arrives before the payment_plans row exists.
  if (meta.pricingType === "payment_plan" || (await loadPlan(sub.id)) !== null) {
    if (deleted || ACCESS_ENDING_STATUSES.has(sub.status)) {
      await endPaymentPlanAccess({
        stripeSubscriptionId: sub.id,
        reason: deleted
          ? "the plan's subscription was canceled"
          : `the plan's subscription became ${sub.status}`,
      });
    }
    return;
  }

  // Stripe moved current_period_* off the subscription and onto each item.
  // Single-price subscriptions have exactly one.
  const item = sub.items?.data?.[0];
  const periodStart = toDate(item?.current_period_start);
  const periodEnd = toDate(item?.current_period_end);
  const recurring = item?.price?.recurring ?? null;
  const status = deleted ? "canceled" : sub.status;

  const order = meta.orderId !== undefined ? await loadOrderById(meta.orderId) : null;

  const upserted = await pool.query<{ id: number; created: boolean }>(
    `INSERT INTO subscriptions
       (member_id, offer_id, email, stripe_customer_id, stripe_subscription_id, status,
        current_period_start, current_period_end, cancel_at_period_end, trial_ends_at,
        canceled_at, ended_at, amount_cents, currency, interval, interval_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       member_id            = COALESCE(EXCLUDED.member_id, subscriptions.member_id),
       offer_id             = COALESCE(EXCLUDED.offer_id, subscriptions.offer_id),
       email                = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email
                                   ELSE subscriptions.email END,
       stripe_customer_id   = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       -- Stripe does not guarantee delivery order, and a stale 'active' landing
       -- after a cancellation would resurrect a subscription nobody is paying
       -- for. Cancellation is terminal: a resumed customer gets a new
       -- subscription id, never this row back.
       status               = CASE WHEN subscriptions.status = 'canceled'
                                        AND EXCLUDED.status <> 'canceled'
                                   THEN subscriptions.status
                                   ELSE EXCLUDED.status END,
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       current_period_end   = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       trial_ends_at        = COALESCE(EXCLUDED.trial_ends_at, subscriptions.trial_ends_at),
       canceled_at          = COALESCE(EXCLUDED.canceled_at, subscriptions.canceled_at),
       ended_at             = COALESCE(EXCLUDED.ended_at, subscriptions.ended_at),
       amount_cents         = CASE WHEN EXCLUDED.amount_cents > 0 THEN EXCLUDED.amount_cents
                                   ELSE subscriptions.amount_cents END,
       currency             = EXCLUDED.currency,
       interval             = EXCLUDED.interval,
       interval_count       = EXCLUDED.interval_count,
       updated_at           = now()
     RETURNING id, (xmax = 0) AS created`,
    [
      order?.member_id ?? null,
      order?.offer_id ?? meta.offerId ?? null,
      order?.email ?? "",
      idOf(sub.customer),
      sub.id,
      status,
      periodStart,
      periodEnd,
      sub.cancel_at_period_end,
      toDate(sub.trial_end),
      toDate(sub.canceled_at),
      toDate(sub.ended_at),
      item?.price?.unit_amount ?? 0,
      sub.currency,
      recurring?.interval ?? "month",
      recurring?.interval_count ?? 1,
    ]
  );

  const subscriptionId = upserted.rows[0]?.id ?? null;
  log(`subscription ${sub.id} mirrored as ${status}`);

  // This row is half of the link between a subscription and the access it pays
  // for, and it is the half that may arrive second: invoice.paid grants the
  // access and can only link it if this row already exists. Completing the link
  // from whichever side lands last is what makes the outcome independent of a
  // delivery order Stripe does not promise — and it is done before the ending
  // below, because revocation matches on `subscription_id` and a grant left
  // unlinked is a membership that is never taken back.
  if (subscriptionId !== null && order !== null) {
    await linkGrantsToSubscription(order.id, subscriptionId);
  }


  if (
    subscriptionId !== null &&
    upserted.rows[0]?.created &&
    !deleted &&
    !ACCESS_ENDING_STATUSES.has(status)
  ) {
    const identity = await automationIdentity(order?.member_id ?? null, order?.email ?? "");
    await dispatchEvent("subscription.started", {
      id: `subscription:${subscriptionId}`,
      subscriptionId,
      offerId: order?.offer_id ?? meta.offerId ?? null,
      contactId: identity.contactId,
      email: identity.email,
      status,
    });
  }

  // cancel_at_period_end is not an ending: the customer keeps everything until
  // the period actually runs out, and Stripe sends deleted when it does. It is
  // still the moment worth automating on, though — it is the only window in
  // which a win-back email can change the outcome, and it is weeks wide.
  // Published from here rather than from the member cancel route so that a
  // cancellation started in the Stripe dashboard counts too; the event key
  // makes the repeat webhooks Stripe sends for the same subscription collapse
  // into one occurrence.
  if (!deleted && sub.cancel_at_period_end && subscriptionId !== null) {
    const identity = await automationIdentity(order?.member_id ?? null, order?.email ?? "");
    await publishDomainEvent("subscription_cancel_requested", {
      eventKey: `subscription-cancel-requested:${subscriptionId}`,
      contactId: identity.contactId,
      email: identity.email,
      name: identity.name,
      subjectId: null,
      source: "stripe",
      facts: {
        subscriptionId,
        offerId: order?.offer_id ?? meta.offerId ?? 0,
        status,
        endsAt: periodEnd ? periodEnd.toISOString() : null,
      },
    });
  }

  if (deleted || ACCESS_ENDING_STATUSES.has(status)) {
    await endSubscriptionAccess({
      stripeSubscriptionId: sub.id,
      localSubscriptionId: subscriptionId,
      orderId: order?.id ?? meta.orderId ?? null,
      periodEnd,
      reason: deleted ? "subscription canceled" : `subscription ${status}`,
    });
    if (subscriptionId !== null) {
      const identity = await automationIdentity(order?.member_id ?? null, order?.email ?? "");
      await publishDomainEvent("subscription_cancelled", {
        eventKey: `subscription-cancelled:${subscriptionId}`,
        contactId: identity.contactId,
        email: identity.email,
        name: identity.name,
        subjectId: null,
        source: "stripe",
        facts: {
          subscriptionId,
          offerId: order?.offer_id ?? meta.offerId ?? 0,
          status,
        },
      });
    }
  }
}

/* ------------------------------------------------------ refunds & disputes */

interface ChargeTransaction {
  id: number;
  order_id: number | null;
  email: string;
}

async function emailRefundReceipt(
  orderId: number,
  amountCents: number,
  currency: string,
  fullyRefunded: boolean,
): Promise<void> {
  const settings = await readSetting("customer_payments");
  if (settings.sendRefundReceipts === false) return;
  const order = await loadOrderById(orderId);
  if (!order?.email) return;
  const fallback = refundReceipt({
    buyerName: order.billing_name,
    orderId,
    amountCents,
    currency,
    fullyRefunded,
  });
  const content = await withStoredTemplate(
    "refund_receipt",
    {
      firstName: (order.billing_name || "").split(/\s+/)[0] ?? "",
      name: order.billing_name,
      email: order.email,
      offer: describe(order),
      orderId: String(order.id),
      total: fallback.subject,
    },
    fallback,
  );
  await sendMail({ to: order.email, ...content });
}

async function loadTransactionForCharge(
  paymentIntentId: string | null,
  chargeId: string | null
): Promise<ChargeTransaction | null> {
  const res = await pool.query<ChargeTransaction>(
    `SELECT id, order_id, email FROM transactions
      WHERE kind = 'payment'
        AND (stripe_payment_intent_id = $1 OR stripe_charge_id = $2)
      ORDER BY id DESC LIMIT 1`,
    [paymentIntentId, chargeId]
  );
  return res.rows[0] ?? null;
}

/**
 * The identity of a refund Stripe told us about without itemising it.
 *
 * `refunds.stripe_refund_id` is UNIQUE, and that uniqueness is the only thing
 * standing between one refund and its money being added to `refunded_cents`
 * twice — which flips a partially refunded order to 'refunded' and takes back
 * access the customer still owns. A NULL cannot do that job: `ON CONFLICT` never
 * fires on one, so every delivery writes another row. The charge plus its
 * running refunded total is the identity Stripe would have supplied: the same on
 * every delivery of the same state, and different the moment a further refund
 * moves the total, which is then recorded on its own.
 */
function reconciledRefundKey(charge: Stripe.Charge): string {
  return `${charge.id}:refunded:${charge.amount_refunded}`;
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = idOf(charge.payment_intent);
  const transaction = await loadTransactionForCharge(paymentIntentId, charge.id);

  if (!transaction || transaction.order_id === null) {
    log(`charge ${charge.id} refunded but no order-linked transaction found`);
    return;
  }

  // This charge and the order it belongs to are different questions. A charge is
  // one installment of a payment plan or one month of a subscription, so a
  // charge refunded in full says nothing about whether the order has been made
  // whole — `recordRefund` weighs each refund against everything the order
  // collected, and it is that comparison, not this one, that decides access.
  const chargeFullyRefunded = charge.amount_refunded >= charge.amount;
  const { revokeAccessOnFullRefund } = await billingSettings();
  let orderFullyRefunded = false;
  let revokedCount = 0;

  // Stripe re-sends the whole charge with every refund attached, so each Stripe
  // refund id is recorded on its own and `recordRefund`'s unique guard makes a
  // second sighting of an earlier one a no-op. Summing them here instead would
  // double-count the first refund on the second event.
  const refunds = charge.refunds?.data ?? [];
  for (const refund of refunds) {
    const result = await recordRefund({
      orderId: transaction.order_id,
      transactionId: transaction.id,
      amountCents: refund.amount,
      currency: refund.currency,
      reason: refund.reason ?? "",
      revokeAccessOnFullRefund,
      stripeRefundId: refund.id,
      createdByEmail: "stripe",
    });
    orderFullyRefunded = orderFullyRefunded || result.fullyRefunded;
    revokedCount += result.revokedCount;
    if (result.recorded) {
      await emailRefundReceipt(
        transaction.order_id,
        refund.amount,
        refund.currency,
        result.fullyRefunded,
      ).catch((error: unknown) => console.error(`[stripe] refund receipt ${refund.id} failed:`, error));
    }
  }

  if (refunds.length === 0 && charge.amount_refunded > 0) {
    // No refund list on the payload: reconcile against what the order already
    // knows about so only the unrecorded remainder is written.
    const order = await loadOrderById(transaction.order_id);
    const outstanding = charge.amount_refunded - (order?.refunded_cents ?? 0);
    if (outstanding > 0) {
      const result = await recordRefund({
        orderId: transaction.order_id,
        transactionId: transaction.id,
        amountCents: outstanding,
        currency: charge.currency,
        reason: "",
        revokeAccessOnFullRefund,
        stripeRefundId: reconciledRefundKey(charge),
        createdByEmail: "stripe",
      });
      orderFullyRefunded = orderFullyRefunded || result.fullyRefunded;
      revokedCount += result.revokedCount;
      if (result.recorded) {
        await emailRefundReceipt(
          transaction.order_id,
          outstanding,
          charge.currency,
          result.fullyRefunded,
        ).catch((error: unknown) => console.error(`[stripe] refund receipt ${charge.id} failed:`, error));
      }
    }
  }

  if (chargeFullyRefunded) {
    await pool.query(`UPDATE transactions SET status = 'refunded' WHERE id = $1`, [
      transaction.id,
    ]);
  }

  await dispatchEvent("order.refunded", {
    id: `refund:${charge.id}:${charge.amount_refunded}`,
    orderId: transaction.order_id,
    email: transaction.email,
    chargeId: charge.id,
    amountRefundedCents: charge.amount_refunded,
    currency: charge.currency,
    fullyRefunded: orderFullyRefunded,
  });

  log(
    `charge ${charge.id} refunded ${charge.amount_refunded} of ${charge.amount}${
      orderFullyRefunded ? ` — order ${transaction.order_id} fully refunded` : ""
    }${revokedCount > 0 ? `, revoked ${revokedCount} grant(s)` : ""}`
  );
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = idOf(dispute.charge);
  const paymentIntentId = idOf(dispute.payment_intent);

  const flagged = await pool.query<{ id: number; order_id: number | null; email: string }>(
    `UPDATE transactions
        SET status = 'disputed'
      WHERE kind = 'payment'
        AND (stripe_payment_intent_id = $1 OR stripe_charge_id = $2)
      RETURNING id, order_id, email`,
    [paymentIntentId, chargeId]
  );
  const transaction = flagged.rows[0] ?? null;

  // Access is deliberately left alone. A dispute is an accusation, not an
  // outcome; pulling a course the moment one is filed punishes the customer for
  // a bank's paperwork, and the money is already held either way.
  if (env.notifyEmail) {
    void sendMail({
      to: env.notifyEmail,
      ...disputeAlert({
        buyerEmail: transaction?.email ?? "",
        amountCents: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        chargeId: chargeId ?? "(unknown)",
        orderId: transaction?.order_id ?? null,
      }),
    });
  }

  log(`dispute ${dispute.id} opened on charge ${chargeId ?? "(unknown)"}: ${dispute.reason}`);
}

/* -------------------------------------------------------------- dispatcher */

/** Returns false for an event this system has nothing to do about. */
async function dispatch(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleSessionCompleted(event.data.object);
      return true;

    case "checkout.session.async_payment_succeeded":
      await settleSessionPayment(event.data.object);
      return true;

    case "checkout.session.async_payment_failed":
      await handleSessionAsyncFailed(event.data.object);
      return true;

    case "checkout.session.expired":
      await handleSessionExpired(event.data.object);
      return true;

    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event.data.object);
      return true;

    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event.data.object);
      return true;

    case "charge.succeeded":
      await handleChargeSucceeded(event.data.object);
      return true;

    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      return true;

    case "charge.dispute.created":
      await handleDisputeCreated(event.data.object);
      return true;

    case "invoice.paid":
      await handleInvoicePaid(event.data.object);
      return true;

    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      return true;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionChange(event.data.object, false);
      return true;

    case "customer.subscription.deleted":
      await handleSubscriptionChange(event.data.object, true);
      return true;

    default:
      return false;
  }
}

/* ----------------------------------------------------------------- receiver */

stripeWebhookRouter.post(
  "/stripe/webhook",
  asyncHandler(async (req, res) => {
    if (!stripeEnabled() || !env.stripe.webhookSecret) {
      res.status(503).json({ error: "Payments are not configured" });
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      // The HMAC is the validation on this endpoint. There is no zod schema over
      // the body because the body is not a request payload — it is Stripe's own
      // object graph, and anything that has not been signed with the endpoint
      // secret is discarded before a single field is read. The fields this
      // codebase put there itself (metadata) ARE parsed, in readMetadata.
      event = stripe().webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.stripe.webhookSecret
      );
    } catch (err) {
      // Unverified payload: never act on it, and don't echo the reason back.
      console.error("[stripe] webhook signature verification failed:", (err as Error).message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const claim = await claimEvent(event);
    if (!claim.claimed) {
      if (claim.inFlight) {
        // Another delivery is inside the handler for this event. 409 rather than
        // 200 on purpose: a 2xx tells Stripe the event is done with, and if the
        // delivery that holds it then fails there would be no retry left to put
        // it right. Stripe retries this, and the retry finds either a finished
        // event (200 below) or a claim it can take over.
        log(`${event.type} ${event.id} is already being processed by another delivery`);
        res.status(409).json({ error: "Event is already being processed" });
        return;
      }
      // Already carried to completion. Acknowledging stops Stripe retrying it.
      log(`${event.type} ${event.id} is a redelivery of a finished event; ignoring`);
      res.json({ received: true, duplicate: true });
      return;
    }
    if (claim.attempts > 0) {
      log(`${event.type} ${event.id} retry (${claim.attempts} previous attempt(s))`);
    }

    try {
      const handled = await dispatch(event);
      await markProcessed(event.id, handled);
      res.json({ received: true });
    } catch (err) {
      console.error(`[stripe] ${event.type} ${event.id} failed:`, err);
      await markFailed(event.id, err);
      // 500 on purpose: Stripe retries a 5xx with backoff, and the stored event
      // is re-claimable. Any 2xx here would abandon the delivery for good.
      res.status(500).json({ error: "Webhook processing failed" });
    }
  })
);
