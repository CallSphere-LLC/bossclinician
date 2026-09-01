import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, serviceUnavailable } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { stripe } from "../../stripe/client";
import { stripeEnabled } from "../../config/env";
import { requirePermission } from "../../services/permissions";
import {
  idParamSchema,
  planCreateSchema,
  planRepriceIssue,
  planUpdateSchema,
  type CommerceIssue,
  type PlanInterval,
} from "../../validation/commerceSchemas";

/**
 * Sales admin API — mounted at /admin/sales.
 *
 * Plans and coupons are mirrored into Stripe on create so the recurring-billing
 * objects actually exist there; the local row keeps the id Stripe hands back.
 * Payments/subscriptions/invoices are read models fed by the webhook.
 *
 * The router is mounted on `orders.view`, which Customer support holds so it can
 * look an order up. Every write here goes further than that — creating a plan or
 * a coupon creates the matching object in the live Stripe account — so each one
 * asks for `orders.manage` as well.
 */
export const adminSalesRouter = Router();

/** Changing what is sold, or what it costs, is not a support action. */
const requireManage = requirePermission("orders.manage");

/**
 * Answers a cross-field problem in the shape zod's own `flatten()` produces, so
 * the admin form can print the sentence under the box it names instead of
 * dropping it into a toast that does not say which field is wrong.
 */
function issueError(issue: CommerceIssue) {
  return badRequest(issue.message, { formErrors: [], fieldErrors: { [issue.field]: [issue.message] } });
}

/** Postgres' unique_violation — here, two plans claiming one web address. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

const PLAN_FIELDS = [
  "slug",
  "name",
  "description",
  "price_cents",
  "currency",
  "interval",
  "stripe_price_id",
  "features",
  "community_id",
  "trial_days",
  "published",
  "sort",
] as const;

/* ------------------------------------------------------------------- Plans */

adminSalesRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*)::int FROM subscriptions s
          WHERE s.plan_id = p.id AND s.status IN ('active', 'trialing')) AS active_subscribers
       FROM plans p ORDER BY p.sort, p.id`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminSalesRouter.post(
  "/plans",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = planCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const data = parsed.data;

    const slug = data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Asked before Stripe is touched, not after. The Price has to exist before
    // the insert because the row stores its id, so a name that collides on the
    // way in would leave a live Price in the account with nothing pointing at
    // it. The catch below is still the backstop for a genuine race.
    const taken = await pool.query("SELECT 1 FROM plans WHERE slug = $1", [slug]);
    if (taken.rowCount) {
      throw issueError({
        field: "name",
        message: "You already have a plan with that name. Give this one a different name.",
      });
    }

    let stripePriceId = data.stripePriceId ?? "";

    // Create the recurring Price in Stripe so the plan is immediately sellable.
    // Without this a plan row exists but subscription checkout has nothing to
    // charge against.
    if (!stripePriceId && data.priceCents > 0 && stripeEnabled()) {
      const price = await stripe().prices.create({
        currency: data.currency,
        unit_amount: data.priceCents,
        recurring: { interval: data.interval },
        product_data: { name: data.name },
      });
      stripePriceId = price.id;
    }

    try {
      const result = await pool.query(
        `INSERT INTO plans
           (slug, name, description, price_cents, currency, interval, stripe_price_id,
            features, community_id, trial_days, published, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
           (SELECT COALESCE(MAX(sort), -1) + 1 FROM plans))
         RETURNING *`,
        [
          slug,
          data.name,
          data.description,
          data.priceCents,
          data.currency,
          data.interval,
          stripePriceId || null,
          JSON.stringify(data.features),
          data.communityId,
          data.trialDays,
          data.published,
        ],
      );
      res.status(201).json(rowToCamel(result.rows[0]));
    } catch (err) {
      // The slug is derived from the name when none is typed, so a second plan
      // called "Membership" collides on a column the admin never sees. Without
      // this the console answers 500 and she retypes the same name.
      if (isUniqueViolation(err)) {
        throw issueError({
          field: "name",
          message: "You already have a plan with that name. Give this one a different name.",
        });
      }
      throw err;
    }
  }),
);

adminSalesRouter.put(
  "/plans/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = idParamSchema.safeParse(req.params.id);
    if (!id.success) throw badRequest("Invalid plan id");

    const parsed = planUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const patch = parsed.data;

    const before = await pool.query<{
      price_cents: number;
      currency: string;
      interval: PlanInterval;
      stripe_price_id: string | null;
    }>(
      "SELECT price_cents, currency, interval, stripe_price_id FROM plans WHERE id = $1",
      [id.data],
    );
    const current = before.rows[0];
    if (!current) throw notFound("Plan not found");

    // Checked against the row the edit produces rather than the fields it
    // carries: an edit that only touches the price still has to be judged
    // against the Stripe Price already attached to the plan.
    const issue = planRepriceIssue(
      {
        priceCents: current.price_cents,
        currency: current.currency,
        interval: current.interval,
        stripePriceId: current.stripe_price_id,
      },
      patch,
    );
    if (issue) throw issueError(issue);

    const body: Record<string, unknown> = { ...patch };
    if (patch.features !== undefined) body.features = JSON.stringify(patch.features);

    const update = buildUpdate(body, PLAN_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    try {
      const result = await pool.query(
        `UPDATE plans SET ${update.clause}, updated_at = now()
         WHERE id = $${update.values.length + 1} RETURNING *`,
        [...update.values, id.data],
      );
      if (result.rowCount === 0) throw notFound("Plan not found");
      res.json(rowToCamel(result.rows[0]));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({
          field: "slug",
          message: "Another plan already uses that web address.",
        });
      }
      throw err;
    }
  }),
);

adminSalesRouter.delete(
  "/plans/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM plans WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) throw notFound("Plan not found");
    res.status(204).end();
  }),
);

/* ---------------------------------------------------------- Payments/orders */

adminSalesRouter.get(
  "/payments",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, course_slug, course_title, email, amount_cents, currency, status,
              stripe_session_id, stripe_payment_intent_id, created_at
       FROM orders ORDER BY created_at DESC LIMIT 500`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminSalesRouter.get(
  "/subscriptions",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT s.*, p.name AS plan_name
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       ORDER BY s.created_at DESC LIMIT 500`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminSalesRouter.get(
  "/invoices",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "SELECT * FROM invoices ORDER BY created_at DESC LIMIT 500",
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/**
 * Revenue read model for the dashboard's income panel. MRR counts only
 * active/trialing subscriptions, normalising yearly plans to a monthly figure.
 */
adminSalesRouter.get(
  "/revenue",
  asyncHandler(async (_req, res) => {
    const [orders, mrr, series] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS gross_cents,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'
             AND created_at >= CURRENT_DATE - INTERVAL '30 days'), 0)::int    AS last30_cents,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'
             AND created_at >= CURRENT_DATE - INTERVAL '60 days'
             AND created_at <  CURRENT_DATE - INTERVAL '30 days'), 0)::int    AS prev30_cents,
           COUNT(*) FILTER (WHERE status = 'paid')::int                       AS orders_paid
         FROM orders`,
      ),
      pool.query(
        `SELECT COALESCE(SUM(
           CASE WHEN p.interval = 'year' THEN s.amount_cents / 12 ELSE s.amount_cents END
         ), 0)::int AS mrr_cents
         FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE s.status IN ('active', 'trialing')`,
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ),
         o AS (
           SELECT created_at::date AS day, COALESCE(SUM(amount_cents), 0)::int AS cents
           FROM orders WHERE status = 'paid' AND created_at >= CURRENT_DATE - INTERVAL '29 days'
           GROUP BY 1
         ),
         i AS (
           SELECT created_at::date AS day, COALESCE(SUM(amount_paid_cents), 0)::int AS cents
           FROM invoices WHERE status = 'paid' AND created_at >= CURRENT_DATE - INTERVAL '29 days'
           GROUP BY 1
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                COALESCE(o.cents, 0) AS one_time_cents,
                COALESCE(i.cents, 0) AS subscription_cents
         FROM days d
         LEFT JOIN o ON o.day = d.day
         LEFT JOIN i ON i.day = d.day
         ORDER BY d.day`,
      ),
    ]);

    res.json({
      grossCents: Number(orders.rows[0].gross_cents),
      last30Cents: Number(orders.rows[0].last30_cents),
      prev30Cents: Number(orders.rows[0].prev30_cents),
      ordersPaid: Number(orders.rows[0].orders_paid),
      mrrCents: Number(mrr.rows[0].mrr_cents),
      series: rowsToCamel(series.rows),
    });
  }),
);

/* ----------------------------------------------------------------- Coupons */

adminSalesRouter.get(
  "/coupons",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT * FROM coupons ORDER BY created_at DESC");
    res.json(rowsToCamel(result.rows));
  }),
);

adminSalesRouter.post(
  "/coupons",
  requireManage,
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
    if (!code) throw badRequest("Coupon code is required");

    const percentOff = b.percentOff != null ? Number(b.percentOff) : null;
    const amountOffCents = b.amountOffCents != null ? Number(b.amountOffCents) : null;
    if (percentOff == null && amountOffCents == null) {
      throw badRequest("Set either percentOff or amountOffCents");
    }
    if (percentOff != null && amountOffCents != null) {
      throw badRequest("Set only one of percentOff or amountOffCents");
    }

    const currency = typeof b.currency === "string" && b.currency ? b.currency : "usd";
    let stripeCouponId: string | null = null;

    if (stripeEnabled()) {
      const coupon = await stripe().coupons.create({
        name: code,
        ...(percentOff != null
          ? { percent_off: percentOff }
          : { amount_off: amountOffCents as number, currency }),
        ...(b.maxRedemptions ? { max_redemptions: Number(b.maxRedemptions) } : {}),
      });
      stripeCouponId = coupon.id;
    }

    const result = await pool.query(
      `INSERT INTO coupons
         (code, percent_off, amount_off_cents, currency, stripe_coupon_id, max_redemptions, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        code,
        percentOff,
        amountOffCents,
        currency,
        stripeCouponId,
        b.maxRedemptions ?? null,
        b.expiresAt || null,
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminSalesRouter.put(
  "/coupons/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const { active } = req.body as { active?: boolean };
    if (typeof active !== "boolean") throw badRequest("active (boolean) is required");

    const result = await pool.query(
      "UPDATE coupons SET active = $1 WHERE id = $2 RETURNING *",
      [active, req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Coupon not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminSalesRouter.delete(
  "/coupons/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "DELETE FROM coupons WHERE id = $1 RETURNING stripe_coupon_id",
      [req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Coupon not found");

    const stripeCouponId = result.rows[0].stripe_coupon_id as string | null;
    if (stripeCouponId && stripeEnabled()) {
      // Best effort: the local row is already gone, and a stale Stripe coupon
      // is harmless compared to failing the request.
      await stripe().coupons.del(stripeCouponId).catch(() => undefined);
    }
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------ Stripe status */

adminSalesRouter.get(
  "/stripe-status",
  asyncHandler(async (_req, res) => {
    if (!stripeEnabled()) {
      res.json({ configured: false });
      return;
    }
    // Confirms the key is not just present but actually valid.
    // `null` id = the account the API key belongs to.
    const account = await stripe()
      .accounts.retrieve(null)
      .catch(() => null);
    res.json({
      configured: true,
      accountId: account?.id ?? null,
      chargesEnabled: account?.charges_enabled ?? false,
      payoutsEnabled: account?.payouts_enabled ?? false,
    });
  }),
);

/** Balance powers the dashboard's "Balance" tile (as in the Kajabi layout). */
adminSalesRouter.get(
  "/balance",
  asyncHandler(async (_req, res) => {
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");
    const balance = await stripe().balance.retrieve();
    res.json({
      available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
    });
  }),
);
