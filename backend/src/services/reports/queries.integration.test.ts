import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * Every report, run against a real database.
 *
 * Thirty-eight functions whose entire content is SQL cannot be checked by the
 * compiler: a column renamed in a migration, an aggregate that needs a GROUP BY,
 * a `LIKE` against the wrong type — all of them typecheck perfectly and all of
 * them are a 500 on the reports screen. Running the whole catalogue is the only
 * thing that catches them, and it is cheap.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const FROM = "2026-03-01";
const TO = "2026-03-31";

describeDb("report queries (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let queries: typeof import("./queries");
  let rollup: typeof import("./rollup");

  beforeAll(async () => {
    db = await createTestDatabase("repquery");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    queries = await import("./queries");
    rollup = await import("./rollup");

    await client.query(
      `INSERT INTO offers (id, title, slug, pricing_type, amount_cents)
       VALUES (1, 'Practice Protection Pack', 'ppp', 'one_time', 49700)`
    );
    await client.query(
      `INSERT INTO orders (id, offer_id, email, status, total_cents, currency,
                           stripe_session_id, created_at)
       VALUES (1, 1, 'a@example.com', 'paid', 49700, 'usd', 'cs_1', '2026-03-10T15:00:00Z')`
    );
    await client.query(
      `INSERT INTO order_items (order_id, offer_id, title, kind, quantity, unit_cents, amount_cents)
       VALUES (1, 1, 'Practice Protection Pack', 'offer', 1, 49700, 49700)`
    );
    await client.query(
      `INSERT INTO transactions (order_id, email, kind, status, amount_cents, currency,
                                 payment_method_type, country, state,
                                 stripe_payment_intent_id, occurred_at)
       VALUES (1, 'a@example.com', 'payment', 'succeeded', 49700, 'usd', 'card', 'US', 'NY',
               'pi_1', '2026-03-10T15:00:00Z')`
    );
    await client.query(
      `INSERT INTO contacts (email, email_marketing_status, lifetime_value_cents, order_count, created_at)
       VALUES ('a@example.com', 'subscribed', 49700, 1, '2026-03-10T15:00:00Z')`
    );
    await client.query(
      `INSERT INTO subscriptions (email, status, amount_cents, currency, "interval",
                                  interval_count, offer_id, created_at)
       VALUES ('a@example.com', 'active', 9900, 'usd', 'month', 1, 1, '2026-03-10T15:00:00Z')`
    );

    await rollup.runRollup({ from: FROM, to: TO });
  }, 90_000);

  afterAll(async () => {
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("registers every group the hub lists", () => {
    const groups = new Set(queries.REPORTS.map((r) => r.group));
    for (const group of queries.REPORT_GROUPS) {
      expect([...groups]).toContain(group);
    }
  });

  it("gives every report a unique id", () => {
    const ids = queries.REPORTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs every report in the catalogue without throwing", async () => {
    // Collected rather than thrown one at a time, so one broken report does not
    // hide the other four that broke with it.
    const failures: string[] = [];

    for (const report of queries.REPORTS) {
      try {
        const result = await report.run({
          from: FROM,
          to: TO,
          compareFrom: "2026-02-01",
          compareTo: "2026-02-28",
          dimension: report.dimensions?.[0]?.key,
        });

        expect(Array.isArray(result.series)).toBe(true);
        expect(typeof result.currency).toBe("string");
        for (const series of result.series) {
          for (const point of series.points) {
            expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(Number.isFinite(point.value)).toBe(true);
          }
        }
        for (const total of Object.values(result.totals)) {
          expect(Number.isFinite(total.value)).toBe(true);
        }
      } catch (err) {
        failures.push(`${report.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    expect(failures).toEqual([]);
  }, 60_000);

  it("runs a second breakdown where a report offers one", async () => {
    const byState = await queries.paymentsByLocation({ from: FROM, to: TO, dimension: "state" });
    expect(byState.breakdown?.[0]?.label).toContain("NY");
  });

  it("reads real money out of the rollup rather than inventing it", async () => {
    const result = await queries.grossRevenue({ from: FROM, to: TO });
    expect(result.totals.total.value).toBe(49700);
    expect(result.breakdown?.[0]).toEqual({
      label: "Practice Protection Pack",
      value: 49700,
      count: 1,
    });
  });

  it("compares against the period before", async () => {
    const result = await queries.grossRevenue({
      from: FROM,
      to: TO,
      compareFrom: "2026-02-01",
      compareTo: "2026-02-28",
    });
    expect(result.comparison?.totals.total.value).toBe(0);
    // Nothing to grow from is null, not an infinite percentage.
    expect(result.comparison?.change.total).toBeNull();
  });

  it("says so when a report has nothing behind it yet", async () => {
    const result = await queries.pageViews({ from: FROM, to: TO });
    expect(result.note).toBeTruthy();
    expect(result.totals.total?.value ?? 0).toBe(0);
  });
});
