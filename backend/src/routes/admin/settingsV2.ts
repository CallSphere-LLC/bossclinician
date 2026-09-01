import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { env } from "../../config/env";
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

/** The keys this router knows about — used by the deploy smoke test. */
adminSettingsV2Router.get(
  "/keys",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json({ keys: SETTING_DEFINITIONS.map((d) => ({ key: d.key, group: d.group })) });
  })
);
