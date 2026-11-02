import { describe, expect, it } from "vitest";
import { loungeButtonLabel, LOUNGE_BILLING_LIVE } from "./loungeRelease";
import { lounge } from "./lounge";

describe("Lounge release switch", () => {
  it("publishes the approved membership terms and purchase buttons", () => {
    expect(LOUNGE_BILLING_LIVE).toBe(true);
    expect(lounge.pricing.tiers[0].monthlyTerms).toContain("$1,182");
    expect(lounge.faq.items.some((item) => item.q === "What is the 7-day money-back guarantee?")).toBe(true);
    expect(loungeButtonLabel("the-lounge", "$197.00")).toBe("Join Lounge — Pay $197 Today");
    expect(loungeButtonLabel("the-lounge-vip", "$347.00")).toBe("Join VIP — Pay $347 Today");
  });

  it("uses her button wording on the preview", () => {
    expect(loungeButtonLabel("lounge-billing-preview", "$197.00")).toBe("Join Lounge — Pay $197 Today");
    expect(loungeButtonLabel("some-other-offer", "$10.00")).toBeNull();
  });
});
