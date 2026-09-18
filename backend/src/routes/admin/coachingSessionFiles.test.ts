import { describe, expect, it } from "vitest";
import { protectedRef } from "../../services/signedUrls";
import { isAttachableRef, sessionFileSchema } from "./coachingSessionFiles";

/**
 * The member route signs a protected reference and passes an absolute link
 * through; anything else it would emit as a dead href. So those two are the
 * only references worth storing.
 */
describe("isAttachableRef", () => {
  it("accepts a file from the protected directory", () => {
    expect(isAttachableRef(protectedRef("abc123.pdf"))).toBe(true);
  });

  it("accepts a link on somebody else's host", () => {
    expect(isAttachableRef("https://zoom.us/rec/share/abc")).toBe(true);
  });

  it("refuses a public upload path and anything that is not a link", () => {
    expect(isAttachableRef("/uploads/abc123.pdf")).toBe(false);
    expect(isAttachableRef("javascript:alert(1)")).toBe(false);
    expect(isAttachableRef("notes.pdf")).toBe(false);
  });
});

describe("sessionFileSchema", () => {
  it("fills in the optional fields", () => {
    const parsed = sessionFileSchema.parse({ url: " https://example.com/doc " });
    expect(parsed).toEqual({ mediaId: null, title: "", url: "https://example.com/doc" });
  });

  it("requires a reference", () => {
    expect(sessionFileSchema.safeParse({ title: "Homework" }).success).toBe(false);
    expect(sessionFileSchema.safeParse({ url: "   " }).success).toBe(false);
  });
});
