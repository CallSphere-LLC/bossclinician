/**
 * Payment settings Stripe has rules about, checked before Stripe sees them.
 *
 * Pure, and free of any import from services/settings, because the settings
 * registry validates its fields with these and must not be imported back.
 */

/* ------------------------------------------------- card statement descriptor */

/**
 * Why a statement descriptor would be refused, in words, or null.
 *
 * Stripe's rules: 5–22 characters, Latin letters and digits, at least one
 * letter, and none of `< > \ ' " *`. The narrower set here — letters, digits,
 * spaces, dots and hyphens — is what `cleanStatementDescriptor` passes through,
 * so a value that saves is a value that reaches Stripe unchanged. Blank is
 * allowed and means "use the name on the Stripe account".
 */
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
  if (!/[A-Za-z]/.test(trimmed)) {
    return "The name shown on card statements needs at least one letter.";
  }
  return null;
}

/** The setting as Stripe should receive it, or undefined to leave Stripe's own. */
export function cleanStatementDescriptor(value: unknown): string | undefined {
  const clean = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22)
    .trim();
  return clean.length >= 5 && /[A-Z]/.test(clean) ? clean : undefined;
}

/**
 * The dynamic suffix for a card PaymentIntent.
 *
 * Card payments no longer take a full descriptor per charge; Stripe appends
 * `statement_descriptor_suffix` to the account's prefix and truncates the pair
 * at 22. The suffix needs a letter and at most 22 characters, and Stripe rejects
 * a suffix of only one or two characters on some networks, so the same 5–22
 * rule applies.
 */
export function statementDescriptorSuffix(value: unknown): string | undefined {
  return cleanStatementDescriptor(value);
}

/* ------------------------------------------------------------ retry schedule */

export const DEFAULT_RETRY_DAYS = [3, 5, 7];
export const MAX_PAYMENT_RETRIES = 6;
export const MAX_RETRY_GAP_DAYS = 30;

/** Why a retry schedule would be refused, in words, or null. */
export function retryScheduleProblem(value: unknown): string | null {
  if (typeof value !== "string") return "The retry schedule could not be read.";
  const trimmed = value.trim();
  if (trimmed === "") return "Say how many days to wait before each new try, for example 3, 5, 7.";
  if (!/^\d+(\s*,\s*\d+)*$/.test(trimmed)) {
    return 'Write the retry schedule as whole numbers of days separated by commas, for example "3, 5, 7".';
  }
  const days = trimmed.split(",").map((part) => Number(part.trim()));
  if (days.length > MAX_PAYMENT_RETRIES) {
    return `That is ${days.length} retries. Keep it to ${MAX_PAYMENT_RETRIES} or fewer.`;
  }
  const bad = days.find((day) => day < 1 || day > MAX_RETRY_GAP_DAYS);
  if (bad !== undefined) {
    return `Each wait has to be between 1 and ${MAX_RETRY_GAP_DAYS} days; ${bad} isn't.`;
  }
  return null;
}

/** The schedule as numbers. Anything unusable reads as the default. */
export function parseRetrySchedule(value: unknown): number[] {
  if (retryScheduleProblem(value) !== null) return DEFAULT_RETRY_DAYS;
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()));
}
