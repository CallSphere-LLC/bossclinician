import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Yvette, 22 Nov 2026, item 1: Lounge founding pricing by paid enrolment count.
 * The decision is pinned as pure functions; reserve and claim are then driven
 * against a scripted database to prove the lock, the hold and the
 * once-per-member claim. True concurrency (two checkouts on two connections)
 * is covered by loungeSeats.integration.test.ts against a real Postgres.
 */

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  counts: { founding_claimed: 0, founding_held: 0, active_seats: 0, capacity_held: 0 },
  standing: null as null | { phase: "founding" | "standard"; active: boolean },
  order: null as null | Record<string, unknown>,
  claimInserted: true,
  failOn: "" as string,
}));

function answer(sql: string, params: unknown[]) {
  state.queries.push({ sql, params });
  const text = sql.replace(/\s+/g, " ").trim();
  if (state.failOn && text.includes(state.failOn)) throw new Error("scripted failure");
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(text)) return { rows: [], rowCount: 0 };
  if (text.includes("pg_advisory_xact_lock")) return { rows: [{}], rowCount: 1 };
  if (text.includes("AS founding_claimed")) return { rows: [state.counts], rowCount: 1 };
  if (text.startsWith("SELECT s.phase")) return { rows: state.standing ? [state.standing] : [], rowCount: state.standing ? 1 : 0 };
  if (text.includes("FROM orders ord JOIN offers o")) return { rows: state.order ? [state.order] : [], rowCount: state.order ? 1 : 0 };
  if (text.startsWith("SELECT count(*)::int AS n FROM lounge_seats")) return { rows: [{ n: state.counts.founding_claimed }], rowCount: 1 };
  if (text.startsWith("INSERT INTO lounge_seats") && text.includes("'claimed'")) {
    return state.claimInserted ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("../db/pool", () => {
  const client = { query: vi.fn(async (sql: string, params: unknown[] = []) => answer(sql, params)), release: vi.fn() };
  return { pool: { connect: vi.fn(async () => client), query: client.query } };
});

import {
  FOUNDING_JUST_FILLED,
  VIP_WAITLIST_MESSAGE,
  claimLoungeSeatSafely,
  decideForBuyer,
  decideTierStatus,
  filterPhasedOptions,
  LOUNGE_BLOCKS,
  generalBlockKey,
  loungeBlockValues,
  loungeMergeValuesSafe,
  memberRateSentence,
  reserveLoungeSeat,
  testOrderReason,
  vipBlockKey,
  tierForSlug,
  type SeatCounts,
} from "./loungeSeats";
import { pool } from "../db/pool";

const counts = (over: Partial<SeatCounts> = {}): SeatCounts => ({ foundingClaimed: 0, foundingHeld: 0, activeSeats: 0, capacityHeld: 0, ...over });
const newBuyer = { claimPhase: null, active: false } as const;

beforeEach(() => {
  state.queries = [];
  state.counts = { founding_claimed: 0, founding_held: 0, active_seats: 0, capacity_held: 0 };
  state.standing = null;
  state.order = null;
  state.claimInserted = true;
  state.failOn = "";
});

describe("tiers", () => {
  it("maps the Lounge offers and nothing else", () => {
    expect(tierForSlug("the-lounge")).toBe("general");
    expect(tierForSlug("lounge-billing-preview")).toBe("general");
    expect(tierForSlug("the-lounge-vip")).toBe("vip");
    expect(tierForSlug("the-lounge-vip-free")).toBeNull();
    expect(tierForSlug("the-boss-club")).toBeNull();
  });
});

describe("Lounge Member (General): 20 founding places", () => {
  it("sells the 20th paid member the founding rate", () => {
    const status = decideTierStatus("general", counts({ foundingClaimed: 19 }));
    expect(status).toMatchObject({ phase: "founding", foundingRemaining: 1, purchasable: true, waitlist: false });
    expect(decideForBuyer(status, newBuyer)).toMatchObject({ phase: "founding", takesFoundingPlace: true, takesCapacitySeat: false });
  });

  it("sells the 21st paid member the standard rate, with no cap", () => {
    const status = decideTierStatus("general", counts({ foundingClaimed: 20, activeSeats: 250 }));
    expect(status).toMatchObject({ phase: "standard", foundingRemaining: 0, purchasable: true, waitlist: false, seatsAvailable: null });
    expect(decideForBuyer(status, newBuyer)).toMatchObject({ phase: "standard", takesFoundingPlace: false });
  });

  it("counts another buyer's live hold, so the 20th place cannot be sold twice", () => {
    expect(decideTierStatus("general", counts({ foundingClaimed: 19, foundingHeld: 1 })).phase).toBe("standard");
  });

  it("never gives a place back: cancellations leave the claimed count where it was", () => {
    // 20 claimed, every one of them since cancelled (no active seats): still standard.
    expect(decideTierStatus("general", counts({ foundingClaimed: 20, activeSeats: 0 })).phase).toBe("standard");
  });

  it("counts a returning member once: they rejoin without taking a second founding place", () => {
    const status = decideTierStatus("general", counts({ foundingClaimed: 5 }));
    expect(decideForBuyer(status, { claimPhase: "founding", active: false })).toMatchObject({ phase: "founding", takesFoundingPlace: false, continuation: false });
  });

  it("keeps a continuing founding member on the founding rate after founding closes (signed in)", () => {
    const status = decideTierStatus("general", counts({ foundingClaimed: 20 }));
    expect(decideForBuyer(status, { claimPhase: "founding", active: true })).toMatchObject({ phase: "founding", continuation: true, purchasable: true });
    // Not signed in: priced as the public page priced them.
    expect(decideForBuyer(status, { claimPhase: "founding", active: true }, false)).toMatchObject({ phase: "standard", continuation: false });
    // Left and came back: the pricing available at that time.
    expect(decideForBuyer(status, { claimPhase: "founding", active: false })).toMatchObject({ phase: "standard", continuation: false });
  });
});

describe("Lounge VIP: 6 founding seats, then a 6-seat waitlist", () => {
  it("sells the 6th paid VIP member the founding rate", () => {
    const status = decideTierStatus("vip", counts({ foundingClaimed: 5, activeSeats: 5 }));
    expect(status).toMatchObject({ phase: "founding", foundingRemaining: 1, seatsAvailable: 1, purchasable: true });
    expect(decideForBuyer(status, newBuyer)).toMatchObject({ phase: "founding", takesFoundingPlace: true, takesCapacitySeat: true });
  });

  it("puts the 7th on the waitlist while all six seats are active", () => {
    const status = decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 6 }));
    expect(status).toMatchObject({ phase: "standard", seatsAvailable: 0, waitlist: true, purchasable: false });
    expect(decideForBuyer(status, newBuyer)).toMatchObject({ purchasable: false, waitlist: true });
  });

  it("sells the next member $447 when a seat frees, and the founding rate does not come back", () => {
    const status = decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 5 }));
    expect(status).toMatchObject({ phase: "standard", seatsAvailable: 1, waitlist: false, purchasable: true });
    expect(decideForBuyer(status, newBuyer)).toMatchObject({ phase: "standard", takesCapacitySeat: true, takesFoundingPlace: false });
  });

  it("holds the freed seat for one buyer at a time", () => {
    expect(decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 5, capacityHeld: 1 }))).toMatchObject({ waitlist: true, purchasable: false });
  });

  it("never waitlists an active VIP member renewing", () => {
    const status = decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 6 }));
    expect(decideForBuyer(status, { claimPhase: "founding", active: true })).toMatchObject({ purchasable: true, phase: "founding", takesCapacitySeat: false });
    expect(decideForBuyer(status, { claimPhase: "standard", active: true })).toMatchObject({ purchasable: true, phase: "standard" });
  });
});

describe("options shown at checkout", () => {
  const rows = [
    { id: 10, price_phase: "founding" as const },
    { id: 37, price_phase: "founding" as const },
    { id: 90, price_phase: "standard" as const },
    { id: 91, price_phase: "standard" as const },
  ];

  it("shows only the founding prices while places remain", async () => {
    state.counts.founding_claimed = 19;
    expect((await filterPhasedOptions(rows, "the-lounge", undefined, pool)).map((r) => r.id)).toEqual([10, 37]);
  });

  it("shows only the standard prices from the 21st", async () => {
    state.counts.founding_claimed = 20;
    expect((await filterPhasedOptions(rows, "the-lounge", undefined, pool)).map((r) => r.id)).toEqual([90, 91]);
  });

  it("leaves every other offer alone, without a query", async () => {
    const plain = [{ id: 1, price_phase: null }, { id: 2 }];
    expect(await filterPhasedOptions(plain, "the-boss-club", undefined, pool)).toEqual(plain);
    expect(state.queries).toHaveLength(0);
  });
});

describe("reserveLoungeSeat (checkout)", () => {
  const input = { orderId: 501, offerSlug: "the-lounge", pricePhase: "founding" as const, email: "Buyer@Example.com", signedIn: false };

  it("takes the tier lock before counting, then holds the founding place", async () => {
    state.counts.founding_claimed = 19;
    await reserveLoungeSeat(input);
    const sqls = state.queries.map((q) => q.sql.replace(/\s+/g, " ").trim());
    const lock = sqls.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const count = sqls.findIndex((sql) => sql.includes("AS founding_claimed"));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(count);
    expect(state.queries[lock].params).toEqual(["lounge-seats:general"]);
    const hold = state.queries.find((q) => q.sql.includes("INSERT INTO lounge_seats"));
    expect(hold?.params).toEqual(["general", "buyer@example.com", 501, "founding", true, false, 30]);
    expect(sqls.at(-1)).toBe("COMMIT");
  });

  it("refuses a founding price once the 20 places are taken (409), and holds nothing", async () => {
    state.counts.founding_claimed = 20;
    await expect(reserveLoungeSeat(input)).rejects.toMatchObject({ status: 409, message: FOUNDING_JUST_FILLED });
    expect(state.queries.some((q) => q.sql.includes("INSERT INTO lounge_seats"))).toBe(false);
    expect(state.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("refuses a VIP sale while all six seats are active", async () => {
    state.counts = { founding_claimed: 6, founding_held: 0, active_seats: 6, capacity_held: 0 };
    await expect(reserveLoungeSeat({ ...input, offerSlug: "the-lounge-vip", pricePhase: "standard" })).rejects.toMatchObject({ status: 409, message: VIP_WAITLIST_MESSAGE });
  });

  it("does nothing for an offer that is not the Lounge", async () => {
    await reserveLoungeSeat({ ...input, offerSlug: "the-boss-club" });
    expect(state.queries).toHaveLength(0);
  });

  it("serialises two buyers for the last place: the second is refused", async () => {
    // The scripted database plays the lock's effect: the first buyer's hold is
    // visible to the second, who counts it.
    state.counts.founding_claimed = 19;
    await reserveLoungeSeat({ ...input, orderId: 601, email: "first@example.com" });
    state.counts.founding_held = 1;
    await expect(reserveLoungeSeat({ ...input, orderId: 602, email: "second@example.com" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("claimLoungeSeatSafely (payment)", () => {
  const paidOrder = { slug: "the-lounge", email: "buyer@example.com", total_cents: 19700, contact_id: 9, member_id: 4, is_internal: false, price_phase: "founding" };

  it("records the paid member once, under the lock, and releases the hold", async () => {
    state.order = paidOrder;
    state.counts.founding_claimed = 3;
    const client = await pool.connect();
    expect(await claimLoungeSeatSafely(client, 77)).toEqual({ claimed: true, overLimit: false, reason: "" });
    const sqls = state.queries.map((q) => q.sql.replace(/\s+/g, " ").trim());
    expect(sqls[0]).toBe("SAVEPOINT lounge_seat_claim");
    const insert = sqls.find((sql) => sql.startsWith("INSERT INTO lounge_seats"));
    expect(insert).toContain("ON CONFLICT (tier, email) WHERE status = 'claimed' DO NOTHING");
    expect(sqls.findIndex((sql) => sql.includes("pg_advisory_xact_lock"))).toBeLessThan(sqls.findIndex((sql) => sql.startsWith("INSERT INTO lounge_seats")));
    expect(sqls.some((sql) => sql.includes("SET status = 'released'"))).toBe(true);
  });

  it("does not count a renewal or a second purchase twice", async () => {
    state.order = paidOrder;
    state.claimInserted = false;
    expect(await claimLoungeSeatSafely(await pool.connect(), 78)).toMatchObject({ claimed: false, reason: "already counted" });
  });

  it("counts only paid orders from real contacts", async () => {
    state.order = { ...paidOrder, total_cents: 0 };
    expect((await claimLoungeSeatSafely(await pool.connect(), 79)).reason).toBe("not a paid order");
    state.order = { ...paidOrder, is_internal: true };
    expect((await claimLoungeSeatSafely(await pool.connect(), 80)).reason).toBe("internal contact");
    state.order = { ...paidOrder, slug: "the-lounge-vip-free" };
    expect((await claimLoungeSeatSafely(await pool.connect(), 81)).reason).toBe("not a lounge order");
  });

  it("honours a founding price paid after its hold lapsed, flagged over the limit", async () => {
    state.order = paidOrder;
    state.counts.founding_claimed = 20;
    expect(await claimLoungeSeatSafely(await pool.connect(), 82)).toEqual({ claimed: true, overLimit: true, reason: "" });
  });

  it("never throws into the payment: a failure rolls back to its own savepoint", async () => {
    state.order = paidOrder;
    state.failOn = "INSERT INTO lounge_seats";
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await claimLoungeSeatSafely(await pool.connect(), 83)).toMatchObject({ claimed: false, reason: "error" });
    expect(state.queries.at(-1)?.sql).toBe("ROLLBACK TO SAVEPOINT lounge_seat_claim");
    errors.mockRestore();
  });
});

describe("masterclass email 11 price line", () => {
  it("states the founding offer while places remain, and the standard rate after", () => {
    expect(memberRateSentence("founding")).toContain("$197 per month");
    expect(memberRateSentence("founding")).toContain("21st paid member");
    expect(memberRateSentence("standard")).toContain("$247 per month");
    expect(memberRateSentence("standard")).toContain("$1,482");
    expect(memberRateSentence("standard")).not.toMatch(/founding/i);
  });
});

/* ── Migration 222: Emails 11-12 pricing blocks, same-plan rule, test code ── */

describe("masterclass Emails 11-12 pricing blocks (her exact texts)", () => {
  // Her revised doc, TEAM IMPLEMENTATION NOTES, word for word (quotes removed).
  const DOC = {
    generalFounding: "General: The first 20 paid General members can join for $197/month or $1,997/year. The monthly option has a six-month minimum totaling $1,182, then continues month-to-month. Starting with the 21st paid General member, pricing becomes $247/month or $2,497/year.",
    generalStandard: "General: Join for $247/month or $2,497/year. The monthly option has a six-month minimum totaling $1,482, then continues month-to-month.",
    vipFounding: "VIP: The first six paid VIP members can join for $347/month or $3,497/year. The monthly option has a six-month minimum totaling $2,082, then continues month-to-month. Once all six seats are filled, a waitlist opens. Future available seats are $447/month or $4,497/year.",
    vipFull: "VIP is currently full. Join the VIP waitlist through The Lounge page to hear when a seat becomes available. Future seats are $447/month or $4,497/year. Seats are first come, first served; joining the waitlist does not reserve a place.",
    vipSeatAvailable: "A VIP seat is available at $447/month or $4,497/year. The monthly option has a six-month minimum totaling $2,682, then continues month-to-month. Available seats are first come, first served.",
  };

  it("holds her five texts exactly", () => {
    expect(LOUNGE_BLOCKS).toEqual(DOC);
    for (const text of Object.values(LOUNGE_BLOCKS)) {
      expect(text).not.toMatch(/\{\{|\}\}|[“”<>&]/);
      expect(text).not.toMatch(/\b(left|remaining|hurry|deadline)\b/i);
    }
  });

  const general = {
    founding0: decideTierStatus("general", counts()),
    founding19: decideTierStatus("general", counts({ foundingClaimed: 19 })),
    last20Held: decideTierStatus("general", counts({ foundingClaimed: 19, foundingHeld: 1 })),
    standard20: decideTierStatus("general", counts({ foundingClaimed: 20 })),
    standard35: decideTierStatus("general", counts({ foundingClaimed: 35 })),
  };
  const vip = {
    founding0: decideTierStatus("vip", counts()),
    founding5: decideTierStatus("vip", counts({ foundingClaimed: 5, activeSeats: 5 })),
    full: decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 6 })),
    seatOpen: decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 5 })),
    // A refunded founding member: the place is not given back, but the seat is.
    refundedFounder: decideTierStatus("vip", counts({ foundingClaimed: 4, activeSeats: 3 })),
    seatHeld: decideTierStatus("vip", counts({ foundingClaimed: 6, activeSeats: 5, capacityHeld: 1 })),
  };

  it("chooses the General block from General's own count", () => {
    expect(generalBlockKey(general.founding0)).toBe("generalFounding");
    expect(generalBlockKey(general.founding19)).toBe("generalFounding");
    // The 20th place reserved at checkout counts, exactly as the checkout counts it.
    expect(generalBlockKey(general.last20Held)).toBe("generalStandard");
    expect(generalBlockKey(general.standard20)).toBe("generalStandard");
    expect(generalBlockKey(general.standard35)).toBe("generalStandard");
  });

  it("chooses the VIP block from VIP's own founding count and current capacity", () => {
    expect(vipBlockKey(vip.founding0)).toBe("vipFounding");
    expect(vipBlockKey(vip.founding5)).toBe("vipFounding");
    expect(vipBlockKey(vip.full)).toBe("vipFull");
    expect(vipBlockKey(vip.seatOpen)).toBe("vipSeatAvailable");
    expect(vipBlockKey(vip.refundedFounder)).toBe("vipFounding");
    // A freed seat in someone's 30-minute checkout counts as taken.
    expect(vipBlockKey(vip.seatHeld)).toBe("vipFull");
  });

  it("selects each tier independently: every combination gives one General and one VIP block", () => {
    for (const g of Object.values(general)) {
      for (const v of Object.values(vip)) {
        const values = loungeBlockValues(g, v);
        expect(Object.keys(values).sort()).toEqual(["lounge_general_pricing_block", "lounge_vip_availability_block"]);
        expect(values.lounge_general_pricing_block).toBe(LOUNGE_BLOCKS[generalBlockKey(g)]);
        expect(values.lounge_vip_availability_block).toBe(LOUNGE_BLOCKS[vipBlockKey(v)]);
        expect(values.lounge_general_pricing_block.startsWith("General: ")).toBe(true);
        expect(values.lounge_vip_availability_block).toMatch(/VIP/);
      }
    }
  });

  it("reads the live state at send time, and gives no values (so the email is held) if it cannot", async () => {
    state.counts.founding_claimed = 20;
    const client = await pool.connect();
    const values = await loungeMergeValuesSafe(client);
    expect(values.lounge_general_pricing_block).toBe(DOC.generalStandard);
    // The mock answers both tiers with the same counts: VIP past its six founding places, no active seats.
    expect(values.lounge_vip_availability_block).toBe(DOC.vipSeatAvailable);
    state.failOn = "AS founding_claimed";
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loungeMergeValuesSafe(client)).toEqual({});
    expect(state.queries.at(-1)?.sql).toBe("ROLLBACK TO SAVEPOINT lounge_merge");
    errors.mockRestore();
  });
});

describe("founding rate continues on the same plan only", () => {
  const closed = decideTierStatus("general", counts({ foundingClaimed: 20 }));
  const monthlyFounder = { claimPhase: "founding" as const, active: true, claimPlan: "subscription" };

  it("keeps the founding price on the plan the member holds", () => {
    expect(decideForBuyer(closed, monthlyFounder, true, "subscription")).toMatchObject({ phase: "founding", continuation: true });
  });

  it("prices a switch to the other plan at the current rate, still without counting them again", () => {
    expect(decideForBuyer(closed, monthlyFounder, true, "one_time")).toMatchObject({
      phase: "standard", continuation: false, takesFoundingPlace: false, takesCapacitySeat: false,
    });
  });

  it("treats an unknown claim plan (backfilled / Kajabi) as the same plan", () => {
    expect(decideForBuyer(closed, { claimPhase: "founding", active: true, claimPlan: null }, true, "one_time")).toMatchObject({ phase: "founding" });
  });

  it("shows a continuing monthly founder founding monthly and standard annual", async () => {
    state.counts.founding_claimed = 20;
    state.standing = { phase: "founding", active: true, plan: "subscription" } as never;
    const rows = [
      { id: 10, price_phase: "founding" as const, pricing_type: "subscription" },
      { id: 37, price_phase: "founding" as const, pricing_type: "one_time" },
      { id: 90, price_phase: "standard" as const, pricing_type: "subscription" },
      { id: 91, price_phase: "standard" as const, pricing_type: "one_time" },
    ];
    expect((await filterPhasedOptions(rows, "the-lounge", { email: "founder@example.com" }, pool)).map((r) => r.id)).toEqual([10, 91]);
  });
});

describe("test transactions never take a founding place", () => {
  it("knows the owner's LOUNGE26 test code, in any case", () => {
    expect(testOrderReason({ couponCode: "LOUNGE26" })).toBe("test coupon");
    expect(testOrderReason({ couponCode: " lounge26 " })).toBe("test coupon");
    expect(testOrderReason({ couponCode: "" })).toBe("");
    expect(testOrderReason({ couponCode: null })).toBe("");
    expect(testOrderReason({ couponCode: "WELCOME10" })).toBe("");
  });

  it("does not claim a place for a paid LOUNGE26 order", async () => {
    state.order = { slug: "the-lounge", email: "owner@example.com", total_cents: 200, contact_id: 225, member_id: 119, is_internal: false, price_phase: "founding", coupon_code: "LOUNGE26" };
    expect(await claimLoungeSeatSafely(await pool.connect(), 201)).toMatchObject({ claimed: false, reason: "test coupon" });
    expect(state.queries.some((q) => q.sql.includes("INSERT INTO lounge_seats"))).toBe(false);
  });
});
