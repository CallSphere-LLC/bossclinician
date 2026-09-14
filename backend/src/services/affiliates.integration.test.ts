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
 * Integration tests for the partner ledger.
 *
 * The two things worth proving here cannot be proved without a database,
 * because both of them ARE the database:
 *
 *  - accruing the same transaction twice pays once, which rests entirely on the
 *    unique index over `(transaction_id, kind)` and on `ON CONFLICT` naming the
 *    partial index correctly. A mock would agree with any spelling of that.
 *  - a refund writes a negative row and stops, however many times the sweep
 *    runs over it.
 *
 * Skipped when TEST_DATABASE_URL is unset, so the default `npm test` needs
 * nothing running.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("affiliate commission ledger (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let affiliates: typeof import("./affiliates");

  /** A partner, an offer, an attributed order and one cleared payment. */
  async function seedSale(input: {
    label: string;
    amountCents: number;
    taxCents?: number;
    rateBps?: number;
  }): Promise<{ affiliateId: number; offerId: number; orderId: number; transactionId: number }> {
    const product = await insertCourseProduct(client, `p-${input.label}`);
    const offerId = await insertOffer(client, `o-${input.label}`, [product.productId], {
      amountCents: input.amountCents,
    });

    const affiliate = await client.query<{ id: number }>(
      `INSERT INTO affiliates (email, name, code, status, approved_at, commission_rate)
       VALUES ($1, $2, $3, 'approved', now(), $4) RETURNING id`,
      [
        `${input.label}@partner.invalid`,
        `Partner ${input.label}`,
        `code-${input.label}`,
        input.rateBps ?? 3000,
      ]
    );
    const affiliateId = affiliate.rows[0].id;

    const order = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, email, status, total_cents, amount_cents, subtotal_cents,
                           tax_cents, currency, stripe_session_id, affiliate_id)
       VALUES ($1, $2, 'paid', $3, $3, $3, $4, 'usd', $5, $6)
       RETURNING id`,
      [
        offerId,
        `buyer-${input.label}@test.invalid`,
        input.amountCents,
        input.taxCents ?? 0,
        `cs_${input.label}`,
        affiliateId,
      ]
    );
    const orderId = order.rows[0].id;

    const tx = await client.query<{ id: number }>(
      `INSERT INTO transactions (order_id, email, kind, status, amount_cents, currency,
                                 stripe_payment_intent_id)
       VALUES ($1, $2, 'payment', 'succeeded', $3, 'usd', $4)
       RETURNING id`,
      [orderId, `buyer-${input.label}@test.invalid`, input.amountCents, `pi_${input.label}`]
    );

    return { affiliateId, offerId, orderId, transactionId: tx.rows[0].id };
  }

  beforeAll(async () => {
    db = await createTestDatabase("affiliates");
    client = db.client;

    // The module reads DATABASE_URL at import time through config/env, so the
    // environment has to be pointed at the scratch database before it loads.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    affiliates = await import("./affiliates");
  }, 60_000);

  afterAll(async () => {
    // The module under test opened its own pool against the scratch database.
    // Dropping it first would force pg_terminate_backend to kill live
    // connections, which surfaces as an unhandled FATAL after a passing suite.
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("accrues once however many times it runs", async () => {
    const sale = await seedSale({ label: "twice", amountCents: 99_700 });

    const first = await affiliates.accrueForTransaction(sale.transactionId);
    const second = await affiliates.accrueForTransaction(sale.transactionId);
    const third = await affiliates.accrueForTransaction(sale.transactionId);

    expect(first.accrued).toBe(true);
    expect(second.accrued).toBe(false);
    expect(third.accrued).toBe(false);

    const rows = await client.query<{ count: number; total: number }>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_cents), 0)::int AS total
         FROM affiliate_commissions WHERE affiliate_id = $1`,
      [sale.affiliateId]
    );
    expect(rows.rows[0].count).toBe(1);
    // 30% of $997.
    expect(rows.rows[0].total).toBe(29_910);
  });

  it("holds the commission until the refund window closes", async () => {
    const sale = await seedSale({ label: "hold", amountCents: 10_000 });
    await affiliates.accrueForTransaction(sale.transactionId);

    const row = await client.query<{ payable_at: Date; status: string }>(
      `SELECT payable_at, status FROM affiliate_commissions WHERE transaction_id = $1`,
      [sale.transactionId]
    );
    expect(row.rows[0].status).toBe("pending");
    expect(row.rows[0].payable_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not share the sales tax with the partner", async () => {
    const sale = await seedSale({ label: "tax", amountCents: 11_000, taxCents: 1000 });
    await affiliates.accrueForTransaction(sale.transactionId);

    const row = await client.query<{ basis_cents: number; amount_cents: number }>(
      `SELECT basis_cents, amount_cents FROM affiliate_commissions WHERE transaction_id = $1`,
      [sale.transactionId]
    );
    expect(row.rows[0].basis_cents).toBe(10_000);
    expect(row.rows[0].amount_cents).toBe(3000);
  });

  it("pays nothing on an order that is not attributed to anybody", async () => {
    const sale = await seedSale({ label: "orphan", amountCents: 5000 });
    await client.query(`UPDATE orders SET affiliate_id = NULL WHERE id = $1`, [sale.orderId]);

    const result = await affiliates.accrueForTransaction(sale.transactionId);
    expect(result.accrued).toBe(false);
  });

  it("pays nothing to a partner who bought it themselves", async () => {
    const sale = await seedSale({ label: "selfref", amountCents: 199_700 });

    // The partner clicked their own share link and checked out with the address
    // they applied under. Nothing upstream refuses that — the click is ordinary
    // and the attribution is frozen onto the order like any other.
    await client.query(`UPDATE orders SET email = $2 WHERE id = $1`, [
      sale.orderId,
      "selfref@partner.invalid",
    ]);

    const result = await affiliates.accrueForTransaction(sale.transactionId);
    expect(result.accrued).toBe(false);

    const rows = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM affiliate_commissions WHERE affiliate_id = $1`,
      [sale.affiliateId]
    );
    expect(rows.rows[0].count).toBe(0);
  });

  it("pays nothing to a partner whose member account placed the order", async () => {
    const sale = await seedSale({ label: "selfmember", amountCents: 50_000 });
    const memberId = await insertMember(client, "success+selfmember-buyer@simulator.amazonses.com");
    await client.query(`UPDATE orders SET member_id = $2 WHERE id = $1`, [sale.orderId, memberId]);
    await client.query(`UPDATE affiliates SET member_id = $2 WHERE id = $1`, [
      sale.affiliateId,
      memberId,
    ]);

    const result = await affiliates.accrueForTransaction(sale.transactionId);
    expect(result.accrued).toBe(false);
  });

  it("pays nothing to a partner who has been suspended", async () => {
    const sale = await seedSale({ label: "suspended", amountCents: 5000 });
    await client.query(`UPDATE affiliates SET status = 'suspended' WHERE id = $1`, [
      sale.affiliateId,
    ]);

    const result = await affiliates.accrueForTransaction(sale.transactionId);
    expect(result.accrued).toBe(false);
  });

  it("applies the most specific commission rule", async () => {
    const sale = await seedSale({ label: "rules", amountCents: 100_000 });

    // The partner's own columns say 30%.
    const fallback = await affiliates.commissionFor(sale.affiliateId, sale.offerId, 100_000);
    expect(fallback?.source).toBe("program_default");
    expect(fallback?.amountCents).toBe(30_000);

    // Everyone gets 40% on this offer.
    await client.query(
      `INSERT INTO affiliate_commission_rules (affiliate_id, offer_id, commission_type, commission_rate)
       VALUES (NULL, $1, 'percent', 4000)`,
      [sale.offerId]
    );
    const programWide = await affiliates.commissionFor(sale.affiliateId, sale.offerId, 100_000);
    expect(programWide?.source).toBe("offer");
    expect(programWide?.amountCents).toBe(40_000);

    // This partner gets 50% on everything — still beaten by the offer rule.
    await client.query(
      `INSERT INTO affiliate_commission_rules (affiliate_id, offer_id, commission_type, commission_rate)
       VALUES ($1, NULL, 'percent', 5000)`,
      [sale.affiliateId]
    );
    const stillOffer = await affiliates.commissionFor(sale.affiliateId, sale.offerId, 100_000);
    expect(stillOffer?.source).toBe("offer");

    // …but this partner, on this offer, gets a flat $250.
    await client.query(
      `INSERT INTO affiliate_commission_rules
         (affiliate_id, offer_id, commission_type, commission_fixed_cents)
       VALUES ($1, $2, 'fixed', 25000)`,
      [sale.affiliateId, sale.offerId]
    );
    const negotiated = await affiliates.commissionFor(sale.affiliateId, sale.offerId, 100_000);
    expect(negotiated?.source).toBe("affiliate_offer");
    expect(negotiated?.amountCents).toBe(25_000);
  });

  it("replaces a rule rather than duplicating it, even when one side is blank", async () => {
    const sale = await seedSale({ label: "upsert", amountCents: 10_000 });

    // The trap: UNIQUE (affiliate_id, offer_id) treats two NULLs as distinct, so
    // saving the same program-wide rule twice must not leave two rows for
    // `pickRule` to choose between arbitrarily.
    const base = {
      affiliateId: null,
      offerId: sale.offerId,
      type: "percent" as const,
      fixedCents: 0,
      recurring: false,
    };
    const firstId = await affiliates.upsertCommissionRule({ ...base, rateBps: 4000 });
    const secondId = await affiliates.upsertCommissionRule({ ...base, rateBps: 4500 });
    expect(secondId).toBe(firstId);

    // …and the same for an "everything" rule, where the blank column is the
    // other one.
    const everythingBase = {
      affiliateId: sale.affiliateId,
      offerId: null,
      type: "percent" as const,
      fixedCents: 0,
      recurring: false,
    };
    const thirdId = await affiliates.upsertCommissionRule({ ...everythingBase, rateBps: 1000 });
    const fourthId = await affiliates.upsertCommissionRule({ ...everythingBase, rateBps: 1500 });
    expect(fourthId).toBe(thirdId);

    const rows = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM affiliate_commission_rules
        WHERE offer_id = $1 OR affiliate_id = $2`,
      [sale.offerId, sale.affiliateId]
    );
    expect(rows.rows[0].count).toBe(2);

    // The offer rule wins over the partner's own, and it holds the newer rate.
    const resolved = await affiliates.commissionFor(sale.affiliateId, sale.offerId, 10_000);
    expect(resolved?.source).toBe("offer");
    expect(resolved?.amountCents).toBe(4500);
  });

  it("reverses commission in proportion to a refund, once per refund", async () => {
    const sale = await seedSale({ label: "refund", amountCents: 100_000 });
    await affiliates.accrueForTransaction(sale.transactionId);

    const refund = await client.query<{ id: number }>(
      `INSERT INTO refunds (order_id, transaction_id, amount_cents, currency, stripe_refund_id)
       VALUES ($1, $2, 50000, 'usd', 're_half') RETURNING id`,
      [sale.orderId, sale.transactionId]
    );

    const first = await affiliates.clawback(refund.rows[0].id);
    const second = await affiliates.clawback(refund.rows[0].id);

    expect(first.clawedBack).toBe(true);
    // Half the sale came back, so half the 30% commission goes with it.
    expect(first.amountCents).toBe(-15_000);
    expect(second.clawedBack).toBe(false);

    const balance = await client.query<{ total: number; rows: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS rows
         FROM affiliate_commissions WHERE affiliate_id = $1`,
      [sale.affiliateId]
    );
    expect(balance.rows[0].rows).toBe(2);
    expect(balance.rows[0].total).toBe(15_000);

    // The original row is untouched: the ledger records what happened, it does
    // not restate it.
    const original = await client.query<{ amount_cents: number }>(
      `SELECT amount_cents FROM affiliate_commissions WHERE transaction_id = $1`,
      [sale.transactionId]
    );
    expect(original.rows[0].amount_cents).toBe(30_000);
  });

  it("never reverses more than was earned", async () => {
    const sale = await seedSale({ label: "overrefund", amountCents: 20_000 });
    await affiliates.accrueForTransaction(sale.transactionId);

    for (const [index, amount] of [12_000, 8000, 5000].entries()) {
      const refund = await client.query<{ id: number }>(
        `INSERT INTO refunds (order_id, transaction_id, amount_cents, currency, stripe_refund_id)
         VALUES ($1, $2, $3, 'usd', $4) RETURNING id`,
        [sale.orderId, sale.transactionId, amount, `re_over_${index}`]
      );
      await affiliates.clawback(refund.rows[0].id);
    }

    const balance = await client.query<{ total: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
         FROM affiliate_commissions WHERE affiliate_id = $1`,
      [sale.affiliateId]
    );
    expect(balance.rows[0].total).toBe(0);
  });

  it("credits the most recent click by default, and the first when told to", async () => {
    const memberId = await insertMember(client, "attribution@test.invalid");
    expect(memberId).toBeGreaterThan(0);

    const first = await client.query<{ id: number }>(
      `INSERT INTO affiliates (email, name, code, status, approved_at)
       VALUES ('first@partner.invalid', 'First', 'code-first', 'approved', now()) RETURNING id`
    );
    const last = await client.query<{ id: number }>(
      `INSERT INTO affiliates (email, name, code, status, approved_at)
       VALUES ('last@partner.invalid', 'Last', 'code-last', 'approved', now()) RETURNING id`
    );

    await client.query(
      `INSERT INTO affiliate_clicks (affiliate_id, visitor_token, expires_at, created_at)
       VALUES ($1, 'visitor-1', now() + interval '30 days', now() - interval '5 days')`,
      [first.rows[0].id]
    );
    await client.query(
      `INSERT INTO affiliate_clicks (affiliate_id, visitor_token, expires_at, created_at)
       VALUES ($1, 'visitor-1', now() + interval '30 days', now() - interval '1 day')`,
      [last.rows[0].id]
    );

    affiliates.clearAffiliateSettingsCache();
    const lastClick = await affiliates.resolveAttribution("visitor-1", null);
    expect(lastClick?.affiliateId).toBe(last.rows[0].id);

    await affiliates.writeAffiliateSettings({ attribution: "first_click" });
    const firstClick = await affiliates.resolveAttribution("visitor-1", null);
    expect(firstClick?.affiliateId).toBe(first.rows[0].id);

    await affiliates.writeAffiliateSettings({ attribution: "last_click" });
  });

  it("ignores a click whose cookie window has run out", async () => {
    const expired = await client.query<{ id: number }>(
      `INSERT INTO affiliates (email, name, code, status, approved_at)
       VALUES ('expired@partner.invalid', 'Expired', 'code-expired', 'approved', now()) RETURNING id`
    );
    await client.query(
      `INSERT INTO affiliate_clicks (affiliate_id, visitor_token, expires_at, created_at)
       VALUES ($1, 'visitor-2', now() - interval '1 day', now() - interval '40 days')`,
      [expired.rows[0].id]
    );

    expect(await affiliates.resolveAttribution("visitor-2", null)).toBeNull();
  });
});
