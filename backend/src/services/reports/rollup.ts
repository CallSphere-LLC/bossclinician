import { pool } from "../../db/pool";

/**
 * The daily rollup that every report reads.
 *
 * All thirty-odd reports slice the same handful of facts by day. Deriving each
 * of them from `transactions` and `orders` on every page view is what makes a
 * reports screen take ten seconds to paint, so those facts are aggregated once
 * per day into `report_daily` and read back from there. The raw tables stay the
 * source of truth: this table is a cache, and the whole of it can be thrown away
 * and rebuilt from a single call.
 *
 * Three properties are load-bearing:
 *
 *  - **Idempotent.** Every metric is a full recompute of its window, written
 *    with `ON CONFLICT DO UPDATE`. The first thing anyone does with a number
 *    they distrust is rebuild it, and a rebuild that produces a different answer
 *    the second time is worse than no rebuild at all.
 *  - **Self-cleaning.** A row whose underlying facts have gone away — an order
 *    deleted, an offer's last sale refunded out of existence — would otherwise
 *    survive forever as a stale dimension. Every run stamps what it wrote and
 *    sweeps anything in the window it did not.
 *  - **Serialised.** Two overlapping rebuilds would sweep each other's rows, so
 *    a transaction-scoped advisory lock makes the second wait for the first.
 */

/**
 * The zone days are cut in.
 *
 * A US business's "Tuesday" ends at midnight in New York, not at midnight UTC;
 * bucketing on a raw `::date` would file every evening sale under the next day
 * and make the daily figures disagree with the Stripe dashboard.
 */
export const REPORT_TIMEZONE = "America/New_York";

/** Any constant works; it only has to be the same one in every rollup process. */
const ROLLUP_LOCK_KEY = 0x7265706f; // "repo"

export interface RollupRange {
  /** Inclusive, YYYY-MM-DD in {@link REPORT_TIMEZONE}. */
  from: string;
  /** Inclusive. */
  to: string;
}

export interface RollupResult extends RollupRange {
  metrics: number;
  rowsWritten: number;
  rowsRemoved: number;
}

/* ------------------------------------------------------------ SQL fragments */

/**
 * Every metric query takes the same three parameters — $1 from, $2 to, $3
 * timezone — so one wrapper can run all of them and none of them has to
 * interpolate a date. A date range arrives from a query string, and a query
 * string is user input however administrative the screen around it looks.
 */
const day = (column: string): string => `((${column} AT TIME ZONE $3)::date)`;

const within = (column: string): string =>
  `${column} >= ($1::date::timestamp AT TIME ZONE $3)` +
  ` AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE $3)`;

/**
 * The currency of an aggregated bucket.
 *
 * `report_daily` is keyed on (day, metric, dimension) and carries one currency
 * column, so a bucket that mixes currencies cannot be represented honestly as
 * either of them. It is labelled `mixed` instead and the reports surface that as
 * a caveat rather than printing a dollar sign over the top of it.
 */
const currencyOf = `CASE WHEN COUNT(DISTINCT currency) = 1 THEN MIN(currency) ELSE 'mixed' END`;

/** Count-only metrics still have to satisfy a NOT NULL currency column. */
const NO_CURRENCY = `'usd'::text`;

/**
 * A recurring charge expressed as one month of it.
 *
 * Comparing a yearly plan against a monthly one any other way makes January look
 * like a record month every year. Integer cents in, integer cents out.
 */
const monthlyCents = (amount: string, interval: string, count: string): string =>
  `ROUND(${amount}::numeric / (CASE ${interval}
       WHEN 'day'  THEN 1.0 / 30
       WHEN 'week' THEN 7.0 / 30
       WHEN 'year' THEN 12
       ELSE 1
     END * GREATEST(${count}, 1)))::bigint`;

/** Legacy `/checkout/session` orders fill `amount_cents`; offer checkout fills
 *  `total_cents`. Taking either alone values half the order history at nothing. */
const ORDER_CENTS = `GREATEST(o.total_cents, o.amount_cents)`;

/** Money that actually cleared. A charge later refunded or disputed still moved. */
const CLEARED = `t.kind = 'payment' AND t.status IN ('succeeded','refunded','disputed')`;

/** An order that represents a sale, whatever happened to it afterwards. */
const SOLD = `o.status IN ('paid','refunded')`;

/* -------------------------------------------------------------- the metrics */

interface MetricSource {
  metric: string;
  /** Must yield columns: day, dimension, value_cents, value_count, currency. */
  sql: string;
}

/**
 * Opens, clicks, unsubscribes and bounces differ only by the event kind, so they
 * share one shape. Dimensioned by what produced the message: `broadcast:12`,
 * `sequence:3`, plus a coarse `type:transactional` for everything else.
 */
function emailEventMetric(metric: string, kind: string): MetricSource {
  return {
    metric,
    sql: `
      WITH base AS (
        SELECT ${day("e.occurred_at")} AS day, m.source_type, m.source_id
          FROM email_events e
          JOIN email_messages m ON m.id = e.message_id
         WHERE e.kind = '${kind}'
           AND ${within("e.occurred_at")}
      )
      SELECT day, '' AS dimension, 0::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${NO_CURRENCY} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'type:' || source_type, 0::bigint, COUNT(*)::int, ${NO_CURRENCY}
        FROM base GROUP BY day, source_type
      UNION ALL
      SELECT day, source_type || ':' || source_id, 0::bigint, COUNT(*)::int, ${NO_CURRENCY}
        FROM base
       WHERE source_type IN ('broadcast','sequence') AND source_id IS NOT NULL
       GROUP BY day, source_type, source_id`,
  };
}

const METRICS: MetricSource[] = [
  {
    // Everything that cleared, before fees and before refunds — the headline
    // figure on the dashboard and the denominator of most of the rest.
    metric: "gross_revenue",
    sql: `
      WITH base AS (
        SELECT ${day("t.occurred_at")} AS day,
               t.amount_cents,
               t.currency,
               COALESCE(o.offer_id, s.offer_id) AS offer_id,
               COALESCE(NULLIF(t.country, ''), 'unknown') AS country,
               NULLIF(t.state, '') AS state,
               COALESCE(NULLIF(t.payment_method_type, ''),
                        NULLIF(t.payment_method_brand, ''), 'unknown') AS method,
               COALESCE(f.pricing_type, 'unknown') AS pricing_type
          FROM transactions t
          LEFT JOIN orders o        ON o.id = t.order_id
          LEFT JOIN subscriptions s ON s.id = t.subscription_id
          LEFT JOIN offers f        ON f.id = COALESCE(o.offer_id, s.offer_id)
         WHERE ${CLEARED}
           AND ${within("t.occurred_at")}
      )
      SELECT day, '' AS dimension, SUM(amount_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id
      UNION ALL
      SELECT day, 'country:' || country, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, country
      UNION ALL
      SELECT day, 'state:' || country || '-' || state, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE state IS NOT NULL GROUP BY day, country, state
      UNION ALL
      SELECT day, 'method:' || method, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, method
      UNION ALL
      SELECT day, 'pricing:' || pricing_type, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, pricing_type`,
  },
  {
    /**
     * What is left after processor fees and refunds.
     *
     * `fee_cents` is whatever the payment path recorded. Nothing writes it
     * today, so net currently differs from gross only by refunds — the figure is
     * honest about the data that exists rather than guessing a fee rate.
     */
    metric: "net_revenue",
    sql: `
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             SUM(cnt)::int AS value_count, ${currencyOf} AS currency
        FROM (
          SELECT ${day("t.occurred_at")} AS day,
                 (t.amount_cents - t.fee_cents) AS cents, 1 AS cnt, t.currency
            FROM transactions t
           WHERE ${CLEARED} AND ${within("t.occurred_at")}
          UNION ALL
          SELECT ${day("r.created_at")}, -r.amount_cents, 0, r.currency
            FROM refunds r
           WHERE ${within("r.created_at")}
        ) x
       GROUP BY day`,
  },
  {
    /**
     * Refunds come from `refunds`, not from `transactions.kind = 'refund'`.
     *
     * `services/fulfillment.ts` writes only the former; counting both would
     * double every refund the day something starts writing the latter too.
     */
    metric: "refunds",
    sql: `
      WITH base AS (
        SELECT ${day("r.created_at")} AS day, r.amount_cents, r.currency, o.offer_id
          FROM refunds r
          LEFT JOIN orders o ON o.id = r.order_id
         WHERE ${within("r.created_at")}
      )
      SELECT day, '' AS dimension, SUM(amount_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    metric: "tax",
    sql: `
      WITH base AS (
        SELECT ${day("x.created_at")} AS day, x.tax_cents, x.currency,
               COALESCE(NULLIF(x.country, ''), 'unknown') AS country,
               NULLIF(x.state, '') AS state
          FROM tax_records x
         WHERE ${within("x.created_at")}
      )
      SELECT day, '' AS dimension, SUM(tax_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'country:' || country, SUM(tax_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, country
      UNION ALL
      SELECT day, 'state:' || country || '-' || state, SUM(tax_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE state IS NOT NULL GROUP BY day, country, state`,
  },
  {
    metric: "orders",
    sql: `
      WITH base AS (
        SELECT ${day("o.created_at")} AS day, ${ORDER_CENTS} AS cents, o.currency, o.offer_id,
               COALESCE(f.pricing_type, 'unknown') AS pricing_type
          FROM orders o
          LEFT JOIN offers f ON f.id = o.offer_id
         WHERE ${SOLD} AND ${within("o.created_at")}
      )
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id
      UNION ALL
      SELECT day, 'pricing:' || pricing_type, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, pricing_type`,
  },
  {
    metric: "upsell_orders",
    sql: `
      WITH base AS (
        SELECT ${day("o.created_at")} AS day, ${ORDER_CENTS} AS cents, o.currency, o.offer_id
          FROM orders o
         WHERE o.parent_order_id IS NOT NULL AND ${SOLD} AND ${within("o.created_at")}
      )
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    // A free offer is claimed rather than bought, so the money column stays at
    // zero and the count is the whole story.
    metric: "free_offers",
    sql: `
      WITH base AS (
        SELECT ${day("o.created_at")} AS day, o.currency, o.offer_id
          FROM orders o
          JOIN offers f ON f.id = o.offer_id
         WHERE f.pricing_type = 'free' AND ${SOLD} AND ${within("o.created_at")}
      )
      SELECT day, '' AS dimension, 0::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, 0::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    metric: "paid_invoices",
    sql: `
      WITH base AS (
        SELECT ${day("COALESCE(i.paid_at, i.created_at)")} AS day,
               i.amount_paid_cents, i.currency
          FROM invoices i
         WHERE i.status = 'paid'
           AND ${within("COALESCE(i.paid_at, i.created_at)")}
      )
      SELECT day, '' AS dimension, SUM(amount_paid_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day`,
  },
  {
    metric: "new_subscriptions",
    sql: `
      WITH base AS (
        SELECT ${day("s.created_at")} AS day, s.currency, s.offer_id,
               ${monthlyCents("s.amount_cents", 's."interval"', "s.interval_count")} AS monthly_cents
          FROM subscriptions s
         WHERE ${within("s.created_at")}
      )
      SELECT day, '' AS dimension, SUM(monthly_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(monthly_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    metric: "canceled_subscriptions",
    sql: `
      WITH base AS (
        SELECT ${day("COALESCE(s.canceled_at, s.ended_at)")} AS day, s.currency, s.offer_id,
               COALESCE(NULLIF(s.cancel_reason, ''), 'not given') AS reason,
               ${monthlyCents("s.amount_cents", 's."interval"', "s.interval_count")} AS monthly_cents
          FROM subscriptions s
         WHERE COALESCE(s.canceled_at, s.ended_at) IS NOT NULL
           AND ${within("COALESCE(s.canceled_at, s.ended_at)")}
      )
      SELECT day, '' AS dimension, SUM(monthly_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(monthly_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id
      UNION ALL
      SELECT day, 'reason:' || reason, SUM(monthly_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, reason`,
  },
  {
    /**
     * Monthly recurring revenue, as a snapshot per day.
     *
     * Reconstructed from each subscription's own start and cancel dates rather
     * than accumulated forward, which is what makes a rebuild of an old month
     * produce the same answer as the original run. A subscription that was
     * paused and resumed inside the window is counted throughout: nothing
     * records when the pause ended, and inventing it would be worse than
     * slightly over-counting a case this business does not yet have.
     */
    metric: "mrr",
    sql: `
      WITH days AS (
        SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
      ),
      base AS (
        SELECT d.day, s.currency, s.offer_id,
               ${monthlyCents("s.amount_cents", 's."interval"', "s.interval_count")} AS monthly_cents
          FROM days d
          JOIN subscriptions s
            ON ${day("s.created_at")} <= d.day
           AND (s.canceled_at IS NULL OR ${day("s.canceled_at")} > d.day)
           AND (s.ended_at    IS NULL OR ${day("s.ended_at")}    > d.day)
         WHERE s.status <> 'incomplete'
      )
      SELECT day, '' AS dimension, SUM(monthly_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(monthly_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    // The whole contract value, not one installment: "3 x $1,250" sold today is
    // $3,750 of business won today even though only $1,250 has cleared.
    metric: "new_payment_plans",
    sql: `
      WITH base AS (
        SELECT ${day("p.created_at")} AS day, p.currency, p.offer_id,
               (p.installment_cents::bigint * p.installment_count) AS cents
          FROM payment_plans p
         WHERE ${within("p.created_at")}
      )
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    metric: "canceled_payment_plans",
    sql: `
      WITH base AS (
        SELECT ${day("p.canceled_at")} AS day, p.currency, p.offer_id,
               (p.installment_cents::bigint *
                GREATEST(p.installment_count - p.installments_paid, 0)) AS cents,
               COALESCE(NULLIF(p.cancel_reason, ''), 'not given') AS reason
          FROM payment_plans p
         WHERE p.canceled_at IS NOT NULL AND ${within("p.canceled_at")}
      )
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id
      UNION ALL
      SELECT day, 'reason:' || reason, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, reason`,
  },
  {
    /** The same snapshot shape as `mrr`, for the instalment book. */
    metric: "plan_mrr",
    sql: `
      WITH days AS (
        SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
      ),
      base AS (
        SELECT d.day, p.currency, p.offer_id,
               ${monthlyCents("p.installment_cents", 'p."interval"', "p.interval_count")} AS monthly_cents
          FROM days d
          JOIN payment_plans p
            ON ${day("p.created_at")} <= d.day
           AND (p.canceled_at  IS NULL OR ${day("p.canceled_at")}  > d.day)
           AND (p.completed_at IS NULL OR ${day("p.completed_at")} > d.day)
      )
      SELECT day, '' AS dimension, SUM(monthly_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(monthly_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    metric: "new_contacts",
    sql: `
      WITH base AS (
        SELECT ${day("c.created_at")} AS day,
               COALESCE(NULLIF(c.source, ''), 'unknown') AS source
          FROM contacts c
         WHERE ${within("c.created_at")}
      )
      SELECT day, '' AS dimension, 0::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${NO_CURRENCY} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'source:' || source, 0::bigint, COUNT(*)::int, ${NO_CURRENCY}
        FROM base GROUP BY day, source`,
  },
  {
    /**
     * An opt-in is somebody agreeing to be emailed, which is not the same event
     * as a contact record appearing — an imported buyer is a contact and never
     * opted in to anything. `opted_in_at` when it was captured, the contact's
     * own creation date when it was not.
     */
    metric: "optins",
    sql: `
      WITH base AS (
        SELECT ${day("COALESCE(c.opted_in_at, c.created_at)")} AS day,
               COALESCE(NULLIF(c.source, ''), 'unknown') AS source
          FROM contacts c
         WHERE c.email_marketing_status = 'subscribed'
           AND ${within("COALESCE(c.opted_in_at, c.created_at)")}
      )
      SELECT day, '' AS dimension, 0::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${NO_CURRENCY} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'source:' || source, 0::bigint, COUNT(*)::int, ${NO_CURRENCY}
        FROM base GROUP BY day, source`,
  },
  {
    metric: "email_sends",
    sql: `
      WITH base AS (
        SELECT ${day("COALESCE(m.sent_at, m.created_at)")} AS day, m.source_type, m.source_id
          FROM email_messages m
         WHERE m.status IN ('sent','delivered','bounced','complained')
           AND ${within("COALESCE(m.sent_at, m.created_at)")}
      )
      SELECT day, '' AS dimension, 0::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${NO_CURRENCY} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'type:' || source_type, 0::bigint, COUNT(*)::int, ${NO_CURRENCY}
        FROM base GROUP BY day, source_type
      UNION ALL
      SELECT day, source_type || ':' || source_id, 0::bigint, COUNT(*)::int, ${NO_CURRENCY}
        FROM base
       WHERE source_type IN ('broadcast','sequence') AND source_id IS NOT NULL
       GROUP BY day, source_type, source_id`,
  },
  emailEventMetric("email_opens", "opened"),
  emailEventMetric("email_clicks", "clicked"),
  emailEventMetric("email_unsubs", "unsubscribed"),
  emailEventMetric("email_bounces", "bounced"),
  {
    metric: "abandoned_carts",
    sql: `
      WITH base AS (
        SELECT ${day("a.created_at")} AS day, a.amount_cents, a.currency, a.offer_id
          FROM abandoned_checkouts a
         WHERE ${within("a.created_at")}
      )
      SELECT day, '' AS dimension, SUM(amount_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    // Filed on the day the cart came back, not the day it was abandoned: the
    // question the report answers is what the reminder emails earned this week.
    metric: "cart_recovered",
    sql: `
      WITH base AS (
        SELECT ${day("a.recovered_at")} AS day, a.offer_id,
               COALESCE(${ORDER_CENTS}, a.amount_cents) AS cents,
               COALESCE(o.currency, a.currency) AS currency
          FROM abandoned_checkouts a
          LEFT JOIN orders o ON o.id = a.recovered_order_id
         WHERE a.recovered_at IS NOT NULL AND ${within("a.recovered_at")}
      )
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    // Clawbacks are stored as their own negative rows, so summing everything
    // that is not void gives the running balance without restating history.
    metric: "affiliate_commission",
    sql: `
      WITH base AS (
        SELECT ${day("ac.created_at")} AS day, ac.amount_cents, ac.currency,
               ac.affiliate_id, ac.offer_id
          FROM affiliate_commissions ac
         WHERE ac.status <> 'void' AND ${within("ac.created_at")}
      )
      SELECT day, '' AS dimension, SUM(amount_cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'affiliate:' || affiliate_id, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, affiliate_id
      UNION ALL
      SELECT day, 'offer:' || offer_id, SUM(amount_cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base WHERE offer_id IS NOT NULL GROUP BY day, offer_id`,
  },
  {
    metric: "affiliate_orders",
    sql: `
      WITH base AS (
        SELECT ${day("o.created_at")} AS day, ${ORDER_CENTS} AS cents, o.currency, o.affiliate_id
          FROM orders o
         WHERE o.affiliate_id IS NOT NULL AND ${SOLD} AND ${within("o.created_at")}
      )
      SELECT day, '' AS dimension, SUM(cents)::bigint AS value_cents,
             COUNT(*)::int AS value_count, ${currencyOf} AS currency
        FROM base GROUP BY day
      UNION ALL
      SELECT day, 'affiliate:' || affiliate_id, SUM(cents)::bigint, COUNT(*)::int, ${currencyOf}
        FROM base GROUP BY day, affiliate_id`,
  },
];

/** Every metric this module owns — the set the stale sweep is allowed to touch. */
export const ROLLUP_METRICS: readonly string[] = METRICS.map((m) => m.metric);

/* ---------------------------------------------------------------- day maths */

/** A moment as the calendar day it fell on in the reporting zone. */
export function reportDay(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is the shape Postgres wants for a date
  // literal and the shape the API speaks.
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE }).format(at);
}

/** `days` before `from`, as a YYYY-MM-DD string. Pure date arithmetic, no zone. */
export function shiftDay(from: string, days: number): string {
  const at = new Date(`${from}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD strings. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/* -------------------------------------------------------------------- runner */

const UPSERT = (source: string): string => `
  INSERT INTO report_daily (day, metric, dimension, value_cents, value_count, currency, updated_at)
  SELECT s.day, $4::text, s.dimension, s.value_cents, s.value_count, s.currency, now()
    FROM ( ${source} ) s
   WHERE s.day IS NOT NULL
  ON CONFLICT (day, metric, dimension) DO UPDATE
     SET value_cents = EXCLUDED.value_cents,
         value_count = EXCLUDED.value_count,
         currency    = EXCLUDED.currency,
         updated_at  = EXCLUDED.updated_at`;

/**
 * Recomputes `report_daily` across an inclusive day range.
 *
 * Safe to run over any window, as many times as anyone likes. The second run
 * over the same window produces byte-identical values; only `updated_at` moves.
 */
export async function runRollup(range: RollupRange): Promise<RollupResult> {
  const { from, to } = normaliseRange(range);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // Held for the transaction, so a nightly run and a manual rebuild queue up
    // instead of sweeping each other's freshly written rows.
    await client.query("SELECT pg_advisory_xact_lock($1)", [ROLLUP_LOCK_KEY]);

    // `now()` is the transaction's clock, so every row this run writes carries
    // exactly this value and the sweep below can tell them apart from the rest.
    const stamp = await client.query<{ ran_at: Date }>("SELECT now() AS ran_at");
    const ranAt = stamp.rows[0].ran_at;

    let rowsWritten = 0;
    for (const { metric, sql } of METRICS) {
      const res = await client.query(UPSERT(sql), [from, to, REPORT_TIMEZONE, metric]);
      rowsWritten += res.rowCount ?? 0;
    }

    // A dimension that no longer has any facts behind it — an offer whose only
    // sale was deleted — would otherwise be reported forever.
    const swept = await client.query(
      `DELETE FROM report_daily
        WHERE day BETWEEN $1::date AND $2::date
          AND metric = ANY($3::text[])
          AND updated_at < $4`,
      [from, to, [...ROLLUP_METRICS], ranAt]
    );

    await client.query("COMMIT");
    return { from, to, metrics: METRICS.length, rowsWritten, rowsRemoved: swept.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Rejects a range that would scan forever, and puts the ends the right way round. */
function normaliseRange({ from, to }: RollupRange): RollupRange {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(from) || !valid.test(to)) {
    throw new Error(`Rollup range must be two YYYY-MM-DD dates, got "${from}".."${to}"`);
  }
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * The first day anything happened, so a first-ever run can rebuild all of it.
 *
 * Null when the platform has never taken money or gained a contact, which is a
 * real answer: there is nothing to roll up.
 */
export async function earliestActivityDay(): Promise<string | null> {
  const res = await pool.query<{ day: string | null }>(
    `SELECT to_char(MIN(at) AT TIME ZONE $1, 'YYYY-MM-DD') AS day
       FROM (
         SELECT MIN(occurred_at) AS at FROM transactions
         UNION ALL SELECT MIN(created_at) FROM orders
         UNION ALL SELECT MIN(created_at) FROM contacts
         UNION ALL SELECT MIN(created_at) FROM subscriptions
       ) x`,
    [REPORT_TIMEZONE]
  );
  return res.rows[0]?.day ?? null;
}

/** When the figures were last recomputed — what the dashboard tells the owner. */
export async function lastRollupAt(): Promise<Date | null> {
  const res = await pool.query<{ at: Date | null }>(
    "SELECT MAX(updated_at) AS at FROM report_daily"
  );
  return res.rows[0]?.at ?? null;
}

/** True when nothing has ever been rolled up, which is what triggers a backfill. */
export async function rollupIsEmpty(): Promise<boolean> {
  const res = await pool.query<{ any: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM report_daily) AS any"
  );
  return !res.rows[0].any;
}
