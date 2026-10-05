import { Router } from "express";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";

/**
 * What a coaching program is sold through. Mounted at /admin/coaching.
 *
 * Kajabi's coaching product has an Offers tab: every offer that includes the
 * program. Here a program (`coaching_offers`) carries no price a checkout
 * charges — it is granted by a product (`products.coaching_offer_id`), and a
 * product is sold by the offers that name it (`offer_products`). So "the
 * offers for this program" is that chain read backwards.
 *
 * Its own router, not `/growth/coaching/offers/:id/...`: that path belongs to
 * the programs' CRUD router, which would answer first.
 */
export const adminCoachingProgramsRouter = Router();

// A type alias rather than an interface so a row can be handed straight to
// rowsToCamel — only aliases carry the implicit index signature it asks for.
export type CoachingProgramOffer = {
  id: number;
  title: string;
  /** Kajabi's "Internal Title" — '' means the list shows `title`. */
  internalTitle: string;
  slug: string;
  status: string;
  currency: string;
  pricingType: string;
  amountCents: number;
  minAmountCents: number;
  interval: string | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
  purchaseCount: number;
  /** The other ways to pay on the same checkout (active ones only). */
  pricingOptions: unknown[];
  /** The bundle the program arrives inside, or null when the offer names it directly. */
  bundleTitle: string | null;
};

function positiveId(raw: string | undefined, message: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(message);
  return id;
}

/** The offer hands over a product that is this program ($1). */
const SOLD_DIRECTLY = `EXISTS (
  SELECT 1 FROM offer_products op
    JOIN products p ON p.id = op.product_id
   WHERE op.offer_id = o.id AND p.coaching_offer_id = $1)`;

/**
 * The same through a bundle, one level deep — which is as far as
 * `grantOfferAccess` expands a bundle when it delivers one.
 */
const BUNDLE_JOIN = `FROM offer_products op
    JOIN products b ON b.id = op.product_id
    JOIN product_bundle_items bi ON bi.bundle_product_id = b.id
    JOIN products p ON p.id = bi.product_id
   WHERE op.offer_id = o.id AND p.coaching_offer_id = $1`;

/**
 * Settled orders, plus the people who bought it on Kajabi before the move —
 * the count the offers list shows (routes/admin/offers.ts, PURCHASE_COUNT).
 */
const PURCHASE_COUNT = `((SELECT COUNT(*)::int FROM orders ord
                           WHERE ord.offer_id = o.id AND ord.status = 'paid')
                        + (SELECT COUNT(DISTINCT pur.contact_id)::int FROM purchases pur
                           WHERE pur.offer_id = o.id AND pur.source = 'kajabi')) AS purchase_count`;

/** camelCase keys are built here: `rowsToCamel` is shallow. */
const PRICING_OPTIONS_JSON = `COALESCE((
  SELECT json_agg(json_build_object(
           'id', po.id, 'label', po.label, 'pricingType', po.pricing_type,
           'amountCents', po.amount_cents, 'minAmountCents', po.min_amount_cents,
           'currency', po.currency, 'interval', po.interval,
           'intervalCount', po.interval_count, 'installmentCount', po.installment_count,
           'trialDays', po.trial_days, 'recommended', po.recommended
         ) ORDER BY po.sort, po.id)
    FROM offer_pricing_options po
   WHERE po.offer_id = o.id AND po.active
), '[]'::json) AS pricing_options`;

/**
 * GET /programs/:id/offers
 *
 * Every offer that includes this program, live ones first. Archived offers are
 * listed too, as the offers list does — they are part of what sold it.
 */
adminCoachingProgramsRouter.get(
  "/programs/:id/offers",
  asyncHandler(async (req, res) => {
    const programId = positiveId(req.params.id, "Invalid coaching program id");
    const program = await pool.query(`SELECT 1 FROM coaching_offers WHERE id = $1`, [programId]);
    if (program.rowCount === 0) throw notFound("Coaching program not found");

    const result = await pool.query(
      `SELECT o.id, o.title, o.internal_title, o.slug, o.status, o.currency, o.pricing_type,
              o.amount_cents, o.min_amount_cents, o.interval, o.interval_count,
              o.installment_count, o.trial_days,
              ${PURCHASE_COUNT},
              ${PRICING_OPTIONS_JSON},
              CASE WHEN ${SOLD_DIRECTLY} THEN NULL
                   ELSE (SELECT b.title ${BUNDLE_JOIN} ORDER BY b.title LIMIT 1)
               END AS bundle_title
         FROM offers o
        WHERE ${SOLD_DIRECTLY}
           OR EXISTS (SELECT 1 ${BUNDLE_JOIN})
        ORDER BY CASE o.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                 COALESCE(NULLIF(o.internal_title, ''), o.title), o.id`,
      [programId],
    );
    res.json(rowsToCamel<CoachingProgramOffer>(result.rows));
  }),
);
