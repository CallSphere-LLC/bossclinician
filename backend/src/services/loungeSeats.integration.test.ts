import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

/**
 * Lounge founding places under real concurrency (Yvette, 22 Nov 2026, item 1):
 * two checkouts racing for the 20th place on two connections, and two payment
 * deliveries racing to count the same member. Needs TEST_DATABASE_URL
 * (scripts/test-integration.sh); skipped otherwise.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("lounge founding seats (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let seats: typeof import("./loungeSeats");
  let pool: typeof import("../db/pool").pool;
  let offerId = 0;

  async function order(email: string, status = "pending", totalCents = 19700): Promise<number> {
    const row = await db.client.query(
      `INSERT INTO orders (email, amount_cents, total_cents, currency, status, offer_id) VALUES ($1, $2, $2, 'usd', $3, $4) RETURNING id`,
      [email, totalCents, status, offerId]
    );
    return row.rows[0].id;
  }

  beforeAll(async () => {
    db = await createTestDatabase("lounge_seats");
    process.env.DATABASE_URL = db.url;
    const existing = await db.client.query(`SELECT id FROM offers WHERE slug = 'the-lounge'`);
    offerId = existing.rows[0]?.id
      ?? (await db.client.query(`INSERT INTO offers (title, slug, status) VALUES ('ZZ The Lounge', 'the-lounge', 'published') RETURNING id`)).rows[0].id;
    seats = await import("./loungeSeats");
    pool = (await import("../db/pool")).pool;
  }, 60000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("sells the last founding place once when two checkouts race for it", async () => {
    await db.client.query(`DELETE FROM lounge_seats WHERE tier = 'general'`);
    for (let i = 1; i <= 19; i++) {
      await db.client.query(
        `INSERT INTO lounge_seats (tier, email, phase, status, claimed_at, source) VALUES ('general', $1, 'founding', 'claimed', now(), 'test')`,
        [`zz-founding-${i}@example.com`]
      );
    }
    const a = await order("zz-race-a@example.com");
    const b = await order("zz-race-b@example.com");
    const results = await Promise.allSettled([
      seats.reserveLoungeSeat({ orderId: a, offerSlug: "the-lounge", pricePhase: "founding", email: "zz-race-a@example.com", signedIn: false }),
      seats.reserveLoungeSeat({ orderId: b, offerSlug: "the-lounge", pricePhase: "founding", email: "zz-race-b@example.com", signedIn: false }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409 });
    expect((await seats.tierStatus("general")).phase).toBe("standard");
  });

  it("counts a member once when two payment deliveries race", async () => {
    await db.client.query(`DELETE FROM lounge_seats WHERE tier = 'general'`);
    const first = await order("zz-twice@example.com", "paid");
    const second = await order("zz-twice@example.com", "paid");
    const claim = async (orderId: number) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await seats.claimLoungeSeatSafely(client, orderId);
        await client.query("COMMIT");
        return result;
      } finally {
        client.release();
      }
    };
    const results = await Promise.all([claim(first), claim(second)]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const rows = await db.client.query(`SELECT count(*)::int AS n FROM lounge_seats WHERE tier = 'general' AND status = 'claimed'`);
    expect(rows.rows[0].n).toBe(1);
  });

  it("does not give a founding place back when the member's access ends", async () => {
    await db.client.query(`DELETE FROM lounge_seats WHERE tier = 'general'`);
    for (let i = 1; i <= 20; i++) {
      await db.client.query(
        `INSERT INTO lounge_seats (tier, email, phase, status, claimed_at, source) VALUES ('general', $1, 'founding', 'claimed', now(), 'test')`,
        [`zz-gone-${i}@example.com`]
      );
    }
    // None of them has any access left: still 20 founding places used.
    expect(await seats.tierStatus("general")).toMatchObject({ phase: "standard", foundingRemaining: 0 });
  });
});
