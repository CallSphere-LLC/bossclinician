import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember } from "../testing/db";

/**
 * The Clients roster with Kajabi enrollments (migration 078).
 *
 * A Kajabi client must appear in the program they held on Kajabi, as active,
 * with no allowance ("0 of 6 used" would be a claim about sessions that
 * happened on Kajabi), and must disappear with the program when it's archived.
 * Somebody who also bought the same program here keeps the allowance.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("coaching roster with Kajabi enrollments (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let roster: typeof import("./coachingRoster");

  beforeAll(async () => {
    db = await createTestDatabase("coachingroster");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    roster = await import("./coachingRoster");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  async function contact(email: string, name: string): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO contacts (email, name) VALUES ($1, $2) RETURNING id`,
      [email, name],
    );
    return res.rows[0].id;
  }

  async function program(slug: string, sessionCount: number): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO coaching_offers (slug, title, session_count, kajabi_product)
       VALUES ($1, $1, $2, 'Kajabi ' || $1) RETURNING id`,
      [slug, sessionCount],
    );
    return res.rows[0].id;
  }

  it("the migration's data steps are a no-op on an empty database", async () => {
    const offers = await client.query(`SELECT slug FROM coaching_offers`);
    // The four programs are inserted (they don't depend on imported data)…
    expect(offers.rows.map((r) => r.slug)).toEqual(
      expect.arrayContaining([
        "boss-clinician-club",
        "boss-clinician-boardroom",
        "practice-reset-intensive",
        "scale-and-reclaim-suite",
      ]),
    );
    // …but with no Kajabi tags there is nobody to enroll.
    const enrolled = await client.query(`SELECT count(*)::int AS n FROM coaching_enrollments`);
    expect(enrolled.rows[0].n).toBe(0);
  });

  it("lists a Kajabi client in their program, active, with no allowance", async () => {
    const offerId = await program("kajabi-only", 6);
    const contactId = await contact("kajabi.client@test.invalid", "Kay Client");
    const memberId = await insertMember(client, "kajabi.client@test.invalid", { name: "Kay Client" });
    await client.query(`UPDATE members SET contact_id = $1 WHERE id = $2`, [contactId, memberId]);
    await client.query(
      `INSERT INTO coaching_enrollments (coaching_offer_id, contact_id, member_id, source, status, enrolled_at)
       VALUES ($1, $2, $3, 'kajabi', 'active', '2026-03-20T00:00:00Z')`,
      [offerId, contactId, memberId],
    );

    const clients = await roster.listCoachingRoster();
    const kay = clients.find((c) => c.contactId === contactId);
    expect(kay).toBeDefined();
    expect(kay!.name).toBe("Kay Client");
    expect(kay!.joinedAt).toBe("2026-03-20T00:00:00.000Z");
    expect(kay!.programs).toHaveLength(1);
    expect(kay!.programs[0]).toMatchObject({
      offerId,
      access: "active",
      source: "kajabi",
      sessionsIncluded: null,
      openEnded: false,
      sessionsUsed: 0,
    });
  });

  it("keeps the allowance when the same person also bought the program here", async () => {
    const offerId = await program("bought-here-too", 6);
    const contactId = await contact("both@test.invalid", "Bo Both");
    const memberId = await insertMember(client, "both@test.invalid", { name: "Bo Both" });
    await client.query(`UPDATE members SET contact_id = $1 WHERE id = $2`, [contactId, memberId]);
    await client.query(
      `INSERT INTO coaching_enrollments (coaching_offer_id, contact_id, member_id, source)
       VALUES ($1, $2, $3, 'kajabi')`,
      [offerId, contactId, memberId],
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, coaching_offer_id, status)
       VALUES ('bought-here-too-product', 'Bought here too', 'coaching', $1, 'published') RETURNING id`,
      [offerId],
    );
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status) VALUES ($1, $2, 'active')`,
      [memberId, product.rows[0].id],
    );

    const clients = await roster.listCoachingRoster();
    const bo = clients.find((c) => c.contactId === contactId);
    expect(bo!.programs).toHaveLength(1);
    expect(bo!.programs[0]).toMatchObject({ access: "active", source: "kajabi", sessionsIncluded: 6 });
  });

  it("drops enrollments in an archived program", async () => {
    const offerId = await program("archived-program", 1);
    const contactId = await contact("archived@test.invalid", "Arch Ived");
    await client.query(
      `INSERT INTO coaching_enrollments (coaching_offer_id, contact_id, source) VALUES ($1, $2, 'kajabi')`,
      [offerId, contactId],
    );
    expect((await roster.listCoachingRoster()).some((c) => c.contactId === contactId)).toBe(true);

    await client.query(`UPDATE coaching_offers SET archived_at = now() WHERE id = $1`, [offerId]);
    expect((await roster.listCoachingRoster()).some((c) => c.contactId === contactId)).toBe(false);
  });
});
