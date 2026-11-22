import { describe, expect, it } from "vitest";
import * as kajabiPages from "@/content/kajabiPages";
import { HIRING_QUIZ_RESULTS } from "@/content/hiringQuiz";
import { coachingTerms } from "@/content/kajabiPagesLegal";
import { RETIRED_PAGE_TARGETS, retiredPageTarget } from "./retiredPages";
import { kajabiPublicRoutes } from "./routes";

/**
 * 22 Nov 2026 (Yvette, items 9 and 10): the Leap Accelerator / Boss Builders
 * Collective pages are gone ("I no longer offer Boss Builders Collective") and
 * their addresses go to The Club; the separate Practice Reset Audit pages are
 * replaced by the Practice Freedom Audit.
 */

describe("retired pages (Yvette, 22 Nov 2026, item 9)", () => {
  it("sends the old Leap Accelerator / Boss Builders pages to The Club", () => {
    expect(RETIRED_PAGE_TARGETS["/profitable-private-practice-leap-accelerator"]).toBe("/club");
    expect(RETIRED_PAGE_TARGETS["/leap-accelerator-thank-you"]).toBe("/club");
  });

  it("sends the old Practice Reset Audit pages to the Practice Freedom Audit", () => {
    expect(RETIRED_PAGE_TARGETS["/reset-audit"]).toBe("/practice-reset-planner");
    expect(RETIRED_PAGE_TARGETS["/reset-audit-form"]).toBe("/reset-planner-form");
    expect(RETIRED_PAGE_TARGETS["/practice-reset-audit-ty"]).toBe("/practice-reset-planner");
  });

  it("matches regardless of case and a trailing slash, and ignores other paths", () => {
    expect(retiredPageTarget("/Reset-Audit/")).toBe("/practice-reset-planner");
    expect(retiredPageTarget("/practice-reset-planner")).toBeNull();
    expect(retiredPageTarget("/club")).toBeNull();
  });

  it("registers every retired address as a redirect route, not a page", () => {
    const paths = kajabiPublicRoutes.map((r) => r.path.toLowerCase());
    for (const path of Object.keys(RETIRED_PAGE_TARGETS)) {
      expect(paths.filter((p) => p === path)).toHaveLength(1);
    }
    // The Freedom Audit form page is still a real page.
    expect(paths).toContain("/reset-planner-form");
  });

  it("no longer ships the Reset Audit copy", () => {
    const exported = Object.keys(kajabiPages);
    expect(exported).not.toContain("resetAudit");
    expect(exported).not.toContain("resetAuditForm");
    expect(exported).not.toContain("practiceResetAuditTy");
    expect(exported).toContain("resetPlannerForm");
  });

  it("points the hiring quiz at the Practice Freedom Audit", () => {
    const text = JSON.stringify(HIRING_QUIZ_RESULTS);
    expect(text).not.toContain("Practice Reset Audit");
    expect(text).toContain("Start with the free Practice Freedom Audit");
  });
});

describe("support address (Yvette, 22 Nov 2026, item 10)", () => {
  it("lists support@bossclinician.com on the Coaching Agreement, not the old Boss Builders domain", () => {
    const text = JSON.stringify(coachingTerms);
    expect(text).toContain("support@bossclinician.com");
    expect(text).not.toMatch(/prof(t)?itableprivatepractices/i);
  });
});
