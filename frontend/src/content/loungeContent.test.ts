import { describe, expect, it } from "vitest";
import { loungeButtonLabel, LOUNGE_BILLING_LIVE } from "./loungeRelease";
import { lounge } from "./lounge";
import { lounge as legacy } from "./loungeLegacy";

describe("Lounge release switch", () => {
  it("shows today's page and today's button while billing is off", () => {
    expect(LOUNGE_BILLING_LIVE).toBe(false);
    expect(lounge.pricing.tiers[0].terms).toBe(legacy.pricing.tiers[0].terms);
    expect(lounge.faq.items.map((item) => item.q)).toEqual(legacy.faq.items.map((item) => item.q));
    expect(loungeButtonLabel("the-lounge", "$197.00")).toBeNull();
  });

  it("uses her button wording on the preview", () => {
    expect(loungeButtonLabel("lounge-billing-preview", "$197.00")).toBe("Join Lounge — Pay $197 Today");
    expect(loungeButtonLabel("some-other-offer", "$10.00")).toBeNull();
  });
});
