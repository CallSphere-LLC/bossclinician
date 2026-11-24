import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

/**
 * Migration 222 (Yvette 22 Nov 2026, item 3) against a real Postgres:
 * refunds never give a founding place back, VIP capacity is tracked apart
 * from the cumulative founding count, LOUNGE26 / internal orders never count,
 * two buyers racing for one freed VIP seat, the Emails 11-12 blocks read at
 * send time, and the waitlist notice (recorded only while it is switched off,
 * once per opening when on). Needs TEST_DATABASE_URL; skipped otherwise.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("Lounge founding rules, migration 222 (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let seats: typeof import("./loungeSeats");
  let waitlist: typeof import("./loungeWaitlist");
  let pool: typeof import("../db/pool").pool;
  let generalOfferId = 0;
  let vipOfferId = 0;
  let productId = 0;
  let n = 0;

  async function offer(slug: string): Promise<number> {
    const existing = await db.client.query(`SELECT id FROM offers WHERE slug = $1`, [slug]);
    return existing.rows[0]?.id
      ?? (await db.client.query(`INSERT INTO offers (title, slug, status) VALUES ($1, $2, 'published') RETURNING id`, [`ZZ ${slug}`, slug])).rows[0].id;
  }

  async function order(offerId: number, email: string, opts: { status?: string; total?: number; coupon?: string; contactId?: number | null } = {}): Promise<number> {
    const row = await db.client.query(
      `INSERT INTO orders (email, amount_cents, total_cents, currency, status, offer_id, coupon_code, contact_id)
       VALUES ($1, $2, $2, 'usd', $3, $4, $5, $6) RETURNING id`,
      [email, opts.total ?? 34700, opts.status ?? "paid", offerId, opts.coupon ?? "", opts.contactId ?? null]
    );
    return row.rows[0].id;
  }

  /** A paid VIP member: claimed founding row + member + grant (active unless `revoked`). */
  async function vipMember(email: string, revoked = false): Promise<void> {
    const member = await db.client.query(`INSERT INTO members (email) VALUES ($1) RETURNING id`, [email]);
    await db.client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, status, source, revoked_at)
       VALUES ($1, $2, $3, $4, 'manual', $5)`,
      [member.rows[0].id, productId, vipOfferId, revoked ? "revoked" : "active", revoked ? new Date() : null]
    );
    await db.client.query(
      `INSERT INTO lounge_seats (tier, email, phase, status, claimed_at, source) VALUES ('vip', $1, 'founding', 'claimed', now(), 'test')`,
      [email]
    );
  }

  async function claim(orderId: number) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await seats.claimLoungeSeatSafely(client, orderId);
      await client.query("COMMIT");
      return result;
    } finally {
      client.release();
    }
  }

  const email = (label: string) => `person-${label}-${++n}@example.com`;

  beforeAll(async () => {
    db = await createTestDatabase("lounge_222");
    process.env.DATABASE_URL = db.url;
    generalOfferId = await offer("the-lounge");
    vipOfferId = await offer("the-lounge-vip");
    productId = (await db.client.query(
      `INSERT INTO products (slug, title, kind, status) VALUES ('zz-lounge-vip-222', 'ZZ VIP', 'access_group', 'published') RETURNING id`
    )).rows[0].id;
    seats = await import("./loungeSeats");
    waitlist = await import("./loungeWaitlist");
    pool = (await import("../db/pool")).pool;
  }, 60000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await db.client.query(`DELETE FROM lounge_seats`);
    await db.client.query(`DELETE FROM lounge_vip_openings`);
    await db.client.query(`DELETE FROM access_grants WHERE product_id = $1`, [productId]);
  });

  it("current migrations keep LOUNGE26 off and activate the approved waitlist notice", async () => {
    const seq = await db.client.query(`SELECT status FROM email_sequences WHERE slug = 'lounge-vip-seat-open'`);
    expect(seq.rows[0]?.status).toBe("active");
    const job = await db.client.query(`SELECT kind, enabled FROM job_schedules WHERE name = 'lounge-vip-waitlist-notify'`);
    expect(job.rows[0]).toMatchObject({ kind: "loungeVip.waitlistNotify" });
    const coupon = await db.client.query(`SELECT active FROM coupons WHERE upper(code::text) = 'LOUNGE26'`);
    for (const row of coupon.rows) expect(row.active).toBe(false);
  });

  it("does not give a founding VIP place back on a refund, but the seat does free up at the standard price", async () => {
    for (let i = 0; i < 5; i++) await vipMember(email("vip"));
    await vipMember(email("refunded"), true); // refunded: access revoked
    const status = await seats.tierStatus("vip");
    expect(status).toMatchObject({ phase: "standard", foundingRemaining: 0, seatsAvailable: 1, purchasable: true, waitlist: false });
    expect(seats.vipBlockKey(status)).toBe("vipSeatAvailable");

    // A buyer still quoted the founding price is refused; the standard price sells.
    const late = email("late");
    const lateOrder = await order(vipOfferId, late, { status: "pending" });
    await expect(seats.reserveLoungeSeat({ orderId: lateOrder, offerSlug: "the-lounge-vip", pricePhase: "founding", email: late, signedIn: false }))
      .rejects.toMatchObject({ status: 409 });
    await expect(seats.reserveLoungeSeat({ orderId: lateOrder, offerSlug: "the-lounge-vip", pricePhase: "standard", email: late, signedIn: false }))
      .resolves.toBeUndefined();
    // That buyer's hold now fills the sixth seat: full for everyone else.
    expect(seats.vipBlockKey(await seats.tierStatus("vip"))).toBe("vipFull");
  });

  it("counts founding places cumulatively and capacity currently: 4 founders, 1 refunded, still founding with 3 seats taken", async () => {
    for (let i = 0; i < 3; i++) await vipMember(email("vip"));
    await vipMember(email("refunded"), true);
    expect(await seats.tierStatus("vip")).toMatchObject({ phase: "founding", foundingRemaining: 2, seatsAvailable: 3 });
  });

  it("sells one freed VIP seat once when two buyers race for it", async () => {
    for (let i = 0; i < 5; i++) await vipMember(email("vip"));
    await vipMember(email("gone"), true);
    const a = email("race-a");
    const b = email("race-b");
    const [oa, ob] = [await order(vipOfferId, a, { status: "pending" }), await order(vipOfferId, b, { status: "pending" })];
    const results = await Promise.allSettled([
      seats.reserveLoungeSeat({ orderId: oa, offerSlug: "the-lounge-vip", pricePhase: "standard", email: a, signedIn: false }),
      seats.reserveLoungeSeat({ orderId: ob, offerSlug: "the-lounge-vip", pricePhase: "standard", email: b, signedIn: false }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
  });

  it("never counts a LOUNGE26 order or an internal contact's order", async () => {
    const owner = email("owner");
    const testOrder = await order(generalOfferId, owner, { total: 200, coupon: "LOUNGE26" });
    expect(await claim(testOrder)).toMatchObject({ claimed: false, reason: "test coupon" });

    const internal = await db.client.query(`INSERT INTO contacts (email, name, is_internal) VALUES ($1, 'Team', true) RETURNING id`, [email("team")]);
    const internalOrder = await order(generalOfferId, `team-${n}@example.com`, { total: 19700, contactId: internal.rows[0].id });
    expect(await claim(internalOrder)).toMatchObject({ claimed: false, reason: "internal contact" });

    const real = await order(generalOfferId, email("real"), { total: 19700 });
    expect(await claim(real)).toMatchObject({ claimed: true });
    expect((await db.client.query(`SELECT count(*)::int AS n FROM lounge_seats WHERE status = 'claimed'`)).rows[0].n).toBe(1);
  });

  it("fills the Emails 11-12 blocks from the live counts, each tier on its own", async () => {
    let values = await seats.loungeMergeValues(pool);
    expect(values.lounge_general_pricing_block).toBe(seats.LOUNGE_BLOCKS.generalFounding);
    expect(values.lounge_vip_availability_block).toBe(seats.LOUNGE_BLOCKS.vipFounding);
    for (let i = 0; i < 6; i++) await vipMember(email("vip"));
    values = await seats.loungeMergeValues(pool);
    expect(values.lounge_general_pricing_block).toBe(seats.LOUNGE_BLOCKS.generalFounding);
    expect(values.lounge_vip_availability_block).toBe(seats.LOUNGE_BLOCKS.vipFull);
  });

  it("waitlist notice: records an opening while OFF, notifies once per opening when ON, and closes when full", async () => {
    // Explicitly exercise the disabled branch; migration 229 activates the real notice.
    await db.client.query(`UPDATE email_sequences SET status = 'draft' WHERE slug = 'lounge-vip-seat-open'`);
    const tag = await db.client.query(`SELECT id FROM tags WHERE slug = 'lounge-vip-waitlist'`);
    const tagId = tag.rows[0]?.id
      ?? (await db.client.query(`INSERT INTO tags (name, slug) VALUES ('Lounge VIP Waitlist', 'lounge-vip-waitlist') RETURNING id`)).rows[0].id;
    const waiting = await db.client.query(`INSERT INTO contacts (email, name) VALUES ($1, 'Waiting') RETURNING id`, [email("wait")]);
    await db.client.query(`INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [waiting.rows[0].id, tagId]);

    const enroll = vi.fn(async () => ({ outcome: "enrolled" }));

    // All six seats held: nothing open.
    for (let i = 0; i < 6; i++) await vipMember(email("vip"));
    expect(await waitlist.runLoungeVipWaitlistTick(enroll)).toMatchObject({ open: false });

    // One member leaves: an opening, recorded, but the notice is OFF.
    const leaver = (await db.client.query(`SELECT email FROM lounge_seats WHERE tier = 'vip' LIMIT 1`)).rows[0].email;
    await db.client.query(
      `UPDATE access_grants g SET status = 'revoked', revoked_at = now() FROM members m WHERE m.id = g.member_id AND m.email = $1`,
      [leaver]
    );
    expect(await waitlist.runLoungeVipWaitlistTick(enroll)).toMatchObject({ open: true, notified: 0, reason: "notice switched off" });
    expect(enroll).not.toHaveBeenCalled();

    // Switched on while the seat is still open: told once.
    await db.client.query(`UPDATE email_sequences SET status = 'active' WHERE slug = 'lounge-vip-seat-open'`);
    try {
      expect(await waitlist.runLoungeVipWaitlistTick(enroll)).toMatchObject({ open: true, notified: 1 });
      expect(enroll).toHaveBeenCalledTimes(1);
      expect(await waitlist.runLoungeVipWaitlistTick(enroll)).toMatchObject({ notified: 0, reason: "already notified for this opening" });
      expect(enroll).toHaveBeenCalledTimes(1);

      // The seat is taken again: the opening closes.
      await vipMember(email("new"));
      expect(await waitlist.runLoungeVipWaitlistTick(enroll)).toMatchObject({ open: false, reason: "seats full again" });
      const rows = await db.client.query(`SELECT closed_at, notified_at, waitlisted FROM lounge_vip_openings`);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].closed_at).not.toBeNull();
      expect(rows.rows[0].waitlisted).toBe(1);
    } finally {
      await db.client.query(`UPDATE email_sequences SET status = 'active' WHERE slug = 'lounge-vip-seat-open'`);
    }
  });
});
