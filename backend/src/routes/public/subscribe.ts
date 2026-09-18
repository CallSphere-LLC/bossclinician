import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { subscribeSchema } from "../../validation/schemas";
import { badRequest } from "../../utils/httpError";
import { sendMail } from "../../email/mailer";
import { subscriberWelcome } from "../../email/templates";
import { subscribeLimiter } from "../../middleware/rateLimit";
import { fireTriggerAsync } from "../../automations/engine";
import {
  applyTags,
  linkContact,
  recordActivity,
  upsertContactWithStatus,
} from "../../services/contacts";
import { publishDomainEvent } from "../../services/domainEvents";
import { enrollContact } from "../../services/sequences";

export const subscribeRouter = Router();

/** The source a funnel's opt-in stage signs people up under — pages/FunnelPage.tsx. */
const FUNNEL_SOURCE = /^funnel:(.+)$/;

/**
 * Gives a funnel's new subscriber the tag and follow-up its blueprint made.
 *
 * A blueprint builds a "joined" tag and a follow-up sequence and hangs them on
 * the funnel row, but the opt-in stage signs people up through this endpoint,
 * which knew nothing about either: the address reached Subscribers and the
 * funnel's own emails never started. The same two calls a form makes after a
 * reply (routes/public/growthPublic.ts), resolved from the funnel instead.
 *
 * Each half swallows its own failure. By now the person is subscribed, and a
 * tag somebody deleted or a sequence still in draft is no reason to tell them
 * otherwise — `enrollContact` answers a draft sequence with "blocked" rather
 * than throwing, which is why publishing a funnel switches its sequence on.
 */
async function applyFunnelBlueprint(funnelSlug: string, contactId: number): Promise<void> {
  const found = await pool.query<{ tag_slug: string | null; sequence_id: number | null }>(
    `SELECT t.slug::text AS tag_slug, f.sequence_id
       FROM funnels f
       LEFT JOIN tags t ON t.id = f.tag_id
      WHERE f.slug = $1 AND f.published = true`,
    [funnelSlug]
  );
  const funnel = found.rows[0];
  if (!funnel) return;
  const origin = `funnel:${funnelSlug}`;

  if (funnel.tag_slug) {
    try {
      await applyTags(contactId, [funnel.tag_slug], origin);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[subscribe] the tag for ${origin} failed:`, (err as Error).message);
    }
  }

  if (funnel.sequence_id) {
    try {
      await enrollContact(Number(funnel.sequence_id), contactId, { reason: origin });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[subscribe] the sequence enrolment for ${origin} failed:`, (err as Error).message);
    }
  }
}

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

    const funnelSlug = FUNNEL_SOURCE.exec(source)?.[1];
    if (funnelSlug) {
      await applyFunnelBlueprint(funnelSlug, contactId).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[subscribe] could not read funnel ${funnelSlug}:`, (err as Error).message);
      });
    }

    const { subject, text, html } = subscriberWelcome(email);
    void sendMail({ to: email, subject, text, html });

    fireTriggerAsync("subscriber_created", { email, source });

    res.status(201).json({ ok: true });
  })
);
