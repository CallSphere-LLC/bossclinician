import { pool } from "../db/pool";
import { assertOfferDeliverable } from "./downloadReadiness";
import { HttpError } from "../utils/httpError";

export interface CourseAddon {
  offerId: number;
  title: string;
  description: string;
  href: string | null;
  available: boolean;
}

/**
 * Read-only promotions; the existing checkout still owns price, terms and fulfillment.
 * With a member, an offer they already hold everything in is left out: checkout only
 * warns about that and still takes the payment. Same product set as checkout's
 * "you already own this" (offerProductIds in routes/public/offers.ts).
 */
export async function loadCourseAddons(courseId: number, memberId?: number): Promise<CourseAddon[]> {
  const { rows } = await pool.query(
    `SELECT a.offer_id, a.description, o.title, o.slug
     FROM course_addons a JOIN offers o ON o.id=a.offer_id
     WHERE a.course_id=$1 AND o.status='published'
       AND EXISTS(SELECT 1 FROM offer_products op WHERE op.offer_id=o.id)
       AND NOT EXISTS(SELECT 1 FROM offer_products op JOIN products p ON p.id=op.product_id
         WHERE op.offer_id=o.id AND p.status<>'published')
       AND ($2::int IS NULL OR EXISTS(
         SELECT 1 FROM (
           SELECT op.product_id FROM offer_products op WHERE op.offer_id=o.id
           UNION
           SELECT bi.product_id FROM offer_products op
             JOIN product_bundle_items bi ON bi.bundle_product_id=op.product_id WHERE op.offer_id=o.id
         ) delivered
         WHERE NOT EXISTS(
           SELECT 1 FROM access_grants g JOIN products gp ON gp.id=g.product_id
           WHERE g.member_id=$2 AND g.product_id=delivered.product_id AND g.status='active'
             AND (g.expires_at IS NULL OR g.expires_at>now()) AND gp.status<>'archived')))
     ORDER BY a.sort,a.offer_id LIMIT 12`, [courseId, memberId ?? null],
  );
  return Promise.all(rows.map(async row => {
    let available = true;
    if (available) {
      try { await assertOfferDeliverable(row.offer_id); }
      catch (error) {
        if (!(error instanceof HttpError && error.status === 503)) throw error;
        available = false;
      }
    }
    return {
      offerId: row.offer_id, title: row.title, description: row.description,
      available, href: available ? `/checkout/${encodeURIComponent(row.slug)}` : null,
    };
  }));
}

/** Optional merchandising must not prevent an owner opening purchased lessons. */
export async function safeCourseAddons(courseId: number, memberId?: number): Promise<CourseAddon[]> {
  try { return await loadCourseAddons(courseId, memberId); }
  catch { console.error('[course-addons] Could not load optional offers for course', courseId); return []; }
}
