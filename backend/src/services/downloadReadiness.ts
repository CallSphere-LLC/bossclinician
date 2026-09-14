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
