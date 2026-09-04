import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, unauthorized } from "../../utils/httpError";
import {
  broadcastPresence,
  emitLiveSignal,
  joinLiveRoom,
  leaveLiveRoom,
  subscribeLiveSignals,
  type LivePeer,
  type LiveSignal,
} from "../../services/liveRoomBus";
import { spendLiveTicket } from "../../services/liveRoomTickets";

/**
 * `/api/community-live/stream` — the live room's signalling stream.
 *
 * Mounted on the public router rather than under `/api/member` for one reason:
 * `EventSource` cannot send an Authorization header, and `requireMember` — which
 * guards everything under `/api/member` — reads one. Rather than teach that
 * middleware to accept a token from a query string, and so put member access
 * tokens into nginx's access log for every route, this single endpoint
 * authenticates with a one-minute single-use ticket minted by
 * `POST /api/member/community/:slug/live/ticket`.
 *
 * "Public" is the mount, not the access: without a valid ticket this returns
 * 401 and does nothing else. The ticket already encodes the entitlement check
 * the minting endpoint performed, which is why there is no second one here.
 */
export const communityLiveStreamRouter = Router();

const HEARTBEAT_MS = 25_000;

const streamSchema = z.object({
  ticket: z.string().trim().min(1).max(200),
  peerId: z.string().trim().min(1).max(80),
});

interface StreamMemberRow {
  name: string;
  avatar_url: string;
  role: string;
}

communityLiveStreamRouter.get(
  "/community-live/stream",
  asyncHandler(async (req, res) => {
    const parsed = streamSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw badRequest("A ticket and peerId are required.");

    // The peer id is passed as well as being inside the ticket so the two can
    // be compared: a ticket only works for the connection it was minted for.
    const spent = spendLiveTicket(parsed.data.ticket, parsed.data.peerId);
    if (!spent) throw unauthorized("That live-room ticket is no longer valid.");

    const { memberId, communityId } = spent;
    const found = await pool.query<StreamMemberRow>(
      `SELECT COALESCE(NULLIF(TRIM(me.first_name || ' ' || me.last_name), ''),
                       NULLIF(me.name, ''),
                       split_part(me.email::text, '@', 1)) AS name,
              COALESCE(me.avatar_url, '') AS avatar_url,
              COALESCE(cm.role, 'member') AS role
         FROM members me
         LEFT JOIN community_memberships cm
                ON cm.community_id = $2 AND cm.member_id = me.id
        WHERE me.id = $1`,
      [memberId, communityId]
    );
    const who = found.rows[0];
    if (!who) throw unauthorized("That live-room ticket is no longer valid.");

    const peerId = parsed.data.peerId;

    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which would hold every
      // signal until a buffer filled and make the room look simply broken.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const me: LivePeer = {
      peerId,
      memberId,
      name: who.name,
      avatarUrl: who.avatar_url,
      role: who.role,
    };

    const unsubscribe = subscribeLiveSignals(communityId, (signal: LiveSignal) => {
      // Presence is the server's and goes to everyone. Everything else drops
      // this connection's own echo and anything addressed to another peer.
      if (signal.kind !== "presence") {
        if (signal.senderId === peerId) return;
        if (signal.to !== "" && signal.to !== peerId) return;
      }
      res.write(`event: signal\ndata: ${JSON.stringify(signal)}\n\n`);
    });

    // Subscribed BEFORE announcing, so this connection receives the very
    // broadcast its arrival causes and learns who was already here. That
    // ordering is the whole reason there is no join handshake to lose a race to.
    const joined = joinLiveRoom(communityId, me);
    broadcastPresence(communityId, joined.roster);
    if (joined.changed) {
      await pool
        .query(
          `INSERT INTO community_live_visits (community_id, member_id, peer_id)
           VALUES ($1, $2, $3)`,
          [communityId, memberId, peerId]
        )
        .catch((error: unknown) => {
          // Worth having, not worth dropping a call for.
          console.error("[communityLive] could not record a join:", (error as Error).message);
        });
    }

    const heartbeat = setInterval(() => {
      // A comment line rather than an event: it stops proxies and mobile radios
      // closing an idle stream, and the client needs no handler for it.
      res.write(": ping\n\n");
    }, HEARTBEAT_MS);

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();

      const left = leaveLiveRoom(communityId, peerId);
      broadcastPresence(communityId, left.roster);
      if (left.changed) {
        // Tell the survivors to tear this leg down. Without it each remaining
        // peer waits for ICE to time out before the tile disappears.
        emitLiveSignal(communityId, {
          kind: "bye",
          senderId: peerId,
          to: "",
          from: { memberId, name: who.name },
          at: new Date().toISOString(),
        });
        void pool
          .query(
            `UPDATE community_live_visits SET left_at = now()
              WHERE community_id = $1 AND peer_id = $2 AND left_at IS NULL`,
            [communityId, peerId]
          )
          .catch((error: unknown) => {
            console.error(
              "[communityLive] could not close a visit:",
              (error as Error).message
            );
          });
      }
      res.end();
    };

    req.on("close", close);
    req.on("aborted", close);
  })
);
