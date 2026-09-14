import { pool } from "../db/pool";
import { CHANNEL_MEMBER_VISIBLE, mayEnterCommunity } from "./access";

/**
 * The member as every authenticated response describes them.
 *
 * One shape, produced in one place: /register, /login, /refresh, /magic-link
 * and /me all hand the browser the same object, so a signed-in tab never has to
 * reconcile two slightly different pictures of who it is.
 */
export interface MemberProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  avatarUrl: string;
  timezone: string;
  locale: string;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  /** Present only while an admin is viewing the site as this member. */
  impersonatedBy?: number;
}

/** Every column `toMemberProfile` reads. Kept here so no caller can under-select. */
export const MEMBER_PROFILE_COLUMNS =
  "id, email, name, first_name, last_name, avatar_url, timezone, locale, status, email_verified_at, created_at";

export interface MemberProfileRow {
  id: number;
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  avatar_url: string;
  timezone: string;
  locale: string;
  status: string;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

/**
 * Mirrors the `members.timezone` column default. Registration needs the value in
 * JS as well as in the DDL, because an omitted timezone has to land on the same
 * zone whether the row is being created or an invited row is being claimed.
 */
export const DEFAULT_TIMEZONE = "America/New_York";

/** pg hands back TIMESTAMPTZ as a Date; the JSON contract is an ISO string. */
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function toMemberProfile(row: MemberProfileRow, impersonatedBy?: number): MemberProfile {
  const split = `${row.first_name} ${row.last_name}`.trim();

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    // `name` predates first_name/last_name and the admin list still reads it, so
    // it stays the display name — used verbatim for the members Yvette typed in
    // by hand, and derived once someone fills in the split fields themselves.
    name: split || row.name,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    locale: row.locale,
    status: row.status,
    emailVerifiedAt: iso(row.email_verified_at),
    createdAt: iso(row.created_at) ?? "",
    ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
  };
}

export async function loadMemberProfile(
  id: number,
  impersonatedBy?: number
): Promise<MemberProfile | null> {
  const result = await pool.query<MemberProfileRow>(
    `SELECT ${MEMBER_PROFILE_COLUMNS} FROM members WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  return row ? toMemberProfile(row, impersonatedBy) : null;
}

/* ------------------------------------------------------- a member in a room */

/**
 * A member as the rest of a community sees them.
 *
 * Kept beside the account profile above because the two answer the same
 * question about the same row for different audiences, and because the id in
 * both is `members.id` — nothing here or in the community API is keyed on
 * `community_memberships.id`, which is a join row and not a person.
 *
 * `joined` is false for somebody entitled to the room who has never joined it,
 * which is the case that made direct messages unreachable: the community
 * profile endpoint resolved people through `community_memberships` alone, while
 * entering the room, posting in it and messaging inside it all go through
 * `mayEnterCommunity` — a free room, or a plan-unlocked one, admits members with
 * no membership row at all. So the profile page every "Message" button hangs off
 * answered "We couldn't find that member" for exactly the people you were
 * allowed to message.
 */
export interface CommunityMemberProfile {
  /** `members.id`. The id the directory, the leaderboard and bylines all send. */
  memberId: number;
  name: string;
  avatarUrl: string;
  headline: string;
  bio: string;
  role: string;
  points: number;
  /** Null when they are entitled to the room but have never joined it. */
  joinedAt: string | null;
  postCount: number;
  commentCount: number;
  /** Whether they hold a `community_memberships` row for this community. */
  joined: boolean;
  badges: {
    id: number;
    name: string;
    emoji: string;
    threshold: number;
    awardedAt: string | null;
  }[];
}

/** The display name, derived exactly as the community's own queries derive it. */
const COMMUNITY_NAME_SQL =
  `COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), NULLIF(m.name, ''), 'Member')`;

interface CommunityProfileRow {
  member_id: number;
  name: string;
  avatar_url: string;
  headline: string;
  bio: string;
  role: string;
  points: number;
  joined_at: Date | null;
  joined: boolean;
  banned: boolean;
  post_count: number;
  comment_count: number;
}

/**
 * Loads one member's community profile, membership row or not.
 *
 * Returns null when there is nobody to show: no such member, a suspended
 * account, somebody banned from this room, or somebody with neither a
 * membership nor the entitlement to enter — a stranger's profile is not public
 * just because the room is free to its own members.
 *
 * The caller is responsible for having already proved that the *reader* may be
 * in the room; this decides only whether the person being looked at belongs
 * there.
 */
export async function loadCommunityMemberProfile(
  communityId: number,
  memberId: number,
  /**
   * Who is looking. Post and reply counts only include channels this reader
   * may open — invite-only and tiered channels are otherwise leaked one number
   * at a time ("12 posts" on a profile whose feed shows three). Moderators see
   * every channel, so they get every count. Omitted means "count everything",
   * which only a caller with no reader (a job, a test) should ask for.
   */
  viewer?: { memberId: number; moderator: boolean }
): Promise<CommunityMemberProfile | null> {
  const scoped = viewer !== undefined && !viewer.moderator;
  const channelGate = scoped
    ? `AND ${CHANNEL_MEMBER_VISIBLE.replaceAll("$MEMBER$", "$3")}`
    : "";
  const found = await pool.query<CommunityProfileRow>(
    `SELECT m.id AS member_id, ${COMMUNITY_NAME_SQL} AS name,
            COALESCE(m.avatar_url, '')  AS avatar_url,
            COALESCE(cm.headline, '')   AS headline,
            COALESCE(cm.bio, '')        AS bio,
            COALESCE(cm.role, 'member') AS role,
            COALESCE(cm.points, 0)      AS points,
            cm.joined_at,
            (cm.id IS NOT NULL)         AS joined,
            (cm.banned_at IS NOT NULL)  AS banned,
            (SELECT COUNT(*)::int FROM community_posts p
               JOIN community_channels ch ON ch.id = p.channel_id
              WHERE ch.community_id = $1 AND p.member_id = m.id
                AND p.status = 'visible' ${channelGate}) AS post_count,
            (SELECT COUNT(*)::int FROM community_comments cc
               JOIN community_posts p     ON p.id  = cc.post_id
               JOIN community_channels ch ON ch.id = p.channel_id
              WHERE ch.community_id = $1 AND cc.member_id = m.id
                AND cc.status = 'visible' ${channelGate}) AS comment_count
       FROM members m
       LEFT JOIN community_memberships cm
              ON cm.member_id = m.id AND cm.community_id = $1
      WHERE m.id = $2 AND m.status = 'active'`,
    scoped ? [communityId, memberId, viewer.memberId] : [communityId, memberId]
  );

  const row = found.rows[0];
  if (!row || row.banned) return null;

  // A membership row is standing, not admission — it is kept on purpose when a
  // refund revokes the grant behind it. So somebody who has joined is shown,
  // and somebody who has not must still be entitled to be in the room.
  if (!row.joined && !(await mayEnterCommunity(memberId, communityId))) return null;

  const badges = await pool.query<{
    id: number;
    name: string;
    emoji: string;
    threshold: number;
    awarded_at: Date | null;
  }>(
    `SELECT b.id, b.name, b.emoji, b.threshold, mb.awarded_at
       FROM member_badges mb
       JOIN community_badges b ON b.id = mb.badge_id
      WHERE mb.member_id = $1 AND b.community_id = $2
      ORDER BY b.threshold`,
    [memberId, communityId]
  );

  return {
    memberId: row.member_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    headline: row.headline,
    bio: row.bio,
    role: row.role,
    points: row.points,
    joinedAt: iso(row.joined_at),
    postCount: row.post_count,
    commentCount: row.comment_count,
    joined: row.joined,
    badges: badges.rows.map((badge) => ({
      id: badge.id,
      name: badge.name,
      emoji: badge.emoji,
      threshold: badge.threshold,
      awardedAt: iso(badge.awarded_at),
    })),
  };
}
