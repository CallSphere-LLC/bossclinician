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

/** Read-only promotions; the existing checkout still owns price, terms and fulfillment. */
export async function loadCourseAddons(courseId: number): Promise<CourseAddon[]> {
  const { rows } = await pool.query(
    `SELECT a.offer_id, a.description, o.title, o.slug
     FROM course_addons a JOIN offers o ON o.id=a.offer_id
     WHERE a.course_id=$1 AND o.status='published'
       AND EXISTS(SELECT 1 FROM offer_products op WHERE op.offer_id=o.id)
       AND NOT EXISTS(SELECT 1 FROM offer_products op JOIN products p ON p.id=op.product_id
         WHERE op.offer_id=o.id AND p.status<>'published')
     ORDER BY a.sort,a.offer_id LIMIT 12`, [courseId],
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
export async function safeCourseAddons(courseId: number): Promise<CourseAddon[]> {
  try { return await loadCourseAddons(courseId); }
  catch { console.error('[course-addons] Could not load optional offers for course', courseId); return []; }
}
