import type { AssessmentSummary } from "@/lib/quizApi";

/**
 * What a "Quiz or survey" lesson does with its assessment when it is saved.
 *
 * A lesson of that kind either links a quiz or survey that exists already, or
 * gets a new one created for it on save. It used to be only the first: the
 * picker was a required dropdown that hid every assessment already attached to
 * another lesson, and since every imported Kajabi quiz is attached to its own
 * lesson the dropdown was always empty — so the browser quietly refused to
 * save, in every course. Now an empty choice means "create a new one", and
 * that rule lives here so it is tested rather than remembered.
 */

export type NewAssessmentKind = "graded" | "survey";

/**
 * The quiz or survey a lesson save must create, or null when it links an
 * existing one (or the lesson is not an assessment at all).
 *
 * `newAssessmentKind` is the "Add quiz" / "Add survey" buttons under a section;
 * `createKind` is the quiz-or-survey choice inside the lesson editor, and a
 * lesson that has picked neither and linked nothing gets a scored quiz.
 */
export function assessmentToCreate(
  lesson: { contentType?: string | null; assessmentId?: number | string | null },
  draft: { newAssessmentKind?: NewAssessmentKind; createKind?: NewAssessmentKind },
): NewAssessmentKind | null {
  if (lesson.contentType !== "assessment") return null;
  if (draft.newAssessmentKind) return draft.newAssessmentKind;
  if (Number(lesson.assessmentId) > 0) return null;
  return draft.createKind ?? "graded";
}

/**
 * The assessments a lesson's picker may offer: graded tests and surveys that no
 * other lesson holds, plus the one this lesson already has. A lead-gen quiz has
 * no place in a lesson, and taking another lesson's quiz would silently move it.
 */
export function attachableAssessments(
  all: AssessmentSummary[],
  lessonId: number | null | undefined,
): AssessmentSummary[] {
  return all.filter(
    (assessment) =>
      (assessment.kind === "graded" || assessment.kind === "survey") &&
      (!assessment.lessonId || (lessonId != null && Number(assessment.lessonId) === Number(lessonId))),
  );
}
