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
import { activeTransport, verifiedSendingDomains } from "../../email/provider";
import {
  reviewSendingIdentity,
  sendingAddressProblem,
  type SendingIdentityInput,
} from "../../services/sendingIdentity";
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

/**
 * The "Sending service" field, showing the transport that is really in use.
 *
 * The stored row said "Your own mail server" while every message went out
 * through Amazon SES, because the transport is chosen from SMTP_HOST and the row
 * is consulted only for Resend. So the field's value, its choices and its help
 * line are replaced with `activeTransport()` — the same rules `resolveProvider`
 * sends by — and `locked` tells the screen when nothing it offers would change
 * anything, so it can say so instead of showing a dropdown that lies.
 */
async function withRealTransport(
  groups: Awaited<ReturnType<typeof settingGroups>>
): Promise<Awaited<ReturnType<typeof settingGroups>>> {
  const transport = await activeTransport();
  return groups.map((group) => ({
    ...group,
    settings: group.settings.map((card) =>
      card.key !== "email_provider"
        ? card
        : {
            ...card,
            fields: card.fields.map((field) =>
              field.name !== "provider"
                ? field
                : {
                    ...field,
                    value: transport.key,
                    choices: transport.choices,
                    help: transport.detail,
                    locked: transport.locked,
                    source: transport.source,
                  }
            ),
          }
    ),
  }));
}

adminSettingsV2Router.get(
  "/groups",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json({ groups: await withRealTransport(await settingGroups()) });
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
    const patch: Record<string, unknown> = { ...parsed.data };

    /*
     * A from-address has to be on a domain this site is verified to send from.
     * Refused at save, with the reason, rather than saved and then refused at
     * every send — `yvette@bossclinician.com` is the address on the legal pages
     * and was exactly what somebody would type here. The send gate in
     * email/provider.ts checks again, because a campaign can carry its own.
     */
    if (key === "marketing_email" && typeof patch.fromEmail === "string") {
      const domains = verifiedSendingDomains();
      const problem = sendingAddressProblem(patch.fromEmail, domains);
      if (problem) {
        // Short enough for the console to show verbatim (ui/friendly.ts prints
        // a 400 of up to 200 characters as it is).
        const said = `“${patch.fromEmail.trim()}” isn't on a domain this site can send from. Use an address ending in ${domains
          .map((d) => `@${d}`)
          .join(" or ")}.`;
        throw badRequest(said, { fieldErrors: { fromEmail: [problem.message] } });
      }
    }

    /*
     * Only a transport this server can actually run may be chosen. With the
     * transport set on the server there is exactly one, and saving anything else
     * used to be accepted and change nothing.
     */
    if (key === "email_provider" && patch.provider !== undefined) {
      const transport = await activeTransport();
      const allowed = transport.choices.map((choice) => String(choice.value));
      if (typeof patch.provider !== "string" || !allowed.includes(patch.provider)) {
        throw badRequest(
          transport.locked
            ? `Your email goes out through ${transport.label}, which is set on the server — it can't be changed here.`
            : `That sending service isn't available on this server. Choose ${allowed.join(" or ")}.`
        );
      }
    }

    // Read the old value first: it is what the audit log's `before` needs, and
    // after the write it is gone.
    const before = await readSetting(key);

    let after: Record<string, unknown>;
    try {
      after = await writeSetting(key, patch);
    } catch (err) {
      if (err instanceof SettingValidationError) {
        // Name the field and say why. A bare "something needs fixing" is a
        // silent failure with extra steps: the screen has no field to point at.
        const fieldErrors =
          (err.details as { fieldErrors?: Record<string, string[] | undefined> } | null)?.fieldErrors ?? {};
        const [name, messages] = Object.entries(fieldErrors).find(([, list]) => list && list.length > 0) ?? [];
        const label = definition.fields.find((field) => field.name === name)?.label ?? name;
        const reason = messages?.[0];
        const parserWording = !reason || /^(Required|Expected |Invalid |String must|Number must|Array must)/.test(reason);
        const said = !label
          ? "Something in that form needs fixing."
          : parserWording
            ? `“${label}” doesn't look right — check it and try again.`
            : `“${label}”: ${reason}`;
        throw badRequest(said.length <= 200 ? said : `“${label}” needs fixing.`, err.details);
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

/**
 * The values `reviewSendingIdentity` judges, read from the settings table.
 *
 * `readSetting` returns the stored value coerced to the group's shape, secrets
 * included, so the signing secret is reduced to a boolean here and never leaves
 * the server — the same promise every other read on this router keeps.
 */
async function sendingIdentityInput(): Promise<SendingIdentityInput> {
  const [marketing, provider, transport] = await Promise.all([
    readSetting("marketing_email"),
    readSetting("email_provider"),
    activeTransport(),
  ]);
  const text = (value: unknown): string => (typeof value === "string" ? value : "");

  return {
    marketing: {
      fromName: text(marketing.fromName),
      fromEmail: text(marketing.fromEmail),
      replyTo: text(marketing.replyTo),
      address: text(marketing.address),
      footer: text(marketing.footer),
    },
    provider: {
      provider: text(provider.provider) || "smtp",
      hasWebhookSecret: text(provider.webhookSecret).trim() !== "",
    },
    env: {
      smtpFrom: env.smtp.from,
      smtpHost: env.smtp.host,
      transactionalConfigSet: env.ses.transactionalConfigSet,
      marketingConfigSet: env.ses.marketingConfigSet,
      smtpConfigured: Boolean(env.smtp.host && env.smtp.user && env.smtp.pass),
      // The Resend key may live in the environment or the row; activeTransport
      // has already looked in both, and offers Resend only when one exists.
      hasResendKey: transport.choices.some((choice) => choice.value === "resend"),
      verifiedDomains: verifiedSendingDomains(),
    },
  };
}

/**
 * GET /api/admin/settings-v2/sending-identity
 *
 * Whether this site is in a fit state to send, and what is missing when it is
 * not — the same judgement email/provider.ts enforces on the send itself, so
 * the screen cannot say "ready" about a send that would be refused.
 *
 * It exists because the blank state was invisible. A tester found "Name in the
 * inbox", "Sent from" and "Your postal address" all empty on the live site,
 * with no indication that anything was wrong: empty boxes look identical to
 * boxes somebody has decided to leave empty.
 */
adminSettingsV2Router.get(
  "/sending-identity",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json(reviewSendingIdentity(await sendingIdentityInput()));
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

    /*
     * The test message is transactional, so it goes out under the server's own
     * identity and is not refused for a blank marketing one. But this button is
     * where somebody comes when mail looks wrong, and "Sent — check your inbox"
     * from a site that cannot send a single campaign is the same half-truth this
     * endpoint was already fixed once for telling. So the verdict travels with
     * the result, and the screen says both things.
     */
    const identity = reviewSendingIdentity(await sendingIdentityInput());

    res.json({
      to,
      configured,
      sent,
      // Empty when it worked, so the client can branch on truthiness.
      failure,
      identity,
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
