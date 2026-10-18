import { describe, expect, it } from "vitest";
import type { AssessmentSummary } from "@/lib/quizApi";
import { assessmentToCreate, attachableAssessments } from "./lessonAssessmentChoice";

function summary(overrides: Partial<AssessmentSummary>): AssessmentSummary {
  return {
    id: 1,
    slug: "q",
    title: "Quiz",
    kind: "graded",
    published: true,
    requireEmail: false,
    passMark: 70,
    lessonId: null,
    questionCount: 3,
    resultCount: 0,
    attemptCount: 0,
    updatedAt: "2026-10-15T00:00:00Z",
    ...overrides,
  };
}

describe("assessmentToCreate", () => {
  it("creates nothing for a lesson that is not a quiz or survey", () => {
    expect(assessmentToCreate({ contentType: "video" }, { createKind: "survey" })).toBeNull();
  });

  it("links the chosen existing assessment instead of creating one", () => {
    expect(assessmentToCreate({ contentType: "assessment", assessmentId: 25 }, {})).toBeNull();
    expect(assessmentToCreate({ contentType: "assessment", assessmentId: "25" }, { createKind: "survey" })).toBeNull();
  });

  it("creates a scored quiz when nothing is linked and nothing was picked", () => {
    expect(assessmentToCreate({ contentType: "assessment", assessmentId: null }, {})).toBe("graded");
    expect(assessmentToCreate({ contentType: "assessment" }, {})).toBe("graded");
  });

  it("creates the kind picked in the lesson editor", () => {
    expect(assessmentToCreate({ contentType: "assessment" }, { createKind: "survey" })).toBe("survey");
  });

  it("honours the section's Add quiz / Add survey button above everything", () => {
    expect(
      assessmentToCreate({ contentType: "assessment", assessmentId: 9 }, { newAssessmentKind: "survey" }),
    ).toBe("survey");
  });
});

describe("attachableAssessments", () => {
  const list = [
    summary({ id: 1, lessonId: 268, kind: "survey" }),
    summary({ id: 2, lessonId: null, kind: "graded" }),
    summary({ id: 3, lessonId: null, kind: "quiz" }),
    summary({ id: 4, lessonId: 116 }),
  ];

  it("offers free graded tests and surveys, never a lead-gen quiz", () => {
    expect(attachableAssessments(list, null).map((a) => a.id)).toEqual([2]);
  });

  it("keeps the assessment this lesson already holds", () => {
    expect(attachableAssessments(list, 268).map((a) => a.id)).toEqual([1, 2]);
  });

  it("is empty when every assessment belongs to another lesson", () => {
    expect(attachableAssessments([list[0], list[3]], 999)).toEqual([]);
  });
});
