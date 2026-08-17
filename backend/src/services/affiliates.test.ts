import { describe, it, expect } from "vitest";
import { pickRule, type CommissionCandidate } from "./affiliates";
import { commissionCents } from "./pricing";

/**
 * The two pure halves of "what does this partner get paid".
 *
 * Precedence and arithmetic are separated deliberately, and both are tested
 * without a database: between them they decide what a real person is owed, and
 * a rule that a test cannot reach is a rule nobody can check before it is wrong
 * in somebody's bank account.
 */

const AFFILIATE = 7;
const OTHER_AFFILIATE = 8;
const RETREAT = 42;
const TRIPWIRE = 43;

/** The partner's own columns — the fallback the migration calls the program default. */
const rowDefault: CommissionCandidate = {
  affiliateId: AFFILIATE,
  offerId: null,
  type: "percent",
  rateBps: 3000,
  fixedCents: 0,
  recurring: false,
};

function rule(overrides: Partial<CommissionCandidate>): CommissionCandidate {
  return { ...rowDefault, ...overrides };
}

describe("commission rule precedence", () => {
  it("falls back to the partner's own columns when no rule exists", () => {
    const { candidate, source } = pickRule([], rowDefault, AFFILIATE, RETREAT);
    expect(source).toBe("program_default");
    expect(candidate.rateBps).toBe(3000);
  });

  it("prefers a rule for this partner on this offer over everything else", () => {
    const candidates = [
      rule({ affiliateId: null, offerId: RETREAT, rateBps: 4000 }),
      rule({ affiliateId: AFFILIATE, offerId: null, rateBps: 5000 }),
      rule({ affiliateId: AFFILIATE, offerId: RETREAT, rateBps: 6000 }),
    ];
    const { candidate, source } = pickRule(candidates, rowDefault, AFFILIATE, RETREAT);
    expect(source).toBe("affiliate_offer");
    expect(candidate.rateBps).toBe(6000);
  });

  it("uses the program-wide rule for the offer ahead of the partner's own default", () => {
    const candidates = [
      rule({ affiliateId: AFFILIATE, offerId: null, rateBps: 5000 }),
      rule({ affiliateId: null, offerId: RETREAT, rateBps: 4000 }),
    ];
    const { candidate, source } = pickRule(candidates, rowDefault, AFFILIATE, RETREAT);
    expect(source).toBe("offer");
    expect(candidate.rateBps).toBe(4000);
  });

  it("uses the partner's own rule when nothing covers the offer", () => {
    const candidates = [
      rule({ affiliateId: AFFILIATE, offerId: null, rateBps: 5000 }),
      rule({ affiliateId: null, offerId: TRIPWIRE, rateBps: 1000 }),
    ];
    const { candidate, source } = pickRule(candidates, rowDefault, AFFILIATE, RETREAT);
    expect(source).toBe("affiliate_default");
    expect(candidate.rateBps).toBe(5000);
  });

  it("never picks another partner's rule", () => {
    const candidates = [rule({ affiliateId: OTHER_AFFILIATE, offerId: RETREAT, rateBps: 9000 })];
    const { candidate, source } = pickRule(candidates, rowDefault, AFFILIATE, RETREAT);
    expect(source).toBe("program_default");
    expect(candidate.rateBps).toBe(3000);
  });

  it("ignores offer-scoped rules when the order has no offer", () => {
    const candidates = [
      rule({ affiliateId: AFFILIATE, offerId: RETREAT, rateBps: 6000 }),
      rule({ affiliateId: null, offerId: RETREAT, rateBps: 4000 }),
    ];
    const { source } = pickRule(candidates, rowDefault, AFFILIATE, null);
    expect(source).toBe("program_default");
  });

  it("carries the 'pays no commission' rule rather than falling through it", () => {
    const candidates = [rule({ affiliateId: null, offerId: TRIPWIRE, type: "none" })];
    const { candidate, source } = pickRule(candidates, rowDefault, AFFILIATE, TRIPWIRE);
    expect(source).toBe("offer");
    expect(candidate.type).toBe("none");
  });
});

describe("commission arithmetic", () => {
  it("takes a percentage of the basis", () => {
    // 30% of the real $997 package.
    expect(commissionCents(99_700, { type: "percent", rateBps: 3000, fixedCents: 0 })).toBe(29_910);
  });

  it("rounds a percentage to the nearest cent", () => {
    // 33.33% of $27.00 is 899.91 cents.
    expect(commissionCents(2700, { type: "percent", rateBps: 3333, fixedCents: 0 })).toBe(900);
  });

  it("pays a flat fee regardless of the sale price", () => {
    expect(commissionCents(99_700, { type: "fixed", rateBps: 0, fixedCents: 5000 })).toBe(5000);
  });

  it("never pays more than the sale collected", () => {
    // A $50 flat fee on a $27 tripwire pays $27, not $50.
    expect(commissionCents(2700, { type: "fixed", rateBps: 0, fixedCents: 5000 })).toBe(2700);
    // A rate typed as 30000 instead of 3000 is capped at the whole sale.
    expect(commissionCents(2700, { type: "percent", rateBps: 30_000, fixedCents: 0 })).toBe(2700);
  });

  it("pays nothing on a rule of type none, whatever its numbers say", () => {
    expect(commissionCents(99_700, { type: "none", rateBps: 5000, fixedCents: 5000 })).toBe(0);
  });

  it("pays nothing on a zero basis", () => {
    expect(commissionCents(0, { type: "percent", rateBps: 3000, fixedCents: 0 })).toBe(0);
  });

  it("pays nothing when the rate or fee is zero or negative", () => {
    expect(commissionCents(2700, { type: "percent", rateBps: 0, fixedCents: 0 })).toBe(0);
    expect(commissionCents(2700, { type: "percent", rateBps: -100, fixedCents: 0 })).toBe(0);
    expect(commissionCents(2700, { type: "fixed", rateBps: 0, fixedCents: -100 })).toBe(0);
  });

  it("refuses a basis that is not a whole number of cents", () => {
    expect(() => commissionCents(27.5, { type: "percent", rateBps: 3000, fixedCents: 0 })).toThrow(
      RangeError
    );
    expect(() => commissionCents(-2700, { type: "percent", rateBps: 3000, fixedCents: 0 })).toThrow(
      RangeError
    );
  });

  it("returns whole cents for every rate between 1% and 100%", () => {
    for (let bps = 100; bps <= 10_000; bps += 100) {
      const amount = commissionCents(99_700, { type: "percent", rateBps: bps, fixedCents: 0 });
      expect(Number.isInteger(amount)).toBe(true);
      expect(amount).toBeLessThanOrEqual(99_700);
    }
  });
});
