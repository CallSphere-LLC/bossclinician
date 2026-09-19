import { pool } from "../db/pool";
import { assertOfferDeliverable } from "./downloadReadiness";
import { HttpError } from "../utils/httpError";

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
  const readiness = await Promise.all(offers.rows.map(async (offer) => {
    try {
      await assertOfferDeliverable(offer.id);
      return { available: true, unavailableReason: "" };
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) {
        return { available: false, unavailableReason: error.message };
      }
      throw error;
    }
  }));
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
  }));
}
