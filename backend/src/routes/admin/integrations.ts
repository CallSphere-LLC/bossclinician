import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { rowsToCamel } from "../../utils/case";
import { generateToken, hashToken } from "../../auth/tokens";
import { recordAdminAction } from "../../services/adminAudit";
import { requirePermission } from "../../services/permissions";
import {
  WEBHOOK_EVENTS,
  dispatchEvent,
  generateSigningSecret,
  isKnownEvent,
  replayDelivery,
} from "../../services/webhooksOut";
import { API_SCOPES, formatApiKey, keyPrefix } from "../public/apiV1";

/**
 * Webhook endpoints, their delivery log, and the API keys that let another tool
 * read from here.
 *
 * Both halves follow the same rule: a credential is shown once, at the moment
 * it is created, and after that only ever as a hint. A screen that can re-read
 * a key is a screen that leaks every key the moment somebody's laptop is open
 * on the wrong page.
 */
export const adminIntegrationsRouter = Router();

/* ------------------------------------------------------------------ events */

adminIntegrationsRouter.get(
  "/events",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json({ events: WEBHOOK_EVENTS });
  })
);

/* ------------------------------------------------------ webhook endpoints */

const endpointSchema = z.object({
  name: z.string().max(200).default(""),
  url: z.string().url().max(2000),
  /** Empty means every event, which is what most Zapier setups want. */
  eventTypes: z.array(z.string().max(100)).max(50).default([]),
  enabled: z.boolean().default(true),
});

const endpointUpdateSchema = endpointSchema.partial();

function assertKnownEvents(types: string[]): void {
  const unknown = types.filter((t) => !isKnownEvent(t));
  if (unknown.length > 0) {
    throw badRequest("We don't send one of those events. Pick from the list.");
  }
}

/**
 * `url` is user-supplied and we will POST to it from inside the network, so it
 * is checked before it is stored rather than at delivery time — a refusal a
 * person can read beats a delivery log full of connection errors.
 */
function assertDeliverableUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("That doesn't look like a web address.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw badRequest("A webhook address has to start with https://");
  }

  // Loopback and link-local addresses point back at our own machine, which
  // turns a webhook into a way to make the server call its own internal
  // services. The check is on the hostname because that is what we will resolve.
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]";

  if (blocked) throw badRequest("That address is on this server's own network.");
}

adminIntegrationsRouter.get(
  "/webhooks",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT e.id, e.name, e.url, e.event_types, e.enabled, e.consecutive_failures,
              e.disabled_reason, e.created_at,
              count(d.id) FILTER (WHERE d.status = 'delivered')::int AS delivered_count,
              count(d.id) FILTER (WHERE d.status IN ('pending','dead'))::int AS failing_count,
              max(d.created_at) AS last_event_at
         FROM webhook_endpoints e
         LEFT JOIN webhook_deliveries d
                ON d.endpoint_id = e.id AND d.created_at > now() - interval '30 days'
        GROUP BY e.id
        ORDER BY e.created_at DESC`
    );
    res.json({ endpoints: rowsToCamel(result.rows) });
  })
);

adminIntegrationsRouter.post(
  "/webhooks",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const parsed = endpointSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    assertDeliverableUrl(parsed.data.url);
    assertKnownEvents(parsed.data.eventTypes);

    const secret = generateSigningSecret();
    const created = await pool.query(
      `INSERT INTO webhook_endpoints (name, url, event_types, signing_secret, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, url, event_types, enabled, created_at`,
      [
        parsed.data.name,
        parsed.data.url,
        parsed.data.eventTypes,
        secret,
        parsed.data.enabled,
      ]
    );

    await recordAdminAction({
      req,
      action: "webhook.create",
      entityType: "webhook_endpoint",
      entityId: created.rows[0].id,
      after: { url: parsed.data.url, eventTypes: parsed.data.eventTypes },
    });

    res.status(201).json({
      endpoint: rowsToCamel(created.rows)[0],
      // The only time this is ever returned. The screen must tell her to copy it
      // now, because we cannot show it to her again.
      signingSecret: secret,
    });
  })
);

adminIntegrationsRouter.put(
  "/webhooks/:id",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const parsed = endpointUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());
    if (parsed.data.url) assertDeliverableUrl(parsed.data.url);
    if (parsed.data.eventTypes) assertKnownEvents(parsed.data.eventTypes);

    const updated = await pool.query(
      `UPDATE webhook_endpoints
          SET name        = COALESCE($2, name),
              url         = COALESCE($3, url),
              event_types = COALESCE($4, event_types),
              enabled     = COALESCE($5, enabled),
              -- Switching an endpoint back on clears the strike count, or it
              -- would be disabled again by the next single failure.
              consecutive_failures = CASE WHEN $5 IS TRUE THEN 0 ELSE consecutive_failures END,
              disabled_reason      = CASE WHEN $5 IS TRUE THEN '' ELSE disabled_reason END,
              updated_at  = now()
        WHERE id = $1
        RETURNING id, name, url, event_types, enabled, consecutive_failures, disabled_reason`,
      [
        id,
        parsed.data.name ?? null,
        parsed.data.url ?? null,
        parsed.data.eventTypes ?? null,
        parsed.data.enabled ?? null,
      ]
    );

    if (!updated.rows[0]) throw notFound("We couldn't find that connection.");

    await recordAdminAction({
      req,
      action: "webhook.update",
      entityType: "webhook_endpoint",
      entityId: id,
      after: rowsToCamel(updated.rows)[0],
    });

    res.json(rowsToCamel(updated.rows)[0]);
  })
);

adminIntegrationsRouter.delete(
  "/webhooks/:id",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const removed = await pool.query<{ url: string }>(
      `DELETE FROM webhook_endpoints WHERE id = $1 RETURNING url`,
      [id]
    );
    if (!removed.rows[0]) throw notFound("We couldn't find that connection.");

    await recordAdminAction({
      req,
      action: "webhook.delete",
      entityType: "webhook_endpoint",
      entityId: id,
      before: { url: removed.rows[0].url },
    });

    res.status(204).end();
  })
);

/** Sends a real signed message to one endpoint, so a setup can be proved. */
adminIntegrationsRouter.post(
  "/webhooks/:id/test",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const found = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM webhook_endpoints WHERE id = $1`,
      [id]
    );
    if (!found.rows[0]) throw notFound("We couldn't find that connection.");
    if (!found.rows[0].enabled) throw badRequest("Switch this connection back on first.");

    const sent = await dispatchEvent(
      "test.ping",
      { event: "test.ping", sentAt: new Date().toISOString(), message: "Hello from Boss Clinician" },
      { endpointId: id }
    );

    res.json({ queued: sent > 0 });
  })
);

/* ------------------------------------------------------------- deliveries */

const deliveryQuerySchema = z.object({
  endpointId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "delivered", "failed", "dead"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminIntegrationsRouter.get(
  "/deliveries",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const parsed = deliveryQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid filter", parsed.error.flatten());

    const result = await pool.query(
      `SELECT d.id, d.endpoint_id, d.event_type, d.status, d.attempts, d.response_status,
              d.error, d.created_at, d.delivered_at, d.next_attempt_at,
              e.name AS endpoint_name, e.url AS endpoint_url
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE ($1::int IS NULL OR d.endpoint_id = $1)
          AND ($2::text IS NULL OR d.status = $2)
        ORDER BY d.created_at DESC
        LIMIT $3`,
      [parsed.data.endpointId ?? null, parsed.data.status ?? null, parsed.data.limit]
    );

    res.json({ deliveries: rowsToCamel(result.rows) });
  })
);

/** The body we sent and what came back — the one screen that answers "why not". */
adminIntegrationsRouter.get(
  "/deliveries/:id",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw badRequest("Invalid id");

    const result = await pool.query(
      `SELECT d.id, d.endpoint_id, d.event_type, d.payload, d.status, d.attempts,
              d.response_status, d.response_body, d.error, d.created_at, d.delivered_at,
              e.name AS endpoint_name, e.url AS endpoint_url
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.id = $1`,
      [id]
    );
    if (!result.rows[0]) throw notFound("We couldn't find that message.");

    res.json(rowsToCamel(result.rows)[0]);
  })
);

adminIntegrationsRouter.post(
  "/deliveries/:id/replay",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw badRequest("Invalid id");

    const newId = await replayDelivery(id);
    if (!newId) throw notFound("We couldn't find that message.");

    await recordAdminAction({
      req,
      action: "webhook.replay",
      entityType: "webhook_delivery",
      entityId: id,
      after: { replayedAs: newId },
    });

    res.status(202).json({ deliveryId: newId });
  })
);

/* --------------------------------------------------------------- API keys */

const apiKeySchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

adminIntegrationsRouter.get(
  "/api-keys",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT k.id, k.name, k.key_prefix, k.scopes, k.last_used_at, k.revoked_at, k.created_at,
              u.name AS created_by_name
         FROM api_keys k
         LEFT JOIN admin_users u ON u.id = k.created_by
        ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`
    );

    res.json({
      keys: rowsToCamel(
        result.rows.map((row) => ({
          ...row,
          // Never the key itself: only its hash is stored, so this is the most
          // that can be shown even by mistake.
          hint: `bck_${row.key_prefix}_${"•".repeat(8)}`,
        }))
      ),
    });
  })
);

adminIntegrationsRouter.post(
  "/api-keys",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const parsed = apiKeySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    // The prefix is stored in clear so a key can be identified in a list; the
    // secret half never touches the database in a readable form.
    const prefix = crypto.randomBytes(4).toString("hex");
    const key = formatApiKey(prefix, generateToken(24));

    const created = await pool.query(
      `INSERT INTO api_keys (name, key_hash, key_prefix, scopes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, key_prefix, scopes, created_at`,
      [parsed.data.name, hashToken(key), keyPrefix(key), parsed.data.scopes, req.user?.sub ?? null]
    );

    await recordAdminAction({
      req,
      action: "apiKey.create",
      entityType: "api_key",
      entityId: created.rows[0].id,
      after: { name: parsed.data.name, scopes: parsed.data.scopes },
    });

    res.status(201).json({ apiKey: rowsToCamel(created.rows)[0], key });
  })
);

adminIntegrationsRouter.post(
  "/api-keys/:id/revoke",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const revoked = await pool.query<{ name: string }>(
      `UPDATE api_keys SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING name`,
      [id]
    );
    if (!revoked.rows[0]) throw notFound("That key has already been turned off.");

    await recordAdminAction({
      req,
      action: "apiKey.revoke",
      entityType: "api_key",
      entityId: id,
      before: { name: revoked.rows[0].name },
    });

    res.json({ ok: true });
  })
);

/** The scopes a key can be given, described for the person creating it. */
adminIntegrationsRouter.get(
  "/api-scopes",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json({
      scopes: [
        { value: "contacts.read", label: "See your contacts" },
        { value: "contacts.write", label: "Add and update contacts" },
        { value: "orders.read", label: "See your orders" },
        { value: "offers.read", label: "See what you sell" },
      ],
    });
  })
);
