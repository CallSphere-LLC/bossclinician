import { describe, it, expect } from "vitest";
import {
  accessExpiresAt,
  addInterval,
  baseAmountCents,
  buildInstallmentSchedule,
  computeOrderTotal,
  couponDiscountCents,
  formatMoney,
  paymentPlanTotalCents,
  prorate,
  taxCents,
  type AppliedCoupon,
  type PricedOffer,
} from "./pricing";

/**
 * The offers these tests are built around are the real ones this business sells
 * on Kajabi today, so a regression here fails against actual prices rather than
 * invented ones.
 */
function offer(overrides: Partial<PricedOffer> = {}): PricedOffer {
  return {
    id: 1,
    title: "Test offer",
    currency: "usd",
    pricingType: "one_time",
    amountCents: 2700,
    minAmountCents: 0,
    interval: null,
    intervalCount: 1,
    installmentCount: null,
    trialDays: 0,
    ...overrides,
  };
}

const COACHING_3_PAY = offer({
  id: 10,
  title: "90 Day 1:1 Coaching Support - 3 x Payments",
  pricingType: "payment_plan",
  amountCents: 125_000,
  installmentCount: 3,
  interval: "month",
});

const COACHING_PIF = offer({
  id: 11,
  title: "90 Day 1:1 Coaching Support - One Time Payment",
  pricingType: "one_time",
  amountCents: 350_000,
});

const PRIVATE_ROOM = offer({
  id: 12,
  title: "Private Room",
  pricingType: "payment_plan",
  amountCents: 40_000,
  installmentCount: 10,
  interval: "month",
});

const CREDENTIALING_KIT = offer({
  id: 13,
  title: "Credentialing With Confidence Kit",
  pricingType: "one_time",
  amountCents: 2700,
});

describe("baseAmountCents", () => {
  it("charges the offer amount for a one-time offer", () => {
    expect(baseAmountCents(CREDENTIALING_KIT)).toBe(2700);
  });

  it("charges nothing for a free offer", () => {
    expect(baseAmountCents(offer({ pricingType: "free", amountCents: 9900 }))).toBe(0);
  });

  it("charges ONE installment for a payment plan, not the contract total", () => {
    // The distinction that matters: the customer's card is hit for $1,250
    // today, not $3,750.
    expect(baseAmountCents(COACHING_3_PAY)).toBe(125_000);
    expect(paymentPlanTotalCents(COACHING_3_PAY)).toBe(375_000);
  });

  it("honours a pay-what-you-want amount above the floor", () => {
    const pwyw = offer({ pricingType: "pwyw", amountCents: 0, minAmountCents: 500 });
    expect(baseAmountCents(pwyw, 2500)).toBe(2500);
  });

  it("raises a below-floor pay-what-you-want amount to the floor", () => {
    const pwyw = offer({ pricingType: "pwyw", amountCents: 0, minAmountCents: 500 });
    expect(baseAmountCents(pwyw, 100)).toBe(500);
  });

  it("falls back to the floor when no pay-what-you-want amount is given", () => {
    const pwyw = offer({ pricingType: "pwyw", amountCents: 0, minAmountCents: 500 });
    expect(baseAmountCents(pwyw)).toBe(500);
  });

  it("rejects a fractional amount rather than sending it to Stripe", () => {
    expect(() => baseAmountCents(offer({ amountCents: 2700.5 }))).toThrow(RangeError);
  });

  it("rejects a negative amount", () => {
    expect(() => baseAmountCents(offer({ amountCents: -100 }))).toThrow(RangeError);
  });
});

describe("couponDiscountCents", () => {
  const pct = (percentOff: number): AppliedCoupon => ({
    id: 1,
    code: "SAVE",
    percentOff,
    amountOffCents: null,
    duration: "first",
  });
  const flat = (amountOffCents: number): AppliedCoupon => ({
    id: 2,
    code: "FLAT",
    percentOff: null,
    amountOffCents,
    duration: "first",
  });

  it("takes a percentage off", () => {
    expect(couponDiscountCents(10_000, pct(20))).toBe(2000);
  });

  it("rounds a percentage to the nearest cent", () => {
    // 33% of $27.00 is 891.0 exactly; 33% of $9.99 is 329.67 -> 330.
    expect(couponDiscountCents(2700, pct(33))).toBe(891);
    expect(couponDiscountCents(999, pct(33))).toBe(330);
  });

  it("never discounts more than the amount itself", () => {
    // A $50-off coupon against the $27 kit must not produce a $23 refund.
    expect(couponDiscountCents(2700, flat(5000))).toBe(2700);
  });

  it("caps a percentage over 100", () => {
    expect(couponDiscountCents(2700, pct(150))).toBe(2700);
  });

  it("returns zero for no coupon, a zero amount, or a zero-value coupon", () => {
    expect(couponDiscountCents(2700, null)).toBe(0);
    expect(couponDiscountCents(2700, undefined)).toBe(0);
    expect(couponDiscountCents(0, pct(20))).toBe(0);
    expect(couponDiscountCents(2700, pct(0))).toBe(0);
    expect(couponDiscountCents(2700, flat(0))).toBe(0);
  });

  it("ignores a negative discount rather than adding money to the order", () => {
    expect(couponDiscountCents(2700, pct(-20))).toBe(0);
    expect(couponDiscountCents(2700, flat(-500))).toBe(0);
  });
});

describe("taxCents", () => {
  it("computes basis points correctly", () => {
    // NYC 8.875% on $100.00
    expect(taxCents(10_000, 887)).toBe(887);
  });

  it("rounds to the nearest cent", () => {
    expect(taxCents(2700, 887)).toBe(239); // 239.49 -> 239
    expect(taxCents(2750, 887)).toBe(244); // 243.925 -> 244
  });

  it("is zero for a zero base or a zero rate", () => {
    expect(taxCents(0, 887)).toBe(0);
    expect(taxCents(10_000, 0)).toBe(0);
  });
});

describe("computeOrderTotal", () => {
  it("prices a bare one-time offer", () => {
    const total = computeOrderTotal({ offer: CREDENTIALING_KIT });
    expect(total.subtotalCents).toBe(2700);
    expect(total.discountCents).toBe(0);
    expect(total.taxCents).toBe(0);
    expect(total.totalCents).toBe(2700);
    expect(total.lines).toHaveLength(1);
    expect(total.lines[0]).toMatchObject({ kind: "offer", amountCents: 2700 });
  });

  it("adds order bumps to the subtotal as their own lines", () => {
    const total = computeOrderTotal({
      offer: CREDENTIALING_KIT,
      bumps: [
        { id: 1, productId: 5, title: "Therapist Directory Guide", amountCents: 4700 },
        { id: 2, productId: 6, title: "Fully Booked Toolkit", amountCents: 1900 },
      ],
    });
    expect(total.subtotalCents).toBe(2700 + 4700 + 1900);
    expect(total.totalCents).toBe(9300);
    expect(total.lines.map((l) => l.kind)).toEqual(["offer", "bump", "bump"]);
  });

  it("discounts the whole order including bumps", () => {
    const total = computeOrderTotal({
      offer: CREDENTIALING_KIT,
      bumps: [{ id: 1, productId: 5, title: "Guide", amountCents: 4700 }],
      coupon: { id: 1, code: "SAVE20", percentOff: 20, amountOffCents: null, duration: "first" },
    });
    expect(total.subtotalCents).toBe(7400);
    expect(total.discountCents).toBe(1480);
    expect(total.totalCents).toBe(5920);
  });

  it("taxes the discounted amount, not the list price", () => {
    // The ordering that matters: tax is owed on what was actually paid.
    const total = computeOrderTotal({
      offer: offer({ amountCents: 10_000 }),
      coupon: { id: 1, code: "HALF", percentOff: 50, amountOffCents: null, duration: "first" },
      taxRateBps: 1000, // 10%
    });
    expect(total.subtotalCents).toBe(10_000);
    expect(total.discountCents).toBe(5000);
    expect(total.taxableCents).toBe(5000);
    expect(total.taxCents).toBe(500);
    expect(total.totalCents).toBe(5500);
  });

  it("never produces a negative total when the coupon exceeds the order", () => {
    const total = computeOrderTotal({
      offer: CREDENTIALING_KIT,
      coupon: { id: 1, code: "BIG", percentOff: null, amountOffCents: 999_999, duration: "first" },
      taxRateBps: 887,
    });
    expect(total.discountCents).toBe(2700);
    expect(total.taxableCents).toBe(0);
    expect(total.taxCents).toBe(0);
    expect(total.totalCents).toBe(0);
  });

  it("charges one installment for a payment-plan offer at checkout", () => {
    const total = computeOrderTotal({ offer: COACHING_3_PAY });
    expect(total.totalCents).toBe(125_000);
  });

  it("prices a free offer at zero", () => {
    const total = computeOrderTotal({ offer: offer({ pricingType: "free" }), taxRateBps: 887 });
    expect(total.totalCents).toBe(0);
    expect(total.taxCents).toBe(0);
  });
});

describe("addInterval", () => {
  it("adds days and weeks", () => {
    expect(addInterval(new Date("2026-01-01T00:00:00Z"), "day", 30).toISOString()).toBe(
      "2026-01-31T00:00:00.000Z",
    );
    expect(addInterval(new Date("2026-01-01T00:00:00Z"), "week", 2).toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
  });

  it("clamps a month-end date instead of overflowing into the next month", () => {
    // Naive setMonth turns 31 Jan + 1 month into 3 March. Charging on a date
    // that does not exist in February is a real support ticket.
    expect(addInterval(new Date("2026-01-31T00:00:00Z"), "month", 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addInterval(new Date("2026-03-31T00:00:00Z"), "month", 1).toISOString()).toBe(
      "2026-04-30T00:00:00.000Z",
    );
  });

  it("handles a leap year", () => {
    expect(addInterval(new Date("2028-01-31T00:00:00Z"), "month", 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("adds years, clamping 29 February", () => {
    expect(addInterval(new Date("2028-02-29T00:00:00Z"), "year", 1).toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("does not mutate the input date", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    addInterval(start, "month", 6);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("buildInstallmentSchedule", () => {
  it("splits an evenly divisible total", () => {
    const schedule = buildInstallmentSchedule({
      totalCents: 375_000,
      installmentCount: 3,
      interval: "month",
      startAt: new Date("2026-01-15T00:00:00Z"),
    });
    expect(schedule.map((s) => s.amountCents)).toEqual([125_000, 125_000, 125_000]);
    expect(schedule.reduce((a, s) => a + s.amountCents, 0)).toBe(375_000);
  });

  it("charges the first installment immediately", () => {
    const start = new Date("2026-01-15T00:00:00Z");
    const schedule = buildInstallmentSchedule({
      totalCents: 375_000,
      installmentCount: 3,
      interval: "month",
      startAt: start,
    });
    expect(schedule[0].dueAt.toISOString()).toBe(start.toISOString());
    expect(schedule[1].dueAt.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(schedule[2].dueAt.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("puts the rounding remainder on the LAST installment", () => {
    // $100.00 in 3 payments: 33.33 + 33.33 + 33.34. The customer is quoted the
    // round number up front and the odd cent lands where nobody notices it.
    const schedule = buildInstallmentSchedule({
      totalCents: 10_000,
      installmentCount: 3,
      interval: "month",
      startAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(schedule.map((s) => s.amountCents)).toEqual([3333, 3333, 3334]);
    expect(schedule.reduce((a, s) => a + s.amountCents, 0)).toBe(10_000);
  });

  it("always sums back to exactly the total, across many awkward splits", () => {
    for (let total = 1; total <= 2000; total += 7) {
      for (const count of [2, 3, 4, 6, 7, 10, 12]) {
        const schedule = buildInstallmentSchedule({
          totalCents: total,
          installmentCount: count,
          interval: "month",
          startAt: new Date("2026-01-01T00:00:00Z"),
        });
        expect(schedule.reduce((a, s) => a + s.amountCents, 0)).toBe(total);
        expect(schedule).toHaveLength(count);
      }
    }
  });

  it("honours a multi-month interval (4 x every 3 months)", () => {
    // "12 Month 1:1 Consulting Support - 4 x Payments" — $3,000 every 3 months.
    const schedule = buildInstallmentSchedule({
      totalCents: 1_200_000,
      installmentCount: 4,
      interval: "month",
      intervalCount: 3,
      startAt: new Date("2026-01-10T00:00:00Z"),
    });
    expect(schedule.map((s) => s.amountCents)).toEqual([300_000, 300_000, 300_000, 300_000]);
    expect(schedule.map((s) => s.dueAt.toISOString())).toEqual([
      "2026-01-10T00:00:00.000Z",
      "2026-04-10T00:00:00.000Z",
      "2026-07-10T00:00:00.000Z",
      "2026-10-10T00:00:00.000Z",
    ]);
  });

  it("schedules the 10 x $400 Private Room plan", () => {
    const schedule = buildInstallmentSchedule({
      totalCents: paymentPlanTotalCents(PRIVATE_ROOM),
      installmentCount: PRIVATE_ROOM.installmentCount as number,
      interval: "month",
      startAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(schedule).toHaveLength(10);
    expect(schedule.every((s) => s.amountCents === 40_000)).toBe(true);
  });

  it("rejects a zero or negative installment count", () => {
    const base = {
      totalCents: 10_000,
      interval: "month" as const,
      startAt: new Date("2026-01-01T00:00:00Z"),
    };
    expect(() => buildInstallmentSchedule({ ...base, installmentCount: 0 })).toThrow(RangeError);
    expect(() => buildInstallmentSchedule({ ...base, installmentCount: -3 })).toThrow(RangeError);
    expect(() => buildInstallmentSchedule({ ...base, installmentCount: 2.5 })).toThrow(RangeError);
  });
});

describe("prorate", () => {
  const periodStart = new Date("2026-01-01T00:00:00Z");
  const periodEnd = new Date("2026-02-01T00:00:00Z");

  it("credits and charges nothing at the very end of a period", () => {
    const result = prorate({
      oldAmountCents: 10_000,
      newAmountCents: 20_000,
      periodStart,
      periodEnd,
      changeAt: periodEnd,
    });
    expect(result.creditCents).toBe(0);
    expect(result.chargeCents).toBe(0);
    expect(result.netCents).toBe(0);
  });

  it("credits and charges in full at the very start of a period", () => {
    const result = prorate({
      oldAmountCents: 10_000,
      newAmountCents: 20_000,
      periodStart,
      periodEnd,
      changeAt: periodStart,
    });
    expect(result.creditCents).toBe(10_000);
    expect(result.chargeCents).toBe(20_000);
    expect(result.netCents).toBe(10_000);
  });

  it("splits proportionally at the halfway point", () => {
    const result = prorate({
      oldAmountCents: 10_000,
      newAmountCents: 20_000,
      periodStart,
      periodEnd,
      changeAt: new Date("2026-01-16T12:00:00Z"), // exactly half of a 31-day period
    });
    expect(result.creditCents).toBe(5000);
    expect(result.chargeCents).toBe(10_000);
    expect(result.netCents).toBe(5000);
  });

  it("returns a negative net when downgrading", () => {
    const result = prorate({
      oldAmountCents: 20_000,
      newAmountCents: 10_000,
      periodStart,
      periodEnd,
      changeAt: periodStart,
    });
    expect(result.netCents).toBe(-10_000);
  });

  it("clamps a change date outside the period rather than over-crediting", () => {
    const before = prorate({
      oldAmountCents: 10_000,
      newAmountCents: 10_000,
      periodStart,
      periodEnd,
      changeAt: new Date("2025-12-01T00:00:00Z"),
    });
    expect(before.creditCents).toBe(10_000);

    const after = prorate({
      oldAmountCents: 10_000,
      newAmountCents: 10_000,
      periodStart,
      periodEnd,
      changeAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(after.creditCents).toBe(0);
  });

  it("rejects a period that ends before it starts", () => {
    expect(() =>
      prorate({
        oldAmountCents: 10_000,
        newAmountCents: 10_000,
        periodStart: periodEnd,
        periodEnd: periodStart,
        changeAt: periodStart,
      }),
    ).toThrow(RangeError);
  });
});

describe("accessExpiresAt", () => {
  it("returns null for access that never expires", () => {
    expect(accessExpiresAt(new Date("2026-01-01T00:00:00Z"), null)).toBeNull();
  });

  it("adds the configured number of days", () => {
    expect(
      accessExpiresAt(new Date("2026-01-01T00:00:00Z"), 365)?.toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rejects a zero or negative window", () => {
    expect(() => accessExpiresAt(new Date(), 0)).toThrow(RangeError);
    expect(() => accessExpiresAt(new Date(), -30)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("formats whole and fractional dollars", () => {
    expect(formatMoney(2700)).toBe("$27.00");
    expect(formatMoney(375_000)).toBe("$3,750.00");
    expect(formatMoney(0)).toBe("$0.00");
  });
});
