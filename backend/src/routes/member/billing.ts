import { Request, Response, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type Stripe from "stripe";
import { pool } from "../../db/pool";
import { env, stripeEnabled } from "../../config/env";
import { stripe } from "../../stripe/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, serviceUnavailable, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { formatAmount } from "../../utils/money";
import { readSetting } from "../../services/settings";
import {
  INVOICE_OWNED_BY_MEMBER,
  PURCHASED_ORDER_STATUSES as PURCHASED,
  loadReceiptDocument,
  renderReceipt,
  renderReceiptPdf,
  safeCurrency,
  type ReceiptDocument,
} from "../../services/receiptDocument";
import { CardUpdateError, adoptSavedCard } from "../../services/billingPortal";
import { signReceiptLink, type ReceiptLinkTarget } from "../../services/receiptLinks";

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

/*
 * `PURCHASED`, `INVOICE_OWNED_BY_MEMBER` and the receipt itself come from
 * services/receiptDocument: the admin's copy of a receipt has to be the same
 * document as the member's, and two readers of the same money is how a customer
 * ends up holding a figure the office cannot reproduce.
 */

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
    // Every purchase on this list has a receipt, and the list carries the links
    // rather than the page pairing orders up with invoices to find them. That
    // pairing is what used to leave "Ask us if you need a receipt for this one"
    // under a heading promising a receipt for every purchase.
    receiptUrl: `/api/member/billing/orders/${row.id}/receipt`,
    receiptPdfUrl: `/api/member/billing/orders/${row.id}/receipt.pdf`,
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
    // Our own PDF, for the payments we raised the document for ourselves. A
    // Stripe renewal has Stripe's, linked above as `pdfUrl`.
    receiptPdfUrl:
      row.order_id === null ? null : `/api/member/billing/invoices/${row.id}/receipt.pdf`,
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

/**
 * The receipt, by invoice or by order.
 *
 * Both keys reach the same document, because the same payment can be arrived at
 * from either side: the invoice list holds an invoice id, and the purchases list
 * holds an order id. Only the subscription webhook used to write an invoice at
 * all, so an order-keyed route is what makes a one-off purchase receiptable —
 * and `loadReceiptDocument` scopes every read to the signed-in member in SQL.
 *
 * Rendered server-side and returned as a document rather than JSON, so it can
 * be printed or saved without the client reassembling a layout. It is
 * Bearer-authenticated like every other route here, so a plain link to it would
 * arrive without the token. The member's permanent receipt address is therefore
 * the app's own page, /account/purchases/:orderId/receipt (and
 * /account/billing/invoices/:id/receipt), which fetches this with the token and
 * shows it in the same tab. The PDF is downloaded through `receipt-link`: a
 * short-lived signed URL the tab is sent to, served as an attachment by
 * routes/public/receiptLink.ts — no popup, no blob.
 */

const RECEIPT_MISSING = "We couldn't find that receipt.";

function sendReceiptHtml(res: Response, document: ReceiptDocument): void {
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
  res.type("html").send(renderReceipt(document.view));
}

async function sendReceiptPdf(res: Response, document: ReceiptDocument): Promise<void> {
  // A payment with no order behind it is a Stripe renewal, and Stripe's own PDF
  // is linked beside it as `pdfUrl`. Ours would print "Order no. —".
  if (document.pdf === null) throw notFound(RECEIPT_MISSING);

  const pdf = await renderReceiptPdf(document);
  res.setHeader("Content-Type", "application/pdf");
  // attachment: this is the "Download PDF" document, and the on-screen receipt
  // is the one read in the browser.
  res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
}

/**
 * Mints the download link for a receipt PDF the member owns.
 *
 * Ownership and "there is a PDF for this" are both decided here, before a link
 * exists, with the same loader the PDF route uses; delivery proves them again.
 * Allowed through an impersonated session: it is a read, and the link it
 * returns serves nothing the session could not already fetch.
 */
async function sendReceiptLink(
  res: Response,
  member: AuthedMember,
  target: ReceiptLinkTarget
): Promise<void> {
  const document = await loadReceiptDocument(target, {
    memberId: member.id,
    billedToEmail: member.email,
  });
  if (!document?.pdf) throw notFound(RECEIPT_MISSING);

  const { url, expiresAt } = signReceiptLink({ target, memberId: member.id });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ url, expiresAt: expiresAt.toISOString(), filename: document.filename });
}

/** POST /api/member/billing/orders/:id/receipt-link */
memberBillingRouter.post(
  "/orders/:id/receipt-link",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    await sendReceiptLink(res, member, { orderId: readId(req, RECEIPT_MISSING) });
  })
);

/** POST /api/member/billing/invoices/:id/receipt-link */
memberBillingRouter.post(
  "/invoices/:id/receipt-link",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    await sendReceiptLink(res, member, { invoiceId: readId(req, RECEIPT_MISSING) });
  })
);

/** GET /api/member/billing/invoices/:id/receipt */
memberBillingRouter.get(
  "/invoices/:id/receipt",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const document = await loadReceiptDocument(
      { invoiceId: readId(req, RECEIPT_MISSING) },
      // The signed-in member's own address, never the order's: this document is
      // only ever shown to them, and it is the one value here that is certain.
      { memberId: member.id, billedToEmail: member.email }
    );
    if (!document) throw notFound(RECEIPT_MISSING);
    sendReceiptHtml(res, document);
  })
);

/** GET /api/member/billing/invoices/:id/receipt.pdf */
memberBillingRouter.get(
  "/invoices/:id/receipt.pdf",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const document = await loadReceiptDocument(
      { invoiceId: readId(req, RECEIPT_MISSING) },
      { memberId: member.id, billedToEmail: member.email }
    );
    if (!document) throw notFound(RECEIPT_MISSING);
    await sendReceiptPdf(res, document);
  })
);

/**
 * GET /api/member/billing/orders/:id/receipt
 *
 * The one the purchases page links. Keyed on the order rather than on the
 * receipt record so the page never has to hold both ids, and so a receipt that
 * has somehow not been issued yet is still rendered from the order itself
 * rather than reported missing.
 */
memberBillingRouter.get(
  "/orders/:id/receipt",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const document = await loadReceiptDocument(
      { orderId: readId(req, RECEIPT_MISSING) },
      { memberId: member.id, billedToEmail: member.email }
    );
    if (!document) throw notFound(RECEIPT_MISSING);
    sendReceiptHtml(res, document);
  })
);

/** GET /api/member/billing/orders/:id/receipt.pdf */
memberBillingRouter.get(
  "/orders/:id/receipt.pdf",
  receiptLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const document = await loadReceiptDocument(
      { orderId: readId(req, RECEIPT_MISSING) },
      { memberId: member.id, billedToEmail: member.email }
    );
    if (!document) throw notFound(RECEIPT_MISSING);
    await sendReceiptPdf(res, document);
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
interface CancelReasonOption { value: string; label: string }

const DEFAULT_CANCEL_REASONS: CancelReasonOption[] = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "not_using_it", label: "I'm not using it" },
  { value: "missing_feature", label: "It's missing something I need" },
  { value: "found_alternative", label: "I found another option" },
  { value: "temporary_pause", label: "I just need a break for now" },
  { value: "other", label: "Something else" },
];

/** Parses the owner-editable list without allowing report keys to become arbitrary data. */
export function parseCancelReasons(value: unknown): CancelReasonOption[] {
  if (typeof value !== "string") return DEFAULT_CANCEL_REASONS;
  const seen = new Set<string>();
  const parsed = value.split(/\r?\n/).flatMap((line) => {
    const [rawKey, ...labelParts] = line.split("|");
    const key = rawKey?.trim() ?? "";
    const label = labelParts.join("|").trim();
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(key) || !label || seen.has(key)) return [];
    seen.add(key);
    return [{ value: key, label: label.slice(0, 160) }];
  });
  return parsed.length > 0 ? parsed.slice(0, 30) : DEFAULT_CANCEL_REASONS;
}

async function cancelReasons(): Promise<CancelReasonOption[]> {
  const settings = await readSetting("customer_payments");
  return parseCancelReasons(settings.cancellationReasons);
}

type StripeCancelFeedback = NonNullable<
  Stripe.SubscriptionUpdateParams["cancellation_details"]
>["feedback"];

const STRIPE_CANCEL_FEEDBACK: Record<string, StripeCancelFeedback> = {
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
    reason: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/),
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
      cancelReasons: await cancelReasons(),
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
    const allowedReasons = await cancelReasons();
    if (!allowedReasons.some((option) => option.value === reason)) {
      throw badRequest("Please choose one of the cancellation reasons shown.");
    }

    const row = await loadOwnedSubscription(member.id, subscriptionId);
    assertStillLive(row);
    assertStripeReachable(row);

    if (row.stripe_subscription_id !== null) {
      await stripe().subscriptions.update(row.stripe_subscription_id, {
        cancel_at_period_end: true,
        cancellation_details: {
          feedback: STRIPE_CANCEL_FEEDBACK[reason] ?? "other",
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

/* ------------------------------------------- Lane D2: portal additions */

/**
 * POST /api/member/billing/subscriptions/:id/keep
 *
 * Takes back a cancellation that has not happened yet. Somebody who changes
 * their mind before the period runs out did not leave, so the reason and the
 * note come off the row as well — otherwise "People who left" counts a member
 * who is still paying.
 */
memberBillingRouter.post(
  "/subscriptions/:id/keep",
  denyImpersonation,
  billingWriteLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const subscriptionId = readId(req, "We couldn't find that subscription.");

    const row = await loadOwnedSubscription(member.id, subscriptionId);
    assertStillLive(row);
    if (!row.cancel_at_period_end) {
      res.json(await readSubscription(member.id, subscriptionId));
      return;
    }
    assertStripeReachable(row);

    if (row.stripe_subscription_id !== null) {
      await stripe().subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: false });
    }

    await pool.query(
      `UPDATE subscriptions
          SET cancel_at_period_end = false, canceled_at = NULL,
              cancel_reason = '', cancel_feedback = '', updated_at = now()
        WHERE id = $1 AND member_id = $2 AND ended_at IS NULL`,
      [subscriptionId, member.id]
    );

    res.json(await readSubscription(member.id, subscriptionId));
  })
);

const confirmCardSchema = z.object({
  setupIntentId: z.string().trim().max(255).regex(/^seti_[A-Za-z0-9_]+$/),
});

/**
 * POST /api/member/billing/payment-method/confirm
 *
 * The second half of the SetupIntent card update: makes the saved card the one
 * every membership and payment plan charges, and tries any overdue invoice on it
 * now. Called by the billing page once Stripe confirms the card, including after
 * a 3-D Secure redirect back to /account/billing.
 */
memberBillingRouter.post(
  "/payment-method/confirm",
  denyImpersonation,
  billingWriteLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");

    const parsed = confirmCardSchema.safeParse(req.body);
    if (!parsed.success) throw notFound("We couldn't find that card update. Please try adding the card again.");

    try {
      res.json(await adoptSavedCard(member.id, parsed.data.setupIntentId));
    } catch (err) {
      if (err instanceof CardUpdateError) {
        throw err.kind === "not_ready" ? badRequest(err.message) : notFound(err.message);
      }
      throw err;
    }
  })
);
