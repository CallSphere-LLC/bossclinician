import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { stripeEnabled } from "../../config/env";
import { stripe } from "../../stripe/client";
import { daysBetween, lastRollupAt, reportDay, shiftDay } from "../../services/reports/rollup";

/**
 * The daily overview — mounted at /admin/dashboard.
 *
 * One round trip for the whole tile row. Everything except the Stripe balance
 * comes out of `report_daily`, so opening the dashboard costs a handful of index
 * lookups rather than a scan of every transaction the business has ever taken.
 */
export const adminDashboardRouter = Router();

const query = z.object({
  days: z.coerce.number().int().min(2).max(365).optional(),
});

type Format = "money" | "count";

interface Tile {
  key: string;
  label: string;
  description: string;
  format: Format;
  currency: string;
  value: number;
  previousValue: number | null;
  changePercent: number | null;
  sparkline: { date: string; value: number }[];
  /** Which report opens when the tile is clicked. */
  reportId: string | null;
}

interface MetricWindow {
  points: { date: string; value: number }[];
  total: number;
  previousTotal: number;
  currency: string;
}

/**
 * One metric over the window and the window before it.
 *
 * `aggregate: "last"` is for the snapshot metrics — monthly recurring revenue is
 * where you stood on the last day, not the sum of thirty days of standings, and
 * adding those up would report a $200 membership as $6,000 a month.
 */
async function readWindow(opts: {
  metric: string;
  column: "value_cents" | "value_count";
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  aggregate?: "sum" | "last";
}): Promise<MetricWindow> {
  const res = await pool.query<{
    date: string;
    value: string;
    currency: string | null;
    era: string;
  }>(
    `WITH days AS (
       SELECT generate_series($4::date, $2::date, INTERVAL '1 day')::date AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD')      AS date,
            COALESCE(r.${opts.column}, 0)::bigint AS value,
            r.currency,
            CASE WHEN d.day >= $1::date THEN 'current' ELSE 'previous' END AS era
       FROM days d
       LEFT JOIN report_daily r
              ON r.day = d.day AND r.metric = $3 AND r.dimension = ''
      ORDER BY d.day`,
    [opts.from, opts.to, opts.metric, opts.previousFrom]
  );

  const rows = res.rows.map((r) => ({
    date: r.date,
    value: Number(r.value),
    currency: r.currency,
    era: r.era,
  }));

  const current = rows.filter((r) => r.era === "current");
  const previous = rows.filter(
    (r) => r.date >= opts.previousFrom && r.date <= opts.previousTo
  );

  const fold = (list: typeof rows): number =>
    opts.aggregate === "last"
      ? (list[list.length - 1]?.value ?? 0)
      : list.reduce((acc, r) => acc + r.value, 0);

  const seen = new Set(rows.map((r) => r.currency).filter((c): c is string => Boolean(c)));

  return {
    points: current.map((r) => ({ date: r.date, value: r.value })),
    total: fold(current),
    previousTotal: fold(previous),
    currency: seen.size === 1 ? [...seen][0] : seen.size === 0 ? "usd" : "mixed",
  };
}

function changePercent(current: number, previous: number): number | null {
  // "+∞%" against a period with nothing in it is noise, not signal.
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/* ------------------------------------------------------------ Stripe balance */

interface BalanceTile {
  available: { amountCents: number; currency: string }[];
  pending: { amountCents: number; currency: string }[];
}

/**
 * The balance, cached in process.
 *
 * The dashboard is the first thing opened every morning and a live Stripe call
 * on a page-load path is a rate limit and a latency spike waiting to happen —
 * every refresh, every tab, every admin. Five minutes is far fresher than a
 * payout schedule needs and turns a hundred page views into one API call.
 *
 * A failure is cached too, briefly: a revoked key must not mean the dashboard
 * calls Stripe once per request forever.
 */
const BALANCE_TTL_MS = 5 * 60_000;
const BALANCE_FAILURE_TTL_MS = 60_000;

let balanceCache: { at: number; value: BalanceTile | null } | null = null;

async function readBalance(): Promise<BalanceTile | null> {
  const now = Date.now();
  const ttl = balanceCache?.value === null ? BALANCE_FAILURE_TTL_MS : BALANCE_TTL_MS;
  if (balanceCache && now - balanceCache.at < ttl) return balanceCache.value;

  try {
    const balance = await stripe().balance.retrieve();
    const value: BalanceTile = {
      available: balance.available.map((b) => ({ amountCents: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amountCents: b.amount, currency: b.currency })),
    };
    balanceCache = { at: now, value };
    return value;
  } catch {
    // The rest of the dashboard is worth showing without it.
    balanceCache = { at: now, value: null };
    return null;
  }
}

/* -------------------------------------------------------------- the overview */

adminDashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // safeParse: `?days=0` is a mistake in a link, and answering it with a 500
    // and a stack in the log reads as the dashboard being broken.
    const parsed = query.safeParse(req.query);
    if (!parsed.success) throw badRequest("Check the date range.", parsed.error.flatten());
    const { days = 30 } = parsed.data;
    const to = reportDay();
    const from = shiftDay(to, -(days - 1));
    const length = daysBetween(from, to);
    const previousTo = shiftDay(from, -1);
    const previousFrom = shiftDay(from, -length);

    const window = { from, to, previousFrom, previousTo };

    const [gross, recurring, optins, sold, netAllTime, figuresUpdatedAt] = await Promise.all([
      readWindow({ ...window, metric: "gross_revenue", column: "value_cents" }),
      readWindow({ ...window, metric: "mrr", column: "value_cents", aggregate: "last" }),
      readWindow({ ...window, metric: "optins", column: "value_count" }),
      readWindow({ ...window, metric: "orders", column: "value_count" }),
      pool.query<{ cents: string; currency: string | null }>(
        `SELECT COALESCE(SUM(value_cents), 0)::bigint AS cents,
                CASE WHEN COUNT(DISTINCT currency) = 1 THEN MIN(currency) ELSE 'mixed' END AS currency
           FROM report_daily
          WHERE metric = 'net_revenue' AND dimension = ''`
      ),
      lastRollupAt(),
    ]);

    const tile = (
      key: string,
      label: string,
      description: string,
      format: Format,
      metric: MetricWindow,
      reportId: string
    ): Tile => ({
      key,
      label,
      description,
      format,
      currency: format === "money" ? metric.currency : "usd",
      value: metric.total,
      previousValue: metric.previousTotal,
      changePercent: changePercent(metric.total, metric.previousTotal),
      sparkline: metric.points,
      reportId,
    });

    const tiles: Tile[] = [
      tile(
        "gross",
        "Money coming in",
        `Everything people paid you over the last ${length} days.`,
        "money",
        gross,
        "gross-revenue"
      ),
      tile(
        "recurring",
        "Money every month",
        "What everyone on a membership adds up to each month, as things stand today.",
        "money",
        recurring,
        "subscriptions-mrr"
      ),
      tile(
        "optins",
        "People who joined your list",
        `New sign-ups to hear from you over the last ${length} days.`,
        "count",
        optins,
        "contacts-optins"
      ),
      tile(
        "sold",
        "Things sold",
        `Purchases people completed over the last ${length} days.`,
        "count",
        sold,
        "cart-orders"
      ),
      {
        key: "net",
        label: "Money you've kept",
        description: "Everything you've ever been paid, less anything refunded.",
        format: "money",
        currency: netAllTime.rows[0]?.currency ?? "usd",
        value: Number(netAllTime.rows[0]?.cents ?? 0),
        // All-time has no period before it to be up or down against.
        previousValue: null,
        changePercent: null,
        sparkline: [],
        reportId: "net-revenue",
      },
    ];

    const body: Record<string, unknown> = {
      range: { from, to, previousFrom, previousTo, days: length },
      figuresUpdatedAt: figuresUpdatedAt ? figuresUpdatedAt.toISOString() : null,
      tiles,
    };

    // Omitted entirely rather than shown as zero: a business with no card
    // payments set up has no balance, and a £0.00 tile reads as a bank account
    // that has been emptied.
    if (stripeEnabled()) {
      const balance = await readBalance();
      if (balance) body.balance = balance;
    }

    res.json(body);
  })
);
