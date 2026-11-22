import { describe, expect, it } from "vitest";
import { DEFAULT_LOUNGE_PRICING, LOUNGE_PRICES, tierIdFor, tierMessage, type LoungeTierStatus } from "./loungePricing";

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

  it("changes each tier's line on its own limit", () => {
    expect(tierMessage("member", status({ phase: "founding" }))).toContain("first 20 paid Lounge Members");
    expect(tierMessage("member", status({ phase: "standard" }))).toContain("$247/month or $2,497/year");
    const vip = DEFAULT_LOUNGE_PRICING.vip;
    expect(tierMessage("vip", vip)).toContain("first six paid VIP members");
    expect(tierMessage("vip", { ...vip, phase: "standard", waitlist: true, purchasable: false, seatsAvailable: 0 })).toContain("Join the VIP waitlist");
    expect(tierMessage("vip", { ...vip, phase: "standard", seatsAvailable: 1 })).toContain("$447/month or $4,497/year");
  });

  it("knows which checkouts are the Lounge", () => {
    expect(tierIdFor("the-lounge")).toBe("member");
    expect(tierIdFor("the-lounge-vip")).toBe("vip");
    expect(tierIdFor("the-boss-club")).toBeNull();
  });
});
