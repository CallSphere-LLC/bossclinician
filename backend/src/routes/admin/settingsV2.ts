import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { sendMailStrict } from "../../email/mailer";
import { escapeHtml } from "../../email/templates";
import { recordAdminAction } from "../../services/adminAudit";
import { requirePermission } from "../../services/permissions";
import {
  SETTING_DEFINITIONS,
  SettingValidationError,
  readSetting,
  settingDefinition,
  settingGroups,
  writeSetting,
} from "../../services/settings";

/**
 * The settings screens.
 *
 * One endpoint returns every group with its fields, labels and current values,
 * and one saves a patch to a single key. The screen is generated from that
 * payload, so adding a setting is a change to services/settings.ts and nothing
 * else — no new route, no new form.
 *
 * Secrets never come back. The list carries a masked hint and a "there is one
 * stored" flag; a save either includes a replacement or leaves the field out.
 */
export const adminSettingsV2Router = Router();

adminSettingsV2Router.get(
  "/groups",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json({ groups: await settingGroups() });
  })
);

const patchBodySchema = z.record(z.unknown());

adminSettingsV2Router.put(
  "/:key",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    const definition = settingDefinition(key);
    if (!definition) throw notFound("There's no such setting.");

    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    // Read the old value first: it is what the audit log's `before` needs, and
    // after the write it is gone.
    const before = await readSetting(key);

    let after: Record<string, unknown>;
    try {
      after = await writeSetting(key, parsed.data);
    } catch (err) {
      if (err instanceof SettingValidationError) {
        throw badRequest("Something in that form needs fixing.", err.details);
      }
      throw err;
    }

    const secretFields = new Set(
      definition.fields.filter((f) => f.type === "secret").map((f) => f.name)
    );

    /** A secret must not be written to the audit log either — that is a table too. */
    const redact = (value: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(value)) {
        out[name] = secretFields.has(name) ? "[hidden]" : item;
      }
      return out;
    };

    await recordAdminAction({
      req,
      action: "settings.update",
      entityType: "setting",
      entityId: key,
      before: redact(before),
      after: redact(after),
    });

    res.json({ key, values: redact(after) });
  })
);

const testEmailSchema = z.object({
  to: z.string().email().max(320).optional(),
});

/**
 * Sends one message so the owner can see for herself that email works.
 *
 * Three outcomes, not two, because "we have a mail server configured" and "the
 * mail server took the message" are different facts and this screen exists to
 * tell them apart: `configured` false (nothing set up), `sent` true (the server
 * accepted it), or `failure` carrying the server's own refusal.
 *
 * With no SMTP host the transport writes to the log rather than sending, and
 * that counts as sent — locally it is the only thing that can happen, and the
 * `configured` flag is what tells the screen to say so.
 */
adminSettingsV2Router.post(
  "/test-email",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const parsed = testEmailSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("That doesn't look like an email address.");

    const to = parsed.data.to ?? req.user?.email ?? "";
    if (!to) throw badRequest("We need an address to send the test to.");

    const marketing = await readSetting("marketing_email");
    const fromName = typeof marketing.fromName === "string" ? marketing.fromName : "";

    const text = [
      "This is a test message from your Boss Clinician admin.",
      "",
      "If it reached you, your email settings are working.",
      fromName ? `Your emails go out as: ${fromName}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // `sendMailStrict`, not `sendMail`: the whole point of this button is to
    // find out whether the mail server accepts our credentials, and `sendMail`
    // swallows every failure into a console line and returns normally. Paired
    // with `sent: env.smtp.host.length > 0` below, that meant the screen said
    // "Sent — check your inbox" for a host that had rejected the message, or
    // refused the password, or was not listening. The one button whose entire
    // job is to tell you the truth about SMTP could only ever say yes.
    const configured = env.smtp.host.length > 0;
    let sent = false;
    let failure = "";
    try {
      await sendMailStrict({
        to,
        subject: "Your email settings are working",
        text,
        html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`,
      });
      sent = true;
    } catch (err) {
      // Reported, not thrown: a refused test is an answer, not a fault, and the
      // screen needs the reason to be useful. The message is the mail server's
      // own words ("535 Authentication Credentials Invalid"), which is exactly
      // what makes this button worth pressing.
      failure = err instanceof Error ? err.message : String(err);
    }

    await recordAdminAction({
      req,
      action: "settings.testEmail",
      entityType: "setting",
      entityId: "email",
      after: { to, sent, failure },
    });

    res.json({
      to,
      configured,
      sent,
      // Empty when it worked, so the client can branch on truthiness.
      failure,
    });
  })
);

const emailLogSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(["all", "queued", "sent", "delivered", "bounced", "complained", "failed", "suppressed"]).default("all"),
  topic: z.string().trim().max(100).optional(),
});

/**
 * GET /api/admin/settings-v2/email-log
 *
 * What actually happened to the last messages this site sent.
 *
 * This exists because "Sent" was the only thing anybody could see. Receipts,
 * access emails, dunning, confirmations and password links all went out through
 * a path that wrote a console line and nothing else, so a customer saying "the
 * receipt never arrived" could not be answered: there was no record that the
 * message existed, no provider id to trace, and SES's own delivery and bounce
 * notifications — which arrive keyed on that id — had nothing to attach to and
 * were stored against a null message.
 *
 * `status` is the send's own outcome and `lastEvent` is what the provider said
 * afterwards, and they are deliberately separate columns: "we handed it over"
 * and "the far end took it" are different facts, and the gap between them is
 * exactly where a silently undelivered email lives.
 */
adminSettingsV2Router.get(
  "/email-log",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const parsed = emailLogSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw badRequest("We couldn't read that filter.", parsed.error.flatten());
    const { limit, status, topic } = parsed.data;

    const rows = await pool.query(
      `SELECT m.id, m.to_email, m.source_type, m.topic, m.subject, m.provider,
              m.provider_message_id, m.status, m.error, m.sent_at, m.delivered_at,
              m.created_at,
              (SELECT e.kind FROM email_events e
                WHERE e.message_id = m.id
                ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event,
              (SELECT e.occurred_at FROM email_events e
                WHERE e.message_id = m.id
                ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event_at
         FROM email_messages m
        WHERE ($1 = 'all' OR m.status = $1)
          AND ($2::text IS NULL OR m.topic = $2)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3`,
      [status, topic && topic.length > 0 ? topic : null, limit]
    );

    // The tally is over the last week rather than over the page above it: the
    // question this screen answers is "is mail working right now", and a count
    // of whatever happens to be in the newest fifty rows does not answer it.
    const tally = await pool.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
         FROM email_messages
        WHERE created_at >= now() - interval '7 days'
        GROUP BY status`
    );

    const orphanEvents = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM email_events
        WHERE message_id IS NULL AND occurred_at >= now() - interval '7 days'`
    );

    res.json({
      messages: rows.rows.map((r) => ({
        id: Number(r.id),
        toEmail: r.to_email,
        sourceType: r.source_type,
        topic: r.topic,
        subject: r.subject,
        provider: r.provider,
        providerMessageId: r.provider_message_id ?? "",
        status: r.status,
        error: r.error,
        sentAt: r.sent_at,
        deliveredAt: r.delivered_at,
        createdAt: r.created_at,
        lastEvent: r.last_event ?? "",
        lastEventAt: r.last_event_at ?? null,
      })),
      lastSevenDays: Object.fromEntries(tally.rows.map((r) => [r.status, r.count])),
      /** Provider events we could not attribute — sends made before this log existed. */
      unattributedEvents: orphanEvents.rows[0]?.count ?? 0,
    });
  })
);

/** The keys this router knows about — used by the deploy smoke test. */
adminSettingsV2Router.get(
  "/keys",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json({ keys: SETTING_DEFINITIONS.map((d) => ({ key: d.key, group: d.group })) });
  })
);
