import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { assertOfferDeliverable } from "../../services/downloadReadiness";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { optionalMember } from "../../middleware/memberAuth";
import { listMemberProducts } from "../../services/access";
import { validateCoupon, type ValidatedCoupon } from "../../services/coupons";
import { formatAmount } from "../../utils/money";
import {
  computeOrderTotal,
  paymentPlanTotalCents,
  type BillingInterval,
  type OrderTotal,
  type PricedBump,
  type PricedOffer,
  type PricingType,
} from "../../services/pricing";

/**
 * The public face of an offer: what it costs, what it includes, and what the
 * order form has to ask for.
 *
 * Only `published` offers are readable here. A draft offer is a price Yvette is
 * still thinking about and an archived one is a price that was withdrawn;
 * neither may be quoted, and neither may be bought, so both are 404 rather than
 * 403 — confirming that a slug exists is itself a leak of the launch calendar.
 */
export const offersRouter = Router();

type Queryable = Pick<PoolClient, "query"> | typeof pool;

/** Roughly $1M. Above this a pay-what-you-want figure is a typo or an attack. */
export const MAX_PWYW_CENTS = 99_999_999;

export interface OfferRow {
  id: number;
  title: string;
  slug: string;
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
  allow_gifting: boolean;
  redirect_url: string;
  thank_you_page_id: string | null;
  access_expires_after_days: number | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  /** Present when the price was overlaid from an additional checkout option. */
  pricing_option_id?: number | null;
  pricing_label?: string;
}

const OFFER_COLUMNS = `id, title, slug, description, checkout_headline, thumbnail_url,
                       currency, pricing_type, amount_cents, min_amount_cents, interval,
                       interval_count, installment_count, trial_days, collect_tax,
                       collect_address, collect_phone, custom_fields, terms_url,
                       require_terms, allow_gifting, redirect_url, thank_you_page_id,
                       access_expires_after_days, stripe_price_id, stripe_product_id`;

/** Loads an offer by slug, or null. Never returns a draft or archived row. */
export async function loadPublishedOffer(
  slug: string,
  db: Queryable = pool
): Promise<OfferRow | null> {
  const res = await db.query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM offers WHERE slug = $1 AND status = 'published'`,
    [slug]
  );
  return res.rows[0] ?? null;
}

/** The same lookup by id, for following an `offer_upsells` row to its target. */
export async function loadPublishedOfferById(
  id: number,
  db: Queryable = pool
): Promise<OfferRow | null> {
  const res = await db.query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM offers WHERE id = $1 AND status = 'published'`,
    [id]
  );
  return res.rows[0] ?? null;
}

/** The subset of an offer the arithmetic needs, and the only prices it may use. */
export function toPricedOffer(offer: OfferRow): PricedOffer {
  return {
    id: offer.id,
    title: offer.title,
    currency: offer.currency || "usd",
    pricingType: offer.pricing_type,
    amountCents: offer.amount_cents,
    minAmountCents: offer.min_amount_cents,
    interval: offer.interval,
    intervalCount: offer.interval_count,
    installmentCount: offer.installment_count,
    trialDays: offer.trial_days,
  };
}

export interface OfferPricingOptionRow {
  id: number;
  offer_id: number;
  label: string;
  pricing_type: PricingType;
  amount_cents: number;
  min_amount_cents: number;
  currency: string;
  interval: BillingInterval | null;
  interval_count: number;
  installment_count: number | null;
  trial_days: number;
  recommended: boolean;
  active: boolean;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  sort: number;
}

const PRICING_OPTION_COLUMNS = `id, offer_id, label, pricing_type, amount_cents,
  min_amount_cents, currency, interval, interval_count, installment_count,
  trial_days, recommended, active, stripe_price_id, stripe_product_id, sort`;

export async function loadOfferPricingOptions(
  offerId: number,
  db: Queryable = pool,
): Promise<OfferPricingOptionRow[]> {
  const result = await db.query<OfferPricingOptionRow>(
    `SELECT ${PRICING_OPTION_COLUMNS}
       FROM offer_pricing_options
      WHERE offer_id = $1 AND active = true
      ORDER BY sort, id`,
    [offerId],
  );
  return result.rows;
}

function optionOverlay(offer: OfferRow, option: OfferPricingOptionRow): OfferRow {
  return {
    ...offer,
    pricing_type: option.pricing_type,
    amount_cents: option.amount_cents,
    min_amount_cents: option.min_amount_cents,
    currency: option.currency,
    interval: option.interval,
    interval_count: option.interval_count,
    installment_count: option.installment_count,
    trial_days: option.trial_days,
    stripe_price_id: option.stripe_price_id,
    stripe_product_id: option.stripe_product_id,
    pricing_option_id: option.id,
    pricing_label: option.label,
  };
}

/**
 * Resolves a shopper's choice from rows owned by this offer. `undefined` means
 * use the recommended option; `null` explicitly selects the original price.
 */
export async function selectOfferPricing(
  offer: OfferRow,
  pricingOptionId: number | null | undefined,
  db: Queryable = pool,
): Promise<OfferRow> {
  if (pricingOptionId === null) return { ...offer, pricing_option_id: null };
  const options = await loadOfferPricingOptions(offer.id, db);
  const option = pricingOptionId === undefined
    ? options.find((entry) => entry.recommended)
    : options.find((entry) => entry.id === pricingOptionId);
  if (pricingOptionId !== undefined && !option) throw badRequest("That payment option is no longer available.");
  return option ? optionOverlay(offer, option) : { ...offer, pricing_option_id: null };
}

function pricingLabel(offer: OfferRow): string {
  if (offer.pricing_type === "payment_plan") return "Payment plan";
  if (offer.pricing_type === "subscription") return "Subscription";
  if (offer.pricing_type === "free") return "Free";
  if (offer.pricing_type === "pwyw") return "Choose your price";
  return "Pay in full";
}

function pricingOptionJson(offer: OfferRow, id: number | null, label: string, recommended: boolean) {
  const priced = toPricedOffer(offer);
  return {
    id,
    label,
    recommended,
    currency: offer.currency || "usd",
    amountCents: offer.amount_cents,
    billing: billingToJson(offer, priced),
    quote: totalToJson(computeOrderTotal({ offer: priced })),
  };
}

export const isRecurring = (offer: OfferRow): boolean =>
  offer.pricing_type === "subscription" || offer.pricing_type === "payment_plan";

export interface BumpRow {
  id: number;
  product_id: number;
  title: string;
  description: string;
  amount_cents: number;
  product_slug: string;
  product_title: string;
  product_thumbnail_url: string;
  product_kind: string;
}

export async function loadOfferBumps(offerId: number, db: Queryable = pool): Promise<BumpRow[]> {
  const res = await db.query<BumpRow>(
    `SELECT b.id, b.product_id, b.title, b.description, b.amount_cents,
            p.slug AS product_slug, p.title AS product_title,
            p.thumbnail_url AS product_thumbnail_url, p.kind AS product_kind
       FROM offer_bumps b
       JOIN products p ON p.id = b.product_id
      WHERE b.offer_id = $1 AND p.status = 'published'
      ORDER BY b.sort, b.id`,
    [offerId]
  );
  return res.rows;
}

/**
 * The bumps the buyer actually ticked, priced from `offer_bumps`.
 *
 * The request contributes a set of product ids and nothing else. An id that is
 * not configured as a bump on this offer is dropped silently rather than
 * rejected: the only thing a client can do by sending one is fail to add it.
 */
export function selectBumps(bumps: BumpRow[], requestedProductIds: number[]): PricedBump[] {
  if (requestedProductIds.length === 0) return [];
  const wanted = new Set(requestedProductIds);
  return bumps
    .filter((b) => wanted.has(b.product_id))
    .map((b) => ({
      id: b.id,
      productId: b.product_id,
      title: b.title || b.product_title,
      amountCents: b.amount_cents,
    }));
}

export interface BillingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(32).optional(),
  country: z.string().trim().length(2).optional(),
});

const taxSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  defaultRateBps: z.number().int().min(0).max(10_000).default(0),
  rates: z
    .array(
      z.object({
        country: z.string().default(""),
        state: z.string().default(""),
        rateBps: z.number().int().min(0).max(10_000),
      })
    )
    .default([]),
});

/**
 * The address a request body is allowed to price with.
 *
 * `address` is optional on the checkout and quote bodies unless the offer asks
 * for one, and it is the last field a buyer can post that still moves the
 * total: naming a country with no rule configured drops the order to the
 * default rate, which on a site that taxes one region and not the rest is a
 * discount anybody can take. Where the offer does not collect an address there
 * is nothing to key a rate on, so the configured default stands and the body is
 * ignored. Where it does, the address is required, stored on the order and
 * written to `tax_records`, so the figure charged can be answered for later.
 *
 * An address the server already holds — the parent order's, on an upsell — is
 * not a submitted address and does not come through here.
 */
export function submittedTaxAddress(
  offer: OfferRow,
  submitted?: BillingAddress | null
): BillingAddress | null {
  return offer.collect_address ? (submitted ?? null) : null;
}

/**
 * The tax rate for an order, in basis points.
 *
 * Read from the `tax` settings row and keyed by where the buyer says they are.
 * The buyer supplies the place; the server decides what that place costs, so a
 * forged rate is not something the request can express.
 *
 * Recurring offers always come back 0: Stripe raises those invoices and any
 * figure computed here would be a number we showed but never charged.
 */
export async function resolveTaxRateBps(
  offer: OfferRow,
  address?: BillingAddress | null
): Promise<number> {
  if (!offer.collect_tax || isRecurring(offer)) return 0;

  const res = await pool.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'tax'`
  );
  const parsed = taxSettingsSchema.safeParse(res.rows[0]?.value);
  if (!parsed.success || !parsed.data.enabled) return 0;

  const country = (address?.country ?? "").trim().toUpperCase();
  const state = (address?.state ?? "").trim().toUpperCase();
  if (country === "") return parsed.data.defaultRateBps;

  const inCountry = parsed.data.rates.filter((r) => r.country.trim().toUpperCase() === country);

  // A state rule beats a country-wide one, which is why the specific match is
  // looked for first rather than taking whichever row happens to be listed.
  const exact =
    state === "" ? undefined : inCountry.find((r) => r.state.trim().toUpperCase() === state);
  if (exact) return exact.rateBps;

  const countryWide = inCountry.find((r) => r.state.trim() === "");
  return countryWide ? countryWide.rateBps : parsed.data.defaultRateBps;
}

export interface CustomFieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

const customFieldDefSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().max(200).default(""),
  type: z.string().max(40).default("text"),
  required: z.boolean().default(false),
  options: z.array(z.string().max(200)).default([]),
});

/** Order-form questions as configured, ignoring anything malformed in the JSONB. */
export function parseCustomFields(raw: unknown): CustomFieldDef[] {
  const parsed = z.array(customFieldDefSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

interface OfferProductRow {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnail_url: string;
  kind: string;
}

async function loadOfferProducts(offerId: number): Promise<OfferProductRow[]> {
  const res = await pool.query<OfferProductRow>(
    `SELECT p.id, p.slug, p.title, p.subtitle, p.description, p.thumbnail_url, p.kind
       FROM offer_products op
       JOIN products p ON p.id = op.product_id
      WHERE op.offer_id = $1 AND p.status <> 'archived'
      ORDER BY op.sort, p.id`,
    [offerId]
  );
  return res.rows;
}

/**
 * Every product this offer delivers, bundles expanded one level.
 *
 * Mirrors what `grantOfferAccess` will hand out, so "you already own this"
 * answers the same question the purchase would.
 */
async function offerProductIds(offerId: number): Promise<number[]> {
  const res = await pool.query<{ product_id: number }>(
    `SELECT DISTINCT op.product_id
       FROM offer_products op
      WHERE op.offer_id = $1
      UNION
     SELECT DISTINCT bi.product_id
       FROM offer_products op
       JOIN product_bundle_items bi ON bi.bundle_product_id = op.product_id
      WHERE op.offer_id = $1`,
    [offerId]
  );
  return res.rows.map((r) => r.product_id);
}

interface UpsellRow {
  step: number;
  headline: string;
  body: string;
  offer_slug: string;
  offer_title: string;
  offer_description: string;
  offer_thumbnail_url: string;
  offer_currency: string;
  offer_pricing_type: PricingType;
  offer_amount_cents: number;
  downsell_slug: string | null;
  downsell_title: string | null;
  downsell_amount_cents: number | null;
}

async function loadUpsells(offerId: number): Promise<UpsellRow[]> {
  const res = await pool.query<UpsellRow>(
    `SELECT u.step, u.headline, u.body,
            o.slug AS offer_slug, o.title AS offer_title, o.description AS offer_description,
            o.thumbnail_url AS offer_thumbnail_url, o.currency AS offer_currency,
            o.pricing_type AS offer_pricing_type, o.amount_cents AS offer_amount_cents,
            d.slug AS downsell_slug, d.title AS downsell_title,
            d.amount_cents AS downsell_amount_cents
       FROM offer_upsells u
       JOIN offers o ON o.id = u.upsell_offer_id AND o.status = 'published'
       LEFT JOIN offers d ON d.id = u.downsell_offer_id AND d.status = 'published'
      WHERE u.offer_id = $1
      ORDER BY u.step`,
    [offerId]
  );
  return res.rows;
}

/** The money half of any quote, shaped for JSON and pre-formatted for display. */
export function totalToJson(total: OrderTotal): Record<string, unknown> {
  return {
    lines: total.lines.map((l) => ({
      kind: l.kind,
      offerId: l.offerId ?? null,
      productId: l.productId ?? null,
      title: l.title,
      quantity: l.quantity,
      unitCents: l.unitCents,
      amountCents: l.amountCents,
    })),
    subtotalCents: total.subtotalCents,
    discountCents: total.discountCents,
    taxableCents: total.taxableCents,
    taxCents: total.taxCents,
    totalCents: total.totalCents,
    currency: total.currency,
    formatted: {
      subtotal: formatAmount(total.subtotalCents, total.currency),
      discount: formatAmount(total.discountCents, total.currency),
      tax: formatAmount(total.taxCents, total.currency),
      total: formatAmount(total.totalCents, total.currency),
    },
  };
}

/** The recurring shape of an offer, so the page can write "3 payments of $1,250". */
export function billingToJson(offer: OfferRow, priced: PricedOffer): Record<string, unknown> {
  return {
    pricingType: offer.pricing_type,
    interval: offer.interval,
    intervalCount: offer.interval_count,
    installmentCount: offer.installment_count,
    trialDays: offer.trial_days,
    installmentCents: offer.pricing_type === "payment_plan" ? offer.amount_cents : null,
    planTotalCents: offer.pricing_type === "payment_plan" ? paymentPlanTotalCents(priced) : null,
    minAmountCents: offer.pricing_type === "pwyw" ? offer.min_amount_cents : null,
  };
}

/**
 * GET /api/offers/:slug
 *
 * `optionalMember` rather than `requireMember`: this is a sales page, and the
 * only thing being signed in changes is that we can say "you already own this"
 * instead of selling it to somebody twice.
 */
offersRouter.get(
  "/offers/:slug",
  optionalMember,
  asyncHandler(async (req, res) => {
    const offer = await loadPublishedOffer(req.params.slug);
    if (!offer) throw notFound("Offer not found");
    await assertOfferDeliverable(offer.id);

    const [products, bumps, upsells, productIds, additionalPricing] = await Promise.all([
      loadOfferProducts(offer.id),
      loadOfferBumps(offer.id),
      loadUpsells(offer.id),
      offerProductIds(offer.id),
      loadOfferPricingOptions(offer.id),
    ]);
    const selectedOffer = await selectOfferPricing(offer, undefined);
    const priced = toPricedOffer(selectedOffer);
    const additionalRecommended = additionalPricing.some((option) => option.recommended);

    let alreadyOwned = false;
    if (req.member && productIds.length > 0) {
      const owned = new Set((await listMemberProducts(req.member.id)).map((p) => p.productId));
      alreadyOwned = productIds.every((id) => owned.has(id));
    }

    res.json({
      id: offer.id,
      slug: offer.slug,
      title: offer.title,
      description: offer.description,
      checkoutHeadline: offer.checkout_headline,
      thumbnailUrl: offer.thumbnail_url,
      currency: selectedOffer.currency || "usd",
      amountCents: selectedOffer.amount_cents,
      billing: billingToJson(selectedOffer, priced),
      selectedPricingOptionId: selectedOffer.pricing_option_id ?? null,
      pricingOptions: [
        pricingOptionJson(offer, null, pricingLabel(offer), !additionalRecommended),
        ...additionalPricing.map((option) => {
          const overlaid = optionOverlay(offer, option);
          return pricingOptionJson(overlaid, option.id, option.label || pricingLabel(overlaid), option.recommended);
        }),
      ],
      orderForm: {
        collectTax: offer.collect_tax,
        collectAddress: offer.collect_address,
        collectPhone: offer.collect_phone,
        requireTerms: offer.require_terms,
        allowGifting: offer.allow_gifting,
        termsUrl: offer.terms_url,
        customFields: parseCustomFields(offer.custom_fields),
      },
      redirectUrl: offer.redirect_url,
      thankYouPageSlug: offer.thank_you_page_id,
      accessExpiresAfterDays: offer.access_expires_after_days,
      products: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        subtitle: p.subtitle,
        description: p.description,
        thumbnailUrl: p.thumbnail_url,
        kind: p.kind,
      })),
      bumps: bumps.map((b) => ({
        id: b.id,
        productId: b.product_id,
        title: b.title || b.product_title,
        description: b.description,
        amountCents: b.amount_cents,
        formattedAmount: formatAmount(b.amount_cents, selectedOffer.currency),
        product: {
          slug: b.product_slug,
          title: b.product_title,
          thumbnailUrl: b.product_thumbnail_url,
          kind: b.product_kind,
        },
      })),
      upsells: upsells.map((u) => ({
        step: u.step,
        headline: u.headline,
        body: u.body,
        offer: {
          slug: u.offer_slug,
          title: u.offer_title,
          description: u.offer_description,
          thumbnailUrl: u.offer_thumbnail_url,
          currency: u.offer_currency,
          pricingType: u.offer_pricing_type,
          amountCents: u.offer_amount_cents,
        },
        downsell: u.downsell_slug
          ? {
              slug: u.downsell_slug,
              title: u.downsell_title,
              amountCents: u.downsell_amount_cents,
            }
          : null,
      })),
      quote: totalToJson(computeOrderTotal({ offer: priced })),
      alreadyOwned,
    });
  })
);

/**
 * Looser than the checkout limiter because it protects far less: a quote reads
 * three tables and touches no external service. It still has a ceiling, since
 * an uncapped coupon field is a code-guessing oracle with a progress bar.
 */
const quoteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const quoteSchema = z.object({
  pricingOptionId: z.number().int().positive().nullable().optional(),
  couponCode: z.string().trim().max(64).optional(),
  bumpProductIds: z.array(z.number().int().positive()).max(20).optional(),
  pwywAmountCents: z.number().int().min(0).max(MAX_PWYW_CENTS).optional(),
  address: addressSchema.optional(),
});

/**
 * POST /api/offers/:slug/quote
 *
 * Called on every coupon keystroke and bump toggle, so it is advisory by
 * design: a coupon that fails here comes back as `couponError` with a 200 and
 * the untouched total, rather than an error the form has to recover from.
 *
 * Nothing in the body sets a price. The request chooses among options the offer
 * already defines — which bumps, which code, how much above the pay-what-you-want
 * floor — and every figure is then read from `offers`, `offer_bumps` and
 * `coupons`. The quote is not remembered either: the charge recomputes it from
 * the same tables, so a stale or edited quote buys nothing.
 */
offersRouter.post(
  "/offers/:slug/quote",
  quoteLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    const parsed = quoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid quote request", parsed.error.flatten());
    const body = parsed.data;

    const baseOffer = await loadPublishedOffer(req.params.slug);
    if (!baseOffer) throw notFound("Offer not found");
    const offer = await selectOfferPricing(baseOffer, body.pricingOptionId);

    const priced = toPricedOffer(offer);
    const bumpRows = await loadOfferBumps(offer.id);
    const bumps = selectBumps(bumpRows, body.bumpProductIds ?? []);
    await assertOfferDeliverable(offer.id, body.bumpProductIds ?? []);

    let coupon: ValidatedCoupon | null = null;
    let couponError: string | null = null;
    if (body.couponCode) {
      // Only a signed-in member's own address is used for the once-per-customer
      // check. Honouring one from the body would turn this endpoint into a way
      // to ask whether a given stranger has redeemed a given code.
      const check = await validateCoupon(body.couponCode, offer.id, req.member?.email ?? null);
      if (check.ok) coupon = check.coupon;
      else couponError = check.reason;
    }

    const taxRateBps = await resolveTaxRateBps(offer, submittedTaxAddress(offer, body.address));
    const total = computeOrderTotal({
      offer: priced,
      bumps,
      coupon,
      taxRateBps,
      pwywAmountCents: body.pwywAmountCents,
    });

    res.json({
      offerSlug: offer.slug,
      selectedPricingOptionId: offer.pricing_option_id ?? null,
      billing: billingToJson(offer, priced),
      taxRateBps,
      appliedBumpProductIds: bumps.map((b) => b.productId),
      coupon: coupon
        ? {
            code: coupon.code,
            percentOff: coupon.percentOff,
            amountOffCents: coupon.amountOffCents,
            duration: coupon.duration,
          }
        : null,
      couponError,
      ...totalToJson(total),
    });
  })
);
