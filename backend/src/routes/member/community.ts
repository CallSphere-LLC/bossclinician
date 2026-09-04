import path from "path";
import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound, unauthorized } from "../../utils/httpError";
import { plainText } from "../../utils/plainText";
import { publishDomainEvent } from "../../services/domainEvents";
import {
  denyImpersonation,
  requireVerifiedEmail,
  type AuthedMember,
} from "../../middleware/memberAuth";
import { listEnterableCommunityIds, mayEnterCommunity } from "../../services/access";
import {
  NOTIFICATION_KINDS,
  awardPoints,
  notify,
  notifyMentions,
} from "../../services/communityNotifications";
import { deliverableUrl, readProtectedRef } from "../../services/signedUrls";
import type { EntitledMedia } from "./downloads";

/**
 * `/api/member/community` — the member's side of the community the admin has
 * been building into an empty room.
 *
 * Two questions, always in this order and never merged: `requireMember` (applied
 * once by routes/member/index.ts) answers who is asking, and `enterCommunity`
 * below answers whether they may be in this room at all. Every handler that
 * touches a channel, post, comment, challenge or event resolves it back to a
 * community and runs it through that gate — a post id is a small integer, and
 * without the walk back up to the community it is a way to read a paid room from
 * a free account.
 *
 * Everything a member writes here is rendered to other members, so every text
 * field is stripped of markup on the way in rather than trusted to be escaped on
 * the way out, and every link is checked for an http(s) scheme. Storing markup
 * and hoping the client escapes it makes every future renderer a place this can
 * go wrong.
 *
 * Writes carry `denyImpersonation`: an admin looking through "view as member" is
 * looking, and a post made through that window would be indistinguishable from
 * one the customer wrote themselves.
 */
export const memberCommunityRouter = Router();

/** Postgres int4 ceiling. An id it cannot hold is a 404, not a failed query. */
const MAX_INT4 = 2_147_483_647;

const COMMUNITY_MISSING = "We couldn't find that community.";
const CHANNEL_MISSING = "We couldn't find that channel.";
const POST_MISSING = "We couldn't find that post.";
const COMMENT_MISSING = "We couldn't find that comment.";
const CHALLENGE_MISSING = "We couldn't find that challenge.";
const EVENT_MISSING = "We couldn't find that event.";
const BANNED =
  "You no longer have access to this community. Reply to any email from us if that's a mistake.";

const TOO_MANY = { error: "Too many requests. Please try again later." };

/** Keyed on the member, not the IP: a clinic behind one address is many people. */
const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

const limiter = (max: number, windowMinutes = 15) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: TOO_MANY,
    keyGenerator: byMember,
  });

/** A post is a considered thing. Comfortably above a busy day, far below a bot. */
const postLimiter = limiter(30);
const commentLimiter = limiter(90);
/** Tapping reactions is idle browsing behaviour, so the ceiling is generous. */
const reactionLimiter = limiter(300);
/** Reports are read by a person. A flood of them is an attack on her attention. */
const reportLimiter = limiter(20, 60);
const writeLimiter = limiter(120);

/** requireMember has already run; this keeps the guarantee in the type system too. */
function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

/** pg hands back TIMESTAMPTZ as a Date; the JSON contract is an ISO string. */
function iso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

const idSchema = z.coerce.number().int().positive().max(MAX_INT4);

function readParamId(value: unknown, missing: string): number {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound(missing);
  return parsed.data;
}

/**
 * Slugs, as tightly as the ones the admin generates. Anything else is a 404
 * rather than a validation error: a malformed slug and an unknown one are the
 * same event to whoever typed the URL.
 */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

function readSlug(value: unknown, missing: string): string {
  const parsed = slugSchema.safeParse(value);
  if (!parsed.success) throw notFound(missing);
  return parsed.data;
}

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

function readPage(req: Request): { page: number; perPage: number; offset: number } {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) throw badRequest("Invalid page", parsed.error.flatten());
  return { ...parsed.data, offset: (parsed.data.page - 1) * parsed.data.perPage };
}

/** `COUNT(*) OVER ()` is a bigint, which pg hands back as a string. */
function totalOf(row: { total_count: string | number } | undefined): number {
  return row ? Number(row.total_count) || 0 : 0;
}

/* ----------------------------------------------------------- hostile input */

const textField = (max: number) => z.string().max(max).transform(plainText);

const requiredText = (max: number, message: string) =>
  textField(max).refine((v) => v.length > 0, message);

/**
 * Links members supply, restricted to schemes a browser can safely follow.
 * `javascript:` and `data:` in an href are the whole attack, and neither is a
 * thing anybody pastes into a community post by accident.
 */
const urlField = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Please paste a full link starting with http:// or https://");

/**
 * A fixed reaction set rather than free text.
 *
 * The emoji is member-supplied and lands in everybody else's feed; an allowlist
 * removes the question of what else could be sent entirely, and gives the client
 * a stable row of buttons to render.
 */
const REACTION_EMOJI = ["👍", "❤️", "🎉", "🙌", "🔥", "😂", "💡", "👀"] as const;
const emojiSchema = z.enum(REACTION_EMOJI);

/* ------------------------------------------------------------ transactions */

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/* --------------------------------------------------------- the entry gate */

/**
 * The display name a member is known by, denormalised the same way everywhere.
 * `author_name` on the row is the fallback so a post keeps its byline after the
 * account behind it is deleted and `member_id` goes null.
 */
const MEMBER_NAME_SQL =
  `COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), NULLIF(m.name, ''), 'Member')`;

interface CommunityContext {
  id: number;
  slug: string;
  name: string;
  description: string;
  coverImage: string;
  membershipId: number;
  role: string;
  points: number;
  bio: string;
  headline: string;
  joinedAt: Date;
  /** Where unread counts are measured from. Null until they have been in once. */
  lastSeenAt: Date | null;
  /** Private channels are the one thing a plain member is not shown. */
  moderator: boolean;
  /** The live room, so the chrome can offer it without a second request. */
  liveRoomEnabled: boolean;
  liveRoomAlias: string;
}

interface CommunityRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  cover_image: string;
  membership_id: number | null;
  role: string | null;
  points: number | null;
  bio: string | null;
  headline: string | null;
  joined_at: Date | null;
  last_seen_at: Date | null;
  banned_at: Date | null;
  live_room_enabled: boolean;
  live_room_alias: string;
}

const COMMUNITY_SELECT = `
  SELECT c.id, c.slug, c.name, c.description, c.cover_image,
         c.live_room_enabled, c.live_room_alias,
         cm.id AS membership_id, cm.role, cm.points, cm.bio, cm.headline,
         cm.joined_at, cm.last_seen_at, cm.banned_at
    FROM communities c
    LEFT JOIN community_memberships cm
      ON cm.community_id = c.id AND cm.member_id = $1
   WHERE c.published`;

/**
 * Resolves a community this member may be inside, or throws.
 *
 * Entitlement is asked of access.ts on every entry, and the membership row is no
 * part of the answer. That row is a record of standing — points, badges, role,
 * history — so a refund revokes the grant and leaves it exactly where it was,
 * and a door made of a row nobody deletes is a door that never closes. access.ts
 * answers instead: a live grant for a product that sells this community, or a
 * community nobody sells at all, which is what a free one is.
 *
 * Somebody entitled but not yet enrolled auto-joins on first visit, because that
 * row is also their profile and their place in the directory — making the member
 * click "join" for something they have already paid for is a step that exists
 * only to be forgotten. An admin looking through "view as member" enrols nobody:
 * that window is for looking, and a join date on a customer's account is a
 * change to it.
 *
 * A ban is a 403 and not the usual 404: they know the room exists, they were in
 * it, and pretending it vanished would just have them mailing support about a
 * bug. Everything else unowned is a 404 — community slugs are on the sales site,
 * and a 403 would confirm which ones are worth trying again later.
 */
async function enterCommunity(
  member: AuthedMember,
  where: { slug: string } | { id: number }
): Promise<CommunityContext> {
  const bySlug = "slug" in where;
  const found = await pool.query<CommunityRow>(
    `${COMMUNITY_SELECT} AND ${bySlug ? "c.slug = $2" : "c.id = $2"}`,
    [member.id, bySlug ? where.slug : where.id]
  );
  const row = found.rows[0];
  if (!row) throw notFound(COMMUNITY_MISSING);

  if (row.banned_at !== null) throw forbidden(BANNED);
  if (!(await mayEnterCommunity(member.id, row.id))) throw notFound(COMMUNITY_MISSING);

  let membership = row;
  if (membership.membership_id === null && member.impersonatedBy === undefined) {
    await pool.query(
      // Auto-join only ever happens after mayEnterCommunity has said yes, so
      // the source records what let them in: a purchase-backed grant, or a room
      // that is simply open. Neither is re-read as permission later.
      // The source is decided in SQL from whether anything sells this room, so
      // it cannot drift from the predicate in access.ts that reads it back.
      `INSERT INTO community_memberships (community_id, member_id, role, source)
       SELECT c.id, $2, 'member',
              CASE WHEN c.access = 'paid'
                     OR EXISTS (SELECT 1 FROM products sp
                                 WHERE sp.community_id = c.id AND sp.kind = 'community')
                     OR EXISTS (SELECT 1 FROM plans pl WHERE pl.community_id = c.id)
                   THEN 'purchase' ELSE 'free' END
         FROM communities c WHERE c.id = $1
       ON CONFLICT (community_id, member_id) DO NOTHING`,
      [row.id, member.id]
    );
    // Re-read rather than trust the INSERT's RETURNING: the ON CONFLICT branch
    // returns nothing, and two tabs opening the community at once both land here.
    const rejoined = await pool.query<CommunityRow>(`${COMMUNITY_SELECT} AND c.id = $2`, [
      member.id,
      row.id,
    ]);
    const joined = rejoined.rows[0];
    if (!joined || joined.membership_id === null) throw notFound(COMMUNITY_MISSING);
    if (joined.banned_at !== null) throw forbidden(BANNED);
    membership = joined;
  }

  const role = membership.role ?? "member";
  return {
    id: membership.id,
    slug: membership.slug,
    name: membership.name,
    description: membership.description,
    coverImage: membership.cover_image,
    membershipId: membership.membership_id ?? 0,
    role,
    points: membership.points ?? 0,
    bio: membership.bio ?? "",
    headline: membership.headline ?? "",
    joinedAt: membership.joined_at ?? new Date(),
    lastSeenAt: membership.last_seen_at,
    moderator: role === "moderator" || role === "admin",
    liveRoomEnabled: membership.live_room_enabled === true,
    liveRoomAlias: membership.live_room_alias ?? "",
  };
}

/** Every `/:slug` route opens the same way: prove the room before reading it. */
async function enterFromParams(req: Request): Promise<CommunityContext> {
  return enterCommunity(currentMember(req), {
    slug: readSlug(req.params.slug, COMMUNITY_MISSING),
  });
}

interface ChannelRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  format: string;
  visibility: string;
}

/**
 * A channel inside a community the member is already inside.
 *
 * `visibility = 'private'` means invite-only, and there is no per-channel invite
 * table — so the only people who can be shown one are the moderators and admins
 * of the community. A plain member gets the same 404 as a stranger.
 */
async function loadChannel(ctx: CommunityContext, channelSlug: string): Promise<ChannelRow> {
  const found = await pool.query<ChannelRow>(
    `SELECT id, slug, name, description, format, visibility
       FROM community_channels
      WHERE community_id = $1 AND slug = $2`,
    [ctx.id, channelSlug]
  );
  const channel = found.rows[0];
  if (!channel) throw notFound(CHANNEL_MISSING);
  if (channel.visibility === "private" && !ctx.moderator) throw notFound(CHANNEL_MISSING);
  return channel;
}

interface PostRow {
  id: number;
  channel_id: number;
  member_id: number | null;
  kind: string;
  title: string;
  body: string;
  media_url: string;
  pinned: boolean;
  locked: boolean;
  status: string;
  created_at: Date;
  community_id: number;
  community_slug: string;
  channel_slug: string;
  channel_visibility: string;
}

/**
 * A post, plus the community and channel it hangs off, gated the same way the
 * feed is. Hidden posts are a 404 for everybody including their author: a
 * moderated post is not a post with a "removed" banner, it is gone.
 */
async function loadPost(
  member: AuthedMember,
  postId: number
): Promise<{ post: PostRow; ctx: CommunityContext }> {
  const found = await pool.query<PostRow>(
    `SELECT p.id, p.channel_id, p.member_id, p.kind, p.title, p.body, p.media_url,
            p.pinned, p.locked, p.status, p.created_at,
            ch.community_id, ch.slug AS channel_slug, ch.visibility AS channel_visibility,
            c.slug AS community_slug
       FROM community_posts p
       JOIN community_channels ch ON ch.id = p.channel_id
       JOIN communities c         ON c.id  = ch.community_id
      WHERE p.id = $1`,
    [postId]
  );
  const post = found.rows[0];
  if (!post || post.status !== "visible") throw notFound(POST_MISSING);

  const ctx = await enterCommunity(member, { id: post.community_id });
  if (post.channel_visibility === "private" && !ctx.moderator) throw notFound(POST_MISSING);
  return { post, ctx };
}

/**
 * The media behind a signed community link, if the room is still open to them.
 *
 * The same three gates the feed applies, asked again at the moment the bytes are
 * requested rather than trusted from when the page rendered: the post is still
 * visible, the member may still be in the community access.ts admits them to,
 * and a private channel is still only for its moderators. Two hours is long
 * enough for a refund, a ban or a moderator taking the post down.
 *
 * Everything it refuses is the same 404, because a signed-out browser holding
 * the link is the case this route mostly sees and it must learn nothing from
 * which gate closed.
 */
export async function loadEntitledPostMedia(
  memberId: number,
  postId: number
): Promise<EntitledMedia> {
  const found = await pool.query<{
    media_url: string;
    community_id: number;
    channel_visibility: string;
    role: string | null;
    banned_at: Date | null;
  }>(
    `SELECT p.media_url, ch.community_id, ch.visibility AS channel_visibility,
            cm.role, cm.banned_at
       FROM community_posts p
       JOIN community_channels ch ON ch.id = p.channel_id
       JOIN communities c         ON c.id  = ch.community_id
       LEFT JOIN community_memberships cm
         ON cm.community_id = ch.community_id AND cm.member_id = $2
      WHERE p.id = $1 AND p.status = 'visible' AND c.published`,
    [postId, memberId]
  );
  const row = found.rows[0];
  const storageKey = row === undefined ? null : readProtectedRef(row.media_url);
  if (!row || storageKey === null || row.banned_at !== null) throw notFound(POST_MISSING);

  const moderator = row.role === "moderator" || row.role === "admin";
  if (row.channel_visibility === "private" && !moderator) throw notFound(POST_MISSING);
  if (!(await mayEnterCommunity(memberId, row.community_id))) throw notFound(POST_MISSING);

  return { storagePath: row.media_url, filename: path.basename(storageKey), mime: "" };
}

/** The link a notification about a post should open. */
const postPath = (post: PostRow): string =>
  `/community/${post.community_slug}/${post.channel_slug}?post=${post.id}`;

/* -------------------------------------------------------------- listing */

interface CommunityListRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  cover_image: string;
  role: string | null;
  points: number | null;
  joined_at: Date | null;
  member_count: number;
  unread_count: number;
}

/**
 * GET /api/member/community
 *
 * Every room the member may walk into, and only those: the free ones, and the
 * ones a live grant entitles them to whether or not they have opened one yet.
 * Somebody who bought a membership this morning must see it here before the
 * auto-join has ever run, and somebody refunded last night must not see it at
 * all — which is why the membership row is not what this admits on either.
 */
memberCommunityRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const enterable = await listEnterableCommunityIds(member.id);

    const found = await pool.query<CommunityListRow>(
      `SELECT c.id, c.slug, c.name, c.description, c.cover_image,
              cm.role, cm.points, cm.joined_at,
              (SELECT COUNT(*)::int FROM community_memberships x
                WHERE x.community_id = c.id AND x.banned_at IS NULL) AS member_count,
              (SELECT COUNT(*)::int
                 FROM community_posts p
                 JOIN community_channels ch ON ch.id = p.channel_id
                WHERE ch.community_id = c.id AND ch.visibility = 'public'
                  AND p.status = 'visible'
                  -- now() for somebody who has not joined yet: a room they have
                  -- never opened is not 400 things they have failed to read.
                  AND p.created_at > COALESCE(cm.last_seen_at, cm.joined_at, now())
                  AND (p.member_id IS NULL OR p.member_id <> $1)) AS unread_count
         FROM communities c
         LEFT JOIN community_memberships cm
           ON cm.community_id = c.id AND cm.member_id = $1
        WHERE c.published
          AND c.id = ANY($2::int[])
          AND cm.banned_at IS NULL
        ORDER BY c.name`,
      [member.id, enterable]
    );

    res.json({
      communities: found.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        coverImage: row.cover_image,
        joined: row.joined_at !== null,
        role: row.role ?? "member",
        points: row.points ?? 0,
        joinedAt: iso(row.joined_at),
        memberCount: row.member_count,
        unreadCount: row.unread_count,
        href: `/community/${row.slug}`,
      })),
    });
  })
);

/* -------------------------------------------------------- notifications */

/**
 * Registered before `/:slug`, and it has to stay that way: Express matches in
 * order, so a `/:slug` route declared above this one would swallow it.
 */
memberCommunityRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const { page, perPage, offset } = readPage(req);
    const unreadOnly = req.query.unread === "true" || req.query.unread === "1";

    const found = await pool.query<{
      id: number;
      kind: string;
      title: string;
      body: string;
      link: string;
      actor_id: number | null;
      actor_name: string;
      actor_avatar_url: string;
      read_at: Date | null;
      created_at: Date;
      total_count: string;
    }>(
      `SELECT n.id, n.kind, n.title, n.body, n.link, n.actor_id, n.read_at, n.created_at,
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), NULLIF(m.name, ''), '')
                AS actor_name,
              COALESCE(m.avatar_url, '') AS actor_avatar_url,
              COUNT(*) OVER () AS total_count
         FROM member_notifications n
         LEFT JOIN members m ON m.id = n.actor_id
        WHERE n.member_id = $1 AND ($2::bool = false OR n.read_at IS NULL)
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $3 OFFSET $4`,
      [member.id, unreadOnly, perPage, offset]
    );

    const unread = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM member_notifications
        WHERE member_id = $1 AND read_at IS NULL`,
      [member.id]
    );

    const total = totalOf(found.rows[0]);
    res.json({
      notifications: found.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        link: row.link,
        actor:
          row.actor_id === null
            ? null
            : { name: row.actor_name, avatarUrl: row.actor_avatar_url },
        read: row.read_at !== null,
        createdAt: iso(row.created_at),
      })),
      unreadCount: unread.rows[0]?.n ?? 0,
      page,
      perPage,
      total,
      hasMore: offset + found.rows.length < total,
    });
  })
);

const readSchema = z
  .object({
    ids: z.array(idSchema).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids?.length ?? 0) > 0, "Nothing to mark as read.");

memberCommunityRouter.post(
  "/notifications/read",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = readSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid request", parsed.error.flatten());

    // `member_id = $1` is in the WHERE clause rather than checked first: an id
    // belonging to somebody else matches nothing rather than being reported as
    // forbidden, which is also the answer that tells a prober the least.
    const marked = await pool.query(
      `UPDATE member_notifications
          SET read_at = now()
        WHERE member_id = $1 AND read_at IS NULL
          AND ($2::bool = true OR id = ANY($3::int[]))`,
      [member.id, parsed.data.all === true, parsed.data.ids ?? []]
    );

    const unread = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM member_notifications
        WHERE member_id = $1 AND read_at IS NULL`,
      [member.id]
    );

    res.json({ marked: marked.rowCount ?? 0, unreadCount: unread.rows[0]?.n ?? 0 });
  })
);

/* ---------------------------------------------------------------- posts */

interface FeedRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  media_url: string;
  pinned: boolean;
  locked: boolean;
  member_id: number | null;
  created_at: Date;
  updated_at: Date;
  last_activity_at: Date;
  author_name: string;
  author_avatar_url: string;
  author_headline: string;
  comment_count: number;
  total_count: string;
}

const FEED_SELECT = `
  SELECT p.id, p.kind, p.title, p.body, p.media_url, p.pinned, p.locked, p.member_id,
         p.created_at, p.updated_at, p.last_activity_at,
         COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), NULLIF(m.name, ''),
                  NULLIF(p.author_name, ''), 'Member') AS author_name,
         COALESCE(m.avatar_url, '')  AS author_avatar_url,
         COALESCE(cm.headline, '')   AS author_headline,
         (SELECT COUNT(*)::int FROM community_comments cc
           WHERE cc.post_id = p.id AND cc.status = 'visible') AS comment_count,
         COUNT(*) OVER () AS total_count
    FROM community_posts p
    LEFT JOIN members m ON m.id = p.member_id
    LEFT JOIN community_memberships cm ON cm.member_id = p.member_id AND cm.community_id = $2`;

interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

interface PollOptionJson {
  id: number;
  label: string;
  voteCount: number;
  mine: boolean;
}

/**
 * Reaction and poll tallies for a page of posts: two queries however many posts
 * are on it, and both are counted from the rows rather than read from
 * `reaction_count`. The denormalised columns are the admin's summary and are
 * maintained below, but a moderator deleting a comment or a member being removed
 * leaves them behind, and a feed that shows a number nobody can find the rows
 * for is a bug report waiting to be filed.
 */
async function loadPostExtras(
  postIds: number[],
  memberId: number
): Promise<{
  reactions: Map<number, ReactionSummary[]>;
  polls: Map<number, PollOptionJson[]>;
}> {
  const reactions = new Map<number, ReactionSummary[]>();
  const polls = new Map<number, PollOptionJson[]>();
  if (postIds.length === 0) return { reactions, polls };

  const [reacted, options] = await Promise.all([
    pool.query<{ post_id: number; emoji: string; count: number; mine: boolean }>(
      `SELECT post_id, emoji, COUNT(*)::int AS count, BOOL_OR(member_id = $2) AS mine
         FROM community_reactions
        WHERE post_id = ANY($1::int[])
        GROUP BY post_id, emoji
        ORDER BY count DESC, emoji`,
      [postIds, memberId]
    ),
    pool.query<{ post_id: number; id: number; label: string; vote_count: number; mine: boolean }>(
      `SELECT po.post_id, po.id, po.label, po.vote_count, (v.id IS NOT NULL) AS mine
         FROM community_poll_options po
         LEFT JOIN community_poll_votes v
           ON v.option_id = po.id AND v.member_id = $2
        WHERE po.post_id = ANY($1::int[])
        ORDER BY po.sort, po.id`,
      [postIds, memberId]
    ),
  ]);

  for (const row of reacted.rows) {
    const list = reactions.get(row.post_id) ?? [];
    list.push({ emoji: row.emoji, count: row.count, mine: row.mine });
    reactions.set(row.post_id, list);
  }
  for (const row of options.rows) {
    const list = polls.get(row.post_id) ?? [];
    list.push({ id: row.id, label: row.label, voteCount: row.vote_count, mine: row.mine });
    polls.set(row.post_id, list);
  }
  return { reactions, polls };
}

function toPostJson(
  row: FeedRow,
  memberId: number,
  reactions: ReactionSummary[],
  pollOptions: PollOptionJson[] | undefined
) {
  const mine = row.member_id !== null && row.member_id === memberId;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    // A member's own post carries a link they pasted, which is already a URL.
    // A post the host made from the admin can carry a file out of the protected
    // directory instead, and that one has to be signed on the way out or the
    // feed renders `https://site/protected:handout.pdf` and nothing plays.
    mediaUrl: deliverableUrl({
      reference: row.media_url,
      kind: "community-media",
      fileId: row.id,
      memberId,
    }).url,
    pinned: row.pinned,
    locked: row.locked,
    author: {
      // Null on a post the host wrote from the admin, which is also what makes
      // it the host: there is no member account behind it.
      memberId: row.member_id,
      name: row.author_name,
      avatarUrl: row.author_avatar_url,
      headline: row.author_headline,
      isHost: row.member_id === null,
    },
    mine,
    canEdit: mine && !row.locked,
    commentCount: row.comment_count,
    reactionCount: reactions.reduce((sum, r) => sum + r.count, 0),
    reactions,
    myReactions: reactions.filter((r) => r.mine).map((r) => r.emoji),
    poll:
      row.kind === "poll" && pollOptions
        ? {
            options: pollOptions,
            totalVotes: pollOptions.reduce((sum, o) => sum + o.voteCount, 0),
            myOptionId: pollOptions.find((o) => o.mine)?.id ?? null,
          }
        : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastActivityAt: iso(row.last_activity_at),
  };
}

/** GET /api/member/community/:slug/channels/:channelSlug/posts */
memberCommunityRouter.get(
  "/:slug/channels/:channelSlug/posts",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);
    const channel = await loadChannel(ctx, readSlug(req.params.channelSlug, CHANNEL_MISSING));
    const { page, perPage, offset } = readPage(req);

    const found = await pool.query<FeedRow>(
      `${FEED_SELECT}
        WHERE p.channel_id = $1 AND p.status = 'visible'
        ORDER BY p.pinned DESC, p.last_activity_at DESC, p.id DESC
        LIMIT $3 OFFSET $4`,
      [channel.id, ctx.id, perPage, offset]
    );

    const ids = found.rows.map((row) => row.id);
    const { reactions, polls } = await loadPostExtras(ids, member.id);

    // One `last_seen_at` for the whole community, so reading any channel clears
    // the unread marks on all of them. Only the first page moves it — paging
    // backwards through history is not "I have caught up" — and an impersonating
    // admin never moves it, because the customer has not read anything.
    if (page === 1 && member.impersonatedBy === undefined) {
      await pool.query(
        `UPDATE community_memberships SET last_seen_at = now() WHERE id = $1`,
        [ctx.membershipId]
      );
    }

    const total = totalOf(found.rows[0]);
    res.json({
      community: { id: ctx.id, slug: ctx.slug, name: ctx.name },
      channel: {
        id: channel.id,
        slug: channel.slug,
        name: channel.name,
        description: channel.description,
        format: channel.format,
        visibility: channel.visibility,
      },
      posts: found.rows.map((row) =>
        toPostJson(row, member.id, reactions.get(row.id) ?? [], polls.get(row.id))
      ),
      reactionEmoji: REACTION_EMOJI,
      page,
      perPage,
      total,
      hasMore: offset + found.rows.length < total,
    });
  })
);

/** Reads one post back through the feed's own shape, so create and list agree. */
async function readPostJson(postId: number, communityId: number, memberId: number) {
  const found = await pool.query<FeedRow>(`${FEED_SELECT} WHERE p.id = $1`, [postId, communityId]);
  const row = found.rows[0];
  if (!row) throw notFound(POST_MISSING);
  const { reactions, polls } = await loadPostExtras([postId], memberId);
  return toPostJson(row, memberId, reactions.get(postId) ?? [], polls.get(postId));
}

const postCreateSchema = z
  .object({
    kind: z.enum(["text", "image", "video", "poll", "link"]).default("text"),
    title: textField(300).default(""),
    body: textField(20_000).default(""),
    mediaUrl: urlField.optional(),
    pollOptions: z.array(requiredText(200, "An option needs some text.")).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    const needsMedia = value.kind === "image" || value.kind === "video" || value.kind === "link";
    if (needsMedia && !value.mediaUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaUrl"],
        message: "A link is required.",
      });
    }
    if (!needsMedia && value.body.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: "Please write something first.",
      });
    }
    if (value.kind === "poll" && (value.pollOptions?.length ?? 0) < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pollOptions"],
        message: "A poll needs at least two options.",
      });
    }
  });

/**
 * POST /api/member/community/:slug/channels/:channelSlug/posts
 *
 * `requireVerifiedEmail` on top of the community gate: this is words other
 * people read under a name, and an unverified address is a name nobody has
 * proved belongs to them.
 *
 * The post, its poll options, its points and its mention notifications are one
 * transaction. A poll whose options failed to insert is a post with a question
 * and no answers, and a mention nobody was told about is the feature not working.
 */
memberCommunityRouter.post(
  "/:slug/channels/:channelSlug/posts",
  denyImpersonation,
  requireVerifiedEmail,
  postLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);
    const channel = await loadChannel(ctx, readSlug(req.params.channelSlug, CHANNEL_MISSING));

    const parsed = postCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid post", parsed.error.flatten());
    const { kind, title, body, mediaUrl, pollOptions } = parsed.data;

    const authorName = await displayName(member.id);

    const postId = await withTransaction(async (client) => {
      const created = await client.query<{ id: number }>(
        `INSERT INTO community_posts
           (channel_id, member_id, author_name, kind, title, body, media_url, status,
            last_activity_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'visible', now())
         RETURNING id`,
        [channel.id, member.id, authorName, kind, title, body, mediaUrl ?? ""]
      );
      const id = created.rows[0].id;

      if (kind === "poll" && pollOptions) {
        for (const [index, label] of pollOptions.entries()) {
          await client.query(
            `INSERT INTO community_poll_options (post_id, label, sort) VALUES ($1, $2, $3)`,
            [id, label, index]
          );
        }
      }

      await awardPoints({
        communityId: ctx.id,
        memberId: member.id,
        action: "post",
        link: `/community/${ctx.slug}`,
        client,
      });

      await notifyMentions({
        text: `${title} ${body}`,
        communityId: ctx.id,
        actorId: member.id,
        actorName: authorName,
        link: `/community/${ctx.slug}/${channel.slug}?post=${id}`,
        context: ctx.name,
        client,
      });

      return id;
    });

    const identity = await pool.query<{ contact_id: number | null; email: string }>(
      `SELECT contact_id, email::text AS email FROM members WHERE id = $1`,
      [member.id],
    );
    await publishDomainEvent("community_post_created", {
      eventKey: `community-post:${postId}`,
      contactId: identity.rows[0]?.contact_id ?? null,
      email: identity.rows[0]?.email ?? "",
      name: authorName,
      subjectId: ctx.id,
      source: `community:${ctx.slug}`,
      facts: { postId, channelId: channel.id, communityId: ctx.id },
    });

    res.status(201).json(await readPostJson(postId, ctx.id, member.id));
  })
);

/**
 * author_name is denormalised onto every post and comment so the byline survives
 * the account behind it being deleted.
 */
async function displayName(memberId: number): Promise<string> {
  const found = await pool.query<{ display_name: string }>(
    `SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), NULLIF(name, ''), 'Member')
            AS display_name
       FROM members WHERE id = $1`,
    [memberId]
  );
  return found.rows[0]?.display_name ?? "Member";
}

const postEditSchema = z.object({
  title: textField(300).optional(),
  body: textField(20_000).optional(),
  mediaUrl: urlField.optional(),
});

/**
 * PATCH /api/member/community/posts/:id — the author, editing their own.
 *
 * Poll options are not editable, at any price: changing the answers under votes
 * already cast makes the tally a record of a question nobody was asked.
 */
memberCommunityRouter.patch(
  "/posts/:id",
  denyImpersonation,
  requireVerifiedEmail,
  postLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    const parsed = postEditSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid post", parsed.error.flatten());

    const { post, ctx } = await loadPost(member, postId);
    if (post.member_id === null || post.member_id !== member.id) throw notFound(POST_MISSING);
    if (post.locked) throw forbidden("This post has been locked.");

    const title = parsed.data.title ?? post.title;
    const body = parsed.data.body ?? post.body;
    const mediaUrl = parsed.data.mediaUrl ?? post.media_url;
    const carriesMedia = post.kind === "image" || post.kind === "video" || post.kind === "link";
    if (!carriesMedia && body.length === 0) {
      throw badRequest("Please write something first.");
    }

    await pool.query(
      `UPDATE community_posts
          SET title = $3, body = $4, media_url = $5, updated_at = now()
        WHERE id = $1 AND member_id = $2`,
      [postId, member.id, title, body, mediaUrl]
    );

    res.json(await readPostJson(postId, ctx.id, member.id));
  })
);

/**
 * DELETE /api/member/community/posts/:id
 *
 * The text goes, the row stays. Hard-deleting cascades through the comments
 * other people wrote underneath and through any moderation report filed against
 * it — a member should be able to remove their own words without also removing
 * the record that somebody complained about them.
 */
memberCommunityRouter.delete(
  "/posts/:id",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    const { post } = await loadPost(member, postId);
    if (post.member_id === null || post.member_id !== member.id) throw notFound(POST_MISSING);

    await pool.query(
      `UPDATE community_posts
          SET status = 'hidden', title = '', body = '', media_url = '', updated_at = now()
        WHERE id = $1 AND member_id = $2`,
      [postId, member.id]
    );

    res.json({ id: postId, deleted: true });
  })
);

/* ------------------------------------------------------------- comments */

interface CommentRow {
  id: number;
  parent_id: number | null;
  member_id: number | null;
  body: string;
  created_at: Date;
  updated_at: Date;
  author_name: string;
  author_avatar_url: string;
}

interface CommentJson {
  id: number;
  parentId: number | null;
  memberId: number | null;
  authorName: string;
  authorAvatarUrl: string;
  authorIsHost: boolean;
  body: string;
  mine: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  replies: CommentJson[];
}

const COMMENT_SELECT = `
  SELECT c.id, c.parent_id, c.member_id, c.body, c.created_at, c.updated_at,
         COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), NULLIF(m.name, ''),
                  NULLIF(c.author_name, ''), 'Member') AS author_name,
         COALESCE(m.avatar_url, '') AS author_avatar_url
    FROM community_comments c
    LEFT JOIN members m ON m.id = c.member_id
   WHERE c.post_id = $1 AND c.status = 'visible'`;

function toCommentJson(row: CommentRow, memberId: number): CommentJson {
  return {
    id: row.id,
    parentId: row.parent_id,
    memberId: row.member_id,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    authorIsHost: row.member_id === null,
    body: row.body,
    mine: row.member_id !== null && row.member_id === memberId,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    replies: [],
  };
}

/**
 * Nests the flat rows by `parent_id`.
 *
 * A reply whose parent was moderated away is promoted to the top level rather
 * than disappearing with it: the removed text stays removed, and somebody else's
 * answer does not vanish because of what it was answering.
 */
function threadComments(rows: CommentRow[], memberId: number): CommentJson[] {
  const byId = new Map<number, CommentJson>();
  for (const row of rows) byId.set(row.id, toCommentJson(row, memberId));

  const roots: CommentJson[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    const parent = row.parent_id === null ? undefined : byId.get(row.parent_id);
    if (parent) parent.replies.push(node);
    else {
      node.parentId = null;
      roots.push(node);
    }
  }
  return roots;
}

memberCommunityRouter.get(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);
    const { post } = await loadPost(member, postId);

    const found = await pool.query<CommentRow>(`${COMMENT_SELECT} ORDER BY c.created_at, c.id`, [
      post.id,
    ]);

    res.json({
      postId: post.id,
      locked: post.locked,
      comments: threadComments(found.rows, member.id),
    });
  })
);

const commentSchema = z.object({
  body: requiredText(10_000, "Please write something first."),
  parentId: idSchema.nullish(),
});

memberCommunityRouter.post(
  "/posts/:id/comments",
  denyImpersonation,
  requireVerifiedEmail,
  commentLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    const parsed = commentSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid comment", parsed.error.flatten());
    const { body, parentId } = parsed.data;

    const { post, ctx } = await loadPost(member, postId);
    if (post.locked) throw forbidden("Comments are closed on this post.");

    let parentAuthorId: number | null = null;
    if (parentId !== null && parentId !== undefined) {
      // The parent has to sit under this same post: an id from another channel's
      // discussion would otherwise graft a reply onto a thread nobody here owns.
      const parent = await pool.query<{ member_id: number | null }>(
        `SELECT member_id FROM community_comments
          WHERE id = $1 AND post_id = $2 AND status = 'visible'`,
        [parentId, post.id]
      );
      if (parent.rows.length === 0) throw notFound(COMMENT_MISSING);
      parentAuthorId = parent.rows[0].member_id;
    }

    const authorName = await displayName(member.id);

    const commentId = await withTransaction(async (client) => {
      const created = await client.query<{ id: number }>(
        `INSERT INTO community_comments (post_id, member_id, author_name, parent_id, body, status)
         VALUES ($1, $2, $3, $4, $5, 'visible')
         RETURNING id`,
        [post.id, member.id, authorName, parentId ?? null, body]
      );

      await client.query(
        `UPDATE community_posts
            SET comment_count = comment_count + 1, last_activity_at = now()
          WHERE id = $1`,
        [post.id]
      );

      await awardPoints({
        communityId: ctx.id,
        memberId: member.id,
        action: "comment",
        link: `/community/${ctx.slug}`,
        client,
      });

      // The post's author, then the person being replied to. `notify` drops the
      // self-cases, and the parent check stops one person getting two rows for
      // one comment when they wrote both the post and the comment above.
      if (post.member_id !== null) {
        await notify({
          memberId: post.member_id,
          kind: NOTIFICATION_KINDS.postComment,
          title: `${authorName} commented on your post`,
          body,
          link: postPath(post),
          actorId: member.id,
          client,
        });
      }
      if (parentAuthorId !== null && parentAuthorId !== post.member_id) {
        await notify({
          memberId: parentAuthorId,
          kind: NOTIFICATION_KINDS.commentReply,
          title: `${authorName} replied to you`,
          body,
          link: postPath(post),
          actorId: member.id,
          client,
        });
      }

      await notifyMentions({
        text: body,
        communityId: ctx.id,
        actorId: member.id,
        actorName: authorName,
        link: postPath(post),
        context: ctx.name,
        client,
      });

      return created.rows[0].id;
    });

    const reread = await pool.query<CommentRow>(`${COMMENT_SELECT} AND c.id = $2`, [
      post.id,
      commentId,
    ]);
    const row = reread.rows[0];
    if (!row) throw notFound(COMMENT_MISSING);

    res.status(201).json(toCommentJson(row, member.id));
  })
);

/* ------------------------------------------------------------ reactions */

const reactionSchema = z.object({ emoji: emojiSchema });

/** The tally for one post, in the shape the feed uses. */
async function readReactions(postId: number, memberId: number): Promise<ReactionSummary[]> {
  const { reactions } = await loadPostExtras([postId], memberId);
  return reactions.get(postId) ?? [];
}

memberCommunityRouter.post(
  "/posts/:id/reactions",
  denyImpersonation,
  reactionLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    const parsed = reactionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest("That isn't a reaction we support.", parsed.error.flatten());
    }

    const { post } = await loadPost(member, postId);

    await withTransaction(async (client) => {
      // ON CONFLICT DO NOTHING plus RETURNING is what keeps `reaction_count`
      // honest: the counter only moves when a row was actually created, so a
      // double-tap or a retried request cannot inflate it.
      const inserted = await client.query(
        `INSERT INTO community_reactions (post_id, member_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, member_id, emoji) DO NOTHING
         RETURNING id`,
        [post.id, member.id, parsed.data.emoji]
      );
      if ((inserted.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE community_posts SET reaction_count = reaction_count + 1 WHERE id = $1`,
          [post.id]
        );
      }
    });

    res.json({ postId: post.id, reactions: await readReactions(post.id, member.id) });
  })
);

memberCommunityRouter.delete(
  "/posts/:id/reactions",
  denyImpersonation,
  reactionLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    // A DELETE carrying a body is awkward for some clients, so the emoji is
    // taken from either place.
    const parsed = reactionSchema.safeParse({
      emoji: (req.body as { emoji?: unknown } | undefined)?.emoji ?? req.query.emoji,
    });
    if (!parsed.success) {
      throw badRequest("That isn't a reaction we support.", parsed.error.flatten());
    }

    const { post } = await loadPost(member, postId);

    await withTransaction(async (client) => {
      const removed = await client.query(
        `DELETE FROM community_reactions
          WHERE post_id = $1 AND member_id = $2 AND emoji = $3
          RETURNING id`,
        [post.id, member.id, parsed.data.emoji]
      );
      if ((removed.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE community_posts
              SET reaction_count = GREATEST(0, reaction_count - 1)
            WHERE id = $1`,
          [post.id]
        );
      }
    });

    res.json({ postId: post.id, reactions: await readReactions(post.id, member.id) });
  })
);

/* ---------------------------------------------------------------- polls */

const voteSchema = z.object({ optionId: idSchema });

/**
 * POST /api/member/community/posts/:id/vote
 *
 * The UNIQUE is on (post_id, member_id), so changing your mind replaces the vote
 * rather than adding one. The old option's count has to come down in the same
 * transaction that puts the new one up, or a poll ends up with more votes than
 * voters — and the row is locked FOR UPDATE first, so two taps in quick
 * succession cannot both read "no vote yet" and both increment.
 */
memberCommunityRouter.post(
  "/posts/:id/vote",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    const parsed = voteSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid vote", parsed.error.flatten());
    const { optionId } = parsed.data;

    const { post } = await loadPost(member, postId);
    if (post.kind !== "poll") throw badRequest("That post isn't a poll.");
    if (post.locked) throw forbidden("This poll has been closed.");

    await withTransaction(async (client) => {
      const option = await client.query(
        `SELECT id FROM community_poll_options WHERE id = $1 AND post_id = $2`,
        [optionId, post.id]
      );
      if (option.rows.length === 0) throw notFound("We couldn't find that option.");

      const existing = await client.query<{ id: number; option_id: number }>(
        `SELECT id, option_id FROM community_poll_votes
          WHERE post_id = $1 AND member_id = $2
          FOR UPDATE`,
        [post.id, member.id]
      );
      const previous = existing.rows[0];

      if (previous && previous.option_id === optionId) return;

      if (previous) {
        await client.query(
          `UPDATE community_poll_votes SET option_id = $2 WHERE id = $1`,
          [previous.id, optionId]
        );
        await client.query(
          `UPDATE community_poll_options
              SET vote_count = GREATEST(0, vote_count - 1)
            WHERE id = $1`,
          [previous.option_id]
        );
      } else {
        await client.query(
          `INSERT INTO community_poll_votes (post_id, option_id, member_id) VALUES ($1, $2, $3)`,
          [post.id, optionId, member.id]
        );
      }

      await client.query(
        `UPDATE community_poll_options SET vote_count = vote_count + 1 WHERE id = $1`,
        [optionId]
      );
    });

    const { polls } = await loadPostExtras([post.id], member.id);
    const options = polls.get(post.id) ?? [];
    res.json({
      postId: post.id,
      options,
      totalVotes: options.reduce((sum, o) => sum + o.voteCount, 0),
      myOptionId: options.find((o) => o.mine)?.id ?? null,
    });
  })
);

/* -------------------------------------------------------------- reports */

const reportSchema = z.object({ reason: textField(1000).default("") });

/**
 * Reporting is deliberately quiet: the same answer whether or not this is the
 * fifth time this member has reported the same post, and nothing is written back
 * to the feed. Telling a reporter what happened next is how the person they
 * reported finds out who reported them.
 */
memberCommunityRouter.post(
  "/posts/:id/report",
  denyImpersonation,
  requireVerifiedEmail,
  reportLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const postId = readParamId(req.params.id, POST_MISSING);

    const parsed = reportSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid report", parsed.error.flatten());

    const { post } = await loadPost(member, postId);

    const already = await pool.query(
      `SELECT 1 FROM community_reports
        WHERE post_id = $1 AND reporter_id = $2 AND status = 'open' LIMIT 1`,
      [post.id, member.id]
    );
    if (already.rows.length === 0) {
      await pool.query(
        `INSERT INTO community_reports (post_id, reporter_id, reason) VALUES ($1, $2, $3)`,
        [post.id, member.id, parsed.data.reason]
      );
    }

    res.status(201).json({ reported: true });
  })
);

memberCommunityRouter.post(
  "/comments/:id/report",
  denyImpersonation,
  requireVerifiedEmail,
  reportLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const commentId = readParamId(req.params.id, COMMENT_MISSING);

    const parsed = reportSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid report", parsed.error.flatten());

    const found = await pool.query<{ id: number; post_id: number }>(
      `SELECT id, post_id FROM community_comments WHERE id = $1 AND status = 'visible'`,
      [commentId]
    );
    const comment = found.rows[0];
    if (!comment) throw notFound(COMMENT_MISSING);

    // Reached through the post, so a comment id alone proves nothing: the member
    // still has to be entitled to the community the comment was written in.
    await loadPost(member, comment.post_id);

    const already = await pool.query(
      `SELECT 1 FROM community_reports
        WHERE comment_id = $1 AND reporter_id = $2 AND status = 'open' LIMIT 1`,
      [comment.id, member.id]
    );
    if (already.rows.length === 0) {
      await pool.query(
        `INSERT INTO community_reports (comment_id, reporter_id, reason) VALUES ($1, $2, $3)`,
        [comment.id, member.id, parsed.data.reason]
      );
    }

    res.status(201).json({ reported: true });
  })
);

/* ----------------------------------------------------------- challenges */

memberCommunityRouter.post(
  "/challenges/:id/enter",
  denyImpersonation,
  requireVerifiedEmail,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const challengeId = readParamId(req.params.id, CHALLENGE_MISSING);

    const parsed = z
      .object({ proofUrl: urlField.optional(), note: textField(2000).default("") })
      .safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid entry", parsed.error.flatten());

    const found = await pool.query<{
      id: number;
      community_id: number;
      starts_at: Date | null;
      ends_at: Date | null;
    }>(
      `SELECT id, community_id, starts_at, ends_at
         FROM community_challenges WHERE id = $1 AND published`,
      [challengeId]
    );
    const challenge = found.rows[0];
    if (!challenge) throw notFound(CHALLENGE_MISSING);

    await enterCommunity(member, { id: challenge.community_id });

    const now = new Date();
    if (challenge.starts_at !== null && now < challenge.starts_at) {
      throw badRequest("This challenge hasn't started yet.");
    }
    if (challenge.ends_at !== null && now > challenge.ends_at) {
      throw badRequest("This challenge has closed.");
    }

    // The DO UPDATE is guarded on `approved = false` so a member can revise their
    // entry right up until it is approved, and not afterwards — points have been
    // awarded against what was approved, and the proof behind them must not
    // change under the admin who checked it.
    const entered = await pool.query<{
      id: number;
      approved: boolean;
      proof_url: string;
      note: string;
      created_at: Date;
    }>(
      `INSERT INTO community_challenge_entries (challenge_id, member_id, proof_url, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (challenge_id, member_id) DO UPDATE
         SET proof_url = EXCLUDED.proof_url, note = EXCLUDED.note
         WHERE community_challenge_entries.approved = false
       RETURNING id, approved, proof_url, note, created_at`,
      [challenge.id, member.id, parsed.data.proofUrl ?? "", parsed.data.note]
    );

    const row = entered.rows[0];
    if (!row) {
      res.json({ challengeId: challenge.id, entered: true, approved: true, locked: true });
      return;
    }

    res.status(201).json({
      challengeId: challenge.id,
      entryId: row.id,
      entered: true,
      approved: row.approved,
      proofUrl: row.proof_url,
      note: row.note,
      enteredAt: iso(row.created_at),
      locked: false,
    });
  })
);

/* --------------------------------------------------------------- events */

const rsvpSchema = z.object({ status: z.enum(["going", "maybe", "declined"]) });

memberCommunityRouter.post(
  "/events/:id/rsvp",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const eventId = readParamId(req.params.id, EVENT_MISSING);

    const parsed = rsvpSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid RSVP", parsed.error.flatten());

    const found = await pool.query<{ id: number; community_id: number }>(
      `SELECT id, community_id FROM community_events WHERE id = $1 AND published`,
      [eventId]
    );
    const event = found.rows[0];
    if (!event) throw notFound(EVENT_MISSING);

    await enterCommunity(member, { id: event.community_id });

    const saved = await pool.query<{ status: string }>(
      `INSERT INTO community_event_rsvps (event_id, member_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, member_id) DO UPDATE SET status = EXCLUDED.status
       RETURNING status`,
      [event.id, member.id, parsed.data.status]
    );

    const going = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM community_event_rsvps
        WHERE event_id = $1 AND status = 'going'`,
      [event.id]
    );

    res.json({
      eventId: event.id,
      status: saved.rows[0]?.status ?? parsed.data.status,
      goingCount: going.rows[0]?.n ?? 0,
    });
  })
);

/* ------------------------------------------------------ one community */

/**
 * GET /api/member/community/:slug
 *
 * The room itself: its channels with what is unread in each, and who the member
 * is inside it. Declared after every literal-prefixed route above, because
 * Express matches in order and `/:slug` would otherwise answer for
 * `/notifications`.
 */
memberCommunityRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);
    const since = ctx.lastSeenAt ?? ctx.joinedAt;

    const [channels, badges, counts] = await Promise.all([
      pool.query<{
        id: number;
        slug: string;
        name: string;
        description: string;
        format: string;
        visibility: string;
        post_count: number;
        unread_count: number;
      }>(
        `SELECT ch.id, ch.slug, ch.name, ch.description, ch.format, ch.visibility,
                (SELECT COUNT(*)::int FROM community_posts p
                  WHERE p.channel_id = ch.id AND p.status = 'visible') AS post_count,
                (SELECT COUNT(*)::int FROM community_posts p
                  WHERE p.channel_id = ch.id AND p.status = 'visible'
                    AND p.created_at > $2
                    AND (p.member_id IS NULL OR p.member_id <> $3)) AS unread_count
           FROM community_channels ch
          WHERE ch.community_id = $1 AND (ch.visibility = 'public' OR $4::bool)
          ORDER BY ch.sort, ch.id`,
        [ctx.id, since, member.id, ctx.moderator]
      ),
      pool.query<{ id: number; name: string; emoji: string; threshold: number; awarded_at: Date }>(
        `SELECT b.id, b.name, b.emoji, b.threshold, mb.awarded_at
           FROM member_badges mb
           JOIN community_badges b ON b.id = mb.badge_id
          WHERE mb.member_id = $1 AND b.community_id = $2
          ORDER BY b.threshold`,
        [member.id, ctx.id]
      ),
      pool.query<{ member_count: number; unread_notifications: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM community_memberships
             WHERE community_id = $1 AND banned_at IS NULL) AS member_count,
           (SELECT COUNT(*)::int FROM member_notifications
             WHERE member_id = $2 AND read_at IS NULL) AS unread_notifications`,
        [ctx.id, member.id]
      ),
    ]);

    const nextBadge = await pool.query<{ name: string; emoji: string; threshold: number }>(
      `SELECT name, emoji, threshold FROM community_badges
        WHERE community_id = $1 AND threshold > $2
        ORDER BY threshold LIMIT 1`,
      [ctx.id, ctx.points]
    );

    res.json({
      community: {
        id: ctx.id,
        slug: ctx.slug,
        name: ctx.name,
        description: ctx.description,
        coverImage: ctx.coverImage,
        memberCount: counts.rows[0]?.member_count ?? 0,
      },
      membership: {
        role: ctx.role,
        points: ctx.points,
        bio: ctx.bio,
        headline: ctx.headline,
        joinedAt: iso(ctx.joinedAt),
        lastSeenAt: iso(ctx.lastSeenAt),
        badges: badges.rows.map((b) => ({
          id: b.id,
          name: b.name,
          emoji: b.emoji,
          threshold: b.threshold,
          awardedAt: iso(b.awarded_at),
        })),
        nextBadge: nextBadge.rows[0]
          ? {
              name: nextBadge.rows[0].name,
              emoji: nextBadge.rows[0].emoji,
              threshold: nextBadge.rows[0].threshold,
              pointsToGo: nextBadge.rows[0].threshold - ctx.points,
            }
          : null,
      },
      channels: channels.rows.map((ch) => ({
        id: ch.id,
        slug: ch.slug,
        name: ch.name,
        description: ch.description,
        format: ch.format,
        visibility: ch.visibility,
        postCount: ch.post_count,
        unreadCount: ch.unread_count,
        href: `/community/${ctx.slug}/${ch.slug}`,
      })),
      unreadTotal: channels.rows.reduce((sum, ch) => sum + ch.unread_count, 0),
      unreadNotifications: counts.rows[0]?.unread_notifications ?? 0,
      // Carried on the overview so the chrome can offer the room without a
      // second request on every community page. The room's own endpoint still
      // owns whether it is open and who is in it — this is only whether it
      // exists and what Yvette calls it.
      liveRoom: ctx.liveRoomEnabled
        ? {
            enabled: true,
            label: ctx.liveRoomAlias.trim() || "Live room",
            href: `/community/${ctx.slug}/live`,
          }
        : null,
    });
  })
);

/* ------------------------------------------------------------ directory */

/** ILIKE takes its wildcards from the pattern, so a searched-for `%` is escaped. */
function likeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * GET /api/member/community/:slug/members
 *
 * A directory of people, which is exactly as much as it is: no email address is
 * selected here or on the profile below. Members hand us an address to buy
 * something and to be told when their course opens, not so that everybody else
 * in the room can have it.
 */
memberCommunityRouter.get(
  "/:slug/members",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);
    const { page, perPage, offset } = readPage(req);

    const q = typeof req.query.q === "string" ? plainText(req.query.q).slice(0, 100) : "";

    const found = await pool.query<{
      member_id: number;
      name: string;
      avatar_url: string;
      headline: string;
      role: string;
      points: number;
      joined_at: Date;
      badge: string | null;
      total_count: string;
    }>(
      `SELECT cm.member_id, ${MEMBER_NAME_SQL} AS name,
              COALESCE(m.avatar_url, '') AS avatar_url,
              cm.headline, cm.role, cm.points, cm.joined_at,
              (SELECT b.emoji FROM community_badges b
                WHERE b.community_id = cm.community_id AND b.threshold <= cm.points
                ORDER BY b.threshold DESC LIMIT 1) AS badge,
              COUNT(*) OVER () AS total_count
         FROM community_memberships cm
         JOIN members m ON m.id = cm.member_id
        WHERE cm.community_id = $1 AND cm.banned_at IS NULL AND m.status = 'active'
          AND ($2::text = '' OR ${MEMBER_NAME_SQL} ILIKE '%' || $2::text || '%' ESCAPE '\\')
        ORDER BY cm.points DESC, cm.joined_at
        LIMIT $3 OFFSET $4`,
      [ctx.id, likeTerm(q), perPage, offset]
    );

    const total = totalOf(found.rows[0]);
    res.json({
      members: found.rows.map((row) => ({
        memberId: row.member_id,
        name: row.name,
        avatarUrl: row.avatar_url,
        headline: row.headline,
        role: row.role,
        points: row.points,
        joinedAt: iso(row.joined_at),
        badge: row.badge,
        mine: row.member_id === member.id,
        href: `/community/${ctx.slug}/members/${row.member_id}`,
      })),
      page,
      perPage,
      total,
      hasMore: offset + found.rows.length < total,
    });
  })
);

memberCommunityRouter.get(
  "/:slug/members/:memberId",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);
    const profileId = readParamId(req.params.memberId, "We couldn't find that member.");

    const found = await pool.query<{
      member_id: number;
      name: string;
      avatar_url: string;
      headline: string;
      bio: string;
      role: string;
      points: number;
      joined_at: Date;
      post_count: number;
      comment_count: number;
    }>(
      `SELECT cm.member_id, ${MEMBER_NAME_SQL} AS name,
              COALESCE(m.avatar_url, '') AS avatar_url,
              cm.headline, cm.bio, cm.role, cm.points, cm.joined_at,
              (SELECT COUNT(*)::int FROM community_posts p
                 JOIN community_channels ch ON ch.id = p.channel_id
                WHERE ch.community_id = cm.community_id AND p.member_id = cm.member_id
                  AND p.status = 'visible') AS post_count,
              (SELECT COUNT(*)::int FROM community_comments cc
                 JOIN community_posts p     ON p.id  = cc.post_id
                 JOIN community_channels ch ON ch.id = p.channel_id
                WHERE ch.community_id = cm.community_id AND cc.member_id = cm.member_id
                  AND cc.status = 'visible') AS comment_count
         FROM community_memberships cm
         JOIN members m ON m.id = cm.member_id
        WHERE cm.community_id = $1 AND cm.member_id = $2
          AND cm.banned_at IS NULL AND m.status = 'active'`,
      [ctx.id, profileId]
    );
    const profile = found.rows[0];
    if (!profile) throw notFound("We couldn't find that member.");

    const badges = await pool.query<{
      id: number;
      name: string;
      emoji: string;
      threshold: number;
      awarded_at: Date;
    }>(
      `SELECT b.id, b.name, b.emoji, b.threshold, mb.awarded_at
         FROM member_badges mb
         JOIN community_badges b ON b.id = mb.badge_id
        WHERE mb.member_id = $1 AND b.community_id = $2
        ORDER BY b.threshold`,
      [profile.member_id, ctx.id]
    );

    res.json({
      memberId: profile.member_id,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      headline: profile.headline,
      bio: profile.bio,
      role: profile.role,
      points: profile.points,
      joinedAt: iso(profile.joined_at),
      postCount: profile.post_count,
      commentCount: profile.comment_count,
      mine: profile.member_id === member.id,
      badges: badges.rows.map((b) => ({
        id: b.id,
        name: b.name,
        emoji: b.emoji,
        threshold: b.threshold,
        awardedAt: iso(b.awarded_at),
      })),
    });
  })
);

/* ---------------------------------------------------------- leaderboard */

/**
 * The top of the table plus the member's own row, wherever it is. A leaderboard
 * that only shows the first twenty tells the other four hundred people nothing
 * about themselves.
 */
memberCommunityRouter.get(
  "/:slug/leaderboard",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);

    const found = await pool.query<{
      member_id: number;
      name: string;
      avatar_url: string;
      headline: string;
      points: number;
      rank: string;
      badge: string | null;
    }>(
      `WITH ranked AS (
         SELECT cm.member_id, ${MEMBER_NAME_SQL} AS name,
                COALESCE(m.avatar_url, '') AS avatar_url, cm.headline, cm.points,
                RANK() OVER (ORDER BY cm.points DESC) AS rank,
                (SELECT b.emoji FROM community_badges b
                  WHERE b.community_id = cm.community_id AND b.threshold <= cm.points
                  ORDER BY b.threshold DESC LIMIT 1) AS badge
           FROM community_memberships cm
           JOIN members m ON m.id = cm.member_id
          WHERE cm.community_id = $1 AND cm.banned_at IS NULL AND m.status = 'active'
       )
       SELECT * FROM ranked
        WHERE rank <= 20 OR member_id = $2
        ORDER BY rank, name`,
      [ctx.id, member.id]
    );

    const rows = found.rows.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      avatarUrl: row.avatar_url,
      headline: row.headline,
      points: row.points,
      rank: Number(row.rank),
      badge: row.badge,
      mine: row.member_id === member.id,
    }));

    res.json({
      leaderboard: rows.filter((row) => row.rank <= 20),
      me: rows.find((row) => row.mine) ?? null,
    });
  })
);

/* ----------------------------------------------------------- challenges */

memberCommunityRouter.get(
  "/:slug/challenges",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);

    const found = await pool.query<{
      id: number;
      title: string;
      description: string;
      cover_image: string;
      starts_at: Date | null;
      ends_at: Date | null;
      points: number;
      entry_count: number;
      entry_id: number | null;
      approved: boolean | null;
      proof_url: string | null;
      note: string | null;
      entered_at: Date | null;
    }>(
      `SELECT ch.id, ch.title, ch.description, ch.cover_image, ch.starts_at, ch.ends_at,
              ch.points,
              (SELECT COUNT(*)::int FROM community_challenge_entries e
                WHERE e.challenge_id = ch.id) AS entry_count,
              me.id AS entry_id, me.approved, me.proof_url, me.note,
              me.created_at AS entered_at
         FROM community_challenges ch
         LEFT JOIN community_challenge_entries me
           ON me.challenge_id = ch.id AND me.member_id = $2
        WHERE ch.community_id = $1 AND ch.published
        ORDER BY COALESCE(ch.ends_at, ch.starts_at, ch.created_at) DESC, ch.id DESC`,
      [ctx.id, member.id]
    );

    const now = new Date();
    res.json({
      challenges: found.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        coverImage: row.cover_image,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        points: row.points,
        entryCount: row.entry_count,
        open:
          (row.starts_at === null || row.starts_at <= now) &&
          (row.ends_at === null || row.ends_at >= now),
        myEntry: row.entry_id
          ? {
              id: row.entry_id,
              approved: row.approved ?? false,
              proofUrl: row.proof_url ?? "",
              note: row.note ?? "",
              enteredAt: iso(row.entered_at),
            }
          : null,
      })),
    });
  })
);

/* --------------------------------------------------------------- events */

memberCommunityRouter.get(
  "/:slug/events",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const ctx = await enterFromParams(req);

    const found = await pool.query<{
      id: number;
      title: string;
      description: string;
      starts_at: Date | null;
      duration_minutes: number;
      location_url: string;
      going_count: number;
      my_status: string | null;
      attended: boolean | null;
    }>(
      `SELECT e.id, e.title, e.description, e.starts_at, e.duration_minutes, e.location_url,
              (SELECT COUNT(*)::int FROM community_event_rsvps r
                WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
              me.status AS my_status, me.attended
         FROM community_events e
         LEFT JOIN community_event_rsvps me ON me.event_id = e.id AND me.member_id = $2
        WHERE e.community_id = $1 AND e.published
        ORDER BY e.starts_at NULLS LAST, e.id`,
      [ctx.id, member.id]
    );

    const now = new Date();
    const events = found.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      startsAt: iso(row.starts_at),
      durationMinutes: row.duration_minutes,
      locationUrl: row.location_url,
      goingCount: row.going_count,
      myStatus: row.my_status,
      attended: row.attended ?? false,
      upcoming: row.starts_at === null || row.starts_at >= now,
    }));

    res.json({
      events,
      upcoming: events.filter((e) => e.upcoming),
      past: events.filter((e) => !e.upcoming).reverse(),
    });
  })
);
