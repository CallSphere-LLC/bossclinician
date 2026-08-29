import crypto from "crypto";
import express, { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { providerSettings, suppress } from "../../email/provider";
import { asyncHandler } from "../../utils/asyncHandler";

/**
 * Where the sending provider tells us what happened.
 *
 * This endpoint is the entire reason the platform can report an open rate at
 * all. It is also the only route on the public surface that can mark an address
 * undeliverable, which is why nothing here trusts the body until the signature
 * over the exact bytes has been checked — an unauthenticated caller who could
 * post a bounce could suppress the owner's whole list.
 *
 * IMPORTANT: this needs the raw request body, so app.ts must mount
 * `express.raw` for this path ahead of `express.json()`, exactly as it already
 * does for Stripe. The `express.raw` below is a second line of defence and does
 * nothing once the body has already been parsed.
 */

export const emailWebhookRouter = Router();

/* ------------------------------------------------------------- signatures */

/**
 * Svix's scheme, which is what Resend uses.
 *
 * The signed content is `id.timestamp.body`, the secret is base64 after its
 * `whsec_` prefix, and the header may carry several space-separated versioned
 * signatures because a secret being rotated means two are valid at once.
 */
function verifySvix(
  raw: Buffer,
  headers: { id: string; timestamp: string; signature: string },
  secret: string
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${raw.toString("utf8")}`)
    .digest("base64");

  for (const part of headers.signature.split(" ")) {
    const provided = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    if (provided.length !== expected.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
      return true;
    }
  }
  return false;
}

/** The plain scheme other providers use: a hex HMAC of the body in one header. */
function verifyPlain(raw: Buffer, provided: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const candidate = provided.replace(/^sha256=/i, "");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(expected, "utf8"));
}

/* ------------------------------------------------------------------ events */

const eventSchema = z.object({
  type: z.string().default(""),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string().optional(),
      message_id: z.string().optional(),
      to: z.union([z.string(), z.array(z.string())]).optional(),
      click: z.object({ link: z.string().optional() }).partial().optional(),
      bounce: z.object({ type: z.string().optional() }).partial().optional(),
      bounce_type: z.string().optional(),
      user_agent: z.string().optional(),
      ip_address: z.string().optional(),
    })
    .passthrough()
    .default({}),
});

type EventKind =
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "unsubscribed"
  | "failed";

/** Provider vocabulary in, this platform's vocabulary out. Unknown types are ignored. */
function toKind(type: string): EventKind | null {
  switch (type.replace(/^email\./, "")) {
    case "delivered":
      return "delivered";
    case "opened":
    case "open":
      return "opened";
    case "clicked":
    case "click":
      return "clicked";
    case "bounced":
    case "bounce":
      return "bounced";
    case "complained":
    case "complaint":
    case "spamcomplaint":
      return "complained";
    case "unsubscribed":
    case "unsubscribe":
      return "unsubscribed";
    case "failed":
    case "delivery_error":
      return "failed";
    default:
      return null;
  }
}

/**
 * A bounce the address will never recover from.
 *
 * Only permanent bounces suppress. A mailbox that was full on Tuesday is not a
 * reason to stop emailing somebody forever, and treating every soft bounce as
 * fatal is how a list shrinks by a third after one bad send.
 */
function isPermanentBounce(data: { bounce?: { type?: string }; bounce_type?: string }): boolean {
  const type = (data.bounce?.type ?? data.bounce_type ?? "permanent").toLowerCase();
  return !type.includes("transient") && !type.includes("soft") && !type.includes("delay");
}

/* ------------------------------------------------------------------- route */

/**
 * Applies one event.
 *
 * Idempotent on `provider_event_id`: the unique index decides, not a read
 * followed by a write. Every provider redelivers, and a replayed open event
 * that incremented a counter a second time would make the open rate drift
 * upwards every time their queue hiccupped.
 */
/**
 * A stable id for a provider that sends none.
 *
 * `provider_event_id` is the idempotency key and its unique index is partial on
 * `IS NOT NULL`, so an empty one switches the guard off entirely — and a
 * provider on the plain-HMAC scheme with no `id` in its body supplies exactly
 * that. Its redeliveries would then each insert a fresh row and re-run the side
 * effects: opens counted twice, a bounce re-suppressing an address. Hashing what
 * the event actually says gives redeliveries of the same event the same key.
 *
 * `created_at` is in the hash and is the field that carries the whole weight of
 * "genuine repeat" versus "same event again". Without it a reader who opens the
 * same email twice, or clicks the same link on Tuesday and again on Friday,
 * hashes identically to the first time and every later one is thrown away as a
 * replay — so an engaged reader counts once. It is the provider's own timestamp
 * for the event rather than our clock, which is what keeps a redelivery of one
 * event stable: two deliveries of the same open carry the same timestamp, two
 * different opens do not.
 */
function derivedEventId(event: z.infer<typeof eventSchema>, kind: EventKind): string {
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        kind,
        event.data.email_id ?? event.data.message_id ?? "",
        Array.isArray(event.data.to) ? (event.data.to[0] ?? "") : (event.data.to ?? ""),
        event.created_at ?? "",
        event.data.click?.link ?? "",
      ].join("\n")
    )
    .digest("base64url");
  return `derived:${digest}`;
}

async function applyEvent(
  event: z.infer<typeof eventSchema>,
  providerEventId: string
): Promise<"applied" | "replay" | "unmatched" | "ignored"> {
  const kind = toKind(event.type);
  if (kind === null) return "ignored";

  const eventId = providerEventId || derivedEventId(event, kind);

  const providerMessageId = event.data.email_id ?? event.data.message_id ?? "";
  const recipient = Array.isArray(event.data.to) ? event.data.to[0] : event.data.to;

  const messageRes = await pool.query<{ id: string; to_email: string; source_type: string; source_id: number | null }>(
    `SELECT id, to_email, source_type, source_id FROM email_messages
      WHERE provider_message_id = $1`,
    [providerMessageId]
  );
  const message = messageRes.rows[0];

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO email_events (message_id, provider_event_id, kind, url, user_agent, ip, payload, occurred_at)
     VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, now()))
     -- The migration's unique index on provider_event_id is PARTIAL, so the
     -- conflict target has to repeat its predicate or Postgres refuses the
     -- statement outright with "no unique or exclusion constraint matching".
     ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      message ? Number(message.id) : null,
      eventId,
      kind,
      event.data.click?.link ?? "",
      (event.data.user_agent ?? "").slice(0, 500),
      event.data.ip_address ?? "",
      JSON.stringify(event.data),
      event.created_at ?? null,
    ]
  );
  if (inserted.rowCount === 0) return "replay";

  const email = (message?.to_email ?? recipient ?? "").toLowerCase();

  if (message) {
    await updateMessageCounters(Number(message.id), kind);
    if (message.source_type === "broadcast" && message.source_id !== null) {
      await updateCampaignCounters(message.source_id, email, kind);
    }
  }

  if (kind === "bounced" && email && isPermanentBounce(event.data)) {
    await suppress({
      email,
      reason: "bounce",
      detail: event.type,
      contactStatus: "bounced",
    });
  }
  if (kind === "complained" && email) {
    await suppress({
      email,
      reason: "complaint",
      detail: event.type,
      contactStatus: "complained",
    });
  }
  if (kind === "unsubscribed" && email) {
    await suppress({ email, reason: "unsubscribe", detail: event.type });
  }

  return message ? "applied" : "unmatched";
}

async function updateMessageCounters(messageId: number, kind: EventKind): Promise<void> {
  switch (kind) {
    case "delivered":
      await pool.query(
        `UPDATE email_messages SET status = 'delivered', delivered_at = COALESCE(delivered_at, now())
          WHERE id = $1 AND status IN ('queued', 'sent')`,
        [messageId]
      );
      return;
    case "opened":
      await pool.query(
        `UPDATE email_messages
            SET open_count = open_count + 1,
                first_opened_at = COALESCE(first_opened_at, now())
          WHERE id = $1`,
        [messageId]
      );
      return;
    case "clicked":
      // A click implies an open even when the open pixel was blocked, which it
      // increasingly is; without this the click rate can exceed the open rate.
      await pool.query(
        `UPDATE email_messages
            SET click_count = click_count + 1,
                first_clicked_at = COALESCE(first_clicked_at, now()),
                first_opened_at = COALESCE(first_opened_at, now())
          WHERE id = $1`,
        [messageId]
      );
      return;
    case "bounced":
      await pool.query(`UPDATE email_messages SET status = 'bounced' WHERE id = $1`, [messageId]);
      return;
    case "complained":
      await pool.query(`UPDATE email_messages SET status = 'complained' WHERE id = $1`, [messageId]);
      return;
    case "failed":
      await pool.query(`UPDATE email_messages SET status = 'failed' WHERE id = $1`, [messageId]);
      return;
    case "unsubscribed":
      return;
  }
}

/** Keeps the campaign-level totals the reports read in step with the events. */
async function updateCampaignCounters(
  campaignId: number,
  email: string,
  kind: EventKind
): Promise<void> {
  const columns: Partial<Record<EventKind, string>> = {
    opened: "opened_count",
    clicked: "clicked_count",
    bounced: "bounced_count",
    unsubscribed: "unsubscribed_count",
  };
  const column = columns[kind];
  if (!column) return;

  await pool.query(
    `UPDATE email_campaigns SET ${column} = ${column} + 1, updated_at = now() WHERE id = $1`,
    [campaignId]
  );

  if (kind === "opened" && email) {
    await pool.query(
      `UPDATE email_sends SET status = 'opened', opened_at = COALESCE(opened_at, now())
        WHERE campaign_id = $1 AND email = $2 AND status = 'sent'`,
      [campaignId, email]
    );
  }
}

/**
 * POST /api/email/webhook
 *
 * Answers 200 to anything it has already seen or does not understand, and 401
 * to anything it cannot authenticate. A provider retries on a 5xx, so a genuine
 * failure here is left to throw and be retried rather than swallowed.
 */
emailWebhookRouter.post(
  "/email/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const { webhookSecret } = await providerSettings();
    if (!webhookSecret) {
      // Refuse rather than accept unsigned events: an endpoint that trusts
      // anybody while the secret is unset is an open door to the suppression
      // list, and "we will configure it later" is how it stays open.
      res.status(503).json({ error: "Email webhooks are not configured yet" });
      return;
    }

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    const header = (name: string): string => {
      const value = req.headers[name];
      return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
    };

    const svixId = header("svix-id");
    const svixTimestamp = header("svix-timestamp");
    const svixSignature = header("svix-signature");
    const plainSignature = header("x-webhook-signature");

    const verified = svixSignature
      ? verifySvix(raw, { id: svixId, timestamp: svixTimestamp, signature: svixSignature }, webhookSecret)
      : plainSignature
        ? verifyPlain(raw, plainSignature, webhookSecret)
        : false;

    if (!verified) {
      res.status(401).json({ error: "Signature does not match" });
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Body is not JSON" });
      return;
    }

    // A provider may batch. Both shapes are accepted so neither has to be
    // guessed at from the documentation of whichever service is in use.
    const rawEvents = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
    const outcomes: string[] = [];

    for (const [index, candidate] of rawEvents.entries()) {
      const parsed = eventSchema.safeParse(candidate);
      if (!parsed.success) {
        outcomes.push("malformed");
        continue;
      }
      // The delivery id is the idempotency key. Svix gives one per request, so
      // a batch is disambiguated by position within it.
      const bodyId =
        typeof (candidate as { id?: unknown }).id === "string"
          ? (candidate as { id: string }).id
          : "";
      const providerEventId = bodyId || (svixId ? `${svixId}:${index}` : "");
      outcomes.push(await applyEvent(parsed.data, providerEventId));
    }

    res.json({ received: outcomes.length, outcomes });
  })
);

/* ------------------------------------------------------- Amazon SES / SNS */

/**
 * SES reports what happened to a message through SNS, which authenticates
 * nothing like a webhook provider does.
 *
 * There is no shared secret. Every notification is signed with a private key
 * whose certificate SNS names in the body itself, which means the URL in the
 * body decides which public key we verify against — and a caller who could
 * point that at a certificate they control could forge a bounce for any address
 * on the list and have it suppressed. `certUrlAllowed` is therefore the load-
 * bearing check in this whole section, and it is applied before the fetch, not
 * after.
 */
const SNS_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

function certUrlAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && SNS_CERT_HOST.test(parsed.hostname);
}

/**
 * Certificates keyed by URL. SNS rotates rarely and posts constantly, so
 * fetching one per notification would put an outbound request in the path of
 * every delivery receipt.
 */
const snsCertCache = new Map<string, string>();

async function fetchSigningCert(url: string): Promise<string | null> {
  const cached = snsCertCache.get(url);
  if (cached !== undefined) return cached;
  if (!certUrlAllowed(url)) return null;

  const response = await fetch(url);
  if (!response.ok) return null;
  const pem = await response.text();
  if (!pem.includes("BEGIN CERTIFICATE")) return null;

  // Bounded so a caller cycling through query strings on a legitimate SNS host
  // cannot grow this map without limit.
  if (snsCertCache.size > 32) snsCertCache.clear();
  snsCertCache.set(url, pem);
  return pem;
}

/** The exact fields SNS signs, in the exact order, per message type. */
const SNS_SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type",
  ],
  UnsubscribeConfirmation: [
    "Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type",
  ],
};

async function verifySns(body: Record<string, unknown>): Promise<boolean> {
  const type = String(body.Type ?? "");
  const fields = SNS_SIGNED_FIELDS[type];
  if (!fields) return false;

  const parts: string[] = [];
  for (const field of fields) {
    const value = body[field];
    // Subject is genuinely optional and is omitted from the signed string when
    // absent rather than signed as empty.
    if (value === undefined || value === null) continue;
    parts.push(field, String(value));
  }
  const canonical = `${parts.join("\n")}\n`;

  const pem = await fetchSigningCert(String(body.SigningCertURL ?? ""));
  if (pem === null) return false;

  const algorithm = String(body.SignatureVersion ?? "1") === "2" ? "RSA-SHA256" : "RSA-SHA1";
  try {
    return crypto
      .createVerify(algorithm)
      .update(canonical, "utf8")
      .verify(pem, String(body.Signature ?? ""), "base64");
  } catch {
    return false;
  }
}

/** SES's vocabulary, mapped to the one `applyEvent` already speaks. */
const SES_EVENT_TYPES: Record<string, string> = {
  Bounce: "bounced",
  Complaint: "complained",
  Delivery: "delivered",
  Open: "opened",
  Click: "clicked",
  Reject: "failed",
  RenderingFailure: "failed",
};

interface SesNotification {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[]; timestamp?: string };
  bounce?: {
    bounceType?: string;
    bouncedRecipients?: { emailAddress?: string }[];
    timestamp?: string;
  };
  complaint?: { complainedRecipients?: { emailAddress?: string }[]; timestamp?: string };
  delivery?: { timestamp?: string };
  open?: { userAgent?: string; ipAddress?: string; timestamp?: string };
  click?: { link?: string; userAgent?: string; ipAddress?: string; timestamp?: string };
}

/**
 * An SES notification in the shape the shared event path expects.
 *
 * The recipient is taken from the bounce or complaint block in preference to
 * `mail.destination`: a message to several people can bounce for one of them,
 * and suppressing the whole envelope over one dead mailbox would take working
 * addresses off the list.
 */
function fromSesNotification(
  notification: SesNotification
): z.infer<typeof eventSchema> | null {
  const sesType = notification.eventType ?? notification.notificationType ?? "";
  const type = SES_EVENT_TYPES[sesType];
  if (!type) return null;

  const recipient =
    notification.bounce?.bouncedRecipients?.[0]?.emailAddress ??
    notification.complaint?.complainedRecipients?.[0]?.emailAddress ??
    notification.mail?.destination?.[0] ??
    "";

  // The event's own timestamp, never `mail.timestamp` unless there is nothing
  // else: `mail.timestamp` is when the message was *sent* and is identical on
  // every event about it, so leaning on it would make a reader's second open
  // hash the same as their first and be discarded as a replay by
  // `derivedEventId`. It is also the honest value for `occurred_at`, which
  // otherwise records when we happened to process the notification.
  const occurredAt =
    notification.open?.timestamp ??
    notification.click?.timestamp ??
    notification.bounce?.timestamp ??
    notification.complaint?.timestamp ??
    notification.delivery?.timestamp ??
    notification.mail?.timestamp;

  return eventSchema.parse({
    type,
    created_at: occurredAt,
    data: {
      message_id: notification.mail?.messageId ?? "",
      to: recipient,
      bounce_type: notification.bounce?.bounceType ?? "",
      click: { link: notification.click?.link ?? "" },
      user_agent: notification.open?.userAgent ?? notification.click?.userAgent ?? "",
      ip_address: notification.open?.ipAddress ?? notification.click?.ipAddress ?? "",
    },
  });
}

/**
 * POST /api/email/webhook/ses
 *
 * The SNS endpoint SES's configuration sets deliver to. Confirms its own
 * subscription on first contact, which is what makes the topic live without a
 * console visit — but only for the topic this deployment was told to expect, so
 * a stranger's topic cannot enlist this endpoint as a listener.
 */
emailWebhookRouter.post(
  "/email/webhook/ses",
  express.raw({ type: () => true, limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Body is not JSON" });
      return;
    }

    const topicArn = String(body.TopicArn ?? "");
    if (env.ses.snsTopicArn && topicArn !== env.ses.snsTopicArn) {
      res.status(401).json({ error: "Unexpected topic" });
      return;
    }

    if (!(await verifySns(body))) {
      res.status(401).json({ error: "Signature does not match" });
      return;
    }

    const type = String(body.Type ?? "");

    if (type === "SubscriptionConfirmation") {
      const subscribeUrl = String(body.SubscribeURL ?? "");
      // The same host rule as the certificate: the confirmation is a GET this
      // server makes because a body told it to, and an unchecked URL there is a
      // request forgery with AWS credentials sitting in the environment.
      if (!certUrlAllowed(subscribeUrl)) {
        res.status(400).json({ error: "Unexpected confirmation URL" });
        return;
      }
      const confirmed = await fetch(subscribeUrl);
      res.json({ confirmed: confirmed.ok });
      return;
    }

    if (type !== "Notification") {
      res.json({ ignored: type });
      return;
    }

    let notification: SesNotification;
    try {
      notification = JSON.parse(String(body.Message ?? "{}")) as SesNotification;
    } catch {
      res.json({ ignored: "unparseable message" });
      return;
    }

    const event = fromSesNotification(notification);
    if (event === null) {
      res.json({ ignored: notification.eventType ?? "unknown" });
      return;
    }

    // SNS's own MessageId is stable across its retries, which is exactly what
    // the idempotency guard on `email_events` wants.
    const outcome = await applyEvent(event, String(body.MessageId ?? ""));
    res.json({ received: 1, outcomes: [outcome] });
  })
);
