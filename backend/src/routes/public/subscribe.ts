import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { subscribeSchema } from "../../validation/schemas";
import { badRequest } from "../../utils/httpError";
import { sendMail } from "../../email/mailer";
import { subscriberWelcome } from "../../email/templates";
import { subscribeLimiter } from "../../middleware/rateLimit";
import { fireTriggerAsync } from "../../automations/engine";
import { linkContact, recordActivity, upsertContactWithStatus } from "../../services/contacts";
import { publishDomainEvent } from "../../services/domainEvents";

export const subscribeRouter = Router();

subscribeRouter.post(
  "/subscribe",
  subscribeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid subscribe payload", parsed.error.flatten());
    const { email, source } = parsed.data;

    const subscriber = await pool.query<{ id: number }>(
      `INSERT INTO subscribers (email, source) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source
       RETURNING id`,
      [email, source]
    );

    // Where they signed up and from which address is the record that has to
    // exist if anybody ever asks why they were mailed.
    const contact = await upsertContactWithStatus({
      email,
      source: `newsletter: ${source}`,
      consentSource: source,
      consentIp: req.ip ?? "",
    });
    const contactId = contact.id;
    await linkContact("subscriber", subscriber.rows[0].id, contactId);
    await recordActivity({
      contactId,
      kind: "subscribed",
      title: "Joined the mailing list",
      meta: { source },
    });
    if (contact.created) {
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contactId}`,
        contactId,
        email,
        source: `newsletter:${source}`,
      });
    }

    const { subject, text, html } = subscriberWelcome(email);
    void sendMail({ to: email, subject, text, html });

    fireTriggerAsync("subscriber_created", { email, source });

    res.status(201).json({ ok: true });
  })
);
