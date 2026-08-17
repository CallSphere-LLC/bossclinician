import { z } from "zod";
import type { BillingInterval, PricingType } from "../services/pricing";

/**
 * Shapes for the product and offer admin API.
 *
 * The migration already refuses a half-configured row — `products_resource_matches_kind`
 * and `offers_recurring_shape` are CHECK constraints. Repeating those rules here
 * is not belt-and-braces: a constraint violation reaches the admin as a 500 and a
 * sentence naming a Postgres constraint, and the person editing offers on this
 * site does not read SQL. Everything below exists so the same mistake comes back
 * as a 400 and a sentence that says what to change.
 *
 * The cross-field rules live in plain functions rather than only in `superRefine`
 * because an edit has to be validated against the row it *produces*, not the
 * handful of fields it carries. Create calls them through zod; update calls them
 * on the merged row.
 */

/* ------------------------------------------------------------- vocabularies */

export const PRODUCT_KINDS = [
  "course",
  "download",
  "community",
  "coaching",
  "podcast",
  "newsletter",
  "access_group",
  "bundle",
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** products.status and offers.status share the same three values. */
export const CATALOG_STATUSES = ["draft", "published", "archived"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const PRICING_TYPES = [
  "one_time",
  "subscription",
  "payment_plan",
  "free",
  "pwyw",
] as const satisfies readonly PricingType[];

export const BILLING_INTERVALS = ["day", "week", "month", "year"] as const satisfies readonly BillingInterval[];

/**
 * The currencies this site can price, charge and display in.
 *
 * A list rather than "any three letters", for two reasons. `Intl.NumberFormat`
 * refuses a code it does not recognise, and every figure on the sales page, the
 * quote and the receipt goes through it — so a typo in this box takes the
 * checkout down rather than showing a wrong symbol. And every entry here is a
 * two-decimal currency, because the arithmetic is in integer cents throughout:
 * a zero-decimal currency such as JPY would render a ¥2,700 charge as ¥27.
 *
 * Adding one is a single line here, plus a check that it divides by 100.
 */
export const SUPPORTED_CURRENCIES = ["usd", "cad", "gbp", "eur", "aud", "nzd"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value.trim().toLowerCase());
}

export const PRODUCT_RESOURCE_FIELDS = [
  "courseId",
  "communityId",
  "podcastId",
  "newsletterId",
  "coachingOfferId",
] as const;
export type ProductResourceField = (typeof PRODUCT_RESOURCE_FIELDS)[number];

/** Wording for messages an admin reads. Never a column name, never a table name. */
const KIND_LABEL: Record<ProductKind, string> = {
  course: "course",
  download: "download",
  community: "community",
  coaching: "coaching",
  podcast: "podcast",
  newsletter: "newsletter",
  access_group: "access group",
  bundle: "bundle",
};

export const PRODUCT_RESOURCE_LABEL: Record<ProductResourceField, string> = {
  courseId: "course",
  communityId: "community",
  podcastId: "podcast",
  newsletterId: "newsletter",
  coachingOfferId: "coaching package",
};

/** The kind -> resource pairing `products_resource_matches_kind` enforces. */
const RESOURCE_FIELD_BY_KIND: Partial<Record<ProductKind, ProductResourceField>> = {
  course: "courseId",
  community: "communityId",
  podcast: "podcastId",
  newsletter: "newsletterId",
  coaching: "coachingOfferId",
};

/** The resource a product of this kind must name, or null for the self-contained kinds. */
export function resourceFieldForKind(kind: ProductKind): ProductResourceField | null {
  return RESOURCE_FIELD_BY_KIND[kind] ?? null;
}

/* --------------------------------------------------------- cross-field rules */

/** One problem, addressed to the field the admin has to fix. */
export interface CommerceIssue {
  field: string;
  message: string;
}

export type ProductResources = Partial<Record<ProductResourceField, number | null>>;

/**
 * Whether a product's kind and its resource link agree.
 *
 * Stricter than the CHECK constraint in one direction: the database tolerates a
 * download that also carries a course_id, this does not. A stray link is read by
 * nothing and delivers nothing, so it survives as a product that looks connected
 * to a course in the editor and grants no access at the till.
 */
export function productResourceIssue(kind: ProductKind, resources: ProductResources): CommerceIssue | null {
  const required = resourceFieldForKind(kind);

  if (required && (resources[required] ?? null) === null) {
    return {
      field: required,
      message: `A ${KIND_LABEL[kind]} product has to name the ${PRODUCT_RESOURCE_LABEL[required]} it unlocks.`,
    };
  }

  for (const field of PRODUCT_RESOURCE_FIELDS) {
    if (field === required) continue;
    if ((resources[field] ?? null) === null) continue;
    return {
      field,
      message:
        `A ${KIND_LABEL[kind]} product cannot be linked to a ${PRODUCT_RESOURCE_LABEL[field]}. ` +
        `Remove that link, or change the product type.`,
    };
  }

  return null;
}

export interface OfferPricingShape {
  pricingType: PricingType;
  amountCents: number;
  minAmountCents: number;
  interval: BillingInterval | null;
  installmentCount: number | null;
  trialDays: number;
}

/**
 * Whether an offer can actually be charged.
 *
 * The zero-price rules are the additions worth having. A subscription at $0
 * passes every constraint in the migration and reads as something a person meant,
 * right up to the moment a customer takes the free checkout for a $1,997 product.
 */
export function offerPricingIssue(offer: OfferPricingShape): CommerceIssue | null {
  switch (offer.pricingType) {
    case "one_time":
      if (offer.amountCents <= 0) {
        return {
          field: "amountCents",
          message: "A one-time offer needs a price above zero. To give it away, set the pricing to Free.",
        };
      }
      return null;

    case "subscription":
      if (offer.interval === null) {
        return {
          field: "interval",
          message: "A subscription needs a billing interval — how often the customer is charged.",
        };
      }
      if (offer.amountCents <= 0) {
        return {
          field: "amountCents",
          message: "A subscription needs a price above zero. To give it away, set the pricing to Free.",
        };
      }
      return null;

    case "payment_plan":
      if (offer.installmentCount === null || offer.installmentCount < 2) {
        return {
          field: "installmentCount",
          message: "A payment plan needs at least 2 payments. For a single charge, use One-time pricing.",
        };
      }
      if (offer.interval === null) {
        return {
          field: "interval",
          message: "A payment plan needs an interval — how long between one payment and the next.",
        };
      }
      if (offer.amountCents <= 0) {
        return {
          field: "amountCents",
          message:
            "A payment plan needs a price above zero. This is the amount of ONE payment, not the total — " +
            "for 3 x $1,250, enter $1,250.",
        };
      }
      // A plan is a fixed number of payments for a fixed total. A free trial
      // delays the first one without adding a fourth, so "3 x $1,250" collects
      // $2,500 and the customer keeps everything.
      if (offer.trialDays > 0) {
        return {
          field: "trialDays",
          message:
            "A payment plan cannot have a free trial — the customer agreed to a set number of payments, " +
            "and a trial gives one of them away. Set the trial to 0 days, or sell this as a subscription.",
        };
      }
      return null;

    case "pwyw":
      if (offer.minAmountCents <= 0) {
        return {
          field: "minAmountCents",
          message: "A pay-what-you-want offer needs a minimum, or a customer can check out for nothing.",
        };
      }
      return null;

    case "free":
      if (offer.amountCents !== 0) {
        return { field: "amountCents", message: "A free offer has to have a price of zero." };
      }
      return null;

    default: {
      // Exhaustiveness: a pricing type added to the migration without a rule
      // here fails to compile rather than shipping unvalidated.
      const never: never = offer.pricingType;
      throw new RangeError(`Unsupported pricing type: ${String(never)}`);
    }
  }
}

/* ---------------------------------------------------------------- primitives */

export const idParamSchema = z.coerce.number().int().positive();

const idRef = z.number().int().positive();
const nullableIdRef = idRef.nullable();

/** Caps every money field an admin can type at $999,999.99. */
const moneyCents = z.number().int().min(0).max(99_999_999);

const sortOrder = z.number().int().min(-9999).max(9999);

const CURRENCY_CHOICES = SUPPORTED_CURRENCIES.map((code) => code.toUpperCase()).join(", ");

/** Stored lowercase, which is what Stripe expects and what the offer rows hold. */
const currencySchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value): value is SupportedCurrency => isSupportedCurrency(value),
    `Choose one of the currencies this site can charge in: ${CURRENCY_CHOICES}.`,
  );

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/,
    "Use lowercase letters, numbers and hyphens only — like fully-booked-toolkit.",
  );

/** An empty text box and a cleared link mean the same thing to a nullable column. */
const optionalRef = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value));

/* ------------------------------------------------------------------ products */

const productFields = {
  slug: slugSchema,
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(300).default(""),
  description: z.string().trim().max(10_000).default(""),
  thumbnailUrl: z.string().trim().max(2000).default(""),
  kind: z.enum(PRODUCT_KINDS),
  courseId: nullableIdRef.default(null),
  communityId: nullableIdRef.default(null),
  podcastId: nullableIdRef.default(null),
  newsletterId: nullableIdRef.default(null),
  coachingOfferId: nullableIdRef.default(null),
  status: z.enum(CATALOG_STATUSES).default("draft"),
  sort: sortOrder.default(0),
};

export const productCreateSchema = z.object(productFields).superRefine((value, ctx) => {
  const issue = productResourceIssue(value.kind, value);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.field], message: issue.message });
});

/** Every field optional: an absent key means "leave it alone", not "clear it". */
export const productUpdateSchema = z.object(productFields).partial();

export const productListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(PRODUCT_KINDS).optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
});

const productFileFields = {
  mediaId: nullableIdRef.default(null),
  title: z.string().trim().max(300).default(""),
  description: z.string().trim().max(2000).default(""),
  // Traversal is rejected where the path is stored rather than where it is used:
  // Phase 3 mints a signed URL from this value, and a path that climbs out of
  // the storage root would hand out whatever it lands on.
  storagePath: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine((value) => !value.split(/[\\/]/).includes(".."), "A file path cannot contain '..'.")
    .refine(
      (value) => !value.startsWith("/") && !/^[a-zA-Z]:/.test(value),
      "Use a path relative to the storage root.",
    ),
  filename: z.string().trim().max(300).default(""),
  mime: z.string().trim().max(200).default(""),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  sort: sortOrder.default(0),
};

export const productFileCreateSchema = z.object(productFileFields);
export const productFileUpdateSchema = z.object(productFileFields).partial();

export const bundleContentsSchema = z.object({
  items: z.array(z.object({ productId: idRef, sort: sortOrder.default(0) })).max(100),
});

/* -------------------------------------------------------------------- offers */

const customFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_]+$/, "A question key can use letters, numbers and underscores only."),
    label: z.string().trim().min(1).max(200),
    type: z.enum(["text", "textarea", "select", "checkbox", "number", "date"]),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().max(200)).max(50).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.type === "select" && value.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: `"${value.label}" is a dropdown, so it needs at least one choice.`,
      });
    }
  });

const offerFields = {
  title: z.string().trim().min(1).max(300),
  slug: slugSchema,
  status: z.enum(CATALOG_STATUSES).default("draft"),
  description: z.string().trim().max(10_000).default(""),
  checkoutHeadline: z.string().trim().max(300).default(""),
  thumbnailUrl: z.string().trim().max(2000).default(""),
  currency: currencySchema.default("usd"),

  pricingType: z.enum(PRICING_TYPES).default("one_time"),
  amountCents: moneyCents.default(0),
  minAmountCents: moneyCents.default(0),

  interval: z.enum(BILLING_INTERVALS).nullable().default(null),
  intervalCount: z.number().int().min(1).max(52).default(1),
  installmentCount: z.number().int().min(2).max(60).nullable().default(null),
  trialDays: z.number().int().min(0).max(365).default(0),

  collectTax: z.boolean().default(false),
  collectAddress: z.boolean().default(false),
  collectPhone: z.boolean().default(false),
  customFields: z.array(customFieldSchema).max(25).default([]),
  termsUrl: z.string().trim().max(2000).default(""),
  requireTerms: z.boolean().default(false),

  redirectUrl: z.string().trim().max(2000).default(""),
  thankYouPageId: optionalRef(200).default(null),
  accessExpiresAfterDays: z.number().int().min(1).max(36_500).nullable().default(null),

  stripePriceId: optionalRef(255).default(null),
  stripeProductId: optionalRef(255).default(null),
};

export const offerCreateSchema = z.object(offerFields).superRefine((value, ctx) => {
  const issue = offerPricingIssue(value);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.field], message: issue.message });
});

export const offerUpdateSchema = z.object(offerFields).partial();

export const offerListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
  pricingType: z.enum(PRICING_TYPES).optional(),
});

export const offerProductAttachSchema = z.object({
  productId: idRef,
  sort: sortOrder.default(0),
});

const bumpFields = {
  productId: idRef,
  title: z.string().trim().max(300).default(""),
  description: z.string().trim().max(2000).default(""),
  amountCents: moneyCents.default(0),
  sort: sortOrder.default(0),
};

export const bumpCreateSchema = z.object(bumpFields);
export const bumpUpdateSchema = z.object(bumpFields).partial();

const upsellFields = {
  step: z.number().int().min(1).max(20).default(1),
  upsellOfferId: idRef,
  downsellOfferId: nullableIdRef.default(null),
  headline: z.string().trim().max(300).default(""),
  body: z.string().trim().max(5000).default(""),
};

export const upsellCreateSchema = z.object(upsellFields);
export const upsellUpdateSchema = z.object(upsellFields).partial();

/* ------------------------------------------------------------ manual access */

const memberRefFields = {
  memberId: idRef.optional(),
  email: z.string().trim().email().max(320).optional(),
};

const HAS_MEMBER_REF = "Name the member by id or by email address.";

export const offerGrantSchema = z
  .object(memberRefFields)
  .refine((value) => value.memberId !== undefined || value.email !== undefined, { message: HAS_MEMBER_REF });

export const offerRevokeSchema = z
  .object({ ...memberRefFields, reason: z.string().trim().max(500).default("") })
  .refine((value) => value.memberId !== undefined || value.email !== undefined, { message: HAS_MEMBER_REF });
