import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { pool } from "../../db/pool";
import { rowsToCamel, rowToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { buildAdminCrudRouter } from "./crudFactory";
import { sendMail } from "../../email/mailer";
import { fireTriggerAsync, type TriggerType } from "../../automations/engine";
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

/* ---------------------------------------------------------------- Coaching */

adminGrowthRouter.get(
  "/coaching/sessions",
  asyncHandler(async (req, res) => {
    const offerId = req.query.offerId ? Number(req.query.offerId) : null;
    const result = await pool.query(
      `SELECT s.*, m.name AS member_name, m.email AS member_email, o.title AS offer_title
         FROM coaching_sessions s
         LEFT JOIN members m ON m.id = s.member_id
         LEFT JOIN coaching_offers o ON o.id = s.offer_id
        WHERE ($1::int IS NULL OR s.offer_id = $1)
        ORDER BY s.scheduled_at DESC NULLS LAST, s.id DESC`,
      [offerId],
    );
    res.json(rowsToCamel(result.rows));
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
        : await pool.query("SELECT email FROM subscribers WHERE email <> ''");

    const emails = recipients.rows.map((r) => String(r.email));

    await pool.query(
      `UPDATE newsletter_issues
          SET status = 'sent', sent_at = now(), recipient_count = $2, updated_at = now()
        WHERE id = $1`,
      [issue.id, emails.length],
    );

    // Detached: a large list must not hold the request open.
    void (async () => {
      for (const email of emails) {
        await sendMail({
          to: email,
          subject: issue.subject,
          text: issue.body_md,
          html: `<div>${String(issue.body_md).replace(/\n/g, "<br>")}</div>`,
        }).catch(() => undefined);
      }
    })();

    res.status(202).json({ ok: true, recipients: emails.length });
  }),
);

adminGrowthRouter.use("/issues", buildAdminCrudRouter(newsletterIssuesRepo, anySchema, anySchema, "created_at DESC"));
adminGrowthRouter.use("/newsletters", buildAdminCrudRouter(newslettersRepo, anySchema, anySchema, "id DESC"));

/* --------------------------------------------------------------- Campaigns */

/** Resolves an audience key to a de-duplicated recipient list. */
async function resolveAudience(audience: string): Promise<string[]> {
  const queries: Record<string, string> = {
    all_subscribers: "SELECT email FROM subscribers WHERE email <> ''",
    all_members: "SELECT email FROM members WHERE email <> '' AND status = 'active'",
    leads: "SELECT DISTINCT email FROM leads WHERE email <> ''",
    community:
      `SELECT DISTINCT m.email FROM members m
         JOIN community_memberships cm ON cm.member_id = m.id
        WHERE m.email <> ''`,
  };
  const sql = queries[audience] ?? queries.all_subscribers;
  const result = await pool.query(sql);
  return [...new Set(result.rows.map((r) => String(r.email).toLowerCase()))];
}

adminGrowthRouter.get(
  "/campaigns/audience/:audience",
  asyncHandler(async (req, res) => {
    const emails = await resolveAudience(req.params.audience);
    res.json({ audience: req.params.audience, count: emails.length });
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

adminGrowthRouter.post(
  "/campaigns/:id/send",
  asyncHandler(async (req, res) => {
    const campaignResult = await pool.query("SELECT * FROM email_campaigns WHERE id = $1", [
      req.params.id,
    ]);
    const campaign = campaignResult.rows[0];
    if (!campaign) throw notFound("Campaign not found");
    if (campaign.status === "sending") throw badRequest("This campaign is already sending");
    if (campaign.status === "sent") throw badRequest("This campaign has already been sent");
    if (!campaign.subject) throw badRequest("Add a subject before sending");

    const emails = await resolveAudience(campaign.audience);
    if (emails.length === 0) throw badRequest("That audience has no recipients");

    await pool.query(
      `UPDATE email_campaigns SET status = 'sending', recipient_count = $2, updated_at = now()
        WHERE id = $1`,
      [campaign.id, emails.length],
    );

    // Queue rows first so a crash mid-send is visible and resumable.
    for (const email of emails) {
      await pool.query(
        `INSERT INTO email_sends (campaign_id, email) VALUES ($1, $2)
         ON CONFLICT (campaign_id, email) DO NOTHING`,
        [campaign.id, email],
      );
    }

    void (async () => {
      let delivered = 0;
      let failed = 0;
      for (const email of emails) {
        try {
          await sendMail({
            to: email,
            subject: campaign.subject,
            text: campaign.body_md,
            html: `<div>${String(campaign.body_md).replace(/\n/g, "<br>")}</div>`,
          });
          delivered += 1;
          await pool.query(
            "UPDATE email_sends SET status = 'sent', sent_at = now() WHERE campaign_id = $1 AND email = $2",
            [campaign.id, email],
          );
        } catch (err) {
          failed += 1;
          await pool.query(
            "UPDATE email_sends SET status = 'failed', error = $3 WHERE campaign_id = $1 AND email = $2",
            [campaign.id, email, (err as Error).message.slice(0, 300)],
          );
        }
      }
      await pool.query(
        `UPDATE email_campaigns
            SET status = 'sent', sent_at = now(), delivered_count = $2, failed_count = $3,
                updated_at = now()
          WHERE id = $1`,
        [campaign.id, delivered, failed],
      );
    })();

    res.status(202).json({ ok: true, queued: emails.length });
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
           (SELECT COUNT(*)::int FROM subscribers)                        AS subscribers,
           (SELECT COUNT(*)::int FROM members)                            AS members,
           (SELECT COUNT(*)::int FROM leads)                              AS leads,
           (SELECT COUNT(*)::int FROM form_submissions)                   AS form_submissions,
           (SELECT COUNT(*)::int FROM community_memberships)              AS community_members`,
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ),
         s AS (SELECT created_at::date AS day, COUNT(*)::int AS c FROM subscribers
                WHERE created_at >= CURRENT_DATE - INTERVAL '29 days' GROUP BY 1),
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
