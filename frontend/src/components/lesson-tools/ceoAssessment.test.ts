import { describe, expect, it } from "vitest";
import { ceoReportText, completeCeoResponses, earlierQuarterReport, normaliseCeoDraft, previewCeoReport, type CeoReport } from "./ceoAssessment";

const report = (id: string, quarter: string, completedAt: string, assessmentVersion = "boardroom-ceo-v1"): CeoReport => ({ ...previewCeoReport(Array(12).fill(2))!, id, quarter, completedAt, assessmentVersion });

describe("CEO assessment drafts and preview", () => {
  it("does not turn missing or malformed responses into completed answers", () => {
    const draft = normaliseCeoDraft({ responses: [1, 4, "3", null, 0, -1, 5, 1.5, 2], memberId: 999 });
    expect(draft.responses).toEqual([1, 4, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0]);
    expect(completeCeoResponses(draft.responses)).toBe(false);
    expect(previewCeoReport(draft.responses)).toBeNull();
    expect(normaliseCeoDraft(null).responses).toHaveLength(12);
  });
  it("matches the supplied 1-4 scoring without rescaling away its 25-point floor", () => {
    expect(previewCeoReport(Array(12).fill(1))!.overallScore).toBe(25);
    expect(previewCeoReport(Array(12).fill(4))!.overallScore).toBe(100);
    const result = previewCeoReport([4, 3, 2, 2, 1, 2, 3, 4, 2, 2, 4, 4])!;
    expect(result.overallScore).toBe(69);
    expect(result.priorities.map(d => d.id)).toEqual(["operations", "team", "risk"]);
    expect(result.firstAction).toContain("owner-dependent operational process");
  });
  it("exports only the selected report with the original scoring version", () => {
    const baseline = report("own", "2026-Q4", "2026-10-26T10:00:00Z");
    const text = ceoReportText(baseline);
    expect(text).toContain("Assessment version: boardroom-ceo-v1");
    expect(text).toContain("Overall baseline: 50/100");
    expect(text).toContain("Three suggested priorities");
  });
});

describe("quarterly baseline selection", () => {
  const q4 = report("q4", "2026-Q4", "2026-10-26T10:00:00Z");
  it("uses the latest actual report in an earlier quarter, excluding same-quarter retakes", () => {
    const q3old = report("q3old", "2026-Q3", "2026-07-10T10:00:00Z");
    const q3 = report("q3", "2026-Q3", "2026-09-10T10:00:00Z");
    const retake = report("q4later", "2026-Q4", "2026-11-01T10:00:00Z");
    expect(earlierQuarterReport(q4, [retake, q3old, q3, q4])?.id).toBe("q3");
  });
  it("keeps the actual missing-quarter gap and returns no baseline when none exists", () => {
    const q1 = report("q1", "2026-Q1", "2026-02-10T10:00:00Z");
    expect(earlierQuarterReport(q4, [q1])?.quarter).toBe("2026-Q1");
    expect(earlierQuarterReport(q1, [q4])).toBeNull();
    expect(earlierQuarterReport(q4, [q4])).toBeNull();
  });
  it("retains an earlier scoring version so the UI can explicitly refuse a misleading comparison", () => {
    const previous = report("v0", "2026-Q3", "2026-09-10T10:00:00Z", "boardroom-ceo-v0");
    expect(earlierQuarterReport(q4, [previous])?.assessmentVersion).not.toBe(q4.assessmentVersion);
  });
});
