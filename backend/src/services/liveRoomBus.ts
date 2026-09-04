import { EventEmitter } from "events";

/**
 * WebRTC signalling bus for the community live room.
 *
 * Ported from the CallSphere Health telehealth bus
 * (`apps/web-react/src/server/features/telehealth/bus.ts`), which this server
 * already runs alongside, and generalised from a 1:1 visit to an N-way room.
 * The parts worth keeping were kept verbatim in spirit:
 *
 *   - Presence is SERVER-authoritative. The roster is derived from live SSE
 *     connections, never from a client-sent "I'm here" ping, so it cannot be
 *     lost to a join-before-subscribe race. Clients may not publish presence.
 *   - Each member is ref-counted, because an auto-reconnecting `EventSource`
 *     holds two overlapping connections for a moment and a naive count would
 *     show a phantom leaver.
 *   - Media never touches this server. Only SDP and ICE transit here; audio and
 *     video are peer-to-peer over DTLS-SRTP, relayed by coturn only when NAT
 *     demands it.
 *
 * The one structural change is addressing. A 1:1 call can broadcast every
 * signal and let each side drop its own echo. A mesh cannot: with four people
 * there are six independent negotiations, and an offer meant for one peer would
 * be answered by all of them. So `to` is carried and honoured — negotiation is
 * point-to-point, while presence, chat and departure stay room-wide.
 *
 * Single-replica constraint, inherited and still true here: this is an
 * in-process EventEmitter and map, correct only because compose runs one
 * backend. Scaling out needs a shared broker and presence store. The backend is
 * the only writer of `rooms`, so there is no lock to take.
 */

export type LiveSignalKind =
  | "presence" // server-authoritative roster
  | "desc" // SDP offer or answer (perfect negotiation, per pair)
  | "candidate" // trickled ICE candidate
  | "bye" // peer left; survivors tear down just that leg
  | "chat" // in-room text
  | "net"; // sender's own measured quality

export interface LivePeer {
  /** Session-bound connection id. Unique per browser tab. */
  peerId: string;
  memberId: number;
  name: string;
  avatarUrl: string;
  /** Community role, so the host is badged in the tile grid. */
  role: string;
}

export interface LiveSignal {
  kind: LiveSignalKind;
  /** Sender's peer id, or "server" for presence. */
  senderId: string;
  /** Target peer id. Empty means the whole room. */
  to: string;
  from: { memberId: number; name: string };
  payload?: unknown;
  at: string;
}

interface RoomMember extends LivePeer {
  /** Overlapping SSE connections for the same tab. */
  refs: number;
}

const bus = new EventEmitter();
// One listener per connected browser; the default ceiling of 10 would warn.
bus.setMaxListeners(0);

/** roomKey -> peerId -> member */
const rooms = new Map<string, Map<string, RoomMember>>();

function roomKey(communityId: number): string {
  return `community-live:${communityId}`;
}

export interface PresenceChange {
  /** Everyone currently holding a live signalling connection. */
  roster: LivePeer[];
  /** False when this was an overlapping reconnect rather than a real arrival. */
  changed: boolean;
}

function rosterOf(room: Map<string, RoomMember> | undefined): LivePeer[] {
  if (!room) return [];
  return [...room.values()].map(({ refs: _refs, ...peer }) => peer);
}

/** Who is in the room right now, for a page that has not joined yet. */
export function liveRoster(communityId: number): LivePeer[] {
  return rosterOf(rooms.get(roomKey(communityId)));
}

/**
 * Distinct browsers in the room, which is what a capacity limit must count.
 *
 * A mesh is O(n²) connections and every publisher uploads to every other
 * participant, so the ceiling is real engineering rather than product
 * squeamishness: at eight people each browser holds seven uplinks.
 */
export function liveOccupancy(communityId: number): number {
  return rooms.get(roomKey(communityId))?.size ?? 0;
}

/** Registers a live signalling connection and returns the resulting roster. */
export function joinLiveRoom(communityId: number, peer: LivePeer): PresenceChange {
  const key = roomKey(communityId);
  let room = rooms.get(key);
  if (!room) {
    room = new Map();
    rooms.set(key, room);
  }
  const existing = room.get(peer.peerId);
  if (existing) {
    existing.refs += 1;
    return { roster: rosterOf(room), changed: false };
  }
  room.set(peer.peerId, { ...peer, refs: 1 });
  return { roster: rosterOf(room), changed: true };
}

/** Drops one connection. The member stays while any connection remains. */
export function leaveLiveRoom(communityId: number, peerId: string): PresenceChange {
  const key = roomKey(communityId);
  const room = rooms.get(key);
  if (!room) return { roster: [], changed: false };

  const existing = room.get(peerId);
  if (!existing) return { roster: rosterOf(room), changed: false };

  existing.refs -= 1;
  if (existing.refs > 0) return { roster: rosterOf(room), changed: false };

  room.delete(peerId);
  // Drop the room itself when it empties, so a site with many communities does
  // not accumulate an empty map per room for the life of the process.
  if (room.size === 0) rooms.delete(key);
  return { roster: rosterOf(room), changed: true };
}

export function emitLiveSignal(communityId: number, signal: LiveSignal): void {
  bus.emit(roomKey(communityId), signal);
}

export function subscribeLiveSignals(
  communityId: number,
  listener: (signal: LiveSignal) => void
): () => void {
  const key = roomKey(communityId);
  bus.on(key, listener);
  return () => bus.off(key, listener);
}

/** Announces the roster to everybody, which is the only way presence is ever set. */
export function broadcastPresence(communityId: number, roster: LivePeer[]): void {
  emitLiveSignal(communityId, {
    kind: "presence",
    senderId: "server",
    to: "",
    from: { memberId: 0, name: "" },
    payload: { roster },
    at: new Date().toISOString(),
  });
}

/** Test seam: the module holds process-wide state that must not leak between suites. */
export function __resetLiveRooms(): void {
  rooms.clear();
  bus.removeAllListeners();
}
