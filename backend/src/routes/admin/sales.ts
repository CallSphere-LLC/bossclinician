import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, serviceUnavailable } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { stripe } from "../../stripe/client";
import { stripeEnabled } from "../../config/env";
import { requirePermission } from "../../services/permissions";
import {
  loadReceiptDocument,
  renderReceipt,
  renderReceiptPdf,
  sampleReceiptDocument,
} from "../../services/receiptDocument";
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

async function assertPlanProducts(productIds: number[]): Promise<number[]> {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length > 0) {
    const found = await pool.query<{ id: number }>(
      `SELECT id FROM products WHERE id = ANY($1::int[])`,
      [uniqueIds],
    );
    if (found.rowCount !== uniqueIds.length) {
      throw issueError({
        field: "productIds",
        message: "One of the things this plan should unlock no longer exists. Refresh and choose again.",
      });
    }
  }
  return uniqueIds;
}

async function replacePlanProducts(planId: number, productIds: number[]): Promise<void> {
  const uniqueIds = await assertPlanProducts(productIds);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM plan_products WHERE plan_id = $1`, [planId]);
    for (const [sort, productId] of uniqueIds.entries()) {
      await client.query(
        `INSERT INTO plan_products (plan_id, product_id, sort) VALUES ($1, $2, $3)`,
        [planId, productId, sort],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------- Plans */

adminSalesRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*)::int FROM subscriptions s
          WHERE s.plan_id = p.id AND s.status IN ('active', 'trialing')) AS active_subscribers,
        COALESCE((SELECT array_agg(pp.product_id ORDER BY pp.sort, pp.product_id)
                    FROM plan_products pp WHERE pp.plan_id = p.id), '{}') AS product_ids
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
    await assertPlanProducts(data.productIds);

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
      const plan = rowToCamel<{ id: number }>(result.rows[0]);
      await replacePlanProducts(plan.id, data.productIds);
      res.status(201).json({ ...plan, productIds: [...new Set(data.productIds)] });
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

    const { productIds, ...scalarPatch } = patch;
    const body: Record<string, unknown> = { ...scalarPatch };
    if (patch.features !== undefined) body.features = JSON.stringify(patch.features);

    const update = buildUpdate(body, PLAN_FIELDS);
    if (!update && productIds === undefined) throw badRequest("No updatable fields supplied");

    try {
      const result = update
        ? await pool.query(
            `UPDATE plans SET ${update.clause}, updated_at = now()
             WHERE id = $${update.values.length + 1} RETURNING *`,
            [...update.values, id.data],
          )
        : await pool.query(`SELECT * FROM plans WHERE id = $1`, [id.data]);
      if (result.rowCount === 0) throw notFound("Plan not found");
      if (productIds !== undefined) await replacePlanProducts(id.data, productIds);
      const plan = rowToCamel(result.rows[0]) as Record<string, unknown>;
      res.json({ ...plan, ...(productIds === undefined ? {} : { productIds: [...new Set(productIds)] }) });
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

/**
 * GET /api/admin/sales/payments
 *
 * "What they bought" is the whole point of this screen, and it used to answer
 * "A one-off purchase" for every row: the query selected only `course_title`,
 * which the legacy course checkout writes and the offer checkout never does.
 * Every offer purchase therefore looked identical, distinguishable only by the
 * buyer's email.
 *
 * The title now falls back through the three places a purchase can be named —
 * the offer, the legacy course, then the first order line — and `items` carries
 * what the order actually granted so a bump or a bundle is visible rather than
 * collapsed into its offer's name.
 *
 * `total_cents` is reported alongside `amount_cents` because they disagree on a
 * fully discounted order: the money taken was zero, and the thing bought was
 * still a $19 offer. The screen wants the first and the receipt wants the
 * second, so neither is thrown away here.
 */
adminSalesRouter.get(
  "/payments",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT o.id, o.course_slug, o.email, o.amount_cents, o.total_cents,
              o.subtotal_cents, o.discount_cents, o.coupon_code, o.currency, o.status,
              o.stripe_session_id, o.stripe_payment_intent_id, o.created_at,
              COALESCE(NULLIF(f.title, ''), NULLIF(o.course_title, ''),
                       (SELECT i.title FROM order_items i
                         WHERE i.order_id = o.id ORDER BY i.id LIMIT 1),
                       '') AS course_title,
              f.slug AS offer_slug,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'title', i.title, 'quantity', i.quantity, 'amountCents', i.amount_cents)
                        ORDER BY i.id)
                   FROM order_items i WHERE i.order_id = o.id),
                '[]'::json
              ) AS items
         FROM orders o
         LEFT JOIN offers f ON f.id = o.offer_id
        ORDER BY o.created_at DESC LIMIT 500`,
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

/**
 * Every payment that produced a receipt document, one-off purchases included.
 *
 * `invoices` used to hold nothing but Stripe subscription invoices, so this list
 * was empty on an account that had made sales — it just did not sell
 * subscriptions. A one-off order now carries a receipt record of its own
 * (`origin = 'order'`), which is what puts the purchase on this page, and
 * `receiptUrl` is the document itself rather than a Stripe link that only exists
 * for the invoices Stripe raised.
 */
adminSalesRouter.get(
  "/invoices",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT i.*,
              COALESCE(NULLIF(o.billing_name, ''), NULLIF(m.name, ''),
                       NULLIF(TRIM(m.first_name || ' ' || m.last_name), '')) AS member_name,
              COALESCE(NULLIF(fo.title, ''), NULLIF(fs.title, ''), NULLIF(pl.name, ''),
                       NULLIF(o.course_title, ''), 'Purchase') AS description,
              CASE WHEN i.origin = 'order' THEN 'One-off purchase' ELSE 'Subscription' END
                AS kind_label,
              '/admin/sales/invoices/' || i.id || '/receipt'     AS receipt_url,
              CASE WHEN i.order_id IS NULL THEN NULL
                   ELSE '/admin/sales/invoices/' || i.id || '/receipt.pdf' END
                AS receipt_pdf_url
         FROM invoices i
         LEFT JOIN orders o        ON o.id  = i.order_id
         LEFT JOIN offers fo       ON fo.id = o.offer_id
         LEFT JOIN subscriptions s ON s.id  = i.subscription_id
         LEFT JOIN offers fs       ON fs.id = s.offer_id
         LEFT JOIN plans pl        ON pl.id = s.plan_id
         LEFT JOIN members m       ON m.id  = COALESCE(o.member_id, i.member_id)
        ORDER BY COALESCE(i.paid_at, i.created_at) DESC, i.id DESC
        LIMIT 500`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/**
 * The receipt the member holds, as the office sees it.
 *
 * The same document from the same loader, so "send me my receipt again" is
 * answered with the receipt rather than with something that resembles it. Both
 * routes sit on the router's own `orders.view`: reading a receipt is exactly the
 * support action that permission exists for.
 */
adminSalesRouter.get(
  "/invoices/:id/receipt",
  asyncHandler(async (req, res) => {
    const parsed = idParamSchema.safeParse(req.params.id);
    if (!parsed.success) throw notFound("We couldn't find that receipt.");

    const document = await loadReceiptDocument({ invoiceId: parsed.data }, { admin: true });
    if (!document) throw notFound("We couldn't find that receipt.");

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(renderReceipt(document.view));
  }),
);

adminSalesRouter.get(
  "/invoices/:id/receipt.pdf",
  asyncHandler(async (req, res) => {
    const parsed = idParamSchema.safeParse(req.params.id);
    if (!parsed.success) throw notFound("We couldn't find that receipt.");

    const document = await loadReceiptDocument({ invoiceId: parsed.data }, { admin: true });
    // No order behind it means a Stripe renewal, which carries Stripe's own PDF.
    if (!document?.pdf) throw notFound("We couldn't find that receipt.");

    const pdf = await renderReceiptPdf(document);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  }),
);

/**
 * GET /admin/sales/receipt-preview(.pdf) — the receipt customiser's proof.
 *
 * A made-up purchase dressed in whatever is saved in Settings → General → "What
 * goes on your receipts" (logo, name, address, tax ID, footer note) and the
 * receipt title and refund policy, rendered by the same two renderers a real
 * receipt uses. No order is read, so it works before the first sale and shows
 * nobody's details.
 */
adminSalesRouter.get(
  "/receipt-preview",
  asyncHandler(async (_req, res) => {
    const document = await sampleReceiptDocument();
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(renderReceipt(document.view));
  }),
);

adminSalesRouter.get(
  "/receipt-preview.pdf",
  asyncHandler(async (_req, res) => {
    const document = await sampleReceiptDocument();
    const pdf = await renderReceiptPdf(document);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
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
           -- Subscription income only. A one-off order carries a receipt row in
           -- this table too now, and counting it here would report every
           -- purchase twice: once from the orders table, once from its receipt.
           FROM invoices WHERE status = 'paid' AND origin <> 'order'
             AND created_at >= CURRENT_DATE - INTERVAL '29 days'
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
    const result = await pool.query(
      `SELECT c.*,
              COALESCE((SELECT array_agg(co.offer_id ORDER BY co.offer_id)
                          FROM coupon_offers co WHERE co.coupon_id = c.id), '{}') AS offer_ids
         FROM coupons c ORDER BY c.created_at DESC`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

const couponCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    amountOffCents: z.number().int().positive().nullable().optional(),
    currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/).default("usd"),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    expiresAt: z.string().trim().max(40).nullable().optional(),
    duration: z.enum(["first", "forever"]).default("first"),
    offerIds: z.array(z.number().int().positive()).max(100).default([]),
  })
  .superRefine((value, ctx) => {
    const discounts = Number(value.percentOff != null) + Number(value.amountOffCents != null);
    if (discounts !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percentOff"], message: "Choose one discount type." });
    }
    if (value.expiresAt) {
      const end = new Date(`${value.expiresAt.slice(0, 10)}T23:59:59.999Z`);
      if (!Number.isFinite(end.getTime()) || end.getTime() <= Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Choose a future expiry date." });
      }
    }
  });

const couponUpdateSchema = z
  .object({
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    amountOffCents: z.number().int().positive().nullable().optional(),
    currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/),
    maxRedemptions: z.number().int().positive().nullable(),
    expiresAt: z.string().trim().max(40).nullable(),
    duration: z.enum(["first", "forever"]),
    offerIds: z.array(z.number().int().positive()).max(100),
  })
  .superRefine((value, ctx) => {
    const discounts = Number(value.percentOff != null) + Number(value.amountOffCents != null);
    if (discounts !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percentOff"], message: "Choose one discount type." });
    }
    if (value.expiresAt) {
      const end = new Date(`${value.expiresAt.slice(0, 10)}T23:59:59.999Z`);
      if (!Number.isFinite(end.getTime()) || end.getTime() <= Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Choose a future expiry date." });
      }
    }
  });

async function checkedCouponOfferIds(offerIds: number[]): Promise<number[]> {
  const unique = [...new Set(offerIds)];
  if (unique.length > 0) {
    const offers = await pool.query<{ id: number }>(`SELECT id FROM offers WHERE id = ANY($1::int[])`, [unique]);
    if (offers.rowCount !== unique.length) throw badRequest("One of the selected offers no longer exists.");
  }
  return unique;
}

function couponExpiry(value: string | null | undefined): Date | null {
  return value ? new Date(`${value.slice(0, 10)}T23:59:59.999Z`) : null;
}

async function createStripeCoupon(input: {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  duration: "first" | "forever";
}): Promise<string | null> {
  if (!stripeEnabled()) return null;
  const coupon = await stripe().coupons.create({
    name: input.code,
    duration: input.duration === "forever" ? "forever" : "once",
    ...(input.percentOff != null
      ? { percent_off: input.percentOff }
      : { amount_off: input.amountOffCents as number, currency: input.currency }),
    ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
    ...(input.expiresAt ? { redeem_by: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
  });
  return coupon.id;
}

adminSalesRouter.post(
  "/coupons",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = couponCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid coupon", parsed.error.flatten());
    const b = parsed.data;
    const code = b.code.toUpperCase();
    const percentOff = b.percentOff ?? null;
    const amountOffCents = b.amountOffCents ?? null;
    const uniqueOfferIds = await checkedCouponOfferIds(b.offerIds);
    const expiresAt = couponExpiry(b.expiresAt);
    const stripeCouponId = await createStripeCoupon({
      code, percentOff, amountOffCents, currency: b.currency,
      maxRedemptions: b.maxRedemptions ?? null, expiresAt, duration: b.duration,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO coupons
           (code, percent_off, amount_off_cents, currency, stripe_coupon_id,
            max_redemptions, expires_at, duration, scope)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [code, percentOff, amountOffCents, b.currency, stripeCouponId,
         b.maxRedemptions ?? null, expiresAt, b.duration,
         uniqueOfferIds.length > 0 ? "offers" : "global"],
      );
      for (const offerId of uniqueOfferIds) {
        await client.query(`INSERT INTO coupon_offers (coupon_id, offer_id) VALUES ($1, $2)`, [result.rows[0].id, offerId]);
      }
      await client.query("COMMIT");
      res.status(201).json({ ...rowToCamel(result.rows[0]), offerIds: uniqueOfferIds });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

adminSalesRouter.put(
  "/coupons/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    // The compact enable/disable action remains a partial update. Editing the
    // financial rules uses the complete validated shape below so an omitted
    // checkbox can never silently clear the offer restrictions.
    if (typeof req.body?.active === "boolean" && Object.keys(req.body).length === 1) {
      const toggled = await pool.query(
        "UPDATE coupons SET active = $1 WHERE id = $2 RETURNING *",
        [req.body.active, req.params.id],
      );
      if (toggled.rowCount === 0) throw notFound("Coupon not found");
      res.json(rowToCamel(toggled.rows[0]));
      return;
    }

    const parsed = couponUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid coupon", parsed.error.flatten());
    const b = parsed.data;
    const existing = await pool.query<{
      id: number; code: string; redeemed: number; active: boolean; stripe_coupon_id: string | null;
    }>(`SELECT id, code::text AS code, redeemed, active, stripe_coupon_id FROM coupons WHERE id = $1`, [req.params.id]);
    const before = existing.rows[0];
    if (!before) throw notFound("Coupon not found");
    if (b.maxRedemptions !== null && b.maxRedemptions < before.redeemed) {
      throw badRequest(`This code has already been used ${before.redeemed} times, so its limit cannot be lower than that.`);
    }

    const offerIds = await checkedCouponOfferIds(b.offerIds);
    const expiresAt = couponExpiry(b.expiresAt);
    const percentOff = b.percentOff ?? null;
    const amountOffCents = b.amountOffCents ?? null;
    const replacementStripeId = await createStripeCoupon({
      code: before.code,
      percentOff,
      amountOffCents,
      currency: b.currency,
      maxRedemptions: b.maxRedemptions,
      expiresAt,
      duration: b.duration,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE coupons SET percent_off = $2, amount_off_cents = $3, currency = $4,
                 max_redemptions = $5, expires_at = $6, duration = $7, scope = $8,
                 stripe_coupon_id = $9
           WHERE id = $1 RETURNING *`,
        [before.id, percentOff, amountOffCents, b.currency, b.maxRedemptions, expiresAt,
         b.duration, offerIds.length > 0 ? "offers" : "global", replacementStripeId],
      );
      await client.query(`DELETE FROM coupon_offers WHERE coupon_id = $1`, [before.id]);
      for (const offerId of offerIds) {
        await client.query(`INSERT INTO coupon_offers (coupon_id, offer_id) VALUES ($1, $2)`, [before.id, offerId]);
      }
      await client.query("COMMIT");

      if (before.stripe_coupon_id && stripeEnabled()) {
        await stripe().coupons.del(before.stripe_coupon_id).catch(() => undefined);
      }
      res.json({ ...rowToCamel(updated.rows[0]), offerIds });
    } catch (error) {
      await client.query("ROLLBACK");
      if (replacementStripeId && stripeEnabled()) {
        await stripe().coupons.del(replacementStripeId).catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
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
