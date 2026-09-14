import { sweepAbandonedCheckouts } from "../services/checkoutRecovery";
import { pool } from "../db/pool";
import { sweepExpiredGrants } from "../services/access";
import { sweepUploadSessions } from "../services/resumableUploads";
import { releaseRedemption } from "../services/coupons";
import { registerHandler } from "./worker";
import { registerContactJobs } from "./contactRollup";
import { registerEmailJobs } from "./emailJobs";
import { registerAffiliateJobs } from "./affiliateJobs";
import { registerWebhookJobs } from "./webhookJobs";
import { registerReportJobs } from "./reportJobs";
import { registerEventJobs } from "./eventJobs";
import { registerCoachingJobs } from "./coachingJobs";
import { registerBillingJobs } from "./billingJobs";
import { registerCommunityJobs } from "./communityJobs";
import {
  dispatchDomainEvent,
  publishContactAnniversaries,
  sweepDomainEvents,
} from "../services/domainEvents";

/**
 * The job handlers that belong to no single feature.
 *
 * Sweeps, mostly — the ones that close gaps left by webhooks that may never
 * arrive. Every one of them is idempotent and safe to run at any frequency,
 * because "did this already run today" is not a question a queue can answer
 * reliably and a sweep that is dangerous to repeat is a sweep nobody dares
 * schedule.
 *
 * Feature-specific handlers (sequences, broadcasts, affiliate accrual, report
 * rollups) register themselves from their own modules and are wired in below.
 */

/** Orders abandoned in the Payment Element, which produce no Stripe event at all. */
const STALE_ORDER_MINUTES = 120;

/**
 * Closes checkouts that were started and never finished.
 *
 * The Payment Element path creates an order before the customer confirms, and
 * emits no terminal Stripe event if they simply close the tab — there is no
 * `checkout.session.expired` because there is no Checkout Session. Without this
 * the order sits `pending` forever and, worse, keeps holding the coupon
 * redemption it claimed, so every abandoned cart permanently consumes one of a
 * limited code's uses.
 */
async function sweepStaleOrders(): Promise<{ closed: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const stale = await client.query<{ id: number }>(
      `UPDATE orders
          SET status = 'expired', updated_at = now()
        WHERE status = 'pending'
          AND created_at < now() - make_interval(mins => $1)
          -- A recurring order waits on an invoice that can legitimately take
          -- longer than two hours to settle, so only one-off checkouts age out
          -- on this clock.
          AND stripe_payment_intent_id IS NULL
        RETURNING id`,
      [STALE_ORDER_MINUTES]
    );

    for (const row of stale.rows) {
      await releaseRedemption(client, row.id);
    }

    await client.query("COMMIT");
    return { closed: stale.rows.length };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ends payment plans that stopped paying and whose webhook never arrived.
 *
 * `endPaymentPlanAccess` in the Stripe webhook handles the normal case. This is
 * the backstop for the abnormal one: the endpoint was down past Stripe's retry
 * window, so the subscription is gone at Stripe and the plan here still says
 * `past_due` with the member still holding everything they did not finish
 * paying for.
 *
 * Deliberately conservative. A card can fail and be fixed; thirty days past a
 * missed charge is not a retry, it is a default.
 */
const PLAN_DEFAULT_GRACE_DAYS = 30;

async function sweepDefaultedPlans(): Promise<{ defaulted: number }> {
  const overdue = await pool.query<{ id: number; member_id: number | null; offer_id: number | null }>(
    `SELECT id, member_id, offer_id
       FROM payment_plans
      WHERE status = 'past_due'
        AND next_charge_at IS NOT NULL
        AND next_charge_at < now() - make_interval(days => $1)`,
    [PLAN_DEFAULT_GRACE_DAYS]
  );

  let defaulted = 0;
  for (const plan of overdue.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Re-read under lock: the webhook may have resolved this between the scan
      // and now, and revoking access from somebody who has just paid is the
      // worst outcome available here.
      const locked = await client.query<{ outstanding: string }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::text AS outstanding
           FROM payment_plan_installments
          WHERE payment_plan_id = $1 AND status <> 'paid'`,
        [plan.id]
      );
      const outstanding = Number(locked.rows[0]?.outstanding ?? 0);

      if (outstanding <= 0) {
        await client.query(
          `UPDATE payment_plans SET status = 'completed', completed_at = now(), updated_at = now()
            WHERE id = $1 AND status = 'past_due'`,
          [plan.id]
        );
        await client.query("COMMIT");
        continue;
      }

      await client.query(
        `UPDATE payment_plans
            SET status = 'canceled', canceled_at = now(), next_charge_at = NULL,
                cancel_reason = 'defaulted', updated_at = now()
          WHERE id = $1 AND status = 'past_due'`,
        [plan.id]
      );
      await client.query(
        `UPDATE payment_plan_installments SET status = 'skipped'
          WHERE payment_plan_id = $1 AND status IN ('scheduled', 'failed')`,
        [plan.id]
      );

      if (plan.member_id !== null && plan.offer_id !== null) {
        await client.query(
          `UPDATE access_grants
              SET status = 'revoked', revoked_at = now(),
                  revoke_reason = 'payment plan defaulted', updated_at = now()
            WHERE member_id = $1 AND offer_id = $2 AND status = 'active'`,
          [plan.member_id, plan.offer_id]
        );
      }

      await client.query("COMMIT");
      defaulted += 1;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  return { defaulted };
}

/** Keeps the jobs table from growing without bound. */
async function jobRetention(): Promise<{ removed: number }> {
  const [jobs, events, deliveries] = await Promise.all([
    pool.query(
    `DELETE FROM jobs
      WHERE status IN ('succeeded', 'cancelled')
        AND finished_at < now() - interval '14 days'`,
    ),
    pool.query(
      `DELETE FROM domain_events
        WHERE (processed_at IS NOT NULL AND processed_at < now() - interval '30 days')
           OR (processed_at IS NULL AND created_at < now() - interval '90 days')`,
    ),
    pool.query(
      `DELETE FROM webhook_deliveries
        WHERE status IN ('delivered', 'dead')
          AND created_at < now() - interval '90 days'`,
    ),
  ]);
  // Dead jobs are kept: the dead-letter list is the only place anyone finds out
  // that work never happened, and pruning it silently is how that gets lost.
  return {
    removed:
      (jobs.rowCount ?? 0) + (events.rowCount ?? 0) + (deliveries.rowCount ?? 0),
  };
}

/**
 * Registers the handlers that ship with the platform.
 *
 * Feature modules add their own by calling `registerHandler` at import time;
 * they are imported here so a handler cannot be missing merely because nothing
 * happened to reference its module.
 */
export function registerCoreHandlers(): void {
  registerHandler("purchase.gift", async (payload) => {
    const { deliverGiftById } = await import("../services/purchaseGift");
    await deliverGiftById(Number((payload as { orderId: number }).orderId));
  });
  registerHandler("orders.sweepStale", () => sweepStaleOrders());
  registerHandler("plans.sweepDefaulted", () => sweepDefaultedPlans());
  registerHandler("checkout.abandoned", () => sweepAbandonedCheckouts());
  registerHandler("jobs.retention", () => jobRetention());
  // Half-finished uploads: a week of grace to come back and resume, then the
  // part file is bytes on a volume nobody will ever ask for again.
  registerHandler("media.sweepUploads", () => sweepUploadSessions());
  registerHandler("access.sweepExpired", async () => ({ expired: await sweepExpiredGrants() }));
  registerHandler("domainEvents.dispatch", (payload) => dispatchDomainEvent(payload));
  registerHandler("domainEvents.sweep", () => sweepDomainEvents());
  registerHandler("domainEvents.anniversaries", () => publishContactAnniversaries());

  // Feature modules register their own handlers. Imported and called here so a
  // handler cannot be missing merely because nothing happened to reference its
  // module — a job kind with no handler fails loudly rather than silently never
  // running, but only if the registration itself is not the thing that is missing.
  registerContactJobs();
  registerEmailJobs();
  registerAffiliateJobs();
  registerWebhookJobs();
  registerReportJobs();
  registerEventJobs();
  registerCoachingJobs();
  registerBillingJobs();
  registerCommunityJobs();
}
