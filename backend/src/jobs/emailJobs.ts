import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { renderMarkdown, sendEmail } from "../email/provider";
import { fireTrigger, runAutomation, type RunContext } from "../automations/engineV2";
import { sendBroadcastOne, tickBroadcasts } from "../services/broadcasts";
import { upsertContact } from "../services/contacts";
import { sendDueEmail, tickDueSubscriptions } from "../services/sequences";
import { registerHandler } from "./worker";

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
const recoveryPayload = z.object({
  abandonedCheckoutId: z.coerce.number().int().positive(),
  step: z.coerce.number().int().min(0).max(2),
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
    facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
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
    await fireTrigger("sequence_completed", {
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

/* ------------------------------------------------------- cart recovery */

/**
 * The three abandoned-cart emails, at +1h, +24h and +72h.
 *
 * One template per step rather than one template with a variable, because the
 * three are doing genuinely different jobs: the first assumes something went
 * wrong with the form, the second assumes second thoughts, and the third is the
 * last one they will get. They are marketing emails and carry the unsubscribe
 * footer like every other, which is `sendEmail`'s doing, not this function's.
 */
const RECOVERY_COPY = [
  {
    subject: "Did something go wrong at checkout?",
    lead: "You were part-way through joining {offer} and the page never finished. If something broke, tell me — I would rather fix it than lose you to a form.",
    cta: "Pick up where you left off",
  },
  {
    subject: "Still thinking about {offer}?",
    lead: "No pressure at all. If you were weighing it up, hit reply and tell me what is giving you pause — I answer these myself.",
    cta: "Take another look",
  },
  {
    subject: "Last note about {offer}",
    lead: "This is the last email I will send about this one. Your place is still there if you want it, and if the timing is wrong that is completely fine.",
    cta: "Finish joining",
  },
];

async function checkoutRecoveryEmail(payload: Record<string, unknown>): Promise<unknown> {
  const { abandonedCheckoutId, step } = recoveryPayload.parse(payload);

  const res = await pool.query<{
    id: number;
    email: string;
    first_name: string;
    emails_sent: number;
    recovered_at: Date | null;
    offer_title: string;
    offer_slug: string;
  }>(
    `SELECT a.id, a.email, a.first_name, a.emails_sent, a.recovered_at,
            COALESCE(o.title, '') AS offer_title, COALESCE(o.slug, '') AS offer_slug
       FROM abandoned_checkouts a
       LEFT JOIN offers o ON o.id = a.offer_id
      WHERE a.id = $1`,
    [abandonedCheckoutId]
  );
  const cart = res.rows[0];
  if (!cart) return { skipped: "no such cart" };
  if (cart.recovered_at !== null) return { skipped: "already bought" };
  // The sweep counts steps, and a redelivered job must not re-send one that has
  // already gone: `emails_sent` is the authority, not the job's own existence.
  if (cart.emails_sent !== step) return { skipped: "step already sent" };

  const copy = RECOVERY_COPY[step];
  const offer = cart.offer_title || "the programme";
  const url = cart.offer_slug ? `${env.publicSiteUrl}/checkout/${cart.offer_slug}` : env.publicSiteUrl;

  const contactId = await upsertContact({
    email: cart.email,
    name: cart.first_name,
    source: "checkout",
  });

  const greeting = cart.first_name.trim() || "there";
  const body = [
    `Hi ${greeting},`,
    ``,
    copy.lead.replace("{offer}", offer),
    ``,
    `[${copy.cta}](${url})`,
  ].join("\n");

  const result = await sendEmail({
    to: cart.email,
    subject: copy.subject.replace("{offer}", offer),
    text: body,
    html: renderMarkdown(body),
    contactId,
    sourceType: "automation",
    sourceId: cart.id,
    topic: "marketing",
  });

  await pool.query(
    `UPDATE abandoned_checkouts
        SET emails_sent = emails_sent + 1, last_email_at = now(), updated_at = now()
      WHERE id = $1 AND emails_sent = $2`,
    [cart.id, step]
  );

  // Only the first one fires the trigger: an automation on "someone left
  // without paying" wants to run once, not three times over three days.
  if (step === 0) {
    await fireTrigger("abandoned_checkout", {
      contactId,
      email: cart.email,
      name: cart.first_name,
      facts: { offer },
    });
  }

  return { outcome: result.outcome, step };
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
  registerHandler("broadcast.sendOne", (payload) =>
    sendBroadcastOne(broadcastPayload.parse(payload))
  );
  registerHandler("automation.runAction", (payload) => automationRunAction(payload));
  registerHandler("checkout.recoveryEmail", (payload) => checkoutRecoveryEmail(payload));
  registerHandler("community.digest", () => communityDigest());
}
