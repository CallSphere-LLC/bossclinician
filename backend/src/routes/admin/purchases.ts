import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { getPurchaseDetail, listContactPurchases, parsePurchaseKey } from "../../services/purchases";
import type { PurchaseView } from "../../services/purchaseModel";

/**
 * Purchases as Kajabi shows them. Mounted at /admin/purchases.
 *
 *   GET /contact/:contactId        a person's Purchases tab, newest first
 *   GET /contact/:contactId/count  just the number ("Total purchases" on the drawer)
 *   GET /:key                      one purchase's View Details page
 *
 * A separate router rather than more routes on /admin/contacts: the contacts
 * router already has `POST /:id/purchases` (recording a manual payment), and a
 * GET beside it meaning something else would be a trap. The contact-scoped
 * routes come before `/:key` so "contact" is never read as a purchase key.
 *
 * Read-only, and mounted behind the contacts permission because this is a tab
 * of the contact profile: whoever can open a person's page could already see
 * every payment on it. Refunds, cancellations and grants stay where they are
 * (sales, offers), with their own guards.
 */
export const adminPurchasesRouter = Router();

function parseContactId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw badRequest("Invalid id");
  return id;
}

/* ── Coupons: Kajabi's "Order summary" ──────────────────────────────────── */

/**
 * The coupon on a purchase, for the detail page's "Order summary" (Subtotal /
 * Discount <CODE> / Total, as Kajabi prints a discounted order) and the
 * "Coupon <CODE>" line on the Purchases tab card. Every field is null when
 * nothing records one.
 */
export interface CouponFacts {
  couponCode: string | null;
  discountCents: number | null;
  /** Before the discount. */
  subtotalCents: number | null;
}

const NO_COUPON: CouponFacts = { couponCode: null, discountCents: null, subtotalCents: null };

/** A paid order's coupon columns, with its `coupon_redemptions` ledger row. */
export interface CouponOrderRow {
  id: number;
  purchase_id: number | null;
  subtotal_cents: number;
  discount_cents: number;
  /** `orders.coupon_code` — the code as typed at checkout, frozen on the order. */
  frozen_code: string | null;
  /** The coupon's current code, via `orders.coupon_id` or the redemption. */
  coupon_code: string | null;
  /** `coupon_redemptions.amount_cents`. */
  redeemed_cents: number | null;
}

/** A whole, non-negative number of cents from a jsonb value (number or numeric string). */
function metaCents(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function hasCoupon(order: CouponOrderRow): boolean {
  return Boolean(order.frozen_code || order.coupon_code) || order.discount_cents > 0 || (order.redeemed_cents ?? 0) > 0;
}

/**
 * Which coupon a purchase carries. Our own checkout's record wins: the first
 * paid order of the purchase that names a coupon or took a discount
 * (`orders.coupon_code` / `discount_cents` / `subtotal_cents`, with the
 * `coupon_redemptions` ledger and the coupon's code as fallbacks). Otherwise the
 * purchase's `meta` — where the Kajabi import keeps `coupon_code`,
 * `discount_cents` and `subtotal_cents` (camelCase spellings, like its other
 * `kajabi…` keys, are read too).
 *
 * A one-time purchase whose subtotal is not recorded gets total + discount, so
 * the summary still adds up ($3,997.00 − $3,997.00 = $0.00). A plan's does not:
 * its total is every instalment, and a coupon is on the one order it discounted.
 */
export function couponFacts(
  view: Pick<PurchaseView, "kind" | "totalCents">,
  orders: CouponOrderRow[],
  meta: Record<string, unknown> | null,
): CouponFacts {
  if (view.kind === "grant") return NO_COUPON;
  let facts: CouponFacts = NO_COUPON;
  const order = orders.find(hasCoupon);
  if (order) {
    facts = {
      couponCode: order.frozen_code?.trim() || order.coupon_code?.trim() || null,
      discountCents:
        order.discount_cents > 0 ? order.discount_cents : (order.redeemed_cents ?? 0) > 0 ? order.redeemed_cents : null,
      subtotalCents: order.subtotal_cents > 0 ? order.subtotal_cents : null,
    };
  } else if (meta) {
    const rawCode = meta.coupon_code ?? meta.couponCode;
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    facts = {
      couponCode: code || null,
      discountCents: metaCents(meta.discount_cents ?? meta.discountCents),
      subtotalCents: metaCents(meta.subtotal_cents ?? meta.subtotalCents),
    };
  }
  if (facts.couponCode === null && !facts.discountCents) return NO_COUPON;
  const oneOff = view.kind === "one_time" || view.kind === "free";
  if (facts.subtotalCents === null && facts.discountCents !== null && oneOff) {
    facts = { ...facts, subtotalCents: view.totalCents + facts.discountCents };
  }
  return facts;
}

/**
 * Adds `couponCode` / `discountCents` / `subtotalCents` to purchase views, in two
 * queries whatever their number. A view's key says where to look: `12` is a
 * purchases row (its meta, and the orders linked to it), `order-45` an order
 * shown as a purchase of its own, `grant-7` a grant (never a coupon).
 */
async function withCoupons<T extends PurchaseView>(views: T[]): Promise<(T & CouponFacts)[]> {
  const purchaseIds = new Set<number>();
  const orderIds = new Set<number>();
  for (const view of views) {
    const key = parsePurchaseKey(view.key);
    if (key?.type === "purchase") purchaseIds.add(key.id);
    else if (key?.type === "order") orderIds.add(key.id);
  }
  if (purchaseIds.size === 0 && orderIds.size === 0) return views.map((view) => ({ ...view, ...NO_COUPON }));

  const [metas, orders] = await Promise.all([
    purchaseIds.size === 0
      ? Promise.resolve({ rows: [] as { id: number; meta: Record<string, unknown> | null }[] })
      : pool.query<{ id: number; meta: Record<string, unknown> | null }>(
          `SELECT id, meta FROM purchases WHERE id = ANY($1::int[])`,
          [[...purchaseIds]],
        ),
    pool.query<CouponOrderRow>(
      `SELECT o.id, o.purchase_id, o.subtotal_cents, o.discount_cents,
              NULLIF(o.coupon_code, '') AS frozen_code, c.code AS coupon_code,
              cr.amount_cents AS redeemed_cents
         FROM orders o
         LEFT JOIN coupon_redemptions cr ON cr.order_id = o.id
         LEFT JOIN coupons c ON c.id = COALESCE(o.coupon_id, cr.coupon_id)
        WHERE (o.id = ANY($1::int[]) OR o.purchase_id = ANY($2::int[]))
          AND o.status IN ('paid', 'refunded')
        ORDER BY o.created_at, o.id`,
      [[...orderIds], [...purchaseIds]],
    ),
  ]);
  const metaById = new Map(metas.rows.map((row) => [row.id, row.meta]));

  return views.map((view) => {
    const key = parsePurchaseKey(view.key);
    if (!key || key.type === "grant") return { ...view, ...NO_COUPON };
    const linked =
      key.type === "purchase"
        ? orders.rows.filter((o) => o.purchase_id === key.id)
        : orders.rows.filter((o) => o.id === key.id);
    const meta = key.type === "purchase" ? (metaById.get(key.id) ?? null) : null;
    return { ...view, ...couponFacts(view, linked, meta) };
  });
}

adminPurchasesRouter.get(
  "/contact/:contactId",
  asyncHandler(async (req, res) => {
    const body = await listContactPurchases(parseContactId(req.params.contactId));
    res.json({ ...body, purchases: await withCoupons(body.purchases) });
  }),
);

adminPurchasesRouter.get(
  "/contact/:contactId/count",
  asyncHandler(async (req, res) => {
    const { purchaseCount } = await listContactPurchases(parseContactId(req.params.contactId));
    res.json({ purchaseCount });
  }),
);

/** `12` (a purchase), `order-45` (a payment that is its own purchase), `grant-7` (an offer granted here). */
adminPurchasesRouter.get(
  "/:key",
  asyncHandler(async (req, res) => {
    const detail = await getPurchaseDetail(req.params.key);
    // The purchase is one of its own items; one pass covers both.
    const enriched = await withCoupons([detail.purchase, ...detail.items]);
    const [purchase, ...items] = enriched;
    res.json({ ...detail, purchase, items });
  }),
);
