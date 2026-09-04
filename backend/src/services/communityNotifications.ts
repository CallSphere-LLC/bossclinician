import type { PoolClient } from "pg";
import { pool } from "../db/pool";

/**
 * The side-effects a community action has on people other than the actor: the
 * notification it raises, and the points and badges it earns.
 *
 * Both live here rather than in the route handlers because both have to be
 * decided the same way everywhere. A "someone replied to you" notification
 * written in one shape by the comment route and another by the mention parser
 * gives the member two different-looking rows for the same event, and points
 * awarded inline drift the moment a second handler awards them differently.
 *
 * Every function takes an optional `client` so it can run inside the caller's
 * transaction. A comment that exists but never notified its author, or that
 * awarded points to a member whose row rolled back, is worse than no comment.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

/** The kinds the member UI knows how to render. */
export const NOTIFICATION_KINDS = {
  postComment: "community_post_comment",
  commentReply: "community_comment_reply",
  mention: "community_mention",
  badge: "community_badge",
  directMessage: "community_direct_message",
} as const;

/**
 * Notification text is member-authored, and gets read in a list rather than in
 * a page. Flattened to one line and cut to a length the list can hold.
 */
function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface NotifyInput {
  memberId: number;
  kind: string;
  title: string;
  body?: string;
  link?: string;
  /** Who caused it. Used to suppress self-notification and to show an avatar. */
  actorId?: number | null;
  client?: Queryable;
}

/**
 * Writes one notification, unless the recipient is the person who caused it.
 *
 * The self-check is here rather than at each call site because there is no call
 * site where notifying yourself is wanted: commenting on your own post, replying
 * to your own comment and @-mentioning yourself all reach this function through
 * different paths, and each one would otherwise need to remember.
 */
export async function notify(input: NotifyInput): Promise<number | null> {
  if (input.actorId != null && input.actorId === input.memberId) return null;

  const db = input.client ?? pool;
  const res = await db.query<{ id: number }>(
    `INSERT INTO member_notifications (member_id, kind, title, body, link, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.memberId,
      input.kind,
      clip(input.title, 200),
      clip(input.body ?? "", 500),
      (input.link ?? "").slice(0, 500),
      input.actorId ?? null,
    ]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * `@name` as people actually type it: no spaces, so "@jane" and "@janesmith"
 * both work but "@Jane Smith" is read as "@Jane". Bounded length so a wall of
 * text cannot turn into a wall of lookups.
 */
const MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9._-]{1,39})/g;

/** Most mentions one post is allowed to raise. Past this it is a broadcast. */
const MAX_MENTIONS = 10;

/** Compares names the way people type them: letters and digits, no case. */
function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface NotifyMentionsInput {
  text: string;
  communityId: number;
  /** The author. Never notified, however they spell their own name. */
  actorId: number;
  actorName: string;
  link: string;
  /** Where the mention happened, for the notification body. */
  context?: string;
  client?: Queryable;
}

/**
 * Notifies the members named in a piece of text.
 *
 * Resolution is deliberately confined to the community the text was written in:
 * an @-mention is how you reach someone in a room you are both in, not a way to
 * probe whether a given name has an account on the platform. Names are matched
 * after stripping punctuation and case from both sides, so "@drjane" finds
 * "Dr. Jane" without the member having to know how their profile is spelled.
 */
export async function notifyMentions(input: NotifyMentionsInput): Promise<number[]> {
  const tokens = new Set<string>();
  for (const match of input.text.matchAll(MENTION_PATTERN)) {
    const token = normaliseName(match[1]);
    if (token.length >= 2) tokens.add(token);
    if (tokens.size >= MAX_MENTIONS) break;
  }
  if (tokens.size === 0) return [];

  const db = input.client ?? pool;
  const found = await db.query<{ member_id: number }>(
    `SELECT cm.member_id
       FROM community_memberships cm
       JOIN members m ON m.id = cm.member_id
      WHERE cm.community_id = $1
        AND cm.member_id <> $2
        AND cm.banned_at IS NULL
        AND m.status = 'active'
        AND (
          lower(regexp_replace(
            COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), m.name, ''),
            '[^A-Za-z0-9]', '', 'g')) = ANY($3::text[])
          OR lower(regexp_replace(m.first_name, '[^A-Za-z0-9]', '', 'g')) = ANY($3::text[])
        )
      LIMIT $4`,
    [input.communityId, input.actorId, [...tokens], MAX_MENTIONS]
  );

  const notified: number[] = [];
  for (const row of found.rows) {
    const id = await notify({
      memberId: row.member_id,
      kind: NOTIFICATION_KINDS.mention,
      title: `${input.actorName} mentioned you${input.context ? ` in ${input.context}` : ""}`,
      body: input.text,
      link: input.link,
      actorId: input.actorId,
      client: input.client,
    });
    if (id !== null) notified.push(id);
  }
  return notified;
}

/* ---------------------------------------------------------------- points */

export type PointAction = "post" | "comment" | "challenge_approved";

interface PointRule {
  /** Default award. `challenge_approved` overrides it with the challenge's own. */
  points: number;
  /** Most awards of this kind that count in a rolling day. null = uncapped. */
  dailyCap: number | null;
  /**
   * Counts what the member has already done today, the new row included, so the
   * cap can be applied without a separate ledger table. $1 = community,
   * $2 = member.
   */
  countSql: string | null;
}

/**
 * Every rule about what earns points, in one table.
 *
 * The caps are what stops the leaderboard measuring stamina rather than
 * contribution: without them, five points a post makes badges a matter of
 * posting "thanks!" forty times in an evening. They are counted from the rows
 * the member actually created rather than from a ledger, so they stay honest
 * even if a handler forgets to call this.
 */
const POINT_RULES: Record<PointAction, PointRule> = {
  post: {
    points: 5,
    dailyCap: 5,
    countSql: `SELECT COUNT(*)::int AS n
                 FROM community_posts p
                 JOIN community_channels ch ON ch.id = p.channel_id
                WHERE ch.community_id = $1 AND p.member_id = $2
                  AND p.created_at > now() - interval '24 hours'`,
  },
  comment: {
    points: 2,
    dailyCap: 10,
    countSql: `SELECT COUNT(*)::int AS n
                 FROM community_comments c
                 JOIN community_posts p    ON p.id  = c.post_id
                 JOIN community_channels ch ON ch.id = p.channel_id
                WHERE ch.community_id = $1 AND c.member_id = $2
                  AND c.created_at > now() - interval '24 hours'`,
  },
  challenge_approved: { points: 0, dailyCap: null, countSql: null },
};

export interface AwardPointsInput {
  communityId: number;
  memberId: number;
  action: PointAction;
  /** Overrides the rule's default — a challenge carries its own point value. */
  amount?: number;
  /** Where a badge notification should send them. */
  link?: string;
  client?: Queryable;
}

export interface AwardedBadge {
  id: number;
  name: string;
  emoji: string;
  threshold: number;
}

export interface AwardPointsResult {
  awarded: number;
  points: number;
  badges: AwardedBadge[];
}

/**
 * Adds points to a membership and hands over any badge the new total crosses.
 *
 * The badge insert is one statement against `community_badges` rather than a
 * comparison in JS: a member who crosses three thresholds at once (points edited
 * upward in the admin, a large challenge award) earns all three, and re-running
 * it is a no-op because of the UNIQUE on (member_id, badge_id). A banned member
 * earns nothing — their row is still there, and it should not keep climbing.
 */
export async function awardPoints(input: AwardPointsInput): Promise<AwardPointsResult> {
  const rule = POINT_RULES[input.action];
  const amount = Math.trunc(input.amount ?? rule.points);
  const empty: AwardPointsResult = { awarded: 0, points: 0, badges: [] };
  if (amount <= 0) return empty;

  const db = input.client ?? pool;

  if (rule.countSql !== null && rule.dailyCap !== null) {
    const counted = await db.query<{ n: number }>(rule.countSql, [
      input.communityId,
      input.memberId,
    ]);
    if ((counted.rows[0]?.n ?? 0) > rule.dailyCap) return empty;
  }

  const updated = await db.query<{ points: number }>(
    `UPDATE community_memberships
        SET points = points + $3
      WHERE community_id = $1 AND member_id = $2 AND banned_at IS NULL
      RETURNING points`,
    [input.communityId, input.memberId, amount]
  );
  const points = updated.rows[0]?.points;
  if (points === undefined) return empty;

  const earned = await db.query<{ id: number; name: string; emoji: string; threshold: number }>(
    `WITH awarded AS (
       INSERT INTO member_badges (member_id, badge_id)
       SELECT $1, b.id
         FROM community_badges b
        WHERE b.community_id = $2 AND b.threshold <= $3
       ON CONFLICT (member_id, badge_id) DO NOTHING
       RETURNING badge_id
     )
     SELECT b.id, b.name, b.emoji, b.threshold
       FROM awarded a
       JOIN community_badges b ON b.id = a.badge_id
      ORDER BY b.threshold`,
    [input.memberId, input.communityId, points]
  );

  for (const badge of earned.rows) {
    await notify({
      memberId: input.memberId,
      kind: NOTIFICATION_KINDS.badge,
      title: `${badge.emoji} You earned the ${badge.name} badge`,
      body: `That's ${points} points in the community. Nicely done.`,
      link: input.link ?? "",
      client: input.client,
    });
  }

  return { awarded: amount, points, badges: earned.rows };
}
