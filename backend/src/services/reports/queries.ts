import { pool } from "../../db/pool";
import { REPORT_TIMEZONE, daysBetween, shiftDay } from "./rollup";
import { readSetting } from "../settings";
import { cancelReasonLabel, parseCancelReasons } from "../cancellationReasons";

/**
 * Every report, in one shape.
 *
 * The point of `ReportResult` is that a single screen can render all of them.
 * Thirty-eight bespoke response shapes would mean thirty-eight bespoke React
 * components, and the thirty-ninth report would cost as much as the first. So
 * every function here answers with the same four things: a series to chart, a
 * set of totals to read aloud, an optional comparison against the period before,
 * and an optional breakdown table.
 *
 * Most of them read `report_daily`, which the nightly rollup fills. The handful
 * that cannot — top customers, course progress, page views — say so in `note`
 * and query the live tables. Nothing here invents a number: a report with no
 * data source yet returns zeros and explains itself.
 */

export type ValueFormat = "money" | "count" | "percent";

export interface ReportPoint {
  date: string;
  value: number;
}

export interface ReportSeries {
  label: string;
  format: ValueFormat;
  points: ReportPoint[];
}

export interface ReportTotal {
  label: string;
  value: number;
  format: ValueFormat;
}

export interface ReportBreakdownRow {
  label: string;
  value: number;
  count: number;
}

export interface ReportComparison {
  from: string;
  to: string;
  totals: Record<string, ReportTotal>;
  /** Percent change per total key; null when the earlier period was zero. */
  change: Record<string, number | null>;
  /**
   * The earlier period's daily values, in the same order as the current series.
   * Present only where it is meaningful to overlay the two — the windows are the
   * same length, so aligning by position is aligning like with like.
   */
  points?: number[];
}

export interface ReportResult {
  series: ReportSeries[];
  totals: Record<string, ReportTotal>;
  comparison?: ReportComparison;
  breakdown?: ReportBreakdownRow[];
  /** Column headings for the breakdown table, in the owner's words. */
  breakdownLabel?: string;
  breakdownValueLabel?: string;
  breakdownCountLabel?: string;
  /** How to print the breakdown's two numeric columns. */
  breakdownFormat?: ValueFormat;
  breakdownCountFormat?: ValueFormat;
  /** `mixed` when the window spans more than one currency — see the rollup. */
  currency: string;
  /** An honest caveat, shown above the chart. Never used to explain away a bug. */
  note?: string;
}

export interface ReportParams {
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
  currency?: string;
  /** Which breakdown the viewer chose, from the report's own `dimensions`. */
  dimension?: string;
}

export type ReportRunner = (params: ReportParams) => Promise<ReportResult>;

export interface ReportDefinition {
  id: string;
  name: string;
  group: string;
  description: string;
  /** Offered breakdowns; the first is the default. */
  dimensions?: { key: string; label: string }[];
  run: ReportRunner;
}

/* ----------------------------------------------------------------- plumbing */

interface DailyRow {
  date: string;
  cents: number;
  count: number;
  currency: string | null;
}

/**
 * Reads one metric out of the rollup, with a zero for every day nothing
 * happened.
 *
 * The zeros matter: charting a sparse array draws a straight line between two
 * distant sales and reports a quiet fortnight as steady trade.
 */
async function readDaily(opts: {
  metric: string;
  from: string;
  to: string;
  /** The exact dimension. Defaults to the totals row. */
  dimension?: string;
  /** Or every dimension with this prefix, summed. Mutually exclusive with the above. */
  dimensionPrefix?: string;
  currency?: string;
}): Promise<DailyRow[]> {
  const exact = opts.dimensionPrefix === undefined ? (opts.dimension ?? "") : null;
  const prefix = opts.dimensionPrefix === undefined ? null : `${opts.dimensionPrefix}%`;

  const res = await pool.query<{
    date: string;
    cents: string;
    count: number;
    currency: string | null;
  }>(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
     ),
     agg AS (
       SELECT day,
              SUM(value_cents)::bigint AS cents,
              SUM(value_count)::int    AS count,
              CASE WHEN COUNT(DISTINCT currency) = 1 THEN MIN(currency) ELSE 'mixed' END AS currency
         FROM report_daily
        WHERE metric = $3
          AND day BETWEEN $1::date AND $2::date
          AND ($4::text IS NULL OR dimension = $4)
          AND ($5::text IS NULL OR dimension LIKE $5)
          AND ($6::text IS NULL OR currency  = $6)
        GROUP BY day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(a.cents, 0)::bigint AS cents,
            COALESCE(a.count, 0)::int    AS count,
            a.currency
       FROM days d
       LEFT JOIN agg a ON a.day = d.day
      ORDER BY d.day`,
    [opts.from, opts.to, opts.metric, exact, prefix, opts.currency ?? null]
  );

  return res.rows.map((r) => ({
    date: r.date,
    // BIGINT arrives as a string; every caller does arithmetic on it.
    cents: Number(r.cents),
    count: r.count,
    currency: r.currency,
  }));
}

/** The currency to print a window in, or `mixed` when it holds more than one. */
function currencyOf(rows: DailyRow[], fallback = "usd"): string {
  const seen = new Set(rows.map((r) => r.currency).filter((c): c is string => Boolean(c)));
  if (seen.size === 0) return fallback;
  if (seen.size === 1) return [...seen][0];
  return "mixed";
}

function sum(rows: DailyRow[], field: "cents" | "count"): number {
  return rows.reduce((acc, r) => acc + r[field], 0);
}

/** Percent change, rounded to a tenth. Null when there was nothing to grow from. */
function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** A stored key in a sentence: `too_expensive` → "Too expensive". */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/* ------------------------------------------------------- dimension labelling */

const PRICING_LABEL: Record<string, string> = {
  one_time: "One-off payment",
  subscription: "Subscription",
  payment_plan: "Payment plan",
  free: "Free",
  pwyw: "Pay what you want",
  unknown: "Not recorded",
};

const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  link: "Link",
  us_bank_account: "Bank transfer",
  cashapp: "Cash App",
  klarna: "Klarna",
  afterpay_clearpay: "Afterpay",
  unknown: "Not recorded",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  transactional: "Account emails",
  broadcast: "One-off emails",
  sequence: "Email sequences",
  automation: "Automations",
  digest: "Community digest",
};

let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  if (code === "unknown") return "Not recorded";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    // An unrecognised code must not take the report down with it.
    return code.toUpperCase();
  }
}

/** `offer:12` → the offer's title. One round trip per kind of id, not per row. */
async function labelDimensions(dimensions: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids: Record<string, number[]> = { offer: [], affiliate: [], broadcast: [], sequence: [] };

  for (const dim of dimensions) {
    const sep = dim.indexOf(":");
    const kind = sep === -1 ? "" : dim.slice(0, sep);
    const rest = sep === -1 ? dim : dim.slice(sep + 1);

    switch (kind) {
      case "offer":
      case "affiliate":
      case "broadcast":
      case "sequence": {
        const id = Number(rest);
        if (Number.isInteger(id)) ids[kind].push(id);
        break;
      }
      case "country":
        out.set(dim, countryName(rest));
        break;
      case "state": {
        const [code, ...state] = rest.split("-");
        out.set(dim, `${state.join("-") || "Unknown"}, ${countryName(code)}`);
        break;
      }
      case "method":
        out.set(dim, METHOD_LABEL[rest] ?? humanise(rest));
        break;
      case "pricing":
        out.set(dim, PRICING_LABEL[rest] ?? humanise(rest));
        break;
      case "type":
        out.set(dim, SOURCE_TYPE_LABEL[rest] ?? humanise(rest));
        break;
      default:
        out.set(dim, humanise(rest));
    }
  }

  const lookups: [string, string, number[]][] = [
    ["offer", "SELECT id, title AS name FROM offers WHERE id = ANY($1::int[])", ids.offer],
    [
      "affiliate",
      "SELECT id, COALESCE(NULLIF(name, ''), email::text) AS name FROM affiliates WHERE id = ANY($1::int[])",
      ids.affiliate,
    ],
    ["broadcast", "SELECT id, name FROM email_campaigns WHERE id = ANY($1::int[])", ids.broadcast],
    ["sequence", "SELECT id, name FROM email_sequences WHERE id = ANY($1::int[])", ids.sequence],
  ];

  for (const [kind, sql, wanted] of lookups) {
    if (wanted.length === 0) continue;
    const res = await pool.query<{ id: number; name: string }>(sql, [wanted]);
    const byId = new Map(res.rows.map((r) => [r.id, r.name]));
    for (const id of wanted) {
      // A row that has since been deleted still has history behind it; saying so
      // is better than dropping the money it earned out of the table.
      out.set(`${kind}:${id}`, byId.get(id) ?? "No longer here");
    }
  }

  return out;
}

interface BreakdownOptions {
  metric: string;
  prefix: string;
  from: string;
  to: string;
  currency?: string;
  /** `count` orders by the count column; money reports order by money. */
  by?: "money" | "count";
  limit?: number;
  /**
   * Words for a dimension the generic labeller has none for. Cancellation
   * reasons use it: their wording belongs to the owner's own list, and "Too
   * expensive" guessed from the key is not what the customer was shown.
   */
  labeller?: () => Promise<(dimension: string) => string | undefined>;
}

async function readBreakdown(opts: BreakdownOptions): Promise<ReportBreakdownRow[]> {
  const res = await pool.query<{ dimension: string; cents: string; count: number }>(
    `SELECT dimension,
            SUM(value_cents)::bigint AS cents,
            SUM(value_count)::int    AS count
       FROM report_daily
      WHERE metric = $3
        AND day BETWEEN $1::date AND $2::date
        AND dimension LIKE $4
        AND ($5::text IS NULL OR currency = $5)
      GROUP BY dimension
      ORDER BY ${opts.by === "count" ? "3 DESC, 2 DESC" : "2 DESC, 3 DESC"}
      LIMIT $6`,
    [opts.from, opts.to, opts.metric, `${opts.prefix}%`, opts.currency ?? null, opts.limit ?? 50]
  );

  const labels = await labelDimensions(res.rows.map((r) => r.dimension));
  const own = opts.labeller ? await opts.labeller() : undefined;
  return res.rows.map((r) => ({
    label: own?.(r.dimension) ?? labels.get(r.dimension) ?? r.dimension,
    value: opts.by === "count" ? r.count : Number(r.cents),
    count: opts.by === "count" ? Number(r.cents) : r.count,
  }));
}

/* --------------------------------------------------- the generic rollup report */

type Aggregate = "sum" | "last";

interface MetricReportOptions {
  metric: string;
  /** Which column the chart plots. */
  value: "money" | "count";
  seriesLabel: string;
  /** How the headline total is derived — a snapshot metric takes the last day. */
  aggregate?: Aggregate;
  totalLabel: string;
  /** A second total worth reading, taken from the other column. */
  secondaryLabel?: string;
  breakdown?: {
    prefix: string;
    label: string;
    valueLabel: string;
    /** Omit where the second column would only ever be zero — see `free_offers`. */
    countLabel?: string;
    /** See `BreakdownOptions.labeller`. */
    labeller?: () => Promise<(dimension: string) => string | undefined>;
  };
  note?: string;
}

function totalOf(rows: DailyRow[], value: "money" | "count", aggregate: Aggregate): number {
  const field = value === "money" ? "cents" : "count";
  if (aggregate === "last") return rows.length === 0 ? 0 : rows[rows.length - 1][field];
  return sum(rows, field);
}

/**
 * Builds a report that is nothing but one rolled-up metric.
 *
 * Twenty-odd of them are exactly that, and writing each one out by hand is how
 * two reports over the same metric end up disagreeing about what a comparison
 * period means.
 */
function metricReport(opts: MetricReportOptions): ReportRunner {
  const aggregate = opts.aggregate ?? "sum";
  const format: ValueFormat = opts.value === "money" ? "money" : "count";
  const secondaryFormat: ValueFormat = opts.value === "money" ? "count" : "money";

  return async (params) => {
    const rows = await readDaily({
      metric: opts.metric,
      from: params.from,
      to: params.to,
      currency: params.currency,
    });

    const headline = totalOf(rows, opts.value, aggregate);
    const totals: Record<string, ReportTotal> = {
      total: { label: opts.totalLabel, value: headline, format },
    };
    if (opts.secondaryLabel) {
      totals.secondary = {
        label: opts.secondaryLabel,
        value: totalOf(rows, opts.value === "money" ? "count" : "money", aggregate),
        format: secondaryFormat,
      };
    }

    const result: ReportResult = {
      series: [
        {
          label: opts.seriesLabel,
          format,
          points: rows.map((r) => ({
            date: r.date,
            value: opts.value === "money" ? r.cents : r.count,
          })),
        },
      ],
      totals,
      currency: currencyOf(rows),
      note: opts.note,
    };

    if (opts.breakdown) {
      result.breakdown = await readBreakdown({
        metric: opts.metric,
        prefix: opts.breakdown.prefix,
        from: params.from,
        to: params.to,
        currency: params.currency,
        by: opts.value,
        labeller: opts.breakdown.labeller,
      });
      result.breakdownLabel = opts.breakdown.label;
      result.breakdownValueLabel = opts.breakdown.valueLabel;
      if (opts.breakdown.countLabel) result.breakdownCountLabel = opts.breakdown.countLabel;
      result.breakdownFormat = format;
      // `readBreakdown` swaps the columns for a count report, so the second
      // column holds money exactly when the first one does not.
      result.breakdownCountFormat = secondaryFormat;
    }

    if (params.compareFrom && params.compareTo) {
      const before = await readDaily({
        metric: opts.metric,
        from: params.compareFrom,
        to: params.compareTo,
        currency: params.currency,
      });
      result.comparison = comparisonOf(params.compareFrom, params.compareTo, totals, {
        total: totalOf(before, opts.value, aggregate),
        ...(opts.secondaryLabel
          ? { secondary: totalOf(before, opts.value === "money" ? "count" : "money", aggregate) }
          : {}),
      });
      result.comparison.points = before.map((r) => (opts.value === "money" ? r.cents : r.count));
    }

    return result;
  };
}

/** Wraps the earlier period's numbers into the shape the screen renders. */
function comparisonOf(
  from: string,
  to: string,
  currentTotals: Record<string, ReportTotal>,
  previousValues: Record<string, number>
): ReportComparison {
  const totals: Record<string, ReportTotal> = {};
  const changes: Record<string, number | null> = {};

  for (const [key, total] of Object.entries(currentTotals)) {
    const previous = previousValues[key] ?? 0;
    totals[key] = { label: total.label, value: previous, format: total.format };
    changes[key] = change(total.value, previous);
  }

  return { from, to, totals, change: changes };
}

/** A report with a real query behind it that simply has nothing to show yet. */
function emptyResult(note: string, seriesLabel = "Nothing recorded"): ReportResult {
  return {
    series: [{ label: seriesLabel, format: "count", points: [] }],
    totals: {},
    currency: "usd",
    note,
  };
}

/* =========================================================================== */
/* Payments                                                                    */
/* =========================================================================== */

export const grossRevenue = metricReport({
  metric: "gross_revenue",
  value: "money",
  seriesLabel: "Money coming in",
  totalLabel: "Money coming in",
  secondaryLabel: "Payments taken",
  breakdown: {
    prefix: "offer:",
    label: "What was bought",
    valueLabel: "Money in",
    countLabel: "Payments",
  },
});

export const netRevenue = metricReport({
  metric: "net_revenue",
  value: "money",
  seriesLabel: "Money you keep",
  totalLabel: "Money you keep",
  secondaryLabel: "Payments taken",
  note:
    "This is everything paid to you less anything refunded. Card-processing fees are not " +
    "included yet, because your payment provider isn't sending them to us.",
});

export const refundsReport = metricReport({
  metric: "refunds",
  value: "money",
  seriesLabel: "Money refunded",
  totalLabel: "Money refunded",
  secondaryLabel: "Refunds given",
  breakdown: {
    prefix: "offer:",
    label: "What was refunded",
    valueLabel: "Money out",
    countLabel: "Refunds",
  },
});

export const paymentsByMethod = metricReport({
  metric: "gross_revenue",
  value: "money",
  seriesLabel: "Money coming in",
  totalLabel: "Money coming in",
  secondaryLabel: "Payments taken",
  breakdown: {
    prefix: "method:",
    label: "How they paid",
    valueLabel: "Money in",
    countLabel: "Payments",
  },
});

export const paymentsByPricingType = metricReport({
  metric: "gross_revenue",
  value: "money",
  seriesLabel: "Money coming in",
  totalLabel: "Money coming in",
  secondaryLabel: "Payments taken",
  breakdown: {
    prefix: "pricing:",
    label: "How it was priced",
    valueLabel: "Money in",
    countLabel: "Payments",
  },
});

/** Country by default; the viewer can switch to state, where it was captured. */
export const paymentsByLocation: ReportRunner = async (params) => {
  const byState = params.dimension === "state";
  const base = metricReport({
    metric: "gross_revenue",
    value: "money",
    seriesLabel: "Money coming in",
    totalLabel: "Money coming in",
    secondaryLabel: "Payments taken",
    breakdown: {
      prefix: byState ? "state:" : "country:",
      label: byState ? "State or region" : "Country",
      valueLabel: "Money in",
      countLabel: "Payments",
    },
    note: byState
      ? "Only payments where the buyer gave an address show a state here."
      : undefined,
  });
  return base(params);
};

export const freeOffers = metricReport({
  metric: "free_offers",
  value: "count",
  seriesLabel: "Free sign-ups",
  totalLabel: "Free sign-ups",
  breakdown: {
    prefix: "offer:",
    label: "What they claimed",
    valueLabel: "Sign-ups",
  },
});

export const paidInvoices = metricReport({
  metric: "paid_invoices",
  value: "count",
  seriesLabel: "Invoices paid",
  totalLabel: "Invoices paid",
  secondaryLabel: "Money on those invoices",
});

export const salesTax = metricReport({
  metric: "tax",
  value: "money",
  seriesLabel: "Sales tax collected",
  totalLabel: "Sales tax collected",
  secondaryLabel: "Sales it was charged on",
  breakdown: {
    prefix: "state:",
    label: "Where it was charged",
    valueLabel: "Tax collected",
    countLabel: "Sales",
  },
});

/**
 * How many of each thing was sold — items, not orders.
 *
 * Read live from `order_items` rather than from the rollup: an order containing
 * a bump is one order and two things sold, and the daily table counts orders.
 */
export const offersSold: ReportRunner = async (params) => {
  const rows = await pool.query<{ date: string; count: number; cents: string }>(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
     ),
     items AS (
       SELECT ((o.created_at AT TIME ZONE $3)::date) AS day,
              SUM(i.quantity)::int      AS count,
              SUM(i.amount_cents)::bigint AS cents
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
        WHERE o.status IN ('paid','refunded')
          AND o.created_at >= ($1::date::timestamp AT TIME ZONE $3)
          AND o.created_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
        GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(i.count, 0)::int    AS count,
            COALESCE(i.cents, 0)::bigint AS cents
       FROM days d LEFT JOIN items i ON i.day = d.day
      ORDER BY d.day`,
    [params.from, params.to, REPORT_TIMEZONE]
  );

  const breakdown = await pool.query<{ label: string; count: number; cents: string }>(
    `SELECT COALESCE(NULLIF(i.title, ''), 'Untitled') AS label,
            SUM(i.quantity)::int        AS count,
            SUM(i.amount_cents)::bigint AS cents
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
      WHERE o.status IN ('paid','refunded')
        AND o.created_at >= ($1::date::timestamp AT TIME ZONE $3)
        AND o.created_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 50`,
    [params.from, params.to, REPORT_TIMEZONE]
  );

  const sold = rows.rows.reduce((acc, r) => acc + r.count, 0);
  const cents = rows.rows.reduce((acc, r) => acc + Number(r.cents), 0);

  return {
    series: [
      {
        label: "Things sold",
        format: "count",
        points: rows.rows.map((r) => ({ date: r.date, value: r.count })),
      },
    ],
    totals: {
      total: { label: "Things sold", value: sold, format: "count" },
      secondary: { label: "What they came to", value: cents, format: "money" },
    },
    breakdown: breakdown.rows.map((r) => ({
      label: r.label,
      value: r.count,
      count: Number(r.cents),
    })),
    breakdownLabel: "What was bought",
    breakdownValueLabel: "Sold",
    breakdownCountLabel: "Money in",
    breakdownFormat: "count",
    breakdownCountFormat: "money",
    currency: "usd",
    note: "An order that included an added extra counts as two things sold.",
  };
};

export const cartOrders = metricReport({
  metric: "orders",
  value: "count",
  seriesLabel: "Orders placed",
  totalLabel: "Orders placed",
  secondaryLabel: "What they came to",
});

/* =========================================================================== */
/* Sales                                                                       */
/* =========================================================================== */

export const offerPurchases = metricReport({
  metric: "orders",
  value: "count",
  seriesLabel: "Purchases",
  totalLabel: "Purchases",
  secondaryLabel: "What they came to",
  breakdown: {
    prefix: "offer:",
    label: "What was bought",
    valueLabel: "Purchases",
    countLabel: "Money in",
  },
});

export const paymentsByOffer = metricReport({
  metric: "gross_revenue",
  value: "money",
  seriesLabel: "Money coming in",
  totalLabel: "Money coming in",
  secondaryLabel: "Payments taken",
  breakdown: {
    prefix: "offer:",
    label: "What was bought",
    valueLabel: "Money in",
    countLabel: "Payments",
  },
});

export const upsellPurchases = metricReport({
  metric: "upsell_orders",
  value: "money",
  seriesLabel: "Money from extras",
  totalLabel: "Money from extras",
  secondaryLabel: "Extras bought",
  breakdown: {
    prefix: "offer:",
    label: "Which extra",
    valueLabel: "Money in",
    countLabel: "Bought",
  },
  note: "Extras are the things people added straight after buying something else.",
});

/** What the abandoned-cart reminder emails brought back, against what was left. */
export const cartRecovery: ReportRunner = async (params) => {
  const [recovered, abandoned] = await Promise.all([
    readDaily({ metric: "cart_recovered", from: params.from, to: params.to, currency: params.currency }),
    readDaily({ metric: "abandoned_carts", from: params.from, to: params.to, currency: params.currency }),
  ]);

  const recoveredCents = sum(recovered, "cents");
  const recoveredCount = sum(recovered, "count");
  const abandonedCount = sum(abandoned, "count");

  const totals: Record<string, ReportTotal> = {
    total: { label: "Money brought back", value: recoveredCents, format: "money" },
    secondary: { label: "Carts brought back", value: recoveredCount, format: "count" },
    abandoned: { label: "Carts left behind", value: abandonedCount, format: "count" },
    rate: {
      label: "Brought back",
      value: ratio(recoveredCount, abandonedCount),
      format: "percent",
    },
  };

  const result: ReportResult = {
    series: [
      {
        label: "Money brought back",
        format: "money",
        points: recovered.map((r) => ({ date: r.date, value: r.cents })),
      },
    ],
    totals,
    breakdown: await readBreakdown({
      metric: "cart_recovered",
      prefix: "offer:",
      from: params.from,
      to: params.to,
      currency: params.currency,
    }),
    breakdownLabel: "What they came back for",
    breakdownValueLabel: "Money back",
    breakdownCountLabel: "Carts",
    breakdownFormat: "money",
    currency: currencyOf(recovered),
    note:
      "Only purchases after a tracked reminder link count as recovered revenue, attributed to the last reminder followed. Recorded on the day of purchase.",
  };

  if (params.compareFrom && params.compareTo) {
    const [beforeRecovered, beforeAbandoned] = await Promise.all([
      readDaily({ metric: "cart_recovered", from: params.compareFrom, to: params.compareTo }),
      readDaily({ metric: "abandoned_carts", from: params.compareFrom, to: params.compareTo }),
    ]);
    result.comparison = comparisonOf(params.compareFrom, params.compareTo, totals, {
      total: sum(beforeRecovered, "cents"),
      secondary: sum(beforeRecovered, "count"),
      abandoned: sum(beforeAbandoned, "count"),
      rate: ratio(sum(beforeRecovered, "count"), sum(beforeAbandoned, "count")),
    });
  }

  return result;
};

/* =========================================================================== */
/* Subscriptions                                                               */
/* =========================================================================== */

export const newSubscriptions = metricReport({
  metric: "new_subscriptions",
  value: "count",
  seriesLabel: "New subscribers",
  totalLabel: "New subscribers",
  secondaryLabel: "What they add each month",
  breakdown: {
    prefix: "offer:",
    label: "What they joined",
    valueLabel: "New",
    countLabel: "Each month",
  },
});

export const subscriptionMrr = metricReport({
  metric: "mrr",
  value: "money",
  aggregate: "last",
  seriesLabel: "Money every month",
  totalLabel: "Money every month",
  secondaryLabel: "People paying",
  breakdown: {
    prefix: "offer:",
    label: "Which membership",
    valueLabel: "Each month",
    countLabel: "People",
  },
  note:
    "This is where you stood on the last day of the range, not a total of the days " +
    "added together.",
});

export const canceledSubscriptions = metricReport({
  metric: "canceled_subscriptions",
  value: "count",
  seriesLabel: "People who left",
  totalLabel: "People who left",
  secondaryLabel: "Money a month lost",
  breakdown: {
    prefix: "reason:",
    label: "Why they left",
    valueLabel: "People",
    countLabel: "Each month",
    // The wording from Settings → Payments, not a guess from the key.
    labeller: async () => {
      const reasons = await ownerCancelReasons();
      return (dimension) =>
        dimension.startsWith("reason:")
          ? cancelReasonLabel(dimension.slice("reason:".length), reasons)
          : undefined;
    },
  },
});

/** The owner's current list of cancellation reasons, for report wording. */
async function ownerCancelReasons() {
  const settings = await readSetting("customer_payments");
  return parseCancelReasons(settings.cancellationReasons);
}

/** The words people typed on their way out. No chart — there is nothing to plot. */
export const cancellationFeedback: ReportRunner = async (params) => {
  const res = await pool.query<{ feedback: string; reason: string; count: number }>(
    `SELECT s.cancel_feedback AS feedback,
            COALESCE(NULLIF(s.cancel_reason, ''), 'not given') AS reason,
            COUNT(*)::int AS count
       FROM subscriptions s
      WHERE s.cancel_feedback <> ''
        AND COALESCE(s.canceled_at, s.ended_at) >= ($1::date::timestamp AT TIME ZONE $3)
        AND COALESCE(s.canceled_at, s.ended_at) <  (($2::date + 1)::timestamp AT TIME ZONE $3)
      GROUP BY 1, 2
      ORDER BY 3 DESC, 1
      LIMIT 200`,
    [params.from, params.to, REPORT_TIMEZONE]
  );

  const reasons = await ownerCancelReasons();

  if (res.rows.length === 0) {
    return emptyResult(
      "Nobody left a note when they cancelled in this period.",
      "Notes left when cancelling"
    );
  }

  return {
    series: [],
    totals: {
      total: {
        label: "Notes left",
        value: res.rows.reduce((acc, r) => acc + r.count, 0),
        format: "count",
      },
    },
    breakdown: res.rows.map((r) => ({
      label: `${r.feedback} (${cancelReasonLabel(r.reason, reasons)})`,
      value: r.count,
      count: r.count,
    })),
    breakdownLabel: "What they said",
    breakdownValueLabel: "People",
    breakdownFormat: "count",
    currency: "usd",
    note: "These are people's own words, so there is nothing to chart.",
  };
};

/** Where every membership stands right now, grouped by what they joined. */
export const subscriptionStatusByOffer: ReportRunner = async () => {
  const res = await pool.query<{ label: string; status: string; count: number; cents: string }>(
    `SELECT COALESCE(NULLIF(f.title, ''), NULLIF(p.name, ''), 'Not linked to an offer') AS label,
            s.status,
            COUNT(*)::int AS count,
            SUM(s.amount_cents)::bigint AS cents
       FROM subscriptions s
       LEFT JOIN offers f ON f.id = s.offer_id
       LEFT JOIN plans  p ON p.id = s.plan_id
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 200`
  );

  if (res.rows.length === 0) {
    return emptyResult("Nobody has a membership yet.", "Memberships");
  }

  const STATUS: Record<string, string> = {
    active: "Paying",
    trialing: "On a trial",
    past_due: "Payment failed",
    canceled: "Cancelled",
    unpaid: "Unpaid",
    incomplete: "Never started",
  };

  return {
    series: [],
    totals: {
      total: {
        label: "Memberships",
        value: res.rows.reduce((acc, r) => acc + r.count, 0),
        format: "count",
      },
      secondary: {
        label: "Paying right now",
        value: res.rows
          .filter((r) => r.status === "active" || r.status === "trialing")
          .reduce((acc, r) => acc + r.count, 0),
        format: "count",
      },
    },
    breakdown: res.rows.map((r) => ({
      label: `${r.label} — ${STATUS[r.status] ?? humanise(r.status)}`,
      value: r.count,
      count: Number(r.cents),
    })),
    breakdownLabel: "Membership and where it stands",
    breakdownValueLabel: "People",
    breakdownCountLabel: "Charged each time",
    breakdownFormat: "count",
    breakdownCountFormat: "money",
    currency: "usd",
    note: "This is how things stand today, so the date range above doesn't change it.",
  };
};

/** How often a repeat charge actually goes through. */
export const paymentRetention: ReportRunner = async (params) => {
  const res = await pool.query<{ date: string; succeeded: number; failed: number }>(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
     ),
     charges AS (
       SELECT ((t.occurred_at AT TIME ZONE $3)::date) AS day,
              COUNT(*) FILTER (WHERE t.status IN ('succeeded','refunded','disputed'))::int AS succeeded,
              COUNT(*) FILTER (WHERE t.status = 'failed')::int                              AS failed
         FROM transactions t
        WHERE t.kind = 'payment'
          AND t.subscription_id IS NOT NULL
          AND t.occurred_at >= ($1::date::timestamp AT TIME ZONE $3)
          AND t.occurred_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
        GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(c.succeeded, 0)::int AS succeeded,
            COALESCE(c.failed, 0)::int    AS failed
       FROM days d LEFT JOIN charges c ON c.day = d.day
      ORDER BY d.day`,
    [params.from, params.to, REPORT_TIMEZONE]
  );

  const succeeded = res.rows.reduce((acc, r) => acc + r.succeeded, 0);
  const failed = res.rows.reduce((acc, r) => acc + r.failed, 0);

  return {
    series: [
      {
        label: "Payments that went through",
        format: "count",
        points: res.rows.map((r) => ({ date: r.date, value: r.succeeded })),
      },
      {
        label: "Payments that failed",
        format: "count",
        points: res.rows.map((r) => ({ date: r.date, value: r.failed })),
      },
    ],
    totals: {
      total: { label: "Went through", value: ratio(succeeded, succeeded + failed), format: "percent" },
      secondary: { label: "Repeat payments taken", value: succeeded, format: "count" },
      failed: { label: "Payments that failed", value: failed, format: "count" },
    },
    currency: "usd",
    note: "Only repeat payments on a membership count here, not first-time purchases.",
  };
};

/** People who left, as a share of the people there were to lose. */
export const churnRate: ReportRunner = async (params) => {
  const [left, active] = await Promise.all([
    readDaily({ metric: "canceled_subscriptions", from: params.from, to: params.to }),
    readDaily({ metric: "mrr", from: params.from, to: params.to }),
  ]);

  const points = left.map((row, i) => {
    const base = (active[i]?.count ?? 0) + row.count;
    return { date: row.date, value: ratio(row.count, base) };
  });

  const leftTotal = sum(left, "count");
  const startingBase = (active[0]?.count ?? 0) + (left[0]?.count ?? 0);

  const totals: Record<string, ReportTotal> = {
    total: { label: "People who left", value: ratio(leftTotal, startingBase), format: "percent" },
    secondary: { label: "People who left", value: leftTotal, format: "count" },
  };

  const result: ReportResult = {
    series: [{ label: "Leaving each day", format: "percent", points }],
    totals,
    currency: "usd",
    note:
      "The percentage compares everyone who left over the range with how many " +
      "memberships there were at the start of it.",
  };

  if (params.compareFrom && params.compareTo) {
    const [beforeLeft, beforeActive] = await Promise.all([
      readDaily({ metric: "canceled_subscriptions", from: params.compareFrom, to: params.compareTo }),
      readDaily({ metric: "mrr", from: params.compareFrom, to: params.compareTo }),
    ]);
    const beforeLeftTotal = sum(beforeLeft, "count");
    const beforeBase = (beforeActive[0]?.count ?? 0) + (beforeLeft[0]?.count ?? 0);
    result.comparison = comparisonOf(params.compareFrom, params.compareTo, totals, {
      total: ratio(beforeLeftTotal, beforeBase),
      secondary: beforeLeftTotal,
    });
  }

  return result;
};

/** What the average member is worth each month. */
export const averageRevenuePerMember: ReportRunner = async (params) => {
  const rows = await readDaily({
    metric: "mrr",
    from: params.from,
    to: params.to,
    currency: params.currency,
  });

  const points = rows.map((r) => ({
    date: r.date,
    value: r.count === 0 ? 0 : Math.round(r.cents / r.count),
  }));
  const lastValue = points.length === 0 ? 0 : points[points.length - 1].value;
  const lastRow = rows[rows.length - 1];

  const totals: Record<string, ReportTotal> = {
    total: { label: "Average each member pays a month", value: lastValue, format: "money" },
    secondary: { label: "People paying", value: lastRow?.count ?? 0, format: "count" },
  };

  const result: ReportResult = {
    series: [{ label: "Average each member pays", format: "money", points }],
    totals,
    currency: currencyOf(rows),
    note: "Taken on the last day of the range rather than added up across it.",
  };

  if (params.compareFrom && params.compareTo) {
    const before = await readDaily({ metric: "mrr", from: params.compareFrom, to: params.compareTo });
    const beforeLast = before[before.length - 1];
    result.comparison = comparisonOf(params.compareFrom, params.compareTo, totals, {
      total: beforeLast && beforeLast.count > 0 ? Math.round(beforeLast.cents / beforeLast.count) : 0,
      secondary: beforeLast?.count ?? 0,
    });
  }

  return result;
};

/**
 * Where monthly income is heading if nothing changes.
 *
 * Deliberately the plainest possible projection: today's monthly total, carried
 * forward twelve months and adjusted by the average month-on-month movement over
 * the range being viewed. Anything cleverer would look authoritative without
 * being any more likely to be right, and this is labelled as a guess on screen.
 */
export const subscriptionForecast: ReportRunner = async (params) => {
  const rows = await readDaily({
    metric: "mrr",
    from: params.from,
    to: params.to,
    currency: params.currency,
  });

  if (rows.length === 0 || rows[rows.length - 1].cents === 0) {
    return emptyResult(
      "There are no memberships to look ahead from yet.",
      "Money every month, looking ahead"
    );
  }

  const current = rows[rows.length - 1].cents;
  const start = rows[0].cents;
  const months = Math.max(daysBetween(params.from, params.to) / 30, 1);
  // Average monthly growth over the window, capped so a single first sale in an
  // empty month cannot project a fantasy.
  const monthlyGrowth =
    start > 0 ? Math.min(Math.max(Math.pow(current / start, 1 / months) - 1, -0.5), 0.5) : 0;

  const points: ReportPoint[] = [];
  let value = current;
  let date = rows[rows.length - 1].date;
  for (let i = 1; i <= 12; i += 1) {
    value = Math.round(value * (1 + monthlyGrowth));
    date = shiftDay(date, 30);
    points.push({ date, value });
  }

  return {
    series: [{ label: "Money every month, if nothing changes", format: "money", points }],
    totals: {
      total: { label: "Money every month today", value: current, format: "money" },
      secondary: { label: "In twelve months, at this rate", value, format: "money" },
    },
    currency: currencyOf(rows),
    note:
      "This is a guess, not a promise. It takes where you are now and carries " +
      "forward how fast things have been moving over the range you picked.",
  };
};

/* =========================================================================== */
/* Payment plans                                                               */
/* =========================================================================== */

export const newPaymentPlans = metricReport({
  metric: "new_payment_plans",
  value: "count",
  seriesLabel: "New payment plans",
  totalLabel: "New payment plans",
  secondaryLabel: "Worth in total",
  breakdown: {
    prefix: "offer:",
    label: "What they're paying off",
    valueLabel: "Plans",
    countLabel: "Worth",
  },
  note: "The value is the whole plan, not the first instalment.",
});

export const paymentPlanStatusByOffer: ReportRunner = async () => {
  const res = await pool.query<{ label: string; status: string; count: number; cents: string }>(
    `SELECT COALESCE(NULLIF(f.title, ''), 'Not linked to an offer') AS label,
            p.status,
            COUNT(*)::int AS count,
            SUM(p.installment_cents::bigint *
                GREATEST(p.installment_count - p.installments_paid, 0))::bigint AS cents
       FROM payment_plans p
       LEFT JOIN offers f ON f.id = p.offer_id
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 200`
  );

  if (res.rows.length === 0) {
    return emptyResult("Nobody is paying in instalments yet.", "Payment plans");
  }

  const STATUS: Record<string, string> = {
    active: "Paying",
    completed: "Paid off",
    past_due: "Payment failed",
    canceled: "Cancelled",
  };

  return {
    series: [],
    totals: {
      total: {
        label: "Payment plans",
        value: res.rows.reduce((acc, r) => acc + r.count, 0),
        format: "count",
      },
      secondary: {
        label: "Still to be paid",
        value: res.rows
          .filter((r) => r.status === "active" || r.status === "past_due")
          .reduce((acc, r) => acc + Number(r.cents), 0),
        format: "money",
      },
    },
    breakdown: res.rows.map((r) => ({
      label: `${r.label} — ${STATUS[r.status] ?? humanise(r.status)}`,
      value: r.count,
      count: Number(r.cents),
    })),
    breakdownLabel: "Plan and where it stands",
    breakdownValueLabel: "Plans",
    breakdownCountLabel: "Still to pay",
    breakdownFormat: "count",
    breakdownCountFormat: "money",
    currency: "usd",
    note: "This is how things stand today, so the date range above doesn't change it.",
  };
};

export const paymentPlanMrr = metricReport({
  metric: "plan_mrr",
  value: "money",
  aggregate: "last",
  seriesLabel: "Instalments due each month",
  totalLabel: "Instalments due each month",
  secondaryLabel: "Plans still running",
  breakdown: {
    prefix: "offer:",
    label: "What they're paying off",
    valueLabel: "Each month",
    countLabel: "Plans",
  },
  note: "Taken on the last day of the range rather than added up across it.",
});

export const canceledPaymentPlans = metricReport({
  metric: "canceled_payment_plans",
  value: "count",
  seriesLabel: "Plans cancelled",
  totalLabel: "Plans cancelled",
  secondaryLabel: "Money left unpaid",
  breakdown: {
    prefix: "reason:",
    label: "Why it stopped",
    valueLabel: "Plans",
    countLabel: "Left unpaid",
  },
});

/* =========================================================================== */
/* Contacts                                                                    */
/* =========================================================================== */

export const newContacts = metricReport({
  metric: "new_contacts",
  value: "count",
  seriesLabel: "New people",
  totalLabel: "New people",
  breakdown: {
    prefix: "source:",
    label: "Where they came from",
    valueLabel: "People",
  },
});

export const optins = metricReport({
  metric: "optins",
  value: "count",
  seriesLabel: "People who said yes to email",
  totalLabel: "People who said yes to email",
  breakdown: {
    prefix: "source:",
    label: "Where they signed up",
    valueLabel: "People",
  },
});

/** Who has spent the most with you, all time. */
export const topCustomers: ReportRunner = async () => {
  const res = await pool.query<{ label: string; cents: number; orders: number }>(
    `SELECT COALESCE(NULLIF(c.name, ''), c.email::text) AS label,
            c.lifetime_value_cents AS cents,
            c.order_count          AS orders
       FROM contacts c
      WHERE c.order_count > 0
      ORDER BY c.lifetime_value_cents DESC
      LIMIT 50`
  );

  if (res.rows.length === 0) {
    return emptyResult("Nobody has bought anything yet.", "Top customers");
  }

  return {
    series: [],
    totals: {
      total: {
        label: "Spent by your top 50",
        value: res.rows.reduce((acc, r) => acc + r.cents, 0),
        format: "money",
      },
      secondary: { label: "Customers listed", value: res.rows.length, format: "count" },
    },
    breakdown: res.rows.map((r) => ({ label: r.label, value: r.cents, count: r.orders })),
    breakdownLabel: "Customer",
    breakdownValueLabel: "Spent",
    breakdownCountLabel: "Purchases",
    breakdownFormat: "money",
    currency: "usd",
    note: "All-time spending, so the date range above doesn't change it.",
  };
};

/* =========================================================================== */
/* Products                                                                    */
/* =========================================================================== */

/** How far people have got through each course. */
export const productProgress: ReportRunner = async () => {
  const res = await pool.query<{
    label: string;
    members: number;
    average: number;
    finished: number;
  }>(
    `SELECT c.title AS label,
            COUNT(*)::int                                        AS members,
            COALESCE(ROUND(AVG(p.percent)), 0)::int              AS average,
            COUNT(*) FILTER (WHERE p.completed_at IS NOT NULL)::int AS finished
       FROM course_progress p
       JOIN courses c ON c.id = p.course_id
      GROUP BY c.id, c.title
      ORDER BY 2 DESC
      LIMIT 100`
  );

  if (res.rows.length === 0) {
    return emptyResult("Nobody has started a course yet.", "Course progress");
  }

  const members = res.rows.reduce((acc, r) => acc + r.members, 0);
  const finished = res.rows.reduce((acc, r) => acc + r.finished, 0);

  return {
    series: [],
    totals: {
      total: { label: "People part-way through", value: members, format: "count" },
      secondary: { label: "People who finished", value: finished, format: "count" },
      rate: { label: "Finished", value: ratio(finished, members), format: "percent" },
    },
    breakdown: res.rows.map((r) => ({ label: r.label, value: r.average, count: r.members })),
    breakdownLabel: "Course",
    breakdownValueLabel: "Average progress",
    breakdownCountLabel: "People",
    breakdownFormat: "percent",
    currency: "usd",
    note:
      "Progress is counted as people watch, so it is a snapshot of today rather " +
      "than of the date range above.",
  };
};

/* =========================================================================== */
/* Website                                                                     */
/* =========================================================================== */

/**
 * Views and sign-ups on each landing page.
 *
 * `funnel_steps` keeps a running counter rather than one row per visit, so there
 * is no way to say how many views happened on a Tuesday. The table is honest
 * about that instead of drawing a flat line and calling it history.
 */
export const pageViews: ReportRunner = async () => {
  const res = await pool.query<{
    label: string;
    views: number;
    conversions: number;
  }>(
    `SELECT COALESCE(NULLIF(s.name, ''), 'Untitled page') || ' — ' || f.name AS label,
            s.views,
            s.conversions
       FROM funnel_steps s
       JOIN funnels f ON f.id = s.funnel_id
      ORDER BY s.views DESC
      LIMIT 100`
  );

  if (res.rows.length === 0) {
    return emptyResult("No landing pages have been visited yet.", "Page views");
  }

  const views = res.rows.reduce((acc, r) => acc + r.views, 0);
  const conversions = res.rows.reduce((acc, r) => acc + r.conversions, 0);

  return {
    series: [],
    totals: {
      total: { label: "Page views", value: views, format: "count" },
      secondary: { label: "People who signed up", value: conversions, format: "count" },
      rate: { label: "Signed up", value: ratio(conversions, views), format: "percent" },
    },
    breakdown: res.rows.map((r) => ({ label: r.label, value: r.views, count: r.conversions })),
    breakdownLabel: "Page",
    breakdownValueLabel: "Views",
    breakdownCountLabel: "Sign-ups",
    breakdownFormat: "count",
    currency: "usd",
    note:
      "Your pages keep a running total of visits rather than a diary of them, so " +
      "this is everything since the page went up — the date range doesn't change it.",
  };
};

/* =========================================================================== */
/* Affiliates                                                                  */
/* =========================================================================== */

export const affiliatePerformance = metricReport({
  metric: "affiliate_orders",
  value: "money",
  seriesLabel: "Sales your partners brought in",
  totalLabel: "Sales your partners brought in",
  secondaryLabel: "Orders",
  breakdown: {
    prefix: "affiliate:",
    label: "Partner",
    valueLabel: "Sales brought in",
    countLabel: "Orders",
  },
});

export const affiliateCommission = metricReport({
  metric: "affiliate_commission",
  value: "money",
  seriesLabel: "Commission earned",
  totalLabel: "Commission earned",
  secondaryLabel: "Commissions",
  breakdown: {
    prefix: "affiliate:",
    label: "Partner",
    valueLabel: "Earned",
    countLabel: "Commissions",
  },
});

/** How many people each partner has actually brought you. */
export const affiliateReferrals: ReportRunner = async (params) => {
  const res = await pool.query<{ label: string; people: number; cents: string }>(
    `SELECT COALESCE(NULLIF(a.name, ''), a.email::text)                AS label,
            COUNT(DISTINCT COALESCE(o.contact_id, o.member_id))::int   AS people,
            SUM(GREATEST(o.total_cents, o.amount_cents))::bigint       AS cents
       FROM affiliates a
       JOIN orders o ON o.affiliate_id = a.id
      WHERE o.status IN ('paid','refunded')
        AND o.created_at >= ($1::date::timestamp AT TIME ZONE $3)
        AND o.created_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
      GROUP BY a.id, 1
      ORDER BY 2 DESC
      LIMIT 100`,
    [params.from, params.to, REPORT_TIMEZONE]
  );

  if (res.rows.length === 0) {
    return emptyResult(
      "No partner has brought you a customer in this period.",
      "People your partners brought"
    );
  }

  return {
    series: [],
    totals: {
      total: {
        label: "People they brought",
        value: res.rows.reduce((acc, r) => acc + r.people, 0),
        format: "count",
      },
      secondary: {
        label: "What those people spent",
        value: res.rows.reduce((acc, r) => acc + Number(r.cents), 0),
        format: "money",
      },
    },
    breakdown: res.rows.map((r) => ({
      label: r.label,
      value: r.people,
      count: Number(r.cents),
    })),
    breakdownLabel: "Partner",
    breakdownValueLabel: "People brought",
    breakdownCountLabel: "They spent",
    breakdownFormat: "count",
    breakdownCountFormat: "money",
    currency: "usd",
  };
};

/* =========================================================================== */
/* Email                                                                       */
/* =========================================================================== */

const EMAIL_METRICS = [
  ["email_sends", "Sent"],
  ["email_opens", "Opened"],
  ["email_clicks", "Clicked"],
  ["email_unsubs", "Unsubscribed"],
  ["email_bounces", "Bounced"],
] as const;

/**
 * Sends, opens, clicks, unsubscribes and bounces for one kind of mailing.
 *
 * The breakdown lists each broadcast or sequence with what it was sent to and
 * how many opened it, which is the pair anybody actually compares.
 */
function emailReport(kind: "broadcast" | "sequence", noun: string, note?: string): ReportRunner {
  return async (params) => {
    const daily = await Promise.all(
      EMAIL_METRICS.map(([metric]) =>
        readDaily({
          metric,
          from: params.from,
          to: params.to,
          dimensionPrefix: `${kind}:`,
        })
      )
    );

    const [sends, opens, clicks, unsubs, bounces] = daily.map((rows) => sum(rows, "count"));

    const totals: Record<string, ReportTotal> = {
      total: { label: `${noun} sent`, value: sends, format: "count" },
      opened: { label: "Opened", value: opens, format: "count" },
      openRate: { label: "Opened", value: ratio(opens, sends), format: "percent" },
      clicked: { label: "Clicked a link", value: clicks, format: "count" },
      clickRate: { label: "Clicked a link", value: ratio(clicks, sends), format: "percent" },
      unsubscribed: { label: "Unsubscribed", value: unsubs, format: "count" },
      bounced: { label: "Didn't arrive", value: bounces, format: "count" },
    };

    const [sendRows, openRows, clickRows] = daily;
    const result: ReportResult = {
      series: [
        {
          label: "Sent",
          format: "count",
          points: sendRows.map((r) => ({ date: r.date, value: r.count })),
        },
        {
          label: "Opened",
          format: "count",
          points: openRows.map((r) => ({ date: r.date, value: r.count })),
        },
        {
          label: "Clicked",
          format: "count",
          points: clickRows.map((r) => ({ date: r.date, value: r.count })),
        },
      ],
      totals,
      currency: "usd",
      note,
    };

    const [sent, opened] = await Promise.all([
      readBreakdown({
        metric: "email_sends",
        prefix: `${kind}:`,
        from: params.from,
        to: params.to,
        by: "count",
      }),
      readBreakdown({
        metric: "email_opens",
        prefix: `${kind}:`,
        from: params.from,
        to: params.to,
        by: "count",
      }),
    ]);

    const openedByLabel = new Map(opened.map((r) => [r.label, r.value]));
    result.breakdown = sent.map((r) => ({
      label: r.label,
      value: r.value,
      count: openedByLabel.get(r.label) ?? 0,
    }));
    result.breakdownLabel = noun;
    result.breakdownValueLabel = "Sent";
    result.breakdownCountLabel = "Opened";
    result.breakdownFormat = "count";

    return result;
  };
}

export const broadcastEmails = emailReport("broadcast", "Email");
export const sequenceEmails = emailReport(
  "sequence",
  "Sequence",
  "Figures are grouped by sequence rather than by each email in it, because that " +
    "is the level your sending records keep."
);

/* =========================================================================== */
/* The catalogue                                                               */
/* =========================================================================== */

export const REPORT_GROUPS = [
  "Payments",
  "Sales",
  "Subscriptions",
  "Payment plans",
  "Contacts",
  "Products",
  "Website",
  "Affiliates",
  "Email",
] as const;

export const REPORTS: ReportDefinition[] = [
  /* Payments */
  {
    id: "gross-revenue",
    name: "Money coming in",
    group: "Payments",
    description: "Everything people paid you, day by day, before anything comes off it.",
    run: grossRevenue,
  },
  {
    id: "net-revenue",
    name: "Money you keep",
    group: "Payments",
    description: "What's left after refunds.",
    run: netRevenue,
  },
  {
    id: "refunds",
    name: "Refunds",
    group: "Payments",
    description: "Money given back, and what it was given back for.",
    run: refundsReport,
  },
  {
    id: "payments-by-method",
    name: "How people paid",
    group: "Payments",
    description: "Card, bank transfer, or something else.",
    run: paymentsByMethod,
  },
  {
    id: "payments-by-pricing-type",
    name: "One-off, plan or membership",
    group: "Payments",
    description: "Which way of paying brings in the most.",
    run: paymentsByPricingType,
  },
  {
    id: "payments-by-location",
    name: "Where your buyers are",
    group: "Payments",
    description: "Money coming in by country, or by state where you have it.",
    dimensions: [
      { key: "country", label: "By country" },
      { key: "state", label: "By state" },
    ],
    run: paymentsByLocation,
  },
  {
    id: "free-offers",
    name: "Free sign-ups",
    group: "Payments",
    description: "People claiming something you give away.",
    run: freeOffers,
  },
  {
    id: "paid-invoices",
    name: "Invoices paid",
    group: "Payments",
    description: "Membership and instalment invoices that were settled.",
    run: paidInvoices,
  },
  {
    id: "sales-tax",
    name: "Sales tax collected",
    group: "Payments",
    description: "Tax charged on your sales, and where it was charged.",
    run: salesTax,
  },
  {
    id: "offers-sold",
    name: "Things sold",
    group: "Payments",
    description: "How many of each thing people bought.",
    run: offersSold,
  },
  {
    id: "cart-orders",
    name: "Orders placed",
    group: "Payments",
    description: "How many times someone completed a checkout.",
    run: cartOrders,
  },

  /* Sales */
  {
    id: "offer-purchases",
    name: "Purchases over time",
    group: "Sales",
    description: "Every purchase, day by day, and what was bought.",
    run: offerPurchases,
  },
  {
    id: "payments-by-offer",
    name: "Money by what was bought",
    group: "Sales",
    description: "Which of your offers earns the most.",
    run: paymentsByOffer,
  },
  {
    id: "upsell-purchases",
    name: "Extras bought after checkout",
    group: "Sales",
    description: "What people added straight after buying something else.",
    run: upsellPurchases,
  },
  {
    id: "cart-recovery",
    name: "Money brought back by reminder emails",
    group: "Sales",
    description: "Carts left behind, and the ones your reminder emails rescued.",
    run: cartRecovery,
  },

  /* Subscriptions */
  {
    id: "subscriptions-new",
    name: "New members",
    group: "Subscriptions",
    description: "People joining a membership.",
    run: newSubscriptions,
  },
  {
    id: "subscriptions-mrr",
    name: "Money every month",
    group: "Subscriptions",
    description: "What everyone on a membership adds up to each month.",
    run: subscriptionMrr,
  },
  {
    id: "subscriptions-canceled",
    name: "People who left",
    group: "Subscriptions",
    description: "Cancellations, and the reason each one gave.",
    run: canceledSubscriptions,
  },
  {
    id: "subscriptions-feedback",
    name: "What people said when they left",
    group: "Subscriptions",
    description: "The notes people typed on their way out.",
    run: cancellationFeedback,
  },
  {
    id: "subscriptions-status-by-offer",
    name: "Where every membership stands",
    group: "Subscriptions",
    description: "Who's paying, who's on a trial, whose payment failed.",
    run: subscriptionStatusByOffer,
  },
  {
    id: "subscriptions-retention",
    name: "Repeat payments going through",
    group: "Subscriptions",
    description: "How often a membership's next payment actually succeeds.",
    run: paymentRetention,
  },
  {
    id: "subscriptions-churn",
    name: "How many people leave",
    group: "Subscriptions",
    description: "Cancellations as a share of the members you had.",
    run: churnRate,
  },
  {
    id: "subscriptions-arpu",
    name: "Average a member pays",
    group: "Subscriptions",
    description: "What one member is worth to you each month.",
    run: averageRevenuePerMember,
  },
  {
    id: "subscriptions-forecast",
    name: "Where monthly income is heading",
    group: "Subscriptions",
    description: "A rough look at the next twelve months if nothing changes.",
    run: subscriptionForecast,
  },

  /* Payment plans */
  {
    id: "plans-new",
    name: "New payment plans",
    group: "Payment plans",
    description: "People choosing to pay in instalments.",
    run: newPaymentPlans,
  },
  {
    id: "plans-status-by-offer",
    name: "Where every plan stands",
    group: "Payment plans",
    description: "Who's still paying, who's paid off, whose payment failed.",
    run: paymentPlanStatusByOffer,
  },
  {
    id: "plans-mrr",
    name: "Instalments due each month",
    group: "Payment plans",
    description: "What the instalment plans bring in monthly.",
    run: paymentPlanMrr,
  },
  {
    id: "plans-canceled",
    name: "Plans cancelled",
    group: "Payment plans",
    description: "Plans that stopped before they were paid off.",
    run: canceledPaymentPlans,
  },

  /* Contacts */
  {
    id: "contacts-new",
    name: "New people",
    group: "Contacts",
    description: "Everyone who joined your list, day by day.",
    run: newContacts,
  },
  {
    id: "contacts-top-customers",
    name: "Your best customers",
    group: "Contacts",
    description: "Who has spent the most with you.",
    run: topCustomers,
  },
  {
    id: "contacts-optins",
    name: "People who said yes to email",
    group: "Contacts",
    description: "Sign-ups to hear from you, and where they came from.",
    run: optins,
  },

  /* Products */
  {
    id: "product-progress",
    name: "How far people get",
    group: "Products",
    description: "Average progress through each course, and who finished.",
    run: productProgress,
  },

  /* Website */
  {
    id: "website-page-views",
    name: "Page visits",
    group: "Website",
    description: "Visits to each landing page and how many signed up.",
    run: pageViews,
  },

  /* Affiliates */
  {
    id: "affiliates-performance",
    name: "How your partners are doing",
    group: "Affiliates",
    description: "Sales each partner brought you.",
    run: affiliatePerformance,
  },
  {
    id: "affiliates-commission",
    name: "Commission owed",
    group: "Affiliates",
    description: "What each partner has earned.",
    run: affiliateCommission,
  },
  {
    id: "affiliates-referrals",
    name: "People your partners brought",
    group: "Affiliates",
    description: "How many customers came from each partner.",
    run: affiliateReferrals,
  },

  /* Email */
  {
    id: "email-broadcasts",
    name: "How your emails did",
    group: "Email",
    description: "Sent, opened, clicked, unsubscribed and bounced, per email.",
    run: broadcastEmails,
  },
  {
    id: "email-sequences",
    name: "How your sequences did",
    group: "Email",
    description: "The same figures for your automatic email sequences.",
    run: sequenceEmails,
  },
];

const BY_ID = new Map(REPORTS.map((r) => [r.id, r]));

export function findReport(id: string): ReportDefinition | undefined {
  return BY_ID.get(id);
}

/** The catalogue, without the runner functions — what the hub screen lists. */
export function reportCatalogue(): {
  id: string;
  name: string;
  group: string;
  description: string;
  dimensions?: { key: string; label: string }[];
}[] {
  return REPORTS.map(({ id, name, group, description, dimensions }) => ({
    id,
    name,
    group,
    description,
    ...(dimensions ? { dimensions } : {}),
  }));
}
