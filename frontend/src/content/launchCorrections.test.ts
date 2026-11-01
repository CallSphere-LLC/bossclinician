import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES } from "@/App";
import { clubCheckout } from "@/content/club";
import { footer, nav } from "@/content/site";

/** Owner's launch brief, 1 Nov 2026. */
describe("launch corrections", () => {
  it("does not offer Work With Me publicly", () => {
    expect(PUBLIC_ROUTES.map((route) => route.path)).not.toContain("/work-with-me");
    expect(JSON.stringify(nav)).not.toContain("work-with-me");
    expect(JSON.stringify(footer)).not.toMatch(/work-with-me|Work With Me/);
  });

  it("has no 72-hour countdown and states the Club guarantee's installment exception", () => {
    const checkout = JSON.stringify(clubCheckout);
    expect(checkout).not.toContain("72 hours");
    expect(clubCheckout.refund.body).toContain("cancels any unpaid remaining installments");
    expect(clubCheckout.agreement.body).toContain("cancels any unpaid remaining installments");
    expect(clubCheckout.nbcc).toContain("/continuing-education-boss-clinician");
  });
});
