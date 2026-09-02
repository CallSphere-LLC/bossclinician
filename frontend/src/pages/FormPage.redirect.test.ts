import { describe, it, expect } from "vitest";
import { isIdentityField, safeRedirect } from "@/pages/FormPage";

/**
 * P0-1, the public half: a form's "send them to another page" was stored,
 * served and never acted on — every form ended on the thank-you message.
 *
 * Honouring it means assigning an admin-typed string to `location.href`, which
 * is the one place on the public site where a row in the database becomes code
 * in a visitor's browser. These pin the gate in front of that: a real address
 * or a path on this site gets through, and everything else falls back to the
 * message, which is a worse redirect rather than a stored-XSS hole.
 */
describe("safeRedirect", () => {
  it("allows an ordinary external address", () => {
    expect(safeRedirect("https://cal.com/yvette/intro")).toBe("https://cal.com/yvette/intro");
    expect(safeRedirect("http://example.com/thanks")).toBe("http://example.com/thanks");
  });

  it("allows a path on this site, which is how most of them are written", () => {
    expect(safeRedirect("/thank-you")).toBe("/thank-you");
    expect(safeRedirect("  /offers/reset?from=form  ")).toBe("/offers/reset?from=form");
  });

  it("refuses a scheme that executes", () => {
    // Both are accepted by `location.href` in every browser, so neither can be
    // left to the admin's good intentions.
    expect(safeRedirect("javascript:alert(document.cookie)")).toBeNull();
    expect(safeRedirect("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses a protocol-relative address, which reads like a path and is not", () => {
    // `//evil.example` is a different origin written to look like `/evil`, and
    // the leading-slash check alone would wave it through.
    expect(safeRedirect("//evil.example/phish")).toBeNull();
  });

  it("refuses what is not an address at all", () => {
    expect(safeRedirect("thank-you")).toBeNull();
    expect(safeRedirect("")).toBeNull();
    expect(safeRedirect("   ")).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });
});

describe("universal form identity fields", () => {
  it("hides legacy starter identity questions so the public form asks only once", () => {
    expect(isIdentityField({ key: "name", label: "Your name", type: "text" })).toBe(true);
    expect(isIdentityField({ key: "email", label: "Email address", type: "email" })).toBe(true);
    expect(isIdentityField({ key: "work_email", label: "Manager email", type: "email" })).toBe(false);
  });
});
