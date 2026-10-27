import { describe, expect, it } from "vitest";
import { PLAN_GROUPS, backupDocument, livingPlanDefaults, restoreFromBackup } from "./livingPlan";
import { livingPlanHtml, livingPlanReport } from "./livingPlanReport";

describe("annual plan export", () => {
  it("exports every field, review flag and unsaved value without mutating the plan", () => {
    const state = livingPlanDefaults();
    state.annual.values.planYear = "2026";
    for (const group of PLAN_GROUPS) for (const field of group.fields) state.annual.values[field.key] = typeof field.type === "object" ? field.type.select[0] : field.type === "number" ? "42" : field.type === "date" ? "2026-10-26" : `Latest ${field.key}`;
    state.annual.values.annualTarget = "125000.25";
    state.annual.reviewed.financial = true;
    const before = JSON.stringify(state);
    const report = livingPlanReport(state.annual);
    expect(report.sections).toHaveLength(11);
    expect(report.sections.flatMap((section) => section.fields)).toHaveLength(PLAN_GROUPS.flatMap((group) => group.fields).length);
    expect(report.sections.flatMap((section) => section.fields).find((field) => field.label === "Annual revenue goal ($)")?.value).toBe("$125,000.25");
    expect(report.sections.find((section) => section.title.includes("Financial Model"))?.reviewed).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    expect(restoreFromBackup(livingPlanDefaults(), backupDocument(state))?.annual).toEqual(state.annual);
  });

  it("prints long text safely and includes blanks, declaration and archive label", () => {
    const state = livingPlanDefaults();
    const notes = '<script>alert("x")</script>\n' + "long passage ".repeat(250);
    state.annual.values.declaration = notes;
    const html = livingPlanHtml(state.annual, true);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("long passage ".repeat(250));
    expect(html).toContain("Not entered");
    expect(html).toContain("CEO Declaration");
    expect(html).toContain("(archived)");
    expect(html).toContain("break-inside:auto");
  });
});
