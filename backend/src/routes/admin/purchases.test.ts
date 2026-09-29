import { describe, expect, it, vi } from "vitest";
import { couponFacts, type CouponOrderRow } from "./purchases";

// The router module imports the pool; deriving a coupon needs no database.
vi.mock("../../db/pool", () => ({ pool: { query: vi.fn() } }));

function order(over: Partial<CouponOrderRow> = {}): CouponOrderRow {
  return {
    id: 1,
    purchase_id: null,
    subtotal_cents: 0,
    discount_cents: 0,
    frozen_code: null,
    coupon_code: null,
    redeemed_cents: null,
    ...over,
  };
}

const ONE_TIME = { kind: "one_time" as const, totalCents: 0 };

describe("couponFacts", () => {
  it("reads Kajabi's coupon from the purchase's meta, as its Order summary prints it", () => {
    expect(
      couponFacts(ONE_TIME, [], { coupon_code: "FREEBOSS", discount_cents: 399_700, subtotal_cents: 399_700 }),
    ).toEqual({ couponCode: "FREEBOSS", discountCents: 399_700, subtotalCents: 399_700 });
  });

  it("reads the camelCase spellings too", () => {
    expect(couponFacts(ONE_TIME, [], { couponCode: "CAMEL", discountCents: 500, subtotalCents: 500 })).toEqual({
      couponCode: "CAMEL",
      discountCents: 500,
      subtotalCents: 500,
    });
  });

  it("works the subtotal out of a one-time total when the import did not keep it", () => {
    expect(couponFacts({ kind: "one_time", totalCents: 2_000 }, [], { coupon_code: "TEN", discount_cents: "1000" })).toEqual({
      couponCode: "TEN",
      discountCents: 1_000,
      subtotalCents: 3_000,
    });
  });

  it("prefers our own checkout's order over the meta", () => {
    const paid = order({ subtotal_cents: 5_000, discount_cents: 1_500, frozen_code: "SPRING", coupon_code: "SPRING26" });
    expect(couponFacts(ONE_TIME, [order({ id: 2 }), paid], { coupon_code: "OLD", discount_cents: 1 })).toEqual({
      couponCode: "SPRING",
      discountCents: 1_500,
      subtotalCents: 5_000,
    });
  });

  it("falls back to the redemption ledger and the coupon's code when the order did not freeze them", () => {
    expect(
      couponFacts({ kind: "one_time", totalCents: 4_000 }, [order({ coupon_code: "LAUNCH", redeemed_cents: 1_000 })], null),
    ).toEqual({ couponCode: "LAUNCH", discountCents: 1_000, subtotalCents: 5_000 });
  });

  it("never guesses a plan's subtotal from its whole-plan total", () => {
    expect(couponFacts({ kind: "payment_plan", totalCents: 450_000 }, [], { coupon_code: "PLAN", discount_cents: 5_000 })).toEqual(
      { couponCode: "PLAN", discountCents: 5_000, subtotalCents: null },
    );
  });

  it("is all null when nothing records a coupon, and for a grant", () => {
    const none = { couponCode: null, discountCents: null, subtotalCents: null };
    expect(couponFacts(ONE_TIME, [order()], {})).toEqual(none);
    expect(couponFacts(ONE_TIME, [], { coupon_code: " ", discount_cents: 0 })).toEqual(none);
    expect(couponFacts({ kind: "grant", totalCents: 0 }, [], { coupon_code: "X" })).toEqual(none);
  });
});
