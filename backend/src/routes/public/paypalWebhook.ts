import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { paypalConfig, usdToCents, verifyPayPalWebhook, type PayPalSubscriptionTransaction } from "../../services/paypalClient";
import {
  failPendingPayPalOrder,
  handlePayPalPaymentFailed,
  reconcilePayPalSubscription,
  recordPayPalRefund,
  settlePayPalOrder,
} from "../../services/paypalBilling";

/**
 * PayPal webhook receiver: POST /api/paypal/webhook.
 *
 * The PayPal counterpart of stripeWebhook.ts, with the same four rules: the
 * raw event is stored before anything acts on it, orders become paid only
 * through services/fulfillment.ts, access only through services/access.ts,
 * and failure answers 500 so PayPal retries.
 *
 * Authenticity is PayPal's own verdict: every delivery is sent back to
 * /v1/notifications/verify-webhook-signature with the configured
 * PAYPAL_WEBHOOK_ID before a field of it is read. When app.ts mounts
 * express.raw() on this path the exact bytes are verified; with the ordinary
 * JSON parser the parsed event is re-serialised, which PayPal also accepts.
 *
 * Handlers do not trust the event's snapshot of a subscription. They call
 * services/paypalBilling.ts, which reads PayPal's current state and moves the
 * local records to match — so a late, repeated or out-of-order delivery
 * converges on the same result.
 */
export const paypalWebhookRouter = Router();

interface PayPalEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: Record<string, unknown>;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[paypal:webhook] ${message}`);
}

/** See stripeWebhook.ts: a claim older than this belonged to a process that died. */
const CLAIM_TIMEOUT_SECONDS = 15 * 60;

type EventClaim = { claimed: true; attempts: number } | { claimed: false; inFlight: boolean };

async function claimEvent(event: PayPalEvent, resourceId: string): Promise<EventClaim> {
  const res = await pool.query<{ attempts: number }>(
    `INSERT INTO paypal_webhook_events (id, event_type, resource_id, payload, status, claimed_at)
     VALUES ($1, $2, $3, $4, 'processing', now())
     ON CONFLICT (id) DO UPDATE
       SET status = 'processing', claimed_at = now()
       WHERE paypal_webhook_events.status = 'failed'
          OR (paypal_webhook_events.status IN ('processing', 'received')
              AND COALESCE(paypal_webhook_events.claimed_at, paypal_webhook_events.received_at)
                  < now() - $5::int * INTERVAL '1 second')
     RETURNING attempts`,
    [event.id, event.event_type, resourceId.slice(0, 200), JSON.stringify(event), CLAIM_TIMEOUT_SECONDS],
  );
  if (res.rows[0]) return { claimed: true, attempts: res.rows[0].attempts };
  const existing = await pool.query<{ status: string }>(`SELECT status FROM paypal_webhook_events WHERE id = $1`, [event.id]);
  const status = existing.rows[0]?.status ?? "";
  return { claimed: false, inFlight: status === "processing" || status === "received" };
}

async function markProcessed(eventId: string, handled: boolean): Promise<void> {
  await pool.query(
    `UPDATE paypal_webhook_events SET status = $2, processed_at = now(), error = '' WHERE id = $1`,
    [eventId, handled ? "processed" : "ignored"],
  );
}

async function markFailed(eventId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await pool.query(
    `UPDATE paypal_webhook_events SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1`,
    [eventId, message.slice(0, 2000)],
  );
}

/* ------------------------------------------------------------ reading */

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The capture a v2 refund belongs to, from its rel="up" link. */
export function captureIdFromRefund(resource: Record<string, unknown>): string | null {
  const links = Array.isArray(resource.links) ? resource.links : [];
  for (const link of links) {
    const entry = obj(link);
    if (str(entry.rel) !== "up") continue;
    const match = /\/v2\/payments\/captures\/([A-Z0-9]+)/.exec(str(entry.href));
    if (match) return match[1];
  }
  return null;
}

/** The subscription id a v1 sale or refund belongs to. */
function billingAgreementId(resource: Record<string, unknown>): string {
  return str(resource.billing_agreement_id);
}

/** A PAYMENT.SALE.* resource in the shape the transactions API returns. */
export function saleFromResource(resource: Record<string, unknown>): PayPalSubscriptionTransaction | undefined {
  const id = str(resource.id);
  const amount = obj(resource.amount);
  if (!id || usdToCents(str(amount.total)) === null) return undefined;
  return {
    id,
    status: str(resource.state).toLowerCase() === "completed" ? "COMPLETED" : str(resource.state).toUpperCase(),
    time: str(resource.create_time) || undefined,
    amount_with_breakdown: { gross_amount: { currency_code: str(amount.currency) || "USD", value: str(amount.total) } },
  };
}

/** The local order behind a one-time PayPal order id. */
async function orderIdForPayPalOrder(paypalOrderId: string): Promise<number | null> {
  if (!paypalOrderId) return null;
  const found = await pool.query<{ id: number }>(`SELECT id FROM orders WHERE paypal_order_id = $1`, [paypalOrderId]);
  return found.rows[0]?.id ?? null;
}

/** Returns false for an event this system has nothing to do about. */
async function dispatch(event: PayPalEvent): Promise<boolean> {
  const resource = obj(event.resource);
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      // The buyer approved and may never come back to the return page.
      const orderId = await orderIdForPayPalOrder(str(resource.id));
      if (orderId === null) return false;
      await settlePayPalOrder(orderId);
      return true;
    }

    case "PAYMENT.CAPTURE.COMPLETED": {
      const related = obj(obj(resource.supplementary_data).related_ids);
      const orderId = await orderIdForPayPalOrder(str(related.order_id));
      if (orderId === null) return false;
      await settlePayPalOrder(orderId);
      return true;
    }

    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const related = obj(obj(resource.supplementary_data).related_ids);
      const orderId = await orderIdForPayPalOrder(str(related.order_id));
      if (orderId === null) return false;
      // Never touches a paid order: only a pending one can fail.
      await failPendingPayPalOrder(orderId);
      log(`capture ${str(resource.id)} denied; order ${orderId} closed if it was still pending`);
      return true;
    }

    case "PAYMENT.CAPTURE.REFUNDED": {
      const cents = usdToCents(str(obj(resource.amount).value));
      const captureId = captureIdFromRefund(resource);
      if (!str(resource.id) || cents === null || !captureId) return false;
      return recordPayPalRefund({ refundId: str(resource.id), captureId, amountCents: cents, reason: str(resource.note_to_payer) });
    }

    case "PAYMENT.SALE.REFUNDED":
    case "PAYMENT.SALE.REVERSED": {
      const cents = usdToCents(str(obj(resource.amount).total));
      const saleId = str(resource.sale_id);
      if (!str(resource.id) || cents === null || !saleId) return false;
      return recordPayPalRefund({
        refundId: str(resource.id),
        saleId,
        amountCents: cents,
        reason: event.event_type === "PAYMENT.SALE.REVERSED" ? "reversed by PayPal" : "",
      });
    }

    case "PAYMENT.SALE.COMPLETED": {
      const subscriptionId = billingAgreementId(resource);
      if (!subscriptionId) return false;
      await reconcilePayPalSubscription(subscriptionId, saleFromResource(resource));
      return true;
    }

    case "PAYMENT.SALE.DENIED": {
      const subscriptionId = billingAgreementId(resource);
      if (!subscriptionId) return false;
      await reconcilePayPalSubscription(subscriptionId);
      return true;
    }

    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.RE-ACTIVATED":
    case "BILLING.SUBSCRIPTION.UPDATED":
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED": {
      const subscriptionId = str(resource.id);
      if (!subscriptionId) return false;
      await reconcilePayPalSubscription(subscriptionId);
      return true;
    }

    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
      const subscriptionId = str(resource.id);
      if (!subscriptionId) return false;
      await handlePayPalPaymentFailed(subscriptionId, event.id);
      return true;
    }

    default:
      return false;
  }
}

/** The id the event is about, kept beside it for support lookups. */
function resourceIdOf(event: PayPalEvent): string {
  const resource = obj(event.resource);
  return billingAgreementId(resource) || str(resource.id);
}

paypalWebhookRouter.post(
  "/paypal/webhook",
  asyncHandler(async (req, res) => {
    const config = paypalConfig();
    if (!config || !config.webhookId) {
      res.status(503).json({ error: "PayPal is not configured" });
      return;
    }

    // Raw bytes when app.ts mounts express.raw() here; a parsed object otherwise.
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
    let event: PayPalEvent;
    try {
      event = (raw !== null ? JSON.parse(raw) : req.body) as PayPalEvent;
    } catch {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    if (!event || typeof event.id !== "string" || typeof event.event_type !== "string") {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    let verified = false;
    try {
      verified = await verifyPayPalWebhook(req.headers, raw ?? event);
    } catch (err) {
      // PayPal could not be asked. 500 so it redelivers once it can be.
      console.error("[paypal] webhook verification call failed:", (err as Error).message);
      res.status(500).json({ error: "Verification unavailable" });
      return;
    }
    if (!verified) {
      console.error(`[paypal] webhook signature rejected for ${event.event_type} ${event.id}`);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const claim = await claimEvent(event, resourceIdOf(event));
    if (!claim.claimed) {
      if (claim.inFlight) {
        log(`${event.event_type} ${event.id} is already being processed by another delivery`);
        res.status(409).json({ error: "Event is already being processed" });
        return;
      }
      log(`${event.event_type} ${event.id} is a redelivery of a finished event; ignoring`);
      res.json({ received: true, duplicate: true });
      return;
    }
    if (claim.attempts > 0) log(`${event.event_type} ${event.id} retry (${claim.attempts} previous attempt(s))`);

    try {
      const handled = await dispatch(event);
      await markProcessed(event.id, handled);
      res.json({ received: true });
    } catch (err) {
      console.error(`[paypal] ${event.event_type} ${event.id} failed:`, err);
      await markFailed(event.id, err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }),
);
