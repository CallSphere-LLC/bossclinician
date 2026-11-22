import type { GuestQuestion, GuestQuestionnaire } from "@/lib/retreatsApi";

/**
 * Client-side mirror of services/retreatQuestionnaires.ts: which questions
 * show, and which required ones are still empty. The server re-checks both on
 * every save; this only keeps the guest from pressing a button that would be
 * refused.
 */

export function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export function conditionHolds(question: Pick<GuestQuestion, "showIf">, answers: Record<string, unknown>): boolean {
  if (!question.showIf) return true;
  const value = answers[question.showIf.questionId];
  if (question.showIf.anyOf.length === 0) return hasValue(value);
  const chosen = Array.isArray(value) ? value : [value];
  return chosen.some((item) => typeof item === "string" && question.showIf!.anyOf.includes(item));
}

export function visibleSections(definition: GuestQuestionnaire["definition"], answers: Record<string, unknown>) {
  return definition.sections
    .map((section) => ({ ...section, questions: section.questions.filter((q) => conditionHolds(q, answers)) }))
    .filter((section) => section.questions.length > 0);
}

/** The answers worth sending: only questions currently shown (a hidden follow-up is cleared). */
export function answersToSend(definition: GuestQuestionnaire["definition"], answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of visibleSections(definition, answers)) {
    for (const q of section.questions) if (hasValue(answers[q.id])) out[q.id] = answers[q.id];
  }
  return out;
}

export function missingRequired(definition: GuestQuestionnaire["definition"], answers: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const section of visibleSections(definition, answers)) {
    for (const q of section.questions) {
      if (q.required && !hasValue(answers[q.id])) {
        errors[q.id] = q.type === "checkbox" ? "Please tick this box to continue." : "Please answer this question.";
      }
    }
  }
  return errors;
}

export function answeredCount(definition: GuestQuestionnaire["definition"], answers: Record<string, unknown>): { answered: number; total: number } {
  const questions = visibleSections(definition, answers).flatMap((s) => s.questions);
  return { answered: questions.filter((q) => hasValue(answers[q.id])).length, total: questions.length };
}
