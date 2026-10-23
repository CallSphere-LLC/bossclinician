import { z } from "zod";
import { pool } from "../db/pool";
import { renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import { PRIORITY, enqueue } from "../jobs/queue";
import { manualSendKey } from "./engagement";

/**
 * The Engagement page's two buttons (row 171): "Send reminder" for a lesson
 * video and "Email the replay" for a live session.
 *
 * Neither sends in the request. Each press writes one `engagement_sends` row
 * per person with a unique `dedupe_key` (kind, thing, person, day), and only a
 * row that was actually inserted gets a job. So a double click, a retried
 * request, or a second admin pressing the same button the same afternoon is
 * one email, not two.
 *
 * The job claims its row queued → sending in a single UPDATE before it calls
 * the provider. Whatever happens after that — a timeout, a crash, a lease that
 * lapsed — the row is never put back to queued: at most once, the same choice
 * the automation runner makes for `send_email`. A failure is written on the
 * row for the page to show.
 *
 * Sent as non-transactional mail ("automation" in the delivery log), so every
 * marketing gate applies: the suppression list, the contact's status, the
 * email-link preference centre and the member account's own switches, the
 * sending identity check, the CAN-SPAM footer, and outside production the
 * recipient guard. Lesson reminders go under the "product" topic (course and
 * product updates), replays under "events".
 */

export type EngagementSendKind = "lesson_reminder" | "replay";

export interface EngagementRecipient {
  memberId: number | null;
  contactId: number | null;
  email: string;
  name: string;
  /** {{lessonUrl}}, {{replayUrl}}… — frozen into the row at the press. */
  merge: Record<string, string>;
}

export interface QueueSendsInput {
  kind: EngagementSendKind;
  /** What the send is about, for the dedupe key: `lesson:12`, a session key. */
  ref: string;
  recipients: EngagementRecipient[];
  subject: string;
  bodyMd: string;
  createdBy: number | null;
  lessonId?: number | null;
  communityEventId?: number | null;
  eventId?: number | null;
  sessionStartsAt?: Date | null;
  now?: Date;
}

export interface QueueSendsResult {
  queued: number;
  /** Already sent (or queued) to this person for this today. */
  alreadySent: number;
  /** No contact record to address an unsubscribe link to. */
  noContact: number;
}

/** The most people one press may email. */
export const MAX_RECIPIENTS_PER_PRESS = 500;

async function contactFor(recipient: EngagementRecipient): Promise<number | null> {
  if (recipient.contactId) return recipient.contactId;
  // Looked up, never created: making a contact here would fire "a new person
  // joins your list" automations for somebody who is already a member.
  const found = await pool.query<{ id: number }>(
    `SELECT id FROM contacts WHERE email = $1 LIMIT 1`,
    [recipient.email.trim().toLowerCase()]
  );
  return found.rows[0]?.id ?? null;
}

export async function queueEngagementSends(input: QueueSendsInput): Promise<QueueSendsResult> {
  const now = input.now ?? new Date();
  const result: QueueSendsResult = { queued: 0, alreadySent: 0, noContact: 0 };

  for (const recipient of input.recipients.slice(0, MAX_RECIPIENTS_PER_PRESS)) {
    const email = recipient.email.trim().toLowerCase();
    if (!email) continue;
    const contactId = await contactFor(recipient);
    if (contactId === null) {
      result.noContact += 1;
      continue;
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO engagement_sends
         (kind, dedupe_key, member_id, contact_id, email, lesson_id, community_event_id,
          event_id, session_starts_at, subject, body_md, merge_values, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        input.kind,
        manualSendKey(input.kind, input.ref, recipient.memberId ?? email, now),
        recipient.memberId,
        contactId,
        email,
        input.lessonId ?? null,
        input.communityEventId ?? null,
        input.eventId ?? null,
        input.sessionStartsAt ?? null,
        input.subject,
        input.bodyMd,
        JSON.stringify({ ...recipient.merge, name: recipient.name }),
        input.createdBy,
      ]
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      result.alreadySent += 1;
      continue;
    }
    await enqueue({
      kind: "engagement.sendManual",
      payload: { sendId: Number(id) },
      priority: PRIORITY.normal,
      dedupeKey: `engagement-send:${id}`,
    });
    result.queued += 1;
  }
  return result;
}

const sendPayload = z.object({ sendId: z.coerce.number().int().positive() });

interface ClaimedSend {
  id: string;
  kind: EngagementSendKind;
  member_id: number | null;
  contact_id: number | null;
  email: string;
  subject: string;
  body_md: string;
  merge_values: Record<string, unknown>;
}

/** The job: claim, send once, record. Never throws for a send failure. */
export async function deliverEngagementSend(payload: Record<string, unknown>): Promise<unknown> {
  const { sendId } = sendPayload.parse(payload);
  const claimed = await pool.query<ClaimedSend>(
    `UPDATE engagement_sends SET status = 'sending'
      WHERE id = $1 AND status = 'queued'
      RETURNING id, kind, member_id, contact_id, email::text AS email, subject, body_md, merge_values`,
    [sendId]
  );
  const row = claimed.rows[0];
  if (!row) return { skipped: "already handled" };

  const merge: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.merge_values ?? {})) {
    if (value !== null && value !== undefined) merge[key] = String(value);
  }
  const name = merge.name ?? "";
  const values = {
    ...merge,
    firstName: name.split(" ")[0] || "there",
    name: name || row.email,
    email: row.email,
  };
  const body = renderTokens(row.body_md, values);

  try {
    const sent = await sendEmail({
      to: row.email,
      subject: renderTokens(row.subject, values),
      text: body,
      html: renderMarkdown(body),
      contactId: row.contact_id,
      memberId: row.member_id,
      sourceType: "automation",
      sourceId: null,
      topic: row.kind === "replay" ? "events" : "product",
    });
    await pool.query(
      `UPDATE engagement_sends
          SET status = $2, error = $3, email_message_id = $4, sent_at = now()
        WHERE id = $1`,
      [
        row.id,
        sent.outcome === "suppressed" ? "suppressed" : "sent",
        sent.suppressedReason ?? "",
        sent.messageId,
      ]
    );
    return { sendId, outcome: sent.outcome };
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await pool.query(
      `UPDATE engagement_sends SET status = 'failed', error = $2 WHERE id = $1`,
      [row.id, detail]
    );
    // Returned, not thrown: a retry of this job would find the row no longer
    // queued and do nothing anyway, and the failure belongs on the page.
    return { sendId, failed: detail };
  }
}

/**
 * Housekeeping for the sweep: a row whose job was never queued (the enqueue
 * failed after the insert) is queued again — the claim makes that safe — and a
 * row stuck on 'sending' for a quarter of an hour is marked failed, because it
 * may well have gone out and must not be tried again by itself.
 */
export async function tidyEngagementSends(): Promise<{ requeued: number; abandoned: number }> {
  const stranded = await pool.query<{ id: string }>(
    `SELECT id FROM engagement_sends
      WHERE status = 'queued' AND created_at < now() - interval '10 minutes'
      ORDER BY id LIMIT 500`
  );
  let requeued = 0;
  for (const row of stranded.rows) {
    const job = await enqueue({
      kind: "engagement.sendManual",
      payload: { sendId: Number(row.id) },
      priority: PRIORITY.normal,
      dedupeKey: `engagement-send:${row.id}`,
    });
    if (job) requeued += 1;
  }
  const abandoned = await pool.query(
    `UPDATE engagement_sends
        SET status = 'failed',
            error = 'Stopped part way through sending; not retried in case it already went out'
      WHERE status = 'sending' AND created_at < now() - interval '15 minutes'`
  );
  return { requeued, abandoned: abandoned.rowCount ?? 0 };
}
