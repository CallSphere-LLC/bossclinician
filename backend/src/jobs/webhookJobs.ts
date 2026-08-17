import { PRIORITY, enqueue } from "./queue";
import { registerHandler } from "./worker";
import { attemptDelivery, deliveryJobKey, dueDeliveries } from "../services/webhooksOut";

/**
 * The two job kinds behind outbound webhooks.
 *
 * `webhooks.deliver` makes one attempt at one delivery. It deliberately does
 * *not* throw when the receiving endpoint refuses: the retry schedule for a
 * webhook belongs to the webhook (30s, 2m, 10m, 1h — see
 * services/webhooksOut.ts), not to the queue, and letting the job fail as well
 * would stack the queue's own backoff on top of it and retry twice as often as
 * either curve says. The job fails only when *we* broke — a database error, a
 * bug — which is the case the dead-letter list should actually show.
 *
 * `webhooks.retry` is the sweeper. It re-queues any delivery that is due and
 * has nothing looking after it, which is what closes the gap left by a worker
 * that died between recording an attempt and queueing the next one.
 */

interface DeliverPayload {
  deliveryId?: unknown;
}

/** Delivery ids are bigints, so they travel as strings through JSONB. */
function deliveryIdOf(payload: DeliverPayload): string | null {
  const raw = payload.deliveryId;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return raw;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return String(raw);
  return null;
}

async function deliver(payload: Record<string, unknown>): Promise<unknown> {
  const deliveryId = deliveryIdOf(payload as DeliverPayload);
  if (deliveryId === null) {
    // A payload we cannot read is our bug, not the endpoint's, so this one does
    // throw — it belongs in the dead-letter list where somebody will see it.
    throw new Error("webhooks.deliver was queued without a usable deliveryId");
  }

  return attemptDelivery(deliveryId);
}

async function sweepDue(): Promise<{ requeued: number }> {
  const due = await dueDeliveries();
  let requeued = 0;

  for (const delivery of due) {
    const jobId = await enqueue({
      kind: "webhooks.deliver",
      payload: { deliveryId: delivery.id },
      priority: PRIORITY.normal,
      // The same key the previous attempt's retry used, so a sweep that
      // overlaps a live retry collapses into it rather than double-posting.
      dedupeKey: deliveryJobKey(delivery.id, delivery.attempts),
    });
    if (jobId) requeued += 1;
  }

  return { requeued };
}

export function registerWebhookJobs(): void {
  registerHandler("webhooks.deliver", (payload) => deliver(payload));
  registerHandler("webhooks.retry", () => sweepDue());
}
