import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const connectQuery = vi.fn();
vi.mock("../../db/pool", () => ({
  pool: {
    query: (...args: unknown[]) => query(...args),
    connect: async () => ({ query: (...args: unknown[]) => connectQuery(...args), release: () => undefined }),
  },
}));

const couponsCreate = vi.fn();
const couponsDel = vi.fn();
vi.mock("../../stripe/client", () => ({
  stripe: () => ({ coupons: { create: couponsCreate, del: couponsDel } }),
}));
vi.mock("../../config/env", () => ({ stripeEnabled: () => true }));

import { adminSalesRouter } from "./sales";

/** Runs a route's final handler the way Express would, skipping the permission gate. */
function run(method: "get" | "post", path: string, body: unknown = {}) {
  const layer = (adminSalesRouter.stack as any[]).find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  const stack = layer.route.stack;
  const handler = stack[stack.length - 1].handle;
  return new Promise<{ status?: number; body?: unknown; error?: any }>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    handler({ params: {}, body } as any, res, (error: unknown) => resolve({ error }));
  });
}

describe("POST /admin/sales/coupons", () => {
  beforeEach(() => {
    query.mockReset();
    connectQuery.mockReset();
    couponsCreate.mockReset();
    couponsDel.mockReset();
  });

  it("refuses a code that is already taken before making anything in Stripe", async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] });
    const { error } = await run("post", "/coupons", { code: "launch20", percentOff: 20 });
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/already have a coupon with that code/);
    expect(couponsCreate).not.toHaveBeenCalled();
  });

  it("removes the Stripe coupon it made when the insert loses a race on the code", async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    couponsCreate.mockResolvedValueOnce({ id: "co_new" });
    couponsDel.mockResolvedValue({});
    connectQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO coupons/.test(sql)) throw Object.assign(new Error("dup"), { code: "23505" });
      return { rows: [] };
    });
    const { error } = await run("post", "/coupons", { code: "LAUNCH20", percentOff: 20 });
    expect(error?.status).toBe(400);
    expect(couponsDel).toHaveBeenCalledWith("co_new");
  });
});

describe("GET /admin/sales/revenue", () => {
  beforeEach(() => query.mockReset());

  it("normalises MRR by the plan's period where there is a plan, else the subscription's", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/mrr_cents/.test(sql)) return { rows: [{ mrr_cents: 0 }] };
      if (/gross_cents/.test(sql)) {
        return { rows: [{ gross_cents: 0, last30_cents: 0, prev30_cents: 0, orders_paid: 0 }] };
      }
      return { rows: [] };
    });
    await run("get", "/revenue");
    const mrrSql = query.mock.calls.map(([sql]) => sql as string).find((sql) => /mrr_cents/.test(sql))!;
    // An offer subscription has no plan, so reading only the plan's interval
    // counted a yearly one at twelve times its monthly value; a legacy plan
    // subscription keeps the column's 'month' default, so reading only the
    // subscription's did the same to a yearly plan.
    expect(mrrSql).toMatch(/COALESCE\(p\."interval", s\."interval"\)/);
    expect(mrrSql).toMatch(/CASE WHEN p\.id IS NULL THEN GREATEST\(s\.interval_count, 1\) ELSE 1 END/);
    expect(mrrSql).toMatch(/LEFT JOIN plans p ON p\.id = s\.plan_id/);
  });
});
