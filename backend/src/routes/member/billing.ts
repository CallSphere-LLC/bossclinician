import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type Stripe from "stripe";
import { pool } from "../../db/pool";
import { env, stripeEnabled } from "../../config/env";
import { stripe } from "../../stripe/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, serviceUnavailable, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { escapeHtml } from "../../email/templates";
import { formatAmount } from "../../utils/money";

/**
 * `/api/member/billing` — the customer's own money: what they have bought, what
 * they are still paying for, and what is about to be charged.
 *
 * `requireMember` is already applied by routes/member/index.ts, so every route
 * here has a member. That is authentication, not entitlement: every statement
 * below carries `member_id = $1` — or an EXISTS chain back to a row that does —
 * inside its WHERE clause rather than reading the row and comparing afterwards.
 * Someone else's id is answered with 404, never 403: order ids are sequential,
 * and a 403 on one would confirm both that it exists and roughly how many sales
 * have been made.
 *
 * Writes reach Stripe before they touch the database. Recording a cancellation
 * we failed to make would tell a customer they are no longer being billed while
 * the charges carry on, which is worse than any error message.
 */
export const memberBillingRouter = Router();

/** Postgres int4 ceiling. An id it cannot hold is a 404, not a failed query. */
const MAX_INT4 = 2_147_483_647;

/**
 * The statuses that mean money actually moved.
 *
 * A `pending` order is a checkout somebody opened and walked away from, and a
 * `failed` one is a decline; neither is a purchase, and listing them turns a
 * receipt history into a log of everything that ever went wrong.
 */
const PURCHASED = `('paid','refunded')`;

/**
 * Ownership for an invoice, which can arrive attached to any of three parents.
 *
 * `invoices.member_id` was added in Phase 2, so a row written by the
 * subscription webhook carries only `subscription_id`. Walking to the parent
 * keeps the check on ids the member provably owns instead of falling back to
 * matching on the email column, which anyone can put anything in.
 */
const INVOICE_OWNED_BY_MEMBER = `(
     i.member_id = $1
  OR EXISTS (SELECT 1 FROM orders o2        WHERE o2.id = i.order_id        AND o2.member_id = $1)
  OR EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.id = i.subscription_id AND s2.member_id = $1)
  OR EXISTS (SELECT 1 FROM payment_plans p2 WHERE p2.id = i.payment_plan_id AND p2.member_id = $1)
)`;

/* ----------------------------------------------------------------- limiters */

const TOO_MANY = { error: "Too many requests. Please try again later." };

/** Keyed on the member, not the IP: a clinic behind one address is many people. */
const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/** Every one of these calls reaches Stripe and changes a billing arrangement. */
const billingWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

/** Rendering is cheap, but a receipt is a page a script could scrape in a loop. */
const receiptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

/* ------------------------------------------------------------------ helpers */

/** requireMember has already run; this keeps the guarantee in the type system too. */
function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * A currency code Intl will accept.
 *
 * `offers.currency` is free text an admin can mistype, and
 * `Intl.NumberFormat` throws a RangeError on anything that is not three
 * letters — which would turn one bad offer row into a 500 on every receipt and
 * overview the customer opens.
 */
function safeCurrency(value: string | null | undefined): string {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toLowerCase() : "usd";
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive().max(MAX_INT4),
});

/** Parses `:id`, or 404s — an unparseable id is indistinguishable from a missing row. */
function readId(req: Request, missing: string): number {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) throw notFound(missing);
  return parsed.data.id;
}

/* ------------------------------------------------------------------ overview */

interface SubscriptionRow {
  id: number;
  plan_name: string;
  status: string;
  amount_cents: number;
  currency: string;
  interval: string;
  interval_count: number;
  current_period_start: Date | null;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  paused_at: Date | null;
  ended_at: Date | null;
  cancel_reason: string;
  cancel_feedback: string;
  created_at: Date;
}

/**
 * A subscription's own row plus whatever names it.
 *
 * Two things can: a Phase 2 offer or a Phase 1 plan. Both are joined and the
 * first non-empty one wins, so a membership sold either way still has a title
 * on the customer's billing page.
 */
const SUBSCRIPTION_SELECT = `
  SELECT s.id,
         COALESCE(NULLIF(o.title, ''), NULLIF(pl.name, ''), 'Membership') AS plan_name,
         s.status, s.amount_cents, s.currency, s.interval, s.interval_count,
         s.current_period_start, s.current_period_end, s.trial_ends_at,
         s.cancel_at_period_end, s.canceled_at, s.paused_at, s.ended_at,
         s.cancel_reason, s.cancel_feedback, s.created_at
    FROM subscriptions s
    LEFT JOIN offers o  ON o.id  = s.offer_id
    LEFT JOIN plans  pl ON pl.id = s.plan_id
   WHERE s.member_id = $1`;

interface SubscriptionJson {
  id: number;
  planName: string;
  status: string;
  amountCents: number;
  currency: string;
  interval: string;
  intervalCount: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  endedAt: string | null;
  cancelReason: string;
  cancelFeedback: string;
  nextChargeAt: string | null;
  nextChargeAmountCents: number | null;
  createdAt: string;
}

/**
 * Statuses in which a subscription is still a live billing arrangement.
 *
 * Passed to Postgres as a parameter rather than written out a second time in
 * SQL, so the list the queries filter on and the list the JSON is built from
 * cannot drift apart.
 */
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid"];

function toSubscriptionJson(row: SubscriptionRow): SubscriptionJson {
  const paused = row.paused_at !== null;
  // Nothing is due on a subscription that has been paused, has been told to
  // stop at the end of the period, or has already ended.
  const willCharge =
    !paused &&
    !row.cancel_at_period_end &&
    row.ended_at === null &&
    LIVE_SUBSCRIPTION_STATUSES.includes(row.status);

  return {
    id: row.id,
    planName: row.plan_name,
    status: row.status,
    amountCents: row.amount_cents,
    currency: safeCurrency(row.currency),
    interval: row.interval,
    intervalCount: row.interval_count,
    currentPeriodStart: iso(row.current_period_start),
    currentPeriodEnd: iso(row.current_period_end),
    trialEndsAt: iso(row.trial_ends_at),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: iso(row.canceled_at),
    paused,
    pausedAt: iso(row.paused_at),
    endedAt: iso(row.ended_at),
    cancelReason: row.cancel_reason,
    cancelFeedback: row.cancel_feedback,
    nextChargeAt: willCharge ? iso(row.current_period_end) : null,
    nextChargeAmountCents: willCharge ? row.amount_cents : null,
    createdAt: iso(row.created_at) ?? "",
  };
}

interface PaymentPlanRow {
  id: number;
  offer_title: string;
  status: string;
  installment_cents: number;
  installment_count: number;
  installments_paid: number;
  currency: string;
  interval: string;
  interval_count: number;
  next_charge_at: Date | null;
  completed_at: Date | null;
  canceled_at: Date | null;
  created_at: Date;
  next_amount_cents: number | null;
  next_due_at: Date | null;
  remaining_cents: number;
  remaining_count: number;
}

/**
 * A plan, its progress, and the one charge that comes next.
 *
 * The next figure comes from `payment_plan_installments` rather than from
 * `installment_cents`, because the schedule puts any rounding remainder on the
 * final installment — quoting the flat figure would be a cent or two out on
 * exactly the charge a customer is most likely to check.
 */
const PAYMENT_PLAN_SELECT = `
  SELECT pp.id,
         COALESCE(NULLIF(o.title, ''), 'Payment plan') AS offer_title,
         pp.status, pp.installment_cents, pp.installment_count, pp.installments_paid,
         pp.currency, pp.interval, pp.interval_count, pp.next_charge_at,
         pp.completed_at, pp.canceled_at, pp.created_at,
         nxt.amount_cents AS next_amount_cents,
         nxt.due_at       AS next_due_at,
         (SELECT COALESCE(SUM(i.amount_cents), 0)::int
            FROM payment_plan_installments i
           WHERE i.payment_plan_id = pp.id AND i.status IN ('scheduled','failed')) AS remaining_cents,
         (SELECT COUNT(*)::int
            FROM payment_plan_installments i
           WHERE i.payment_plan_id = pp.id AND i.status IN ('scheduled','failed')) AS remaining_count
    FROM payment_plans pp
    LEFT JOIN offers o ON o.id = pp.offer_id
    LEFT JOIN LATERAL (
      SELECT i.amount_cents, i.due_at
        FROM payment_plan_installments i
       WHERE i.payment_plan_id = pp.id AND i.status = 'scheduled'
       ORDER BY i.sequence
       LIMIT 1
    ) nxt ON true
   WHERE pp.member_id = $1`;

interface PaymentPlanJson {
  id: number;
  offerTitle: string;
  status: string;
  installmentCents: number;
  installmentCount: number;
  installmentsPaid: number;
  /** "2 of 3 payments made" — the sentence Kajabi shows, built once, here. */
  progressLabel: string;
  currency: string;
  interval: string;
  intervalCount: number;
  remainingCents: number;
  remainingInstallmentCount: number;
  nextChargeAt: string | null;
  nextChargeAmountCents: number | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

/** A plan still owing money. 'completed' and 'canceled' have no next charge. */
const LIVE_PLAN_STATUSES = ["active", "past_due"];

function toPaymentPlanJson(row: PaymentPlanRow): PaymentPlanJson {
  const live = LIVE_PLAN_STATUSES.includes(row.status);
  const dueAt = row.next_due_at ?? row.next_charge_at;

  return {
    id: row.id,
    offerTitle: row.offer_title,
    status: row.status,
    installmentCents: row.installment_cents,
    installmentCount: row.installment_count,
    installmentsPaid: row.installments_paid,
    progressLabel: `${row.installments_paid} of ${row.installment_count} ${
      row.installment_count === 1 ? "payment" : "payments"
    } made`,
    currency: safeCurrency(row.currency),
    interval: row.interval,
    intervalCount: row.interval_count,
    remainingCents: row.remaining_cents,
    remainingInstallmentCount: row.remaining_count,
    nextChargeAt: live ? iso(dueAt) : null,
    nextChargeAmountCents: live ? (row.next_amount_cents ?? row.installment_cents) : null,
    completedAt: iso(row.completed_at),
    canceledAt: iso(row.canceled_at),
    createdAt: iso(row.created_at) ?? "",
  };
}

interface NextCharge {
  at: string;
  amountCents: number;
  amount: string;
  source: "subscription" | "payment_plan";
  description: string;
}

/** The soonest charge across everything the member is signed up for. */
function soonestCharge(
  subscriptions: SubscriptionJson[],
  plans: PaymentPlanJson[]
): NextCharge | null {
  const candidates: NextCharge[] = [];

  for (const sub of subscriptions) {
    if (sub.nextChargeAt === null || sub.nextChargeAmountCents === null) continue;
    candidates.push({
      at: sub.nextChargeAt,
      amountCents: sub.nextChargeAmountCents,
      amount: formatAmount(sub.nextChargeAmountCents, sub.currency),
      source: "subscription",
      description: sub.planName,
    });
  }

  for (const plan of plans) {
    if (plan.nextChargeAt === null || plan.nextChargeAmountCents === null) continue;
    candidates.push({
      at: plan.nextChargeAt,
      amountCents: plan.nextChargeAmountCents,
      amount: formatAmount(plan.nextChargeAmountCents, plan.currency),
      source: "payment_plan",
      description: plan.offerTitle,
    });
  }

  candidates.sort((a, b) => a.at.localeCompare(b.at));
  return candidates[0] ?? null;
}

/**
 * GET /api/member/billing/overview
 *
 * Lifetime spend is summed from `transactions`, not from order totals: a
 * payment plan's order records one installment, so totting up orders would
 * report a third of what a customer on "3 x $1,250" has actually paid. Refunds
 * come off, because "you have spent $1,497 with us" should not include the $497
 * that was given back.
 *
 * Only live arrangements are listed. An `incomplete` subscription is a checkout
 * somebody opened and abandoned, and telling them they have a membership they
 * never paid for is how a support ticket starts. /subscriptions returns
 * everything, including what has ended.
 */
memberBillingRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const [totals, subscriptions, plans] = await Promise.all([
      pool.query<{
        purchase_count: number;
        paid_cents: number;
        refunded_cents: number;
        currency: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM orders o
             WHERE o.member_id = $1 AND o.status IN ${PURCHASED}) AS purchase_count,
           (SELECT COALESCE(SUM(t.amount_cents), 0)::int FROM transactions t
             WHERE t.member_id = $1 AND t.kind = 'payment' AND t.status = 'succeeded') AS paid_cents,
           (SELECT COALESCE(SUM(r.amount_cents), 0)::int
              FROM refunds r JOIN orders o ON o.id = r.order_id
             WHERE o.member_id = $1) AS refunded_cents,
           (SELECT o.currency FROM orders o
             WHERE o.member_id = $1 ORDER BY o.created_at DESC LIMIT 1) AS currency`,
        [member.id]
      ),
      pool.query<SubscriptionRow>(
        `${SUBSCRIPTION_SELECT} AND s.ended_at IS NULL AND s.status = ANY($2::text[])
         ORDER BY s.created_at DESC`,
        [member.id, LIVE_SUBSCRIPTION_STATUSES]
      ),
      pool.query<PaymentPlanRow>(
        `${PAYMENT_PLAN_SELECT} AND pp.status = ANY($2::text[])
         ORDER BY pp.created_at DESC`,
        [member.id, LIVE_PLAN_STATUSES]
      ),
    ]);

    const row = totals.rows[0];
    const currency = safeCurrency(row?.currency);
    // Clamped: a refund recorded against an order whose charge predates the
    // transactions table would otherwise read as negative lifetime spend.
    const lifetimeSpendCents = Math.max(0, (row?.paid_cents ?? 0) - (row?.refunded_cents ?? 0));

    const subscriptionsJson = subscriptions.rows.map(toSubscriptionJson);
    const plansJson = plans.rows.map(toPaymentPlanJson);

    res.json({
      currency,
      purchaseCount: row?.purchase_count ?? 0,
      lifetimeSpendCents,
      lifetimeSpend: formatAmount(lifetimeSpendCents, currency),
      activeSubscriptionCount: subscriptionsJson.length,
      activePaymentPlanCount: plansJson.length,
      subscriptions: subscriptionsJson,
      paymentPlans: plansJson,
      nextCharge: soonestCharge(subscriptionsJson, plansJson),
    });
  })
);

/* -------------------------------------------------------------------- orders */

interface OrderRow {
  id: number;
  title: string;
  offer_slug: string | null;
  status: string;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_cents: number;
  refunded_cents: number;
  coupon_code: string;
  source: string;
  created_at: Date;
}

const ORDER_SELECT = `
  SELECT o.id,
         COALESCE(NULLIF(f.title, ''), NULLIF(o.course_title, ''), 'Purchase') AS title,
         f.slug AS offer_slug,
         o.status, o.currency, o.subtotal_cents, o.discount_cents, o.tax_cents,
         o.total_cents, o.amount_cents, o.refunded_cents, o.coupon_code, o.source,
         o.created_at
    FROM orders o
    LEFT JOIN offers f ON f.id = o.offer_id
   WHERE o.member_id = $1 AND o.status IN ${PURCHASED}`;

interface OrderItemJson {
  title: string;
  kind: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

function toOrderJson(row: OrderRow, items: OrderItemJson[]) {
  return {
    id: row.id,
    title: row.title,
    offerSlug: row.offer_slug,
    status: row.status,
    currency: safeCurrency(row.currency),
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    taxCents: row.tax_cents,
    // An order written by the legacy single-course checkout recorded its money
    // in amount_cents alone, and total_cents defaulted to 0.
    totalCents: row.total_cents || row.amount_cents,
    refundedCents: row.refunded_cents,
    couponCode: row.coupon_code,
    source: row.source,
    createdAt: iso(row.created_at) ?? "",
    items,
  };
}

/** GET /api/member/billing/orders — purchase history, newest first. */
memberBillingRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { limit, offset } = parsed.data;

    const [orders, counted] = await Promise.all([
      pool.query<OrderRow>(
        `${ORDER_SELECT} ORDER BY o.created_at DESC, o.id DESC LIMIT $2 OFFSET $3`,
        [member.id, limit, offset]
      ),
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM orders o
          WHERE o.member_id = $1 AND o.status IN ${PURCHASED}`,
        [member.id]
      ),
    ]);

    // One query for every line on the page rather than one per order. The ids
    // come from rows already constrained to this member, so the ANY() array
    // cannot reach anybody else's items.
    const orderIds = orders.rows.map((o) => o.id);
    const itemsByOrder = new Map<number, OrderItemJson[]>();
    if (orderIds.length > 0) {
      const items = await pool.query<{
        order_id: number;
        title: string;
        kind: string;
        quantity: number;
        unit_cents: number;
        amount_cents: number;
      }>(
        `SELECT order_id, title, kind, quantity, unit_cents, amount_cents
           FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY order_id, id`,
        [orderIds]
      );
      for (const item of items.rows) {
        const list = itemsByOrder.get(item.order_id) ?? [];
        list.push({
          title: item.title,
          kind: item.kind,
          quantity: item.quantity,
          unitCents: item.unit_cents,
          amountCents: item.amount_cents,
        });
        itemsByOrder.set(item.order_id, list);
      }
    }

    res.json({
      orders: orders.rows.map((o) => toOrderJson(o, itemsByOrder.get(o.id) ?? [])),
      total: counted.rows[0]?.total ?? 0,
      limit,
      offset,
    });
  })
);

/**
 * GET /api/member/billing/orders/:id
 *
 * `member_id` is in the WHERE clause, not in an `if` after the read. Somebody
 * else's order is a 404, and so is one that never existed.
 */
memberBillingRouter.get(
  "/orders/:id",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const orderId = readId(req, "We couldn't find that order.");

    const found = await pool.query<OrderRow>(`${ORDER_SELECT} AND o.id = $2`, [
      member.id,
      orderId,
    ]);
    const order = found.rows[0];
    if (!order) throw notFound("We couldn't find that order.");

    // fee_cents and net_cents are deliberately not selected: what Stripe charges
    // us is our business, not the customer's.
    const [items, transactions, refunds] = await Promise.all([
      pool.query<{
        title: string;
        kind: string;
        quantity: number;
        unit_cents: number;
        amount_cents: number;
      }>(
        `SELECT title, kind, quantity, unit_cents, amount_cents
           FROM order_items WHERE order_id = $1 ORDER BY id`,
        [order.id]
      ),
      pool.query<{
        id: number;
        kind: string;
        status: string;
        amount_cents: number;
        currency: string;
        payment_method_brand: string;
        payment_method_last4: string;
        payment_method_type: string;
        failure_reason: string;
        occurred_at: Date;
      }>(
        `SELECT id, kind, status, amount_cents, currency, payment_method_brand,
                payment_method_last4, payment_method_type, failure_reason, occurred_at
           FROM transactions WHERE order_id = $1 ORDER BY occurred_at, id`,
        [order.id]
      ),
      pool.query<{
        id: number;
        amount_cents: number;
        currency: string;
        reason: string;
        revoked_access: boolean;
        created_at: Date;
      }>(
        `SELECT id, amount_cents, currency, reason, revoked_access, created_at
           FROM refunds WHERE order_id = $1 ORDER BY created_at, id`,
        [order.id]
      ),
    ]);

    res.json({
      ...toOrderJson(
        order,
        items.rows.map((i) => ({
          title: i.title,
          kind: i.kind,
          quantity: i.quantity,
          unitCents: i.unit_cents,
          amountCents: i.amount_cents,
        }))
      ),
      transactions: transactions.rows.map((t) => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        amountCents: t.amount_cents,
        currency: safeCurrency(t.currency),
        cardBrand: t.payment_method_brand,
        cardLast4: t.payment_method_last4,
        methodType: t.payment_method_type,
        failureReason: t.failure_reason,
        occurredAt: iso(t.occurred_at) ?? "",
      })),
      refunds: refunds.rows.map((r) => ({
        id: r.id,
        amountCents: r.amount_cents,
        currency: safeCurrency(r.currency),
        reason: r.reason,
        accessRemoved: r.revoked_access,
        createdAt: iso(r.created_at) ?? "",
      })),
    });
  })
);

/* ------------------------------------------------------------------ invoices */

interface InvoiceRow {
  id: number;
  number: string | null;
  status: string;
  currency: string;
  amount_paid_cents: number;
  amount_due_cents: number;
  tax_cents: number;
  hosted_invoice_url: string;
  pdf_url: string;
  period_start: Date | null;
  period_end: Date | null;
  paid_at: Date | null;
  created_at: Date;
  order_id: number | null;
  subscription_id: number | null;
  payment_plan_id: number | null;
}

/** stripe_invoice_id stays out: an internal identifier the customer has no use for. */
const INVOICE_SELECT = `
  SELECT i.id, i.number, i.status, i.currency, i.amount_paid_cents, i.amount_due_cents,
         i.tax_cents, i.hosted_invoice_url, i.pdf_url, i.period_start, i.period_end,
         i.paid_at, i.created_at, i.order_id, i.subscription_id, i.payment_plan_id
    FROM invoices i
   WHERE ${INVOICE_OWNED_BY_MEMBER}`;

function toInvoiceJson(row: InvoiceRow) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    currency: safeCurrency(row.currency),
    amountPaidCents: row.amount_paid_cents,
    amountDueCents: row.amount_due_cents,
    taxCents: row.tax_cents,
    // Empty rather than null in the column; the client wants "is there a link".
    hostedInvoiceUrl: row.hosted_invoice_url || null,
    pdfUrl: row.pdf_url || null,
    periodStart: iso(row.period_start),
    periodEnd: iso(row.period_end),
    paidAt: iso(row.paid_at),
    createdAt: iso(row.created_at) ?? "",
    orderId: row.order_id,
    subscriptionId: row.subscription_id,
    paymentPlanId: row.payment_plan_id,
    receiptUrl: `/api/member/billing/invoices/${row.id}/receipt`,
  };
}

/** GET /api/member/billing/invoices */
memberBillingRouter.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { limit, offset } = parsed.data;

    const [invoices, counted] = await Promise.all([
      pool.query<InvoiceRow>(
        `${INVOICE_SELECT}
         ORDER BY COALESCE(i.paid_at, i.created_at) DESC, i.id DESC
         LIMIT $2 OFFSET $3`,
        [member.id, limit, offset]
      ),
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM invoices i WHERE ${INVOICE_OWNED_BY_MEMBER}`,
        [member.id]
      ),
    ]);

    res.json({
      invoices: invoices.rows.map(toInvoiceJson),
      total: counted.rows[0]?.total ?? 0,
      limit,
      offset,
    });
  })
);

/** GET /api/member/billing/invoices/:id */
memberBillingRouter.get(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const invoiceId = readId(req, "We couldn't find that invoice.");

    const found = await pool.query<InvoiceRow>(`${INVOICE_SELECT} AND i.id = $2`, [
      member.id,
      invoiceId,
    ]);
    const invoice = found.rows[0];
    if (!invoice) throw notFound("We couldn't find that invoice.");

    res.json(toInvoiceJson(invoice));
  })
);

/* ------------------------------------------------------------------- receipt */

interface BusinessDetails {
  name: string;
  addressLines: string[];
  email: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

/**
 * The business address, however Yvette happened to type it.
 *
 * The settings table is free-form JSONB she edits herself, so the address may
 * arrive as one multi-line string, a list of lines, or separate fields. A
 * receipt that renders nothing because the shape was unexpected is worse than
 * one built from whichever of those turned up.
 */
function readBusinessDetails(rows: { key: string; value: unknown }[]): BusinessDetails {
  const byKey = new Map(rows.map((r) => [r.key, asRecord(r.value)]));
  const business = byKey.get("business") ?? {};
  const contact = byKey.get("contact") ?? {};

  const address = business.address;
  let lines: string[] = [];
  if (typeof address === "string") {
    lines = address.split(/\r?\n/);
  } else if (Array.isArray(address)) {
    lines = address.map(asText);
  } else {
    const parts = Object.keys(address ?? {}).length > 0 ? asRecord(address) : business;
    lines = [
      asText(parts.line1),
      asText(parts.line2),
      [asText(parts.city), asText(parts.state), asText(parts.postalCode) || asText(parts.zip)]
        .filter((p) => p !== "")
        .join(", "),
      asText(parts.country),
    ];
  }

  return {
    name: asText(business.name) || asText(contact.name) || "Boss Clinician",
    addressLines: lines.map((l) => asText(l)).filter((l) => l !== "").slice(0, 6),
    email: asText(business.email) || asText(contact.email),
  };
}

interface ReceiptLine {
  title: string;
  quantity: number;
  amountCents: number;
}

interface ReceiptView {
  business: BusinessDetails;
  billedToName: string;
  billedToEmail: string;
  reference: string;
  description: string;
  paid: boolean;
  paidAt: string | null;
  issuedAt: string;
  currency: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string;
  taxCents: number;
  totalCents: number;
}

function formatDate(value: string | null): string {
  if (value === null) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * The receipt as a standalone HTML document.
 *
 * Every interpolated value goes through escapeHtml, including the ones that
 * came from our own tables: an offer title and a billing name are both typed by
 * a person, and this page is served from the site's own origin, so an unescaped
 * one would be script running with the member's session.
 */
function renderReceipt(view: ReceiptView): string {
  const money = (cents: number): string => escapeHtml(formatAmount(cents, view.currency));

  const lines = view.lines
    .map(
      (line) => `      <tr>
        <td>${escapeHtml(line.title)}${
          line.quantity > 1 ? ` <span class="qty">&times;${escapeHtml(String(line.quantity))}</span>` : ""
        }</td>
        <td class="num">${money(line.amountCents)}</td>
      </tr>`
    )
    .join("\n");

  const totals = [
    `      <tr><td>Subtotal</td><td class="num">${money(view.subtotalCents)}</td></tr>`,
    view.discountCents > 0
      ? `      <tr><td>Discount${
          view.couponCode ? ` (${escapeHtml(view.couponCode)})` : ""
        }</td><td class="num">&minus;${money(view.discountCents)}</td></tr>`
      : "",
    view.taxCents > 0
      ? `      <tr><td>Tax</td><td class="num">${money(view.taxCents)}</td></tr>`
      : "",
    `      <tr class="total"><td>Total</td><td class="num">${money(view.totalCents)}</td></tr>`,
  ]
    .filter((row) => row !== "")
    .join("\n");

  const addressBlock = view.business.addressLines
    .map((line) => `      <div>${escapeHtml(line)}</div>`)
    .join("\n");

  const paidLine = view.paid
    ? `Paid ${escapeHtml(formatDate(view.paidAt) || formatDate(view.issuedAt))}`
    : "Not yet paid";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${escapeHtml(view.reference)} &middot; ${escapeHtml(view.business.name)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 40px 24px; background: #f6f5f2; color: #1c1917;
         font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .sheet { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 14px;
           padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  header { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
           border-bottom: 1px solid #e7e5e4; padding-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -.01em; }
  .muted { color: #78716c; font-size: 14px; }
  .biz { text-align: right; font-size: 14px; color: #57534e; }
  .biz strong { display: block; color: #1c1917; font-size: 15px; }
  .meta { display: flex; gap: 40px; flex-wrap: wrap; margin: 24px 0 8px; font-size: 14px; }
  .meta h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
             color: #a8a29e; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 15px; }
  td { padding: 10px 0; border-bottom: 1px solid #f0efed; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .qty { color: #a8a29e; font-size: 13px; }
  .totals td { border: none; padding: 6px 0; color: #57534e; }
  .totals .total td { border-top: 1px solid #e7e5e4; padding-top: 14px;
                      font-weight: 600; font-size: 17px; color: #1c1917; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 13px;
          background: #ecfdf5; color: #065f46; }
  .pill.unpaid { background: #fef3c7; color: #92400e; }
  footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e7e5e4;
           font-size: 13px; color: #78716c; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; padding: 0; } }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <div>
        <h1>Receipt</h1>
        <div class="muted">${escapeHtml(view.reference)}</div>
        <div style="margin-top:10px"><span class="pill${view.paid ? "" : " unpaid"}">${paidLine}</span></div>
      </div>
      <div class="biz">
        <strong>${escapeHtml(view.business.name)}</strong>
${addressBlock}
${view.business.email ? `      <div>${escapeHtml(view.business.email)}</div>` : ""}
      </div>
    </header>

    <div class="meta">
      <div>
        <h2>Billed to</h2>
        ${view.billedToName ? `<div>${escapeHtml(view.billedToName)}</div>` : ""}
        <div>${escapeHtml(view.billedToEmail)}</div>
      </div>
      <div>
        <h2>Date</h2>
        <div>${escapeHtml(formatDate(view.paidAt) || formatDate(view.issuedAt))}</div>
      </div>
      <div>
        <h2>For</h2>
        <div>${escapeHtml(view.description)}</div>
      </div>
    </div>

    <table>
${lines}
    </table>

    <table class="totals">
${totals}
    </table>

    <footer>
      Thank you. Keep this receipt for your records &mdash; ${escapeHtml(view.business.name)}.
    </footer>
  </div>
</body>
</html>`;
}

/**
 * GET /api/member/billing/invoices/:id/receipt
 *
 * Rendered server-side and returned as a document rather than JSON, so it can
 * be printed or saved as a PDF by the browser without the client reassembling
 * a layout. It is a Bearer-authenticated endpoint like every other route here,
 * which means the client has to fetch it and hand the markup to a window
 * itself; a plain link would arrive without the token and be rejected.
 */
memberBillingRouter.get(
  "/invoices/:id/receipt",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const invoiceId = readId(req, "We couldn't find that receipt.");

    const found = await pool.query<{
      id: number;
      number: string | null;
      status: string;
      currency: string;
      amount_paid_cents: number;
      tax_cents: number;
      paid_at: Date | null;
      created_at: Date;
      order_id: number | null;
      description: string;
      order_subtotal_cents: number | null;
      order_discount_cents: number | null;
      order_tax_cents: number | null;
      order_total_cents: number | null;
      order_amount_cents: number | null;
      order_status: string | null;
      order_paid_at: Date | null;
      coupon_code: string | null;
      billing_name: string | null;
    }>(
      `SELECT i.id, i.number, i.status, i.currency, i.amount_paid_cents, i.tax_cents,
              i.paid_at, i.created_at, i.order_id,
              COALESCE(NULLIF(fo.title, ''), NULLIF(fs.title, ''), NULLIF(pl.name, ''),
                       NULLIF(o.course_title, ''), 'Purchase') AS description,
              o.subtotal_cents AS order_subtotal_cents,
              o.discount_cents AS order_discount_cents,
              o.tax_cents      AS order_tax_cents,
              o.total_cents    AS order_total_cents,
              o.amount_cents   AS order_amount_cents,
              o.status         AS order_status,
              o.updated_at     AS order_paid_at,
              o.coupon_code, o.billing_name
         FROM invoices i
         LEFT JOIN orders o        ON o.id  = i.order_id
         LEFT JOIN offers fo       ON fo.id = o.offer_id
         LEFT JOIN subscriptions s ON s.id  = i.subscription_id
         LEFT JOIN offers fs       ON fs.id = s.offer_id
         LEFT JOIN plans pl        ON pl.id = s.plan_id
        WHERE i.id = $2 AND ${INVOICE_OWNED_BY_MEMBER}`,
      [member.id, invoiceId]
    );
    const invoice = found.rows[0];
    if (!invoice) throw notFound("We couldn't find that receipt.");

    const [items, settings] = await Promise.all([
      invoice.order_id === null
        ? Promise.resolve({ rows: [] as { title: string; quantity: number; amount_cents: number }[] })
        : pool.query<{ title: string; quantity: number; amount_cents: number }>(
            `SELECT title, quantity, amount_cents
               FROM order_items WHERE order_id = $1 ORDER BY id`,
            [invoice.order_id]
          ),
      pool.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM settings WHERE key IN ('business','contact')`
      ),
    ]);

    const currency = safeCurrency(invoice.currency);
    const paid = invoice.status === "paid" || invoice.order_status === "paid";

    // An invoice raised against an order has that order's own breakdown, which
    // is the only place the discount and the per-line figures exist. A renewal
    // invoice has no order, so the figures come from the invoice itself.
    const hasOrder = invoice.order_id !== null && invoice.order_total_cents !== null;
    const orderTotal = invoice.order_total_cents || invoice.order_amount_cents || 0;
    const totalCents = hasOrder ? orderTotal : invoice.amount_paid_cents;
    const taxCents = hasOrder ? (invoice.order_tax_cents ?? 0) : invoice.tax_cents;
    const discountCents = hasOrder ? (invoice.order_discount_cents ?? 0) : 0;

    // A receipt has to add up. The stored subtotal is used where there is one,
    // and derived from the total otherwise — a renewal invoice never had one,
    // and an order from the legacy course checkout left it at zero while
    // recording the money in amount_cents.
    const storedSubtotal = hasOrder ? (invoice.order_subtotal_cents ?? 0) : 0;
    const subtotalCents =
      storedSubtotal > 0 ? storedSubtotal : Math.max(0, totalCents - taxCents + discountCents);

    const lines: ReceiptLine[] =
      items.rows.length > 0
        ? items.rows.map((i) => ({
            title: i.title,
            quantity: i.quantity,
            amountCents: i.amount_cents,
          }))
        : [{ title: invoice.description, quantity: 1, amountCents: subtotalCents }];

    const html = renderReceipt({
      business: readBusinessDetails(settings.rows),
      billedToName: invoice.billing_name ?? "",
      // The signed-in member's own address, never the order's: this document is
      // only ever shown to them, and it is the one value here that is certain.
      billedToEmail: member.email,
      reference: invoice.number ?? `#${invoice.id}`,
      description: invoice.description,
      paid,
      paidAt: iso(invoice.paid_at) ?? (paid ? iso(invoice.order_paid_at) : null),
      issuedAt: iso(invoice.created_at) ?? "",
      currency,
      lines,
      subtotalCents,
      discountCents,
      couponCode: invoice.coupon_code ?? "",
      taxCents,
      totalCents,
    });

    // Escaping is what makes the document safe; these headers are the second
    // line. The page needs nothing but its own inline stylesheet, so everything
    // else — script, frames, network — is refused outright, and nosniff stops a
    // browser deciding the response is something other than what it says.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(html);
  })
);

/* -------------------------------------------------------------- subscriptions */

/**
 * Why people leave, as a closed list.
 *
 * Kajabi reports on cancellation reasons, and a report cannot be rebuilt later
 * from free text nobody was asked for. Each of ours maps onto Stripe's own
 * churn vocabulary as well, so the same answer lands in both places rather than
 * in neither.
 */
const cancelReasonSchema = z.enum([
  "too_expensive",
  "not_using_it",
  "missing_feature",
  "found_alternative",
  "temporary_pause",
  "other",
]);

type CancelReason = z.infer<typeof cancelReasonSchema>;

const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  too_expensive: "It's too expensive",
  not_using_it: "I'm not using it",
  missing_feature: "It's missing something I need",
  found_alternative: "I found another option",
  temporary_pause: "I just need a break for now",
  other: "Something else",
};

type StripeCancelFeedback = NonNullable<
  Stripe.SubscriptionUpdateParams["cancellation_details"]
>["feedback"];

const STRIPE_CANCEL_FEEDBACK: Record<CancelReason, StripeCancelFeedback> = {
  too_expensive: "too_expensive",
  not_using_it: "unused",
  missing_feature: "missing_features",
  found_alternative: "switched_service",
  // Stripe has no "pausing" feedback value; the comment carries the detail.
  temporary_pause: "other",
  other: "other",
};

const cancelSchema = z
  .object({
    reason: cancelReasonSchema,
    feedback: z.string().trim().max(2000).optional(),
  })
  // "Something else" with nothing written in it is precisely the row the
  // cancellation report cannot say anything about, so the text is required
  // there and optional everywhere else.
  .refine((body) => body.reason !== "other" || (body.feedback ?? "") !== "", {
    message: "Please tell us a little about why you're cancelling.",
    path: ["feedback"],
  });

interface OwnedSubscriptionRow {
  id: number;
  status: string;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  paused_at: Date | null;
  ended_at: Date | null;
}

/** Loads a subscription the member owns, or 404s. */
async function loadOwnedSubscription(
  memberId: number,
  subscriptionId: number
): Promise<OwnedSubscriptionRow> {
  const found = await pool.query<OwnedSubscriptionRow>(
    `SELECT id, status, stripe_subscription_id, cancel_at_period_end, paused_at, ended_at
       FROM subscriptions WHERE id = $1 AND member_id = $2`,
    [subscriptionId, memberId]
  );
  const row = found.rows[0];
  if (!row) throw notFound("We couldn't find that subscription.");
  return row;
}

/** Re-reads a subscription in the shape the list endpoint returns. */
async function readSubscription(memberId: number, subscriptionId: number): Promise<SubscriptionJson> {
  const found = await pool.query<SubscriptionRow>(`${SUBSCRIPTION_SELECT} AND s.id = $2`, [
    memberId,
    subscriptionId,
  ]);
  const row = found.rows[0];
  if (!row) throw notFound("We couldn't find that subscription.");
  return toSubscriptionJson(row);
}

/**
 * Refuses to touch a subscription we cannot actually reach.
 *
 * A row with a Stripe id is billed by Stripe. Editing only our copy would leave
 * the customer looking at "cancelled" while the charges continue, which is the
 * one outcome worse than telling them to try again later.
 */
function assertStripeReachable(row: OwnedSubscriptionRow): void {
  if (row.stripe_subscription_id !== null && !stripeEnabled()) {
    throw serviceUnavailable("Billing changes are temporarily unavailable. Please try again later.");
  }
}

function assertStillLive(row: OwnedSubscriptionRow): void {
  if (row.ended_at !== null || row.status === "canceled") {
    throw badRequest("That subscription has already ended.");
  }
}

/** GET /api/member/billing/subscriptions */
memberBillingRouter.get(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const found = await pool.query<SubscriptionRow>(
      `${SUBSCRIPTION_SELECT} ORDER BY s.created_at DESC, s.id DESC`,
      [member.id]
    );

    res.json({
      subscriptions: found.rows.map(toSubscriptionJson),
      // The cancellation form's options come from the server so the only list
      // of reasons is the one the endpoint validates against.
      cancelReasons: cancelReasonSchema.options.map((value) => ({
        value,
        label: CANCEL_REASON_LABELS[value],
      })),
    });
  })
);

/**
 * POST /api/member/billing/subscriptions/:id/cancel
 *
 * At the end of the paid period, not immediately: the customer has already paid
 * for the days that remain and taking them away would be keeping their money
 * for nothing. Ending a subscription early is an admin action, because it comes
 * with a refund decision attached.
 */
memberBillingRouter.post(
  "/subscriptions/:id/cancel",
  denyImpersonation,
  billingWriteLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const subscriptionId = readId(req, "We couldn't find that subscription.");

    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please choose a reason for cancelling.", parsed.error.flatten());
    }
    const { reason, feedback = "" } = parsed.data;

    const row = await loadOwnedSubscription(member.id, subscriptionId);
    assertStillLive(row);
    assertStripeReachable(row);

    if (row.stripe_subscription_id !== null) {
      await stripe().subscriptions.update(row.stripe_subscription_id, {
        cancel_at_period_end: true,
        cancellation_details: {
          feedback: STRIPE_CANCEL_FEEDBACK[reason],
          // Stripe caps the comment; ours allows more, and the full text is kept
          // in cancel_feedback either way.
          comment: feedback.slice(0, 500) || undefined,
        },
      });
    }

    // canceled_at records when the customer asked, matching what Stripe puts on
    // its own object for a period-end cancellation, and COALESCE keeps the first
    // request's timestamp if the form is submitted twice.
    await pool.query(
      `UPDATE subscriptions
          SET cancel_at_period_end = true,
              cancel_reason   = $3,
              cancel_feedback = $4,
              canceled_at     = COALESCE(canceled_at, now()),
              updated_at      = now()
        WHERE id = $1 AND member_id = $2`,
      [subscriptionId, member.id, reason, feedback]
    );

    res.json(await readSubscription(member.id, subscriptionId));
  })
);

/**
 * POST /api/member/billing/subscriptions/:id/pause
 *
 * Pauses collection rather than cancelling: no invoice is raised while it is
 * paused, and resuming does not bill for the gap. Access is left alone —
 * entitlement lives in access_grants and follows the subscription lifecycle
 * webhook, so a member who has paid through the end of this period keeps what
 * they paid for.
 */
memberBillingRouter.post(
  "/subscriptions/:id/pause",
  denyImpersonation,
  billingWriteLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const subscriptionId = readId(req, "We couldn't find that subscription.");

    const row = await loadOwnedSubscription(member.id, subscriptionId);
    assertStillLive(row);

    // Already paused: report the current state rather than an error, so a
    // double-submitted form is not something the customer has to understand.
    if (row.paused_at !== null) {
      res.json(await readSubscription(member.id, subscriptionId));
      return;
    }
    if (row.cancel_at_period_end) {
      throw badRequest("That subscription is already set to end, so there's nothing to pause.");
    }
    if (!LIVE_SUBSCRIPTION_STATUSES.includes(row.status)) {
      throw badRequest("That subscription isn't active yet, so it can't be paused.");
    }
    assertStripeReachable(row);

    if (row.stripe_subscription_id !== null) {
      await stripe().subscriptions.update(row.stripe_subscription_id, {
        // 'void' rather than 'keep_as_draft': the skipped invoices are never
        // collected, so resuming does not present a bill for the pause.
        pause_collection: { behavior: "void" },
      });
    }

    await pool.query(
      `UPDATE subscriptions
          SET paused_at = now(), updated_at = now()
        WHERE id = $1 AND member_id = $2 AND paused_at IS NULL`,
      [subscriptionId, member.id]
    );

    res.json(await readSubscription(member.id, subscriptionId));
  })
);

/** POST /api/member/billing/subscriptions/:id/resume */
memberBillingRouter.post(
  "/subscriptions/:id/resume",
  denyImpersonation,
  billingWriteLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const subscriptionId = readId(req, "We couldn't find that subscription.");

    const row = await loadOwnedSubscription(member.id, subscriptionId);
    assertStillLive(row);

    if (row.paused_at === null) {
      res.json(await readSubscription(member.id, subscriptionId));
      return;
    }
    assertStripeReachable(row);

    if (row.stripe_subscription_id !== null) {
      // The empty string is how the Stripe API clears the field; null would be
      // sent as the literal string "null" in a form-encoded body.
      await stripe().subscriptions.update(row.stripe_subscription_id, { pause_collection: "" });
    }

    await pool.query(
      `UPDATE subscriptions
          SET paused_at = NULL, updated_at = now()
        WHERE id = $1 AND member_id = $2`,
      [subscriptionId, member.id]
    );

    res.json(await readSubscription(member.id, subscriptionId));
  })
);

/* ------------------------------------------------------------ payment method */

/**
 * The Stripe customer whose card matters most to this member.
 *
 * A member can accumulate several customer records over years of buying. The
 * one worth updating is whichever is behind a live recurring charge, because
 * that is the card that is about to fail; a customer from a one-off purchase
 * three years ago is the last resort.
 */
async function resolveCustomerId(memberId: number): Promise<string | null> {
  const found = await pool.query<{ customer_id: string }>(
    `SELECT c.customer_id
       FROM (
         SELECT s.stripe_customer_id AS customer_id,
                CASE WHEN s.status IN ('active','trialing','past_due','unpaid') THEN 0 ELSE 2 END AS priority,
                s.updated_at
           FROM subscriptions s
          WHERE s.member_id = $1 AND s.stripe_customer_id IS NOT NULL
         UNION ALL
         SELECT pp.stripe_customer_id,
                CASE WHEN pp.status IN ('active','past_due') THEN 1 ELSE 2 END,
                pp.updated_at
           FROM payment_plans pp
          WHERE pp.member_id = $1 AND pp.stripe_customer_id IS NOT NULL
         UNION ALL
         SELECT o.stripe_customer_id, 3, o.updated_at
           FROM orders o
          WHERE o.member_id = $1 AND o.stripe_customer_id IS NOT NULL
       ) c
      ORDER BY c.priority, c.updated_at DESC
      LIMIT 1`,
    [memberId]
  );
  return found.rows[0]?.customer_id ?? null;
}

/**
 * POST /api/member/billing/payment-method/session
 *
 * Stripe's own billing portal is the answer when it is configured: card entry,
 * 3DS and the receipt history are all handled there, and no card detail ever
 * touches this server. When no portal configuration exists the request falls
 * back to a SetupIntent, which the Payment Element on our own page can collect
 * a card with instead. The response says which of the two the client got.
 */
memberBillingRouter.post(
  "/payment-method/session",
  denyImpersonation,
  billingWriteLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");

    const customerId = await resolveCustomerId(member.id);
    if (customerId === null) {
      throw badRequest("There's no card on file to update yet.");
    }

    const returnUrl = `${env.publicSiteUrl}/account/billing`;

    try {
      const session = await stripe().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        // Straight to the card screen rather than the portal home page: this
        // endpoint exists for one job and the member asked for that job.
        flow_data: { type: "payment_method_update" },
      });
      res.json({ type: "portal", url: session.url, clientSecret: null });
      return;
    } catch (err) {
      // A missing portal configuration is reported as a plain invalid request
      // with no distinguishing code, so the type is all there is to match on.
      // Anything else — auth, connection, rate limit — is ours to fix and goes
      // to the error handler.
      if ((err as Stripe.errors.StripeError).type !== "StripeInvalidRequestError") throw err;
    }

    const intent = await stripe().setupIntents.create({
      customer: customerId,
      usage: "off_session",
      automatic_payment_methods: { enabled: true },
      metadata: { memberId: String(member.id) },
    });

    res.json({ type: "setup_intent", url: null, clientSecret: intent.client_secret });
  })
);

/* ------------------------------------------------------------- payment plans */

/**
 * GET /api/member/billing/payment-plans
 *
 * Every installment is returned, paid ones included: "2 of 3 payments made"
 * only means something next to the two dates it already happened on.
 */
memberBillingRouter.get(
  "/payment-plans",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const plans = await pool.query<PaymentPlanRow>(
      `${PAYMENT_PLAN_SELECT} ORDER BY pp.created_at DESC, pp.id DESC`,
      [member.id]
    );

    const planIds = plans.rows.map((p) => p.id);
    const installmentsByPlan = new Map<
      number,
      { sequence: number; amountCents: number; dueAt: string | null; paidAt: string | null; status: string }[]
    >();

    if (planIds.length > 0) {
      // The ids come from rows already constrained to this member, so the
      // ANY() array cannot reach another member's schedule.
      const installments = await pool.query<{
        payment_plan_id: number;
        sequence: number;
        amount_cents: number;
        due_at: Date | null;
        paid_at: Date | null;
        status: string;
      }>(
        `SELECT payment_plan_id, sequence, amount_cents, due_at, paid_at, status
           FROM payment_plan_installments
          WHERE payment_plan_id = ANY($1::int[])
          ORDER BY payment_plan_id, sequence`,
        [planIds]
      );
      for (const row of installments.rows) {
        const list = installmentsByPlan.get(row.payment_plan_id) ?? [];
        list.push({
          sequence: row.sequence,
          amountCents: row.amount_cents,
          dueAt: iso(row.due_at),
          paidAt: iso(row.paid_at),
          status: row.status,
        });
        installmentsByPlan.set(row.payment_plan_id, list);
      }
    }

    res.json({
      paymentPlans: plans.rows.map((row) => ({
        ...toPaymentPlanJson(row),
        installments: installmentsByPlan.get(row.id) ?? [],
      })),
    });
  })
);
