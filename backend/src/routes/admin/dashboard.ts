import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { stripeEnabled } from "../../config/env";
import { stripe } from "../../stripe/client";
import { daysBetween, lastRollupAt, reportDay, shiftDay } from "../../services/reports/rollup";
import { adminDashboardPanelsRouter } from "./dashboardPanels";
import { can, type Permission } from "../../services/permissions";

/**
 * The daily overview — mounted at /admin/dashboard.
 *
 * One round trip for the whole tile row. Everything except the Stripe balance
 * comes out of `report_daily`, so opening the dashboard costs a handful of index
 * lookups rather than a scan of every transaction the business has ever taken.
 */
export const adminDashboardRouter = Router();

// §19–§30 live in their own file: they are cross-module and permission-gated
// per section, where everything below this line is the money roll-up.
adminDashboardRouter.use("/", adminDashboardPanelsRouter);

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

/**
 * A KPI card's worth of data — Part II §12, §14, §16.
 *
 * Distinct from `Tile` above, which is the five-figure row this dashboard has
 * always had and which other screens still read. A KPI additionally carries
 * where clicking it goes (§16) and which direction is good (§13): refunds
 * rising is an arrow up and a red number, and one field cannot say both.
 */
interface Kpi {
  key: string;
  /** The label §14 names. */
  label: string;
  /** The same figure in the owner's words, for the card's title attribute. */
  description: string;
  format: Format | "percent";
  currency: string;
  value: number;
  previousValue: number | null;
  changePercent: number | null;
  sparkline: number[];
  sense: "higher-is-better" | "lower-is-better" | "neutral";
  /** Admin route opened when the card is clicked (§16). */
  to: string | null;
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

/* ------------------------------------------------------------------- KPIs */

interface RevenueSeries {
  gross: { date: string; value: number }[];
  net: { date: string; value: number }[];
  subscriptions: { date: string; value: number }[];
  currency: string;
  summary: {
    grossCents: number;
    netCents: number;
    refundCents: number;
    subscriptionCents: number;
    averageOrderCents: number;
    orders: number;
  };
}

/**
 * The §14 KPI set.
 *
 * Six primary cards, then the secondary row. Everything that can come from
 * `report_daily` does, so the top of the dashboard stays a handful of index
 * lookups; the ones that cannot (active members, average course completion,
 * coaching sessions, enquiries) are snapshot counts with no meaningful
 * previous period, and say so by carrying a null `changePercent` rather than
 * a fabricated 0%.
 *
 * Cards whose data belongs to another module are omitted for a role that
 * cannot see that module — the same rule the panels router applies, for the
 * same reason: Marketing holds `reports.view` and reaches this endpoint, but
 * holds no `orders.view`, so the failed-payment count must not appear on its
 * home screen.
 */
async function buildKpis(opts: {
  role: string;
  window: { from: string; to: string; previousFrom: string; previousTo: string };
  gross: MetricWindow;
  sold: MetricWindow;
  optins: MetricWindow;
}): Promise<{ primary: Kpi[]; secondary: Kpi[]; revenue: RevenueSeries }> {
  const { window, gross, sold, optins } = opts;
  const may = (permission: Permission) => can(opts.role, permission);

  const [net, subscription, newContacts, refunds, mrr, sends, opens, clicks] = await Promise.all([
    readWindow({ ...window, metric: "net_revenue", column: "value_cents" }),
    readWindow({ ...window, metric: "subscription_revenue", column: "value_cents" }),
    readWindow({ ...window, metric: "new_contacts", column: "value_count" }),
    readWindow({ ...window, metric: "refunds", column: "value_cents" }),
    readWindow({ ...window, metric: "mrr", column: "value_cents", aggregate: "last" }),
    readWindow({ ...window, metric: "email_sends", column: "value_count" }),
    readWindow({ ...window, metric: "email_opens", column: "value_count" }),
    readWindow({ ...window, metric: "email_clicks", column: "value_count" }),
  ]);

  const fromWindow = (
    key: string,
    label: string,
    description: string,
    format: Format,
    metric: MetricWindow,
    to: string | null,
    sense: Kpi["sense"] = "higher-is-better",
  ): Kpi => ({
    key,
    label,
    description,
    format,
    currency: format === "money" ? metric.currency : "usd",
    value: metric.total,
    previousValue: metric.previousTotal,
    changePercent: changePercent(metric.total, metric.previousTotal),
    sparkline: metric.points.map((p) => p.value),
    sense,
    to,
  });

  /** A figure with no comparable period behind it. */
  const snapshot = (
    key: string,
    label: string,
    description: string,
    format: Kpi["format"],
    value: number,
    to: string | null,
    sense: Kpi["sense"] = "higher-is-better",
  ): Kpi => ({
    key,
    label,
    description,
    format,
    currency: "usd",
    value,
    previousValue: null,
    changePercent: null,
    sparkline: [],
    sense,
    to,
  });

  const primary: Kpi[] = [
    fromWindow(
      "gross-revenue",
      "Gross Revenue",
      "Everything people paid you.",
      "money",
      gross,
      "/admin/analytics/reports/gross-revenue",
    ),
    fromWindow(
      "net-revenue",
      "Net Revenue",
      "What you kept after refunds.",
      "money",
      net,
      "/admin/analytics/reports/net-revenue",
    ),
    fromWindow(
      "subscription-revenue",
      "Subscription Revenue",
      "Membership invoices settled in this period.",
      "money",
      subscription,
      "/admin/sales/subscriptions",
    ),
    fromWindow(
      "offers-sold",
      "Offers Sold",
      "Purchases people completed.",
      "count",
      sold,
      "/admin/analytics/reports/cart-orders",
    ),
  ];

  if (may("contacts.view")) {
    primary.push(
      fromWindow(
        "new-contacts",
        "New Contacts",
        "People who arrived in your list.",
        "count",
        newContacts,
        "/admin/contacts",
      ),
      fromWindow(
        "email-optins",
        "Email Opt-ins",
        "New sign-ups to hear from you.",
        "count",
        optins,
        "/admin/subscribers",
      ),
    );
  }

  const secondary: Kpi[] = [
    snapshot(
      "mrr",
      "MRR",
      "What memberships add up to each month, as things stand today.",
      "money",
      mrr.total,
      "/admin/sales/subscriptions",
    ),
    // Average order value is a ratio, so it has no daily series of its own —
    // averaging thirty daily averages is not the period's average order.
    snapshot(
      "aov",
      "Average Order Value",
      "Gross revenue divided by the number of orders.",
      "money",
      sold.total === 0 ? 0 : Math.round(gross.total / sold.total),
      "/admin/analytics/reports/cart-orders",
    ),
    fromWindow(
      "refunds",
      "Refunds",
      "Money handed back in this period.",
      "money",
      refunds,
      "/admin/sales/payments",
      "lower-is-better",
    ),
  ];

  if (may("contacts.view")) {
    const [members, applications] = await Promise.all([
      pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM members WHERE status = 'active'`),
      pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM leads WHERE created_at >= $1::date`, [
        window.from,
      ]),
    ]);
    secondary.push(
      snapshot(
        "active-members",
        "Active Members",
        "People who can sign in right now.",
        "count",
        Number(members.rows[0]?.n ?? 0),
        "/admin/members",
      ),
      snapshot(
        "applications",
        "Applications",
        "Enquiries received in this period.",
        "count",
        Number(applications.rows[0]?.n ?? 0),
        "/admin/leads",
      ),
    );
  }

  if (may("products.view")) {
    const completion = await pool.query<{ pct: string | null }>(
      `SELECT ROUND(AVG(progress))::text AS pct FROM enrollments`,
    );
    secondary.push(
      snapshot(
        "course-completion",
        "Course Completion",
        "Average progress across everyone enrolled.",
        "percent",
        Number(completion.rows[0]?.pct ?? 0),
        "/admin/courses",
      ),
    );
  }

  if (may("coaching.view")) {
    const sessions = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM coaching_sessions WHERE scheduled_at >= $1::date`,
      [window.from],
    );
    secondary.push(
      snapshot(
        "coaching-sessions",
        "Coaching Sessions",
        "Sessions booked into this period.",
        "count",
        Number(sessions.rows[0]?.n ?? 0),
        "/admin/coaching",
      ),
    );
  }

  if (may("orders.view")) {
    const failed = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM transactions
        WHERE kind = 'payment' AND status = 'failed' AND occurred_at >= $1::date`,
      [window.from],
    );
    secondary.push(
      snapshot(
        "failed-payments",
        "Failed Payments",
        "Card charges that did not go through.",
        "count",
        Number(failed.rows[0]?.n ?? 0),
        "/admin/sales/payments",
        "lower-is-better",
      ),
    );
  }

  if (may("marketing.view")) {
    const rate = (n: number) => (sends.total === 0 ? 0 : Math.round((n / sends.total) * 1000) / 10);
    secondary.push(
      snapshot(
        "email-open-rate",
        "Email Open Rate",
        "Opens as a share of everything sent.",
        "percent",
        rate(opens.total),
        "/admin/marketing/campaigns",
      ),
      snapshot(
        "email-click-rate",
        "Email Click Rate",
        "Clicks as a share of everything sent.",
        "percent",
        rate(clicks.total),
        "/admin/marketing/campaigns",
      ),
    );
  }

  // §18: one chart, three switchable series, and the summary figures beside it.
  const revenue: RevenueSeries = {
    gross: gross.points,
    net: net.points,
    subscriptions: subscription.points,
    currency: gross.currency,
    summary: {
      grossCents: gross.total,
      netCents: net.total,
      refundCents: refunds.total,
      subscriptionCents: subscription.total,
      averageOrderCents: sold.total === 0 ? 0 : Math.round(gross.total / sold.total),
      orders: sold.total,
    },
  };

  return { primary, secondary, revenue };
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

    // §14/§18. Built from the same three windows already read above rather
    // than re-querying them, so the KPI row and the legacy tile row can never
    // disagree about what gross revenue was for this period.
    const { primary, secondary, revenue } = await buildKpis({
      role: req.user?.role ?? "",
      window,
      gross,
      sold,
      optins,
    });

    const body: Record<string, unknown> = {
      range: { from, to, previousFrom, previousTo, days: length },
      figuresUpdatedAt: figuresUpdatedAt ? figuresUpdatedAt.toISOString() : null,
      tiles,
      kpis: { primary, secondary },
      revenue,
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
