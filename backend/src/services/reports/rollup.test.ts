import { describe, expect, it, vi } from "vitest";

const clientQuery = vi.fn();
vi.mock("../../db/pool", () => ({
  pool: {
    query: vi.fn(),
    connect: async () => ({ query: (...args: unknown[]) => clientQuery(...args), release: () => undefined }),
  },
}));

import { runRollup } from "./rollup";

describe("subscription metrics in the reports rollup", () => {
  it("normalise by the plan's period where there is a plan, else the subscription's", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/SELECT now\(\) AS ran_at/.test(sql)) return { rows: [{ ran_at: new Date() }] };
      return { rows: [], rowCount: 0 };
    });
    await runRollup({ from: "2026-09-01", to: "2026-09-02" });

    const sqlFor = (metric: string) =>
      clientQuery.mock.calls.find(([, params]) => Array.isArray(params) && params[3] === metric)![0] as string;
    // A legacy plan subscription keeps the column's 'month' default, so reading
    // only the subscription's interval booked a yearly plan at twelve times.
    for (const metric of ["new_subscriptions", "canceled_subscriptions", "mrr"]) {
      const sql = sqlFor(metric);
      expect(sql).toMatch(/LEFT JOIN plans p ON p\.id = s\.plan_id/);
      expect(sql).toMatch(/CASE COALESCE\(p\."interval", s\."interval"\)/);
      expect(sql).toMatch(/CASE WHEN p\.id IS NULL THEN s\.interval_count ELSE 1 END/);
    }
  });
});
