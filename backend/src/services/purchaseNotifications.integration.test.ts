import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember, insertOffer } from "../testing/db";

/**
 * Purchase notices: one per grant that becomes active, linked to where the
 * product lives, never for imports, and the migration-130 backfill writing the
 * same row the live path would.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const MIGRATION_130 = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "130_purchase_notifications.sql"
);

describeDb("purchase notifications (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let access: typeof import("./access");

  beforeAll(async () => {
    db = await createTestDatabase("purchasenotice");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    access = await import("./access");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  async function insertDownload(slug: string, title: string): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, status) VALUES ($1, $2, 'download', 'published')
       RETURNING id`,
      [slug, title]
    );
    return res.rows[0].id;
  }

  async function notices(memberId: number) {
    const res = await client.query<{
      kind: string;
      title: string;
      body: string;
      link: string;
      access_grant_id: number | null;
      read_at: Date | null;
      emailed_at: Date | null;
    }>(
      `SELECT kind, title, body, link, access_grant_id, read_at, emailed_at
         FROM member_notifications WHERE member_id = $1 ORDER BY id`,
      [memberId]
    );
    return res.rows;
  }

  it("notifies once when a purchase grants a download, linking to its files", async () => {
    const memberId = await insertMember(client, "notice-download@test.invalid");
    const productId = await insertDownload("toolkit-a", "TOOLKIT A");
    const offerId = await insertOffer(client, "toolkit-a-offer", [productId]);
    await client.query(`UPDATE offers SET title = 'The Fully Booked Therapist Toolkit' WHERE id = $1`, [
      offerId,
    ]);

    await access.grantOfferAccess({ memberId, offerId, source: "purchase" });

    const rows = await notices(memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "purchase_access",
      title: "You now have access to The Fully Booked Therapist Toolkit",
      link: "/library?tab=documents&product=toolkit-a",
      read_at: null,
      emailed_at: null,
    });
    const grant = await client.query<{ id: number }>(
      `SELECT id FROM access_grants WHERE member_id = $1 AND product_id = $2`,
      [memberId, productId]
    );
    expect(rows[0].access_grant_id).toBe(grant.rows[0].id);

    // A retried webhook re-grants live access: no second notice.
    await access.grantOfferAccess({ memberId, offerId, source: "purchase" });
    expect(await notices(memberId)).toHaveLength(1);
  });

  it("notifies again when revoked access is restored, and uses the product title in a bundle", async () => {
    const memberId = await insertMember(client, "notice-bundle@test.invalid");
    const a = await insertDownload("bundle-file-a", "Workbook A");
    const b = await insertDownload("bundle-file-b", "Workbook B");
    const offerId = await insertOffer(client, "two-workbooks", [a, b]);

    await access.grantOfferAccess({ memberId, offerId, source: "manual" });
    let rows = await notices(memberId);
    expect(rows.map((r) => r.title).sort()).toEqual([
      "You now have access to Workbook A",
      "You now have access to Workbook B",
    ]);

    await client.query(
      `UPDATE access_grants SET status = 'revoked', revoked_at = now()
        WHERE member_id = $1 AND product_id = $2`,
      [memberId, a]
    );
    await access.grantAccess({ memberId, productId: a, source: "manual" });
    rows = await notices(memberId);
    expect(rows).toHaveLength(3);
  });

  it("stays quiet for bulk imports", async () => {
    const memberId = await insertMember(client, "notice-import@test.invalid");
    const productId = await insertDownload("imported-file", "Imported");
    await access.grantAccess({ memberId, productId, source: "import" });
    expect(await notices(memberId)).toHaveLength(0);
  });

  it("backfills paid purchases exactly as the live path writes them, once", async () => {
    const live = await insertMember(client, "notice-live@test.invalid");
    const past = await insertMember(client, "notice-past@test.invalid");
    const productId = await insertDownload("backfill-file", "BACKFILL FILE");
    const offerId = await insertOffer(client, "backfill-offer", [productId]);

    await access.grantOfferAccess({ memberId: live, offerId, source: "purchase" });

    // A purchase from before the notices existed: a paid order and a grant
    // written straight to the table, with no notice.
    const order = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, member_id, email, status, total_cents, amount_cents, subtotal_cents)
       VALUES ($1, $2, 'notice-past@test.invalid', 'paid', 670, 670, 670) RETURNING id`,
      [offerId, past]
    );
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, order_id, source, status, granted_at)
       VALUES ($1, $2, $3, $4, 'purchase', 'active', now() - interval '2 days')`,
      [past, productId, offerId, order.rows[0].id]
    );
    // And one too old to backfill.
    const old = await insertMember(client, "notice-old@test.invalid");
    const oldOrder = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, member_id, email, status) VALUES ($1, $2, 'o@test.invalid', 'paid')
       RETURNING id`,
      [offerId, old]
    );
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, order_id, source, status, granted_at)
       VALUES ($1, $2, $3, $4, 'purchase', 'active', now() - interval '45 days')`,
      [old, productId, offerId, oldOrder.rows[0].id]
    );

    const sql = fs.readFileSync(MIGRATION_130, "utf8");
    await client.query(sql);
    await client.query(sql);

    const [liveRow] = await notices(live);
    const pastRows = await notices(past);
    expect(pastRows).toHaveLength(1);
    expect(pastRows[0]).toMatchObject({
      kind: liveRow.kind,
      title: liveRow.title,
      body: liveRow.body,
      link: liveRow.link,
    });
    expect(await notices(old)).toHaveLength(0);
    // The live member's grant already had its notice; the backfill left it alone.
    expect(await notices(live)).toHaveLength(1);
  });
});
