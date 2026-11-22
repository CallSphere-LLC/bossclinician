import { describe, expect, it } from "vitest";
import {
  canApproveForPublication,
  cardProblem,
  consentedAttribution,
  isReviewable,
  isSafeCardUrl,
} from "./retreatAdminRules";

describe("Join Us Again card rules", () => {
  const base = { title: "Domestic Business Retreat", status: "interest_list" as const, ctaUrl: "", displayFrom: null, displayUntil: null };

  it("allows an interest-list card without a booking link", () => {
    expect(cardProblem(base)).toBeNull();
  });

  it("requires a verified link before registration can be shown as open", () => {
    expect(cardProblem({ ...base, status: "registration_open" })).toMatch(/booking link/);
    expect(cardProblem({ ...base, status: "registration_open", ctaUrl: "https://www.bossclinician.com/retreats" })).toBeNull();
    expect(cardProblem({ ...base, status: "registration_open", ctaUrl: "/retreats" })).toBeNull();
  });

  it("refuses unsafe links and inverted display windows", () => {
    expect(isSafeCardUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeCardUrl("//evil.example")).toBe(false);
    expect(isSafeCardUrl("http://insecure.example")).toBe(false);
    expect(cardProblem({ ...base, ctaUrl: "javascript:alert(1)" })).not.toBeNull();
    expect(cardProblem({ ...base, displayFrom: "2027-07-10T00:00:00Z", displayUntil: "2027-07-01T00:00:00Z" })).toMatch(/ends before/);
    expect(cardProblem({ ...base, title: "  " })).toMatch(/title/);
  });
});

describe("testimonial publication gate", () => {
  it("needs a submitted reflection, a testimonial and explicit consent", () => {
    expect(canApproveForPublication({ state: "submitted", testimonialConsent: "first_name", testimonialText: "Lovely." })).toBe(true);
    expect(canApproveForPublication({ state: "submitted", testimonialConsent: "no", testimonialText: "Lovely." })).toBe(false);
    expect(canApproveForPublication({ state: "draft", testimonialConsent: "full_name", testimonialText: "Lovely." })).toBe(false);
    expect(canApproveForPublication({ state: "submitted", testimonialConsent: "full_name", testimonialText: "   " })).toBe(false);
  });

  it("attributes exactly as consented", () => {
    expect(consentedAttribution("Jane Q Doe", "no", "")).toBeNull();
    expect(consentedAttribution("Jane Q Doe", "first_name", "LCSW")).toBe("Jane");
    expect(consentedAttribution("Jane Q Doe", "first_name_role", "LCSW")).toBe("Jane, LCSW");
    expect(consentedAttribution("Jane Q Doe", "full_name", "LCSW")).toBe("Jane Q Doe");
  });
});

describe("task review", () => {
  it("never lets an organizer hand-verify the agreement", () => {
    expect(isReviewable("agreement")).toBe(false);
    expect(isReviewable("payments")).toBe(true);
    expect(isReviewable("guest_profile")).toBe(true);
  });
});
