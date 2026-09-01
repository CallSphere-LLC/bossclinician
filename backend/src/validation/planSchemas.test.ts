import { describe, expect, it } from "vitest";
import {
  PLAN_INTERVALS,
  planCreateSchema,
  planRepriceIssue,
  planUpdateSchema,
  type PlanPricing,
} from "./commerceSchemas";

/**
 * P0-9 regression: a plan that grants nothing, and cannot be corrected.
 *
 * The plan editor offered a name, a price, an interval and a trial, and no way
 * to edit any of them afterwards. `plans.community_id` — the one entitlement a
 * plan grants on its own, honoured all the way through the Stripe webhook and
 * the community door — was never on the form, so subscribing unlocked nothing,
 * and `features` and `published` were write-once dead data.
 *
 * These pin the parsing side of the fix: the fields exist, they are bounded,
 * and the rules that keep a live plan's price honest are arithmetic rather than
 * plumbing, so they are tested without a database or a Stripe key.
 */

const validPlan = {
  name: "Collective Membership",
  description: "Monthly group calls and the private community.",
  priceCents: 4_900,
  interval: "month",
  trialDays: 14,
  communityId: 7,
  features: ["Monthly group calls", "Every masterclass"],
  published: true,
};

describe("planCreateSchema", () => {
  it("accepts the plan the editor now sends, entitlement and all", () => {
    const parsed = planCreateSchema.safeParse(validPlan);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.communityId).toBe(7);
      expect(parsed.data.features).toEqual(["Monthly group calls", "Every masterclass"]);
      expect(parsed.data.published).toBe(true);
    }
  });

  it("refuses a plan with no name", () => {
    const parsed = planCreateSchema.safeParse({ ...validPlan, name: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.name).toBeDefined();
  });

  it("refuses a name that is only whitespace, which reads as nameless on the card", () => {
    expect(planCreateSchema.safeParse({ ...validPlan, name: "   " }).success).toBe(false);
  });

  it("drops fields nobody declared, so a stray key cannot reach buildUpdate", () => {
    const parsed = planCreateSchema.safeParse({ ...validPlan, id: 99, activeSubscribers: 12 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("id");
      expect(parsed.data).not.toHaveProperty("activeSubscribers");
    }
  });

  it("defaults the fields the old hand-parse defaulted", () => {
    const parsed = planCreateSchema.safeParse({ name: "Starter" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priceCents).toBe(0);
      expect(parsed.data.currency).toBe("usd");
      expect(parsed.data.interval).toBe("month");
      expect(parsed.data.trialDays).toBe(0);
      expect(parsed.data.published).toBe(true);
      expect(parsed.data.communityId).toBeNull();
      expect(parsed.data.features).toEqual([]);
      expect(parsed.data.slug).toBeUndefined();
    }
  });

  it("bills monthly or yearly and nothing else", () => {
    for (const interval of PLAN_INTERVALS) {
      expect(planCreateSchema.safeParse({ ...validPlan, interval }).success).toBe(true);
    }
    // A weekly price would be charged weekly by Stripe, counted as monthly
    // revenue by the MRR query and labelled "a month" on the card.
    expect(planCreateSchema.safeParse({ ...validPlan, interval: "week" }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, interval: "day" }).success).toBe(false);
  });

  it("holds the price to the same cents integer and ceiling as an offer", () => {
    expect(planCreateSchema.safeParse({ ...validPlan, priceCents: 49.5 }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, priceCents: -1 }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, priceCents: 99_999_999 }).success).toBe(true);
    expect(planCreateSchema.safeParse({ ...validPlan, priceCents: 100_000_000 }).success).toBe(false);
  });

  it("refuses a currency the site cannot render, naming the ones it can", () => {
    const parsed = planCreateSchema.safeParse({ ...validPlan, currency: "jpy" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.currency?.[0]).toMatch(/USD/);
    expect(planCreateSchema.safeParse({ ...validPlan, currency: " GBP " }).success).toBe(true);
  });

  it("normalises the currency to the lowercase Stripe wants", () => {
    const parsed = planCreateSchema.safeParse({ ...validPlan, currency: "CAD" });
    expect(parsed.success && parsed.data.currency).toBe("cad");
  });

  it("refuses a community reference that is not a real row id", () => {
    expect(planCreateSchema.safeParse({ ...validPlan, communityId: 0 }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, communityId: -3 }).success).toBe(false);
    // Null is the honest "this plan unlocks no community".
    expect(planCreateSchema.safeParse({ ...validPlan, communityId: null }).success).toBe(true);
  });

  it("keeps the trial inside a year, and out of negative numbers", () => {
    expect(planCreateSchema.safeParse({ ...validPlan, trialDays: 365 }).success).toBe(true);
    expect(planCreateSchema.safeParse({ ...validPlan, trialDays: 366 }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, trialDays: -1 }).success).toBe(false);
  });

  it("refuses an empty bullet, which prints as a blank line on the pricing card", () => {
    expect(planCreateSchema.safeParse({ ...validPlan, features: ["", "Real one"] }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, features: [] }).success).toBe(true);
  });

  it("refuses a slug that is not a usable web address", () => {
    expect(planCreateSchema.safeParse({ ...validPlan, slug: "Collective Membership" }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...validPlan, slug: "collective-membership" }).success).toBe(true);
  });
});

describe("planUpdateSchema", () => {
  it("treats an absent field as unchanged rather than filling in a default", () => {
    // The route hands whatever survives here to `buildUpdate`, so a default
    // leaking in would silently republish a draft or reset a trial.
    const parsed = planUpdateSchema.safeParse({ name: "Renamed" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).toEqual(["name"]);
      expect(parsed.data.published).toBeUndefined();
      expect(parsed.data.trialDays).toBeUndefined();
    }
  });

  it("lets an edit clear the community entitlement without clearing everything", () => {
    const parsed = planUpdateSchema.safeParse({ communityId: null });
    expect(parsed.success && parsed.data.communityId).toBeNull();
  });

  it("accepts a position, which create does not", () => {
    expect(planUpdateSchema.safeParse({ sort: 3 }).success).toBe(true);
    expect(planCreateSchema.safeParse({ ...validPlan, sort: 3 }).success).toBe(true);
    const created = planCreateSchema.parse({ ...validPlan, sort: 3 });
    expect(created).not.toHaveProperty("sort");
  });

  it("still refuses a bad value in the one field an edit does carry", () => {
    expect(planUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ interval: "week" }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ trialDays: 400 }).success).toBe(false);
  });

  it("accepts an empty patch, which the route rejects for itself", () => {
    // Nothing to validate is not the same as invalid; "No updatable fields
    // supplied" is the route's sentence, and it needs the parse to get there.
    expect(planUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe("planRepriceIssue", () => {
  const live: PlanPricing & { stripePriceId: string | null } = {
    priceCents: 4_900,
    currency: "usd",
    interval: "month",
    stripePriceId: "price_live_123",
  };
  const unsold = { ...live, stripePriceId: null };

  it("allows everything on a plan Stripe has never priced", () => {
    expect(planRepriceIssue(unsold, { priceCents: 9_900, currency: "gbp", interval: "year" })).toBeNull();
  });

  it("refuses a price change on a plan that is already on sale", () => {
    const issue = planRepriceIssue(live, { priceCents: 9_900 });
    expect(issue?.field).toBe("priceCents");
    expect(issue?.message).toMatch(/new plan/i);
  });

  it("refuses a currency or interval change for the same reason", () => {
    expect(planRepriceIssue(live, { currency: "gbp" })?.field).toBe("currency");
    expect(planRepriceIssue(live, { interval: "year" })?.field).toBe("interval");
  });

  it("lets a live plan be renamed, republished and re-entitled", () => {
    // The whole point of the edit button: everything that is not the amount
    // charged is still editable on a plan people are paying for.
    expect(planRepriceIssue(live, {})).toBeNull();
  });

  it("ignores a field resubmitted at its current value", () => {
    // The edit form posts the whole plan back, so an untouched price arrives
    // as a value rather than as an absence.
    expect(planRepriceIssue(live, { priceCents: 4_900, currency: "usd", interval: "month" })).toBeNull();
  });

  it("names the price before the interval when both moved", () => {
    expect(planRepriceIssue(live, { priceCents: 9_900, interval: "year" })?.field).toBe("priceCents");
  });
});
