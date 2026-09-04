import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLiveTickets, mintLiveTicket, spendLiveTicket } from "./liveRoomTickets";

/**
 * The stream ticket exists so a member access token never has to travel in a
 * URL, where nginx would log it. That only holds if the ticket is genuinely
 * weaker than the token it replaces, which is what these pin down.
 */

beforeEach(() => {
  __resetLiveTickets();
  vi.useRealTimers();
});

describe("live room tickets", () => {
  it("spends once and never again", () => {
    const { ticket } = mintLiveTicket({ memberId: 3, communityId: 9, peerId: "3:abc" });

    expect(spendLiveTicket(ticket, "3:abc")).toEqual({ memberId: 3, communityId: 9 });
    // A replayed ticket is refused: a ticket offered once has been observed.
    expect(spendLiveTicket(ticket, "3:abc")).toBeNull();
  });

  it("refuses a ticket presented for a different connection", () => {
    const { ticket } = mintLiveTicket({ memberId: 3, communityId: 9, peerId: "3:abc" });

    // Bound to its peer id, so a stolen ticket cannot claim another seat.
    expect(spendLiveTicket(ticket, "3:different")).toBeNull();
  });

  it("burns a ticket even when the peer id does not match", () => {
    const { ticket } = mintLiveTicket({ memberId: 3, communityId: 9, peerId: "3:abc" });
    spendLiveTicket(ticket, "3:wrong");

    // Deleted on first read whatever the outcome — otherwise an attacker could
    // probe peer ids against a ticket until one matched.
    expect(spendLiveTicket(ticket, "3:abc")).toBeNull();
  });

  it("expires", () => {
    vi.useFakeTimers();
    const { ticket, expiresInSeconds } = mintLiveTicket({
      memberId: 3,
      communityId: 9,
      peerId: "3:abc",
    });
    expect(expiresInSeconds).toBe(60);

    vi.advanceTimersByTime(61_000);
    expect(spendLiveTicket(ticket, "3:abc")).toBeNull();
  });

  it("refuses something that was never minted", () => {
    expect(spendLiveTicket("not-a-ticket", "3:abc")).toBeNull();
  });

  it("mints unpredictable tickets", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(mintLiveTicket({ memberId: 1, communityId: 1, peerId: "1:a" }).ticket);
    }
    expect(seen.size).toBe(50);
    // 32 random bytes, base64url — long enough not to be guessed in 60 seconds.
    expect([...seen][0].length).toBeGreaterThan(40);
  });
});
