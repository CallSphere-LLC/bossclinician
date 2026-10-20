import { describe, expect, it } from "vitest";
import { inAppPath } from "@/lib/notificationsApi";
import { readHighlightSlug } from "@/pages/member/productHighlight";

describe("inAppPath", () => {
  it("keeps the deep links purchase notices carry", () => {
    expect(inAppPath("/library?tab=documents&product=fully-booked-toolkit")).toBe(
      "/library?tab=documents&product=fully-booked-toolkit",
    );
    expect(inAppPath("/library/the-boss-move")).toBe("/library/the-boss-move");
    expect(inAppPath("/community/the-lounge")).toBe("/community/the-lounge");
  });

  it("drops anything that would leave the site", () => {
    expect(inAppPath("//evil.example/x")).toBe("");
    expect(inAppPath("/\\evil.example")).toBe("");
    expect(inAppPath("https://evil.example")).toBe("");
    expect(inAppPath("javascript:alert(1)")).toBe("");
    expect(inAppPath("")).toBe("");
  });
});

describe("readHighlightSlug", () => {
  it("accepts a product slug", () => {
    expect(readHighlightSlug("fully-booked-toolkit")).toBe("fully-booked-toolkit");
    expect(readHighlightSlug(" bali-retreat-2027 ")).toBe("bali-retreat-2027");
  });

  it("ignores missing or hostile values, which also go into a CSS selector", () => {
    expect(readHighlightSlug(null)).toBeNull();
    expect(readHighlightSlug("")).toBeNull();
    expect(readHighlightSlug('x"] , body [a="')).toBeNull();
    expect(readHighlightSlug("-leading-dash")).toBeNull();
    expect(readHighlightSlug("a".repeat(201))).toBeNull();
  });
});
