import crypto from "crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { mayEnterCommunity } from "../../services/access";
import { mintLiveTicket } from "../../services/liveRoomTickets";
import {
  broadcastPresence,
  emitLiveSignal,
  joinLiveRoom,
  leaveLiveRoom,
  liveOccupancy,
  liveRoster,
  subscribeLiveSignals,
  type LivePeer,
  type LiveSignal,
} from "../../services/liveRoomBus";

/**
 * `/api/member/community/:slug/live` — the community live room.
 *
 * A WebRTC signalling relay, ported from the telehealth implementation that
 * already runs on this host and widened from a 1:1 visit to an N-way mesh.
 * Three endpoints and nothing else: what the room is, how to reach a relay, and
 * a channel to negotiate over.
 *
 * The media never comes here. Audio and video are peer-to-peer over DTLS-SRTP,
 * relayed by coturn only when NAT leaves no direct path; this server sees SDP
 * and ICE candidates and forwards them, which is why a room of eight costs it
 * almost nothing.
 *
 * Mounted as its own router rather than added to the 2,000-line community file
 * because it is the only part of the community that holds a long-lived
 * connection per reader, and that is worth being able to find.
 */
export const memberCommunityLiveRouter = Router();

const ROOM_SHUT =
  "The live room isn't open at the moment. Yvette opens it when she's there.";
const ROOM_OFF = "This community doesn't have a live room.";
const ROOM_FULL =
  "The room is full right now. Try again in a few minutes — someone usually drops off.";

interface LiveCommunityRow {
  id: number;
  name: string;
  live_room_enabled: boolean;
  live_room_access: string;
  live_room_alias: string;
  live_room_capacity: number;
  role: string;
  banned_at: Date | null;
  /** The reader's own display name and photo, for their tile in the grid. */
  member_name: string;
  member_avatar: string;
}

/**
 * Resolves the room and the reader's standing in it.
 *
 * Deliberately a separate walk from the community router's `enterCommunity`:
 * that one auto-joins a member on first sight, which is right for opening a
 * feed and wrong for a video room — a member who merely loaded the page should
 * not be enrolled by the act of looking, and the SSE endpoint is hit by
 * reconnects far more often than a human opens anything.
 */
async function resolveRoom(
  member: AuthedMember,
  slug: string
): Promise<LiveCommunityRow> {
  const found = await pool.query<LiveCommunityRow>(
    `SELECT c.id, c.name, c.live_room_enabled, c.live_room_access,
            c.live_room_alias, c.live_room_capacity,
            COALESCE(m.role, 'member') AS role, m.banned_at,
            COALESCE(NULLIF(TRIM(me.first_name || ' ' || me.last_name), ''),
                     NULLIF(me.name, ''),
                     split_part(me.email::text, '@', 1)) AS member_name,
            COALESCE(me.avatar_url, '') AS member_avatar
       FROM communities c
       CROSS JOIN members me
       LEFT JOIN community_memberships m
              ON m.community_id = c.id AND m.member_id = me.id
      WHERE c.slug = $2 AND c.published = true AND me.id = $1`,
    [member.id, slug]
  );
  const row = found.rows[0];
  if (!row) throw notFound(ROOM_OFF);
  if (row.banned_at !== null) throw forbidden(ROOM_SHUT);
  if (!(await mayEnterCommunity(member.id, row.id))) throw notFound(ROOM_OFF);
  if (!row.live_room_enabled) throw notFound(ROOM_OFF);
  return row;
}

/** Whether a host is already inside, which is what 'hosted' access turns on. */
function hostPresent(communityId: number): boolean {
  return liveRoster(communityId).some(
    (peer) => peer.role === "host" || peer.role === "owner" || peer.role === "moderator"
  );
}

function isHost(role: string): boolean {
  return role === "host" || role === "owner" || role === "moderator";
}

/** The room's own name, since Yvette calls hers Office Hours. */
function roomLabel(row: LiveCommunityRow): string {
  return row.live_room_alias.trim() || "Live room";
}

/* ------------------------------------------------------------------ status */

/**
 * GET /:slug/live
 *
 * What the page needs before it asks for a camera: is the room open, who is
 * already in it, and is there space. Cheap and pollable — it reads the
 * in-process roster, not the database.
 */
memberCommunityLiveRouter.get(
  "/:slug/live",
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    const room = await resolveRoom(member, req.params.slug);
    const roster = liveRoster(room.id);
    const open = room.live_room_access === "always" || hostPresent(room.id) || isHost(room.role);

    res.json({
      label: roomLabel(room),
      communityName: room.name,
      access: room.live_room_access,
      open,
      // Said plainly, because "the room is closed" with no reason reads as a bug.
      closedReason: open ? "" : ROOM_SHUT,
      capacity: room.live_room_capacity,
      occupancy: roster.length,
      full: roster.length >= room.live_room_capacity,
      youAreHost: isHost(room.role),
      roster: roster.map((peer) => ({
        peerId: peer.peerId,
        memberId: peer.memberId,
        name: peer.name,
        avatarUrl: peer.avatarUrl,
        role: peer.role,
      })),
    });
  })
);

/* --------------------------------------------------------------------- ICE */

const ICE_TTL_SECONDS = 2 * 60 * 60;

/**
 * GET /:slug/live/ice
 *
 * ICE servers, with a TURN credential minted per request.
 *
 * The credential is `<expiry>:<memberId>` HMAC-SHA1'd with the secret coturn
 * runs with — the TURN REST API scheme — so no standing TURN password is ever
 * in a browser, and a leaked credential expires on its own. `turn` in the
 * response says whether a relay is actually configured: without one the room
 * still works on host and STUN candidates and fails only behind symmetric NAT,
 * and the client says so rather than presenting a mystery connection failure.
 */
memberCommunityLiveRouter.get(
  "/:slug/live/ice",
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    await resolveRoom(member, req.params.slug);

    const iceServers: RTCIceServerConfig[] = [];
    const { host, port, staticAuthSecret, stunFallback } = env.turn;

    if (host) iceServers.push({ urls: [`stun:${host}:${port}`] });
    else if (stunFallback) iceServers.push({ urls: [stunFallback] });

    let turn = false;
    if (host && staticAuthSecret) {
      const username = `${Math.floor(Date.now() / 1000) + ICE_TTL_SECONDS}:${member.id}`;
      const credential = crypto
        .createHmac("sha1", staticAuthSecret)
        .update(username)
        .digest("base64");
      iceServers.push({
        urls: [
          `turn:${host}:${port}?transport=udp`,
          `turn:${host}:${port}?transport=tcp`,
        ],
        username,
        credential,
      });
      turn = true;
    }

    res.set("Cache-Control", "no-store");
    res.json({ iceServers, turn, ttlSeconds: ICE_TTL_SECONDS });
  })
);

interface RTCIceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/* --------------------------------------------------------------- signalling */

const HEARTBEAT_MS = 25_000;

/**
 * Binds a client-chosen connection id to the session.
 *
 * Without this a member could subscribe or publish as somebody else's peer id
 * and inject SDP into a negotiation they are not part of. The same derivation
 * runs on both endpoints, so a client's own echo filtering keeps working.
 */
function bindPeerId(member: AuthedMember, raw: string): string {
  return `${member.id}:${raw}`;
}

const peerIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/**
 * POST /:slug/live/ticket
 *
 * Mints the one-minute, single-use ticket the signalling stream authenticates
 * with. This endpoint is bearer-authenticated like everything else here; the
 * stream itself lives outside the member router precisely because it cannot
 * carry a header, and this is the hand-off between the two.
 */
memberCommunityLiveRouter.post(
  "/:slug/live/ticket",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    const room = await resolveRoom(member, req.params.slug);

    const parsedPeer = peerIdSchema.safeParse((req.body ?? {}).peerId ?? "");
    if (!parsedPeer.success) throw badRequest("A peerId is required.");

    if (room.live_room_access === "hosted" && !isHost(room.role) && !hostPresent(room.id)) {
      throw forbidden(ROOM_SHUT);
    }

    const peerId = bindPeerId(member, parsedPeer.data);
    const alreadyHere = liveRoster(room.id).some((peer) => peer.peerId === peerId);
    if (!alreadyHere && liveOccupancy(room.id) >= room.live_room_capacity) {
      throw forbidden(ROOM_FULL);
    }

    res.json({
      ...mintLiveTicket({ memberId: member.id, communityId: room.id, peerId }),
      // The client needs these to build its own tile and decide politeness
      // before the first roster broadcast arrives.
      peerId,
      name: room.member_name,
      avatarUrl: room.member_avatar,
      role: room.role,
    });
  })
);

/**
 * Publishable signals. `presence` is absent on purpose — the roster is the
 * server's to state, and accepting one here would let a peer invent the room.
 */
const publishSchema = z.object({
  kind: z.enum(["desc", "candidate", "bye", "chat", "net"]),
  senderId: peerIdSchema,
  /** Empty for a room-wide signal; a peer id for one leg of the mesh. */
  to: z.string().trim().max(80).default(""),
  payload: z.unknown().optional(),
});

/**
 * A busy negotiation trickles a candidate at a time, so this has to be generous
 * — four peers joining at once is a few hundred posts in a few seconds — while
 * still bounded, since each one fans out to every subscriber.
 */
const signalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

/** SDP offers run 10–40KB; anything larger is not a negotiation blob. */
const MAX_SIGNAL_BYTES = 128 * 1024;

/**
 * POST /:slug/live/signal
 *
 * Publishes one signal. `denyImpersonation`, because an admin watching through
 * "view as member" should not be able to appear in a video room as the customer.
 */
memberCommunityLiveRouter.post(
  "/:slug/live/signal",
  denyImpersonation,
  signalLimiter,
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;
    const room = await resolveRoom(member, req.params.slug);

    const parsed = publishSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("That isn't a signal we can relay.");
    const { kind, senderId, to, payload } = parsed.data;

    if (JSON.stringify(payload ?? "").length > MAX_SIGNAL_BYTES) {
      throw badRequest("That signal is too large to relay.");
    }

    const peerId = bindPeerId(member, senderId);
    // Only a peer holding a live connection may publish. A stale tab that lost
    // its stream would otherwise keep answering offers nobody can reach.
    if (!liveRoster(room.id).some((peer) => peer.peerId === peerId)) {
      throw forbidden("You're not in the room.");
    }

    emitLiveSignal(room.id, {
      kind,
      senderId: peerId,
      to,
      from: { memberId: member.id, name: room.member_name },
      payload,
      at: new Date().toISOString(),
    });

    res.json({ ok: true });
  })
);
