import crypto from "crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { fireTrigger, isTriggerV2, type TriggerInput, type TriggerV2 } from "../automations/engineV2";
import { pool } from "../db/pool";
import { enqueue, PRIORITY } from "../jobs/queue";
import { dispatchEvent } from "./webhooksOut";

/**
 * The one door from a completed business mutation into automations and
 * integrations.  Publishing is a small durable database write; execution is a
 * retryable worker job, never work left hanging off an HTTP response.
 */

export interface DomainEventInput extends TriggerInput {
  /** Stable upstream id where one exists (Stripe event, attempt, registration). */
  eventKey?: string;
  /** Optional transaction owner for an atomic mutation + outbox hand-off. */
  client?: Pick<PoolClient, "query">;
}

interface DomainEventRow {
  id: string;
  event_key: string;
  event_type: string;
  contact_id: number | null;
  email: string;
  name: string;
  subject_id: number | null;
  source: string;
  facts: Record<string, string | number | boolean | null>;
  processed_at: Date | null;
  created_at: Date;
}

const eventJobSchema = z.object({ eventId: z.coerce.number().int().positive() });

/** Outbound event names represented by the same underlying business event. */
const WEBHOOK_BY_TRIGGER: Partial<Record<TriggerV2, string[]>> = {
  contact_created: ["contact.created"],
  tag_added: ["contact.tagged"],
  offer_purchased: ["order.paid"],
  subscription_cancelled: ["subscription.cancelled"],
  subscription_cancel_requested: ["subscription.cancel_requested"],
  payment_plan_completed: ["payment_plan.completed"],
  certificate_earned: ["certificate.earned"],
  coaching_session_booked: ["coaching_session.booked"],
  form_submitted: ["form.submitted"],
};

export function webhookEventsFor(trigger: TriggerV2): string[] {
  return [...(WEBHOOK_BY_TRIGGER[trigger] ?? [])];
}

/**
 * Who an automation should treat a member as.
 *
 * Every domain event needs a contact to run conditions and tags against, and a
 * member row is not one: `contacts` is the marketing identity and `members` is
 * the login. This resolves the first from the second, falling back to whatever
 * the caller already knows when the member has no contact yet.
 *
 * Lives here rather than beside any one publisher because the Stripe webhook,
 * certificates and coaching all need the same answer, and three copies of this
 * query would drift.
 */
export async function automationIdentity(
  memberId: number | null,
  fallbackEmail = "",
  fallbackName = ""
): Promise<{ contactId: number | null; email: string; name: string }> {
  if (memberId === null) {
    return { contactId: null, email: fallbackEmail, name: fallbackName };
  }
  const found = await pool.query<{ contact_id: number | null; email: string; name: string }>(
    `SELECT contact_id, email::text AS email,
            COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), name, '') AS name
       FROM members WHERE id = $1`,
    [memberId]
  );
  return {
    contactId: found.rows[0]?.contact_id ?? null,
    email: found.rows[0]?.email ?? fallbackEmail,
    name: found.rows[0]?.name ?? fallbackName,
  };
}

export function domainEventJobKey(eventId: string | number): string {
  return `domain-event:${eventId}`;
}

/**
 * Persists and queues one occurrence.  The unique event key makes a retried
 * request or replayed provider notification collapse into the original row.
 */
export async function publishDomainEvent(
  eventType: TriggerV2,
  input: DomainEventInput,
): Promise<{ id: string; created: boolean }> {
  const eventKey = (input.eventKey ?? `${eventType}:${crypto.randomUUID()}`).slice(0, 300);
  const db = input.client ?? pool;
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO domain_events
       (event_key, event_type, contact_id, email, name, subject_id, source, facts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id`,
    [
      eventKey,
      eventType,
      input.contactId ?? null,
      (input.email ?? "").trim().toLowerCase(),
      input.name ?? "",
      input.subjectId ?? null,
      input.source ?? "",
      JSON.stringify(input.facts ?? {}),
    ],
  );

  let id = inserted.rows[0]?.id;
  const created = Boolean(id);
  if (!id) {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM domain_events WHERE event_key = $1`,
      [eventKey],
    );
    id = existing.rows[0]?.id;
  }
  if (!id) throw new Error(`Could not persist domain event ${eventKey}`);

  try {
    await enqueue({
      kind: "domainEvents.dispatch",
      payload: { eventId: id },
      priority: PRIORITY.normal,
      dedupeKey: domainEventJobKey(id),
      client: input.client,
    });
  } catch (err) {
    // The event row is the durable hand-off. The five-minute sweep will queue
    // it after a transient queue failure, so the completed user mutation must
    // not answer 500 and invite a duplicate retry.
    // eslint-disable-next-line no-console
    console.error(`[domain-events] ${eventKey} stored but not queued:`, err);
  }
  return { id, created };
}

/** Runs one stored event. Throws so the queue owns retry and dead-lettering. */
export async function dispatchDomainEvent(payload: Record<string, unknown>): Promise<unknown> {
  const { eventId } = eventJobSchema.parse(payload);
  const found = await pool.query<DomainEventRow>(
    `SELECT id, event_key, event_type, contact_id, email::text AS email, name,
            subject_id, source, facts, processed_at, created_at
       FROM domain_events WHERE id = $1`,
    [eventId],
  );
  const event = found.rows[0];
  if (!event) return { skipped: "event no longer exists" };
  if (event.processed_at !== null) return { skipped: "event already processed" };
  if (!isTriggerV2(event.event_type)) throw new Error(`Unknown domain event ${event.event_type}`);

  try {
    await fireTrigger(
      event.event_type,
      {
        contactId: event.contact_id,
        email: event.email,
        name: event.name,
        subjectId: event.subject_id,
        source: event.source,
        facts: event.facts ?? {},
        eventKey: event.event_key,
      },
      { rethrow: true },
    );

    const payloadBody = {
      id: event.event_key,
      type: event.event_type,
      contactId: event.contact_id,
      email: event.email,
      name: event.name,
      subjectId: event.subject_id,
      source: event.source,
      facts: event.facts ?? {},
      occurredAt: event.created_at.toISOString(),
    };
    let webhooks = 0;
    for (const webhookType of webhookEventsFor(event.event_type)) {
      webhooks += await dispatchEvent(
        webhookType,
        { ...payloadBody, type: webhookType },
        { rethrow: true },
      );
    }

    await pool.query(
      `UPDATE domain_events
          SET processed_at = now(), last_error = '', updated_at = now()
        WHERE id = $1 AND processed_at IS NULL`,
      [event.id],
    );
    return { trigger: event.event_type, webhooks };
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await pool.query(
      `UPDATE domain_events SET last_error = $2, updated_at = now() WHERE id = $1`,
      [event.id, detail],
    );
    throw err;
  }
}

/** Requeues durable rows left behind by a crash between INSERT and enqueue. */
export async function sweepDomainEvents(): Promise<{ queued: number }> {
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM domain_events
      WHERE processed_at IS NULL AND created_at < now() - interval '1 minute'
      ORDER BY created_at LIMIT 500`,
  );
  let queued = 0;
  for (const event of due.rows) {
    const job = await enqueue({
      kind: "domainEvents.dispatch",
      payload: { eventId: event.id },
      priority: PRIORITY.normal,
      dedupeKey: domainEventJobKey(event.id),
    });
    if (job) queued += 1;
  }
  return { queued };
}

/**
 * Publishes the anniversary of a contact joining the platform in their own
 * timezone.  The yearly key makes the daily sweep safe to repeat and also
 * covers a worker that runs twice around a daylight-saving transition.
 */
export async function publishContactAnniversaries(at = new Date()): Promise<{ published: number }> {
  const contacts = await pool.query<{
    id: number;
    email: string;
    name: string;
    timezone: string;
    created_at: Date;
  }>(
    `SELECT id, email::text AS email, name, timezone, created_at
       FROM contacts WHERE created_at <= now() - interval '1 year'`,
  );

  let published = 0;
  for (const contact of contacts.rows) {
    const timeZone = contact.timezone || "America/New_York";
    let today: Intl.DateTimeFormatPart[];
    let joined: Intl.DateTimeFormatPart[];
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      today = formatter.formatToParts(at);
      joined = formatter.formatToParts(contact.created_at);
    } catch {
      continue;
    }
    const part = (parts: Intl.DateTimeFormatPart[], type: string) =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    if (part(today, "month") !== part(joined, "month") || part(today, "day") !== part(joined, "day")) {
      continue;
    }
    const year = part(today, "year");
    const result = await publishDomainEvent("date_anniversary", {
      eventKey: `contact-anniversary:${contact.id}:${year}`,
      contactId: contact.id,
      email: contact.email,
      name: contact.name,
      source: "contact-anniversary",
      facts: { year: Number(year), joinedAt: contact.created_at.toISOString() },
    });
    if (result.created) published += 1;
  }
  return { published };
}
