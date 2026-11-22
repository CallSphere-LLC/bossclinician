import { describe, expect, it, vi } from "vitest";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { vipSeatOpen } from "./loungeWaitlist";

/**
 * Migration 222: when the VIP waitlist is told a seat has opened. Founding
 * places used up, and fewer than six members holding VIP right now. Checkout
 * holds are not part of it, so a lapsed 30-minute hold never re-notifies.
 */
describe("vipSeatOpen", () => {
  it("is never open while founding places remain (there is no waitlist yet)", () => {
    expect(vipSeatOpen({ foundingClaimed: 0, activeSeats: 0 })).toBe(false);
    expect(vipSeatOpen({ foundingClaimed: 5, activeSeats: 4 })).toBe(false);
  });

  it("is closed while all six seats are held", () => {
    expect(vipSeatOpen({ foundingClaimed: 6, activeSeats: 6 })).toBe(false);
    expect(vipSeatOpen({ foundingClaimed: 9, activeSeats: 6 })).toBe(false);
  });

  it("opens when a seat frees after the six founding places are used", () => {
    expect(vipSeatOpen({ foundingClaimed: 6, activeSeats: 5 })).toBe(true);
    expect(vipSeatOpen({ foundingClaimed: 8, activeSeats: 3 })).toBe(true);
  });
});
