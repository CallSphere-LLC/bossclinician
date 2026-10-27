import { describe, expect, it } from "vitest";
import { membershipThankYouDestination as destination } from "./membershipThankYou";

describe("membership receipt destinations", () => {
  it.each([
    ["the-club", "/the-club-ty"],
    ["the-lounge", "/lounge-confirmed"],
    ["the-lounge-vip", "/lounge-confirmed"],
  ])("routes a server-confirmed paid %s receipt", (offerSlug, redirectUrl) => {
    expect(destination({ status: "paid", offerSlug, redirectUrl })).toBe(redirectUrl);
  });
  it.each(["pending", "failed", "refunded", "cancelled", "processing"])("does not celebrate a %s order", (status) => {
    expect(destination({ status, offerSlug: "the-lounge", redirectUrl: "/lounge-confirmed" })).toBeNull();
  });
  it.each([null, "", "https://example.com", "//example.com", "/lounge-confirmed?token=private", "/the-club-ty"])("does not forward unrecognized destinations or receipt tokens: %s", (redirectUrl) => {
    expect(destination({ status: "paid", offerSlug: "the-lounge", redirectUrl })).toBeNull();
  });
  it.each([null, "the-lounge-vip-free", "other-course"])("leaves unrelated offer %s on its receipt", (offerSlug) => {
    expect(destination({ status: "paid", offerSlug, redirectUrl: "/lounge-confirmed" })).toBeNull();
  });
});
