import { ApiError, getToken } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * Offers & catalogue client for the admin console.
 *
 * Two nouns, kept apart on purpose: a **product** is the thing access is granted
 * to, an **offer** is a price and a checkout page for one or more products. The
 * same course sold at full price, inside a bundle and on a payment plan is one
 * product and three offers — which is the whole reason this pair of screens
 * exists.
 *
 * Kept off `lib/api.ts` because that file is shared by every other screen in the
 * console; this one carries only the commerce shapes.
 *
 * Every amount on the wire is an integer of minor currency units. The owner
 * types dollars and reads dollars — `dollarsToCents` and `money` are the only
 * two places that conversion happens, so a cents integer can never reach her
 * screen and a rounded float can never reach the database.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

/* ── Requests ───────────────────────────────────────────────────────────── */

/**
 * A failure that also carries the server's per-field corrections.
 *
 * `lib/api.ts` throws the message away with the body; the offer editor needs it
 * kept, because "a payment plan needs at least 2 payments" belongs under the
 * box she has to fix and nowhere else. Extends ApiError so `friendlyError` and
 * every other `.status` reader keeps working unchanged.
 */
export class CommerceError extends ApiError {
  /** Field name → the one sentence to print under that field. */
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, status: number, fieldErrors: Record<string, string>) {
    super(message, status);
    this.name = "CommerceError";
    this.fieldErrors = fieldErrors;
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  details?: { fieldErrors?: Record<string, string[]> };
}

/** Zod's `flatten()` shape → one sentence per field. */
function firstPerField(fieldErrors: Record<string, string[]> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    const first = messages[0];
    if (first) out[field] = first;
  }
  return out;
}

async function commerceRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // A response with no JSON body still has a status, which is the part
      // `commerceMessage` actually reads.
    }
    throw new CommerceError(
      body.error ?? body.message ?? "",
      res.status,
      firstPerField(body.details?.fieldErrors),
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * The wording that goes in the toast.
 *
 * The refusals these endpoints send are already written for the owner — "this
 * offer already includes X, so an order bump for it would charge the customer
 * twice" is the sentence she needs, and no amount of translating up here can
 * reproduce it. What is not written for her is the generic parser complaint, so
 * anything starting "Invalid" falls back to the console's standard phrasing.
 */
export function commerceMessage(err: unknown, context: string): string {
  if (err instanceof CommerceError && err.status === 400) {
    const message = err.message.trim();
    if (message && !message.startsWith("Invalid")) return message;
  }
  return friendlyError(err, context);
}

/** Field corrections off a failed save, or an empty map for any other failure. */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  return err instanceof CommerceError ? err.fieldErrors : {};
}

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

export type ProductKind =
  | "course"
  | "download"
  | "community"
  | "coaching"
  | "podcast"
  | "newsletter"
  | "access_group"
  | "bundle";

export type CatalogStatus = "draft" | "published" | "archived";

export type PricingType = "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";

export type BillingInterval = "day" | "week" | "month" | "year";

export type CustomFieldType = "text" | "textarea" | "select" | "checkbox" | "number" | "date";

/* ── Products ───────────────────────────────────────────────────────────── */

interface ProductCore {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  kind: ProductKind;
  courseId: number | null;
  communityId: number | null;
  podcastId: number | null;
  newsletterId: number | null;
  coachingOfferId: number | null;
  status: CatalogStatus;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** A row in the catalogue list, with the three counts that make it useful. */
export interface Product extends ProductCore {
  /** How many offers sell this. */
  offerCount: number;
  fileCount: number;
  /** People holding live access right now. */
  memberCount: number;
}

/** size_bytes is a BIGINT, so it arrives as a string rather than losing digits. */
export interface ProductFile {
  id: number;
  productId: number;
  mediaId: number | null;
  title: string;
  description: string;
  storagePath: string;
  filename: string;
  mime: string;
  sizeBytes: string;
  downloadCount: number;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface BundleItem {
  productId: number;
  sort: number;
  slug: string;
  title: string;
  kind: ProductKind;
  status: CatalogStatus;
  thumbnailUrl?: string;
}

/** An offer that sells a given product, as shown on the product's own row. */
export interface ProductOfferRef {
  id: number;
  title: string;
  slug: string;
  status: CatalogStatus;
  pricingType: PricingType;
  amountCents: number;
  currency: string;
}

export interface ProductDetail extends ProductCore {
  files: ProductFile[];
  bundleItems: BundleItem[];
  offers: ProductOfferRef[];
}

export interface ProductInput {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  kind: ProductKind;
  courseId: number | null;
  communityId: number | null;
  podcastId: number | null;
  newsletterId: number | null;
  coachingOfferId: number | null;
  status: CatalogStatus;
  sort: number;
}

export interface ProductFileInput {
  mediaId: number | null;
  title: string;
  description: string;
  storagePath: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sort: number;
}

/* ── Offers ─────────────────────────────────────────────────────────────── */

/** An extra question on the order form. */
export interface OfferCustomField {
  /**
   * The stable name the answers are filed under. Generated from the label when
   * the question is created and never regenerated, so renaming a question does
   * not orphan the answers already collected.
   */
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options: string[];
}

/** A product this offer hands over, as embedded in the offer's own response. */
export interface OfferProductRef {
  id: number;
  slug: string;
  title: string;
  kind: ProductKind;
  status: CatalogStatus;
  thumbnailUrl: string;
  sort: number;
}

export interface OfferBump {
  id: number;
  offerId: number;
  productId: number;
  title: string;
  description: string;
  amountCents: number;
  sort: number;
  /** Present on the offer detail response, absent on a bump just written. */
  productTitle?: string;
  productKind?: ProductKind;
}

export interface OfferUpsell {
  id: number;
  offerId: number;
  step: number;
  upsellOfferId: number;
  downsellOfferId: number | null;
  headline: string;
  body: string;
  upsellOfferTitle?: string;
  downsellOfferTitle?: string | null;
}

export interface Offer {
  id: number;
  title: string;
  slug: string;
  status: CatalogStatus;
  description: string;
  checkoutHeadline: string;
  thumbnailUrl: string;
  currency: string;
  pricingType: PricingType;
  amountCents: number;
  minAmountCents: number;
  interval: BillingInterval | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
  collectTax: boolean;
  collectAddress: boolean;
  collectPhone: boolean;
  customFields: OfferCustomField[];
  termsUrl: string;
  requireTerms: boolean;
  redirectUrl: string;
  thankYouPageId: string | null;
  accessExpiresAfterDays: number | null;
  createdAt: string;
  updatedAt: string;
  /** Settled orders only — a started checkout is not a sale. */
  purchaseCount: number;
  products: OfferProductRef[];
}

export interface OfferDetail extends Offer {
  bumps: OfferBump[];
  upsells: OfferUpsell[];
}

export interface OfferInput {
  title: string;
  slug: string;
  status: CatalogStatus;
  description: string;
  checkoutHeadline: string;
  thumbnailUrl: string;
  pricingType: PricingType;
  amountCents: number;
  minAmountCents: number;
  interval: BillingInterval | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
  collectTax: boolean;
  collectAddress: boolean;
  collectPhone: boolean;
  customFields: OfferCustomField[];
  termsUrl: string;
  requireTerms: boolean;
  redirectUrl: string;
  thankYouPageId: string | null;
  accessExpiresAfterDays: number | null;
}

export interface BumpInput {
  productId: number;
  title: string;
  description: string;
  amountCents: number;
  sort: number;
}

export interface UpsellInput {
  step: number;
  upsellOfferId: number;
  downsellOfferId: number | null;
  headline: string;
  body: string;
}

/* ── Client ─────────────────────────────────────────────────────────────── */

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const adminCommerceApi = {
  /* offers */
  offerList: (params: { q?: string; status?: CatalogStatus } = {}) =>
    commerceRequest<Offer[]>(`/admin/offers${query(params)}`),
  offerGet: (id: number) => commerceRequest<OfferDetail>(`/admin/offers/${id}`),
  offerCreate: (input: OfferInput) =>
    commerceRequest<Offer>("/admin/offers", { method: "POST", body: JSON.stringify(input) }),
  offerUpdate: (id: number, patch: Partial<OfferInput>) =>
    commerceRequest<Offer>(`/admin/offers/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  offerDuplicate: (id: number) =>
    commerceRequest<Offer>(`/admin/offers/${id}/duplicate`, { method: "POST" }),
  offerPublish: (id: number) =>
    commerceRequest<Offer>(`/admin/offers/${id}/publish`, { method: "POST" }),
  offerArchive: (id: number) =>
    commerceRequest<Offer>(`/admin/offers/${id}/archive`, { method: "POST" }),

  offerProductAdd: (offerId: number, productId: number, sort: number) =>
    commerceRequest<{ offerId: number; productId: number; sort: number }>(
      `/admin/offers/${offerId}/products`,
      { method: "POST", body: JSON.stringify({ productId, sort }) },
    ),
  offerProductRemove: (offerId: number, productId: number) =>
    commerceRequest<void>(`/admin/offers/${offerId}/products/${productId}`, { method: "DELETE" }),

  bumpAdd: (offerId: number, input: BumpInput) =>
    commerceRequest<OfferBump>(`/admin/offers/${offerId}/bumps`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  bumpUpdate: (offerId: number, bumpId: number, patch: Partial<BumpInput>) =>
    commerceRequest<OfferBump>(`/admin/offers/${offerId}/bumps/${bumpId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  bumpRemove: (offerId: number, bumpId: number) =>
    commerceRequest<void>(`/admin/offers/${offerId}/bumps/${bumpId}`, { method: "DELETE" }),

  upsellAdd: (offerId: number, input: UpsellInput) =>
    commerceRequest<OfferUpsell>(`/admin/offers/${offerId}/upsells`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  upsellUpdate: (offerId: number, upsellId: number, patch: Partial<UpsellInput>) =>
    commerceRequest<OfferUpsell>(`/admin/offers/${offerId}/upsells/${upsellId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  upsellRemove: (offerId: number, upsellId: number) =>
    commerceRequest<void>(`/admin/offers/${offerId}/upsells/${upsellId}`, { method: "DELETE" }),

  /* catalogue */
  productList: (params: { q?: string; kind?: ProductKind; status?: CatalogStatus } = {}) =>
    commerceRequest<Product[]>(`/admin/products${query(params)}`),
  productGet: (id: number) => commerceRequest<ProductDetail>(`/admin/products/${id}`),
  productCreate: (input: ProductInput) =>
    commerceRequest<Product>("/admin/products", { method: "POST", body: JSON.stringify(input) }),
  productUpdate: (id: number, patch: Partial<ProductInput>) =>
    commerceRequest<Product>(`/admin/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  productRemove: (id: number) => commerceRequest<void>(`/admin/products/${id}`, { method: "DELETE" }),

  fileList: (productId: number) =>
    commerceRequest<ProductFile[]>(`/admin/products/${productId}/files`),
  fileAdd: (productId: number, input: ProductFileInput) =>
    commerceRequest<ProductFile>(`/admin/products/${productId}/files`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  fileUpdate: (productId: number, fileId: number, patch: Partial<ProductFileInput>) =>
    commerceRequest<ProductFile>(`/admin/products/${productId}/files/${fileId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  fileRemove: (productId: number, fileId: number) =>
    commerceRequest<void>(`/admin/products/${productId}/files/${fileId}`, { method: "DELETE" }),

  bundleSave: (productId: number, items: { productId: number; sort: number }[]) =>
    commerceRequest<{ productId: number; items: BundleItem[] }>(
      `/admin/products/${productId}/bundle`,
      { method: "PUT", body: JSON.stringify({ items }) },
    ),
};

/* ── Words for the things ───────────────────────────────────────────────── */

/**
 * What each kind of product is called on screen, and the one-liner that says
 * what it is. Nothing here is a stored value read back at her: `access_group`
 * is "Something else", because that is what it is to the person selling it.
 */
export const PRODUCT_KIND: Record<
  ProductKind,
  { one: string; many: string; blurb: string }
> = {
  course: { one: "Course", many: "Courses", blurb: "Lessons people work through." },
  download: { one: "Download", many: "Downloads", blurb: "Files people keep — a workbook, a template pack, a script." },
  community: { one: "Community", many: "Communities", blurb: "A group people join and post in." },
  coaching: { one: "Coaching", many: "Coaching", blurb: "Time with you, booked in sessions." },
  podcast: { one: "Podcast", many: "Podcasts", blurb: "A private show people subscribe to." },
  newsletter: { one: "Newsletter", many: "Newsletters", blurb: "Issues that arrive by email." },
  access_group: { one: "Something else", many: "Anything else", blurb: "Access you hand out yourself." },
  bundle: { one: "Bundle", many: "Bundles", blurb: "Several of the above, sold together." },
};

/** How a product's readiness reads. An offer uses `PUBLISH_LABEL` instead — a
 *  product is never "on your site"; the checkout page that sells it is. */
export const PRODUCT_STATUS_LABEL: Record<CatalogStatus, string> = {
  published: "Ready to sell",
  draft: "Not ready yet",
  archived: "Retired",
};

export const OFFER_STATUS_LABEL: Record<CatalogStatus, string> = {
  published: "Live",
  draft: "Draft",
  archived: "Archived",
};

/** The five ways she can charge, in the order she is asked to choose. */
export const PRICING_CHOICES: {
  value: PricingType;
  label: string;
  blurb: string;
}[] = [
  { value: "one_time", label: "One payment", blurb: "They pay once and it's theirs." },
  { value: "payment_plan", label: "A payment plan", blurb: "Split into a set number of payments, then it stops." },
  { value: "subscription", label: "A subscription", blurb: "They pay every month until they cancel." },
  { value: "free", label: "Free", blurb: "No card, no charge — a lead magnet or a gift." },
  { value: "pwyw", label: "Let them choose what to pay", blurb: "You set the least they can pay." },
];

/* ── Money in and money out ─────────────────────────────────────────────── */

/**
 * Cents → dollars, without the pointless ".00": 350000 → "$3,500".
 *
 * Lives here rather than in each screen so the list, the editor and the preview
 * sentence all spell a price the same way.
 */
export function money(cents: number, currency = "usd"): string {
  if (cents % 100 !== 0) return formatCurrency(cents, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * What she typed → cents, or null when it isn't a number.
 *
 * "1,250", "$1,250" and "1250.00" all mean the same thing. Null is a real
 * answer — an empty price box means she hasn't decided yet — and the caller
 * decides whether that is allowed.
 */
export function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Stored cents back into the box she types in: 125000 → "1250". */
export function centsToDollars(cents: number | null | undefined): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

const INTERVAL_NOUN: Record<BillingInterval, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

const INTERVAL_CADENCE: Record<BillingInterval, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

/** "a month" / "every 2 weeks" — the gap between charges, in a sentence. */
export function everyPhrase(interval: BillingInterval, count: number): string {
  const noun = INTERVAL_NOUN[interval];
  return count === 1 ? `a ${noun}` : `every ${count} ${noun}s`;
}

/** "2 more months" / "2 more payments" — what is left after today's charge. */
function remainingPhrase(interval: BillingInterval, intervalCount: number, remaining: number): string {
  if (intervalCount !== 1) {
    return remaining === 1 ? "one more payment" : `${remaining} more payments`;
  }
  const noun = INTERVAL_NOUN[interval];
  return remaining === 1 ? `one more ${noun}` : `${remaining} more ${noun}s`;
}

/** The subset of an offer any price wording needs. */
export type PriceShape = Pick<
  Offer,
  | "pricingType"
  | "amountCents"
  | "minAmountCents"
  | "interval"
  | "intervalCount"
  | "installmentCount"
  | "trialDays"
> & { currency?: string };

/**
 * The price as a customer would say it: "$3,500 one time", "3 monthly payments
 * of $1,250", "$97 a month".
 *
 * Deliberately short — it goes in a table cell. A half-finished draft says so
 * rather than inventing a figure, because "$0 one time" on the offers list is
 * how a free checkout for a $1,997 product gets published by accident.
 */
export function priceSummary(offer: PriceShape): string {
  const currency = offer.currency ?? "usd";
  switch (offer.pricingType) {
    case "free":
      return "Free";

    case "pwyw":
      return offer.minAmountCents > 0
        ? `Their choice, ${money(offer.minAmountCents, currency)} or more`
        : "Their choice — no minimum set";

    case "one_time":
      return offer.amountCents > 0 ? `${money(offer.amountCents, currency)} one time` : "No price set yet";

    case "subscription":
      if (offer.amountCents <= 0 || !offer.interval) return "No price set yet";
      return `${money(offer.amountCents, currency)} ${everyPhrase(offer.interval, offer.intervalCount)}`;

    case "payment_plan": {
      const count = offer.installmentCount;
      if (offer.amountCents <= 0 || !offer.interval || !count) return "No price set yet";
      const each = money(offer.amountCents, currency);
      if (offer.intervalCount === 1) {
        return `${count} ${INTERVAL_CADENCE[offer.interval]} payments of ${each}`;
      }
      return `${count} payments of ${each}, one ${everyPhrase(offer.interval, offer.intervalCount)}`;
    }
  }
}

/**
 * The full sentence under the price fields, so she can read back what she just
 * typed before anybody is charged for it.
 *
 * The plan total is multiplied here — the only place in the console that does
 * any money arithmetic. It has to be: she is typing $1,250 and 3, and no
 * server has been told about either yet. Nothing on this line is ever charged,
 * stored or receipted; every figure a customer or a receipt sees is computed
 * server-side from the saved offer.
 */
export function pricePreview(offer: PriceShape): string | null {
  const currency = offer.currency ?? "usd";
  switch (offer.pricingType) {
    case "free":
      return "Customers get this without paying anything — no card is asked for.";

    case "pwyw":
      if (offer.minAmountCents <= 0) return null;
      return `Customers decide what to pay, as long as it is at least ${money(offer.minAmountCents, currency)}.`;

    case "one_time":
      if (offer.amountCents <= 0) return null;
      return `Customers will pay ${money(offer.amountCents, currency)} once, today, and it's theirs.`;

    case "subscription": {
      if (offer.amountCents <= 0 || !offer.interval) return null;
      const rate = `${money(offer.amountCents, currency)} ${everyPhrase(offer.interval, offer.intervalCount)}`;
      if (offer.trialDays > 0) {
        return `Customers get ${offer.trialDays} days free, then pay ${rate} until they cancel.`;
      }
      return `Customers will pay ${rate} until they cancel.`;
    }

    case "payment_plan": {
      const count = offer.installmentCount;
      if (offer.amountCents <= 0 || !offer.interval || !count) return null;
      const each = money(offer.amountCents, currency);
      const total = money(offer.amountCents * count, currency);
      const rest = remainingPhrase(offer.interval, offer.intervalCount, count - 1);
      const cadence =
        offer.intervalCount === 1
          ? `${each} ${everyPhrase(offer.interval, 1)}`
          : `${each} ${everyPhrase(offer.interval, offer.intervalCount)}`;
      return `Customers will pay ${each} today, then ${cadence} for ${rest} — ${total} in total.`;
    }
  }
}
