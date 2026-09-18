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
  type PresenceChange,
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

/**
 * How long a peer's place in the room is held after its stream drops without a
 * goodbye.
 *
 * Media is peer-to-peer, so a signalling stream that dies for two seconds in a
 * lift has not interrupted anybody's audio. Announcing the departure at once
 * made every other browser tear down a leg that was still carrying sound, and
 * then build it again from nothing when the stream came back. Eight seconds
 * covers the client's first few backoff attempts and is still short enough that
 * somebody who really did lose their connection is not a frozen tile for long.
 */
export const LEAVE_GRACE_MS = 8_000;

/**
 * What a stream closed by a deploy tells its client to wait before returning.
 * Long enough for the replacement process to be listening, short enough that
 * nobody in the call notices the signalling was ever away.
 */
export const SHUTDOWN_RETRY_MS = 1_500;

const streamSchema = z.object({
  ticket: z.string().trim().min(1).max(200),
  peerId: z.string().trim().min(1).max(80),
});

interface StreamMemberRow {
  name: string;
  avatar_url: string;
  role: string;
}

/**
 * The two things the stream does to a response. Narrowed from Express's type so
 * the room logic below can be driven by a test without a socket.
 */
export interface LiveStreamSink {
  write(chunk: string): unknown;
  end(): unknown;
}

export interface OpenedLiveStream {
  /** Whether this was a real arrival, which is what decides a visit row. */
  joined: PresenceChange;
  /** For the socket closing under the stream. Safe to call more than once. */
  close: () => void;
}

interface OpenStream {
  shutdown(): void;
}

interface HeldPlace {
  release(announce: boolean): void;
}

/** Every stream currently open, so a shutdown can end them rather than wait. */
const openStreams = new Set<OpenStream>();

/** Places being kept for peers whose stream dropped and who may yet return. */
const heldPlaces = new Set<HeldPlace>();

/**
 * A peer saying it is leaving the room, as opposed to closing one leg of the
 * mesh: room-wide, and in its own name. `POST /:slug/live/signal` binds
 * `senderId` to the authenticated member, so nobody can say this for another.
 */
function isGoodbyeFrom(signal: LiveSignal, peerId: string): boolean {
  return signal.kind === "bye" && signal.senderId === peerId && signal.to === "";
}

/**
 * Drops one connection's hold on the room and, if that was the peer's last,
 * tells the survivors — unless `announce` is false, which is a shutdown: the
 * room is about to stop existing and there is nobody worth telling.
 *
 * Nothing at all is emitted when the peer is still here through another
 * connection. That is the case the grace period exists to produce: the browser
 * got back in, and as far as everyone else is concerned it never left.
 */
function departLiveRoom(communityId: number, me: LivePeer, announce: boolean): void {
  const left = leaveLiveRoom(communityId, me.peerId);
  if (!left.changed) return;

  if (announce) {
    broadcastPresence(communityId, left.roster);
    // Tell the survivors to tear this leg down. Without it each remaining
    // peer waits for ICE to time out before the tile disappears.
    emitLiveSignal(communityId, {
      kind: "bye",
      senderId: me.peerId,
      to: "",
      from: { memberId: me.memberId, name: me.name },
      at: new Date().toISOString(),
    });
  }

  // Closed on a shutdown too. The client will reconnect to a process with an
  // empty room, which records a fresh visit; leaving this one open would count
  // the member as present for ever.
  void pool
    .query(
      `UPDATE community_live_visits SET left_at = now()
        WHERE community_id = $1 AND peer_id = $2 AND left_at IS NULL`,
      [communityId, me.peerId]
    )
    .catch((error: unknown) => {
      console.error("[communityLive] could not close a visit:", (error as Error).message);
    });
}

/**
 * Keeps a dropped peer on the roster for `LEAVE_GRACE_MS`.
 *
 * The connection's reference in `liveRoomBus` is simply not given back yet. If
 * the same peer id opens a new stream inside the window, the count goes to two,
 * and the release below takes it back to one and says nothing.
 *
 * The hold also listens for the peer's own goodbye, for two reasons. The client
 * closes its stream and THEN posts `bye`, so on a deliberate leave the goodbye
 * usually arrives after the close rather than before it. And a peer that
 * dropped, came back and then left on purpose would otherwise have its
 * departure swallowed by the reference this hold still owns, and announced
 * seconds late when the timer ran out.
 */
function holdPlace(communityId: number, me: LivePeer): void {
  let settled = false;
  const held: HeldPlace = { release: () => undefined };

  const timer = setTimeout(() => held.release(true), LEAVE_GRACE_MS);
  // A held place must never be the reason the process is still running.
  timer.unref();
  const stopListening = subscribeLiveSignals(communityId, (signal: LiveSignal) => {
    if (isGoodbyeFrom(signal, me.peerId)) held.release(true);
  });

  held.release = (announce: boolean): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    stopListening();
    heldPlaces.delete(held);
    departLiveRoom(communityId, me, announce);
  };
  heldPlaces.add(held);
}

/**
 * Puts a connection into the room and returns the handle that takes it out.
 *
 * Separate from the route so that what happens when a stream ends — the part
 * with the timing in it — can be tested without a socket or a ticket.
 */
export function openLiveStream(
  communityId: number,
  me: LivePeer,
  sink: LiveStreamSink
): OpenedLiveStream {
  const peerId = me.peerId;
  let saidGoodbye = false;

  const unsubscribe = subscribeLiveSignals(communityId, (signal: LiveSignal) => {
    // Presence is the server's and goes to everyone. Everything else drops
    // this connection's own echo and anything addressed to another peer.
    if (signal.kind !== "presence") {
      if (signal.senderId === peerId) {
        // The echo is never relayed, but it is how this connection learns that
        // the close which follows is a departure and not a dropped network.
        if (isGoodbyeFrom(signal, peerId)) saidGoodbye = true;
        return;
      }
      if (signal.to !== "" && signal.to !== peerId) return;
    }
    sink.write(`event: signal\ndata: ${JSON.stringify(signal)}\n\n`);
  });

  // Subscribed BEFORE announcing, so this connection receives the very
  // broadcast its arrival causes and learns who was already here. That
  // ordering is the whole reason there is no join handshake to lose a race to.
  const joined = joinLiveRoom(communityId, me);
  broadcastPresence(communityId, joined.roster);

  const heartbeat = setInterval(() => {
    // The comment line stops proxies and mobile radios closing an idle stream.
    // `EventSource` never shows a comment to the page, though, so on its own
    // the client cannot tell a dead stream from a quiet room. The named event
    // is the beat it can count, and reconnect when one goes missing.
    sink.write(": ping\n\n");
    sink.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let closed = false;
  const open: OpenStream = { shutdown: () => undefined };
  openStreams.add(open);

  /** Stops this connection hearing or saying anything. False if already done. */
  const detach = (): boolean => {
    if (closed) return false;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    openStreams.delete(open);
    return true;
  };

  open.shutdown = (): void => {
    // Detached BEFORE the response is ended: ending it closes the request,
    // which calls `close` below, which must find there is nothing left to do
    // rather than start a grace period in a process that is exiting.
    if (!detach()) return;
    try {
      sink.write(
        `event: shutdown\ndata: ${JSON.stringify({ retryInMs: SHUTDOWN_RETRY_MS })}\n\n`
      );
      sink.end();
    } catch {
      // One socket that is already gone must not stop the rest being closed.
    }
    departLiveRoom(communityId, me, false);
  };

  const close = (): void => {
    if (!detach()) return;
    sink.end();
    if (saidGoodbye) {
      departLiveRoom(communityId, me, true);
      return;
    }
    holdPlace(communityId, me);
  };

  return { joined, close };
}

/**
 * Ends every open stream, for a process that has been told to stop.
 *
 * `server.close()` waits for connections to finish and these never do, so
 * without this every deploy sat out the full hard-exit timeout and clients
 * learned of it only when the socket died. Each stream is told to come back
 * shortly instead. Nothing is announced to the room: the survivors' media is
 * peer-to-peer and carries on, and a `bye` here would have every browser tear
 * down legs it is about to need again. Returns how many streams were closed.
 */
export function closeAllLiveStreams(): number {
  const closing = [...openStreams];
  for (const stream of closing) stream.shutdown();
  // Held places go too, silently: a grace timer firing between here and exit
  // would announce a departure to a room that is itself departing.
  for (const held of [...heldPlaces]) held.release(false);
  return closing.length;
}

/** Test seam: the module holds process-wide state that must not leak between suites. */
export function __resetLiveStreams(): void {
  for (const stream of [...openStreams]) stream.shutdown();
  for (const held of [...heldPlaces]) held.release(false);
  openStreams.clear();
  heldPlaces.clear();
}

/** How many streams are open and how many places are held. For tests and logs. */
export function liveStreamCounts(): { open: number; held: number } {
  return { open: openStreams.size, held: heldPlaces.size };
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

    const stream = openLiveStream(communityId, me, res);
    // Wired before the insert below is awaited. A browser that gave up during
    // that query would otherwise close with nobody listening, and keep a place
    // in the room for the life of the process.
    req.on("close", stream.close);
    req.on("aborted", stream.close);

    if (stream.joined.changed) {
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
  })
);
