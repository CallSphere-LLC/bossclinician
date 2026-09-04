import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { plainText } from "../../utils/plainText";
import {
  denyImpersonation,
  requireVerifiedEmail,
  type AuthedMember,
} from "../../middleware/memberAuth";
import { mayEnterCommunity } from "../../services/access";
import { NOTIFICATION_KINDS, notify } from "../../services/communityNotifications";

/**
 * `/api/member/community/:slug/dm` — direct messages between members.
 *
 * Section 2.8 of the brief implies these rather than asking for them: the
 * community email-notification matrix it quotes has a "Direct message" toggle,
 * and a notification for a feature that does not exist is a promise the product
 * cannot keep.
 *
 * Scoped to a community on purpose. A DM is not a site-wide inbox — it is a
 * conversation between two people who are in the same room, and scoping it
 * means losing access to the room ends the ability to write into it. That also
 * keeps the blast radius of a paid community small: nobody can message their
 * way out of it.
 *
 * Threads are keyed by an ORDERED pair, so two people opening a conversation
 * with each other at the same moment cannot create two threads and each see
 * half the messages.
 */
export const memberCommunityDmRouter = Router();

const THREAD_MISSING = "We couldn't find that conversation.";
const NOT_IN_ROOM = "You both need to be in this community to message each other.";

interface RoomRow {
  id: number;
  slug: string;
  name: string;
  banned_at: Date | null;
}

/** The same walk the rest of the community does: prove the room, then read it. */
async function room(member: AuthedMember, slug: string): Promise<RoomRow> {
  const found = await pool.query<RoomRow>(
    `SELECT c.id, c.slug, c.name, cm.banned_at
       FROM communities c
       LEFT JOIN community_memberships cm
              ON cm.community_id = c.id AND cm.member_id = $1
      WHERE c.slug = $2 AND c.published = true`,
    [member.id, slug]
  );
  const row = found.rows[0];
  if (!row) throw notFound(THREAD_MISSING);
  if (row.banned_at !== null) throw forbidden(NOT_IN_ROOM);
  if (!(await mayEnterCommunity(member.id, row.id))) throw notFound(THREAD_MISSING);
  return row;
}

/** Ordered so (3,7) and (7,3) are the same thread. */
function pair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

const messageLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

/* ----------------------------------------------------------------- threads */

/**
 * GET /:slug/dm
 *
 * Every conversation this member is part of, newest activity first, each with
 * the other person and how many of their messages are unread.
 */
memberCommunityDmRouter.get(
  "/:slug/dm",
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    const community = await room(member, req.params.slug);

    const rows = await pool.query<{
      id: string;
      other_id: number;
      other_name: string;
      other_avatar: string;
      last_message_at: Date | null;
      last_body: string | null;
      unread: number;
    }>(
      `SELECT t.id::text,
              other.id AS other_id,
              COALESCE(NULLIF(TRIM(other.first_name || ' ' || other.last_name), ''),
                       NULLIF(other.name, ''), split_part(other.email::text, '@', 1)) AS other_name,
              COALESCE(other.avatar_url, '') AS other_avatar,
              t.last_message_at,
              (SELECT m.body FROM community_dm_messages m
                WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT COUNT(*)::int FROM community_dm_messages m
                WHERE m.thread_id = t.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
         FROM community_dm_threads t
         JOIN members other
              ON other.id = CASE WHEN t.member_a_id = $1 THEN t.member_b_id ELSE t.member_a_id END
        WHERE t.community_id = $2
          AND ($1 IN (t.member_a_id, t.member_b_id))
          -- A thread with nothing in it is a draft, not a conversation.
          AND t.last_message_at IS NOT NULL
        ORDER BY t.last_message_at DESC
        LIMIT 100`,
      [member.id, community.id]
    );

    res.json({
      threads: rows.rows.map((r) => ({
        id: Number(r.id),
        otherMemberId: r.other_id,
        otherName: r.other_name,
        otherAvatarUrl: r.other_avatar,
        lastMessageAt: r.last_message_at?.toISOString() ?? null,
        preview: (r.last_body ?? "").slice(0, 140),
        unread: r.unread,
      })),
      unreadTotal: rows.rows.reduce((sum, r) => sum + r.unread, 0),
    });
  })
);

/* ---------------------------------------------------------------- messages */

/**
 * Finds or creates the thread between this member and another.
 *
 * `ON CONFLICT DO NOTHING` then re-read, rather than trusting RETURNING: the
 * conflict branch returns no row, and two tabs opening the same conversation
 * both land here.
 */
async function threadWith(
  communityId: number,
  me: number,
  them: number
): Promise<number> {
  const [a, b] = pair(me, them);
  await pool.query(
    `INSERT INTO community_dm_threads (community_id, member_a_id, member_b_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (community_id, member_a_id, member_b_id) DO NOTHING`,
    [communityId, a, b]
  );
  const found = await pool.query<{ id: string }>(
    `SELECT id::text FROM community_dm_threads
      WHERE community_id = $1 AND member_a_id = $2 AND member_b_id = $3`,
    [communityId, a, b]
  );
  return Number(found.rows[0].id);
}

/** Both sides must still be entitled, checked at read and at write. */
async function assertBothInRoom(communityId: number, other: number): Promise<void> {
  const banned = await pool.query(
    `SELECT 1 FROM community_memberships
      WHERE community_id = $1 AND member_id = $2 AND banned_at IS NOT NULL`,
    [communityId, other]
  );
  if ((banned.rowCount ?? 0) > 0) throw forbidden(NOT_IN_ROOM);
  if (!(await mayEnterCommunity(other, communityId))) throw forbidden(NOT_IN_ROOM);
}

/**
 * GET /:slug/dm/:memberId
 *
 * The conversation with one person. Reading it marks their messages read —
 * this is the only place they are shown, so a separate "mark read" call would
 * only ever be made from here anyway.
 */
memberCommunityDmRouter.get(
  "/:slug/dm/:memberId",
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    const community = await room(member, req.params.slug);
    const other = Number(req.params.memberId);
    if (!Number.isInteger(other) || other < 1) throw notFound(THREAD_MISSING);
    if (other === member.id) throw badRequest("You can't message yourself.");
    await assertBothInRoom(community.id, other);

    const threadId = await threadWith(community.id, member.id, other);

    const messages = await pool.query<{
      id: string;
      sender_id: number;
      body: string;
      created_at: Date;
    }>(
      `SELECT id::text, sender_id, body, created_at
         FROM community_dm_messages
        WHERE thread_id = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [threadId]
    );

    // Only the other side's, and only unread ones, so the update touches
    // nothing on a re-read of an already-open conversation.
    await pool.query(
      `UPDATE community_dm_messages
          SET read_at = now()
        WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [threadId, member.id]
    );

    const who = await pool.query<{ name: string; avatar_url: string }>(
      `SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''),
                       NULLIF(name, ''), split_part(email::text, '@', 1)) AS name,
              COALESCE(avatar_url, '') AS avatar_url
         FROM members WHERE id = $1`,
      [other]
    );

    res.json({
      threadId,
      other: {
        memberId: other,
        name: who.rows[0]?.name ?? "",
        avatarUrl: who.rows[0]?.avatar_url ?? "",
      },
      // Oldest first for reading, having been fetched newest-first for the limit.
      messages: messages.rows.reverse().map((m) => ({
        id: Number(m.id),
        mine: m.sender_id === member.id,
        body: m.body,
        at: m.created_at.toISOString(),
      })),
    });
  })
);

const sendSchema = z.object({ body: z.string().trim().min(1).max(4000) });

/**
 * POST /:slug/dm/:memberId
 *
 * `requireVerifiedEmail` for the same reason posting needs it: this arrives
 * under a name, in somebody's private conversation, and an unverified address
 * is a name nobody has proved belongs to them.
 */
memberCommunityDmRouter.post(
  "/:slug/dm/:memberId",
  denyImpersonation,
  requireVerifiedEmail,
  messageLimiter,
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    const community = await room(member, req.params.slug);
    const other = Number(req.params.memberId);
    if (!Number.isInteger(other) || other < 1) throw notFound(THREAD_MISSING);
    if (other === member.id) throw badRequest("You can't message yourself.");
    await assertBothInRoom(community.id, other);

    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Please write a message first.");
    // Stripped on the way in rather than escaped on the way out, like every
    // other member-written field here: storing markup makes every future
    // renderer a place this can go wrong.
    const body = plainText(parsed.data.body);
    if (body.trim() === "") throw badRequest("Please write a message first.");

    const threadId = await threadWith(community.id, member.id, other);

    const inserted = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO community_dm_messages (thread_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id::text, created_at`,
      [threadId, member.id, body]
    );
    await pool.query(
      `UPDATE community_dm_threads SET last_message_at = now() WHERE id = $1`,
      [threadId]
    );

    const senderName = await pool.query<{ name: string }>(
      `SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''),
                       NULLIF(name, ''), split_part(email::text, '@', 1)) AS name
         FROM members WHERE id = $1`,
      [member.id]
    );

    await notify({
      memberId: other,
      kind: NOTIFICATION_KINDS.directMessage,
      actorId: member.id,
      title: `${senderName.rows[0]?.name ?? "Someone"} messaged you`,
      body,
      link: `/community/${community.slug}/messages/${member.id}`,
    });

    res.status(201).json({
      id: Number(inserted.rows[0].id),
      mine: true,
      body,
      at: inserted.rows[0].created_at.toISOString(),
    });
  })
);
