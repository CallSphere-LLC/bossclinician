import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/pool", () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
}));

import { pool } from "../../db/pool";
import {
  __resetLiveRooms,
  emitLiveSignal,
  liveOccupancy,
  subscribeLiveSignals,
  type LivePeer,
  type LiveSignal,
} from "../../services/liveRoomBus";
import {
  LEAVE_GRACE_MS,
  __resetLiveStreams,
  closeAllLiveStreams,
  liveStreamCounts,
  openLiveStream,
} from "./communityLiveStream";

/**
 * What happens when a signalling stream ends, which is where a call is kept or
 * lost. Media is peer-to-peer, so the stream dropping costs nothing by itself;
 * what used to end calls was the server announcing the drop as a departure.
 *
 * Pinned here: a drop is not announced until the grace runs out, and never if
 * the same peer id gets back in first; a deliberate goodbye is still announced
 * at once, whichever side of the close it arrives on; and a shutdown tells each
 * client to come back without telling the room that anybody left.
 */

const ROOM = 7;

function peer(id: string, memberId = 1): LivePeer {
  return { peerId: id, memberId, name: `Peer ${id}`, avatarUrl: "", role: "member" };
}

function fakeSink() {
  const chunks: string[] = [];
  return {
    chunks,
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: vi.fn(),
  };
}

/** Everything the room is told, as another browser would hear it. */
function listen(): LiveSignal[] {
  const heard: LiveSignal[] = [];
  subscribeLiveSignals(ROOM, (signal) => heard.push(signal));
  return heard;
}

function byesFrom(heard: LiveSignal[], peerId: string): number {
  return heard.filter((s) => s.kind === "bye" && s.senderId === peerId).length;
}

function lastRoster(heard: LiveSignal[]): string[] {
  const presences = heard.filter((s) => s.kind === "presence");
  const last = presences[presences.length - 1];
  const roster = (last?.payload as { roster: LivePeer[] } | undefined)?.roster ?? [];
  return roster.map((p) => p.peerId).sort();
}

/** What the client posts through `/live/signal` when it leaves on purpose. */
function sayGoodbye(who: LivePeer): void {
  emitLiveSignal(ROOM, {
    kind: "bye",
    senderId: who.peerId,
    to: "",
    from: { memberId: who.memberId, name: who.name },
    at: new Date().toISOString(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetLiveStreams();
  __resetLiveRooms();
  vi.mocked(pool.query).mockClear();
});

afterEach(() => {
  __resetLiveStreams();
  vi.useRealTimers();
});

describe("live stream heartbeat", () => {
  it("beats with an event the page can see as well as the comment proxies need", () => {
    const sink = fakeSink();
    openLiveStream(ROOM, peer("1:aaa"), sink);
    sink.chunks.length = 0;

    vi.advanceTimersByTime(25_000);

    expect(sink.chunks[0]).toBe(": ping\n\n");
    expect(sink.chunks[1]).toMatch(/^event: ping\ndata: \{"at":"[^"]+"\}\n\n$/);
  });

  it("stops when the stream closes", () => {
    const sink = fakeSink();
    const stream = openLiveStream(ROOM, peer("1:aaa"), sink);
    stream.close();
    sink.chunks.length = 0;

    vi.advanceTimersByTime(60_000);

    expect(sink.chunks).toEqual([]);
  });
});

describe("live stream departure grace", () => {
  it("holds a dropped peer's place, then announces it when nobody comes back", () => {
    const stays = openLiveStream(ROOM, peer("2:bbb", 2), fakeSink());
    const drops = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    const heard = listen();

    drops.close();
    vi.advanceTimersByTime(LEAVE_GRACE_MS - 1);

    // Still on the roster, and nobody has been told anything.
    expect(heard).toEqual([]);
    expect(liveOccupancy(ROOM)).toBe(2);
    expect(pool.query).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(byesFrom(heard, "1:aaa")).toBe(1);
    expect(lastRoster(heard)).toEqual(["2:bbb"]);
    expect(liveOccupancy(ROOM)).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(liveStreamCounts()).toEqual({ open: 1, held: 0 });
    stays.close();
  });

  it("stops relaying to a dropped connection at once", () => {
    const sink = fakeSink();
    const drops = openLiveStream(ROOM, peer("1:aaa"), sink);
    drops.close();
    sink.chunks.length = 0;

    sayGoodbye(peer("2:bbb", 2));

    expect(sink.chunks).toEqual([]);
    expect(sink.end).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the same peer id gets back in during the grace", () => {
    const first = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    const heard = listen();

    first.close();
    vi.advanceTimersByTime(2_000);
    const again = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    expect(again.joined.changed).toBe(false);

    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2);

    expect(byesFrom(heard, "1:aaa")).toBe(0);
    // The only presence is the one the rejoin causes, and it still lists them.
    expect(lastRoster(heard)).toEqual(["1:aaa"]);
    expect(liveOccupancy(ROOM)).toBe(1);
    expect(pool.query).not.toHaveBeenCalled();
    expect(liveStreamCounts()).toEqual({ open: 1, held: 0 });
  });

  it("closing twice holds one place, not two", () => {
    const drops = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    drops.close();
    drops.close();

    expect(liveStreamCounts()).toEqual({ open: 0, held: 1 });
  });
});

describe("live stream explicit goodbye", () => {
  it("is announced at once when the goodbye comes before the close", () => {
    const leaves = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    const heard = listen();

    sayGoodbye(peer("1:aaa"));
    leaves.close();

    // The peer's own goodbye, relayed, and then the server's word on it.
    expect(byesFrom(heard, "1:aaa")).toBe(2);
    expect(lastRoster(heard)).toEqual([]);
    expect(liveOccupancy(ROOM)).toBe(0);
    expect(liveStreamCounts()).toEqual({ open: 0, held: 0 });
  });

  it("is announced at once when the goodbye comes after the close", () => {
    // The order the client really uses: drop the stream, then post `bye`.
    const leaves = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    const heard = listen();

    leaves.close();
    expect(liveOccupancy(ROOM)).toBe(1);
    sayGoodbye(peer("1:aaa"));

    expect(lastRoster(heard)).toEqual([]);
    expect(liveOccupancy(ROOM)).toBe(0);
    expect(liveStreamCounts()).toEqual({ open: 0, held: 0 });

    // And the timer that was holding the place has nothing left to say.
    const before = heard.length;
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2);
    expect(heard.length).toBe(before);
  });

  it("is not swallowed by a place still held from an earlier drop", () => {
    const first = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    first.close();
    const again = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    const heard = listen();

    sayGoodbye(peer("1:aaa"));
    again.close();

    expect(lastRoster(heard)).toEqual([]);
    expect(liveOccupancy(ROOM)).toBe(0);
  });

  it("ignores a bye for one leg, and a bye from somebody else", () => {
    const stays = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    emitLiveSignal(ROOM, {
      kind: "bye",
      senderId: "1:aaa",
      to: "2:bbb",
      from: { memberId: 1, name: "" },
      at: new Date().toISOString(),
    });
    sayGoodbye(peer("2:bbb", 2));

    stays.close();

    // Neither was this peer leaving the room, so the close is a drop.
    expect(liveOccupancy(ROOM)).toBe(1);
    expect(liveStreamCounts()).toEqual({ open: 0, held: 1 });
  });
});

describe("closeAllLiveStreams", () => {
  it("tells every stream to come back, ends it, and tells the room nothing", () => {
    const a = fakeSink();
    const b = fakeSink();
    const streamA = openLiveStream(ROOM, peer("1:aaa"), a);
    openLiveStream(ROOM, peer("2:bbb", 2), b);
    const heard = listen();

    expect(closeAllLiveStreams()).toBe(2);

    for (const sink of [a, b]) {
      expect(sink.chunks[sink.chunks.length - 1]).toBe(
        'event: shutdown\ndata: {"retryInMs":1500}\n\n'
      );
      expect(sink.end).toHaveBeenCalledTimes(1);
    }
    expect(heard).toEqual([]);
    expect(liveOccupancy(ROOM)).toBe(0);
    expect(liveStreamCounts()).toEqual({ open: 0, held: 0 });

    // Ending the response closes the request, which calls this. It must not
    // start a grace period in a process that is on its way out.
    streamA.close();
    expect(a.end).toHaveBeenCalledTimes(1);
    expect(liveStreamCounts()).toEqual({ open: 0, held: 0 });
    expect(closeAllLiveStreams()).toBe(0);
  });

  it("drops held places without announcing them", () => {
    const drops = openLiveStream(ROOM, peer("1:aaa"), fakeSink());
    drops.close();
    const heard = listen();

    expect(closeAllLiveStreams()).toBe(0);
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2);

    expect(heard).toEqual([]);
    expect(liveOccupancy(ROOM)).toBe(0);
    expect(liveStreamCounts()).toEqual({ open: 0, held: 0 });
  });
});
