import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import PracticeResetPlanner from "./PracticeResetPlanner";
import { resetPlannerForm } from "@/content/kajabiPages";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

/**
 * 22 Nov 2026 (Yvette, item 7): /practice-reset-planner offers the Practice
 * Freedom Audit. The old "Reset Planner" name and its 30-day promise are gone;
 * the form slug stays `reset-planner` so its automation keeps delivering.
 */
function render(): { html: string; head: HeadDescriptor[] } {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider
      runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}
    >
      <StaticRouter location="/practice-reset-planner">
        <PracticeResetPlanner />
      </StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

describe("the Practice Freedom Audit page", () => {
  const { html, head } = render();

  it("names the Practice Freedom Audit and its four areas", () => {
    expect(html).toContain("The Practice Freedom Audit");
    for (const area of ["Capacity", "Income", "Dependence", "Future Fit"]) expect(html).toContain(area);
    expect(html).toContain("GET THE FREE AUDIT");
    expect(head.at(-1)?.title).toBe("Free Practice Freedom Audit for Therapists | Boss Clinician");
  });

  it("no longer calls it a Reset Planner or promises a 30-day plan", () => {
    for (const text of ["Reset Planner", "RESET PLANNER", "FREE PLANNER", "30-Day", "30 days", "work less, earn more"]) {
      expect(html).not.toContain(text);
      expect(head.at(-1)?.description ?? "").not.toContain(text);
    }
  });

  it("keeps the reset-planner form so the delivery automation still runs", () => {
    expect(resetPlannerForm.formSlug).toBe("reset-planner");
    expect(resetPlannerForm.success).toContain("Practice Freedom Audit");
    expect(JSON.stringify(resetPlannerForm)).not.toMatch(/Reset Planner|30-day|work less/i);
  });
});
