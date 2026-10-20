import { pool } from "../db/pool";
import { assertOfferDeliverable } from "./downloadReadiness";
import { HttpError } from "../utils/httpError";

/** One extra way to pay for an offer, as a sales page quotes it on a button. */
export interface PublicCoursePricingOption {
  id: number;
  label: string;
  recommended: boolean;
  pricingType: string;
  amountCents: number;
  currency: string;
  interval: string | null;
  intervalCount: number;
  installmentCount: number | null;
}

/**
 * The active extra pricing options of each offer — the same rows, in the same
 * order, that `GET /offers/:slug` lists at checkout. A long-form course sales
 * page prints one button per option ("Training + CE Credit", "Educational
 * Access") linking to `/checkout/<offer>?option=<id>`; reading them here keeps
 * those buttons in the server render rather than swapping in after hydration,
 * and keeps option ids out of page code.
 */
async function loadPricingOptions(offerIds: number[]): Promise<Map<number, PublicCoursePricingOption[]>> {
  const byOffer = new Map<number, PublicCoursePricingOption[]>();
  if (offerIds.length === 0) return byOffer;
  const result = await pool.query(
    `SELECT offer_id, id, label, recommended, pricing_type, amount_cents, currency,
            interval, interval_count, installment_count
       FROM offer_pricing_options
      WHERE offer_id = ANY($1::int[]) AND active = true
      ORDER BY sort, id`,
    [offerIds],
  );
  for (const row of result.rows) {
    const list = byOffer.get(row.offer_id) ?? [];
    list.push({
      id: row.id,
      label: row.label,
      recommended: row.recommended,
      pricingType: row.pricing_type,
      amountCents: row.amount_cents,
      currency: row.currency,
      interval: row.interval,
      intervalCount: row.interval_count,
      installmentCount: row.installment_count,
    });
    byOffer.set(row.offer_id, list);
  }
  return byOffer;
}

/** One offer/readiness contract for direct SSR loads and client navigation. */
export async function loadPublicCourseOffers(courseId: number) {
  const offers = await pool.query(
    `SELECT DISTINCT o.id, o.slug, o.title, o.pricing_type, o.amount_cents, o.currency,
                     o.interval, o.interval_count, o.installment_count, o.checkout_headline
       FROM offers o
       JOIN offer_products op ON op.offer_id = o.id
       JOIN products p ON p.id = op.product_id
      WHERE COALESCE(p.course_id, p.legacy_course_id) = $1 AND o.status = 'published'
      ORDER BY o.amount_cents`,
    [courseId],
  );
  const [readiness, pricingOptions] = await Promise.all([
    Promise.all(offers.rows.map(async (offer) => {
      try {
        await assertOfferDeliverable(offer.id);
        return { available: true, unavailableReason: "" };
      } catch (error) {
        if (error instanceof HttpError && error.status === 503) {
          return { available: false, unavailableReason: error.message };
        }
        throw error;
      }
    })),
    loadPricingOptions(offers.rows.map((offer) => offer.id)),
  ]);
  return offers.rows.map((offer, index) => ({
    ...readiness[index],
    slug: offer.slug,
    title: offer.title,
    pricingType: offer.pricing_type,
    amountCents: offer.amount_cents,
    currency: offer.currency,
    interval: offer.interval,
    intervalCount: offer.interval_count,
    installmentCount: offer.installment_count,
    checkoutHeadline: offer.checkout_headline,
    pricingOptions: pricingOptions.get(offer.id) ?? [],
  }));
}
