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

  it("publishes the approved audience copy and anonymized coaching case studies", () => {
    expect(lounge.stepInto.body).toBe(
      "You’re a mental health clinician with an established practice, and you want more say over what you earn, how many appointments you take, and when your workday ends.",
    );
    expect(lounge.caseStudies.title).toBe("Two practice owners. Two different next steps.");
    expect(lounge.caseStudies.items).toHaveLength(2);
    expect(lounge.caseStudies.items[0].paragraphs.at(-1)).toContain("reported receiving inquiries");
  });
});
