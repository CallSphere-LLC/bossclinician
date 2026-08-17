import { describe, expect, it } from "vitest";
import { formatAmount } from "./money";

/**
 * The one thing this wrapper exists to stop.
 *
 * `Intl.NumberFormat` throws a RangeError on a currency code it does not
 * recognise, and the two surfaces that reach it here run at the worst possible
 * moment: a receipt is rendered after the payment has been recorded, so a throw
 * fails the webhook handler over a typo in a three-letter column, and the
 * billing page is the screen a customer opens when they are already worried
 * about money.
 */
describe("formatAmount", () => {
  it("formats a known currency exactly as pricing.ts does", () => {
    expect(formatAmount(2700, "usd")).toBe("$27.00");
    expect(formatAmount(375_000, "USD")).toBe("$3,750.00");
    expect(formatAmount(0, "usd")).toBe("$0.00");
  });

  it("falls back to a blank currency without throwing", () => {
    expect(formatAmount(2700, "")).toBe("$27.00");
  });

  it("prints the code beside the amount rather than throwing on a bad one", () => {
    // The shapes a hand-written or imported row actually holds.
    for (const code of ["dollars", "US$", "u", "12345"]) {
      expect(() => formatAmount(199_900, code)).not.toThrow();
    }
    expect(formatAmount(199_900, "dollars")).toBe("DOLLARS 1999.00");
  });

  it("never substitutes a currency of its own choosing", () => {
    // Printing an unrecognised code as dollars would be a receipt that says
    // something untrue about what was charged.
    expect(formatAmount(1000, "dollars")).not.toContain("$");
    expect(formatAmount(1000, "dollars")).toBe("DOLLARS 10.00");
  });
});
