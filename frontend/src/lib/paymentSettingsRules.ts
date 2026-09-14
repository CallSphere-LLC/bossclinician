/**
 * The payment settings that have rules, checked before Save so the owner is
 * told what is wrong instead of reading "Something in that form needs fixing".
 *
 * Mirrors backend/src/services/paymentRules.ts and cancellationReasons.ts; the
 * server enforces the same rules again on the write.
 */

import { cancelReasonsProblem } from "@/lib/cancelReasons";

export function statementDescriptorProblem(value: unknown): string | null {
  if (typeof value !== "string") return "The name shown on card statements could not be read.";
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length < 5 || trimmed.length > 22) {
    return `The name shown on card statements has to be 5 to 22 characters; "${trimmed}" is ${trimmed.length}.`;
  }
  if (!/^[A-Za-z0-9 .-]+$/.test(trimmed)) {
    return "The name shown on card statements can only use letters, numbers, spaces, dots and hyphens.";
  }
  if (!/[A-Za-z]/.test(trimmed)) return "The name shown on card statements needs at least one letter.";
  return null;
}

export function retryScheduleProblem(value: unknown): string | null {
  if (typeof value !== "string") return "The retry schedule could not be read.";
  const trimmed = value.trim();
  if (trimmed === "") return "Say how many days to wait before each new try, for example 3, 5, 7.";
  if (!/^\d+(\s*,\s*\d+)*$/.test(trimmed)) {
    return 'Write the retry schedule as whole numbers of days separated by commas, for example "3, 5, 7".';
  }
  const days = trimmed.split(",").map((part) => Number(part.trim()));
  if (days.length > 6) return `That is ${days.length} retries. Keep it to 6 or fewer.`;
  const bad = days.find((day) => day < 1 || day > 30);
  if (bad !== undefined) return `Each wait has to be between 1 and 30 days; ${bad} isn't.`;
  return null;
}

/** The first problem with a field's draft value, by the field's type, or null. */
export function paymentFieldProblem(type: string, value: unknown): string | null {
  switch (type) {
    case "reasonlist":
      return cancelReasonsProblem(typeof value === "string" ? value : "");
    case "descriptor":
      return statementDescriptorProblem(value);
    case "retryschedule":
      return retryScheduleProblem(value);
    default:
      return null;
  }
}
