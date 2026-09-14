import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * The rollup against a real database.
 *
 * Everything worth testing here is SQL: day buckets cut in a named timezone, an
 * upsert that has to be re-runnable, and a sweep that has to remove exactly the
 * rows nothing produced any more. None of it is observable against a mock, and
 * all of it is the kind of thing that looks right and is not — a rollup that
 * doubles the takings on its second run is a rollup nobody can ever safely use
 * to fix a wrong number.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

/** 11:00 in New York on the given day — unambiguously that calendar day. */
const morningOf = (isoDay: string): string => `${isoDay}T15:00:00Z`;
/**
 * 21:00 in New York — which is already tomorrow in UTC, and is exactly the case
 * a naive `occurred_at::date` files under the wrong day.
 */
const eveningOf = (isoDay: string): string => {
  const next = new Date(`${isoDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T01:00:00Z`;
};

const DAY_ONE = "2026-03-10";
const DAY_TWO = "2026-03-11";

describeDb("report rollup (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let rollup: typeof import("./rollup");

  beforeAll(async () => {
    db = await createTestDatabase("reprollup");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    rollup = await import("./rollup");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await client.query(
      `TRUNCATE report_daily, refunds, transactions, order_items, orders,
                subscriptions, contacts, offers RESTART IDENTITY CASCADE`
    );
  });

  /** Two days of trade: two sales and a refund on day one, one sale on day two. */
  async function seed(): Promise<void> {
    await client.query(
      `INSERT INTO offers (id, title, slug, pricing_type, amount_cents)
       VALUES (1, 'Practice Protection Pack', 'ppp', 'one_time', 49700),
              (2, 'Fully Booked Toolkit',     'fbt', 'one_time', 19700)`
    );

    await client.query(
      `INSERT INTO orders (id, offer_id, email, status, total_cents, amount_cents,
                           currency, stripe_session_id, created_at)
       VALUES (1, 1, 'success+a@simulator.amazonses.com', 'paid', 49700, 0, 'usd', 'cs_1', $1),
              (2, 2, 'success+b@simulator.amazonses.com', 'paid', 19700, 0, 'usd', 'cs_2', $2),
              (3, 1, 'success+c@simulator.amazonses.com', 'paid', 49700, 0, 'usd', 'cs_3', $3)`,
      [morningOf(DAY_ONE), eveningOf(DAY_TWO), morningOf(DAY_TWO)]
    );

    await client.query(
      `INSERT INTO transactions (order_id, email, kind, status, amount_cents, currency,
                                 payment_method_type, country, state,
                                 stripe_payment_intent_id, occurred_at)
       VALUES (1, 'success+a@simulator.amazonses.com', 'payment', 'succeeded', 49700, 'usd', 'card', 'US', 'NY', 'pi_1', $1),
              (2, 'success+b@simulator.amazonses.com', 'payment', 'succeeded', 19700, 'usd', 'card', 'US', 'CA', 'pi_2', $2),
              (3, 'success+c@simulator.amazonses.com', 'payment', 'succeeded', 49700, 'usd', 'link', 'GB', '',   'pi_3', $3)`,
      [morningOf(DAY_ONE), eveningOf(DAY_TWO), morningOf(DAY_TWO)]
    );

    await client.query(
      `INSERT INTO refunds (order_id, amount_cents, currency, created_at)
       VALUES (1, 10000, 'usd', $1)`,
      [morningOf(DAY_ONE)]
    );

    await client.query(
      `INSERT INTO contacts (email, email_marketing_status, created_at)
       VALUES ('success+a@simulator.amazonses.com', 'subscribed', $1),
              ('success+b@simulator.amazonses.com', 'subscribed', $2),
              ('success+d@simulator.amazonses.com', 'opted_out',  $2)`,
      [morningOf(DAY_ONE), morningOf(DAY_TWO)]
    );
  }

  async function cell(metric: string, day: string, dimension = ""): Promise<{
    cents: number;
    count: number;
    currency: string;
  } | null> {
    const res = await client.query<{ value_cents: string; value_count: number; currency: string }>(
      `SELECT value_cents, value_count, currency
         FROM report_daily WHERE metric = $1 AND day = $2::date AND dimension = $3`,
      [metric, day, dimension]
    );
    const row = res.rows[0];
    return row
      ? { cents: Number(row.value_cents), count: row.value_count, currency: row.currency }
      : null;
  }

  /** Everything but `updated_at`, which is the only thing a rerun may change. */
  async function snapshot(): Promise<string> {
    const res = await client.query(
      `SELECT day, metric, dimension, value_cents, value_count, currency
         FROM report_daily ORDER BY day, metric, dimension`
    );
    return JSON.stringify(res.rows);
  }

  it("adds up a window, and adds it up the same way the second time", async () => {
    await seed();

    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });
    const first = await snapshot();

    expect(await cell("gross_revenue", DAY_ONE)).toEqual({
      cents: 49700,
      count: 1,
      currency: "usd",
    });
    // The 21:00 New York sale belongs to day two, not to day three. A naive
    // `occurred_at::date` in UTC would file it under the 12th.
    expect(await cell("gross_revenue", DAY_TWO)).toEqual({
      cents: 19700 + 49700,
      count: 2,
      currency: "usd",
    });

    expect(await cell("refunds", DAY_ONE)).toEqual({ cents: 10000, count: 1, currency: "usd" });
    // Gross less the refund; no processor fees are recorded, so nothing else
    // comes off it.
    expect(await cell("net_revenue", DAY_ONE)).toEqual({
      cents: 49700 - 10000,
      count: 1,
      currency: "usd",
    });

    expect((await cell("orders", DAY_TWO))?.count).toBe(2);
    expect((await cell("new_contacts", DAY_ONE))?.count).toBe(1);
    // The opted-out contact is a contact but not an opt-in.
    expect((await cell("optins", DAY_TWO))?.count).toBe(1);
    expect((await cell("new_contacts", DAY_TWO))?.count).toBe(2);

    // The dimensions have to agree with the total they were cut from.
    expect((await cell("gross_revenue", DAY_ONE, "offer:1"))?.cents).toBe(49700);
    expect((await cell("gross_revenue", DAY_ONE, "country:US"))?.cents).toBe(49700);
    expect((await cell("gross_revenue", DAY_ONE, "state:US-NY"))?.cents).toBe(49700);
    expect((await cell("gross_revenue", DAY_TWO, "method:card"))?.cents).toBe(19700);
    expect((await cell("gross_revenue", DAY_TWO, "method:link"))?.cents).toBe(49700);
    expect((await cell("gross_revenue", DAY_TWO, "pricing:one_time"))?.cents).toBe(69400);

    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });
    expect(await snapshot()).toBe(first);
  });

  it("picks up a payment that arrived after the day was first rolled up", async () => {
    await seed();
    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });

    // The webhook that turned up late.
    await client.query(
      `INSERT INTO orders (id, offer_id, email, status, total_cents, amount_cents,
                           currency, stripe_session_id, created_at)
       VALUES (9, 2, 'success+late@simulator.amazonses.com', 'paid', 19700, 0, 'usd', 'cs_9', $1)`,
      [morningOf(DAY_ONE)]
    );
    await client.query(
      `INSERT INTO transactions (order_id, email, kind, status, amount_cents, currency,
                                 payment_method_type, country, stripe_payment_intent_id, occurred_at)
       VALUES (9, 'success+late@simulator.amazonses.com', 'payment', 'succeeded', 19700, 'usd', 'card', 'US', 'pi_9', $1)`,
      [morningOf(DAY_ONE)]
    );

    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });

    expect(await cell("gross_revenue", DAY_ONE)).toEqual({
      cents: 49700 + 19700,
      count: 2,
      currency: "usd",
    });
  });

  it("removes a figure whose facts have gone away", async () => {
    await seed();
    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });
    expect(await cell("gross_revenue", DAY_ONE, "offer:1")).not.toBeNull();

    // The whole reason the sweep exists: without it, an offer that stopped
    // selling would keep reporting its last day's takings forever.
    await client.query(`DELETE FROM transactions WHERE order_id = 1`);
    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });

    expect(await cell("gross_revenue", DAY_ONE, "offer:1")).toBeNull();
    expect(await cell("gross_revenue", DAY_ONE)).toBeNull();
    // Day two was not touched by the deletion and must survive it.
    expect((await cell("gross_revenue", DAY_TWO))?.cents).toBe(69400);
  });

  it("leaves days outside the range alone", async () => {
    await seed();
    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });

    await rollup.runRollup({ from: DAY_TWO, to: DAY_TWO });

    expect((await cell("gross_revenue", DAY_ONE))?.cents).toBe(49700);
    expect((await cell("gross_revenue", DAY_TWO))?.cents).toBe(69400);
  });

  it("labels a bucket that mixes currencies rather than picking one", async () => {
    await seed();
    await client.query(
      `INSERT INTO transactions (order_id, email, kind, status, amount_cents, currency,
                                 payment_method_type, country, stripe_payment_intent_id, occurred_at)
       VALUES (NULL, 'success+e@simulator.amazonses.com', 'payment', 'succeeded', 20000, 'gbp', 'card', 'GB', 'pi_gbp', $1)`,
      [morningOf(DAY_ONE)]
    );

    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });

    // Two currencies cannot be added into one number honestly, and the table has
    // one currency column per row — so the row says so instead of guessing.
    expect((await cell("gross_revenue", DAY_ONE))?.currency).toBe("mixed");
    expect((await cell("gross_revenue", DAY_ONE, "country:GB"))?.currency).toBe("gbp");
  });

  it("reconstructs monthly recurring revenue for a day in the past", async () => {
    await client.query(
      `INSERT INTO subscriptions (email, status, amount_cents, currency, "interval",
                                  interval_count, created_at, canceled_at)
       VALUES ('success+sub@simulator.amazonses.com', 'active',   9900,  'usd', 'month', 1, $1, NULL),
              ('success+year@simulator.amazonses.com','active',   120000,'usd', 'year',  1, $1, NULL),
              ('success+gone@simulator.amazonses.com','canceled', 5000,  'usd', 'month', 1, $1, $2)`,
      [morningOf(DAY_ONE), morningOf(DAY_TWO)]
    );

    await rollup.runRollup({ from: DAY_ONE, to: DAY_TWO });

    // A yearly plan counts as a twelfth of itself, or January looks like a
    // record month every single year.
    expect(await cell("mrr", DAY_ONE)).toEqual({
      cents: 9900 + 10000 + 5000,
      count: 3,
      currency: "usd",
    });
    // The cancelled one drops out on the day it went.
    expect(await cell("mrr", DAY_TWO)).toEqual({
      cents: 9900 + 10000,
      count: 2,
      currency: "usd",
    });
    expect((await cell("canceled_subscriptions", DAY_TWO))?.count).toBe(1);
    expect((await cell("canceled_subscriptions", DAY_TWO, "reason:not given"))?.count).toBe(1);
  });

  it("refuses a range that is not a pair of dates", async () => {
    await expect(rollup.runRollup({ from: "yesterday", to: DAY_TWO })).rejects.toThrow(
      /YYYY-MM-DD/
    );
  });
});
