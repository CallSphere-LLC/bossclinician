import { MemberApiError } from "@/lib/memberApi";

/**
 * The question ids a refused lesson-assessment submit says still need an
 * answer.
 *
 * Both the member route and the admin preview answer a blank required question
 * with a 400 whose `details.missingQuestionIds` lists them; anything else —
 * another status, another shape, a network failure — is "none", so the caller
 * falls back to the error's own message.
 */
export function missingQuestionIdsOf(error: unknown): number[] {
  if (!(error instanceof MemberApiError) || error.status !== 400) return [];
  if (!error.details || typeof error.details !== "object") return [];
  const ids = (error.details as { missingQuestionIds?: unknown }).missingQuestionIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id))
    : [];
}
