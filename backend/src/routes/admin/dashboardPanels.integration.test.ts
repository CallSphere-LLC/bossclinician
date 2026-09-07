import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * The dashboard panels against a real database.
 *
 * Two things here are worth a test and cannot be tested without one.
 *
 * The first is **permission scoping**. `/admin/dashboard` is mounted on
 * `reports.view` alone; these panels reach into payments, moderation and the
 * enquiry list. The role that exercises this is Marketing — it holds
 * `reports.view` so campaigns can be measured, and holds none of
 * `orders.view`, `community.view` or `coaching.view`. Part IV is explicit that
 * hiding a control is not enforcement, so the assertion that matters is that
 * Marketing's response does not *contain* the payments data — not that the
 * browser declined to draw it.
 *
 * The second is the **money definition**. A sale in this system is
 * `status IN ('paid','refunded')` and its amount is
 * `GREATEST(total_cents, amount_cents)`, because legacy orders carry the
 * amount in the other column. A panel that quietly used `status = 'paid'` and
 * `total_cents` would show a smaller number than every report beside it, and
 * nobody would be able to say which was right.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

interface AttentionBody {
  items: { key: string; count: number; severity: string }[];
}

interface PulseBody {
  days: number;
  sales?: { purchases: number; recent: { id: number; amountCents: number }[] };
  contacts?: { total: number };
  community?: { reportedPosts: number };
  applications?: { status: string; count: number }[];
  programs?: unknown[];
}

describeDb("dashboard panels (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  /** Swapped per test — the stand-in for whoever is signed in. */
  let role = "owner";

  beforeAll(async () => {
    db = await createTestDatabase("dashpanels");
    client = db.client;

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { adminDashboardPanelsRouter } = await import("./dashboardPanels");
    const { errorHandler } = await import("../../middleware/errorHandler");

    const app = express();
    app.use(express.json());
    // The real mount sits behind requireAuth + requirePermission("reports.view").
    // Both are exercised elsewhere; what is under test here is what the handler
    // does with the role once it has one, so the role is injected directly.
    app.use(
      "/api/admin/dashboard",
      (req: Request, _res: Response, next: NextFunction) => {
        req.user = { sub: 1, email: "owner@test.invalid", role };
        next();
      },
      adminDashboardPanelsRouter,
    );
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

  beforeEach(async () => {
    role = "owner";
    await client.query(
      `TRUNCATE transactions, refunds, order_items, orders, contacts, leads,
                community_reports, abandoned_checkouts, affiliates,
                automation_runs, automations, jobs
         RESTART IDENTITY CASCADE`,
    );
  });

  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard${path}`);
    expect(res.ok).toBe(true);
    return (await res.json()) as T;
  };

  /* ------------------------------------------------------------- fixtures */

  let seq = 0;
  const unique = (prefix: string) => `${prefix}-${(seq += 1)}@test.invalid`;

  async function insertOrder(opts: {
    status: string;
    totalCents?: number;
    amountCents?: number;
  }): Promise<number> {
    const email = unique("buyer");
    const res = await client.query<{ id: number }>(
      `INSERT INTO orders (email, status, total_cents, amount_cents, currency, course_title)
       VALUES ($1, $2, $3, $4, 'usd', 'A course') RETURNING id`,
      [email, opts.status, opts.totalCents ?? 0, opts.amountCents ?? 0],
    );
    return res.rows[0].id;
  }

  async function insertFailedAutomationRun(): Promise<number> {
    const automation = await client.query<{ id: number }>(
      `INSERT INTO automations (name, trigger_type, status)
       VALUES ('Welcome', 'offer_purchased', 'active') RETURNING id`,
    );
    const id = automation.rows[0].id;
    await client.query(
      `INSERT INTO automation_runs (automation_id, status, subject_email, created_at)
       VALUES ($1, 'failed', $2, now())`,
      [id, unique("subject")],
    );
    return id;
  }

  /* --------------------------------------------------------- §19 attention */

  describe("needs attention", () => {
    it("omits a row entirely when its count is zero", async () => {
      const body = await get<AttentionBody>("/attention");
      // §43: never an empty card. Nothing has happened, so nothing is listed.
      expect(body.items).toEqual([]);
    });

    it("reports failed payments as critical once one exists", async () => {
      await client.query(
        `INSERT INTO transactions (email, kind, status, amount_cents, occurred_at)
         VALUES ($1, 'payment', 'failed', 4900, now() - INTERVAL '1 day')`,
        [unique("failed")],
      );

      const body = await get<AttentionBody>("/attention");
      const item = body.items.find((i) => i.key === "failed-payments");
      expect(item).toBeDefined();
      expect(item?.count).toBe(1);
      expect(item?.severity).toBe("critical");
    });

    it("does not count a failed payment from beyond the 30-day window", async () => {
      await client.query(
        `INSERT INTO transactions (email, kind, status, amount_cents, occurred_at)
         VALUES ($1, 'payment', 'failed', 4900, now() - INTERVAL '45 days')`,
        [unique("stale")],
      );

      const body = await get<AttentionBody>("/attention");
      expect(body.items.find((i) => i.key === "failed-payments")).toBeUndefined();
    });

    it("withholds payments and moderation rows from marketing", async () => {
      await client.query(
        `INSERT INTO transactions (email, kind, status, amount_cents, occurred_at)
         VALUES ($1, 'payment', 'failed', 4900, now())`,
        [unique("failed")],
      );
      await client.query(
        `INSERT INTO community_reports (reason, status) VALUES ('Spam', 'open')`,
      );
      const automationId = await insertFailedAutomationRun();

      role = "marketing";
      const body = await get<AttentionBody>("/attention");

      // Marketing holds reports.view (so it reaches this endpoint at all) but
      // neither orders.view nor community.view.
      expect(body.items.find((i) => i.key === "failed-payments")).toBeUndefined();
      expect(body.items.find((i) => i.key === "community-reports")).toBeUndefined();
      // It does hold marketing.view, so its own failures still reach it —
      // proving the filter is per-source and not a blanket "return nothing".
      expect(body.items.find((i) => i.key === "failed-automations")?.count).toBe(1);
      expect(automationId).toBeGreaterThan(0);
    });

    it("gives an owner the payments rows marketing was denied", async () => {
      await client.query(
        `INSERT INTO transactions (email, kind, status, amount_cents, occurred_at)
         VALUES ($1, 'payment', 'failed', 4900, now())`,
        [unique("failed")],
      );
      await client.query(
        `INSERT INTO community_reports (reason, status) VALUES ('Spam', 'open')`,
      );

      const body = await get<AttentionBody>("/attention");
      expect(body.items.find((i) => i.key === "failed-payments")).toBeDefined();
      expect(body.items.find((i) => i.key === "community-reports")).toBeDefined();
    });
  });

  /* ------------------------------------------------------------- §21–§30 */

  describe("pulse", () => {
    it("counts a refunded order as a sale, matching the rollup", async () => {
      await insertOrder({ status: "paid", totalCents: 10_000 });
      await insertOrder({ status: "refunded", totalCents: 5_000 });
      await insertOrder({ status: "pending", totalCents: 9_900 });

      const body = await get<PulseBody>("/pulse?days=30");
      // The money moved on both the paid and the refunded order; the pending
      // one was never taken.
      expect(body.sales?.purchases).toBe(2);
    });

    it("reads a legacy order's amount from amount_cents", async () => {
      // Orders written before the offers migration carry nothing in
      // total_cents. Reading that column alone reports the sale as $0.00.
      const id = await insertOrder({ status: "paid", totalCents: 0, amountCents: 24_900 });

      const body = await get<PulseBody>("/pulse?days=30");
      const row = body.sales?.recent.find((r) => r.id === id);
      expect(row?.amountCents).toBe(24_900);
    });

    it("omits the sections marketing may not see, rather than emptying them", async () => {
      await insertOrder({ status: "paid", totalCents: 10_000 });
      // `leads.name` is NOT NULL with no default.
      await client.query(
        `INSERT INTO leads (name, email, status) VALUES ('An applicant', $1, 'new')`,
        [unique("applicant")],
      );

      role = "marketing";
      const body = await get<PulseBody>("/pulse?days=30");

      // Absent, not empty: `undefined` means "not permitted", and the browser
      // renders nothing at all rather than an empty-state card advertising a
      // panel this account cannot open.
      expect(body.sales).toBeUndefined();
      expect(body.community).toBeUndefined();
      // Marketing does hold contacts.view, so the enquiry buckets stay — the
      // filter is per-section, not a blanket denial.
      expect(body.contacts).toBeDefined();
      expect(body.applications).toBeDefined();
    });

    it("gives an owner every section", async () => {
      const body = await get<PulseBody>("/pulse?days=30");
      expect(body.sales).toBeDefined();
      expect(body.contacts).toBeDefined();
      expect(body.applications).toBeDefined();
      expect(body.programs).toBeDefined();
      expect(body.community).toBeDefined();
    });

    it("reports zero contacts without throwing on an empty table", async () => {
      // The top-customer subquery yields no row at all when there are no
      // contacts, which is a different shape from a row of zeros.
      const body = await get<PulseBody>("/pulse?days=30");
      expect(body.contacts?.total).toBe(0);
    });

    it("rejects a nonsensical range rather than answering with a 500", async () => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard/pulse?days=0`);
      expect(res.status).toBe(400);
    });
  });

  /* ----------------------------------------------------------- §20 today */

  describe("today", () => {
    it("returns an empty schedule rather than failing when nothing is booked", async () => {
      const body = await get<{ entries: unknown[] }>("/today");
      expect(body.entries).toEqual([]);
    });
  });
});
