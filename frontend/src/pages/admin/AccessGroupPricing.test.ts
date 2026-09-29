import { describe, expect, it } from "vitest";
import type { AdminAccessGroup } from "@/types/admin";
import {
  PAID_PRICE_TYPES,
  groupPricingForm,
  groupPricingPayload,
  groupPricingSummary,
} from "./AccessGroupPricing";

const group = (over: Partial<AdminAccessGroup>): AdminAccessGroup => ({
  id: 1,
  name: "Boss Clinician Lounge",
  description: "",
  sort: 0,
  memberCount: 0,
  channelCount: 0,
  createdAt: "2026-09-29T00:00:00Z",
  ...over,
});

describe("access group pricing (Kajabi's choices)", () => {
  it("labels the paid price types as Kajabi does", () => {
    expect(PAID_PRICE_TYPES.map((t) => t.label)).toEqual([
      "One-time payment",
      "Subscription",
      "Multiple payments",
    ]);
  });

  it("a new group starts free", () => {
    expect(groupPricingPayload(groupPricingForm())).toEqual({
      pricingType: "free",
      amountCents: 0,
      currency: "usd",
      interval: null,
    });
  });

  it("sends a one-time price without an interval", () => {
    const form = { ...groupPricingForm(), pricingType: "one_time" as const, amount: "1997" };
    expect(groupPricingPayload(form)).toEqual({
      pricingType: "one_time",
      amountCents: 199700,
      currency: "usd",
      interval: null,
    });
  });

  it("sends a subscription with its billing frequency and free trial", () => {
    const form = {
      ...groupPricingForm(),
      pricingType: "subscription" as const,
      amount: "47",
      interval: "year" as const,
      trialDays: "14",
    };
    expect(groupPricingPayload(form)).toEqual({
      pricingType: "subscription",
      amountCents: 4700,
      currency: "usd",
      interval: "year",
      trialDays: 14,
    });
  });

  it("never sends a weekly subscription", () => {
    const form = {
      ...groupPricingForm(),
      pricingType: "subscription" as const,
      amount: "47",
      interval: "week" as const,
    };
    expect(groupPricingPayload(form)).toMatchObject({ interval: "month", trialDays: 0 });
  });

  it("sends Multiple payments as a payment plan: count, amount of one payment, frequency", () => {
    const form = {
      ...groupPricingForm(),
      pricingType: "payment_plan" as const,
      amount: "197",
      installmentCount: "6",
      interval: "month" as const,
    };
    expect(groupPricingPayload(form)).toEqual({
      pricingType: "payment_plan",
      amountCents: 19700,
      currency: "usd",
      interval: "month",
      installmentCount: 6,
    });
  });

  it("an edit of an unpriced group leaves its pricing alone", () => {
    expect(groupPricingForm(group({})).pricingType).toBe("");
    expect(groupPricingPayload(groupPricingForm(group({})))).toEqual({});
  });

  it("round-trips a saved payment plan into the edit form", () => {
    const form = groupPricingForm(
      group({ pricingType: "payment_plan", amountCents: 19700, interval: "month", installmentCount: 6 }),
    );
    expect(form).toMatchObject({ pricingType: "payment_plan", amount: "197.00", installmentCount: "6", interval: "month" });
  });

  it("summarises each price type", () => {
    expect(groupPricingSummary(group({}))).toBe("No pricing set");
    expect(groupPricingSummary(group({ pricingType: "free", amountCents: 0 }))).toBe("Free access");
    expect(groupPricingSummary(group({ pricingType: "subscription", amountCents: 4700, interval: "month", trialDays: 7 }))).toBe(
      "$47.00 / month · 7-day free trial",
    );
    expect(groupPricingSummary(group({ pricingType: "payment_plan", amountCents: 19700, interval: "month", installmentCount: 6 }))).toBe(
      "6 monthly payments of $197.00 ($1,182.00 total)",
    );
  });

  it("shows the linked Lounge offer's extra payment option and that its checkout is a draft", () => {
    expect(
      groupPricingSummary(
        group({
          pricingType: "one_time",
          amountCents: 199700,
          checkoutStatus: "draft",
          checkoutOptionLabels: ["$197.00 every month for 6 months ($1,182 total)"],
        }),
      ),
    ).toBe(
      "$1,997.00 one-time payment · or $197.00 every month for 6 months ($1,182 total) · checkout is a draft (publish the offer to sell it)",
    );
  });
});
