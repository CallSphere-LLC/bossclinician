import { describe, expect, it } from "vitest";
import { bumpSortWrites, installmentInput, nextUpsellStep, offerPricingErrors } from "./OfferEditor";

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

describe("payment count box", () => {
  it("keeps a lone 1 so 12 can be typed, instead of snapping it to 2", () => {
    // Typing "12" arrives as "1" then "12"; flooring the first keystroke at 2
    // turned the box into "2" and the second keystroke into 22 payments.
    expect(installmentInput("1")).toBe(1);
    expect(installmentInput("12")).toBe(12);
  });

  it("reads an empty box as no count, and caps at 60", () => {
    expect(installmentInput("")).toBeNull();
    expect(installmentInput("400")).toBe(60);
  });

  it("still refuses fewer than two payments at save time", () => {
    expect(
      offerPricingErrors({
        pricingType: "payment_plan",
        amountCents: 125000,
        minAmountCents: 0,
        installmentCount: installmentInput("1"),
      }),
    ).toEqual({ installmentCount: "Choose at least two payments." });
  });
});

describe("reordering order bumps", () => {
  it("rewrites every position when the stored sorts are tied", () => {
    // Bumps at sorts 0,1,2,3; the first two removed; a new one added at
    // bumps.length (2). Listed by (sort, id): C(2), E(2), D(3).
    const bumps = [
      { id: 3, sort: 2 },
      { id: 5, sort: 2 },
      { id: 4, sort: 3 },
    ];
    // Moving D up used to write D=1, E=2 and leave C at 2 — so D jumped to the top.
    const writes = bumpSortWrites(bumps, 2, 1);
    const sorts = new Map(bumps.map((bump) => [bump.id, bump.sort]));
    for (const write of writes) sorts.set(write.id, write.sort);
    const order = [...sorts.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([id]) => id);
    expect(order).toEqual([3, 4, 5]);
  });

  it("writes nothing for rows already in place", () => {
    const writes = bumpSortWrites(
      [
        { id: 1, sort: 0 },
        { id: 2, sort: 1 },
        { id: 3, sort: 2 },
      ],
      0,
      1,
    );
    expect(writes).toEqual([
      { id: 2, sort: 0 },
      { id: 1, sort: 1 },
    ]);
  });
});

describe("a new upsell's step", () => {
  it("goes after the last step, not into a gap left by a removed one", () => {
    expect(nextUpsellStep(new Set([2, 3]))).toBe(4);
    expect(nextUpsellStep(new Set())).toBe(1);
  });

  it("falls back to a free gap once the last step is taken", () => {
    expect(nextUpsellStep(new Set([1, 20]))).toBe(2);
  });
});
