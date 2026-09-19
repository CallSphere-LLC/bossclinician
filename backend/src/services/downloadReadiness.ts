import fs from "fs/promises";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { serviceUnavailable } from "../utils/httpError";
import { resolveStoredFile } from "./signedUrls";

type DB = Pick<PoolClient, "query">;

/** Check the same stored bytes that member delivery serves, including bundles.
 * File rows alone do not prove a download exists. Never manufacture an order
 * or contact for a purchase whose deliverable is missing. */
export async function assertProductsDeliverable(productIds: number[], db: DB = pool): Promise<void> {
  if (!productIds.length) return;
  const courses = await db.query<{ title: string }>(
    `WITH RECURSIVE included(id) AS (
       SELECT unnest($1::int[])
       UNION SELECT bi.product_id FROM product_bundle_items bi JOIN included i ON i.id=bi.bundle_product_id
     ) SELECT p.title FROM included i JOIN products p ON p.id=i.id
       WHERE p.kind='course' AND NOT EXISTS (
         SELECT 1 FROM course_modules m JOIN course_lessons l ON l.module_id=m.id
         WHERE m.course_id=p.course_id AND l.published=true
           AND (length(trim(l.body_md))>0 OR l.video_url<>'' OR l.audio_url<>'' OR l.attachment_url<>'' OR l.embed_html<>'')
       )`, [productIds],
  );
  if (courses.rows.length) throw serviceUnavailable(`Enrollment for ${courses.rows[0].title} will open when its course materials are ready.`);
  const { rows } = await db.query<{ title: string; paths: string[] }>(
    `WITH RECURSIVE included(id) AS (
       SELECT unnest($1::int[])
       UNION
       SELECT bi.product_id FROM product_bundle_items bi JOIN included i ON i.id=bi.bundle_product_id
     )
     SELECT p.title, COALESCE(array_agg(f.storage_path) FILTER (WHERE f.id IS NOT NULL), '{}') AS paths
     FROM included i JOIN products p ON p.id=i.id
     LEFT JOIN product_files f ON f.product_id=p.id
     WHERE p.kind='download' GROUP BY p.id ORDER BY p.id`,
    [productIds],
  );
  for (const product of rows) {
    let ready = product.paths.length > 0;
    for (const storagePath of product.paths) {
      const file = await resolveStoredFile(storagePath);
      const stat = file ? await fs.stat(file).catch(() => null) : null;
      if (!stat || stat.size <= 0) { ready = false; break; }
    }
    if (!ready) throw serviceUnavailable(`Checkout is unavailable for ${product.title} because its download files are missing. Please contact us for help.`);
  }
}

export async function assertOfferDeliverable(offerId: number, bumpProductIds: number[] = [], db: DB = pool): Promise<void> {
  const { rows } = await db.query<{ product_id: number }>(
    `SELECT product_id FROM offer_products WHERE offer_id=$1
     UNION SELECT product_id FROM offer_bumps WHERE offer_id=$1 AND product_id=ANY($2::int[])`,
    [offerId, bumpProductIds],
  );
  await assertProductsDeliverable(rows.map(row => row.product_id), db);
}
