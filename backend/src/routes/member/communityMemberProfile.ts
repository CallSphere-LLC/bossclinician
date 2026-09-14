import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound, unauthorized } from "../../utils/httpError";
import type { AuthedMember } from "../../middleware/memberAuth";
import { mayEnterCommunity } from "../../services/access";
import { loadCommunityMemberProfile } from "../../services/memberProfile";

/**
 * `/api/member/community/:slug/members/:memberId` — one person, as the room sees
 * them.
 *
 * Its own file, mounted ahead of the general community router, because the
 * lookup it replaces was narrower than every other door into the same room. The
 * old handler resolved a profile through `community_memberships` alone; entering
 * a community, posting in it and messaging inside it all resolve through
 * `mayEnterCommunity`. A free room — or one unlocked by a plan — admits members
 * who hold no membership row, so "open somebody's profile from the members list
 * to start a conversation" answered "We couldn't find that member" for exactly
 * the people a member was entitled to message. The one documented route to a
 * direct message did not exist.
 *
 * The id in the path is `members.id`, which is what the directory, the
 * leaderboard, post bylines and the DM routes have always sent. Nothing is keyed
 * on `community_memberships.id`: that is a join row, not a person.
 *
 * `/profiles/:memberId` is the same handler under a name no other router claims,
 * for a client that would rather not depend on which router answers first.
 */
export const memberCommunityProfileRouter = Router();

const PROFILE_MISSING = "We couldn't find that member.";

/** Slugs as tightly as the admin generates them; anything else is a 404. */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const idSchema = z.coerce.number().int().positive().max(2_147_483_647);

interface RoomRow {
  id: number;
  banned_at: Date | null;
  /** The reader's role in this room, which decides which channels they may count. */
  role: string | null;
}

/**
 * The room, proved from the reader's side first.
 *
 * The same walk the DM routes make: the community has to be published, the
 * reader must not be banned from it, and they must be entitled to be inside it.
 * A profile is only visible to somebody who is in the same room.
 */
async function readableRoom(member: AuthedMember, slug: unknown): Promise<RoomRow> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) throw notFound(PROFILE_MISSING);

  const found = await pool.query<RoomRow>(
    `SELECT c.id, cm.banned_at, cm.role
       FROM communities c
       LEFT JOIN community_memberships cm
              ON cm.community_id = c.id AND cm.member_id = $1
      WHERE c.slug = $2 AND c.published = true`,
    [member.id, parsedSlug.data]
  );
  const room = found.rows[0];
  if (!room || room.banned_at !== null) throw notFound(PROFILE_MISSING);
  if (!(await mayEnterCommunity(member.id, room.id))) throw notFound(PROFILE_MISSING);
  return room;
}

const profileHandler = asyncHandler(async (req, res) => {
  const member = req.member;
  if (!member) throw unauthorized("Please sign in to continue");

  const room = await readableRoom(member, req.params.slug);

  const parsedId = idSchema.safeParse(req.params.memberId);
  if (!parsedId.success) throw notFound(PROFILE_MISSING);

  // The reader is passed in so the post and reply counts only cover channels
  // they can open — an invite-only channel must not leak through a number.
  const profile = await loadCommunityMemberProfile(room.id, parsedId.data, {
    memberId: member.id,
    moderator: room.role === "moderator" || room.role === "admin",
  });
  if (!profile) throw notFound(PROFILE_MISSING);

  // `mine` is the reader's own relationship to the row, so it is decided here
  // rather than inside the loader — the same profile is "mine" to one member and
  // somebody else's to the next.
  res.json({ ...profile, mine: profile.memberId === member.id });
});

memberCommunityProfileRouter.get("/:slug/members/:memberId", profileHandler);
memberCommunityProfileRouter.get("/:slug/profiles/:memberId", profileHandler);
