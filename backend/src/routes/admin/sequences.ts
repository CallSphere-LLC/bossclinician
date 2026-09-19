import { Router } from "express";
import { z } from "zod";
import { partialUpdate } from "../../validation/partialUpdate";
import { marketingSettings } from "../../email/provider";
import { pool } from "../../db/pool";
import { mergeLinks, renderMarkdown, renderTokens, sendEmail } from "../../email/provider";
import {
  MERGE_TAGS,
  MERGE_TAG_SOURCES,
  buildMergeValues,
  customTokenKey,
  mergeTagsFor,
  type MergeTagEntry,
} from "../../email/mergeValues";
import { enrollContact, exitContact } from "../../services/sequences";
import { upsertContact } from "../../services/contacts";
import { asyncHandler } from "../../utils/asyncHandler";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { badRequest, notFound } from "../../utils/httpError";

/**
 * Sequence administration — mounted at /api/admin/sequences.
 *
 * The API is written in the vocabulary the screen uses rather than the
 * database's: minutes rather than intervals, "waitDays"/"waitHours" rather than
 * a single `delay_minutes`, and never an id where a name will do. The admin
 * this serves is the business owner, not an engineer.
 */

export const adminSequencesRouter = Router();

/* ----------------------------------------------------------------- schemas */

const timeOfDay = z
  .union([z.number().int().min(0).max(1439), z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return value;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  });

export const sequenceSchema = z.object({
  name: z.string().trim().min(1, "Give this sequence a name").max(200),
  slug: z.string().trim().max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  topic: z.string().max(60).optional(),
  skipWeekends: z.boolean().optional(),
  sendWindowStartMinute: timeOfDay,
  sendWindowEndMinute: timeOfDay,
  useContactTimezone: z.boolean().optional(),
  timezone: z.string().max(80).optional(),
  exitOnPurchase: z.boolean().optional(),
  exitTagId: z.number().int().positive().nullable().optional(),
  completionTagId: z.number().int().positive().nullable().optional(),
  allowReentry: z.boolean().optional(),
  /** 3.1: a folder, which campaigns already had and sequences did not. */
  folder: z.string().trim().max(120).optional(),
});

const emailSchema = z.object({
  subject: z.string().max(500).optional(),
  previewText: z.string().max(500).optional(),
  bodyMd: z.string().max(200_000).optional(),
  // The screen asks for days and hours; a single minute count is what the
  // scheduler wants, and doing the arithmetic here keeps it out of the UI.
  waitDays: z.number().int().min(0).max(365).optional(),
  waitHours: z.number().int().min(0).max(23).optional(),
  delayMinutes: z.number().int().min(0).optional(),
  fromName: z.string().max(200).optional(),
  fromEmail: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

function delayFrom(input: z.infer<typeof emailSchema>): number | undefined {
  if (input.delayMinutes !== undefined) return input.delayMinutes;
  if (input.waitDays === undefined && input.waitHours === undefined) return undefined;
  return (input.waitDays ?? 0) * 1440 + (input.waitHours ?? 0) * 60;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* -------------------------------------------------------------- sequences */

adminSequencesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT q.*,
              (SELECT COUNT(*)::int FROM sequence_emails e WHERE e.sequence_id = q.id) AS email_count,
              -- A3: "6 emails over 11 days" in the combined email list. The
              -- span is the sum of the waits of the emails that actually go
              -- out; a switched-off email is skipped and so is its wait.
              (SELECT COUNT(*)::int FROM sequence_emails e
                WHERE e.sequence_id = q.id AND e.enabled)                              AS enabled_email_count,
              (SELECT COALESCE(SUM(e.delay_minutes), 0)::int FROM sequence_emails e
                WHERE e.sequence_id = q.id AND e.enabled)                              AS total_delay_minutes,
              (SELECT COUNT(*)::int FROM sequence_subscriptions s
                WHERE s.sequence_id = q.id AND s.status = 'active')                    AS active_count,
              (SELECT COUNT(*)::int FROM sequence_subscriptions s
                WHERE s.sequence_id = q.id AND s.status = 'completed')                 AS completed_count
         FROM email_sequences q
        ORDER BY q.name`
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminSequencesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = sequenceSchema.parse(req.body);
    const slug = input.slug?.trim() || slugify(input.name) || `sequence-${Date.now()}`;

    /*
     * 3.10: a new sequence starts from the site's defaults rather than from
     * whatever this file happens to hardcode. Without it every sequence was
     * configured from scratch and they drifted apart — one sending at 9am
     * Eastern, the next at midnight UTC because nobody touched the field.
     *
     * An explicit value in the request still wins: this is a default, not a
     * policy.
     */
    const marketing = await marketingSettings();
    const defaultWindowStart = marketing.defaultSendHour * 60;

    const result = await pool.query(
      `INSERT INTO email_sequences
         (name, slug, description, status, topic, skip_weekends,
          send_window_start_minute, send_window_end_minute, use_contact_timezone, timezone,
          exit_on_purchase, exit_tag_id, completion_tag_id, allow_reentry, folder)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        input.name,
        slug,
        input.description ?? "",
        input.status ?? "draft",
        input.topic ?? "marketing",
        input.skipWeekends ?? false,
        input.sendWindowStartMinute ?? defaultWindowStart,
        input.sendWindowEndMinute ?? null,
        input.useContactTimezone ?? true,
        input.timezone ?? marketing.defaultTimezone,
        input.exitOnPurchase ?? true,
        input.exitTagId ?? null,
        input.completionTagId ?? null,
        input.allowReentry ?? false,
        input.folder ?? "",
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminSequencesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const sequence = await pool.query(`SELECT * FROM email_sequences WHERE id = $1`, [
      req.params.id,
    ]);
    if (sequence.rowCount === 0) throw notFound("Sequence not found");

    const emails = await pool.query(
      `SELECT * FROM sequence_emails WHERE sequence_id = $1 ORDER BY position`,
      [req.params.id]
    );

    res.json({
      ...rowToCamel(sequence.rows[0]),
      emails: rowsToCamel(emails.rows),
    });
  })
);

adminSequencesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = sequenceSchema.partial().parse(req.body);

    // COALESCE against the typed parameter rather than building the column list
    // dynamically: the set of updatable columns then cannot drift from what the
    // schema above validates.
    const result = await pool.query(
      `UPDATE email_sequences SET
          name        = COALESCE($2, name),
          description = COALESCE($3, description),
          status      = COALESCE($4, status),
          topic       = COALESCE($5, topic),
          skip_weekends = COALESCE($6, skip_weekends),
          send_window_start_minute = CASE WHEN $7::boolean THEN $8::int ELSE send_window_start_minute END,
          send_window_end_minute   = CASE WHEN $9::boolean THEN $10::int ELSE send_window_end_minute END,
          use_contact_timezone = COALESCE($11, use_contact_timezone),
          timezone    = COALESCE($12, timezone),
          exit_on_purchase = COALESCE($13, exit_on_purchase),
          exit_tag_id = CASE WHEN $14::boolean THEN $15::int ELSE exit_tag_id END,
          completion_tag_id = CASE WHEN $16::boolean THEN $17::int ELSE completion_tag_id END,
          allow_reentry = COALESCE($18, allow_reentry),
          folder      = COALESCE($19, folder),
          updated_at  = now()
        WHERE id = $1
        RETURNING *`,
      [
        req.params.id,
        input.name ?? null,
        input.description ?? null,
        input.status ?? null,
        input.topic ?? null,
        input.skipWeekends ?? null,
        "sendWindowStartMinute" in req.body,
        input.sendWindowStartMinute ?? null,
        "sendWindowEndMinute" in req.body,
        input.sendWindowEndMinute ?? null,
        input.useContactTimezone ?? null,
        input.timezone ?? null,
        input.exitOnPurchase ?? null,
        "exitTagId" in req.body,
        input.exitTagId ?? null,
        "completionTagId" in req.body,
        input.completionTagId ?? null,
        input.allowReentry ?? null,
        input.folder ?? null,
      ]
    );
    if (result.rowCount === 0) throw notFound("Sequence not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminSequencesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sequence_subscriptions
        WHERE sequence_id = $1 AND status = 'active'`,
      [req.params.id]
    );
    if (Number(active.rows[0]?.count ?? 0) > 0) {
      throw badRequest(
        "People are part-way through this sequence. Pause it first, or wait for them to finish."
      );
    }

    const result = await pool.query(`DELETE FROM email_sequences WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) throw notFound("Sequence not found");
    res.status(204).end();
  })
);

/* ----------------------------------------------------------------- emails */

adminSequencesRouter.post(
  "/:id/emails",
  asyncHandler(async (req, res) => {
    const input = emailSchema.parse(req.body);

    const next = await pool.query<{ position: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS position FROM sequence_emails WHERE sequence_id = $1`,
      [req.params.id]
    );

    const result = await pool.query(
      `INSERT INTO sequence_emails
         (sequence_id, position, delay_minutes, subject, preview_text, body_md,
          from_name, from_email, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.params.id,
        next.rows[0].position,
        delayFrom(input) ?? 1440,
        input.subject ?? "",
        input.previewText ?? "",
        input.bodyMd ?? "",
        input.fromName ?? "",
        input.fromEmail ?? "",
        input.enabled ?? true,
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminSequencesRouter.patch(
  "/:id/emails/:emailId",
  asyncHandler(async (req, res) => {
    const input = emailSchema.parse(req.body);
    const delay = delayFrom(input);

    const result = await pool.query(
      `UPDATE sequence_emails SET
          subject       = COALESCE($3, subject),
          preview_text  = COALESCE($4, preview_text),
          body_md       = COALESCE($5, body_md),
          delay_minutes = COALESCE($6, delay_minutes),
          from_name     = COALESCE($7, from_name),
          from_email    = COALESCE($8, from_email),
          enabled       = COALESCE($9, enabled),
          updated_at    = now()
        WHERE id = $2 AND sequence_id = $1
        RETURNING *`,
      [
        req.params.id,
        req.params.emailId,
        input.subject ?? null,
        input.previewText ?? null,
        input.bodyMd ?? null,
        delay ?? null,
        input.fromName ?? null,
        input.fromEmail ?? null,
        input.enabled ?? null,
      ]
    );
    if (result.rowCount === 0) throw notFound("Email not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminSequencesRouter.delete(
  "/:id/emails/:emailId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `DELETE FROM sequence_emails WHERE id = $2 AND sequence_id = $1`,
      [req.params.id, req.params.emailId]
    );
    if (result.rowCount === 0) throw notFound("Email not found");
    res.status(204).end();
  })
);

/**
 * POST /:id/emails/:emailId/duplicate
 *
 * The copy lands directly after the original, switched off and marked
 * "(copy)": a second email with the same subject going out by itself the next
 * morning is not what anybody pressing Duplicate wants, and the per-email
 * figures are matched on the subject line.
 *
 * Making room uses the same negative scratch space as the reorder below —
 * `(sequence_id, position)` is unique, and a plain `position + 1` collides
 * with the next row half way through the statement. People part-way through
 * are moved along with the emails they were waiting for, so nobody is sent the
 * previous email a second time.
 */
adminSequencesRouter.post(
  "/:id/emails/:emailId/duplicate",
  asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const sourceRes = await client.query<{
        position: number;
        delay_minutes: number;
        subject: string;
        preview_text: string;
        body_md: string;
        from_name: string;
        from_email: string;
      }>(
        `SELECT position, delay_minutes, subject, preview_text, body_md, from_name, from_email
           FROM sequence_emails
          WHERE id = $2 AND sequence_id = $1
          FOR UPDATE`,
        [req.params.id, req.params.emailId]
      );
      const source = sourceRes.rows[0];
      if (!source) throw notFound("Email not found");

      await client.query(
        `UPDATE sequence_emails SET position = -position
          WHERE sequence_id = $1 AND position > $2`,
        [req.params.id, source.position]
      );
      await client.query(
        `UPDATE sequence_emails SET position = -position + 1, updated_at = now()
          WHERE sequence_id = $1 AND position < 0`,
        [req.params.id]
      );
      await client.query(
        `UPDATE sequence_subscriptions SET position = position + 1, updated_at = now()
          WHERE sequence_id = $1 AND position > $2 AND status IN ('active', 'paused')`,
        [req.params.id, source.position]
      );

      const copy = await client.query(
        `INSERT INTO sequence_emails
           (sequence_id, position, delay_minutes, subject, preview_text, body_md,
            from_name, from_email, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
         RETURNING *`,
        [
          req.params.id,
          source.position + 1,
          source.delay_minutes,
          `${source.subject.slice(0, 493)} (copy)`,
          source.preview_text,
          source.body_md,
          source.from_name,
          source.from_email,
        ]
      );

      await client.query("COMMIT");
      res.status(201).json(rowToCamel(copy.rows[0]));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  })
);

/**
 * PUT the whole running order.
 *
 * Two passes, because `(sequence_id, position)` is unique and swapping two
 * emails would collide half way through the first one. Negative positions are
 * a scratch space no real row ever occupies.
 */
adminSequencesRouter.post(
  "/:id/emails/reorder",
  asyncHandler(async (req, res) => {
    const { order } = z
      .object({ order: z.array(z.number().int().positive()).min(1) })
      .parse(req.body);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [index, emailId] of order.entries()) {
        await client.query(
          `UPDATE sequence_emails SET position = $3 WHERE id = $2 AND sequence_id = $1`,
          [req.params.id, emailId, -(index + 1)]
        );
      }
      for (const [index, emailId] of order.entries()) {
        await client.query(
          `UPDATE sequence_emails SET position = $3, updated_at = now()
            WHERE id = $2 AND sequence_id = $1`,
          [req.params.id, emailId, index + 1]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const emails = await pool.query(
      `SELECT * FROM sequence_emails WHERE sequence_id = $1 ORDER BY position`,
      [req.params.id]
    );
    res.json(rowsToCamel(emails.rows));
  })
);

/** Sends one email to a chosen address so it can be read before anybody else gets it. */
adminSequencesRouter.post(
  "/:id/emails/:emailId/test",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const result = await pool.query<{
      subject: string;
      body_md: string;
      from_name: string;
      from_email: string;
    }>(
      `SELECT subject, body_md, from_name, from_email FROM sequence_emails
        WHERE id = $2 AND sequence_id = $1`,
      [req.params.id, req.params.emailId]
    );
    const row = result.rows[0];
    if (!row) throw notFound("Email not found");

    // The same values a real send builds, so a test shows every token filled
    // in. When the address belongs to a contact it reads as it would for them.
    const known = await pool.query<{
      id: number;
      name: string;
      first_name: string;
      last_name: string;
      timezone: string;
      custom_fields: unknown;
    }>(
      `SELECT id, name, first_name, last_name, timezone, custom_fields
         FROM contacts WHERE email = $1`,
      [email]
    );
    const contact = known.rows[0];
    const values = buildMergeValues(
      {
        email,
        name: contact?.name || "Test reader",
        firstName: contact ? contact.first_name : "there",
        lastName: contact?.last_name,
        timezone: contact?.timezone,
        customFields: contact?.custom_fields,
      },
      mergeLinks(contact?.id ?? null, { preview: true })
    );
    const body = renderTokens(row.body_md, values);

    // Sent as transactional: it is a preview going to the person who wrote it,
    // not a commercial message to a subscriber, and it must not be stopped by
    // that address happening to be on the suppression list.
    await sendEmail({
      to: email,
      subject: `[Test] ${renderTokens(row.subject, values)}`,
      text: body,
      html: renderMarkdown(body),
      sourceType: "transactional",
      fromName: row.from_name,
      fromEmail: row.from_email,
    });

    res.status(202).json({ ok: true, sentTo: email });
  })
);

/* ------------------------------------------------------------ subscribers */

adminSequencesRouter.get(
  "/:id/subscribers",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const result = await pool.query(
      `SELECT s.id, s.status, s.position, s.next_send_at, s.entered_at, s.completed_at,
              s.exit_reason, c.id AS contact_id, c.email::text AS email, c.name
         FROM sequence_subscriptions s
         JOIN contacts c ON c.id = s.contact_id
        WHERE s.sequence_id = $1 AND ($2::text IS NULL OR s.status = $2)
        ORDER BY s.entered_at DESC
        LIMIT 500`,
      [req.params.id, status]
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminSequencesRouter.post(
  "/:id/enroll",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        email: z.string().email().optional(),
        name: z.string().max(200).optional(),
        contactId: z.number().int().positive().optional(),
      })
      .parse(req.body);

    const contactId =
      input.contactId ??
      (input.email
        ? await upsertContact({ email: input.email, name: input.name, source: "admin" })
        : null);
    if (contactId === null) throw badRequest("Give an email address to add");

    const result = await enrollContact(Number(req.params.id), contactId, { reason: "added by hand" });
    if (result.outcome === "blocked") throw badRequest(friendlyBlock(result.reason));
    res.status(201).json(result);
  })
);

/** Turns the service's internal reason into something the owner can act on. */
function friendlyBlock(reason: string): string {
  switch (reason) {
    case "sequence is not active":
      return "Turn this sequence on before adding anybody to it.";
    case "sequence has no emails":
      return "Add at least one email before putting anybody through this.";
    case "already been through this sequence":
      return "They have already been through this one. Allow repeats if you want them to go again.";
    default:
      return "That person could not be added to this sequence.";
  }
}

adminSequencesRouter.post(
  "/:id/exit",
  asyncHandler(async (req, res) => {
    const { contactId } = z.object({ contactId: z.number().int().positive() }).parse(req.body);
    const removed = await exitContact(Number(req.params.id), contactId, {
      reason: "removed by hand",
    });
    res.json({ ok: removed });
  })
);

/**
 * Per-email open and click totals — the reason `email_messages` exists — and
 * how many people have joined, finished and left.
 *
 * `subscribed` is everybody who has ever been put on the sequence (there is one
 * row per person, reused on re-entry). `exited` is a run cut short, broken down
 * by the reason recorded at the time. `unsubscribed` is a different thing from
 * leaving the sequence: people on it who have since opted out of marketing
 * email altogether.
 */
adminSequencesRouter.get(
  "/:id/stats",
  asyncHandler(async (req, res) => {
    const [totals, reasons] = await Promise.all([
      pool.query<{
        subscribed: number;
        active: number;
        paused: number;
        completed: number;
        exited: number;
        unsubscribed: number;
      }>(
        `SELECT COUNT(*)::int                                                    AS subscribed,
                COUNT(*) FILTER (WHERE s.status = 'active')::int                 AS active,
                COUNT(*) FILTER (WHERE s.status = 'paused')::int                 AS paused,
                COUNT(*) FILTER (WHERE s.status = 'completed')::int              AS completed,
                COUNT(*) FILTER (WHERE s.status IN ('exited', 'cancelled'))::int AS exited,
                COUNT(*) FILTER (WHERE c.email_marketing_status = 'opted_out')::int AS unsubscribed
           FROM sequence_subscriptions s
           JOIN contacts c ON c.id = s.contact_id
          WHERE s.sequence_id = $1`,
        [req.params.id]
      ),
      pool.query<{ reason: string; count: number }>(
        `SELECT exit_reason AS reason, COUNT(*)::int AS count
           FROM sequence_subscriptions
          WHERE sequence_id = $1 AND status IN ('exited', 'cancelled')
          GROUP BY exit_reason
          ORDER BY count DESC, reason
          LIMIT 20`,
        [req.params.id]
      ),
    ]);

    const result = await pool.query(
      `SELECT e.id, e.position, e.subject,
              COUNT(m.id) FILTER (WHERE m.status <> 'suppressed')::int AS sent,
              COUNT(m.id) FILTER (WHERE m.first_opened_at IS NOT NULL)::int AS opened,
              COUNT(m.id) FILTER (WHERE m.first_clicked_at IS NOT NULL)::int AS clicked,
              COUNT(m.id) FILTER (WHERE m.status = 'bounced')::int AS bounced
         FROM sequence_emails e
         LEFT JOIN email_messages m
           ON m.source_type = 'sequence' AND m.source_id = e.sequence_id AND m.subject = e.subject
        WHERE e.sequence_id = $1
        GROUP BY e.id, e.position, e.subject
        ORDER BY e.position`,
      [req.params.id]
    );
    res.json({
      emails: rowsToCamel(result.rows),
      subscribers: {
        subscribed: totals.rows[0]?.subscribed ?? 0,
        active: totals.rows[0]?.active ?? 0,
        paused: totals.rows[0]?.paused ?? 0,
        completed: totals.rows[0]?.completed ?? 0,
        exited: totals.rows[0]?.exited ?? 0,
        unsubscribed: totals.rows[0]?.unsubscribed ?? 0,
        exitReasons: reasons.rows.map((row) => ({ reason: row.reason, count: row.count })),
      },
    });
  })
);

/* ------------------------------------------------------- system templates */

/**
 * The transactional emails, editable without a deploy — mounted separately at
 * /api/admin/email-templates.
 *
 * A deleted or disabled row falls back to the compiled-in copy, so the worst
 * an edit can do is degrade to what shipped rather than to silence.
 */
export const adminEmailTemplatesRouter = Router();

adminEmailTemplatesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, key, name, description, subject, body_md, enabled, updated_at
         FROM email_templates ORDER BY name`
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminEmailTemplatesRouter.patch(
  "/:key",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        subject: z.string().max(500).optional(),
        bodyMd: z.string().max(200_000).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);

    const result = await pool.query(
      `UPDATE email_templates SET
          subject = COALESCE($2, subject),
          body_md = COALESCE($3, body_md),
          enabled = COALESCE($4, enabled),
          updated_at = now()
        WHERE key = $1
        RETURNING id, key, name, description, subject, body_md, enabled, updated_at`,
      [req.params.key, input.subject ?? null, input.bodyMd ?? null, input.enabled ?? null]
    );
    if (result.rowCount === 0) throw notFound("Template not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

/* -------------------------------------------------- specific exclude rules */

/**
 * GET /:id/excludes
 *
 * 3.7. The single global "stop the moment they buy something" is a blunt
 * instrument: a sequence selling the toolkit should stop when somebody buys the
 * toolkit, not when they buy a $7 bump. These narrow it to named offers and
 * named forms, and sit alongside `exit_on_purchase` rather than replacing it —
 * the global switch is still the right answer for a welcome sequence.
 */
adminSequencesRouter.get(
  "/:id/excludes",
  asyncHandler(async (req, res) => {
    const [offers, forms] = await Promise.all([
      pool.query(
        `SELECT o.id, o.title
           FROM sequence_exclude_offers x
           JOIN offers o ON o.id = x.offer_id
          WHERE x.sequence_id = $1
          ORDER BY o.title`,
        [req.params.id]
      ),
      pool.query(
        `SELECT f.id, f.name
           FROM sequence_exclude_forms x
           JOIN forms f ON f.id = x.form_id
          WHERE x.sequence_id = $1
          ORDER BY f.name`,
        [req.params.id]
      ),
    ]);
    res.json({ offers: rowsToCamel(offers.rows), forms: rowsToCamel(forms.rows) });
  })
);

const excludesSchema = z.object({
  offerIds: z.array(z.number().int().positive()).max(100).default([]),
  formIds: z.array(z.number().int().positive()).max(100).default([]),
});

/**
 * PUT /:id/excludes
 *
 * Replaces both lists in one transaction. A partial save — offers written and
 * forms not — would leave a sequence excluding half of what the screen showed.
 */
adminSequencesRouter.put(
  "/:id/excludes",
  asyncHandler(async (req, res) => {
    const parsed = excludesSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Check the offers and forms you chose.");

    const exists = await pool.query(`SELECT 1 FROM email_sequences WHERE id = $1`, [req.params.id]);
    if (exists.rowCount === 0) throw notFound("Sequence not found");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM sequence_exclude_offers WHERE sequence_id = $1`, [
        req.params.id,
      ]);
      await client.query(`DELETE FROM sequence_exclude_forms WHERE sequence_id = $1`, [
        req.params.id,
      ]);
      for (const offerId of new Set(parsed.data.offerIds)) {
        await client.query(
          `INSERT INTO sequence_exclude_offers (sequence_id, offer_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [req.params.id, offerId]
        );
      }
      for (const formId of new Set(parsed.data.formIds)) {
        await client.query(
          `INSERT INTO sequence_exclude_forms (sequence_id, form_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [req.params.id, formId]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  })
);

/* ------------------------------------------------- the saved template library */

/**
 * 3.2. A library of the admin's own email templates.
 *
 * Deliberately a different table from `email_templates` above, which is the
 * SYSTEM store: those rows are keyed by purpose (purchase_receipt,
 * trial_ending, certificate_issued) and the code looks them up by that key, so
 * a row a person can rename or delete has no business in it. Deleting
 * `purchase_receipt` would stop receipts having a template at all.
 *
 * These are free-form: three fixed starters existed before and could not be
 * saved to, duplicated or renamed.
 */
export const adminSavedTemplatesRouter = Router();

adminSavedTemplatesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, name, subject, body_md, created_at, updated_at
         FROM email_saved_templates ORDER BY name`
    );
    res.json(rowsToCamel(result.rows));
  })
);

const savedTemplateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(160),
  subject: z.string().max(500).default(""),
  bodyMd: z.string().max(200_000).default(""),
});

/** Save the email on screen as a template, which is the whole point of 3.2. */
adminSavedTemplatesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = savedTemplateSchema.parse(req.body);
    const created = await pool.query(
      `INSERT INTO email_saved_templates (name, subject, body_md)
       VALUES ($1, $2, $3)
       RETURNING id, name, subject, body_md, created_at, updated_at`,
      [input.name, input.subject, input.bodyMd]
    );
    res.status(201).json(rowToCamel(created.rows[0]));
  })
);

adminSavedTemplatesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = partialUpdate(savedTemplateSchema).parse(req.body);
    const saved = await pool.query(
      `UPDATE email_saved_templates SET
          name    = COALESCE($2, name),
          subject = COALESCE($3, subject),
          body_md = COALESCE($4, body_md),
          updated_at = now()
        WHERE id = $1
        RETURNING id, name, subject, body_md, created_at, updated_at`,
      [req.params.id, input.name ?? null, input.subject ?? null, input.bodyMd ?? null]
    );
    if (saved.rowCount === 0) throw notFound("Template not found");
    res.json(rowToCamel(saved.rows[0]));
  })
);

/**
 * Duplicate. "(copy)" rather than a bare name, because the UNIQUE-less table
 * would otherwise show two identical rows and no way to tell which is which.
 */
adminSavedTemplatesRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    const copied = await pool.query(
      `INSERT INTO email_saved_templates (name, subject, body_md)
       SELECT left(name || ' (copy)', 160), subject, body_md
         FROM email_saved_templates WHERE id = $1
       RETURNING id, name, subject, body_md, created_at, updated_at`,
      [req.params.id]
    );
    if (copied.rowCount === 0) throw notFound("Template not found");
    res.status(201).json(rowToCamel(copied.rows[0]));
  })
);

adminSavedTemplatesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const gone = await pool.query(`DELETE FROM email_saved_templates WHERE id = $1`, [
      req.params.id,
    ]);
    if (gone.rowCount === 0) throw notFound("Template not found");
    res.status(204).end();
  })
);

/* ---------------------------------------------------------------- merge tags */

/**
 * 3.5. The list itself lives beside the code that fills the tokens in
 * (`email/mergeValues`), so the two are tested against each other. Re-exported
 * because this is where it used to be.
 */
export { MERGE_TAGS };

/** How many `{{custom.…}}` tokens the picker will list. */
const CUSTOM_TAG_LIMIT = 30;

/**
 * The custom fields people actually have, as tokens.
 *
 * Read off the contacts rather than a definitions table because there is not
 * one: a custom field exists the moment a form stores it.
 */
async function customMergeTags(): Promise<MergeTagEntry[]> {
  const keys = await pool.query<{ key: string }>(
    `SELECT DISTINCT jsonb_object_keys(custom_fields) AS key
       FROM contacts
      WHERE custom_fields <> '{}'::jsonb
      ORDER BY key
      LIMIT $1`,
    [CUSTOM_TAG_LIMIT]
  );
  const seen = new Set<string>();
  const tags: MergeTagEntry[] = [];
  for (const row of keys.rows) {
    const key = customTokenKey(row.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tags.push({
      token: `{{custom.${key}}}`,
      label: `Custom: ${row.key}`,
      example: "from their contact record",
      scope: "all",
    });
  }
  return tags;
}

/**
 * GET /merge-tags?source=broadcast|sequence|transactional
 *
 * Only what that kind of email can fill in. A broadcast has no order behind
 * it, so offering it `{{total}}` is offering a blank.
 */
adminSavedTemplatesRouter.get(
  "/merge-tags",
  asyncHandler(async (req, res) => {
    const source = z.enum(MERGE_TAG_SOURCES).optional().catch(undefined).parse(req.query.source);
    const tags = mergeTagsFor(source);
    if (source === "broadcast" || source === "sequence") {
      // The picker is still useful without these, so a failure here is not one.
      const custom = await customMergeTags().catch(() => []);
      res.json([...tags, ...custom]);
      return;
    }
    res.json(tags);
  })
);
