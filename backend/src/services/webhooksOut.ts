import crypto from "crypto";
import { pool } from "../db/pool";
import { PRIORITY, enqueue } from "../jobs/queue";
import { generateToken } from "../auth/tokens";

/**
 * Outbound webhooks: telling somebody else's system that something happened
 * here.
 *
 * Dispatch is a database write plus a queued job, never an HTTP call on the
 * request path. A customer's card must not be held open while a Zapier endpoint
 * in another hemisphere decides whether to answer, and an endpoint that has
 * stopped responding must not be able to slow down checkout at all.
 *
 * ---------------------------------------------------------------------------
 * SIGNATURE SCHEME — what an integrator has to implement
 * ---------------------------------------------------------------------------
 * Every request carries:
 *
 *   X-BC-Signature: t=1718040000,v1=6c2f…af31
 *   X-BC-Event:     order.paid
 *   X-BC-Delivery:  4821
 *
 * To verify:
 *
 *   1. Read `t` and `v1` from the header.
 *   2. Build the signed payload as the literal string `${t}.${rawRequestBody}`
 *      — the raw bytes, before any JSON parsing. Re-serialising the parsed body
 *      will not reproduce the same string.
 *   3. Compute HMAC-SHA256 of that string with the endpoint's signing secret
 *      (shown once when the endpoint was created), hex-encoded.
 *   4. Compare with `v1` in constant time.
 *   5. Reject anything where `t` is more than five minutes from your own clock,
 *      which is what stops a captured request being replayed later.
 *
 * The scheme is deliberately Stripe's: it is the one every integrator has
 * already written code for, and `t` inside the signed string is what makes the
 * timestamp itself unforgeable.
 * ---------------------------------------------------------------------------
 */

export const SIGNATURE_HEADER = "X-BC-Signature";
export const EVENT_HEADER = "X-BC-Event";
export const DELIVERY_HEADER = "X-BC-Delivery";

/** How far a receiver should let the timestamp drift, and what we document. */
export const REPLAY_TOLERANCE_SECONDS = 300;

/** After this many failures in a row an endpoint is switched off. */
const DISABLE_AFTER_FAILURES = 10;

/** Attempts per delivery before it is given up on. */
export const MAX_DELIVERY_ATTEMPTS = 5;

const REQUEST_TIMEOUT_MS = 10_000;

/** Enough of a response to diagnose a rejection, not enough to fill the table. */
const RESPONSE_SNIPPET_CHARS = 2000;

/* ------------------------------------------------------------------ events */

export interface WebhookEventDefinition {
  type: string;
  /** What it means, in the words the person setting up the Zap will recognise. */
  label: string;
}

export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
  { type: "contact.created", label: "A new contact is added" },
  { type: "contact.updated", label: "A contact's details change" },
  { type: "contact.tagged", label: "A tag is added to a contact" },
  { type: "order.paid", label: "Someone pays for something" },
  { type: "order.refunded", label: "You refund an order" },
  { type: "subscription.started", label: "A subscription starts" },
  { type: "subscription.cancelled", label: "A subscription is cancelled" },
  { type: "member.created", label: "Someone creates an account" },
  { type: "member.granted_access", label: "Someone is given access to a product" },
  { type: "form.submitted", label: "Someone fills in a form" },
  { type: "coaching.booked", label: "A coaching session is booked" },
  { type: "coaching.cancelled", label: "A coaching session is cancelled" },
  { type: "test.ping", label: "A test message you sent yourself" },
];

const KNOWN_EVENTS = new Set(WEBHOOK_EVENTS.map((e) => e.type));

export function isKnownEvent(type: string): boolean {
  return KNOWN_EVENTS.has(type);
}

/* --------------------------------------------------------------- signing */

/** A signing secret for a new endpoint. Shown once, then only ever compared. */
export function generateSigningSecret(): string {
  return `whsec_${generateToken(24)}`;
}

/**
 * The `X-BC-Signature` value for a body at a moment in time.
 *
 * Exported because it is the half of the scheme that has to be testable
 * independently of a live endpoint — see webhooksOut.test.ts.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

/**
 * The receiver's side of the scheme, written out here so the documentation
 * above is executable rather than aspirational.
 */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  options: { atSeconds?: number; toleranceSeconds?: number } = {}
): boolean {
  const at = options.atSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? REPLAY_TOLERANCE_SECONDS;

  const parts = new Map(
    header
      .split(",")
      .map((piece) => piece.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
  );

  const timestamp = Number(parts.get("t"));
  const presented = parts.get("v1") ?? "";
  if (!Number.isFinite(timestamp) || !presented) return false;
  if (Math.abs(at - timestamp) > tolerance) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The queue's dedupe key for "attempt number N at this delivery".
 *
 * Shared by dispatch, by the retry the previous attempt schedules and by the
 * sweeper, because all three can legitimately decide the same delivery is due
 * and only one of them may result in a POST.
 */
export function deliveryJobKey(deliveryId: string, attempts: number): string {
  return `webhook-delivery:${deliveryId}:${attempts}`;
}

/* -------------------------------------------------------------- dispatch */

/**
 * Records a delivery for every endpoint subscribed to this event and queues it.
 *
 * Never throws. This is called from the middle of a checkout, a form submission
 * and a Stripe webhook; a misconfigured integration must not be able to fail
 * the thing that triggered it. The delivery log is where a failure shows up.
 *
 * Returns how many endpoints it went to, which is what the "send a test"
 * button reports back.
 */
export async function dispatchEvent(
  eventType: string,
  payload: Record<string, unknown>,
  options: { endpointId?: number } = {}
): Promise<number> {
  try {
    const endpoints = await pool.query<{ id: number }>(
      `SELECT id
         FROM webhook_endpoints
        WHERE enabled
          AND ($2::int IS NULL OR id = $2)
          -- An endpoint that named no events wants all of them.
          AND (cardinality(event_types) = 0 OR $1 = ANY (event_types))`,
      [eventType, options.endpointId ?? null]
    );

    if (endpoints.rows.length === 0) return 0;

    const body = JSON.stringify(payload);

    for (const endpoint of endpoints.rows) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO webhook_deliveries (endpoint_id, event_type, payload, next_attempt_at)
         VALUES ($1, $2, $3::jsonb, now())
         RETURNING id`,
        [endpoint.id, eventType, body]
      );

      const deliveryId = inserted.rows[0]?.id;
      if (!deliveryId) continue;

      await enqueue({
        kind: "webhooks.deliver",
        payload: { deliveryId },
        priority: PRIORITY.normal,
        // Keyed on the delivery and the attempt it is for, which is the same
        // key the retry and the sweeper build — so however many of the three
        // notice a due delivery, the endpoint is posted to once.
        dedupeKey: deliveryJobKey(deliveryId, 0),
      });
    }

    return endpoints.rows.length;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[webhooks] failed to dispatch ${eventType} (continuing):`, err);
    return 0;
  }
}

/**
 * Re-sends a delivery as a new one.
 *
 * A fresh row rather than resetting the old one: the log is the record of what
 * was attempted and when, and a replay that overwrote its own history would
 * make "we sent it, they 500'd, we sent it again" indistinguishable from "it
 * worked first time".
 */
export async function replayDelivery(deliveryId: string): Promise<string | null> {
  const source = await pool.query<{
    endpoint_id: number;
    event_type: string;
    payload: unknown;
  }>(`SELECT endpoint_id, event_type, payload FROM webhook_deliveries WHERE id = $1`, [deliveryId]);

  const row = source.rows[0];
  if (!row) return null;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO webhook_deliveries (endpoint_id, event_type, payload, next_attempt_at)
     VALUES ($1, $2, $3::jsonb, now())
     RETURNING id`,
    [row.endpoint_id, row.event_type, JSON.stringify(row.payload ?? {})]
  );

  const newId = inserted.rows[0]?.id;
  if (!newId) return null;

  await enqueue({
    kind: "webhooks.deliver",
    payload: { deliveryId: newId },
    priority: PRIORITY.normal,
    dedupeKey: deliveryJobKey(newId, 0),
  });

  return newId;
}

/* -------------------------------------------------------------- delivering */

export type DeliveryOutcome =
  | { status: "delivered"; responseStatus: number }
  | { status: "retrying"; attempts: number; nextAttemptAt: Date; error: string }
  | { status: "dead"; attempts: number; error: string }
  | { status: "skipped"; reason: string };

interface DeliveryRow {
  id: string;
  endpoint_id: number;
  event_type: string;
  payload: unknown;
  attempts: number;
  status: string;
  url: string;
  signing_secret: string;
  enabled: boolean;
}

/**
 * 30s, 2m, 10m, 1h.
 *
 * Slower than the job queue's own curve on purpose: the usual reason a webhook
 * fails is that the receiving service is down or redeploying, and hammering it
 * four times inside two minutes helps nobody. An hour is roughly the point at
 * which a human has noticed.
 */
export function deliveryBackoffSeconds(attempts: number): number {
  const schedule = [30, 120, 600, 3600];
  return schedule[Math.min(Math.max(attempts, 1), schedule.length) - 1];
}

/** One attempt at one delivery. Owns its own retry scheduling; never throws. */
export async function attemptDelivery(deliveryId: string): Promise<DeliveryOutcome> {
  const found = await pool.query<DeliveryRow>(
    `SELECT d.id, d.endpoint_id, d.event_type, d.payload, d.attempts, d.status,
            e.url, e.signing_secret, e.enabled
       FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.id = $1`,
    [deliveryId]
  );

  const row = found.rows[0];
  if (!row) return { status: "skipped", reason: "delivery no longer exists" };
  if (row.status !== "pending") return { status: "skipped", reason: `already ${row.status}` };
  if (!row.enabled) return { status: "skipped", reason: "endpoint is switched off" };

  const body = JSON.stringify(row.payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000);
  const attempts = row.attempts + 1;

  let responseStatus = 0;
  let responseBody = "";
  let failure = "";

  try {
    const response = await fetch(row.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BossClinician-Webhooks/1",
        [SIGNATURE_HEADER]: signPayload(row.signing_secret, body, timestamp),
        [EVENT_HEADER]: row.event_type,
        [DELIVERY_HEADER]: row.id,
      },
      body,
      // Without this a receiver that accepts the connection and never answers
      // holds a worker slot until the process restarts.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    responseStatus = response.status;
    responseBody = (await response.text().catch(() => "")).slice(0, RESPONSE_SNIPPET_CHARS);
    if (!response.ok) failure = `Endpoint answered ${response.status}`;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  if (!failure) {
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'delivered', attempts = $2, response_status = $3, response_body = $4,
              error = '', delivered_at = now(), next_attempt_at = NULL
        WHERE id = $1`,
      [row.id, attempts, responseStatus, responseBody]
    );
    await pool.query(
      `UPDATE webhook_endpoints
          SET consecutive_failures = 0, disabled_reason = '', updated_at = now()
        WHERE id = $1 AND consecutive_failures > 0`,
      [row.endpoint_id]
    );
    return { status: "delivered", responseStatus };
  }

  const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
  const nextAttemptAt = dead
    ? null
    : new Date(Date.now() + deliveryBackoffSeconds(attempts) * 1000);

  await pool.query(
    `UPDATE webhook_deliveries
        SET status = $5, attempts = $2, response_status = $3, response_body = $4,
            error = $6, next_attempt_at = $7
      WHERE id = $1`,
    [
      row.id,
      attempts,
      responseStatus || null,
      responseBody,
      dead ? "dead" : "pending",
      failure.slice(0, 500),
      nextAttemptAt,
    ]
  );

  // Only a give-up counts against the endpoint. Counting every attempt would
  // switch an endpoint off after two bad deliveries rather than ten bad events.
  if (dead) await recordEndpointFailure(row.endpoint_id);

  if (!dead && nextAttemptAt) {
    await enqueue({
      kind: "webhooks.deliver",
      payload: { deliveryId: row.id },
      priority: PRIORITY.normal,
      runAt: nextAttemptAt,
      dedupeKey: deliveryJobKey(row.id, attempts),
    });
    return { status: "retrying", attempts, nextAttemptAt, error: failure };
  }

  return { status: "dead", attempts, error: failure };
}

/**
 * Counts a give-up against an endpoint, and switches it off once it has stopped
 * working ten times running.
 *
 * A dead endpoint left enabled queues a job for every event forever. The
 * disable reason is what the integrations screen shows so the state is
 * explicable rather than mysterious.
 */
async function recordEndpointFailure(endpointId: number): Promise<void> {
  await pool.query(
    `UPDATE webhook_endpoints
        SET consecutive_failures = consecutive_failures + 1,
            enabled = CASE WHEN consecutive_failures + 1 >= $2 THEN false ELSE enabled END,
            disabled_reason = CASE
              WHEN consecutive_failures + 1 >= $2 THEN $3::text
              ELSE disabled_reason END,
            updated_at = now()
      WHERE id = $1`,
    [
      endpointId,
      DISABLE_AFTER_FAILURES,
      `Switched off automatically after ${DISABLE_AFTER_FAILURES} failed deliveries in a row.`,
    ]
  );
}

/**
 * Deliveries that are due and have no job left looking after them.
 *
 * The retry sweep exists because the queue is not the source of truth here: a
 * job lost to a crash between `fail` and `enqueue` would leave a delivery
 * `pending` with a due date and nothing to pick it up.
 */
export async function dueDeliveries(limit = 200): Promise<{ id: string; attempts: number }[]> {
  const res = await pool.query<{ id: string; attempts: number }>(
    `SELECT id, attempts FROM webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT $1`,
    [limit]
  );
  return res.rows;
}
