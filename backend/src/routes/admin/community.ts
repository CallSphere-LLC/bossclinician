import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { z } from "zod";
import { POINT_ACTIONS } from "../../services/communityNotifications";

/**
 * Community admin API — mounted at /admin/community.
 *
 * Object model mirrors Kajabi: community -> channels -> posts -> comments,
 * with a points ledger on the membership row driving leaderboards and badges,
 * plus time-bound challenges and scheduled events.
 */
export const adminCommunityRouter = Router();

const COMMUNITY_FIELDS = [
  "slug",
  "name",
  "description",
  "cover_image",
  "access",
  "published",
  // The live room. Kajabi calls the alias a "feature alias"; Yvette's is
  // Office Hours, and members should see her word for it rather than ours.
  "live_room_enabled",
  "live_room_access",
  "live_room_alias",
  "live_room_capacity",
  // Long-form markdown, shown in a modal a member must accept before posting.
  "guidelines_md",
  // Which leaderboards members may see, each independently (2.7).
  "leaderboard_weekly",
  "leaderboard_monthly",
  "leaderboard_all_time",
  "points_per_title",
] as const;
const CHANNEL_FIELDS = [
  "slug",
  "name",
  "description",
  "format",
  "visibility",
  "sort",
  // 2.2: the cover, the tier it belongs to, and the layouts it offers.
  "cover_image",
  "access_group_id",
  "view_modes",
  "default_view_mode",
] as const;

const VIEW_MODES = ["feed", "forum", "gallery"] as const;

/**
 * Guards the channel fields the database has constraints on.
 *
 * The default view mode has to be one of the modes actually offered, or a
 * member opens a channel into a layout its owner switched off — and the
 * constraint would come back as a 500 with a constraint name in it.
 */
function assertChannelValues(body: Record<string, unknown>): void {
  const modes = body.viewModes;
  if (modes !== undefined) {
    if (!Array.isArray(modes) || modes.length === 0) {
      throw badRequest("Choose at least one way for members to view this channel.");
    }
    if (modes.some((m) => !VIEW_MODES.includes(m as (typeof VIEW_MODES)[number]))) {
      throw badRequest("Channels can be shown as a feed, a forum or a gallery.");
    }
  }
  const preferred = body.defaultViewMode;
  if (preferred !== undefined) {
    if (!VIEW_MODES.includes(preferred as (typeof VIEW_MODES)[number])) {
      throw badRequest("Channels can be shown as a feed, a forum or a gallery.");
    }
    if (Array.isArray(modes) && !modes.includes(preferred)) {
      throw badRequest("The default view has to be one of the views you offer.");
    }
  }
  if (body.format !== undefined && body.format !== "feed" && body.format !== "chat") {
    throw badRequest("A channel is either a feed or a chat.");
  }
}
const POST_FIELDS = ["title", "body", "media_url", "pinned", "status"] as const;
const CHALLENGE_FIELDS = [
  "title",
  "description",
  "cover_image",
  "starts_at",
  "ends_at",
  "points",
  "published",
] as const;
const EVENT_FIELDS = [
  "title",
  "description",
  "starts_at",
  "duration_minutes",
  "location_url",
  "published",
] as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ------------------------------------------------------------- Communities */

adminCommunityRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM community_channels ch WHERE ch.community_id = c.id)    AS channel_count,
        (SELECT COUNT(*)::int FROM community_memberships m WHERE m.community_id = c.id)   AS member_count,
        (SELECT COUNT(*)::int FROM community_posts p
           JOIN community_channels ch2 ON ch2.id = p.channel_id
          WHERE ch2.community_id = c.id)                                                  AS post_count
       FROM communities c
       ORDER BY c.created_at DESC`,
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, description, access, coverImage, slug } = req.body as Record<string, string>;
    if (!name?.trim()) throw badRequest("Community name is required");

    const result = await pool.query(
      `INSERT INTO communities (slug, name, description, cover_image, access)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        slug?.trim() || slugify(name),
        name.trim(),
        description ?? "",
        coverImage ?? "",
        access === "paid" ? "paid" : "free",
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const community = await pool.query("SELECT * FROM communities WHERE id = $1", [req.params.id]);
    if (community.rowCount === 0) throw notFound("Community not found");

    const channels = await pool.query(
      `SELECT ch.*,
        (SELECT COUNT(*)::int FROM community_posts p WHERE p.channel_id = ch.id) AS post_count
       FROM community_channels ch WHERE ch.community_id = $1 ORDER BY ch.sort, ch.id`,
      [req.params.id],
    );

    res.json({
      ...rowToCamel(community.rows[0]),
      channels: rowsToCamel(channels.rows),
    });
  }),
);

/**
 * Guards the two live-room values the database has CHECK constraints on.
 *
 * Without this a typo reaches Postgres and comes back as a 500 with a
 * constraint name in it, which tells the person editing the room nothing.
 */
function assertLiveRoomValues(body: Record<string, unknown>): void {
  if (body.liveRoomAccess !== undefined) {
    if (body.liveRoomAccess !== "always" && body.liveRoomAccess !== "hosted") {
      throw badRequest("Live room access is either always open or open when you're there.");
    }
  }
  if (body.liveRoomCapacity !== undefined) {
    const capacity = Number(body.liveRoomCapacity);
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 16) {
      // The ceiling is a mesh constraint, not a preference: every participant
      // uploads their camera once per other participant.
      throw badRequest("Choose a room size between 2 and 16 people.");
    }
  }
  if (body.liveRoomAlias !== undefined && String(body.liveRoomAlias).length > 60) {
    throw badRequest("That name for the room is too long.");
  }
}

adminCommunityRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    assertLiveRoomValues(req.body as Record<string, unknown>);
    const update = buildUpdate(req.body as Record<string, unknown>, COMMUNITY_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE communities SET ${update.clause}, updated_at = now()
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Community not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM communities WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) throw notFound("Community not found");
    res.status(204).end();
  }),
);

/**
 * GET /:id/live-visits
 *
 * Who has been in the live room, most recent first.
 *
 * The in-process roster answers "who is in there now" and forgets the moment
 * the room empties, so this reads the persisted visits instead — "did anyone
 * come to office hours on Tuesday" is the question Yvette actually asks, and
 * it is unanswerable from presence.
 */
adminCommunityRouter.get(
  "/:id/live-visits",
  asyncHandler(async (req, res) => {
    const visits = await pool.query(
      `SELECT v.id, v.member_id, v.joined_at, v.left_at,
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''),
                       NULLIF(m.name, ''), m.email::text) AS member_name,
              m.email::text AS email,
              -- Still open when left_at is null, which is a live visit rather
              -- than a missing one; the client shows it as "in there now".
              CASE WHEN v.left_at IS NULL THEN NULL
                   ELSE GREATEST(0, EXTRACT(EPOCH FROM (v.left_at - v.joined_at))::int)
              END AS seconds
         FROM community_live_visits v
         JOIN members m ON m.id = v.member_id
        WHERE v.community_id = $1
        ORDER BY v.joined_at DESC
        LIMIT 200`,
      [req.params.id],
    );
    res.json(rowsToCamel(visits.rows));
  }),
);

/**
 * PUT /:id/guidelines
 *
 * Its own endpoint rather than another field on the community update, because
 * saving the text has a side effect the generic update must not perform
 * silently: changing the rules re-opens the gate for everybody who accepted
 * the old ones. Rules somebody agreed to in March are not the rules they are
 * being held to now.
 */
adminCommunityRouter.put(
  "/:id/guidelines",
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const text = typeof body.guidelinesMd === "string" ? body.guidelinesMd : "";
    if (text.length > 40_000) throw badRequest("Those guidelines are too long to store.");

    const before = await pool.query<{ guidelines_md: string }>(
      `SELECT guidelines_md FROM communities WHERE id = $1`,
      [req.params.id],
    );
    if (before.rowCount === 0) throw notFound("Community not found");

    const changed = (before.rows[0].guidelines_md ?? "") !== text;
    const result = await pool.query(
      `UPDATE communities
          SET guidelines_md = $2,
              -- Only moved when the words actually changed, so re-saving the
              -- same text does not make every member accept again.
              guidelines_updated_at = CASE WHEN $3::bool THEN now() ELSE guidelines_updated_at END,
              updated_at = now()
        WHERE id = $1
      RETURNING *`,
      [req.params.id, text, changed],
    );

    res.json({ ...rowToCamel(result.rows[0]), reAccceptanceRequired: changed });
  }),
);

/* ------------------------------------------------------------ gamification */

/**
 * GET /:id/point-rules
 *
 * Kajabi's rules table: one row per thing that earns points, with the POINTS
 * and the MAXIMUM Yvette can edit. The set of rules is fixed in code — each
 * name is a place in a handler that awards them — so this returns the full set
 * with whatever has been stored against each, rather than only the stored rows.
 * A rule with no row yet must appear editable, not missing.
 */
adminCommunityRouter.get(
  "/:id/point-rules",
  asyncHandler(async (req, res) => {
    const stored = await pool.query<{
      action: string;
      points: number;
      max_per_period: number | null;
      period: string;
    }>(
      `SELECT action, points, max_per_period, period
         FROM community_point_rules WHERE community_id = $1`,
      [req.params.id],
    );
    const byAction = new Map(stored.rows.map((r) => [r.action, r]));

    res.json(
      POINT_ACTIONS.map(({ action, label }) => {
        const row = byAction.get(action);
        return {
          action,
          label,
          points: row?.points ?? 0,
          maxPerPeriod: row?.max_per_period ?? null,
          period: row?.period ?? "day",
        };
      }),
    );
  }),
);

const pointRuleSchema = z.object({
  points: z.number().int().min(0).max(10_000),
  /** Null is uncapped, which is right for a once-per-thing rule like an RSVP. */
  maxPerPeriod: z.number().int().min(1).max(1000).nullable(),
  period: z.enum(["day", "week", "month", "all"]),
});

/**
 * PUT /:id/point-rules/:action
 *
 * Upsert, because a community that predates the rules table has no row for a
 * given action and the first edit must create it rather than fail.
 */
adminCommunityRouter.put(
  "/:id/point-rules/:action",
  asyncHandler(async (req, res) => {
    const action = req.params.action;
    if (!POINT_ACTIONS.some((r) => r.action === action)) {
      throw badRequest("That isn't a rule we can award points for.");
    }
    const parsed = pointRuleSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Check the points and the maximum.", parsed.error.flatten());

    const saved = await pool.query(
      `INSERT INTO community_point_rules (community_id, action, points, max_per_period, period)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (community_id, action) DO UPDATE
         SET points = EXCLUDED.points,
             max_per_period = EXCLUDED.max_per_period,
             period = EXCLUDED.period
       RETURNING action, points, max_per_period, period`,
      [req.params.id, action, parsed.data.points, parsed.data.maxPerPeriod, parsed.data.period],
    );
    res.json(rowToCamel(saved.rows[0]));
  }),
);

/* ----------------------------------------------------------- access groups */

/**
 * The tier layer the brief calls the missing piece. A community with no groups
 * behaves exactly as before — a channel with no group is the whole community —
 * so this is additive rather than a change to how access already works.
 */
adminCommunityRouter.get(
  "/:id/access-groups",
  asyncHandler(async (req, res) => {
    const rows = await pool.query(
      `SELECT g.id, g.name, g.description, g.sort, g.created_at,
              (SELECT COUNT(*)::int FROM community_access_group_members m
                WHERE m.group_id = g.id) AS member_count,
              (SELECT COUNT(*)::int FROM community_channels ch
                WHERE ch.access_group_id = g.id) AS channel_count
         FROM community_access_groups g
        WHERE g.community_id = $1
        ORDER BY g.sort, g.id`,
      [req.params.id],
    );
    res.json(rowsToCamel(rows.rows));
  }),
);

const accessGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  sort: z.number().int().min(0).max(1000).default(0),
});

adminCommunityRouter.post(
  "/:id/access-groups",
  asyncHandler(async (req, res) => {
    const parsed = accessGroupSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Give the group a name.", parsed.error.flatten());
    try {
      const created = await pool.query(
        `INSERT INTO community_access_groups (community_id, name, description, sort)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, parsed.data.name, parsed.data.description, parsed.data.sort],
      );
      res.status(201).json(rowToCamel(created.rows[0]));
    } catch (error) {
      // The UNIQUE is on (community, name): two tiers called the same thing
      // would be indistinguishable in every picker that offers them.
      if ((error as { code?: string }).code === "23505") {
        throw badRequest("There is already a group with that name.");
      }
      throw error;
    }
  }),
);

adminCommunityRouter.put(
  "/:id/access-groups/:groupId",
  asyncHandler(async (req, res) => {
    const parsed = accessGroupSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Check the group's details.");
    const update = buildUpdate(
      { name: parsed.data.name, description: parsed.data.description, sort: parsed.data.sort },
      ["name", "description", "sort"] as const,
    );
    if (!update) throw badRequest("No updatable fields supplied");
    const saved = await pool.query(
      `UPDATE community_access_groups SET ${update.clause}
        WHERE id = $${update.values.length + 1} AND community_id = $${update.values.length + 2}
      RETURNING *`,
      [...update.values, req.params.groupId, req.params.id],
    );
    if (saved.rowCount === 0) throw notFound("Access group not found");
    res.json(rowToCamel(saved.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/:id/access-groups/:groupId",
  asyncHandler(async (req, res) => {
    // Channels and products fall back to the whole community via ON DELETE SET
    // NULL, so deleting a tier opens its channels rather than orphaning them.
    // That is the safe direction: nobody loses access they had.
    const gone = await pool.query(
      `DELETE FROM community_access_groups WHERE id = $1 AND community_id = $2`,
      [req.params.groupId, req.params.id],
    );
    if (gone.rowCount === 0) throw notFound("Access group not found");
    res.status(204).end();
  }),
);

/** Who is in a tier, and how they got there. */
adminCommunityRouter.get(
  "/:id/access-groups/:groupId/members",
  asyncHandler(async (req, res) => {
    const rows = await pool.query(
      `SELECT m.member_id, m.source, m.added_at,
              COALESCE(NULLIF(TRIM(me.first_name || ' ' || me.last_name), ''),
                       NULLIF(me.name, ''), me.email::text) AS name,
              me.email::text AS email
         FROM community_access_group_members m
         JOIN members me ON me.id = m.member_id
         JOIN community_access_groups g ON g.id = m.group_id
        WHERE m.group_id = $1 AND g.community_id = $2
        ORDER BY m.added_at DESC
        LIMIT 500`,
      [req.params.groupId, req.params.id],
    );
    res.json(rowsToCamel(rows.rows));
  }),
);

adminCommunityRouter.post(
  "/:id/access-groups/:groupId/members",
  asyncHandler(async (req, res) => {
    const memberId = Number((req.body as Record<string, unknown>).memberId);
    if (!Number.isInteger(memberId) || memberId < 1) throw badRequest("Choose a member to add.");

    const owned = await pool.query(
      `SELECT 1 FROM community_access_groups WHERE id = $1 AND community_id = $2`,
      [req.params.groupId, req.params.id],
    );
    if (owned.rowCount === 0) throw notFound("Access group not found");

    await pool.query(
      `INSERT INTO community_access_group_members (group_id, member_id, source)
       VALUES ($1, $2, 'manual')
       ON CONFLICT (group_id, member_id) DO NOTHING`,
      [req.params.groupId, memberId],
    );
    res.status(201).json({ ok: true });
  }),
);

adminCommunityRouter.delete(
  "/:id/access-groups/:groupId/members/:memberId",
  asyncHandler(async (req, res) => {
    await pool.query(
      `DELETE FROM community_access_group_members m
        USING community_access_groups g
        WHERE m.group_id = g.id AND g.community_id = $1
          AND m.group_id = $2 AND m.member_id = $3`,
      [req.params.id, req.params.groupId, req.params.memberId],
    );
    res.status(204).end();
  }),
);

/* -------------------------------------------------------- scheduled posts */

/**
 * GET /:id/scheduled-posts
 *
 * What is waiting to go out, per the brief's own /scheduled-posts page. A
 * scheduled post is invisible everywhere else by design, so without this
 * screen it can only be found in the database.
 */
adminCommunityRouter.get(
  "/:id/scheduled-posts",
  asyncHandler(async (req, res) => {
    const rows = await pool.query(
      `SELECT p.id, p.title, p.body, p.kind, p.media_url, p.media_label,
              p.publish_at, p.created_at, p.author_name,
              ch.name AS channel_name, ch.slug::text AS channel_slug
         FROM community_posts p
         JOIN community_channels ch ON ch.id = p.channel_id
        WHERE ch.community_id = $1 AND p.status = 'scheduled'
        ORDER BY p.publish_at
        LIMIT 200`,
      [req.params.id],
    );
    res.json(rowsToCamel(rows.rows));
  }),
);

/**
 * PUT /:id/scheduled-posts/:postId
 *
 * Move it, or send it now. Both are the same edit to a moderator — "actually,
 * publish that" is the commonest thing to want from this screen, and making it
 * a different endpoint would mean two ways to change one field.
 */
adminCommunityRouter.put(
  "/:id/scheduled-posts/:postId",
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (body.publishNow === true) {
      const now = await pool.query(
        `UPDATE community_posts
            SET status = 'visible', publish_at = NULL,
                created_at = now(), last_activity_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'scheduled'
        RETURNING id`,
        [req.params.postId],
      );
      if (now.rowCount === 0) throw notFound("That post is not waiting to go out.");
      res.json({ id: Number(req.params.postId), published: true });
      return;
    }

    const when = typeof body.publishAt === "string" ? new Date(body.publishAt) : null;
    if (when === null || !Number.isFinite(when.getTime())) {
      throw badRequest("Choose when this should go out, or publish it now.");
    }
    if (when.getTime() <= Date.now()) {
      // Silently publishing a past time would hide what is almost always a
      // timezone mistake.
      throw badRequest("Choose a time in the future, or publish it now.");
    }

    const moved = await pool.query(
      `UPDATE community_posts SET publish_at = $2, updated_at = now()
        WHERE id = $1 AND status = 'scheduled' RETURNING id, publish_at`,
      [req.params.postId, when],
    );
    if (moved.rowCount === 0) throw notFound("That post is not waiting to go out.");
    res.json(rowToCamel(moved.rows[0]));
  }),
);

/* ------------------------------------------------------------ review feed */

/**
 * GET /:id/reports
 *
 * The moderation queue. Members have been able to report a post or a comment
 * for some time and nothing could read the reports — they went into a table
 * with an index on `status` and no way to see them, which is worse than having
 * no report button at all: it invites somebody to raise a concern into a void.
 */
adminCommunityRouter.get(
  "/:id/reports",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "open";
    if (!["open", "actioned", "dismissed", "all"].includes(status)) {
      throw badRequest("Filter by open, actioned, dismissed or all.");
    }

    const rows = await pool.query(
      `SELECT r.id, r.reason, r.status, r.created_at, r.resolved_at,
              r.post_id, r.comment_id,
              COALESCE(NULLIF(TRIM(rep.first_name || ' ' || rep.last_name), ''),
                       NULLIF(rep.name, ''), rep.email::text) AS reporter_name,
              -- Whichever of the two the report is against; a report always has
              -- exactly one, and the queue wants the words either way.
              COALESCE(p.body, cm.body, '') AS content,
              COALESCE(p.status, cm.status, '') AS content_status,
              COALESCE(NULLIF(TRIM(auth.first_name || ' ' || auth.last_name), ''),
                       NULLIF(auth.name, ''), auth.email::text) AS author_name,
              ch.name AS channel_name
         FROM community_reports r
         LEFT JOIN members rep ON rep.id = r.reporter_id
         LEFT JOIN community_posts p ON p.id = r.post_id
         LEFT JOIN community_comments cm ON cm.id = r.comment_id
         LEFT JOIN community_posts cp ON cp.id = cm.post_id
         LEFT JOIN community_channels ch ON ch.id = COALESCE(p.channel_id, cp.channel_id)
         LEFT JOIN members auth ON auth.id = COALESCE(p.member_id, cm.member_id)
        WHERE ch.community_id = $1
          AND ($2 = 'all' OR r.status = $2)
        ORDER BY r.created_at DESC
        LIMIT 200`,
      [req.params.id, status],
    );
    res.json(rowsToCamel(rows.rows));
  }),
);

/**
 * POST /:id/reports/:reportId/resolve
 *
 * Two outcomes, and the destructive one names what it does: "hide" takes the
 * content down as well as closing the report, "dismiss" only closes it. They
 * are one endpoint because a moderator is making one decision, and splitting
 * it invites a queue where content is hidden but the report stays open.
 */
adminCommunityRouter.post(
  "/:id/reports/:reportId/resolve",
  asyncHandler(async (req, res) => {
    const action = (req.body as Record<string, unknown>).action;
    if (action !== "hide" && action !== "dismiss") {
      throw badRequest("Choose whether to hide the content or dismiss the report.");
    }

    const found = await pool.query<{ post_id: number | null; comment_id: number | null }>(
      `SELECT post_id, comment_id FROM community_reports WHERE id = $1`,
      [req.params.reportId],
    );
    const report = found.rows[0];
    if (!report) throw notFound("Report not found");

    if (action === "hide") {
      if (report.post_id !== null) {
        await pool.query(`UPDATE community_posts SET status = 'hidden' WHERE id = $1`, [
          report.post_id,
        ]);
      }
      if (report.comment_id !== null) {
        await pool.query(`UPDATE community_comments SET status = 'hidden' WHERE id = $1`, [
          report.comment_id,
        ]);
      }
      // Every open report against the same content, not just this one: two
      // members reporting the same post is one thing to deal with.
      await pool.query(
        `UPDATE community_reports
            SET status = 'actioned', resolved_at = now()
          WHERE status = 'open'
            AND ((post_id IS NOT NULL AND post_id = $1)
              OR (comment_id IS NOT NULL AND comment_id = $2))`,
        [report.post_id, report.comment_id],
      );
    } else {
      await pool.query(
        `UPDATE community_reports SET status = 'dismissed', resolved_at = now() WHERE id = $1`,
        [req.params.reportId],
      );
    }

    res.json({ ok: true, action });
  }),
);

/* ---------------------------------------------------------------- Channels */

adminCommunityRouter.post(
  "/:id/channels",
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    assertChannelValues(body);

    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) throw badRequest("Channel name is required");

    const modes = Array.isArray(body.viewModes) && body.viewModes.length > 0
      ? (body.viewModes as string[])
      : ["feed"];
    // Default to a mode that is actually offered, so the CHECK cannot be hit
    // by a create that named only the default.
    const preferred =
      typeof body.defaultViewMode === "string" && modes.includes(body.defaultViewMode)
        ? body.defaultViewMode
        : modes[0];

    const result = await pool.query(
      `INSERT INTO community_channels
         (community_id, slug, name, description, format, visibility,
          cover_image, access_group_id, view_modes, default_view_mode, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10,
         (SELECT COALESCE(MAX(sort), -1) + 1 FROM community_channels WHERE community_id = $1))
       RETURNING *`,
      [
        req.params.id,
        slugify(name),
        name.trim(),
        typeof body.description === "string" ? body.description : "",
        body.format === "chat" ? "chat" : "feed",
        body.visibility === "private" ? "private" : "public",
        typeof body.coverImage === "string" ? body.coverImage : "",
        body.accessGroupId == null ? null : Number(body.accessGroupId),
        modes,
        preferred,
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.put(
  "/channels/:channelId",
  asyncHandler(async (req, res) => {
    assertChannelValues(req.body as Record<string, unknown>);
    const update = buildUpdate(req.body as Record<string, unknown>, CHANNEL_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE community_channels SET ${update.clause}
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.channelId],
    );
    if (result.rowCount === 0) throw notFound("Channel not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/channels/:channelId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_channels WHERE id = $1", [
      req.params.channelId,
    ]);
    if (result.rowCount === 0) throw notFound("Channel not found");
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------- Posts */

adminCommunityRouter.get(
  "/channels/:channelId/posts",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*)::int FROM community_comments c WHERE c.post_id = p.id)  AS comment_count,
        (SELECT COUNT(*)::int FROM community_reactions r WHERE r.post_id = p.id) AS reaction_count
       FROM community_posts p
       WHERE p.channel_id = $1
       ORDER BY p.pinned DESC, p.created_at DESC`,
      [req.params.channelId],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.post(
  "/channels/:channelId/posts",
  asyncHandler(async (req, res) => {
    const { title, body, mediaUrl, authorName, pinned } = req.body as Record<string, unknown>;
    if (typeof body !== "string" || !body.trim()) throw badRequest("Post body is required");

    const result = await pool.query(
      `INSERT INTO community_posts (channel_id, title, body, media_url, author_name, pinned)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.params.channelId,
        typeof title === "string" ? title : "",
        body.trim(),
        typeof mediaUrl === "string" ? mediaUrl : "",
        typeof authorName === "string" && authorName ? authorName : "Host",
        Boolean(pinned),
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.put(
  "/posts/:postId",
  asyncHandler(async (req, res) => {
    const update = buildUpdate(req.body as Record<string, unknown>, POST_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE community_posts SET ${update.clause}, updated_at = now()
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.postId],
    );
    if (result.rowCount === 0) throw notFound("Post not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/posts/:postId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_posts WHERE id = $1", [
      req.params.postId,
    ]);
    if (result.rowCount === 0) throw notFound("Post not found");
    res.status(204).end();
  }),
);

/* ---------------------------------------------------------------- Comments */

adminCommunityRouter.get(
  "/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM community_comments WHERE post_id = $1 ORDER BY created_at",
      [req.params.postId],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.delete(
  "/comments/:commentId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_comments WHERE id = $1", [
      req.params.commentId,
    ]);
    if (result.rowCount === 0) throw notFound("Comment not found");
    res.status(204).end();
  }),
);

/* ------------------------------------------------- Memberships/leaderboard */

adminCommunityRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT cm.id, cm.role, cm.points, cm.joined_at, cm.member_id,
              m.email, m.name, m.status
       FROM community_memberships cm
       JOIN members m ON m.id = cm.member_id
       WHERE cm.community_id = $1
       ORDER BY cm.points DESC, cm.joined_at DESC`,
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const { memberId, role } = req.body as { memberId?: number; role?: string };
    if (!memberId) throw badRequest("memberId is required");

    const result = await pool.query(
      // source 'manual': Yvette putting somebody in a room IS the entitlement.
      // There is no purchase to point at and none should be required.
      `INSERT INTO community_memberships (community_id, member_id, role, source)
       VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (community_id, member_id) DO UPDATE
         SET role = EXCLUDED.role, source = 'manual'
       RETURNING *`,
      [req.params.id, memberId, role ?? "member"],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.put(
  "/memberships/:membershipId",
  asyncHandler(async (req, res) => {
    const { role, points } = req.body as { role?: string; points?: number };
    const result = await pool.query(
      `UPDATE community_memberships
       SET role = COALESCE($1, role), points = COALESCE($2, points)
       WHERE id = $3 RETURNING *`,
      [role ?? null, points ?? null, req.params.membershipId],
    );
    if (result.rowCount === 0) throw notFound("Membership not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/memberships/:membershipId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_memberships WHERE id = $1", [
      req.params.membershipId,
    ]);
    if (result.rowCount === 0) throw notFound("Membership not found");
    res.status(204).end();
  }),
);

adminCommunityRouter.get(
  "/:id/leaderboard",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT cm.points, m.name, m.email,
              (SELECT b.emoji FROM community_badges b
                WHERE b.community_id = cm.community_id AND b.threshold <= cm.points
                ORDER BY b.threshold DESC LIMIT 1) AS badge
       FROM community_memberships cm
       JOIN members m ON m.id = cm.member_id
       WHERE cm.community_id = $1
       ORDER BY cm.points DESC LIMIT 20`,
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/* -------------------------------------------------------------- Challenges */

adminCommunityRouter.get(
  "/:id/challenges",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT ch.*,
        (SELECT COUNT(*)::int FROM community_challenge_entries e WHERE e.challenge_id = ch.id) AS entry_count,
        (SELECT COUNT(*)::int FROM community_challenge_entries e
          WHERE e.challenge_id = ch.id AND e.approved) AS approved_count
       FROM community_challenges ch
       WHERE ch.community_id = $1 ORDER BY ch.created_at DESC`,
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.post(
  "/:id/challenges",
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    if (typeof b.title !== "string" || !b.title.trim()) throw badRequest("Title is required");

    const result = await pool.query(
      `INSERT INTO community_challenges
         (community_id, title, description, cover_image, starts_at, ends_at, points)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.params.id,
        b.title.trim(),
        b.description ?? "",
        b.coverImage ?? "",
        b.startsAt || null,
        b.endsAt || null,
        b.points ?? 10,
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.put(
  "/challenges/:challengeId",
  asyncHandler(async (req, res) => {
    const update = buildUpdate(req.body as Record<string, unknown>, CHALLENGE_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE community_challenges SET ${update.clause}
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.challengeId],
    );
    if (result.rowCount === 0) throw notFound("Challenge not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/challenges/:challengeId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_challenges WHERE id = $1", [
      req.params.challengeId,
    ]);
    if (result.rowCount === 0) throw notFound("Challenge not found");
    res.status(204).end();
  }),
);

adminCommunityRouter.get(
  "/challenges/:challengeId/entries",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT e.*, m.name, m.email
       FROM community_challenge_entries e
       JOIN members m ON m.id = e.member_id
       WHERE e.challenge_id = $1 ORDER BY e.created_at DESC`,
      [req.params.challengeId],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

/**
 * Approving an entry awards the challenge's points to that member's
 * membership row. Done in a transaction, and guarded by `approved = false`
 * so double-approving cannot award points twice.
 */
adminCommunityRouter.put(
  "/entries/:entryId/approve",
  asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const entry = await client.query(
        `UPDATE community_challenge_entries SET approved = true
         WHERE id = $1 AND approved = false
         RETURNING challenge_id, member_id`,
        [req.params.entryId],
      );

      if (entry.rowCount === 0) {
        await client.query("ROLLBACK");
        // Either it doesn't exist or it was already approved — both are no-ops.
        res.json({ ok: true, alreadyApproved: true });
        return;
      }

      const { challenge_id: challengeId, member_id: memberId } = entry.rows[0];
      await client.query(
        `UPDATE community_memberships cm
         SET points = cm.points + ch.points
         FROM community_challenges ch
         WHERE ch.id = $1 AND cm.community_id = ch.community_id AND cm.member_id = $2`,
        [challengeId, memberId],
      );

      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

/* ------------------------------------------------------------------ Events */

adminCommunityRouter.get(
  "/:id/events",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM community_events WHERE community_id = $1 ORDER BY starts_at NULLS LAST",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.post(
  "/:id/events",
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    if (typeof b.title !== "string" || !b.title.trim()) throw badRequest("Title is required");

    const result = await pool.query(
      `INSERT INTO community_events
         (community_id, title, description, starts_at, duration_minutes, location_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.params.id,
        b.title.trim(),
        b.description ?? "",
        b.startsAt || null,
        b.durationMinutes ?? 60,
        b.locationUrl ?? "",
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.put(
  "/events/:eventId",
  asyncHandler(async (req, res) => {
    const update = buildUpdate(req.body as Record<string, unknown>, EVENT_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE community_events SET ${update.clause}
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.eventId],
    );
    if (result.rowCount === 0) throw notFound("Event not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/events/:eventId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_events WHERE id = $1", [
      req.params.eventId,
    ]);
    if (result.rowCount === 0) throw notFound("Event not found");
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------ Badges */

adminCommunityRouter.get(
  "/:id/badges",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM community_badges WHERE community_id = $1 ORDER BY threshold",
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCommunityRouter.post(
  "/:id/badges",
  asyncHandler(async (req, res) => {
    const { name, emoji, threshold } = req.body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw badRequest("Badge name is required");

    const result = await pool.query(
      `INSERT INTO community_badges (community_id, name, emoji, threshold)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, name.trim(), emoji ?? "🏅", threshold ?? 100],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

adminCommunityRouter.delete(
  "/badges/:badgeId",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM community_badges WHERE id = $1", [
      req.params.badgeId,
    ]);
    if (result.rowCount === 0) throw notFound("Badge not found");
    res.status(204).end();
  }),
);
