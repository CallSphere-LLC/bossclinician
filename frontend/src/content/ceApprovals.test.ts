import { describe, expect, it } from "vitest";
import { findBlogPostBySlug } from "./blog";
import { docRegistration } from "./leadMagnetsDocumentation";

/**
 * 22 Nov 2026 (Yvette, item 10): Nevada Board approval #2026-18 is still active.
 * It stays on the Do's & Don'ts course page and on both blog posts about that
 * training; NBCC ACEP No. 7998 is not substituted for it.
 */
describe("CE approval labels", () => {
  it("keeps the Nevada Board approval line on both Do's & Don'ts blog posts", () => {
    for (const slug of ["toolkit-before-my-audit-registration-closes-september-25", "dos-and-donts-of-clinical-documentation"]) {
      const body = findBlogPostBySlug(slug)?.bodyMd ?? "";
      expect(body).toContain("**3.5 Ethics CEUs. Nevada Board Approved.**");
      expect(body).not.toContain("7998");
    }
  });

  it("keeps CEU Approval #2026-18 on the course page, labelled as the Nevada Board's", () => {
    const text = JSON.stringify(docRegistration);
    expect(text).toContain("Nevada Board of Examiners for MFT & CPC:");
    expect(text).toContain("CEU Approval #2026-18");
  });
});
