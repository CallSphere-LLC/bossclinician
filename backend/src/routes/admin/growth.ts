import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { pool } from "../../db/pool";
import { rowsToCamel, rowToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError, badRequest, notFound } from "../../utils/httpError";
import { buildAdminCrudRouter } from "./crudFactory";
import { renderMarkdown, sendEmail } from "../../email/provider";
import { BroadcastRefusal, audienceSize, startBroadcast } from "../../services/broadcasts";
import { isValidTimeZone } from "../../services/availability";
import { adminTestEmailLimiter } from "../../middleware/rateLimit";
import { recordAdminAction } from "../../services/adminAudit";
import {
  MAILABLE_CONTACT_COUNT_SQL,
  MAILABLE_CONTACT_SERIES_SQL,
  MAILABLE_CONTACT_SQL,
} from "../../services/audience";
import { upsertContact } from "../../services/contacts";
import { fireTriggerAsync, type TriggerType } from "../../automations/engine";
import { dispatchEvent } from "../../services/webhooksOut";
import {
  automationActionsRepo,
  automationsRepo,
  campaignsRepo,
  coachingOffersRepo,
  coachingSessionsRepo,
  formsRepo,
  funnelStepsRepo,
  funnelsRepo,
  newsletterIssuesRepo,
  newslettersRepo,
  podcastEpisodesRepo,
  podcastsRepo,
  savedReportsRepo,
  type Row,
} from "../../db/growthRepos";

/**
 * Growth suite admin API — mounted at /admin/growth.
 *
 * Standard CRUD comes from buildAdminCrudRouter; everything below it is the
 * behaviour that isn't CRUD (sending, audience resolution, feed tokens,
 * automation test-fires, report queries).
 */
export const adminGrowthRouter = Router();

/* ------------------------------------------------------------------ schemas */

const loose = z.record(z.unknown());

/** Most resources accept a permissive body — the repo's column whitelist is
 *  the real gate, so a second hand-maintained schema would only drift. */
const anySchema: z.ZodType<Record<string, unknown>> = loose;
const campaignScheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone),
});
const campaignTestSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  bodyMd: z.string().max(100_000).default(""),
});

/* ---------------------------------------------------------------- Coaching */

adminGrowthRouter.get(
  "/coaching/clients",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const result = await pool.query(
      `SELECT * FROM (
         SELECT CASE WHEN m.id IS NULL THEN 'contact' ELSE 'member' END AS kind,
                COALESCE(m.id, c.id) AS id,
                COALESCE(NULLIF(m.name, ''), c.name, '') AS name,
                COALESCE(m.email::text, c.email::text) AS email
           FROM contacts c
           LEFT JOIN LATERAL (
             SELECT id, name, email FROM members
              WHERE contact_id = c.id AND status <> 'deleted'
              ORDER BY id LIMIT 1
           ) m ON true
         UNION ALL
         SELECT 'member' AS kind, m.id, m.name, m.email::text AS email
           FROM members m
          WHERE m.contact_id IS NULL AND m.status <> 'deleted'
       ) people
       WHERE ($1 = '' OR name ILIKE $2 ESCAPE '\\' OR email ILIKE $2 ESCAPE '\\')
       ORDER BY name, email
       LIMIT 100`,
      [q, like],
    );
    res.json({ clients: rowsToCamel(result.rows) });
  }),
);

adminGrowthRouter.get(
  "/coaching/sessions",
  asyncHandler(async (req, res) => {
    const offerId = req.query.offerId ? Number(req.query.offerId) : null;
    const result = await pool.query(
      `SELECT s.*,
              COALESCE(NULLIF(m.name, ''), c.name, '') AS member_name,
              COALESCE(m.email::text, c.email::text, '') AS member_email,
              o.title AS offer_title
         FROM coaching_sessions s
         LEFT JOIN members m ON m.id = s.member_id
         LEFT JOIN contacts c ON c.id = s.contact_id
         LEFT JOIN coaching_offers o ON o.id = s.offer_id
        WHERE ($1::int IS NULL OR s.offer_id = $1)
        ORDER BY s.scheduled_at DESC NULLS LAST, s.id DESC`,
      [offerId],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminGrowthRouter.post(
  "/coaching/sessions",
  asyncHandler(async (req, res) => {
    const parsed = anySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const item = await coachingSessionsRepo.create(parsed.data);
    const detail = item as Row & Record<string, unknown>;
    await dispatchEvent("coaching.booked", {
      id: `coaching-session:${item.id}`,
      sessionId: item.id,
      memberId: detail.memberId ?? null,
      contactId: detail.contactId ?? null,
      offerId: detail.offerId ?? null,
      scheduledAt: detail.scheduledAt ?? null,
      source: "admin",
    });
    res.status(201).json(item);
  }),
);

adminGrowthRouter.put(
  "/coaching/sessions/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid id");
    const parsed = anySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const before = await coachingSessionsRepo.getById(id);
    if (!before) throw notFound("Not found");
    const item = await coachingSessionsRepo.update(id, parsed.data);
    if (!item) throw notFound("Not found");
    const oldStatus = (before as Row & Record<string, unknown>).status;
    const detail = item as Row & Record<string, unknown>;
    if (oldStatus !== "cancelled" && detail.status === "cancelled") {
      await dispatchEvent("coaching.cancelled", {
        id: `coaching-session-cancelled:${id}`,
        sessionId: id,
        memberId: detail.memberId ?? null,
        contactId: detail.contactId ?? null,
        offerId: detail.offerId ?? null,
        scheduledAt: detail.scheduledAt ?? null,
        source: "admin",
      });
    }
    res.json(item);
  }),
);

adminGrowthRouter.post(
  "/campaigns/:id/schedule",
  asyncHandler(async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) throw notFound("Campaign not found");
    const parsed = campaignScheduleSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose a valid date and time.");

    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (scheduledAt.getTime() <= Date.now() + 60_000) {
      throw badRequest("Choose a time at least one minute from now.");
    }

    const updated = await pool.query(
      `UPDATE email_campaigns
          SET status = 'scheduled', scheduled_at = $2, timezone = $3, updated_at = now()
        WHERE id = $1 AND status IN ('draft', 'scheduled', 'failed')
          AND btrim(subject) <> ''
        RETURNING *`,
      [campaignId, scheduledAt, parsed.data.timezone],
    );
    if (!updated.rows[0]) {
      const found = await pool.query<{ id: number }>("SELECT id FROM email_campaigns WHERE id = $1", [campaignId]);
      if (!found.rows[0]) throw notFound("Campaign not found");
      throw badRequest("Add a subject first, or wait for the current send to finish.");
    }
    res.json(rowToCamel(updated.rows[0]));
  }),
);

adminGrowthRouter.post(
  "/campaigns/:id/cancel-schedule",
  asyncHandler(async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) throw notFound("Campaign not found");
    const updated = await pool.query(
      `UPDATE email_campaigns
          SET status = 'draft', scheduled_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'scheduled'
        RETURNING *`,
      [campaignId],
    );
    if (!updated.rows[0]) throw badRequest("This email is not scheduled.");
    res.json(rowToCamel(updated.rows[0]));
  }),
);

adminGrowthRouter.post(
  "/campaigns/test",
  adminTestEmailLimiter,
  asyncHandler(async (req, res) => {
    const parsed = campaignTestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Add a subject before sending a test.");
    const to = req.user?.email ?? "";
    if (!to) throw badRequest("Your admin account needs an email address for the test.");
    await sendEmail({
      to,
      subject: `[Test] ${parsed.data.subject}`,
      text: parsed.data.bodyMd,
      html: renderMarkdown(parsed.data.bodyMd),
      sourceType: "transactional",
    });
    await recordAdminAction({
      req,
      action: "campaign.test_send",
      entityType: "email_campaign",
      entityId: "draft",
      after: { to, subject: parsed.data.subject },
    });
    res.json({ sent: true, to });
  }),
);

adminGrowthRouter.use("/coaching/sessions", buildAdminCrudRouter(coachingSessionsRepo, anySchema, anySchema, "scheduled_at DESC NULLS LAST"));
adminGrowthRouter.use("/coaching/offers", buildAdminCrudRouter(coachingOffersRepo, anySchema, anySchema));

/* ---------------------------------------------------------------- Podcasts */

adminGrowthRouter.get(
  "/podcasts/:id/episodes",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM podcast_episodes WHERE podcast_id = $1
        ORDER BY COALESCE(episode_number, 0) DESC, id DESC`,
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/** Issues (or reuses) a private feed token for a listener. */
adminGrowthRouter.post(
  "/podcasts/:id/tokens",
  asyncHandler(async (req, res) => {
    const { memberId } = req.body as { memberId?: number };
    const token = crypto.randomBytes(18).toString("hex");
    const result = await pool.query(
      `INSERT INTO podcast_feed_tokens (podcast_id, member_id, token)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, memberId ?? null, token],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminGrowthRouter.get(
  "/podcasts/:id/tokens",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT t.*, m.email AS member_email FROM podcast_feed_tokens t
         LEFT JOIN members m ON m.id = t.member_id
        WHERE t.podcast_id = $1 ORDER BY t.created_at DESC`,
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminGrowthRouter.delete(
  "/tokens/:tokenId",
  asyncHandler(async (req, res) => {
    // Revoke rather than delete: keeps an audit trail of issued feeds.
    const result = await pool.query(
      "UPDATE podcast_feed_tokens SET revoked = true WHERE id = $1",
      [req.params.tokenId],
    );
    if (result.rowCount === 0) throw notFound("Token not found");
    res.status(204).end();
  }),
);

adminGrowthRouter.use("/episodes", buildAdminCrudRouter(podcastEpisodesRepo, anySchema, anySchema, "id DESC"));
adminGrowthRouter.use("/podcasts", buildAdminCrudRouter(podcastsRepo, anySchema, anySchema, "id DESC"));

/* ------------------------------------------------------------- Newsletters */

adminGrowthRouter.get(
  "/newsletters/:id/issues",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM newsletter_issues WHERE newsletter_id = $1 ORDER BY created_at DESC",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/**
 * Sends an issue to the newsletter's audience.
 *
 * Free newsletters go to all subscribers; paid ones only to members with an
 * active subscription on the linked plan, so a paid issue can't leak to the
 * free list.
 */
adminGrowthRouter.post(
  "/issues/:id/send",
  asyncHandler(async (req, res) => {
    const issueResult = await pool.query(
      `SELECT i.*, n.access, n.plan_id, n.name AS newsletter_name
         FROM newsletter_issues i
         JOIN newsletters n ON n.id = i.newsletter_id
        WHERE i.id = $1`,
      [req.params.id],
    );
    const issue = issueResult.rows[0];
    if (!issue) throw notFound("Issue not found");
    if (issue.status === "sent") throw badRequest("This issue has already been sent");

    const recipients =
      issue.access === "paid" && issue.plan_id
        ? await pool.query(
            `SELECT DISTINCT s.email FROM subscriptions s
              WHERE s.plan_id = $1 AND s.status IN ('active','trialing') AND s.email <> ''`,
            [issue.plan_id],
          )
        : // A free issue goes to the email list, which is the same set of people
          // a broadcast reaches. Reading `subscribers` here sent it to whoever
          // had used the public newsletter form and nobody else.
          await pool.query(
            `SELECT c.email FROM contacts c WHERE ${MAILABLE_CONTACT_SQL}`
          );

    const emails = recipients.rows.map((r) => String(r.email));

    await pool.query(
      `UPDATE newsletter_issues
          SET status = 'sent', sent_at = now(), recipient_count = $2, updated_at = now()
        WHERE id = $1`,
      [issue.id, emails.length],
    );

    // Detached: a large list must not hold the request open.
    //
    // Every copy goes through `sendEmail` rather than `sendMail`. A newsletter
    // is a commercial email, so it has to carry the postal address and the
    // unsubscribe link, and it must not go to an address on the suppression
    // list — none of which `sendMail` knows anything about. The contact is
    // resolved first because the opt-out link is addressed to one.
    void (async () => {
      const body = String(issue.body_md ?? "");
      for (const email of emails) {
        try {
          const contactId = await upsertContact({ email, source: "newsletter" });
          await sendEmail({
            to: email,
            subject: String(issue.subject ?? ""),
            text: body,
            html: renderMarkdown(body),
            contactId,
            // `sourceId` is deliberately null, and it is not an oversight.
            //
            // Everything downstream reads (`source_type`, `source_id`) as one
            // key, and for `broadcast` that key means one row in
            // `email_campaigns`: routes/public/emailWebhook.ts adds every open,
            // click and bounce to the campaign with that id, and
            // services/reports/rollup.ts dimensions it as `broadcast:<id>`. A
            // newsletter id is drawn from a different sequence entirely, so
            // sending the issue's newsletter id here credited whichever
            // campaign happened to share the number — an email Yvette may never
            // have sent — and there is no way to unpick the two afterwards.
            // Anonymous is wrong but harmless; misattributed is neither.
            //
            // The proper fix is a `newsletter` source type carried end to end,
            // which needs the CHECK on email_messages.source_type widened,
            // EmailSourceType in email/provider.ts, the two source lists in
            // services/reports/rollup.ts and the label map in
            // services/reports/queries.ts — all outside this pass's remit. It is
            // written up in docs/bugs/backend-growth.md.
            sourceType: "broadcast",
            sourceId: null,
            topic: "marketing",
          });
        } catch {
          // One bad address must not cost the rest of the list its issue.
        }
      }
    })();

    res.status(202).json({ ok: true, recipients: emails.length });
  }),
);

adminGrowthRouter.use("/issues", buildAdminCrudRouter(newsletterIssuesRepo, anySchema, anySchema, "created_at DESC"));
adminGrowthRouter.use("/newsletters", buildAdminCrudRouter(newslettersRepo, anySchema, anySchema, "id DESC"));

/* --------------------------------------------------------------- Campaigns */

/**
 * GET /campaigns/audience/:audience — how many people that audience reaches.
 *
 * Delegates to `audienceSize`, the same resolver `startBroadcast` uses, so the
 * number on the confirm button is the number of people who will actually be
 * emailed. This endpoint used to run its own queries against the `subscribers`,
 * `members` and `leads` tables with no suppression test and no marketing-status
 * test, and fell back to the whole list for any key it did not recognise. It
 * disagreed with the send in both directions: it counted people who would be
 * suppressed, and — because `subscribers` is empty — it reported 0 for the
 * default audience while refusing to send to anybody.
 *
 * An unknown key now yields 0 rather than everybody, matching
 * `audiencePredicate`'s deliberate refusal to default.
 */
adminGrowthRouter.get(
  "/campaigns/audience/:audience",
  asyncHandler(async (req, res) => {
    const integers = (value: unknown): number[] =>
      typeof value === "string" && value.trim()
        ? value.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
    const segmentId = Number(req.query.segmentId);
    const count = await audienceSize({
      audience: req.params.audience,
      segment_id: Number.isInteger(segmentId) && segmentId > 0 ? segmentId : null,
      include_tag_ids: integers(req.query.includeTagIds),
      exclude_segment_ids: integers(req.query.excludeSegmentIds),
      exclude_tag_ids: integers(req.query.excludeTagIds),
    });
    res.json({ audience: req.params.audience, count });
  }),
);

adminGrowthRouter.get(
  "/campaigns/:id/sends",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM email_sends WHERE campaign_id = $1 ORDER BY id DESC LIMIT 500",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/**
 * Sends a campaign.
 *
 * Hands the whole job to `services/broadcasts.ts` rather than looping here.
 * The loop this replaced resolved its audience from the legacy `audience`
 * string alone — so a campaign pointed at a saved segment was sent to every
 * subscriber instead — and posted each message through `sendMail`, which knows
 * nothing about the suppression list, the contact's topic preferences or the
 * unsubscribe footer that makes a commercial email legal. It also ran in a
 * detached promise, so a deploy halfway through lost the rest of the list with
 * the campaign still reading "sending".
 */
adminGrowthRouter.post(
  "/campaigns/:id/send",
  asyncHandler(async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) throw notFound("Campaign not found");

    // The same three refusals as before, answered here so they stay 400s with
    // the wording the console already shows. `startBroadcast` re-checks them
    // for the scheduled path, which has no request in front of it.
    const campaignResult = await pool.query<{ status: string; subject: string }>(
      "SELECT status, subject FROM email_campaigns WHERE id = $1",
      [campaignId],
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) throw notFound("Campaign not found");
    if (campaign.status === "sending") throw badRequest("This campaign is already sending");
    if (campaign.status === "sent") throw badRequest("This campaign has already been sent");
    if (!campaign.subject.trim()) throw badRequest("Add a subject before sending");

    let result;
    try {
      result = await startBroadcast(campaignId);
    } catch (err) {
      // Only the sentences `startBroadcast` wrote for a person are shown to
      // one. The console prints any short 400 verbatim, so passing every error
      // through here put raw Postgres text — "duplicate key value violates
      // unique constraint" — on screen as though the sender had filled a form
      // in wrong. Anything else is a fault: it is logged in full for us and
      // answered with a sentence that says what state the campaign is in, since
      // `startBroadcast` has already put it back to one she can retry from.
      if (err instanceof BroadcastRefusal) throw badRequest(err.message);
      // eslint-disable-next-line no-console
      console.error(`[campaigns] campaign ${campaignId} could not start:`, err);
      throw new HttpError(
        500,
        "Something went wrong starting this email, so it has been stopped. Nothing more will go out — try sending it again in a moment."
      );
    }

    res.status(202).json({ ok: true, queued: result.queued, recipients: result.recipients });
  }),
);

adminGrowthRouter.use("/campaigns", buildAdminCrudRouter(campaignsRepo, anySchema, anySchema, "created_at DESC"));

/* ----------------------------------------------------------------- Funnels */

adminGrowthRouter.get(
  "/funnels/:id/steps",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY sort, id",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminGrowthRouter.use("/steps", buildAdminCrudRouter(funnelStepsRepo, anySchema, anySchema));
adminGrowthRouter.use("/funnels", buildAdminCrudRouter(funnelsRepo, anySchema, anySchema, "id DESC"));

/* ------------------------------------------------------------- Automations */

adminGrowthRouter.get(
  "/automations/:id/actions",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM automation_actions WHERE automation_id = $1 ORDER BY sort, id",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminGrowthRouter.get(
  "/automations/:id/runs",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM automation_runs WHERE automation_id = $1 ORDER BY created_at DESC LIMIT 100",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/** Fires the automation against a sample payload so it can be proven safe. */
adminGrowthRouter.post(
  "/automations/:id/test",
  asyncHandler(async (req, res) => {
    const automation = await pool.query(
      "SELECT trigger_type FROM automations WHERE id = $1",
      [req.params.id],
    );
    if (automation.rowCount === 0) throw notFound("Automation not found");

    const payload = (req.body ?? {}) as Record<string, unknown>;
    if (!payload.email) throw badRequest("Provide an email to test with");

    fireTriggerAsync(automation.rows[0].trigger_type as TriggerType, payload);
    res.status(202).json({ ok: true, note: "Test fired — check the run log in a moment." });
  }),
);

adminGrowthRouter.use("/actions", buildAdminCrudRouter(automationActionsRepo, anySchema, anySchema));
adminGrowthRouter.use("/automations", buildAdminCrudRouter(automationsRepo, anySchema, anySchema, "id DESC"));

/* ------------------------------------------------------------------- Forms */

adminGrowthRouter.get(
  "/forms/:id/submissions",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM form_submissions WHERE form_id = $1 ORDER BY created_at DESC LIMIT 500",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminGrowthRouter.use("/forms", buildAdminCrudRouter(formsRepo, anySchema, anySchema, "id DESC"));

/* ----------------------------------------------------------------- Reports */

adminGrowthRouter.use("/saved-reports", buildAdminCrudRouter(savedReportsRepo, anySchema, anySchema, "created_at DESC"));

/**
 * GET /admin/growth/reports/subscriptions
 *
 * MRR / ARPU / churn, the three metrics Kajabi's subscription report leads
 * with. Churn is computed over the trailing 30 days as
 * cancelled / (active at start of window).
 */
adminGrowthRouter.get(
  "/reports/subscriptions",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `WITH active AS (
         SELECT s.*, p.interval FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE s.status IN ('active','trialing')
       )
       SELECT
         (SELECT COUNT(*)::int FROM active)                                    AS active_count,
         (SELECT COALESCE(SUM(CASE WHEN interval = 'year' THEN amount_cents/12
                                   ELSE amount_cents END), 0)::int FROM active) AS mrr_cents,
         (SELECT COUNT(*)::int FROM subscriptions
           WHERE status = 'canceled' AND updated_at >= CURRENT_DATE - INTERVAL '30 days')
                                                                                AS churned_30d,
         (SELECT COUNT(*)::int FROM subscriptions
           WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')               AS new_30d,
         (SELECT COUNT(*)::int FROM subscriptions WHERE cancel_at_period_end)   AS pending_cancel`,
    );

    const row = result.rows[0];
    const active = Number(row.active_count);
    const mrr = Number(row.mrr_cents);
    const churned = Number(row.churned_30d);
    // Denominator is the population that existed at the window's start.
    const base = active + churned;

    res.json({
      activeCount: active,
      mrrCents: mrr,
      arpuCents: active > 0 ? Math.round(mrr / active) : 0,
      churned30d: churned,
      new30d: Number(row.new_30d),
      pendingCancel: Number(row.pending_cancel),
      churnRate: base > 0 ? Math.round((churned / base) * 1000) / 10 : 0,
    });
  }),
);

/** Audience growth + engagement counts for the Reports screen. */
adminGrowthRouter.get(
  "/reports/audience",
  asyncHandler(async (_req, res) => {
    const [totals, series] = await Promise.all([
      pool.query(
        `SELECT
           ${MAILABLE_CONTACT_COUNT_SQL}                                  AS subscribers,
           (SELECT COUNT(*)::int FROM members)                            AS members,
           (SELECT COUNT(*)::int FROM leads)                              AS leads,
           (SELECT COUNT(*)::int FROM form_submissions)                   AS form_submissions,
           (SELECT COUNT(*)::int FROM community_memberships)              AS community_members`,
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ),
         s AS (${MAILABLE_CONTACT_SERIES_SQL}),
         m AS (SELECT created_at::date AS day, COUNT(*)::int AS c FROM members
                WHERE created_at >= CURRENT_DATE - INTERVAL '29 days' GROUP BY 1)
         SELECT to_char(d.day,'YYYY-MM-DD') AS date,
                COALESCE(s.c,0) AS subscribers, COALESCE(m.c,0) AS members
           FROM days d LEFT JOIN s ON s.day = d.day LEFT JOIN m ON m.day = d.day
          ORDER BY d.day`,
      ),
    ]);

    res.json({ totals: rowToCamel(totals.rows[0]), series: rowsToCamel(series.rows) });
  }),
);

/** Funnel step-by-step conversion for every published funnel. */
adminGrowthRouter.get(
  "/reports/funnels",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT f.id, f.name, f.kind,
              COALESCE(SUM(s.views), 0)::int       AS views,
              COALESCE(SUM(s.conversions), 0)::int AS conversions,
              COUNT(s.id)::int                     AS step_count
         FROM funnels f LEFT JOIN funnel_steps s ON s.funnel_id = f.id
        GROUP BY f.id, f.name, f.kind
        ORDER BY views DESC`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/** Content performance: posts, lessons, episodes, issues. */
adminGrowthRouter.get(
  "/reports/content",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM blog_posts WHERE published)        AS posts,
         (SELECT COUNT(*)::int FROM course_lessons)                    AS lessons,
         (SELECT COUNT(*)::int FROM podcast_episodes WHERE published)  AS episodes,
         (SELECT COUNT(*)::int FROM newsletter_issues WHERE status = 'sent') AS issues_sent,
         (SELECT COUNT(*)::int FROM community_posts)                   AS community_posts,
         (SELECT COUNT(*)::int FROM media_assets)                      AS media_assets`,
    );
    res.json(rowToCamel(result.rows[0]));
  }),
);
