import type Stripe from "stripe";
import { pool } from "../db/pool";
import { stripeEnabled } from "../config/env";
import { stripe } from "../stripe/client";
import { readSetting } from "./settings";
import { parseRetrySchedule } from "./paymentRules";

/**
 * What happens after a recurring payment fails.
 *
 * Two owner settings meet here:
 *
 *  - **Who retries the card.** By default Stripe does, on the retry settings in
 *    the Stripe account, and this module stays out of the way. With "this site,
 *    on a schedule" the owner writes the gaps ("3, 5, 7" days) and the
 *    `billing.dunning` job pays the invoice on those dates, then carries out the
 *    final action she chose when the last one fails.
 *
 *  - **Whether access pauses on the first failure**
 *    (`customer_payments.revokeOnFirstFailedPayment`). The pause is recorded with
 *    its own revoke reason and only ever touches the grants the failing
 *    subscription pays for, which is what makes it reversible: when the invoice
 *    is paid — by a retry, a new card, or the customer paying the hosted
 *    invoice — exactly those grants come back.
 *
 * Stripe is never written to except to pay an invoice the schedule says is due,
 * or to cancel a subscription whose retries have all failed and whose owner has
 * chosen cancellation.
 */

/** The revoke reason for a pause, and the key the restore matches on. */
export const FAILED_PAYMENT_REVOKE_REASON = "recurring payment failed";
/** The revoke reason when retries run out and the subscription is cancelled. */
export const RETRIES_EXHAUSTED_REASON = "payment retries ran out";
/** The cancel_reason recorded for involuntary churn, labelled in the reports. */
export const PAYMENT_FAILED_CANCEL_REASON = "payment_failed";

export type RetryMode = "stripe" | "schedule";
export type FinalAction = "cancel" | "leave";

export interface DunningPolicy {
  mode: RetryMode;
  /** Days to wait before each retry, in order. */
  retryDays: number[];
  finalAction: FinalAction;
}

export async function readDunningPolicy(): Promise<DunningPolicy> {
  const settings = await readSetting("failed_payments");
  return {
    mode: settings.retryMode === "schedule" ? "schedule" : "stripe",
    retryDays: parseRetrySchedule(settings.retryDays),
    finalAction: settings.finalAction === "leave" ? "leave" : "cancel",
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the next retry falls, `retriesMade` retries in, counted from the failure
 * that has just happened. Null when the schedule is used up — or when Stripe,
 * not this site, is the one retrying.
 */
export function nextRetryDate(policy: DunningPolicy, retriesMade: number, from: Date): Date | null {
  if (policy.mode !== "schedule") return null;
  const gap = policy.retryDays[retriesMade];
  return gap === undefined ? null : new Date(from.getTime() + gap * DAY_MS);
}

/* ---------------------------------------------------------- access pausing */

/**
 * Pauses the access a subscription pays for, when the owner has asked for that.
 *
 * Grants linked to the subscription first. A grant written before the link
 * existed carries only the member and the offer, so that is the fallback — and
 * only for grants with no subscription of their own, never for the same course
 * bought outright or paid for by a different membership.
 */
export async function pauseAccessForFailedPayment(subscriptionId: number): Promise<number> {
  const settings = await readSetting("customer_payments");
  if (settings.revokeOnFirstFailedPayment !== true) return 0;

  const linked = await pool.query(
    `UPDATE access_grants
        SET status = 'revoked', revoked_at = now(), revoke_reason = $2, updated_at = now()
      WHERE subscription_id = $1 AND status = 'active'`,
    [subscriptionId, FAILED_PAYMENT_REVOKE_REASON]
  );
  if ((linked.rowCount ?? 0) > 0) return linked.rowCount ?? 0;

  const byOffer = await pool.query(
    `UPDATE access_grants g
        SET status = 'revoked', revoked_at = now(), revoke_reason = $2, updated_at = now()
       FROM subscriptions s
      WHERE s.id = $1
        AND g.member_id = s.member_id
        AND g.offer_id = s.offer_id
        AND g.subscription_id IS NULL
        AND g.status = 'active'`,
    [subscriptionId, FAILED_PAYMENT_REVOKE_REASON]
  );
  return byOffer.rowCount ?? 0;
}

/**
 * Gives back what `pauseAccessForFailedPayment` took, and nothing else.
 *
 * Matched on the pause's own revoke reason, so a refund or a cancellation that
 * revoked the same grant since is never undone by a payment. Runs whatever the
 * setting says now: turning the setting off must not strand somebody whose
 * access was paused while it was on.
 */
export async function restoreAccessAfterPayment(subscriptionId: number): Promise<number> {
  const res = await pool.query(
    `UPDATE access_grants g
        SET status = 'active', revoked_at = NULL, revoke_reason = '', updated_at = now()
       FROM subscriptions s
      WHERE s.id = $1
        AND g.status = 'revoked'
        AND g.revoke_reason = $2
        AND (g.subscription_id = s.id
             OR (g.subscription_id IS NULL AND g.member_id = s.member_id AND g.offer_id = s.offer_id))`,
    [subscriptionId, FAILED_PAYMENT_REVOKE_REASON]
  );
  return res.rowCount ?? 0;
}

/* ------------------------------------------------------------- scheduling */

/**
 * Books the next retry for an invoice that has just failed.
 *
 * Called from the `invoice.payment_failed` webhook. Returns whether this site is
 * managing the retries and, if so, when the next one is — the payment-failed
 * email quotes that date rather than Stripe's, which is empty once Stripe's own
 * retries are switched off.
 *
 * An invoice that already has a retry booked keeps it: the sweep books its own
 * next date after a declined retry, and Stripe's copy of the same decline
 * arriving afterwards must not move it.
 */
export async function scheduleRetryAfterFailure(input: {
  stripeInvoiceId: string;
  failedAt?: Date;
}): Promise<{ managed: boolean; nextAttemptAt: Date | null }> {
  const policy = await readDunningPolicy();
  if (policy.mode !== "schedule") return { managed: false, nextAttemptAt: null };

  const found = await pool.query<{
    id: number;
    retries_made: number;
    next_retry_at: Date | null;
    dunning_ended_at: Date | null;
    status: string;
  }>(
    `SELECT id, retries_made, next_retry_at, dunning_ended_at, status
       FROM invoices WHERE stripe_invoice_id = $1`,
    [input.stripeInvoiceId]
  );
  const row = found.rows[0];
  if (!row || row.dunning_ended_at !== null || row.status !== "failed") {
    return { managed: true, nextAttemptAt: null };
  }
  if (row.next_retry_at !== null) return { managed: true, nextAttemptAt: row.next_retry_at };

  const next = nextRetryDate(policy, row.retries_made, input.failedAt ?? new Date());
  // Used up: due now, so the next sweep carries out the final action.
  await pool.query(
    `UPDATE invoices SET next_retry_at = $2
      WHERE id = $1 AND next_retry_at IS NULL AND dunning_ended_at IS NULL`,
    [row.id, next ?? new Date()]
  );
  return { managed: true, nextAttemptAt: next };
}

/** Marks an invoice's dunning as over. The first outcome recorded stands. */
export async function closeDunning(
  stripeInvoiceId: string,
  outcome: "paid" | "exhausted" | "canceled"
): Promise<void> {
  await pool.query(
    `UPDATE invoices
        SET dunning_ended_at = COALESCE(dunning_ended_at, now()),
            dunning_outcome  = CASE WHEN dunning_outcome = '' THEN $2 ELSE dunning_outcome END,
            next_retry_at    = NULL
      WHERE stripe_invoice_id = $1
        AND dunning_ended_at IS NULL
        AND (next_retry_at IS NOT NULL OR retries_made > 0)`,
    [stripeInvoiceId, outcome]
  );
}

/* ------------------------------------------------------------------ sweep */

interface DueInvoiceRow {
  id: number;
  stripe_invoice_id: string;
  retries_made: number;
  subscription_id: number | null;
  payment_plan_id: number | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
}

export interface DunningSweepResult {
  retried: number;
  recovered: number;
  declined: number;
  canceled: number;
  exhausted: number;
}

/** A paid invoice: the subscription is back in good standing, with its access. */
async function recover(row: DueInvoiceRow): Promise<void> {
  await pool.query(
    `UPDATE invoices
        SET dunning_ended_at = COALESCE(dunning_ended_at, now()),
            dunning_outcome  = CASE WHEN dunning_outcome = '' THEN 'paid' ELSE dunning_outcome END,
            next_retry_at    = NULL
      WHERE id = $1`,
    [row.id]
  );
  if (row.subscription_id !== null) {
    // The invoice.paid webhook does the same; doing it here too means a site
    // whose webhook is not subscribed to invoice events still gives access back.
    await pool.query(
      `UPDATE subscriptions
          SET status = CASE WHEN status IN ('past_due','unpaid') THEN 'active' ELSE status END,
              failed_payment_count = 0,
              updated_at = now()
        WHERE id = $1`,
      [row.subscription_id]
    );
    await restoreAccessAfterPayment(row.subscription_id);
  }
}

/**
 * An invoice paid outside the sweep — a new card from the billing page — ends
 * its dunning and gives back paused access the same way a paid retry does.
 */
export async function recoverPaidInvoice(stripeInvoiceId: string): Promise<void> {
  const found = await pool.query<DueInvoiceRow>(
    `SELECT i.id, i.stripe_invoice_id, i.retries_made, i.subscription_id, i.payment_plan_id,
            s.stripe_subscription_id, s.status AS subscription_status
       FROM invoices i
       LEFT JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.stripe_invoice_id = $1`,
    [stripeInvoiceId]
  );
  const row = found.rows[0];
  if (row) await recover(row);
}

async function endWithoutPayment(row: DueInvoiceRow, policy: DunningPolicy): Promise<"canceled" | "exhausted"> {
  const cancel =
    policy.finalAction === "cancel" &&
    row.subscription_id !== null &&
    row.stripe_subscription_id !== null &&
    row.subscription_status !== "canceled";

  if (cancel && row.stripe_subscription_id !== null && row.subscription_id !== null) {
    await stripe().subscriptions.cancel(
      row.stripe_subscription_id,
      { cancellation_details: { comment: "Every scheduled payment retry failed." } },
      { idempotencyKey: `dunning-cancel-${row.stripe_invoice_id}` }
    );
    await pool.query(
      `UPDATE subscriptions
          SET status = 'canceled',
              cancel_at_period_end = false,
              canceled_at = COALESCE(canceled_at, now()),
              ended_at    = COALESCE(ended_at, now()),
              cancel_reason = CASE WHEN cancel_reason = '' THEN $2 ELSE cancel_reason END,
              updated_at  = now()
        WHERE id = $1`,
      [row.subscription_id, PAYMENT_FAILED_CANCEL_REASON]
    );
    await pool.query(
      `UPDATE access_grants
          SET status = 'revoked', revoked_at = now(), revoke_reason = $2, updated_at = now()
        WHERE subscription_id = $1 AND status IN ('active', 'revoked')
          AND (status = 'active' OR revoke_reason = $3)`,
      [row.subscription_id, RETRIES_EXHAUSTED_REASON, FAILED_PAYMENT_REVOKE_REASON]
    );
  }

  const outcome = cancel ? "canceled" : "exhausted";
  await pool.query(
    `UPDATE invoices
        SET dunning_ended_at = COALESCE(dunning_ended_at, now()),
            dunning_outcome  = CASE WHEN dunning_outcome = '' THEN $2 ELSE dunning_outcome END,
            next_retry_at    = NULL
      WHERE id = $1`,
    [row.id, outcome]
  );
  return outcome;
}

function stripeMessage(err: unknown): string {
  const e = err as Partial<Stripe.errors.StripeError> & { message?: string };
  return String(e?.message ?? err).slice(0, 500);
}

/**
 * Retries every invoice whose date has come, on the owner's schedule.
 *
 * Each row is claimed before Stripe is called — `retries_made` goes up and the
 * booked date is cleared in one guarded UPDATE — so two workers cannot pay the
 * same invoice, and the idempotency key carries the retry number so a crash
 * between the claim and the call does not become a second charge attempt.
 */
export async function sweepDunning(now: Date = new Date()): Promise<DunningSweepResult> {
  const result: DunningSweepResult = { retried: 0, recovered: 0, declined: 0, canceled: 0, exhausted: 0 };
  const policy = await readDunningPolicy();
  if (policy.mode !== "schedule" || !stripeEnabled()) return result;

  const due = await pool.query<DueInvoiceRow>(
    `SELECT i.id, i.stripe_invoice_id, i.retries_made, i.subscription_id, i.payment_plan_id,
            s.stripe_subscription_id, s.status AS subscription_status
       FROM invoices i
       LEFT JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.next_retry_at IS NOT NULL
        AND i.next_retry_at <= $1
        AND i.dunning_ended_at IS NULL
        AND i.status = 'failed'
        AND i.origin <> 'order'
      ORDER BY i.next_retry_at
      LIMIT 50`,
    [now]
  );

  for (const row of due.rows) {
    if (row.retries_made >= policy.retryDays.length) {
      const outcome = await endWithoutPayment(row, policy);
      result[outcome] += 1;
      continue;
    }

    const claimed = await pool.query<{ retries_made: number }>(
      `UPDATE invoices
          SET retries_made = retries_made + 1, last_retry_at = now(), next_retry_at = NULL
        WHERE id = $1 AND next_retry_at IS NOT NULL AND next_retry_at <= $2
          AND dunning_ended_at IS NULL
        RETURNING retries_made`,
      [row.id, now]
    );
    const retriesMade = claimed.rows[0]?.retries_made;
    if (retriesMade === undefined) continue;
    result.retried += 1;

    try {
      // Read first: a customer who paid the hosted invoice, or a Stripe retry
      // that got there first, needs no charge attempt at all.
      const current = await stripe().invoices.retrieve(row.stripe_invoice_id);
      if (current.status === "paid") {
        await recover(row);
        result.recovered += 1;
        continue;
      }
      if (current.status === "void" || current.status === "uncollectible") {
        await pool.query(
          `UPDATE invoices SET dunning_ended_at = now(), dunning_outcome = 'canceled', next_retry_at = NULL
            WHERE id = $1`,
          [row.id]
        );
        continue;
      }

      const paid = await stripe().invoices.pay(
        row.stripe_invoice_id,
        {},
        { idempotencyKey: `dunning-retry-${row.stripe_invoice_id}-${retriesMade}` }
      );
      if (paid.status === "paid") {
        await recover(row);
        result.recovered += 1;
        continue;
      }
      throw new Error(`Invoice is ${paid.status} after the retry`);
    } catch (err) {
      result.declined += 1;
      const next = nextRetryDate(policy, retriesMade, now);
      await pool.query(
        `UPDATE invoices SET last_retry_error = $2, next_retry_at = COALESCE(next_retry_at, $3)
          WHERE id = $1 AND dunning_ended_at IS NULL`,
        [row.id, stripeMessage(err), next]
      );
      if (next === null) {
        const outcome = await endWithoutPayment({ ...row, retries_made: retriesMade }, policy);
        result[outcome] += 1;
      }
    }
  }

  return result;
}
