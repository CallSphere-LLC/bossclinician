import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember, insertOffer } from "../../testing/db";

/**
 * Integration tests for the coaching ledger.
 *
 * `coaching_credits` is money already taken: a row that fails to appear is six
 * sessions somebody paid for and cannot book, and a row that appears twice is
 * six sessions nobody paid for. Both outcomes are a matter of which rows exist
 * at the moment the dashboard is opened, so both need a database and the real
 * route.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

interface PackageJson {
  creditId: number;
  offerSlug: string | null;
  sessionsTotal: number | null;
  sessionsUsed: number;
  sessionsRemaining: number | null;
  canBook: boolean;
}

describeDb("coaching credits (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let access: typeof import("../../services/access");
  let signMemberAccessToken: typeof import("../../auth/memberSession").signMemberAccessToken;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("coachingcredits");
    client = db.client;

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberCoachingRouter } = await import("./coaching");
    const { errorHandler } = await import("../../middleware/errorHandler");
    access = await import("../../services/access");
    signMemberAccessToken = (await import("../../auth/memberSession")).signMemberAccessToken;

    const app = express();
    app.use(express.json());
    app.use("/api/member/coaching", requireMember, memberCoachingRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  /* ------------------------------------------------------------- fixtures */

  let seq = 0;
  const unique = (prefix: string): string => `${prefix}-${(seq += 1)}`;

  async function newMember(): Promise<{ id: number; email: string; token: string }> {
    const email = `${unique("coachee")}@test.invalid`;
    const id = await insertMember(client, email);
    return { id, email, token: signMemberAccessToken({ sub: id, email }) };
  }

  /** A six-session package, sold as a product the way a coaching offer is. */
  async function sellPackage(): Promise<{ productId: number; offerId: number }> {
    const slug = unique("package");
    const coaching = await client.query<{ id: number }>(
      `INSERT INTO coaching_offers (slug, title, session_count, duration_minutes, published)
       VALUES ($1, $2, 6, 60, true) RETURNING id`,
      [slug, `Package ${slug}`]
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, coaching_offer_id, status)
       VALUES ($1, $2, 'coaching', $3, 'published') RETURNING id`,
      [`p-${slug}`, `Product ${slug}`, coaching.rows[0].id]
    );
    const productId = product.rows[0].id;
    return { productId, offerId: await insertOffer(client, unique("offer"), [productId]) };
  }

  /** A paid order for that offer — one purchase, the way fulfilment records it. */
  async function buy(member: { id: number; email: string }, offerId: number): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, member_id, email, status, total_cents, amount_cents,
                           subtotal_cents, currency, stripe_session_id)
       VALUES ($1, $2, $3, 'paid', 120000, 120000, 120000, 'usd', $4)
       RETURNING id`,
      [offerId, member.id, member.email, unique("cs_test")]
    );
    const orderId = res.rows[0].id;
    await access.grantOfferAccess({ memberId: member.id, offerId, orderId });
    return orderId;
  }

  async function packages(token: string): Promise<PackageJson[]> {
    const res = await fetch(`${baseUrl}/api/member/coaching`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packages: PackageJson[] };
    return body.packages;
  }

  async function creditRows(memberId: number): Promise<number> {
    const res = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM coaching_credits WHERE member_id = $1`,
      [memberId]
    );
    return res.rows[0].n;
  }

  /* ---------------------------------------------------------------- tests */

  it("delivers the sessions a purchase paid for", async () => {
    const member = await newMember();
    const { offerId } = await sellPackage();
    await buy(member, offerId);

    const held = await packages(member.token);
    expect(held).toHaveLength(1);
    expect(held[0].sessionsTotal).toBe(6);
    expect(held[0].sessionsRemaining).toBe(6);
    expect(held[0].canBook).toBe(true);
  });

  it("delivers a second package when the same one is bought again", async () => {
    const member = await newMember();
    const { productId, offerId } = await sellPackage();
    await buy(member, offerId);
    await packages(member.token);

    // Every session spent, which is the state somebody is in when they re-buy.
    await client.query(
      `UPDATE coaching_credits SET sessions_used = sessions_total WHERE member_id = $1`,
      [member.id]
    );
    await buy(member, offerId);

    const held = await packages(member.token);
    expect(held).toHaveLength(2);
    expect(held.filter((row) => row.canBook)).toHaveLength(1);
    expect(held.find((row) => row.canBook)?.sessionsRemaining).toBe(6);

    const grants = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM access_grants WHERE member_id = $1 AND product_id = $2`,
      [member.id, productId]
    );
    expect(grants.rows[0].n).toBe(1);
  });

  it("credits one order once, however many times the dashboard is opened", async () => {
    const member = await newMember();
    const { offerId } = await sellPackage();
    await buy(member, offerId);

    await packages(member.token);
    await packages(member.token);
    await Promise.all([packages(member.token), packages(member.token)]);

    expect(await creditRows(member.id)).toBe(1);
  });

  it("gives one package for a grant with no purchase behind it", async () => {
    // A manual grant from the admin, an automation or an import: entitlement
    // with no order to key on, which must still be worth exactly one package.
    const member = await newMember();
    const { productId, offerId } = await sellPackage();
    await access.grantOfferAccess({ memberId: member.id, offerId });

    expect(await packages(member.token)).toHaveLength(1);
    expect(await creditRows(member.id)).toBe(1);

    // And a purchase afterwards adds its own, rather than doubling that one.
    await buy(member, offerId);
    expect(await packages(member.token)).toHaveLength(2);

    const orderKeyed = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM coaching_credits
        WHERE member_id = $1 AND product_id = $2 AND order_id IS NOT NULL`,
      [member.id, productId]
    );
    expect(orderKeyed.rows[0].n).toBe(1);
  });

  it("delivers a manual grant even when an abandoned checkout came first", async () => {
    const member = await newMember();
    const { offerId } = await sellPackage();
    await client.query(
      `INSERT INTO orders (offer_id, member_id, email, status, total_cents, amount_cents,
                           subtotal_cents, currency, stripe_session_id)
       VALUES ($1, $2, $3, 'pending', 120000, 120000, 120000, 'usd', $4)`,
      [offerId, member.id, member.email, unique("cs_test")]
    );
    await access.grantOfferAccess({ memberId: member.id, offerId });

    const held = await packages(member.token);
    expect(held).toHaveLength(1);
    expect(held[0].sessionsRemaining).toBe(6);
  });

  it("hands out nothing extra when access is restored after a refund", async () => {
    // The admin putting somebody back where they were is not a seventh session.
    const member = await newMember();
    const { productId, offerId } = await sellPackage();
    const orderId = await buy(member, offerId);
    await packages(member.token);

    await client.query(`UPDATE orders SET status = 'refunded' WHERE id = $1`, [orderId]);
    await access.revokeAccess({ memberId: member.id, productId, reason: "refunded" });
    expect(await packages(member.token)).toHaveLength(1);

    await access.grantOfferAccess({ memberId: member.id, offerId });

    expect(await packages(member.token)).toHaveLength(1);
    expect(await creditRows(member.id)).toBe(1);
  });

  it("writes nothing to the ledger while an admin is viewing as a member", async () => {
    const member = await newMember();
    const { offerId } = await sellPackage();
    await buy(member, offerId);

    const viewing = signMemberAccessToken({
      sub: member.id,
      email: member.email,
      impersonatedBy: 1,
    });
    expect(await packages(viewing)).toHaveLength(0);
    expect(await creditRows(member.id)).toBe(0);

    // The member's own visit still creates it.
    expect(await packages(member.token)).toHaveLength(1);
  });

  it("delivers a package bought inside a bundle", async () => {
    const member = await newMember();
    const { productId } = await sellPackage();

    const bundle = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, status)
       VALUES ($1, 'Everything', 'bundle', 'published') RETURNING id`,
      [unique("bundle")]
    );
    await client.query(
      `INSERT INTO product_bundle_items (bundle_product_id, product_id) VALUES ($1, $2)`,
      [bundle.rows[0].id, productId]
    );
    const offerId = await insertOffer(client, unique("offer"), [bundle.rows[0].id]);
    await buy(member, offerId);

    const held = await packages(member.token);
    expect(held).toHaveLength(1);
    expect(held[0].sessionsRemaining).toBe(6);
  });
});
