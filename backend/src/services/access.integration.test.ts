import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import {
  createTestDatabase,
  hasTestDatabase,
  insertCourseProduct,
  insertMember,
  insertOffer,
} from "../testing/db";

/**
 * Integration tests for entitlement.
 *
 * `services/access.ts` is the only thing standing between a stranger and paid
 * content, and it is almost entirely SQL — the `ON CONFLICT` clause in
 * `grantAccess` encodes three separate rules about what a re-grant may and may
 * not do to existing access. None of that is observable without a database.
 *
 * Skipped when TEST_DATABASE_URL is unset so the default `npm test` needs
 * nothing running.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("access grants (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let access: typeof import("./access");

  beforeAll(async () => {
    db = await createTestDatabase("access");
    client = db.client;

    // The module reads DATABASE_URL at import time through config/env, so the
    // environment has to be pointed at the scratch database before it loads.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    access = await import("./access");
  }, 60_000);

  afterAll(async () => {
    // The module under test opened its own pool against the scratch database.
    // Dropping it first would force pg_terminate_backend to kill live
    // connections, which surfaces as an unhandled FATAL 57P01 after the suite
    // has already passed — a green run reported as an error.
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("grants every product an offer contains", async () => {
    const memberId = await insertMember(client, "grant-basic@test.invalid");
    const a = await insertCourseProduct(client, "basic-a");
    const b = await insertCourseProduct(client, "basic-b");
    const offerId = await insertOffer(client, "offer-basic", [a.productId, b.productId]);

    const granted = await access.grantOfferAccess({ memberId, offerId });

    expect(granted.sort()).toEqual([a.productId, b.productId].sort());
    expect(await access.hasProductAccess(memberId, a.productId)).toBe(true);
    expect(await access.hasCourseAccess(memberId, b.courseId)).toBe(true);
  });

  it("refuses a member with no grant", async () => {
    const memberId = await insertMember(client, "no-grant@test.invalid");
    const p = await insertCourseProduct(client, "unowned");

    expect(await access.hasProductAccess(memberId, p.productId)).toBe(false);
    expect(await access.hasCourseAccess(memberId, p.courseId)).toBe(false);
  });

  it("keeps one live grant when the same product is bought twice", async () => {
    // The figure that would break is "products owned": a duplicate row makes
    // every count and every library grid double up.
    const memberId = await insertMember(client, "double-buy@test.invalid");
    const p = await insertCourseProduct(client, "double");
    const offerId = await insertOffer(client, "offer-double", [p.productId]);

    await access.grantOfferAccess({ memberId, offerId });
    await access.grantOfferAccess({ memberId, offerId });

    const rows = await client.query(
      `SELECT count(*)::int AS n FROM access_grants WHERE member_id = $1 AND product_id = $2`,
      [memberId, p.productId]
    );
    expect(rows.rows[0].n).toBe(1);
    expect((await access.listMemberProducts(memberId)).length).toBe(1);
  });

  it("never shortens existing access on a re-grant", async () => {
    // Someone with lifetime access who is later handed a 30-day grant keeps
    // lifetime. Getting this backwards silently expires a paid-for course.
    const memberId = await insertMember(client, "lifetime@test.invalid");
    const p = await insertCourseProduct(client, "lifetime");
    const lifetime = await insertOffer(client, "offer-lifetime", [p.productId], {
      accessExpiresAfterDays: null,
    });
    const limited = await insertOffer(client, "offer-limited", [p.productId], {
      accessExpiresAfterDays: 30,
    });

    await access.grantOfferAccess({ memberId, offerId: lifetime });
    await access.grantOfferAccess({ memberId, offerId: limited });

    const row = await client.query(
      `SELECT expires_at FROM access_grants WHERE member_id = $1 AND product_id = $2`,
      [memberId, p.productId]
    );
    expect(row.rows[0].expires_at).toBeNull();
  });

  it("extends, rather than replaces, a shorter window", async () => {
    const memberId = await insertMember(client, "extend@test.invalid");
    const p = await insertCourseProduct(client, "extend");
    const short = await insertOffer(client, "offer-short", [p.productId], {
      accessExpiresAfterDays: 7,
    });
    const long = await insertOffer(client, "offer-long", [p.productId], {
      accessExpiresAfterDays: 365,
    });

    await access.grantOfferAccess({ memberId, offerId: short });
    const first = await client.query(
      `SELECT expires_at FROM access_grants WHERE member_id = $1`,
      [memberId]
    );

    await access.grantOfferAccess({ memberId, offerId: long });
    const second = await client.query(
      `SELECT expires_at FROM access_grants WHERE member_id = $1`,
      [memberId]
    );

    expect(new Date(second.rows[0].expires_at).getTime()).toBeGreaterThan(
      new Date(first.rows[0].expires_at).getTime()
    );
  });

  it("restores access when a revoked product is bought again", async () => {
    const memberId = await insertMember(client, "rebuy@test.invalid");
    const p = await insertCourseProduct(client, "rebuy");
    const offerId = await insertOffer(client, "offer-rebuy", [p.productId]);

    await access.grantOfferAccess({ memberId, offerId });
    await access.revokeAccess({ memberId, productId: p.productId, reason: "refunded" });
    expect(await access.hasProductAccess(memberId, p.productId)).toBe(false);

    await access.grantOfferAccess({ memberId, offerId });
    expect(await access.hasProductAccess(memberId, p.productId)).toBe(true);

    const row = await client.query(
      `SELECT revoked_at, revoke_reason FROM access_grants WHERE member_id = $1`,
      [memberId]
    );
    expect(row.rows[0].revoked_at).toBeNull();
    expect(row.rows[0].revoke_reason).toBe("");
  });

  it("expands a bundle one level", async () => {
    const memberId = await insertMember(client, "bundle@test.invalid");
    const inner1 = await insertCourseProduct(client, "inner-1");
    const inner2 = await insertCourseProduct(client, "inner-2");

    const bundle = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, status) VALUES ('the-bundle', 'Bundle', 'bundle', 'published') RETURNING id`
    );
    const bundleId = bundle.rows[0].id;
    for (const pid of [inner1.productId, inner2.productId]) {
      await client.query(
        `INSERT INTO product_bundle_items (bundle_product_id, product_id) VALUES ($1, $2)`,
        [bundleId, pid]
      );
    }

    const offerId = await insertOffer(client, "offer-bundle", [bundleId]);
    await access.grantOfferAccess({ memberId, offerId });

    expect(await access.hasProductAccess(memberId, inner1.productId)).toBe(true);
    expect(await access.hasProductAccess(memberId, inner2.productId)).toBe(true);
  });

  it("treats an expired grant as no access without waiting for a sweeper", async () => {
    // Correctness must not depend on a background job having run: access has to
    // lapse at the instant it should, not at the next sweep.
    const memberId = await insertMember(client, "expired@test.invalid");
    const p = await insertCourseProduct(client, "expired");

    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status, granted_at, expires_at)
       VALUES ($1, $2, 'active', now() - interval '40 days', now() - interval '1 hour')`,
      [memberId, p.productId]
    );

    expect(await access.hasProductAccess(memberId, p.productId)).toBe(false);
    expect(await access.listMemberProducts(memberId)).toHaveLength(0);

    const swept = await access.sweepExpiredGrants();
    expect(swept).toBeGreaterThanOrEqual(1);

    const row = await client.query(`SELECT status FROM access_grants WHERE member_id = $1`, [
      memberId,
    ]);
    expect(row.rows[0].status).toBe("expired");
  });

  it("does not leak one member's access to another", async () => {
    const owner = await insertMember(client, "owner@test.invalid");
    const stranger = await insertMember(client, "stranger@test.invalid");
    const p = await insertCourseProduct(client, "private");
    const offerId = await insertOffer(client, "offer-private", [p.productId]);

    await access.grantOfferAccess({ memberId: owner, offerId });

    expect(await access.hasProductAccess(owner, p.productId)).toBe(true);
    expect(await access.hasProductAccess(stranger, p.productId)).toBe(false);
    expect(await access.listMemberProducts(stranger)).toHaveLength(0);
  });

  it("hides an archived product from the library without revoking the grant", async () => {
    const memberId = await insertMember(client, "archived@test.invalid");
    const p = await insertCourseProduct(client, "archived");
    const offerId = await insertOffer(client, "offer-archived", [p.productId]);
    await access.grantOfferAccess({ memberId, offerId });

    await client.query(`UPDATE products SET status = 'archived' WHERE id = $1`, [p.productId]);

    expect(await access.listMemberProducts(memberId)).toHaveLength(0);
    // The entitlement itself survives, so un-archiving restores it rather than
    // requiring every buyer to be re-granted.
    expect(await access.hasProductAccess(memberId, p.productId)).toBe(true);
  });
});
