import { describe, expect, it } from "vitest";
import {
  courseTabOf,
  courseTabPath,
  grantSourceLabel,
  matchesCustomer,
  newCourseOfferInput,
  offerPriceLabel,
  priceCentsFromInput,
  progressPercent,
  replayLessonTitle,
  splitCustomers,
} from "./courseHub";
import type { CourseCustomer } from "./courseHubApi";

describe("courseTabOf", () => {
  it("opens the tab the address names", () => {
    expect(courseTabOf("offers")).toBe("offers");
    expect(courseTabOf("Customers")).toBe("customers");
    expect(courseTabOf("settings")).toBe("settings");
  });

  it("falls back to the outline for anything else", () => {
    expect(courseTabOf(null)).toBe("outline");
    expect(courseTabOf("")).toBe("outline");
    expect(courseTabOf("billing")).toBe("outline");
  });

  it("builds the address each tab lives at", () => {
    expect(courseTabPath(65, "outline")).toBe("/admin/courses/65/curriculum");
    expect(courseTabPath(65, "offers")).toBe("/admin/courses/65/curriculum?tab=offers");
  });
});

describe("offerPriceLabel", () => {
  const base = { currency: "usd", interval: null, intervalCount: 1, installmentCount: null } as const;

  it("says each pricing the way she would", () => {
    expect(offerPriceLabel({ ...base, pricingType: "one_time", amountCents: 49700 })).toBe("$497");
    expect(offerPriceLabel({ ...base, pricingType: "one_time", amountCents: 49750 })).toBe("$497.50");
    expect(offerPriceLabel({ ...base, pricingType: "free", amountCents: 0 })).toBe("Free");
    expect(
      offerPriceLabel({ ...base, pricingType: "subscription", amountCents: 4900, interval: "month" }),
    ).toBe("$49 / month");
    expect(
      offerPriceLabel({
        ...base,
        pricingType: "payment_plan",
        amountCents: 125000,
        interval: "month",
        installmentCount: 3,
      }),
    ).toBe("3 × $1,250 / month");
    expect(offerPriceLabel({ ...base, pricingType: "pwyw", amountCents: 1000 })).toBe(
      "Pay what you want, from $10",
    );
  });
});

describe("progressPercent", () => {
  it("is a whole percent of the published lessons", () => {
    expect(progressPercent(0, 10)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(10, 10)).toBe(100);
  });

  it("never divides by an empty course or passes 100", () => {
    expect(progressPercent(3, 0)).toBe(0);
    expect(progressPercent(12, 10)).toBe(100);
  });
});

const customer = (overrides: Partial<CourseCustomer>): CourseCustomer => ({
  memberId: 1,
  contactId: null,
  email: "ada@example.com",
  name: "Ada Lovelace",
  source: "purchase",
  offerId: null,
  offerTitle: null,
  grantedAt: "2026-10-01T00:00:00Z",
  expiresAt: null,
  revokedAt: null,
  status: "active",
  lessonsCompleted: 0,
  lastActiveAt: null,
  ...overrides,
});

describe("customers", () => {
  it("names where access came from", () => {
    expect(grantSourceLabel(customer({ source: "purchase", offerTitle: "The Board Room" }))).toBe(
      "Bought it · The Board Room",
    );
    expect(grantSourceLabel(customer({ source: "import" }))).toBe("Moved over from Kajabi");
    expect(grantSourceLabel(customer({ source: "manual" }))).toBe("Given by you");
  });

  it("keeps people whose access ended out of the current list", () => {
    const { current, former } = splitCustomers([
      customer({ memberId: 1 }),
      customer({ memberId: 2, status: "revoked" }),
      customer({ memberId: 3, status: "expired" }),
    ]);
    expect(current.map((c) => c.memberId)).toEqual([1]);
    expect(former.map((c) => c.memberId)).toEqual([2, 3]);
  });

  it("searches by name or email", () => {
    expect(matchesCustomer(customer({}), "  LOVE ")).toBe(true);
    expect(matchesCustomer(customer({}), "example.com")).toBe(true);
    expect(matchesCustomer(customer({}), "grace")).toBe(false);
    expect(matchesCustomer(customer({}), "")).toBe(true);
  });
});

describe("newCourseOfferInput", () => {
  it("is a one-time draft at the price she typed", () => {
    const input = newCourseOfferInput("The Board Room", "the-board-room", 99700);
    expect(input).toMatchObject({ status: "draft", pricingType: "one_time", amountCents: 99700 });
  });

  it("is Free rather than a $0 one-time price the server refuses", () => {
    expect(newCourseOfferInput("X", "x", null)).toMatchObject({ pricingType: "free", amountCents: 0 });
    expect(newCourseOfferInput("X", "x", 0)).toMatchObject({ pricingType: "free", amountCents: 0 });
  });
});

describe("priceCentsFromInput", () => {
  it("reads what she types", () => {
    expect(priceCentsFromInput("497")).toBe(49700);
    expect(priceCentsFromInput("$1,250.50")).toBe(125050);
    expect(priceCentsFromInput("")).toBeNull();
    expect(priceCentsFromInput("1.2.3")).toBeUndefined();
  });
});

describe("replayLessonTitle", () => {
  it("marks the lesson as the replay once", () => {
    expect(replayLessonTitle("Monthly Q&A")).toBe("Monthly Q&A (replay)");
    expect(replayLessonTitle("Q&A replay")).toBe("Q&A replay");
    expect(replayLessonTitle("  ")).toBe("Live session (replay)");
  });
});
