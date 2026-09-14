import { z } from "zod";
import { checkoutRecoveryEmail } from "../services/checkoutRecovery";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { renderMarkdown, sendEmail } from "../email/provider";
import { runAutomation, type RunContext } from "../automations/engineV2";
import {
  sendBroadcastOne,
  sweepAbDecisions,
  tickBroadcasts,
  tickRegistrationCampaigns,
} from "../services/broadcasts";
import { sendDueEmail, tickDueSubscriptions } from "../services/sequences";
import { registerHandler } from "./worker";
import { publishDomainEvent } from "../services/domainEvents";

/**
 * Every queued job that ends in an email.
 *
 * The handlers are thin on purpose: each one parses its payload, calls the
 * service that owns the behaviour, and returns something the job log can show.
 * Business logic lives in the services so it can be tested and called from a
 * request as well as from the queue.
 *
 * Payloads are parsed with zod rather than cast. A job row is data that has
 * survived a deploy — the code that wrote it may not be the code reading it —
 * and a payload that no longer matches has to fail loudly in one place rather
 * than produce `undefined` four calls down.
 */

const subscriptionPayload = z.object({ subscriptionId: z.coerce.number().int().positive() });
const broadcastPayload = z.object({
  campaignId: z.coerce.number().int().positive(),
  sendId: z.coerce.number().int().positive(),
});
const automationResumePayload = z.object({
  automationId: z.coerce.number().int().positive(),
  runId: z.coerce.number().int().positive(),
  fromIndex: z.coerce.number().int().min(0),
  /** Absent on jobs queued before this field existed; those resume as they did. */
  delayServed: z.coerce.boolean().optional(),
  context: z.object({
    trigger: z.string(),
    contactId: z.number().nullable(),
    email: z.string(),
    name: z.string(),
    subjectId: z.number().nullable(),
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  }),
});

/* ------------------------------------------------------------- sequences */

/**
 * Sends one sequence email and, when it was the last one, fires the trigger.
 *
 * The completion trigger is fired from here rather than from inside the
 * sequence service so the two do not have to import each other — the engine
 * already subscribes people to sequences, and a cycle between them is a module
 * that is half-initialised on the first call in the process's life.
 */
async function sequenceSendEmail(payload: Record<string, unknown>): Promise<unknown> {
  const { subscriptionId } = subscriptionPayload.parse(payload);
  const result = await sendDueEmail(subscriptionId);

  if (result.outcome === "completed" && result.contactId !== null && result.sequenceId !== null) {
    await publishDomainEvent("sequence_completed", {
      eventKey: `sequence-completed:subscription:${subscriptionId}`,
      contactId: result.contactId,
      subjectId: result.sequenceId,
    });
  }

  return { outcome: result.outcome, detail: result.detail };
}

/* ------------------------------------------------------------ automations */

async function automationRunAction(payload: Record<string, unknown>): Promise<unknown> {
  const parsed = automationResumePayload.parse(payload);
  const context = parsed.context as RunContext;
  const result = await runAutomation({
    automationId: parsed.automationId,
    runId: parsed.runId,
    fromIndex: parsed.fromIndex,
    delayServed: parsed.delayServed ?? false,
    context,
  });
  return { status: result.status, steps: result.log.length };
}

/* ------------------------------------------------------ community digest */

/** How far back a digest looks. Matches the daily schedule that drives it. */
const DIGEST_WINDOW_HOURS = 24;

/**
 * A once-a-day summary of what happened in each community.
 *
 * Sent only to members who have not turned the digest off, and only when there
 * is something to summarise: a daily email that says "nothing happened" teaches
 * people to filter the sender, which then costs the emails that matter.
 */
async function communityDigest(): Promise<unknown> {
  const communities = await pool.query<{ id: number; name: string; slug: string }>(
    `SELECT id, name, slug FROM communities WHERE published`
  );

  let sent = 0;
  for (const community of communities.rows) {
    const posts = await pool.query<{ title: string; author_name: string; channel: string }>(
      `SELECT p.title, p.author_name, ch.name AS channel
         FROM community_posts p
         JOIN community_channels ch ON ch.id = p.channel_id
        WHERE ch.community_id = $1
          AND p.status = 'visible'
          AND p.created_at > now() - make_interval(hours => $2)
        ORDER BY p.created_at DESC
        LIMIT 12`,
      [community.id, DIGEST_WINDOW_HOURS]
    );
    if (posts.rows.length === 0) continue;

    const recipients = await pool.query<{
      contact_id: number;
      member_id: number;
      email: string;
      name: string;
    }>(
      `SELECT m.contact_id, m.id AS member_id, m.email::text AS email, m.name
         FROM community_memberships cm
         JOIN members m ON m.id = cm.member_id
        WHERE cm.community_id = $1
          AND m.status = 'active'
          AND m.contact_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM member_email_preferences p
             WHERE p.member_id = m.id AND p.topic = 'community' AND NOT p.subscribed
          )`,
      [community.id]
    );

    const lines = posts.rows.map(
      (post) => `- **${post.title || "A new post"}** by ${post.author_name || "a member"} in ${post.channel}`
    );
    const url = `${env.publicSiteUrl}/community/${community.slug}`;

    for (const recipient of recipients.rows) {
      const body = [
        `Hi ${recipient.name.split(" ")[0] || "there"},`,
        ``,
        `Here is what happened in ${community.name} in the last day:`,
        ``,
        ...lines,
        ``,
        `[Join the conversation](${url})`,
      ].join("\n");

      try {
        const result = await sendEmail({
          to: recipient.email,
          subject: `${community.name}: ${posts.rows.length} new post${posts.rows.length === 1 ? "" : "s"}`,
          text: body,
          html: renderMarkdown(body),
          contactId: recipient.contact_id,
          memberId: recipient.member_id,
          sourceType: "digest",
          sourceId: community.id,
          topic: "community",
        });
        if (result.outcome === "sent") sent += 1;
      } catch (err) {
        // One bad address must not cost the rest of the community its digest.
        // eslint-disable-next-line no-console
        console.error(`[digest] ${recipient.email} failed:`, (err as Error).message);
      }
    }
  }

  return { sent };
}

/* --------------------------------------------------------------- wiring */

/**
 * Registers every handler this phase owns.
 *
 * `sequence.tick`, `broadcast.tick` and `community.digest` are already named by
 * rows in `job_schedules`, so the names here are not free to change: a rename
 * shows up as a job failing rather than as work quietly never happening again.
 */
export function registerEmailJobs(): void {
  registerHandler("sequence.tick", () => tickDueSubscriptions());
  registerHandler("sequence.sendEmail", (payload) => sequenceSendEmail(payload));
  registerHandler("broadcast.tick", () => tickBroadcasts());
  // Its own handler, because it never finishes: an "upon registration"
  // campaign keeps sending for as long as people keep registering, so it
  // cannot share the sweep that closes a campaign off when its sends have all
  // left.
  registerHandler("broadcast.registrationTick", () => tickRegistrationCampaigns());
  registerHandler("broadcast.abDecide", () => sweepAbDecisions());
  registerHandler("broadcast.sendOne", (payload) =>
    sendBroadcastOne(broadcastPayload.parse(payload))
  );
  registerHandler("automation.runAction", (payload) => automationRunAction(payload));
  registerHandler("checkout.recoveryEmail", (payload) => checkoutRecoveryEmail(payload));
  registerHandler("community.digest", () => communityDigest());
}
