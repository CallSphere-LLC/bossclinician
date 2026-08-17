import { z } from "zod";
import { pool } from "../db/pool";
import { accrueForTransaction, clawback } from "../services/affiliates";
import { registerHandler } from "./worker";

/**
 * The partner program's background work.
 *
 * Three handlers, and every one of them is both *targeted* and *sweeping*: pass
 * an id and it does that one thing, pass nothing and it catches up on whatever
 * was missed. That shape is deliberate. `fulfillPayment` enqueues an accrual for
 * every attributed payment, but a webhook the endpoint was down for, an order
 * paid by hand in the admin before this phase shipped, or a job that died in the
 * dead-letter list all leave a partner unpaid with nothing to say so. A sweep on
 * a schedule closes each of those without anyone having to notice.
 *
 * All three are idempotent and safe to run at any frequency, which is the only
 * property that makes a sweep worth scheduling at all.
 */

const accruePayload = z.object({
  transactionId: z.coerce.number().int().positive().optional(),
  /** How far back a sweep looks. Days, because a webhook outage is measured in hours. */
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
});

const clawbackPayload = z.object({
  refundId: z.coerce.number().int().positive().optional(),
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
});

const DEFAULT_SWEEP_DAYS = 14;

/** Ceiling on one sweep, so a backlog is worked through over several runs rather than in one long lease. */
const SWEEP_LIMIT = 500;

export interface AccrueResult {
  considered: number;
  accrued: number;
  skipped: number;
}

/**
 * Accrues commission for recent succeeded payments on attributed orders.
 *
 * The candidate query excludes anything already carrying a commission of the
 * same kind, so a sweep over a fortnight of payments is a cheap index scan
 * rather than a re-run of the whole ledger — but `accrueForTransaction` is
 * idempotent regardless, and that, not this filter, is what makes it safe.
 */
export async function sweepAccruals(sinceDays: number): Promise<AccrueResult> {
  const due = await pool.query<{ id: number }>(
    `SELECT t.id
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
      WHERE t.kind = 'payment'
        AND t.status = 'succeeded'
        AND o.affiliate_id IS NOT NULL
        AND t.occurred_at > now() - make_interval(days => $1)
        AND NOT EXISTS (
              SELECT 1 FROM affiliate_commissions c
               WHERE c.transaction_id = t.id
                 AND c.kind IN ('sale', 'renewal')
            )
      ORDER BY t.id
      LIMIT $2`,
    [sinceDays, SWEEP_LIMIT]
  );

  let accrued = 0;
  let skipped = 0;
  for (const row of due.rows) {
    const result = await accrueForTransaction(row.id);
    if (result.accrued) accrued += 1;
    else skipped += 1;
  }

  return { considered: due.rows.length, accrued, skipped };
}

export interface ClawbackResult {
  considered: number;
  reversed: number;
  skipped: number;
}

/**
 * Reverses commission for refunds that have not been reversed yet.
 *
 * Driven from here rather than from the Stripe webhook on purpose: the webhook
 * owns recording the refund, and a partner ledger write inside it would be one
 * more thing that can fail a delivery Stripe will then retry. The refund row is
 * the durable fact; this catches up from it.
 *
 * `note` carries the refund id, which is what makes a second pass over the same
 * refund a no-op — see the comment on `clawback` for why the unique index over
 * `(transaction_id, kind)` is the wrong guard here.
 */
export async function sweepClawbacks(sinceDays: number): Promise<ClawbackResult> {
  const due = await pool.query<{ id: number }>(
    `SELECT r.id
       FROM refunds r
       JOIN orders o ON o.id = r.order_id
      WHERE o.affiliate_id IS NOT NULL
        AND r.created_at > now() - make_interval(days => $1)
        AND NOT EXISTS (
              SELECT 1 FROM affiliate_commissions c
               WHERE c.order_id = r.order_id
                 AND c.kind = 'clawback'
                 AND c.note = 'refund:' || r.id::text
            )
      ORDER BY r.id
      LIMIT $2`,
    [sinceDays, SWEEP_LIMIT]
  );

  let reversed = 0;
  let skipped = 0;
  for (const row of due.rows) {
    const result = await clawback(row.id);
    if (result.clawedBack) reversed += 1;
    else skipped += 1;
  }

  return { considered: due.rows.length, reversed, skipped };
}

export interface RollupResult {
  affiliatesUpdated: number;
  linksUpdated: number;
}

/**
 * Refreshes the denormalised counters on `affiliates` and `affiliate_links`.
 *
 * A full recompute, never an increment. An increment is only correct if it runs
 * exactly once per event, and a replayed webhook, a retried job and a click
 * recorded while the counter update failed are all cases where it will not —
 * whereas recomputing converges on the truth however badly the last run went.
 *
 * `earned_cents` sums the WHOLE ledger including negative clawback rows, so a
 * partner's headline figure is what they have actually earned rather than what
 * they earned before the refunds. Void rows are excluded because a voided
 * commission is one somebody decided never happened.
 */
export async function runRollup(): Promise<RollupResult> {
  const affiliates = await pool.query(
    `UPDATE affiliates a
        SET click_count    = totals.clicks,
            referred_count = totals.referred,
            earned_cents   = totals.earned,
            paid_cents     = totals.paid,
            updated_at     = now()
       FROM (
         SELECT a2.id,
                (SELECT COUNT(*)::int FROM affiliate_clicks c
                  WHERE c.affiliate_id = a2.id) AS clicks,
                -- Distinct orders, not commissions: a payment plan that pays
                -- three times referred one customer, not three.
                (SELECT COUNT(DISTINCT o.id)::int FROM orders o
                  WHERE o.affiliate_id = a2.id
                    AND o.status IN ('paid', 'refunded')) AS referred,
                COALESCE((SELECT SUM(k.amount_cents) FROM affiliate_commissions k
                           WHERE k.affiliate_id = a2.id AND k.status <> 'void'), 0)::int AS earned,
                COALESCE((SELECT SUM(k.amount_cents) FROM affiliate_commissions k
                           WHERE k.affiliate_id = a2.id AND k.status = 'paid'), 0)::int AS paid
           FROM affiliates a2
       ) totals
      WHERE a.id = totals.id
        -- Only write the rows that moved. Touching every partner on every run
        -- rewrites the whole table hourly for no change.
        AND (a.click_count    IS DISTINCT FROM totals.clicks
          OR a.referred_count IS DISTINCT FROM totals.referred
          OR a.earned_cents   IS DISTINCT FROM totals.earned
          OR a.paid_cents     IS DISTINCT FROM totals.paid)`
  );

  const links = await pool.query(
    `UPDATE affiliate_links l
        SET click_count = counts.total
       FROM (
         SELECT l2.id, (SELECT COUNT(*)::int FROM affiliate_clicks c WHERE c.link_id = l2.id) AS total
           FROM affiliate_links l2
       ) counts
      WHERE l.id = counts.id AND l.click_count IS DISTINCT FROM counts.total`
  );

  return {
    affiliatesUpdated: affiliates.rowCount ?? 0,
    linksUpdated: links.rowCount ?? 0,
  };
}

/** Wires the partner program into the queue. Called once at boot. */
export function registerAffiliateJobs(): void {
  registerHandler("affiliates.accrue", async (payload) => {
    const parsed = accruePayload.parse(payload);
    if (parsed.transactionId !== undefined) {
      return accrueForTransaction(parsed.transactionId);
    }
    return sweepAccruals(parsed.sinceDays ?? DEFAULT_SWEEP_DAYS);
  });

  registerHandler("affiliates.clawback", async (payload) => {
    const parsed = clawbackPayload.parse(payload);
    if (parsed.refundId !== undefined) {
      return clawback(parsed.refundId);
    }
    return sweepClawbacks(parsed.sinceDays ?? DEFAULT_SWEEP_DAYS);
  });

  registerHandler("affiliates.rollup", () => runRollup());
}
