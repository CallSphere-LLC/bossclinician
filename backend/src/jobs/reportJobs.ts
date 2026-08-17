import { z } from "zod";
import {
  earliestActivityDay,
  reportDay,
  rollupIsEmpty,
  runRollup,
  shiftDay,
  type RollupResult,
} from "../services/reports/rollup";
import { registerHandler } from "./worker";

/**
 * The reporting jobs.
 *
 * `reports.rollup` is on the schedule nightly (migration 011). `reports.rebuild`
 * is the manual escape hatch behind the "update these figures" button and behind
 * any future backfill — same code, explicit range.
 */

const rebuildPayload = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * The nightly run.
 *
 * Yesterday *and* today, not just yesterday: a Stripe webhook that arrives at
 * 03:04 belongs to a day the 03:00 run has already closed, and a figure that is
 * quietly short by one late payment is worse than one that is obviously stale.
 *
 * The first run on a database that has never been rolled up rebuilds everything
 * instead. Otherwise the dashboard would show two days of history on the morning
 * after a deploy and look like the business had just started.
 */
async function nightlyRollup(): Promise<RollupResult> {
  const today = reportDay();

  if (await rollupIsEmpty()) {
    const first = await earliestActivityDay();
    if (first) return runRollup({ from: first, to: today });
  }

  return runRollup({ from: shiftDay(today, -1), to: today });
}

async function rebuild(payload: Record<string, unknown>): Promise<RollupResult> {
  const { from, to } = rebuildPayload.parse(payload);
  return runRollup({ from, to });
}

export function registerReportJobs(): void {
  registerHandler("reports.rollup", () => nightlyRollup());
  registerHandler("reports.rebuild", (payload) => rebuild(payload));
}
