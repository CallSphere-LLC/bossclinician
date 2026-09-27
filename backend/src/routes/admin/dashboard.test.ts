import { describe, expect, it, vi } from "vitest";

// The router module imports the pool and Stripe; folding a window touches neither.
vi.mock("../../db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../stripe/client", () => ({ stripe: vi.fn() }));

import { foldMetric } from "./dashboard";

const days = [
  { date: "2026-09-25", value: 20_000 },
  { date: "2026-09-26", value: 20_000 },
  // Today, before the 03:00 rollup: no row yet, so the LEFT JOIN reads zero.
  { date: "2026-09-27", value: 0 },
];

describe("foldMetric", () => {
  it("sums a flow metric across the window", () => {
    expect(foldMetric(days)).toBe(40_000);
  });

  it("reads a snapshot from the last day the rollup has worked out", () => {
    // Monthly recurring revenue used to come back as $0 ("down 100%") every
    // night between midnight and the 03:00 run.
    expect(foldMetric(days, "last", "2026-09-26")).toBe(20_000);
  });

  it("takes the last day of the window once that day has been rolled up", () => {
    expect(foldMetric(days, "last", "2026-09-27")).toBe(0);
    expect(foldMetric(days, "last")).toBe(0);
  });

  it("answers zero for a window the rollup has never reached", () => {
    expect(foldMetric(days, "last", "2026-09-01")).toBe(0);
  });
});
