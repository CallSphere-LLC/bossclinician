import { describe, expect, it } from "vitest";
import { DEFAULT_LOUNGE_PRICING, LOUNGE_BLOCKS, LOUNGE_PRICES, LOUNGE_TERMS_LINE, tierIdFor, tierMessage, type LoungeTierStatus } from "./loungePricing";

const status = (over: Partial<LoungeTierStatus>): LoungeTierStatus => ({ ...DEFAULT_LOUNGE_PRICING.general, ...over });

describe("Lounge prices by phase (22 Nov 2026, item 1)", () => {
  it("prints her founding and standard prices for each tier", () => {
    expect(LOUNGE_PRICES.member.founding.monthlyPrice).toBe("$197/month");
    expect(LOUNGE_PRICES.member.founding.annualPrice).toBe("$1,997 for 12 months");
    expect(LOUNGE_PRICES.member.standard.monthlyPrice).toBe("$247/month");
    expect(LOUNGE_PRICES.member.standard.annualPrice).toBe("$2,497 for 12 months");
    expect(LOUNGE_PRICES.vip.founding.monthlyPrice).toBe("$347/month");
    expect(LOUNGE_PRICES.vip.founding.annualPrice).toBe("$3,497 for 12 months");
    expect(LOUNGE_PRICES.vip.standard.monthlyPrice).toBe("$447/month");
    expect(LOUNGE_PRICES.vip.standard.annualPrice).toBe("$4,497 for 12 months");
  });

  it("keeps the six-month totals and annual savings arithmetic right", () => {
    const figures: Array<[keyof typeof LOUNGE_PRICES, "founding" | "standard", number, number]> = [
      ["member", "founding", 197, 1997],
      ["member", "standard", 247, 2497],
      ["vip", "founding", 347, 3497],
      ["vip", "standard", 447, 4497],
    ];
    for (const [tier, phase, monthly, annual] of figures) {
      const prices = LOUNGE_PRICES[tier][phase];
      expect(prices.monthlyTerms).toContain(`$${(monthly * 6).toLocaleString("en-US")}`);
      expect(prices.annualTerms).toContain(`Save $${(monthly * 12 - annual).toLocaleString("en-US")}`);
    }
  });

  it("prints her exact block for each tier state, each tier on its own limit (migration 222)", () => {
    // Her revised doc, TEAM IMPLEMENTATION NOTES, word for word.
    const generalFounding = "General: The first 20 paid General members can join for $197/month or $1,997/year. The monthly option has a six-month minimum totaling $1,182, then continues month-to-month. Starting with the 21st paid General member, pricing becomes $247/month or $2,497/year.";
    const generalStandard = "General: Join for $247/month or $2,497/year. The monthly option has a six-month minimum totaling $1,482, then continues month-to-month.";
    const vipFounding = "VIP: The first six paid VIP members can join for $347/month or $3,497/year. The monthly option has a six-month minimum totaling $2,082, then continues month-to-month. Once all six seats are filled, a waitlist opens. Future available seats are $447/month or $4,497/year.";
    const vipFull = "VIP is currently full. Join the VIP waitlist through The Lounge page to hear when a seat becomes available. Future seats are $447/month or $4,497/year. Seats are first come, first served; joining the waitlist does not reserve a place.";
    const vipSeat = "A VIP seat is available at $447/month or $4,497/year. The monthly option has a six-month minimum totaling $2,682, then continues month-to-month. Available seats are first come, first served.";

    expect(tierMessage("member", status({ phase: "founding" }))).toBe(generalFounding);
    expect(tierMessage("member", status({ phase: "standard", foundingRemaining: 0 }))).toBe(generalStandard);
    const vip = DEFAULT_LOUNGE_PRICING.vip;
    expect(tierMessage("vip", vip)).toBe(vipFounding);
    expect(tierMessage("vip", { ...vip, phase: "standard", foundingRemaining: 0, waitlist: true, purchasable: false, seatsAvailable: 0 })).toBe(vipFull);
    expect(tierMessage("vip", { ...vip, phase: "standard", foundingRemaining: 0, seatsAvailable: 1 })).toBe(vipSeat);
    // General's line does not move when VIP fills, and the other way round.
    expect(tierMessage("member", status({ phase: "founding" }))).toBe(generalFounding);
    expect(LOUNGE_TERMS_LINE).toBe("Monthly plans have a six-month minimum commitment, then continue month-to-month unless canceled. Annual prices cover one year.");
    // No countdowns or remaining-place counts anywhere in the lines.
    for (const text of Object.values(LOUNGE_BLOCKS)) expect(text).not.toMatch(/\b(only|left|remaining|hurry|ends|deadline)\b/i);
  });

  it("knows which checkouts are the Lounge", () => {
    expect(tierIdFor("the-lounge")).toBe("member");
    expect(tierIdFor("the-lounge-vip")).toBe("vip");
    expect(tierIdFor("the-boss-club")).toBeNull();
  });
});
