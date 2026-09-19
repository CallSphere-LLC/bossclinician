import { liveRoster } from "../../services/liveRoomBus";
import { Router } from "express";
import { GROUP_PRICE_COLUMNS, saveAccessGroup, deleteAccessGroup } from "../../services/communityGroupPricing";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { z } from "zod";
import { partialUpdate } from "../../validation/partialUpdate";
import { POINT_ACTIONS } from "../../services/communityNotifications";
import { recordAdminActionStrict } from "../../services/adminAudit";
import { HOST_LINK_TTL_SECONDS, createHostLink } from "../../services/hostLinks";
import { communityEventLocation } from "../../services/communityEventLocation";

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
  // `viewMode` is the single layout the member side renders (`view_mode`). It
  // has to be one of the three, and one of the offered set when both are sent.
  const view = body.viewMode;
  if (view !== undefined) {
    if (!VIEW_MODES.includes(view as (typeof VIEW_MODES)[number])) {
      throw badRequest("Channels can be shown as a feed, a forum or a gallery.");
    }
    if (Array.isArray(modes) && !modes.includes(view)) {
      throw badRequest("The view members open it in has to be one of the views you offer.");
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
      // Every channel in the room, whatever its visibility or tier and whoever
      // is in it. The card's CHANNELS figure has to agree with the list on the
      // community's own page, and both have to agree with what is actually
      // there: an admin told "1" while a member is reading three of them has
      // been given a number that cannot be acted on.
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM community_channels ch WHERE ch.community_id = c.id)    AS channel_count,
        -- The same definition of "a member" the member-facing surfaces use:
        -- somebody banned, or whose account is closed, is not a person in here.
        (SELECT COUNT(*)::int FROM community_memberships m
           JOIN members mm ON mm.id = m.member_id
          WHERE m.community_id = c.id AND m.banned_at IS NULL
            AND mm.status = 'active')                                                     AS member_count,
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

    /*
     * EVERY channel in the community, deliberately unfiltered.
     *
     * The admin list is not a member's view of the room and must never be
     * scoped like one: an invite-only channel, or one limited to a tier the
     * admin happens not to be in, still has to be visible here or it cannot be
     * renamed, moderated, re-opened or deleted by the person who owns it. A
     * channel the owner cannot see is a channel the owner cannot fix.
     *
     * The tier's name and the invite count come along so the list can say
     * *why* a channel is restricted rather than only that it is.
     */
    const channels = await pool.query(
      `SELECT ch.*,
        (SELECT COUNT(*)::int FROM community_posts p WHERE p.channel_id = ch.id) AS post_count,
        (SELECT COUNT(*)::int FROM community_channel_members ccm
          WHERE ccm.channel_id = ch.id) AS invited_count,
        g.name AS access_group_name
       FROM community_channels ch
       LEFT JOIN community_access_groups g ON g.id = ch.access_group_id
      WHERE ch.community_id = $1 ORDER BY ch.sort, ch.id`,
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
      `SELECT v.id, v.member_id, v.peer_id, v.joined_at, v.left_at,
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
    const active = new Set(liveRoster(Number(req.params.id)).map((peer) => peer.peerId));
    res.setHeader("Cache-Control", "no-store");
    res.json(rowsToCamel(visits.rows.map(({ peer_id, ...visit }) => ({
      ...visit,
      in_progress: visit.left_at === null && active.has(peer_id),
      interrupted: visit.left_at === null && !active.has(peer_id),
    }))));
  }),
);

/**
 * POST /:id/live/host-link
 *
 * "Join the live room as host". The room only admits member sessions, so this
 * hands back a one-time address on the public site that signs the admin's
 * browser in as the member account carrying her own email, already a host of
 * this community — see services/hostLinks.ts. The client opens it at once; it
 * is good for two minutes and for one use.
 *
 * The permission is the router's: every non-GET under /admin/community needs
 * `community.manage`.
 *
 * The audit row is written first and is allowed to fail the request, for the
 * reason impersonation's is (see recordAdminActionStrict): this mints a member
 * session, and one with no durable trace of who asked for it must not exist.
 * The raw token is never part of it.
 */
adminCommunityRouter.post(
  "/:id/live/host-link",
  asyncHandler(async (req, res) => {
    const communityId = Number(req.params.id);
    if (!Number.isInteger(communityId) || communityId < 1) throw notFound("Community not found");
    const adminId = req.user?.sub;
    if (adminId === undefined) throw forbidden("Admin identity missing");

    // Email and name come from the table rather than the JWT: the token carries
    // no name, and its email is whatever it was when she signed in.
    const admin = await pool.query<{ email: string; name: string }>(
      `SELECT email, name FROM admin_users WHERE id = $1`,
      [adminId],
    );
    const me = admin.rows[0];
    if (!me) throw forbidden("Admin identity missing");

    // So a mistyped id is a 404 and not an audit row about a link nobody got.
    const exists = await pool.query(`SELECT 1 FROM communities WHERE id = $1`, [communityId]);
    if (exists.rowCount === 0) throw notFound("Community not found");

    await recordAdminActionStrict({
      req,
      action: "community.live.host_link",
      entityType: "community",
      entityId: communityId,
      after: { memberEmail: me.email, expiresInSeconds: HOST_LINK_TTL_SECONDS },
    });

    const link = await createHostLink({
      adminId,
      adminEmail: me.email,
      adminName: me.name,
      communityId,
    });
    res.json({ url: link.url, expiresInSeconds: link.expiresInSeconds });
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
      `SELECT g.id, g.name, g.description, g.sort, g.created_at, g.checkout_offer_id, ${GROUP_PRICE_COLUMNS},
              (SELECT COUNT(*)::int FROM community_access_group_members m
                WHERE m.group_id = g.id) AS member_count,
              (SELECT COUNT(*)::int FROM community_channels ch
                WHERE ch.access_group_id = g.id) AS channel_count
         FROM community_access_groups g
         LEFT JOIN offers o ON o.id = g.checkout_offer_id
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
  pricingType: z.enum(["free", "one_time", "subscription"]).optional(),
  amountCents: z.number().int().min(0).max(99_999_999).optional(),
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/).optional(),
  interval: z.enum(["month", "year"]).nullable().optional(),
});

adminCommunityRouter.post(
  "/:id/access-groups",
  asyncHandler(async (req, res) => {
    const parsed = accessGroupSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Check the group's name and pricing.", parsed.error.flatten());
    const saved = await saveAccessGroup(Number(req.params.id), null, parsed.data);
    res.status(201).json(rowToCamel(saved));
  }),
);

adminCommunityRouter.put(
  "/:id/access-groups/:groupId",
  asyncHandler(async (req, res) => {
    const parsed = partialUpdate(accessGroupSchema).safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Check the group's details and pricing.");
    if (Object.keys(parsed.data).length === 0) throw badRequest("No updatable fields supplied");
    const saved = await saveAccessGroup(Number(req.params.id), Number(req.params.groupId), parsed.data);
    res.json(rowToCamel(saved));
  }),
);

adminCommunityRouter.delete(
  "/:id/access-groups/:groupId",
  asyncHandler(async (req, res) => {
    // Channels and products fall back to the whole community via ON DELETE SET
    // NULL, so deleting a tier opens its channels rather than orphaning them.
    // That is the safe direction: nobody loses access they had.
    await deleteAccessGroup(Number(req.params.id), Number(req.params.groupId));
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

/* ------------------------------------------- what grants a tier, and how */

/**
 * GET /:id/access-groups/:groupId/grants
 *
 * Everything that puts somebody in this tier by selling it to them: the offers,
 * the products and the plans that name it. The tab's own description promises
 * "an offer can grant it" and there was no way to see whether one did.
 *
 * Purchase-derived tier membership is never a row in
 * `community_access_group_members` — it is read live off the grant, so a refund
 * takes the tier away with the access rather than leaving a row nobody
 * remembers to delete. Which is why this screen reads the three tables that
 * name the group rather than counting members.
 */
adminCommunityRouter.get(
  "/:id/access-groups/:groupId/grants",
  asyncHandler(async (req, res) => {
    const owned = await pool.query(
      `SELECT 1 FROM community_access_groups WHERE id = $1 AND community_id = $2`,
      [req.params.groupId, req.params.id],
    );
    if (owned.rowCount === 0) throw notFound("Access group not found");

    const [offers, products, plans] = await Promise.all([
      pool.query(
        `SELECT id, title, slug, status FROM offers
          WHERE access_group_id = $1 ORDER BY title`,
        [req.params.groupId],
      ),
      pool.query(
        `SELECT id, title, slug, status FROM products
          WHERE access_group_id = $1 ORDER BY title`,
        [req.params.groupId],
      ),
      pool.query(
        `SELECT id, name, slug FROM plans WHERE access_group_id = $1 ORDER BY name`,
        [req.params.groupId],
      ),
    ]);

    res.json({
      offers: rowsToCamel(offers.rows),
      products: rowsToCamel(products.rows),
      plans: rowsToCamel(plans.rows),
    });
  }),
);

/**
 * GET/PUT /offers/:offerId/access-group
 *
 * The tier an offer grants, as its own endpoint.
 *
 * Deliberately here and not on the offer editor's own PUT: the offer routes are
 * owned elsewhere and this is one field with one meaning, so exposing it
 * separately lets the offer editor wire it up with a single call and lets this
 * screen read it back without either side reaching into the other's shape.
 *
 * The grant is DERIVED, never copied. `access_grants.offer_id` already records
 * which offer produced a grant, and `services/access.ts` reads the tier through
 * that live grant — so a refund or a lapsed payment plan removes the tier at the
 * same instant it removes the access, and nothing has to be swept up afterwards.
 *
 *   GET  → { offerId, offerTitle, accessGroupId, accessGroupName, communityId }
 *   PUT  { accessGroupId: number | null } → the same shape
 *
 * `null` clears it. A group id from a community the offer does not sell is
 * refused: buying an offer that grants a tier in a room the offer does not
 * unlock is a tier nobody can use.
 */
adminCommunityRouter.get(
  "/offers/:offerId/access-group",
  asyncHandler(async (req, res) => {
    const found = await pool.query(
      `SELECT o.id AS offer_id, o.title AS offer_title, o.access_group_id,
              g.name AS access_group_name, g.community_id
         FROM offers o
         LEFT JOIN community_access_groups g ON g.id = o.access_group_id
        WHERE o.id = $1`,
      [req.params.offerId],
    );
    if (found.rowCount === 0) throw notFound("Offer not found");
    res.json(rowToCamel(found.rows[0]));
  }),
);

adminCommunityRouter.put(
  "/offers/:offerId/access-group",
  asyncHandler(async (req, res) => {
    const raw = (req.body as Record<string, unknown>).accessGroupId;
    let groupId: number | null = null;
    if (raw !== null && raw !== undefined && raw !== "") {
      groupId = Number(raw);
      if (!Number.isInteger(groupId) || groupId < 1) throw badRequest("That isn't a group.");

      /*
       * The offer has to actually unlock the community the tier belongs to,
       * whether through a product that is that community or one that grants
       * access to it. A tier in a room the offer does not sell is a tier the
       * buyer can never use, and nothing downstream would ever say so.
       */
      const reachable = await pool.query(
        `SELECT 1
           FROM community_access_groups g
          WHERE g.id = $1
            AND EXISTS (
              SELECT 1 FROM offer_products op
                JOIN products p ON p.id = op.product_id
               WHERE op.offer_id = $2 AND p.community_id = g.community_id
            )`,
        [groupId, req.params.offerId],
      );
      if (reachable.rowCount === 0) {
        throw badRequest(
          "That group is in a community this offer doesn't sell. Add the community to the offer first.",
        );
      }
    }

    const saved = await pool.query(
      `UPDATE offers SET access_group_id = $2, updated_at = now()
        WHERE id = $1
      RETURNING id AS offer_id, title AS offer_title, access_group_id`,
      [req.params.offerId, groupId],
    );
    if (saved.rowCount === 0) throw notFound("Offer not found");
    res.json(rowToCamel(saved.rows[0]));
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

/**
 * Resolves the tier a channel is being pinned to, refusing one from a different
 * community.
 *
 * A group id is a small integer arriving in a request body: without this check
 * a channel in one community can be scoped to a tier in another, which is a
 * channel nobody can ever be in and no screen would explain.
 */
async function resolveAccessGroupId(
  communityId: string,
  raw: unknown,
): Promise<number | null> {
  if (raw === null || raw === undefined || raw === "") return null;
  const groupId = Number(raw);
  if (!Number.isInteger(groupId) || groupId < 1) throw badRequest("That isn't a group.");
  const owned = await pool.query(
    `SELECT 1 FROM community_access_groups WHERE id = $1 AND community_id = $2`,
    [groupId, communityId],
  );
  if (owned.rowCount === 0) throw badRequest("That group isn't in this community.");
  return groupId;
}

adminCommunityRouter.post(
  "/:id/channels",
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    assertChannelValues(body);

    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) throw badRequest("Channel name is required");

    const view = typeof body.viewMode === "string" ? body.viewMode : null;
    const modes = Array.isArray(body.viewModes) && body.viewModes.length > 0
      ? (body.viewModes as string[])
      : [view ?? "feed"];
    // Default to a mode that is actually offered, so the CHECK cannot be hit
    // by a create that named only the default. An explicit `viewMode` wins, and
    // is the same value written to `view_mode`, so the two never disagree.
    const preferred =
      view ??
      (typeof body.defaultViewMode === "string" && modes.includes(body.defaultViewMode)
        ? body.defaultViewMode
        : modes[0]);

    const result = await pool.query(
      `INSERT INTO community_channels
         (community_id, slug, name, description, format, visibility,
          cover_image, access_group_id, view_modes, default_view_mode, view_mode, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $10,
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
        await resolveAccessGroupId(req.params.id, body.accessGroupId),
        modes,
        preferred,
      ],
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  }),
);

/**
 * PUT /channels/:channelId
 *
 * The channel settings screen. Everything the create dialog offers is editable
 * afterwards, which had been the real gap: a channel created invite-only, or
 * pointed at the wrong tier, or opened as the wrong layout, could not be put
 * right or removed, so the only fix was to leave it broken.
 *
 * Renaming does NOT re-slug. The slug is in every link a member has followed
 * or bookmarked and in the href of every notification already sent; changing a
 * channel's display name is not a request to break those.
 */
adminCommunityRouter.put(
  "/channels/:channelId",
  asyncHandler(async (req, res) => {
    const body = { ...(req.body as Record<string, unknown>) };
    assertChannelValues(body);

    // Scoped by the channel's own community, so a group from somewhere else is
    // refused with words rather than stored as a channel nobody can enter.
    if ("accessGroupId" in body) {
      const owner = await pool.query<{ community_id: number }>(
        `SELECT community_id FROM community_channels WHERE id = $1`,
        [req.params.channelId],
      );
      if (owner.rowCount === 0) throw notFound("Channel not found");
      body.accessGroupId = await resolveAccessGroupId(
        String(owner.rows[0].community_id),
        body.accessGroupId,
      );
    }
    // The slug is a member's bookmark; only an explicit slug changes it.
    delete body.communityId;

    /*
     * `viewMode` → `view_mode`, the one layout the member side renders. It is
     * kept in step with the older pair (033): the channel opens in it by
     * default, and it is added to the offered set if missing, so the CHECK on
     * `default_view_mode = ANY(view_modes)` can never turn a save into a 500.
     * A save that only names `defaultViewMode` moves `view_mode` with it.
     */
    const chosenView = body.viewMode ?? body.defaultViewMode;
    delete body.viewMode;

    const update = buildUpdate(body, CHANNEL_FIELDS);
    const sets = update ? [update.clause] : [];
    const values = update ? [...update.values] : [];
    if (chosenView !== undefined) {
      values.push(chosenView);
      const p = `$${values.length}::text`;
      sets.push(`view_mode = ${p}`);
      if (!("defaultViewMode" in body)) sets.push(`default_view_mode = ${p}`);
      if (!("viewModes" in body)) {
        sets.push(
          `view_modes = CASE WHEN ${p} = ANY(view_modes) THEN view_modes
                             ELSE array_append(view_modes, ${p}) END`,
        );
      }
    }
    if (sets.length === 0) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE community_channels SET ${sets.join(", ")}
       WHERE id = $${values.length + 1} RETURNING *`,
      [...values, req.params.channelId],
    );
    if (result.rowCount === 0) throw notFound("Channel not found");
    res.json(rowToCamel(result.rows[0]));
  }),
);

/**
 * PUT /:id/channels/order  { channelIds: number[] }
 *
 * The order members see the channels in, set in one go. It has to name every
 * channel in the community exactly once: a partial list would leave two
 * channels sharing a position and the order would depend on insertion id,
 * which is the "I moved it and it moved back" bug in another form. If the list
 * changed underneath the screen (somebody created or deleted a channel), the
 * save is refused with a reason rather than applied to a list nobody saw.
 */
adminCommunityRouter.put(
  "/:id/channels/order",
  asyncHandler(async (req, res) => {
    const raw = (req.body as Record<string, unknown>).channelIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw badRequest("Send the channels in the order you want them.");
    }
    const ids = raw.map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
      throw badRequest("That order names a channel twice, or one we can't read.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM community_channels WHERE community_id = $1 FOR UPDATE`,
        [req.params.id],
      );
      const known = new Set(existing.rows.map((row) => row.id));
      if (known.size === 0) throw notFound("That community has no channels to reorder.");
      if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
        throw badRequest(
          "The channel list changed while you were reordering it. Reload the page and try again.",
        );
      }
      await client.query(
        `UPDATE community_channels ch
            SET sort = o.pos::int - 1
           FROM unnest($2::int[]) WITH ORDINALITY AS o(id, pos)
          WHERE ch.id = o.id AND ch.community_id = $1`,
        [req.params.id, ids],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ channelIds: ids });
  }),
);

/**
 * GET /:id/offers
 *
 * The offers that sell this community, with the tier each one grants. This is
 * what the Access groups tab offers when "an offer can grant it": only an offer
 * that actually unlocks the room can grant a tier in it (the PUT on
 * /offers/:offerId/access-group enforces the same rule), so listing anything
 * else would be offering a choice that is refused on save.
 */
adminCommunityRouter.get(
  "/:id/offers",
  asyncHandler(async (req, res) => {
    const rows = await pool.query(
      `SELECT DISTINCT o.id, o.title, o.status, o.access_group_id,
              g.name AS access_group_name
         FROM offers o
         JOIN offer_products op ON op.offer_id = o.id
         JOIN products p        ON p.id = op.product_id
         LEFT JOIN community_access_groups g ON g.id = o.access_group_id
        WHERE p.community_id = $1
        ORDER BY o.title, o.id`,
      [req.params.id],
    );
    res.json(rowsToCamel(rows.rows));
  }),
);

/* ------------------------------------------------------- channel invites */

/**
 * Who has been let into an invite-only channel.
 *
 * `visibility = 'private'` has been offered in the admin as "Invited members
 * only" since the baseline with nowhere to record an invitation, so the
 * member-side queries could only fall back to "moderators and admins" — a
 * channel created private was invisible to every member of the community and
 * there was no way to let anybody in. These three endpoints are the missing
 * half; `community_channel_members` is the list they read and write.
 *
 * Listed for a public channel too, and harmless there: the rows are ignored
 * while the channel is open to everyone and mean what they say again the moment
 * it is closed, so switching a channel to invite-only does not silently discard
 * the people already picked for it.
 */
adminCommunityRouter.get(
  "/channels/:channelId/invites",
  asyncHandler(async (req, res) => {
    const rows = await pool.query(
      `SELECT ccm.member_id, ccm.added_at,
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''),
                       NULLIF(m.name, ''), m.email::text) AS name,
              m.email::text AS email
         FROM community_channel_members ccm
         JOIN members m ON m.id = ccm.member_id
        WHERE ccm.channel_id = $1
        ORDER BY ccm.added_at DESC
        LIMIT 500`,
      [req.params.channelId],
    );
    res.json(rowsToCamel(rows.rows));
  }),
);

adminCommunityRouter.post(
  "/channels/:channelId/invites",
  asyncHandler(async (req, res) => {
    const memberId = Number((req.body as Record<string, unknown>).memberId);
    if (!Number.isInteger(memberId) || memberId < 1) throw badRequest("Choose someone to invite.");

    /*
     * They have to be in the community first. A channel invitation to somebody
     * who cannot open the community is a row that grants nothing, and the
     * screen that offered it would have said the opposite.
     */
    const inRoom = await pool.query(
      `SELECT 1
         FROM community_channels ch
         JOIN community_memberships cm ON cm.community_id = ch.community_id
        WHERE ch.id = $1 AND cm.member_id = $2`,
      [req.params.channelId, memberId],
    );
    if (inRoom.rowCount === 0) {
      throw badRequest("Add them to this community first, then invite them to the channel.");
    }

    await pool.query(
      `INSERT INTO community_channel_members (channel_id, member_id)
       VALUES ($1, $2) ON CONFLICT (channel_id, member_id) DO NOTHING`,
      [req.params.channelId, memberId],
    );
    res.status(201).json({ ok: true });
  }),
);

adminCommunityRouter.delete(
  "/channels/:channelId/invites/:memberId",
  asyncHandler(async (req, res) => {
    await pool.query(
      `DELETE FROM community_channel_members WHERE channel_id = $1 AND member_id = $2`,
      [req.params.channelId, req.params.memberId],
    );
    res.status(204).end();
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

/**
 * POST /channels/:channelId/posts
 *
 * The host's composer, which can now write a post for later.
 *
 * `publishAt` holds the post at `status = 'scheduled'` and the
 * `community.publishScheduled` sweeper (every two minutes) flips it to visible
 * when its moment comes, moving `created_at` to the publication time so it does
 * not appear already buried under everything posted since. Until then it is
 * inert: invisible in the channel, and listed only on the Scheduled screen.
 * Without this the Scheduled tab was a page nothing could ever reach — it told
 * the reader to "choose a time for it" against a composer with no such control.
 */
adminCommunityRouter.post(
  "/channels/:channelId/posts",
  asyncHandler(async (req, res) => {
    const { title, body, mediaUrl, mediaLabel, authorName, pinned, publishAt } =
      req.body as Record<string, unknown>;
    if (typeof body !== "string" || !body.trim()) throw badRequest("Post body is required");

    let scheduledFor: Date | null = null;
    if (publishAt !== undefined && publishAt !== null && publishAt !== "") {
      const when = new Date(String(publishAt));
      if (!Number.isFinite(when.getTime())) throw badRequest("That isn't a time we can read.");
      // Publishing a past time immediately would hide what is almost always a
      // timezone mistake, so it is refused rather than rounded up to now.
      if (when.getTime() <= Date.now()) {
        throw badRequest("Choose a time in the future, or post it now.");
      }
      scheduledFor = when;
    }

    const result = await pool.query(
      `INSERT INTO community_posts
         (channel_id, title, body, media_url, media_label, author_name, pinned,
          status, publish_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        req.params.channelId,
        typeof title === "string" ? title : "",
        body.trim(),
        typeof mediaUrl === "string" ? mediaUrl : "",
        typeof mediaLabel === "string" ? mediaLabel : "",
        typeof authorName === "string" && authorName ? authorName : "Host",
        Boolean(pinned),
        scheduledFor === null ? "visible" : "scheduled",
        scheduledFor,
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
      // Every row, including the banned and the closed — this is the screen
      // where a ban is lifted, so hiding them would hide the undo. They carry
      // `bannedAt` and the account status so the list can mark them, and so the
      // headline count can be the same number the members themselves see:
      // "2 people in this community" over a directory listing one was two
      // different questions being asked and only one of them answered.
      `SELECT cm.id, cm.role, cm.points, cm.joined_at, cm.member_id, cm.banned_at,
              m.email, m.name, m.status,
              (SELECT COALESCE(
                        json_agg(json_build_object('id', g.id, 'name', g.name)
                                 ORDER BY g.sort, g.id),
                        '[]'::json)
                 FROM community_access_group_members agm
                 JOIN community_access_groups g ON g.id = agm.group_id
                WHERE agm.member_id = cm.member_id AND g.community_id = cm.community_id
              ) AS groups
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

/**
 * GET /:id/leaderboard?period=week|month|all
 *
 * The same three boards the member sidebar offers (2.7), because an admin
 * looking at "who is most active" and a member looking at the same list have to
 * be shown the same thing — and "all time" alone cannot answer "who turned up
 * this week", which is the question that decides who gets a shout-out.
 *
 * All-time reads the running total on the membership; the two windows sum the
 * points ledger instead. They have to come from different places: the
 * membership total is a lifetime figure nothing decrements, so it cannot answer
 * "this week", and summing the ledger for all time would disagree with the
 * total the moment anybody's points are adjusted by hand.
 *
 * Nobody on zero appears on any of them. Every member of a new community has
 * nothing, and RANK() makes all of them equal first — a board where two people
 * who have never posted are both "1st" is a membership list with a trophy on
 * it, which is exactly how this read on the live site.
 */
adminCommunityRouter.get(
  "/:id/leaderboard",
  asyncHandler(async (req, res) => {
    const asked = String(req.query.period ?? "all");
    const period = asked === "week" || asked === "month" ? asked : "all";
    const window = period === "week" ? "7 days" : "30 days";

    const result = await pool.query(
      period === "all"
        ? `SELECT cm.points, m.name, m.email, cm.member_id,
                  RANK() OVER (ORDER BY cm.points DESC)::int AS rank,
                  COUNT(*) OVER (PARTITION BY cm.points) > 1 AS tied,
                  (SELECT b.emoji FROM community_badges b
                    WHERE b.community_id = cm.community_id AND b.threshold <= cm.points
                    ORDER BY b.threshold DESC LIMIT 1) AS badge
             FROM community_memberships cm
             JOIN members m ON m.id = cm.member_id
            WHERE cm.community_id = $1 AND cm.banned_at IS NULL AND cm.points > 0
            ORDER BY rank, m.name
            LIMIT 20`
        : `WITH earned AS (
             SELECT e.member_id, SUM(e.points)::int AS points
               FROM community_point_events e
              WHERE e.community_id = $1
                AND e.created_at > now() - interval '${window}'
              GROUP BY e.member_id
           )
           SELECT e.points, m.name, m.email, cm.member_id,
                  RANK() OVER (ORDER BY e.points DESC)::int AS rank,
                  COUNT(*) OVER (PARTITION BY e.points) > 1 AS tied,
                  (SELECT b.emoji FROM community_badges b
                    WHERE b.community_id = cm.community_id AND b.threshold <= cm.points
                    ORDER BY b.threshold DESC LIMIT 1) AS badge
             FROM earned e
             JOIN community_memberships cm
               ON cm.community_id = $1 AND cm.member_id = e.member_id
             JOIN members m ON m.id = cm.member_id
            WHERE cm.banned_at IS NULL AND e.points > 0
            ORDER BY rank, m.name
            LIMIT 20`,
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

    const location = communityEventLocation(b, true)!;
    const client = await pool.connect();
    try {
    await client.query("BEGIN");
    if (location.native) {
      await client.query("UPDATE communities SET live_room_enabled = true WHERE id = $1", [req.params.id]);
    }
    const result = await client.query(
      `INSERT INTO community_events
         (community_id, title, description, starts_at, duration_minutes, location_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.params.id,
        b.title.trim(),
        b.description ?? "",
        b.startsAt || null,
        b.durationMinutes ?? 60,
        location.locationUrl,
      ],
    );
    await client.query("COMMIT");
    res.status(201).json(rowToCamel(result.rows[0]));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }),
);

adminCommunityRouter.put(
  "/events/:eventId",
  asyncHandler(async (req, res) => {
    const body = { ...req.body } as Record<string, unknown>;
    const location = communityEventLocation(body);
    if (location) body.locationUrl = location.locationUrl;
    const update = buildUpdate(body, EVENT_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");
    const client = await pool.connect();
    try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE community_events SET ${update.clause}
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.eventId],
    );
    if (result.rowCount === 0) throw notFound("Event not found");
    if (location?.native) {
      await client.query("UPDATE communities SET live_room_enabled = true WHERE id = $1", [result.rows[0].community_id]);
    }
    await client.query("COMMIT");
    res.json(rowToCamel(result.rows[0]));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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
