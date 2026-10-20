import { describe, expect, it } from "vitest";
import { purchaseBody, purchaseLink } from "./purchaseNotifications";

describe("purchaseLink", () => {
  it("sends a download to its files on the Documents tab, highlighted", () => {
    expect(purchaseLink({ kind: "download", slug: "fully-booked-toolkit", communitySlug: null })).toBe(
      "/library?tab=documents&product=fully-booked-toolkit"
    );
  });

  it("opens a course in its player", () => {
    expect(purchaseLink({ kind: "course", slug: "the-boss-move", communitySlug: null })).toBe(
      "/library/the-boss-move"
    );
  });

  it("sends a community or a community tier to that community", () => {
    expect(purchaseLink({ kind: "community", slug: "c", communitySlug: "the-lounge" })).toBe(
      "/community/the-lounge"
    );
    expect(purchaseLink({ kind: "community", slug: "c", communitySlug: null })).toBe("/community");
    expect(purchaseLink({ kind: "access_group", slug: "vip", communitySlug: "the-lounge" })).toBe(
      "/community/the-lounge"
    );
  });

  it("highlights an access pass with no community on the library shelf", () => {
    expect(
      purchaseLink({ kind: "access_group", slug: "bali-retreat-2027", communitySlug: null })
    ).toBe("/library?product=bali-retreat-2027");
  });

  it("sends coaching, podcasts and newsletters to their own pages", () => {
    expect(purchaseLink({ kind: "coaching", slug: "x", communitySlug: null })).toBe("/coaching");
    expect(purchaseLink({ kind: "podcast", slug: "x", communitySlug: null })).toBe("/podcasts");
    expect(purchaseLink({ kind: "newsletter", slug: "x", communitySlug: null })).toBe("/newsletters");
  });

  it("falls back to the product's card on the shelf", () => {
    expect(purchaseLink({ kind: "bundle", slug: "starter-bundle", communitySlug: null })).toBe(
      "/library?product=starter-bundle"
    );
  });

  it("only ever produces a same-origin path", () => {
    const link = purchaseLink({ kind: "course", slug: "a/../../x?y", communitySlug: null });
    expect(link.startsWith("/library/")).toBe(true);
    expect(link).not.toContain("?");
  });
});

describe("purchaseBody", () => {
  it("says what opening it will show", () => {
    expect(purchaseBody("download")).toMatch(/files/);
    expect(purchaseBody("course")).toMatch(/lesson/);
    expect(purchaseBody("anything-else")).toMatch(/library/);
  });
});
