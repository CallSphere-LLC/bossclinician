import { pool } from "../db/pool";
import { env, stripeTestMode } from "../config/env";
import { sendMail } from "../email/mailer";
import { paymentFailedDunning, paymentPlanCompleted, purchaseReceipt } from "../email/commerceTemplates";
import { withStoredTemplate } from "../email/templateStore";
import { fireTriggerAsync } from "../automations/engine";
import { createPaymentPlan, fulfillPayment, recordRefund } from "./fulfillment";
import { grantOfferAccess } from "./access";
import { releaseRedemption } from "./coupons";
import { deliverPurchase, notifyOwnerOfSale } from "./purchaseDelivery";
import { automationIdentity, publishDomainEvent } from "./domainEvents";
import { dispatchEvent } from "./webhooksOut";
import { readSetting } from "./settings";
import { pauseAccessForFailedPayment, restoreAccessAfterPayment } from "./dunning";
import type { BillingInterval } from "./pricing";
import {
  billingSettings,
  describe,
  emailRefundReceipt,
  endPaymentPlanAccess,
  endSubscriptionAccess,
  linkGrantsToSubscription,
  loadOrderById,
  planInstallmentPricing,
  planPaidToDate,
  reclaimOrderRedemption,
} from "../routes/public/stripeWebhook";
import {
  activatePayPalSubscription,
  capturePayPalOrder,
  completedCapture,
  createPayPalPlan,
  createPayPalProduct,
  getPayPalOrder,
  getPayPalSubscription,
  listPayPalSubscriptionTransactions,
  paypalEnvironment,
  usdToCents,
  type PayPalSubscription,
  type PayPalSubscriptionTransaction,
} from "./paypalClient";
import {
  membershipStatus,
  paidInstallmentCount,
  payPalPlanBody,
  saleCents,
  toDate,
  type PayPalPlanSpec,
} from "./paypalPlans";

export { PayPalPlanError, buildPayPalPlanSpec, type PayPalPlanSpec, type PlanSpecInput } from "./paypalPlans";

/**
 * PayPal billing: the plans a recurring offer is sold on, and reconciling what
 * PayPal says happened into the same orders, ledger, subscriptions, payment
 * plans and access grants the Stripe webhook writes.
 *
 * The rule from the Stripe side holds here too: orders become paid only through
 * `fulfillPayment`, entitlement only through services/access.ts, and refunds
 * only through `recordRefund`. PayPal is a second way money arrives, not a
 * second set of rules about what it buys.
 *
 * Reconciliation reads PayPal's own current state (GET the subscription, list
 * its payments) rather than trusting the event that prompted it. Webhooks
 * arrive late, twice and out of order; a function that always moves the local
 * records to "what PayPal says now" is safe to run on every one of them, and
 * from the browser's return as well.
 */

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[paypal] ${message}`);
}

/** Sandbox purchases update the books but send no real emails. */
function sandbox(): boolean {
  return paypalEnvironment() === "sandbox" || stripeTestMode();
}

async function sendPayPalMail(...args: Parameters<typeof sendMail>): Promise<void> {
  if (sandbox()) {
    log(`sandbox: email "${args[0].subject ?? ""}" not sent`);
    return;
  }
  await sendMail(...args);
}

function requireEnvironment(): "sandbox" | "live" {
  const environment = paypalEnvironment();
  if (!environment) throw new Error("PayPal is not configured");
  return environment;
}

async function ensurePayPalProduct(offerId: number, title: string): Promise<string> {
  const environment = requireEnvironment();
  const found = await pool.query<{ paypal_product_id: string }>(
    `SELECT paypal_product_id FROM paypal_products WHERE environment = $1 AND offer_id = $2`,
    [environment, offerId],
  );
  if (found.rows[0]) return found.rows[0].paypal_product_id;
  const productId = await createPayPalProduct({ offerId, name: title });
  // A concurrent first sale may have stored one already; keep the first.
  const stored = await pool.query<{ paypal_product_id: string }>(
    `INSERT INTO paypal_products (environment, offer_id, paypal_product_id) VALUES ($1,$2,$3)
     ON CONFLICT (environment, offer_id) DO UPDATE SET environment = EXCLUDED.environment
     RETURNING paypal_product_id`,
    [environment, offerId, productId],
  );
  return stored.rows[0].paypal_product_id;
}

/**
 * The PayPal plan id for a spec, minted on first use and reused after.
 *
 * Stored per offer and pricing option in `paypal_plans`, keyed on the
 * environment and the spec's hash. The PayPal-Request-Id is the same hash, so
 * two shoppers arriving together on the first sale share one plan.
 */
export async function ensurePayPalPlan(spec: PayPalPlanSpec, offer: { offerId: number; pricingOptionId: number | null; title: string }): Promise<string> {
  const environment = requireEnvironment();
  const found = await pool.query<{ paypal_plan_id: string }>(
    `SELECT paypal_plan_id FROM paypal_plans WHERE environment = $1 AND definition_hash = $2`,
    [environment, spec.hash],
  );
  if (found.rows[0]) return found.rows[0].paypal_plan_id;

  const productId = await ensurePayPalProduct(offer.offerId, offer.title);
  const planId = await createPayPalPlan(payPalPlanBody(spec, productId), `boss-plan-${environment}-${spec.hash}`);
  const stored = await pool.query<{ paypal_plan_id: string }>(
    `INSERT INTO paypal_plans (environment, definition_hash, paypal_plan_id, paypal_product_id, offer_id, pricing_option_id, definition)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (environment, definition_hash) DO UPDATE SET environment = EXCLUDED.environment
     RETURNING paypal_plan_id`,
    [environment, spec.hash, planId, productId, offer.offerId, offer.pricingOptionId, JSON.stringify(spec)],
  );
  return stored.rows[0].paypal_plan_id;
}

async function loadPlanSpec(planId: string | undefined): Promise<PayPalPlanSpec | null> {
  if (!planId) return null;
  const found = await pool.query<{ definition: PayPalPlanSpec }>(`SELECT definition FROM paypal_plans WHERE paypal_plan_id = $1`, [planId]);
  return found.rows[0]?.definition ?? null;
}

/* ------------------------------------------------------- one-time orders */

interface CheckoutOrderRow {
  id: number;
  status: string;
  email: string;
  billing_name: string;
  total_cents: number;
  currency: string;
  paypal_order_id: string | null;
  paypal_subscription_id: string | null;
  member_id: number | null;
  offer_id: number | null;
}

const CHECKOUT_ORDER_COLUMNS = `id, status, email, billing_name, total_cents, currency, paypal_order_id,
                                paypal_subscription_id, member_id, offer_id`;

async function loadCheckoutOrder(where: string, value: string | number): Promise<CheckoutOrderRow | null> {
  const found = await pool.query<CheckoutOrderRow>(`SELECT ${CHECKOUT_ORDER_COLUMNS} FROM orders WHERE ${where} = $1`, [value]);
  return found.rows[0] ?? null;
}

/** What a paid order owes the buyer, sent once by whichever path fulfilled it. */
async function afterFulfilment(order: CheckoutOrderRow, result: { fulfilled: boolean; memberId: number | null; createdMember: boolean }): Promise<void> {
  // A coupon released when an earlier attempt was abandoned belongs to the
  // order again now it is paid (see stripeWebhook.ts reclaimOrderRedemption).
  await reclaimOrderRedemption(order.id);
  if (!result.fulfilled) return;
  await deliverPurchase({ orderId: order.id, memberId: result.memberId, createdMember: result.createdMember });
  notifyOwnerOfSale({ orderId: order.id });
  const full = await loadOrderById(order.id);
  fireTriggerAsync("order_paid", { email: order.email, courseTitle: full ? describe(full) : `Order #${order.id}`, amountCents: order.total_cents });
}

export type PayPalOrderOutcome = "paid" | "pending" | "not_approved";

/**
 * Captures (if needed) and fulfils a one-time PayPal order. Called from the
 * browser's return and from the CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.*
 * webhooks, so a buyer who closes the tab after approving still gets what they
 * paid for. Capture is idempotent on PayPal's side (PayPal-Request-Id) and
 * fulfilment on ours (the order row lock).
 */
export async function settlePayPalOrder(orderId: number): Promise<PayPalOrderOutcome> {
  const order = await loadCheckoutOrder("id", orderId);
  if (!order?.paypal_order_id) throw new Error(`Order ${orderId} has no PayPal order`);
  if (order.status === "paid") return "paid";
  if (order.currency.toLowerCase() !== "usd") throw new Error(`Order ${orderId} is not in US dollars`);

  let paypal = await getPayPalOrder(order.paypal_order_id);
  if (paypal.status === "APPROVED") {
    try {
      paypal = await capturePayPalOrder(order.paypal_order_id);
    } catch (error) {
      // A timed-out capture can have succeeded. Read PayPal's durable result
      // before deciding; never charge twice.
      paypal = await getPayPalOrder(order.paypal_order_id);
      if (paypal.status !== "COMPLETED") throw error;
    }
  }
  if (paypal.status !== "COMPLETED") return "not_approved";

  const pendingCapture = paypal.purchase_units?.[0]?.payments?.captures?.find((capture) => capture.status === "PENDING");
  if (pendingCapture) {
    // eCheck and held payments clear later; PAYMENT.CAPTURE.COMPLETED settles it.
    await pool.query(`UPDATE orders SET paypal_capture_id = COALESCE(paypal_capture_id, $2), updated_at = now() WHERE id = $1`, [order.id, pendingCapture.id]);
    return "pending";
  }
  const capture = completedCapture(paypal, { orderId: order.id, amountCents: order.total_cents });
  if (!capture) throw new Error(`PayPal order ${paypal.id} does not reconcile to order ${order.id}`);

  const result = await fulfillPayment({
    orderId: order.id,
    amountCents: order.total_cents,
    currency: "usd",
    email: order.email,
    paypalOrderId: paypal.id,
    paypalCaptureId: capture.id,
    paymentMethod: { type: "paypal", brand: "PayPal" },
  });
  await afterFulfilment(order, result);
  if (result.fulfilled) log(`order ${order.id} paid by PayPal capture ${capture.id}`);
  return "paid";
}

/** A dead pending order: failed, and its coupon use handed back. */
export async function failPendingPayPalOrder(orderId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const failed = await client.query(`UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [orderId]);
    if (failed.rows[0]) await releaseRedemption(client, orderId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------- subscriptions */

interface OfferShape {
  pricing_type: string;
  amount_cents: number;
  currency: string;
  interval: BillingInterval | null;
  interval_count: number;
  installment_count: number | null;
  trial_days: number;
}

async function loadOrderOfferShape(orderId: number): Promise<OfferShape | null> {
  const found = await pool.query<OfferShape>(
    `SELECT COALESCE(p.pricing_type, o.pricing_type) AS pricing_type,
            COALESCE(p.amount_cents, o.amount_cents) AS amount_cents,
            COALESCE(p.currency, o.currency) AS currency,
            COALESCE(p.interval, o.interval) AS interval,
            COALESCE(p.interval_count, o.interval_count) AS interval_count,
            COALESCE(p.installment_count, o.installment_count) AS installment_count,
            COALESCE(p.trial_days, o.trial_days) AS trial_days
       FROM orders r
       JOIN offers o ON o.id = r.offer_id
       LEFT JOIN offer_pricing_options p ON p.id = r.pricing_option_id AND p.offer_id = o.id
      WHERE r.id = $1`,
    [orderId],
  );
  return found.rows[0] ?? null;
}

/** Records one PayPal subscription payment: ledger row and receipt document. Returns the new transaction id, or null if already recorded. */
async function recordSale(input: {
  orderId: number;
  subscriptionId: number | null;
  paymentPlanId: number | null;
  memberId: number | null;
  email: string;
  sale: PayPalSubscriptionTransaction;
}): Promise<number | null> {
  const cents = saleCents(input.sale);
  const occurredAt = toDate(input.sale.time) ?? new Date();
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO transactions
       (order_id, subscription_id, member_id, email, kind, status, amount_cents, currency,
        payment_method_brand, payment_method_type, paypal_sale_id, occurred_at)
     VALUES ($1,$2,$3,$4,'payment','succeeded',$5,'usd','PayPal','paypal',$6,$7)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [input.orderId, input.subscriptionId, input.memberId, input.email, cents, input.sale.id, occurredAt],
  );
  await upsertSaleInvoice({ ...input, cents, occurredAt });
  return inserted.rows[0]?.id ?? null;
}

/**
 * A paid receipt row for a PayPal payment, in the table Stripe invoices live
 * in, so the member's invoice list, the admin's receipts page and the
 * paid-invoices report all include it. Never written as 'failed': the dunning
 * sweep retries failed rows through Stripe.
 */
async function upsertSaleInvoice(input: {
  orderId: number;
  subscriptionId: number | null;
  paymentPlanId: number | null;
  memberId: number | null;
  email: string;
  sale: PayPalSubscriptionTransaction;
  cents: number;
  occurredAt: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO invoices
       (stripe_invoice_id, origin, subscription_id, payment_plan_id, member_id, order_id, number,
        email, amount_due_cents, amount_paid_cents, tax_cents, currency, status, paid_at, settled_at)
     VALUES ($1,'paypal',$2,$3,$4,$5,$6,$7,$8,$8,0,'usd','paid',$9,now())
     ON CONFLICT (stripe_invoice_id) DO NOTHING`,
    [`paypal:sale:${input.sale.id}`, input.subscriptionId, input.paymentPlanId, input.memberId, input.orderId,
      `PP-${input.sale.id}`.slice(0, 60), input.email, input.cents, input.occurredAt],
  );
}

async function sendRenewalReceipt(order: CheckoutOrderRow, cents: number): Promise<void> {
  const settings = await readSetting("customer_payments");
  const rule = String(settings.receiptRule ?? "every");
  if (settings.sendReceipts === false || rule === "first" || (rule === "nonzero" && cents <= 0) || !order.email) return;
  const full = await loadOrderById(order.id);
  const title = full ? describe(full) : "Your payment";
  const fallback = purchaseReceipt({
    buyerName: order.billing_name,
    orderId: order.id,
    lines: [{ title, quantity: 1, amountCents: cents }],
    subtotalCents: cents,
    discountCents: 0,
    couponCode: "",
    taxCents: 0,
    totalCents: cents,
    currency: "usd",
  });
  const content = await withStoredTemplate("purchase_receipt", {
    firstName: order.billing_name.split(/\s+/)[0] ?? "",
    name: order.billing_name,
    email: order.email,
    offer: title,
    orderId: String(order.id),
    total: fallback.subject,
  }, { ...fallback, text: `${fallback.text}\n\nView your invoices: ${env.publicSiteUrl}/account/billing` });
  await sendPayPalMail({ to: order.email, ...content });
}

const OPENING_WINDOW_MS = 30 * 60_000;

export interface ReconcileResult {
  orderId: number | null;
  status: "paid" | "pending" | "cancelled" | "unknown";
  paypalStatus: string;
}

/**
 * Brings the local records for one PayPal subscription in line with PayPal.
 *
 *  1. The opening: an ACTIVE subscription whose first payment has completed
 *     (or which owes nothing at activation — a free trial) fulfils its order,
 *     exactly once. Approval alone grants nothing.
 *  2. The local mirror: a `subscriptions` row for a membership, a
 *     `payment_plans` schedule for an installment plan, linked to the grants.
 *  3. Every completed payment becomes one ledger row (unique on the sale id);
 *     a renewal of a membership extends access the way Stripe renewals do.
 *  4. Installments paid are set from PayPal's own cycle count, so a replay can
 *     never advance the plan by one more.
 *  5. Status: suspended → past due (access paused if the owner asked for that),
 *     cancelled/expired → access ends as it does for Stripe.
 */
export async function reconcilePayPalSubscription(
  paypalSubscriptionId: string,
  /**
   * A payment the triggering webhook described. PayPal's transaction list can
   * lag the PAYMENT.SALE.COMPLETED event that announces a payment, so the
   * event's own copy is merged in rather than waiting for the next renewal.
   */
  knownSale?: PayPalSubscriptionTransaction,
): Promise<ReconcileResult> {
  let sub = await getPayPalSubscription(paypalSubscriptionId);
  let order = await loadCheckoutOrder("paypal_subscription_id", paypalSubscriptionId);
  if (!order) {
    log(`subscription ${paypalSubscriptionId} has no order here; ignoring`);
    return { orderId: null, status: "unknown", paypalStatus: sub.status };
  }
  if (sub.custom_id && sub.custom_id !== String(order.id)) {
    throw new Error(`PayPal subscription ${paypalSubscriptionId} names order ${sub.custom_id}, not ${order.id}`);
  }

  // SUBSCRIBE_NOW normally activates on approval; an APPROVED subscription is
  // one whose activation still has to be asked for.
  if (sub.status === "APPROVED") {
    await activatePayPalSubscription(paypalSubscriptionId, "Approved at checkout").catch((error: unknown) => {
      log(`activating ${paypalSubscriptionId} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    sub = await getPayPalSubscription(paypalSubscriptionId);
  }

  const shape = await loadOrderOfferShape(order.id);
  const isPlan = shape?.pricing_type === "payment_plan";
  const spec = await loadPlanSpec(sub.plan_id);
  const started = ["ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(sub.status);

  const since = new Date((toDate(sub.start_time) ?? new Date()).getTime() - 2 * 86_400_000);
  const listed = started ? await listPayPalSubscriptionTransactions(paypalSubscriptionId, since) : [];
  if (knownSale && !listed.some((sale) => sale.id === knownSale.id)) listed.push(knownSale);
  const sales = listed
    .filter((sale) => sale.status === "COMPLETED")
    .sort((a, b) => (toDate(a.time)?.getTime() ?? 0) - (toDate(b.time)?.getTime() ?? 0));

  // 1. The opening.
  if (order.status === "pending") {
    const owesAtActivation = spec ? spec.dueAtActivationCents > 0 : true;
    const opens = started && (sales.length > 0 || (sub.status === "ACTIVE" && !owesAtActivation));
    if (!opens) {
      if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
        await failPendingPayPalOrder(order.id);
        return { orderId: order.id, status: "cancelled", paypalStatus: sub.status };
      }
      return { orderId: order.id, status: "pending", paypalStatus: sub.status };
    }
    const first = sales[0] ?? null;
    const result = await fulfillPayment({
      orderId: order.id,
      amountCents: first ? saleCents(first) : 0,
      currency: "usd",
      email: order.email,
      paypalSaleId: first?.id ?? null,
      paymentMethod: { type: "paypal", brand: "PayPal" },
      occurredAt: first ? (toDate(first.time) ?? new Date()) : new Date(),
    });
    await afterFulfilment(order, result);
    if (result.fulfilled) log(`order ${order.id} paid by PayPal subscription ${paypalSubscriptionId}`);
    order = (await loadCheckoutOrder("id", order.id)) ?? order;
  }
  if (order.status !== "paid" && order.status !== "refunded") {
    return { orderId: order.id, status: order.status === "failed" ? "cancelled" : "pending", paypalStatus: sub.status };
  }

  const periodEnd = toDate(sub.billing_info?.next_billing_time);
  const periodStart = toDate(sub.billing_info?.last_payment?.time) ?? toDate(sub.start_time);
  // PayPal can collect a setup fee (bumps) and the first cycle as two separate
  // payments at activation. Everything inside this window is the opening
  // purchase, not a renewal: no renewal receipt, no access extension.
  const openingEndsAt = (toDate(sales[0]?.time)?.getTime() ?? 0) + OPENING_WINDOW_MS;

  // 2–4. Mirror, ledger and installments.
  let localSubscriptionId: number | null = null;
  let paymentPlanId: number | null = null;
  if (isPlan) {
    paymentPlanId = await ensurePaymentPlan(order, shape!, spec, paypalSubscriptionId, sub, sales);
  } else {
    localSubscriptionId = await upsertMembership(order, shape, sub, spec, periodStart, periodEnd);
    await linkGrantsToSubscription(order.id, localSubscriptionId);
  }

  for (const sale of sales) {
    const transactionId = await recordSale({
      orderId: order.id,
      subscriptionId: localSubscriptionId,
      paymentPlanId,
      memberId: order.member_id,
      email: order.email,
      sale,
    });
    if (transactionId === null || (toDate(sale.time)?.getTime() ?? 0) <= openingEndsAt) continue;
    // A payment after the opening one: a renewal or a later installment.
    await sendRenewalReceipt(order, saleCents(sale)).catch((error: unknown) => console.error(`[paypal] receipt for sale ${sale.id} failed:`, error));
    if (!isPlan && order.member_id && order.offer_id) {
      await grantOfferAccess({ memberId: order.member_id, offerId: order.offer_id, orderId: order.id, subscriptionId: localSubscriptionId, source: "purchase" });
    }
  }
  if (paymentPlanId !== null) {
    await syncInstallments(paymentPlanId, paidInstallmentCount(sub, spec, sales, openingEndsAt), periodEnd);
  }

  // 5. Status.
  if (localSubscriptionId !== null) {
    if (sub.status === "ACTIVE") {
      await restoreAccessAfterPayment(localSubscriptionId);
    } else if (sub.status === "SUSPENDED") {
      const paused = await pool.query<{ paused_at: Date | null }>(`SELECT paused_at FROM subscriptions WHERE id = $1`, [localSubscriptionId]);
      // A pause the member asked for is not a payment problem.
      if (!paused.rows[0]?.paused_at) await pauseAccessForFailedPayment(localSubscriptionId);
    } else if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
      await endMembership(order, localSubscriptionId, paypalSubscriptionId, sub.status);
    }
  }
  if (paymentPlanId !== null) {
    if (sub.status === "SUSPENDED") {
      await pool.query(`UPDATE payment_plans SET status = 'past_due', updated_at = now() WHERE id = $1 AND status = 'active'`, [paymentPlanId]);
    } else if (sub.status === "ACTIVE") {
      await pool.query(`UPDATE payment_plans SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'past_due'`, [paymentPlanId]);
    } else if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
      // Paid up → access kept; installments still owed → defaulted. The same
      // decision, and the same emails, as a Stripe plan whose subscription ends.
      await endPaymentPlanAccess({
        paypalSubscriptionId,
        reason: sub.status === "EXPIRED" ? "the plan's PayPal subscription expired" : "the plan's PayPal subscription was cancelled",
      });
    }
  }

  return { orderId: order.id, status: "paid", paypalStatus: sub.status };
}

async function upsertMembership(
  order: CheckoutOrderRow,
  shape: OfferShape | null,
  sub: PayPalSubscription,
  spec: PayPalPlanSpec | null,
  periodStart: Date | null,
  periodEnd: Date | null,
): Promise<number> {
  const existing = await pool.query<{ paused_at: Date | null }>(`SELECT paused_at FROM subscriptions WHERE paypal_subscription_id = $1`, [sub.id]);
  const status = membershipStatus(sub, spec, Boolean(existing.rows[0]?.paused_at));
  const ended = sub.status === "CANCELLED" || sub.status === "EXPIRED";
  const statusTime = toDate(sub.status_update_time) ?? new Date();
  const trialEndsAt = spec && spec.trialDays > 0 ? new Date((toDate(sub.start_time) ?? new Date()).getTime() + spec.trialDays * 86_400_000) : null;
  const res = await pool.query<{ id: number; created: boolean }>(
    `INSERT INTO subscriptions
       (member_id, offer_id, email, paypal_subscription_id, paypal_plan_id, status,
        current_period_start, current_period_end, cancel_at_period_end, trial_ends_at,
        canceled_at, ended_at, amount_cents, currency, interval, interval_count, failed_payment_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12,'usd',$13,$14,$15)
     ON CONFLICT (paypal_subscription_id) DO UPDATE SET
       member_id = COALESCE(EXCLUDED.member_id, subscriptions.member_id),
       offer_id = COALESCE(EXCLUDED.offer_id, subscriptions.offer_id),
       email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE subscriptions.email END,
       -- Cancellation is terminal, as on the Stripe side: a stale ACTIVE read
       -- cannot resurrect a subscription nobody is paying for.
       status = CASE WHEN subscriptions.status = 'canceled' AND EXCLUDED.status <> 'canceled'
                     THEN subscriptions.status ELSE EXCLUDED.status END,
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       -- PayPal drops next_billing_time once a subscription is cancelled; the
       -- period the member already paid for is the one we recorded.
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, subscriptions.trial_ends_at),
       canceled_at = COALESCE(subscriptions.canceled_at, EXCLUDED.canceled_at),
       ended_at = COALESCE(subscriptions.ended_at, EXCLUDED.ended_at),
       amount_cents = CASE WHEN EXCLUDED.amount_cents > 0 THEN EXCLUDED.amount_cents ELSE subscriptions.amount_cents END,
       failed_payment_count = EXCLUDED.failed_payment_count,
       updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [
      order.member_id,
      order.offer_id,
      order.email,
      sub.id,
      sub.plan_id ?? null,
      status,
      periodStart,
      ended ? null : periodEnd,
      trialEndsAt,
      ended ? statusTime : null,
      ended ? statusTime : null,
      spec?.recurringCents ?? shape?.amount_cents ?? 0,
      shape?.interval ?? "month",
      shape?.interval_count ?? 1,
      sub.billing_info?.failed_payments_count ?? 0,
    ],
  );
  const row = res.rows[0];
  if (row.created && !ended) {
    const identity = await automationIdentity(order.member_id, order.email);
    await dispatchEvent("subscription.started", {
      id: `subscription:${row.id}`,
      subscriptionId: row.id,
      offerId: order.offer_id,
      contactId: identity.contactId,
      email: identity.email,
      status,
    });
  }
  return row.id;
}

async function endMembership(order: CheckoutOrderRow, subscriptionId: number, paypalSubscriptionId: string, paypalStatus: string): Promise<void> {
  const row = await pool.query<{ current_period_end: Date | null }>(`SELECT current_period_end FROM subscriptions WHERE id = $1`, [subscriptionId]);
  await endSubscriptionAccess({
    stripeSubscriptionId: paypalSubscriptionId,
    localSubscriptionId: subscriptionId,
    orderId: order.id,
    periodEnd: row.rows[0]?.current_period_end ?? null,
    reason: paypalStatus === "EXPIRED" ? "subscription expired" : "subscription canceled",
  });
  const identity = await automationIdentity(order.member_id, order.email);
  await publishDomainEvent("subscription_cancelled", {
    eventKey: `subscription-cancelled:${subscriptionId}`,
    contactId: identity.contactId,
    email: identity.email,
    name: identity.name,
    subjectId: null,
    source: "paypal",
    facts: { subscriptionId, offerId: order.offer_id ?? 0, status: "canceled" },
  });
}

async function ensurePaymentPlan(
  order: CheckoutOrderRow,
  shape: OfferShape,
  spec: PayPalPlanSpec | null,
  paypalSubscriptionId: string,
  sub: PayPalSubscription,
  sales: PayPalSubscriptionTransaction[],
): Promise<number | null> {
  const existing = await pool.query<{ id: number }>(`SELECT id FROM payment_plans WHERE paypal_subscription_id = $1`, [paypalSubscriptionId]);
  if (existing.rows[0]) return existing.rows[0].id;
  if (!shape.installment_count || !shape.interval) {
    log(`order ${order.id}: payment plan has no installment count or interval; schedule not built`);
    return null;
  }
  const full = await loadOrderById(order.id);
  const pricing = full ? await planInstallmentPricing(full, shape.amount_cents) : { firstCents: shape.amount_cents, recurringCents: shape.amount_cents };
  const firstTx = await pool.query<{ id: number }>(
    `SELECT id FROM transactions WHERE order_id = $1 AND kind = 'payment' AND status = 'succeeded' ORDER BY id LIMIT 1`,
    [order.id],
  );
  await createPaymentPlan({
    orderId: order.id,
    offerId: order.offer_id!,
    memberId: order.member_id,
    email: order.email,
    installmentCents: spec?.recurringCents ?? pricing.recurringCents,
    firstInstallmentCents: spec?.firstCycleCents ?? pricing.firstCents,
    installmentCount: shape.installment_count,
    // The count is set from PayPal's cycles straight after; nothing is
    // credited here on an assumption.
    firstInstallmentPaid: false,
    interval: shape.interval,
    intervalCount: shape.interval_count,
    currency: "usd",
    startAt: toDate(sales[0]?.time) ?? toDate(sub.start_time) ?? new Date(),
    paypalSubscriptionId,
    firstTransactionId: firstTx.rows[0]?.id ?? null,
  });
  const created = await pool.query<{ id: number }>(`SELECT id FROM payment_plans WHERE paypal_subscription_id = $1`, [paypalSubscriptionId]);
  const planId = created.rows[0]?.id ?? null;
  if (planId !== null) {
    await pool.query(`UPDATE invoices SET payment_plan_id = $2 WHERE order_id = $1 AND origin = 'paypal' AND payment_plan_id IS NULL`, [order.id, planId]);
  }
  return planId;
}

/**
 * Sets a plan's paid installments to PayPal's count. Never lowers it, never
 * passes the contract; completing the plan sends the same email and event a
 * Stripe plan's final installment does, once (keyed by plan).
 */
async function syncInstallments(planId: number, paidCount: number, nextChargeAt: Date | null): Promise<void> {
  const client = await pool.connect();
  let completed: { id: number; order_id: number | null; offer_id: number | null; member_id: number | null; email: string; installment_count: number; currency: string } | null = null;
  try {
    await client.query("BEGIN");
    const planRes = await client.query<{ id: number; order_id: number | null; offer_id: number | null; member_id: number | null; email: string; installment_count: number; installments_paid: number; currency: string; status: string }>(
      `SELECT id, order_id, offer_id, member_id, email, installment_count, installments_paid, currency, status
         FROM payment_plans WHERE id = $1 FOR UPDATE`,
      [planId],
    );
    const plan = planRes.rows[0];
    const target = plan ? Math.min(paidCount, plan.installment_count) : 0;
    if (!plan || target <= plan.installments_paid) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(
      `UPDATE payment_plan_installments SET status = 'paid', paid_at = COALESCE(paid_at, now())
        WHERE payment_plan_id = $1 AND sequence <= $2 AND status <> 'paid'`,
      [plan.id, target],
    );
    const isFinal = target >= plan.installment_count;
    await client.query(
      `UPDATE payment_plans
          SET installments_paid = $2,
              status = CASE WHEN $3 THEN 'completed' WHEN status = 'past_due' THEN 'active' ELSE status END,
              completed_at = CASE WHEN $3 THEN now() ELSE completed_at END,
              next_charge_at = CASE WHEN $3 THEN NULL ELSE $4 END,
              updated_at = now()
        WHERE id = $1`,
      [plan.id, target, isFinal, nextChargeAt],
    );
    await client.query("COMMIT");
    log(`plan ${plan.id}: ${target} of ${plan.installment_count} installments paid${isFinal ? " — complete" : ""}`);
    if (isFinal && plan.status !== "completed") completed = plan;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (completed === null) return;
  const order = completed.order_id ? await loadOrderById(completed.order_id) : null;
  const paidToDate = await planPaidToDate(completed.id);
  if (completed.email) {
    void sendPayPalMail({
      topic: "payment_plan_completed",
      sourceId: completed.order_id ?? null,
      memberId: completed.member_id ?? null,
      to: completed.email,
      ...paymentPlanCompleted({
        buyerName: order?.billing_name ?? "",
        description: order ? describe(order) : "your payment plan",
        installmentCount: completed.installment_count,
        totalPaidCents: paidToDate,
        currency: completed.currency,
      }),
    }).catch((error: unknown) => console.error("[paypal] plan completed email failed:", error));
  }
  const identity = await automationIdentity(completed.member_id ?? order?.member_id ?? null, completed.email, order?.billing_name ?? "");
  await publishDomainEvent("payment_plan_completed", {
    eventKey: `payment-plan-completed:${completed.id}`,
    contactId: identity.contactId,
    email: identity.email,
    name: identity.name,
    subjectId: order?.offer_id ?? completed.offer_id ?? null,
    source: "paypal",
    facts: {
      paymentPlanId: completed.id,
      orderId: completed.order_id ?? 0,
      offerId: order?.offer_id ?? completed.offer_id ?? 0,
      installmentCount: completed.installment_count,
      totalPaidCents: paidToDate,
      currency: completed.currency,
    },
  });
}

/**
 * A failed renewal or installment: the counters move, access is paused if the
 * owner asked for that, and the buyer hears about it once per webhook event.
 */
export async function handlePayPalPaymentFailed(paypalSubscriptionId: string, eventId: string): Promise<void> {
  await reconcilePayPalSubscription(paypalSubscriptionId);
  const order = await loadCheckoutOrder("paypal_subscription_id", paypalSubscriptionId);
  if (!order) return;
  const sub = await getPayPalSubscription(paypalSubscriptionId);
  const attempt = Math.max(1, sub.billing_info?.failed_payments_count ?? 1);

  const local = await pool.query<{ id: number }>(
    `UPDATE subscriptions SET failed_payment_count = GREATEST(failed_payment_count, $2),
            status = CASE WHEN status = 'canceled' THEN status ELSE 'past_due' END, updated_at = now()
      WHERE paypal_subscription_id = $1 RETURNING id`,
    [paypalSubscriptionId, attempt],
  );
  if (local.rows[0]) await pauseAccessForFailedPayment(local.rows[0].id);
  const plan = await pool.query<{ id: number; installments_paid: number }>(
    `UPDATE payment_plans SET status = 'past_due', updated_at = now()
      WHERE paypal_subscription_id = $1 AND status = 'active' RETURNING id, installments_paid`,
    [paypalSubscriptionId],
  );
  if (plan.rows[0]) {
    await pool.query(
      `UPDATE payment_plan_installments SET status = 'failed' WHERE payment_plan_id = $1 AND sequence = $2 AND status = 'scheduled'`,
      [plan.rows[0].id, plan.rows[0].installments_paid + 1],
    );
  }

  const amountCents = usdToCents(sub.billing_info?.outstanding_balance?.value) ?? 0;
  const full = await loadOrderById(order.id);
  if (order.email) {
    void sendPayPalMail({
      topic: "payment_failed",
      sourceId: order.id,
      memberId: order.member_id,
      to: order.email,
      ...paymentFailedDunning({
        buyerName: order.billing_name,
        description: full ? describe(full) : "your subscription",
        amountCents,
        currency: "usd",
        attempt,
        payInvoiceUrl: "https://www.paypal.com/myaccount/autopay/",
        nextAttemptAt: toDate(sub.billing_info?.next_billing_time),
      }),
    }).catch((error: unknown) => console.error("[paypal] dunning email failed:", error));
  }
  const identity = await automationIdentity(order.member_id, order.email, order.billing_name);
  await publishDomainEvent("payment_failed", {
    eventKey: `payment-failed:paypal:${eventId}`,
    contactId: identity.contactId,
    email: identity.email,
    name: identity.name,
    subjectId: order.offer_id,
    source: "paypal",
    facts: { orderId: order.id, amountCents, currency: "usd", attempt, paypalSubscriptionId },
  });
}

/* ---------------------------------------------------------------- refunds */

/**
 * A refund made in PayPal (one-time capture or subscription sale). The order is
 * weighed against everything it collected, and access goes back only when it
 * has been made whole — `recordRefund` decides, exactly as for Stripe.
 */
export async function recordPayPalRefund(input: {
  refundId: string;
  captureId?: string | null;
  saleId?: string | null;
  amountCents: number;
  reason?: string;
}): Promise<boolean> {
  const tx = await pool.query<{ id: number; order_id: number | null; email: string; amount_cents: number }>(
    `SELECT id, order_id, email, amount_cents FROM transactions
      WHERE kind = 'payment' AND ((paypal_capture_id IS NOT NULL AND paypal_capture_id = $1) OR (paypal_sale_id IS NOT NULL AND paypal_sale_id = $2))
      ORDER BY id DESC LIMIT 1`,
    [input.captureId ?? null, input.saleId ?? null],
  );
  const transaction = tx.rows[0];
  if (!transaction?.order_id) {
    log(`refund ${input.refundId} has no matching PayPal payment here`);
    return false;
  }
  const { revokeAccessOnFullRefund } = await billingSettings();
  const result = await recordRefund({
    orderId: transaction.order_id,
    transactionId: transaction.id,
    amountCents: input.amountCents,
    currency: "usd",
    reason: input.reason ?? "",
    revokeAccessOnFullRefund,
    paypalRefundId: input.refundId,
    createdByEmail: "paypal",
  });
  if (!result.recorded) return false;
  const refunded = await pool.query<{ cents: number }>(`SELECT COALESCE(SUM(amount_cents),0)::int AS cents FROM refunds WHERE transaction_id = $1`, [transaction.id]);
  if ((refunded.rows[0]?.cents ?? 0) >= transaction.amount_cents) {
    await pool.query(`UPDATE transactions SET status = 'refunded' WHERE id = $1`, [transaction.id]);
  }
  if (!sandbox()) {
    await emailRefundReceipt(transaction.order_id, input.amountCents, "usd", result.fullyRefunded)
      .catch((error: unknown) => console.error(`[paypal] refund receipt ${input.refundId} failed:`, error));
  }
  await dispatchEvent("order.refunded", {
    id: `refund:paypal:${input.refundId}`,
    orderId: transaction.order_id,
    email: transaction.email,
    chargeId: input.captureId ?? input.saleId ?? "",
    amountRefundedCents: input.amountCents,
    currency: "usd",
    fullyRefunded: result.fullyRefunded,
  });
  log(`refund ${input.refundId}: ${input.amountCents} on order ${transaction.order_id}${result.fullyRefunded ? " (fully refunded)" : ""}`);
  return true;
}
