import { describe, expect, it } from "vitest";
import { offerPricingErrors } from "./OfferEditor";

describe("offer price validation", () => {
  it("shows a concrete error for a paid offer with no price", () => {
    expect(
      offerPricingErrors({
        pricingType: "one_time",
        amountCents: 0,
        minAmountCents: 0,
        installmentCount: null,
      }),
    ).toEqual({ amountCents: "Enter a price greater than $0 before saving this offer." });
  });

  it("does not require a price for a free offer", () => {
    expect(
      offerPricingErrors({
        pricingType: "free",
        amountCents: 0,
        minAmountCents: 0,
        installmentCount: null,
      }),
    ).toEqual({});
  });
});
