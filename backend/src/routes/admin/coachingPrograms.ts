import { Router } from "express";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";

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

/* ------------------------------------------------------------ programme content */

/**
 * A coaching programme's lessons: the workbook course its product opens
 * (`products.legacy_course_id`, migration 120). The course row is kept out of
 * the admin Courses list, so this is where it is found and edited from — the
 * owner moved the one-to-one programmes "over to the coaching area" (QA row 99).
 */
export type CoachingProgramContent = {
  /** The coaching product that grants the programme; null when none does yet. */
  productId: number | null;
  productSlug: string | null;
  course: {
    id: number;
    title: string;
    moduleCount: number;
    lessonCount: number;
    publishedLessonCount: number;
  } | null;
};

async function loadProgramContent(programId: number): Promise<CoachingProgramContent> {
  const program = await pool.query(`SELECT 1 FROM coaching_offers WHERE id = $1`, [programId]);
  if (program.rowCount === 0) throw notFound("Coaching program not found");

  // The live product first: an archived one granted it once but sells nothing now.
  const result = await pool.query<{
    product_id: number;
    product_slug: string;
    course_id: number | null;
    course_title: string | null;
    module_count: number;
    lesson_count: number;
    published_lesson_count: number;
  }>(
    `SELECT p.id AS product_id, p.slug AS product_slug, c.id AS course_id, c.title AS course_title,
            (SELECT COUNT(*)::int FROM course_modules m WHERE m.course_id = c.id) AS module_count,
            (SELECT COUNT(*)::int FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
              WHERE m.course_id = c.id) AS lesson_count,
            (SELECT COUNT(*)::int FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
              WHERE m.course_id = c.id AND l.published) AS published_lesson_count
       FROM products p
       LEFT JOIN courses c ON c.id = p.legacy_course_id
      WHERE p.kind = 'coaching' AND p.coaching_offer_id = $1
      ORDER BY (p.status = 'archived'), (c.id IS NULL), p.id
      LIMIT 1`,
    [programId],
  );
  const row = result.rows[0];
  if (!row) return { productId: null, productSlug: null, course: null };
  return {
    productId: row.product_id,
    productSlug: row.product_slug,
    course:
      row.course_id === null
        ? null
        : {
            id: row.course_id,
            title: row.course_title ?? "",
            moduleCount: row.module_count,
            lessonCount: row.lesson_count,
            publishedLessonCount: row.published_lesson_count,
          },
  };
}

/** GET /programs/:id/content */
adminCoachingProgramsRouter.get(
  "/programs/:id/content",
  asyncHandler(async (req, res) => {
    const programId = positiveId(req.params.id, "Invalid coaching program id");
    res.json(await loadProgramContent(programId));
  }),
);

/**
 * POST /programs/:id/content
 *
 * Gives a programme somewhere to put lessons: an unpublished course row named
 * after it, linked to its coaching product. Unpublished keeps it off the public
 * course catalogue; the programme's buyers reach it through the product.
 * Answers the existing course when there already is one, so a double click
 * cannot make two.
 */
adminCoachingProgramsRouter.post(
  "/programs/:id/content",
  asyncHandler(async (req, res) => {
    const programId = positiveId(req.params.id, "Invalid coaching program id");
    const current = await loadProgramContent(programId);
    if (current.course) {
      res.json(current);
      return;
    }
    if (current.productId === null || current.productSlug === null) {
      throw badRequest(
        "This program isn't sold through a product yet. Add it to a product first, then its lessons can be added here.",
      );
    }

    const client = await pool.connect();
    let courseId = 0;
    try {
      await client.query("BEGIN");
      // Locked so two presses at once link one course, not two.
      const locked = await client.query<{ legacy_course_id: number | null; title: string }>(
        `SELECT legacy_course_id, title FROM products WHERE id = $1 FOR UPDATE`,
        [current.productId],
      );
      const existing = locked.rows[0]?.legacy_course_id ?? null;
      if (existing !== null) {
        courseId = existing;
      } else {
        // The product's slug where it is free, otherwise suffixed — course slugs are unique.
        const created = await client.query<{ id: number }>(
          `INSERT INTO courses (slug, title, published)
           SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM courses WHERE slug = $1) THEN $1
                       ELSE $1 || '-program-' || $3::text END,
                  $2, false
           RETURNING id`,
          [current.productSlug, locked.rows[0]?.title ?? "Coaching program", current.productId],
        );
        courseId = created.rows[0].id;
        await client.query(
          `UPDATE products SET legacy_course_id = $2, updated_at = now() WHERE id = $1`,
          [current.productId, courseId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await recordAdminAction({
      req,
      action: "coaching.program_content_create",
      entityType: "coaching_offer",
      entityId: programId,
      after: { productId: current.productId, courseId },
    });
    res.status(201).json(await loadProgramContent(programId));
  }),
);
