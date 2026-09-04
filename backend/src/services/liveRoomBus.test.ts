import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLiveRooms,
  broadcastPresence,
  emitLiveSignal,
  joinLiveRoom,
  leaveLiveRoom,
  liveOccupancy,
  liveRoster,
  subscribeLiveSignals,
  type LivePeer,
  type LiveSignal,
} from "./liveRoomBus";

/**
 * The properties that make the room correct rather than merely working.
 *
 * The two that matter most are inherited from the telehealth implementation
 * this was ported from, and both are the kind of thing that looks fine in a
 * demo and falls apart with two real browsers: presence must survive an
 * `EventSource` reconnect holding two overlapping connections, and it must be
 * the server's word alone.
 */

function peer(id: string, memberId = 1, role = "member"): LivePeer {
  return { peerId: id, memberId, name: `Peer ${id}`, avatarUrl: "", role };
}

beforeEach(() => __resetLiveRooms());

describe("live room presence", () => {
  it("reports everyone holding a connection", () => {
    joinLiveRoom(7, peer("1:aaa", 1));
    const second = joinLiveRoom(7, peer("2:bbb", 2));

    expect(second.changed).toBe(true);
    expect(second.roster.map((p) => p.peerId).sort()).toEqual(["1:aaa", "2:bbb"]);
    expect(liveOccupancy(7)).toBe(2);
  });

  it("survives an overlapping reconnect without a phantom leave", () => {
    joinLiveRoom(7, peer("1:aaa"));
    // EventSource reconnects before the old connection finishes closing, so the
    // same peer id is briefly registered twice.
    const again = joinLiveRoom(7, peer("1:aaa"));
    expect(again.changed).toBe(false);
    expect(liveOccupancy(7)).toBe(1);

    // The stale connection closing must NOT empty the room.
    const stale = leaveLiveRoom(7, "1:aaa");
    expect(stale.changed).toBe(false);
    expect(liveOccupancy(7)).toBe(1);

    // Only the last one out turns off the lights.
    const last = leaveLiveRoom(7, "1:aaa");
    expect(last.changed).toBe(true);
    expect(liveOccupancy(7)).toBe(0);
  });

  it("keeps rooms apart", () => {
    joinLiveRoom(7, peer("1:aaa"));
    joinLiveRoom(8, peer("2:bbb"));

    expect(liveOccupancy(7)).toBe(1);
    expect(liveOccupancy(8)).toBe(1);
    expect(liveRoster(7).map((p) => p.peerId)).toEqual(["1:aaa"]);
  });

  it("forgets an empty room rather than leaking a map per community", () => {
    joinLiveRoom(7, peer("1:aaa"));
    leaveLiveRoom(7, "1:aaa");
    // Nothing observable to assert but the roster; the point is that the
    // internal map is dropped, which liveRoster reflects as empty.
    expect(liveRoster(7)).toEqual([]);
  });

  it("ignores a leave from a peer that was never here", () => {
    joinLiveRoom(7, peer("1:aaa"));
    const ghost = leaveLiveRoom(7, "9:zzz");

    expect(ghost.changed).toBe(false);
    expect(liveOccupancy(7)).toBe(1);
  });
});

describe("live room signalling", () => {
  it("delivers to subscribers of that room only", () => {
    const here = vi.fn();
    const elsewhere = vi.fn();
    subscribeLiveSignals(7, here);
    subscribeLiveSignals(8, elsewhere);

    emitLiveSignal(7, {
      kind: "candidate",
      senderId: "1:aaa",
      to: "2:bbb",
      from: { memberId: 1, name: "A" },
      at: new Date().toISOString(),
    });

    expect(here).toHaveBeenCalledOnce();
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it("carries the target peer, so a mesh negotiation is point-to-point", () => {
    // A 1:1 call can broadcast; four people are six independent negotiations,
    // and an offer meant for one peer must not be answered by all of them.
    const seen: LiveSignal[] = [];
    subscribeLiveSignals(7, (signal) => seen.push(signal));

    emitLiveSignal(7, {
      kind: "desc",
      senderId: "1:aaa",
      to: "2:bbb",
      from: { memberId: 1, name: "A" },
      payload: { type: "offer" },
      at: new Date().toISOString(),
    });

    expect(seen[0].to).toBe("2:bbb");
  });

  it("stops delivering once unsubscribed", () => {
    const listener = vi.fn();
    const off = subscribeLiveSignals(7, listener);
    off();

    broadcastPresence(7, []);
    expect(listener).not.toHaveBeenCalled();
  });

  it("addresses presence to the whole room and attributes it to the server", () => {
    const seen: LiveSignal[] = [];
    subscribeLiveSignals(7, (signal) => seen.push(signal));

    broadcastPresence(7, [peer("1:aaa")]);

    expect(seen[0].kind).toBe("presence");
    // "server", never a peer id: a client that could publish presence could
    // invent the room's roster.
    expect(seen[0].senderId).toBe("server");
    expect(seen[0].to).toBe("");
  });
});
