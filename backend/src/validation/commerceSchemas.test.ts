import { describe, expect, it } from "vitest";
import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  offerCreateSchema,
  offerPricingIssue,
  offerUpdateSchema,
  type OfferPricingShape,
} from "./commerceSchemas";

/**
 * The rules here are the last thing between a typo in the offer editor and a
 * charge, so they are tested as arithmetic rather than as plumbing: given a
 * shape, is it sellable.
 */

const plan = (over: Partial<OfferPricingShape> = {}): OfferPricingShape => ({
  pricingType: "payment_plan",
  amountCents: 125_000,
  minAmountCents: 0,
  interval: "month",
  installmentCount: 3,
  trialDays: 0,
  ...over,
});

describe("offerPricingIssue — payment plans and trials", () => {
  it("accepts a plain 3 x $1,250 plan", () => {
    expect(offerPricingIssue(plan())).toBeNull();
  });

  it("refuses a trial on a payment plan, addressed to the trial field", () => {
    const issue = offerPricingIssue(plan({ trialDays: 14 }));
    expect(issue?.field).toBe("trialDays");
    expect(issue?.message).toMatch(/free trial/i);
  });

  it("refuses a one-day trial as readily as a long one", () => {
    expect(offerPricingIssue(plan({ trialDays: 1 }))?.field).toBe("trialDays");
  });

  it("still allows a trial on a subscription, which is where one makes sense", () => {
    const issue = offerPricingIssue({
      pricingType: "subscription",
      amountCents: 9_900,
      minAmountCents: 0,
      interval: "month",
      installmentCount: null,
      trialDays: 14,
    });
    expect(issue).toBeNull();
  });

  it("reports the missing installment count before the trial", () => {
    // The plan is unsellable for two reasons; the admin should be sent to the
    // one that has to be answered first.
    expect(offerPricingIssue(plan({ installmentCount: null, trialDays: 14 }))?.field).toBe(
      "installmentCount",
    );
  });
});

describe("offer currency", () => {
  it("accepts every currency the site claims to support", () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      const parsed = offerUpdateSchema.safeParse({ currency });
      expect(parsed.success).toBe(true);
    }
  });

  it("normalises case, because Stripe wants it lowercase", () => {
    const parsed = offerUpdateSchema.safeParse({ currency: " USD " });
    expect(parsed.success && parsed.data.currency).toBe("usd");
  });

  it("refuses three letters that are not a currency", () => {
    // 'abc' is well-formed enough for Intl to accept in some runtimes and to
    // reject in others, which is how it reached a sales page and 500'd it.
    const parsed = offerUpdateSchema.safeParse({ currency: "abc" });
    expect(parsed.success).toBe(false);
  });

  it("names the choices in the message, since an admin reads it", () => {
    const parsed = offerUpdateSchema.safeParse({ currency: "zzz" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.currency?.[0]).toMatch(/USD/);
    }
  });

  it("refuses a zero-decimal currency, which the cents arithmetic cannot render", () => {
    expect(offerUpdateSchema.safeParse({ currency: "jpy" }).success).toBe(false);
  });

  it("defaults to usd when the field is absent on create", () => {
    const parsed = offerCreateSchema.safeParse({
      title: "Fully Booked Toolkit",
      slug: "fully-booked-toolkit",
      pricingType: "one_time",
      amountCents: 19_700,
    });
    expect(parsed.success && parsed.data.currency).toBe("usd");
  });

  it("isSupportedCurrency agrees with the schema", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency(" gbp ")).toBe(true);
    expect(isSupportedCurrency("abc")).toBe(false);
  });
});
