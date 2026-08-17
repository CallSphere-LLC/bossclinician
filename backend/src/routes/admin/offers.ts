import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { grantOfferAccess, revokeOfferAccess } from "../../services/access";
import type { BillingInterval, PricingType } from "../../services/pricing";
import {
  bumpCreateSchema,
  bumpUpdateSchema,
  idParamSchema,
  offerCreateSchema,
  offerGrantSchema,
  offerListQuerySchema,
  offerPricingIssue,
  offerProductAttachSchema,
  offerRevokeSchema,
  offerUpdateSchema,
  upsellCreateSchema,
  upsellUpdateSchema,
  type CommerceIssue,
  type OfferPricingShape,
} from "../../validation/commerceSchemas";

/**
 * Offers — a product at a price. Mounted at /admin/offers.
 *
 * Kajabi runs this business on 20 products behind 57 offers, and everything here
 * exists to make that one-to-many real: the same Fully Booked Toolkit sold at
 * full price, inside a bundle, on a payment plan and as a Black Friday deal is
 * four rows in this table pointing at one row in `products`.
 */
export const adminOffersRouter = Router();

/* ------------------------------------------------------------------- shared */

// A type alias rather than an interface so a row can be handed straight to
// rowToCamel — only aliases carry the implicit index signature it asks for.
type OfferRow = {
  id: number;
  title: string;
  slug: string;
  status: string;
  description: string;
  checkout_headline: string;
  thumbnail_url: string;
  currency: string;
  pricing_type: PricingType;
  amount_cents: number;
  min_amount_cents: number;
  interval: BillingInterval | null;
  interval_count: number;
  installment_count: number | null;
  trial_days: number;
  collect_tax: boolean;
  collect_address: boolean;
  collect_phone: boolean;
  custom_fields: unknown;
  terms_url: string;
  require_terms: boolean;
  redirect_url: string;
  thank_you_page_id: string | null;
  access_expires_after_days: number | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  created_at: string;
  updated_at: string;
};

const OFFER_COLUMNS = `o.id, o.title, o.slug, o.status, o.description, o.checkout_headline,
       o.thumbnail_url, o.currency, o.pricing_type, o.amount_cents, o.min_amount_cents,
       o.interval, o.interval_count, o.installment_count, o.trial_days, o.collect_tax,
       o.collect_address, o.collect_phone, o.custom_fields, o.terms_url, o.require_terms,
       o.redirect_url, o.thank_you_page_id, o.access_expires_after_days,
       o.stripe_price_id, o.stripe_product_id, o.created_at, o.updated_at`;

/**
 * Only orders that settled. A pending row is a checkout somebody started, and
 * counting those as purchases makes the offer nobody completes look like the
 * best seller on the site.
 */
const PURCHASE_COUNT = `(SELECT COUNT(*)::int FROM orders ord
                          WHERE ord.offer_id = o.id AND ord.status = 'paid') AS purchase_count`;

/**
 * Nested JSON is built with camelCase keys in the query itself: `rowToCamel` is
 * shallow and would leave `thumbnail_url` untouched inside an aggregate.
 */
const OFFER_PRODUCTS_JSON = `COALESCE((
  SELECT json_agg(json_build_object(
           'id', p.id, 'slug', p.slug, 'title', p.title, 'kind', p.kind,
           'status', p.status, 'thumbnailUrl', p.thumbnail_url, 'sort', op.sort
         ) ORDER BY op.sort, p.title)
    FROM offer_products op
    JOIN products p ON p.id = op.product_id
   WHERE op.offer_id = o.id
), '[]'::json) AS products`;

function parseId(raw: string, label = "offer"): number {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(`Invalid ${label} id`);
  return parsed.data;
}

/** Answers a cross-field problem in the shape zod's own `flatten()` produces. */
function issueError(issue: CommerceIssue) {
  return badRequest(issue.message, { formErrors: [], fieldErrors: { [issue.field]: [issue.message] } });
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/** Escapes the characters LIKE reads as syntax; the pattern is still a bind parameter. */
function likeLiteral(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function loadOffer(id: number): Promise<OfferRow> {
  const result = await pool.query<OfferRow>(`SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound("Offer not found");
  return row;
}

/** In an edit, `undefined` means "unchanged" and `null` means "clear it". */
function patched<T>(incoming: T | undefined, current: T): T {
  return incoming === undefined ? current : incoming;
}

async function assertProductExists(productId: number): Promise<{ id: number; title: string }> {
  const found = await pool.query<{ id: number; title: string }>(
    `SELECT id, title FROM products WHERE id = $1`,
    [productId],
  );
  const row = found.rows[0];
  if (!row) throw issueError({ field: "productId", message: "That product no longer exists." });
  return row;
}

async function assertThankYouPageExists(slug: string | null): Promise<void> {
  if (slug === null) return;
  const found = await pool.query(`SELECT 1 FROM pages WHERE slug = $1`, [slug]);
  if (found.rowCount === 0) {
    throw issueError({ field: "thankYouPageId", message: `There is no page with the address "${slug}".` });
  }
}

/**
 * The title of a product this offer already hands over, or null.
 *
 * Bundles are expanded one level, matching what `grantOfferAccess` actually
 * delivers — looking only at the direct attachments would miss the common case,
 * where the offer sells a bundle and the bump sells something already inside it.
 */
async function grantedProductTitle(offerId: number, productId: number): Promise<string | null> {
  const result = await pool.query<{ title: string }>(
    `SELECT p.title
       FROM products p
      WHERE p.id = $2
        AND (EXISTS (SELECT 1 FROM offer_products op
                      WHERE op.offer_id = $1 AND op.product_id = p.id)
          OR EXISTS (SELECT 1 FROM offer_products op
                       JOIN product_bundle_items bi ON bi.bundle_product_id = op.product_id
                      WHERE op.offer_id = $1 AND bi.product_id = p.id))`,
    [offerId, productId],
  );
  return result.rows[0]?.title ?? null;
}

/** The same clash from the other side: a bump that already sells what is being attached. */
async function bumpedProductTitle(offerId: number, productId: number): Promise<string | null> {
  const result = await pool.query<{ title: string }>(
    `SELECT p.title
       FROM offer_bumps b
       JOIN products p ON p.id = b.product_id
      WHERE b.offer_id = $1
        AND (b.product_id = $2
          OR b.product_id IN (SELECT bi.product_id
                                FROM product_bundle_items bi
                               WHERE bi.bundle_product_id = $2))
      LIMIT 1`,
    [offerId, productId],
  );
  return result.rows[0]?.title ?? null;
}

const doubleChargeMessage = (title: string) =>
  `This offer already includes "${title}", so an order bump for it would charge the customer twice ` +
  `for the same thing. Remove it from one place or the other.`;

async function attachedProductCount(offerId: number): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM offer_products WHERE offer_id = $1`,
    [offerId],
  );
  return result.rows[0]?.count ?? 0;
}

/**
 * Everything that has to be true before a customer can be shown a price.
 *
 * The product check is the one that matters. An offer with nothing attached is a
 * working checkout that takes money and grants nothing, and it looks entirely
 * normal in the editor until the first customer pays. The pricing rules are
 * re-run here as well as on write, because a draft can predate a tightened rule
 * and going live is the last moment before a real customer meets the price.
 */
async function assertPublishable(offerId: number, title: string, pricing: OfferPricingShape): Promise<void> {
  if ((await attachedProductCount(offerId)) === 0) {
    throw badRequest(
      `"${title}" does not include any products yet, so a customer would pay and receive nothing. ` +
        `Add at least one product before publishing it.`,
    );
  }

  const issue = offerPricingIssue(pricing);
  if (issue) throw issueError(issue);
}

function pricingShapeOf(row: OfferRow): OfferPricingShape {
  return {
    pricingType: row.pricing_type,
    amountCents: row.amount_cents,
    minAmountCents: row.min_amount_cents,
    interval: row.interval,
    installmentCount: row.installment_count,
    trialDays: row.trial_days,
  };
}

/* -------------------------------------------------------------------- reads */

adminOffersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = offerListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { q, status, pricingType } = parsed.data;

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${likeLiteral(q)}%`);
      clauses.push(`(o.title ILIKE $${params.length} OR o.slug ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      clauses.push(`o.status = $${params.length}`);
    }
    if (pricingType) {
      params.push(pricingType);
      clauses.push(`o.pricing_type = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT ${OFFER_COLUMNS}, ${PURCHASE_COUNT}, ${OFFER_PRODUCTS_JSON}
         FROM offers o
         ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY o.created_at DESC`,
      params,
    );

    res.json(rowsToCamel(result.rows));
  }),
);

adminOffersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);

    const result = await pool.query(
      `SELECT ${OFFER_COLUMNS}, ${PURCHASE_COUNT}, ${OFFER_PRODUCTS_JSON}
         FROM offers o WHERE o.id = $1`,
      [id],
    );
    const offer = result.rows[0];
    if (!offer) throw notFound("Offer not found");

    const [bumps, upsells] = await Promise.all([
      pool.query(
        `SELECT b.id, b.offer_id, b.product_id, b.title, b.description, b.amount_cents,
                b.sort, b.created_at, b.updated_at, p.title AS product_title, p.kind AS product_kind
           FROM offer_bumps b
           JOIN products p ON p.id = b.product_id
          WHERE b.offer_id = $1
          ORDER BY b.sort, b.id`,
        [id],
      ),
      pool.query(
        `SELECT u.id, u.offer_id, u.step, u.upsell_offer_id, u.downsell_offer_id,
                u.headline, u.body, u.created_at, u.updated_at,
                up.title AS upsell_offer_title, down.title AS downsell_offer_title
           FROM offer_upsells u
           JOIN offers up        ON up.id = u.upsell_offer_id
           LEFT JOIN offers down ON down.id = u.downsell_offer_id
          WHERE u.offer_id = $1
          ORDER BY u.step`,
        [id],
      ),
    ]);

    res.json({
      ...rowToCamel(offer),
      bumps: rowsToCamel(bumps.rows),
      upsells: rowsToCamel(upsells.rows),
    });
  }),
);

/* ------------------------------------------------------------------- writes */

adminOffersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = offerCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const data = parsed.data;

    await assertThankYouPageExists(data.thankYouPageId);

    let created: OfferRow | undefined;
    try {
      const result = await pool.query<OfferRow>(
        `INSERT INTO offers AS o
           (title, slug, status, description, checkout_headline, thumbnail_url, currency,
            pricing_type, amount_cents, min_amount_cents, interval, interval_count,
            installment_count, trial_days, collect_tax, collect_address, collect_phone,
            custom_fields, terms_url, require_terms, redirect_url, thank_you_page_id,
            access_expires_after_days, stripe_price_id, stripe_product_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18::jsonb, $19, $20, $21, $22, $23, $24, $25)
         RETURNING ${OFFER_COLUMNS}`,
        [
          data.title,
          data.slug,
          data.status,
          data.description,
          data.checkoutHeadline,
          data.thumbnailUrl,
          data.currency,
          data.pricingType,
          data.amountCents,
          data.minAmountCents,
          data.interval,
          data.intervalCount,
          data.installmentCount,
          data.trialDays,
          data.collectTax,
          data.collectAddress,
          data.collectPhone,
          JSON.stringify(data.customFields),
          data.termsUrl,
          data.requireTerms,
          data.redirectUrl,
          data.thankYouPageId,
          data.accessExpiresAfterDays,
          data.stripePriceId,
          data.stripeProductId,
        ],
      );
      created = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({
          field: "slug",
          message: `The web address "${data.slug}" is already taken by another offer.`,
        });
      }
      throw err;
    }

    if (!created) throw badRequest("Offer could not be saved");
    const json = rowToCamel(created);

    await recordAdminAction({
      req,
      action: "offer.create",
      entityType: "offer",
      entityId: created.id,
      after: json,
    });

    res.status(201).json(json);
  }),
);

adminOffersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = offerUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const patch = parsed.data;

    const before = await loadOffer(id);

    // Validated against the row the edit produces, not the fields it carries:
    // switching a one-time offer to a payment plan sends `pricingType` alone, and
    // it has to be checked against the installment count already on the row.
    const pricing = {
      pricingType: patched(patch.pricingType, before.pricing_type),
      amountCents: patched(patch.amountCents, before.amount_cents),
      minAmountCents: patched(patch.minAmountCents, before.min_amount_cents),
      interval: patched(patch.interval, before.interval),
      installmentCount: patched(patch.installmentCount, before.installment_count),
      trialDays: patched(patch.trialDays, before.trial_days),
    };
    const issue = offerPricingIssue(pricing);
    if (issue) throw issueError(issue);

    const currency = patched(patch.currency, before.currency);
    const intervalCount = patched(patch.intervalCount, before.interval_count);

    // A `stripe_price_id` is the price *in Stripe*, and it is the figure a
    // subscription is actually billed against; the columns above are only what
    // the sales page promises. The moment the two can disagree they do — edit a
    // $99/mo offer to $149 and the page, the quote, `orders.total_cents` and the
    // receipt all say $149 while Stripe collects $99 every month, forever.
    // Reverse the edit and every later subscriber is undercharged instead.
    //
    // So any change to the money or the billing shape releases the pinned Price,
    // and the next sale mints one that matches the page. `duplicate` below drops
    // the same ids for the same reason.
    //
    // Customers already subscribed keep the Price they signed up on. That
    // asymmetry is deliberate and not an oversight: a live subscription is a
    // price somebody agreed to, and an edit in this screen is not their consent
    // to a different one. Moving existing subscribers is a separate, explicit
    // act with its own notice period.
    //
    // `stripe_product_id` is kept. A Product carries the name, not the amount,
    // so reusing it keeps one entry in the Stripe catalogue per offer rather
    // than one per price change.
    const repriced =
      pricing.pricingType !== before.pricing_type ||
      pricing.amountCents !== before.amount_cents ||
      pricing.interval !== before.interval ||
      intervalCount !== before.interval_count ||
      currency !== before.currency;

    // An offer wired to a Price built in the Stripe dashboard names it in the
    // same request, and that naming wins over the release.
    const stripePriceId =
      patch.stripePriceId !== undefined
        ? patch.stripePriceId
        : repriced
          ? null
          : before.stripe_price_id;

    const thankYouPageId = patched(patch.thankYouPageId, before.thank_you_page_id);
    if (patch.thankYouPageId !== undefined) await assertThankYouPageExists(thankYouPageId);

    // Going live through the status field has to clear the same bar as the
    // publish button, or the guard is one dropdown away from being bypassed.
    const status = patched(patch.status, before.status);
    if (status === "published" && before.status !== "published") {
      await assertPublishable(id, patched(patch.title, before.title), pricing);
    }

    let after: OfferRow | undefined;
    try {
      const result = await pool.query<OfferRow>(
        `UPDATE offers AS o
            SET title                     = $1,
                slug                      = $2,
                status                    = $3,
                description               = $4,
                checkout_headline         = $5,
                thumbnail_url             = $6,
                currency                  = $7,
                pricing_type              = $8,
                amount_cents              = $9,
                min_amount_cents          = $10,
                interval                  = $11,
                interval_count            = $12,
                installment_count         = $13,
                trial_days                = $14,
                collect_tax               = $15,
                collect_address           = $16,
                collect_phone             = $17,
                custom_fields             = $18::jsonb,
                terms_url                 = $19,
                require_terms             = $20,
                redirect_url              = $21,
                thank_you_page_id         = $22,
                access_expires_after_days = $23,
                stripe_price_id           = $24,
                stripe_product_id         = $25,
                updated_at                = now()
          WHERE o.id = $26
         RETURNING ${OFFER_COLUMNS}`,
        [
          patched(patch.title, before.title),
          patched(patch.slug, before.slug),
          status,
          patched(patch.description, before.description),
          patched(patch.checkoutHeadline, before.checkout_headline),
          patched(patch.thumbnailUrl, before.thumbnail_url),
          currency,
          pricing.pricingType,
          pricing.amountCents,
          pricing.minAmountCents,
          pricing.interval,
          intervalCount,
          pricing.installmentCount,
          pricing.trialDays,
          patched(patch.collectTax, before.collect_tax),
          patched(patch.collectAddress, before.collect_address),
          patched(patch.collectPhone, before.collect_phone),
          JSON.stringify(patch.customFields ?? before.custom_fields),
          patched(patch.termsUrl, before.terms_url),
          patched(patch.requireTerms, before.require_terms),
          patched(patch.redirectUrl, before.redirect_url),
          thankYouPageId,
          patched(patch.accessExpiresAfterDays, before.access_expires_after_days),
          stripePriceId,
          patched(patch.stripeProductId, before.stripe_product_id),
          id,
        ],
      );
      after = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({ field: "slug", message: "That web address is already taken by another offer." });
      }
      throw err;
    }

    if (!after) throw notFound("Offer not found");
    const json = rowToCamel(after);

    await recordAdminAction({
      req,
      action: "offer.update",
      entityType: "offer",
      entityId: id,
      before: rowToCamel(before),
      after: json,
    });

    res.json(json);
  }),
);

/** The first free `<slug>-copy`, `<slug>-copy-2`, … so duplicating twice works. */
async function nextCopySlug(client: PoolClient, slug: string): Promise<string> {
  const base = `${slug}-copy`.slice(0, 190);
  const taken = await client.query<{ slug: string }>(
    `SELECT slug FROM offers WHERE slug = $1 OR slug LIKE $2`,
    [base, `${likeLiteral(base)}-%`],
  );
  const used = new Set(taken.rows.map((row) => row.slug));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw badRequest("There are too many copies of this offer already. Rename some of them first.");
}

/**
 * POST /admin/offers/:id/duplicate — the fastest route to a 57-offer catalogue.
 *
 * The copy lands as a draft, and the Stripe ids are deliberately not carried
 * over. A `stripe_price_id` is the price *in Stripe*, so a copy that kept it
 * would charge the original's amount however the new one is edited afterwards.
 */
adminOffersRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);

    const client = await pool.connect();
    let created: OfferRow | undefined;
    try {
      await client.query("BEGIN");

      const source = await client.query<{ slug: string }>(`SELECT slug FROM offers WHERE id = $1`, [id]);
      const sourceSlug = source.rows[0]?.slug;
      if (!sourceSlug) throw notFound("Offer not found");

      const slug = await nextCopySlug(client, sourceSlug);

      const inserted = await client.query<OfferRow>(
        `INSERT INTO offers AS o
           (title, slug, status, description, checkout_headline, thumbnail_url, currency,
            pricing_type, amount_cents, min_amount_cents, interval, interval_count,
            installment_count, trial_days, collect_tax, collect_address, collect_phone,
            custom_fields, terms_url, require_terms, redirect_url, thank_you_page_id,
            access_expires_after_days)
         SELECT left(s.title || ' (copy)', 300), $2, 'draft', s.description, s.checkout_headline,
                s.thumbnail_url, s.currency, s.pricing_type, s.amount_cents, s.min_amount_cents,
                s.interval, s.interval_count, s.installment_count, s.trial_days, s.collect_tax,
                s.collect_address, s.collect_phone, s.custom_fields, s.terms_url, s.require_terms,
                s.redirect_url, s.thank_you_page_id, s.access_expires_after_days
           FROM offers s WHERE s.id = $1
         RETURNING ${OFFER_COLUMNS}`,
        [id, slug],
      );
      created = inserted.rows[0];
      if (!created) throw notFound("Offer not found");

      await client.query(
        `INSERT INTO offer_products (offer_id, product_id, sort)
         SELECT $2, product_id, sort FROM offer_products WHERE offer_id = $1`,
        [id, created.id],
      );
      await client.query(
        `INSERT INTO offer_bumps (offer_id, product_id, title, description, amount_cents, sort)
         SELECT $2, product_id, title, description, amount_cents, sort
           FROM offer_bumps WHERE offer_id = $1`,
        [id, created.id],
      );
      await client.query(
        `INSERT INTO offer_upsells (offer_id, step, upsell_offer_id, downsell_offer_id, headline, body)
         SELECT $2, step, upsell_offer_id, downsell_offer_id, headline, body
           FROM offer_upsells WHERE offer_id = $1`,
        [id, created.id],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    if (!created) throw badRequest("The offer could not be duplicated");
    const json = rowToCamel(created);

    await recordAdminAction({
      req,
      action: "offer.duplicate",
      entityType: "offer",
      entityId: created.id,
      after: { ...json, duplicatedFromOfferId: id },
    });

    res.status(201).json(json);
  }),
);

adminOffersRouter.post(
  "/:id/publish",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const before = await loadOffer(id);

    await assertPublishable(id, before.title, pricingShapeOf(before));

    const result = await pool.query<OfferRow>(
      `UPDATE offers AS o SET status = 'published', updated_at = now()
        WHERE o.id = $1 RETURNING ${OFFER_COLUMNS}`,
      [id],
    );
    const after = result.rows[0];
    if (!after) throw notFound("Offer not found");

    await recordAdminAction({
      req,
      action: "offer.publish",
      entityType: "offer",
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    });

    res.json(rowToCamel(after));
  }),
);

/**
 * Archiving stops the offer selling and leaves every order, grant and report
 * that points at it exactly where it is. It is what DELETE below tells an admin
 * to reach for instead.
 */
adminOffersRouter.post(
  "/:id/archive",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const before = await loadOffer(id);

    const result = await pool.query<OfferRow>(
      `UPDATE offers AS o SET status = 'archived', updated_at = now()
        WHERE o.id = $1 RETURNING ${OFFER_COLUMNS}`,
      [id],
    );
    const after = result.rows[0];
    if (!after) throw notFound("Offer not found");

    await recordAdminAction({
      req,
      action: "offer.archive",
      entityType: "offer",
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    });

    res.json(rowToCamel(after));
  }),
);

/**
 * DELETE /admin/offers/:id
 *
 * Refuses once anything real points at the offer. `orders.offer_id` and
 * `access_grants.offer_id` are ON DELETE SET NULL, so deleting a sold offer
 * quietly detaches paid orders from the thing they paid for; `offer_upsells`
 * cascades, so it also removes an upsell step configured on some other offer.
 */
adminOffersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const offer = await loadOffer(id);

    const usage = await pool.query<{ orders: number; grants: number; referenced_by: number }>(
      `SELECT (SELECT COUNT(*)::int FROM orders ord WHERE ord.offer_id = $1) AS orders,
              (SELECT COUNT(*)::int FROM access_grants g WHERE g.offer_id = $1) AS grants,
              (SELECT COUNT(*)::int FROM offer_upsells u
                WHERE (u.upsell_offer_id = $1 OR u.downsell_offer_id = $1)
                  AND u.offer_id <> $1) AS referenced_by`,
      [id],
    );
    const orders = usage.rows[0]?.orders ?? 0;
    const grants = usage.rows[0]?.grants ?? 0;
    const referencedBy = usage.rows[0]?.referenced_by ?? 0;

    if (orders > 0 || grants > 0) {
      throw badRequest(
        `"${offer.title}" has ${orders} ${orders === 1 ? "order" : "orders"} against it and cannot be ` +
          `deleted — the sales reports are built on that link. Archive it instead: it stops selling and ` +
          `the history stays.`,
      );
    }
    if (referencedBy > 0) {
      throw badRequest(
        `"${offer.title}" is used as an upsell on ${referencedBy} other ` +
          `${referencedBy === 1 ? "offer" : "offers"}. Remove it from those upsell steps first.`,
      );
    }

    await pool.query(`DELETE FROM offers WHERE id = $1`, [id]);

    await recordAdminAction({
      req,
      action: "offer.delete",
      entityType: "offer",
      entityId: id,
      before: rowToCamel(offer),
    });

    res.status(204).end();
  }),
);

/* ----------------------------------------------------------------- products */

adminOffersRouter.get(
  "/:id/products",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await loadOffer(id);

    const result = await pool.query(
      `SELECT op.product_id, op.sort, p.slug, p.title, p.kind, p.status, p.thumbnail_url
         FROM offer_products op
         JOIN products p ON p.id = op.product_id
        WHERE op.offer_id = $1
        ORDER BY op.sort, p.title`,
      [id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminOffersRouter.post(
  "/:id/products",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = offerProductAttachSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { productId, sort } = parsed.data;

    await loadOffer(id);
    await assertProductExists(productId);

    const clash = await bumpedProductTitle(id, productId);
    if (clash) throw badRequest(doubleChargeMessage(clash));

    // Re-attaching is a reorder rather than an error: the editor sends the whole
    // row when a product is dragged, and the primary key would reject it.
    const result = await pool.query(
      `INSERT INTO offer_products (offer_id, product_id, sort)
       VALUES ($1, $2, $3)
       ON CONFLICT (offer_id, product_id) DO UPDATE SET sort = EXCLUDED.sort
       RETURNING offer_id, product_id, sort`,
      [id, productId, sort],
    );

    await recordAdminAction({
      req,
      action: "offer.product_attach",
      entityType: "offer",
      entityId: id,
      after: { productId, sort },
    });

    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminOffersRouter.delete(
  "/:id/products/:productId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const productId = parseId(req.params.productId, "product");
    const offer = await loadOffer(id);

    // Taking the last product off a live offer leaves the checkout open and
    // selling nothing, which is the same failure `publish` refuses to create.
    if (offer.status === "published" && (await attachedProductCount(id)) === 1) {
      throw badRequest(
        `"${offer.title}" is live, and this is the only product in it. Archive the offer first, or add ` +
          `its replacement before removing this one.`,
      );
    }

    const result = await pool.query(
      `DELETE FROM offer_products WHERE offer_id = $1 AND product_id = $2`,
      [id, productId],
    );
    if (result.rowCount === 0) throw notFound("That product is not part of this offer");

    await recordAdminAction({
      req,
      action: "offer.product_detach",
      entityType: "offer",
      entityId: id,
      before: { productId },
    });

    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------- bumps */

const BUMP_COLUMNS = `b.id, b.offer_id, b.product_id, b.title, b.description, b.amount_cents,
       b.sort, b.created_at, b.updated_at`;

type BumpRow = {
  id: number;
  offer_id: number;
  product_id: number;
  title: string;
  description: string;
  amount_cents: number;
  sort: number;
  created_at: string;
  updated_at: string;
};

adminOffersRouter.get(
  "/:id/bumps",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await loadOffer(id);

    const result = await pool.query(
      `SELECT ${BUMP_COLUMNS}, p.title AS product_title, p.kind AS product_kind
         FROM offer_bumps b
         JOIN products p ON p.id = b.product_id
        WHERE b.offer_id = $1
        ORDER BY b.sort, b.id`,
      [id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminOffersRouter.post(
  "/:id/bumps",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = bumpCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const data = parsed.data;

    await loadOffer(id);
    const product = await assertProductExists(data.productId);

    const clash = await grantedProductTitle(id, data.productId);
    if (clash) throw badRequest(doubleChargeMessage(clash));

    let created: BumpRow | undefined;
    try {
      const result = await pool.query<BumpRow>(
        `INSERT INTO offer_bumps AS b (offer_id, product_id, title, description, amount_cents, sort)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${BUMP_COLUMNS}`,
        [id, data.productId, data.title || product.title, data.description, data.amountCents, data.sort],
      );
      created = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw badRequest(`This offer already has an order bump for "${product.title}".`);
      }
      throw err;
    }

    if (!created) throw badRequest("Order bump could not be saved");
    const json = rowToCamel(created);

    await recordAdminAction({
      req,
      action: "offer.bump_create",
      entityType: "offer",
      entityId: id,
      after: json,
    });

    res.status(201).json(json);
  }),
);

adminOffersRouter.put(
  "/:id/bumps/:bumpId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const bumpId = parseId(req.params.bumpId, "order bump");
    const parsed = bumpUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const patch = parsed.data;

    // Constrained by offer as well as bump id, so a bump belonging to another
    // offer cannot be edited through this offer's URL.
    const existing = await pool.query<BumpRow>(
      `SELECT ${BUMP_COLUMNS} FROM offer_bumps b WHERE b.id = $1 AND b.offer_id = $2`,
      [bumpId, id],
    );
    const before = existing.rows[0];
    if (!before) throw notFound("Order bump not found");

    const productId = patched(patch.productId, before.product_id);
    if (productId !== before.product_id) {
      await assertProductExists(productId);
      const clash = await grantedProductTitle(id, productId);
      if (clash) throw badRequest(doubleChargeMessage(clash));
    }

    let after: BumpRow | undefined;
    try {
      const result = await pool.query<BumpRow>(
        `UPDATE offer_bumps AS b
            SET product_id   = $1,
                title        = $2,
                description  = $3,
                amount_cents = $4,
                sort         = $5,
                updated_at   = now()
          WHERE b.id = $6 AND b.offer_id = $7
         RETURNING ${BUMP_COLUMNS}`,
        [
          productId,
          patched(patch.title, before.title),
          patched(patch.description, before.description),
          patched(patch.amountCents, before.amount_cents),
          patched(patch.sort, before.sort),
          bumpId,
          id,
        ],
      );
      after = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw badRequest("This offer already has an order bump for that product.");
      }
      throw err;
    }

    if (!after) throw notFound("Order bump not found");
    const json = rowToCamel(after);

    await recordAdminAction({
      req,
      action: "offer.bump_update",
      entityType: "offer",
      entityId: id,
      before: rowToCamel(before),
      after: json,
    });

    res.json(json);
  }),
);

adminOffersRouter.delete(
  "/:id/bumps/:bumpId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const bumpId = parseId(req.params.bumpId, "order bump");

    const result = await pool.query<BumpRow>(
      `DELETE FROM offer_bumps AS b WHERE b.id = $1 AND b.offer_id = $2 RETURNING ${BUMP_COLUMNS}`,
      [bumpId, id],
    );
    const removed = result.rows[0];
    if (!removed) throw notFound("Order bump not found");

    await recordAdminAction({
      req,
      action: "offer.bump_delete",
      entityType: "offer",
      entityId: id,
      before: rowToCamel(removed),
    });

    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------ upsells */

const UPSELL_COLUMNS = `u.id, u.offer_id, u.step, u.upsell_offer_id, u.downsell_offer_id,
       u.headline, u.body, u.created_at, u.updated_at`;

type UpsellRow = {
  id: number;
  offer_id: number;
  step: number;
  upsell_offer_id: number;
  downsell_offer_id: number | null;
  headline: string;
  body: string;
  created_at: string;
  updated_at: string;
};

/**
 * A step that sells what the customer has just bought is not something the
 * database can catch on its own — `upsell_not_self` covers the upsell column and
 * nothing covers the downsell — and it charges twice for the same thing seconds
 * after checkout.
 */
async function assertUpsellTargets(
  offerId: number,
  upsellOfferId: number,
  downsellOfferId: number | null,
): Promise<void> {
  if (upsellOfferId === offerId) {
    throw issueError({
      field: "upsellOfferId",
      message: "An offer cannot be its own upsell — the customer has just bought it.",
    });
  }
  if (downsellOfferId !== null && downsellOfferId === offerId) {
    throw issueError({
      field: "downsellOfferId",
      message: "An offer cannot be its own downsell — the customer has just bought it.",
    });
  }
  if (downsellOfferId !== null && downsellOfferId === upsellOfferId) {
    throw issueError({
      field: "downsellOfferId",
      message: "The downsell is the same offer as the upsell, so declining would show the same price again.",
    });
  }

  const wanted = downsellOfferId === null ? [upsellOfferId] : [upsellOfferId, downsellOfferId];
  const found = await pool.query<{ id: number }>(`SELECT id FROM offers WHERE id = ANY($1::int[])`, [wanted]);
  const ids = new Set(found.rows.map((row) => row.id));
  if (!ids.has(upsellOfferId)) {
    throw issueError({ field: "upsellOfferId", message: "That upsell offer no longer exists." });
  }
  if (downsellOfferId !== null && !ids.has(downsellOfferId)) {
    throw issueError({ field: "downsellOfferId", message: "That downsell offer no longer exists." });
  }
}

adminOffersRouter.get(
  "/:id/upsells",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await loadOffer(id);

    const result = await pool.query(
      `SELECT ${UPSELL_COLUMNS},
              up.title AS upsell_offer_title, up.amount_cents AS upsell_amount_cents,
              down.title AS downsell_offer_title, down.amount_cents AS downsell_amount_cents
         FROM offer_upsells u
         JOIN offers up        ON up.id = u.upsell_offer_id
         LEFT JOIN offers down ON down.id = u.downsell_offer_id
        WHERE u.offer_id = $1
        ORDER BY u.step`,
      [id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminOffersRouter.post(
  "/:id/upsells",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = upsellCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const data = parsed.data;

    await loadOffer(id);
    await assertUpsellTargets(id, data.upsellOfferId, data.downsellOfferId);

    let created: UpsellRow | undefined;
    try {
      const result = await pool.query<UpsellRow>(
        `INSERT INTO offer_upsells AS u
           (offer_id, step, upsell_offer_id, downsell_offer_id, headline, body)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${UPSELL_COLUMNS}`,
        [id, data.step, data.upsellOfferId, data.downsellOfferId, data.headline, data.body],
      );
      created = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({
          field: "step",
          message: `This offer already has an upsell at step ${data.step}. Give this one a different step.`,
        });
      }
      throw err;
    }

    if (!created) throw badRequest("Upsell could not be saved");
    const json = rowToCamel(created);

    await recordAdminAction({
      req,
      action: "offer.upsell_create",
      entityType: "offer",
      entityId: id,
      after: json,
    });

    res.status(201).json(json);
  }),
);

adminOffersRouter.put(
  "/:id/upsells/:upsellId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const upsellId = parseId(req.params.upsellId, "upsell");
    const parsed = upsellUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const patch = parsed.data;

    const existing = await pool.query<UpsellRow>(
      `SELECT ${UPSELL_COLUMNS} FROM offer_upsells u WHERE u.id = $1 AND u.offer_id = $2`,
      [upsellId, id],
    );
    const before = existing.rows[0];
    if (!before) throw notFound("Upsell not found");

    const step = patched(patch.step, before.step);
    const upsellOfferId = patched(patch.upsellOfferId, before.upsell_offer_id);
    const downsellOfferId = patched(patch.downsellOfferId, before.downsell_offer_id);
    await assertUpsellTargets(id, upsellOfferId, downsellOfferId);

    let after: UpsellRow | undefined;
    try {
      const result = await pool.query<UpsellRow>(
        `UPDATE offer_upsells AS u
            SET step              = $1,
                upsell_offer_id   = $2,
                downsell_offer_id = $3,
                headline          = $4,
                body              = $5,
                updated_at        = now()
          WHERE u.id = $6 AND u.offer_id = $7
         RETURNING ${UPSELL_COLUMNS}`,
        [
          step,
          upsellOfferId,
          downsellOfferId,
          patched(patch.headline, before.headline),
          patched(patch.body, before.body),
          upsellId,
          id,
        ],
      );
      after = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({
          field: "step",
          message: `This offer already has an upsell at step ${step}. Give this one a different step.`,
        });
      }
      throw err;
    }

    if (!after) throw notFound("Upsell not found");
    const json = rowToCamel(after);

    await recordAdminAction({
      req,
      action: "offer.upsell_update",
      entityType: "offer",
      entityId: id,
      before: rowToCamel(before),
      after: json,
    });

    res.json(json);
  }),
);

adminOffersRouter.delete(
  "/:id/upsells/:upsellId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const upsellId = parseId(req.params.upsellId, "upsell");

    const result = await pool.query<UpsellRow>(
      `DELETE FROM offer_upsells AS u WHERE u.id = $1 AND u.offer_id = $2 RETURNING ${UPSELL_COLUMNS}`,
      [upsellId, id],
    );
    const removed = result.rows[0];
    if (!removed) throw notFound("Upsell not found");

    await recordAdminAction({
      req,
      action: "offer.upsell_delete",
      entityType: "offer",
      entityId: id,
      before: rowToCamel(removed),
    });

    res.status(204).end();
  }),
);

/* ----------------------------------------------------------- manual access */

interface ResolvedMember {
  id: number;
  email: string;
  created: boolean;
}

/**
 * Finds the member an action is addressed to.
 *
 * `createIfMissing` is set for a grant and not for a revoke. The person on the
 * other end of a manual grant usually bought somewhere else — at a conference,
 * over the phone, on the old Kajabi site — and has no account yet, so refusing
 * would mean leaving the screen to create one and coming back; the response says
 * plainly when a new account was made. A revoke has the opposite shape: an
 * address matching nobody means the admin mistyped it, and answering by creating
 * an empty account and taking nothing away from it would report success for work
 * that never happened.
 */
async function resolveMember(
  ref: { memberId?: number; email?: string },
  options: { createIfMissing: boolean },
): Promise<ResolvedMember> {
  if (ref.memberId !== undefined) {
    const found = await pool.query<{ id: number; email: string; status: string }>(
      `SELECT id, email, status FROM members WHERE id = $1`,
      [ref.memberId],
    );
    const row = found.rows[0];
    if (!row) throw notFound("Member not found");
    if (row.status === "deleted") throw badRequest("That account was deleted at the member's request.");
    return { id: row.id, email: row.email, created: false };
  }

  const email = ref.email;
  if (email === undefined) throw badRequest("Name the member by id or by email address.");

  // members.email is CITEXT, so this matches however the address was typed.
  const existing = await pool.query<{ id: number; email: string; status: string }>(
    `SELECT id, email, status FROM members WHERE email = $1`,
    [email],
  );
  const found = existing.rows[0];
  if (found) {
    if (found.status === "deleted") throw badRequest("That account was deleted at the member's request.");
    return { id: found.id, email: found.email, created: false };
  }

  if (!options.createIfMissing) throw notFound("Member not found");

  const created = await pool.query<{ id: number; email: string }>(
    `INSERT INTO members (email, status) VALUES ($1, 'active')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id, email`,
    [email],
  );
  const row = created.rows[0];
  if (!row) throw badRequest("That member could not be created");
  return { id: row.id, email: row.email, created: true };
}

/**
 * POST /admin/offers/:id/grant — hand someone an offer without a payment.
 *
 * Goes through `grantOfferAccess` rather than writing `access_grants` directly,
 * so a manual grant expands bundles and honours the offer's expiry exactly as a
 * purchase does. `source: 'manual'` is what keeps it out of revenue downstream.
 */
adminOffersRouter.post(
  "/:id/grant",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = offerGrantSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const offer = await loadOffer(id);

    const attached = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM offer_products WHERE offer_id = $1`,
      [id],
    );
    if ((attached.rows[0]?.count ?? 0) === 0) {
      throw badRequest(`"${offer.title}" does not include any products yet, so there is nothing to give.`);
    }

    const member = await resolveMember(parsed.data, { createIfMissing: true });
    const productIds = await grantOfferAccess({
      memberId: member.id,
      offerId: id,
      source: "manual",
    });

    await recordAdminAction({
      req,
      action: "offer.grant",
      entityType: "offer",
      entityId: id,
      after: {
        memberId: member.id,
        email: member.email,
        memberCreated: member.created,
        productIds,
        source: "manual",
      },
    });

    res.status(201).json({
      memberId: member.id,
      email: member.email,
      memberCreated: member.created,
      productIds,
      productCount: productIds.length,
    });
  }),
);

/**
 * POST /admin/offers/:id/revoke
 *
 * Revokes the grants this offer created and nothing else. A product the member
 * also owns through a second offer keeps its own grant — that is what
 * `revokeOfferAccess` implements, and the reason this does not revoke by product.
 */
adminOffersRouter.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = offerRevokeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { reason, ...ref } = parsed.data;

    await loadOffer(id);

    const member = await resolveMember(ref, { createIfMissing: false });
    const revokedCount = await revokeOfferAccess({
      memberId: member.id,
      offerId: id,
      reason: reason || "Revoked by an administrator",
    });

    await recordAdminAction({
      req,
      action: "offer.revoke",
      entityType: "offer",
      entityId: id,
      before: { memberId: member.id, email: member.email },
      after: { revokedCount, reason },
    });

    res.json({ memberId: member.id, email: member.email, revokedCount });
  }),
);
