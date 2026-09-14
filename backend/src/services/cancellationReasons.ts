/**
 * Why people leave: the owner-editable list of cancellation reasons.
 *
 * Stored in `customer_payments.cancellationReasons` as one `key | label` pair per
 * line — the shape the settings row has held since it was introduced, so every
 * list already saved on a live site keeps working. The key is what the reports
 * group by and never changes when the wording does; the label is what a customer
 * reads and what the reports print.
 *
 * Deliberately free of any import from services/settings: the settings registry
 * validates this field with `cancelReasonsProblem`, and a module the registry
 * imports must not import the registry back.
 */

export interface CancelReasonOption {
  value: string;
  label: string;
}

export const CANCEL_REASON_KEY = /^[a-z][a-z0-9_]{1,49}$/;
export const MAX_CANCEL_REASONS = 30;
export const MAX_CANCEL_REASON_LABEL = 160;

/** What the rollup records for a cancellation nobody gave a reason for. */
export const NO_REASON_GIVEN = "not given";

export const DEFAULT_CANCEL_REASONS: CancelReasonOption[] = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "not_using_it", label: "I'm not using it" },
  { value: "missing_feature", label: "It's missing something I need" },
  { value: "found_alternative", label: "I found another option" },
  { value: "temporary_pause", label: "I just need a break for now" },
  { value: "other", label: "Something else" },
];

/**
 * The list a customer is offered.
 *
 * Same reading as the member billing route's own parser: lines that do not make
 * a valid pair are skipped, and a list with nothing usable in it falls back to
 * the defaults rather than presenting a cancellation form with no options.
 */
export function parseCancelReasons(value: unknown): CancelReasonOption[] {
  if (typeof value !== "string") return DEFAULT_CANCEL_REASONS;
  const seen = new Set<string>();
  const parsed = value.split(/\r?\n/).flatMap((line) => {
    const [rawKey, ...labelParts] = line.split("|");
    const key = rawKey?.trim() ?? "";
    const label = labelParts.join("|").trim();
    if (!CANCEL_REASON_KEY.test(key) || !label || seen.has(key)) return [];
    seen.add(key);
    return [{ value: key, label: label.slice(0, MAX_CANCEL_REASON_LABEL) }];
  });
  return parsed.length > 0 ? parsed.slice(0, MAX_CANCEL_REASONS) : DEFAULT_CANCEL_REASONS;
}

export function serializeCancelReasons(list: CancelReasonOption[]): string {
  return list.map((reason) => `${reason.value} | ${reason.label}`).join("\n");
}

/**
 * The first thing wrong with a list about to be saved, in words, or null.
 *
 * Stricter than `parseCancelReasons`, which has to tolerate whatever is already
 * stored: a save is the moment to refuse a line that would silently vanish from
 * the customer's form, and to say which line it was.
 */
export function cancelReasonsProblem(value: unknown): string | null {
  if (typeof value !== "string") return "The cancellation reasons could not be read.";

  const keys = new Set<string>();
  const labels = new Set<string>();
  let count = 0;

  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    count += 1;

    const sep = line.indexOf("|");
    if (sep === -1) {
      return `Reason ${count} is missing the "|" between its report key and its wording.`;
    }
    const key = line.slice(0, sep).trim();
    const label = line.slice(sep + 1).trim();

    if (!CANCEL_REASON_KEY.test(key)) {
      return `Reason ${count} has a report key ("${key}") that isn't lower-case letters, numbers and underscores.`;
    }
    if (label === "") return `Reason ${count} has no wording for the customer to see.`;
    if (label.length > MAX_CANCEL_REASON_LABEL) {
      return `Reason ${count} is longer than ${MAX_CANCEL_REASON_LABEL} characters.`;
    }
    if (keys.has(key)) return `Two reasons share the report key "${key}".`;
    if (labels.has(label.toLowerCase())) return `"${label}" is on the list twice.`;
    keys.add(key);
    labels.add(label.toLowerCase());
  }

  if (count === 0) return "Keep at least one reason, so a customer has something to choose.";
  if (count > MAX_CANCEL_REASONS) {
    return `That's ${count} reasons. Keep it to ${MAX_CANCEL_REASONS} or fewer.`;
  }
  return null;
}

/* --------------------------------------------- cancellations made in Stripe */

/**
 * Stripe's own churn vocabulary, in the wording its customer portal uses.
 *
 * A cancellation made from the Stripe dashboard or Stripe's hosted portal
 * arrives with one of these rather than one of our keys.
 */
export const STRIPE_FEEDBACK_LABEL: Record<string, string> = {
  customer_service: "Customer service wasn't good enough",
  low_quality: "The quality wasn't good enough",
  missing_features: "It's missing something I need",
  other: "Something else",
  switched_service: "I found another option",
  too_complex: "It was too complicated",
  too_expensive: "It's too expensive",
  unused: "I'm not using it",
};

/** The default key each Stripe answer means, where we have one. */
const DEFAULT_KEY_FOR_STRIPE_FEEDBACK: Record<string, string> = {
  too_expensive: "too_expensive",
  unused: "not_using_it",
  missing_features: "missing_feature",
  switched_service: "found_alternative",
  other: "other",
};

/**
 * The report key for a Stripe feedback value.
 *
 * The owner's own key wins when the list has the equivalent one, so the same
 * answer given in two places lands in one row of "People who left" rather than
 * two. Otherwise Stripe's value is kept as the key, and `cancelReasonLabel`
 * still has words for it.
 */
export function reasonForStripeFeedback(
  feedback: string,
  configured: CancelReasonOption[]
): string {
  const keys = new Set(configured.map((reason) => reason.value));
  const preferred = DEFAULT_KEY_FOR_STRIPE_FEEDBACK[feedback];
  if (preferred && keys.has(preferred)) return preferred;
  if (keys.has(feedback)) return feedback;
  return preferred ?? feedback;
}

export interface StripeCancellationDetails {
  feedback?: string | null;
  comment?: string | null;
}

/** What a Stripe-side cancellation said, as our columns hold it, or null for nothing. */
export function cancellationFromStripe(
  details: StripeCancellationDetails | null | undefined,
  configured: CancelReasonOption[]
): { reason: string; feedback: string } | null {
  const feedback = typeof details?.feedback === "string" ? details.feedback : "";
  const comment = typeof details?.comment === "string" ? details.comment.trim().slice(0, 2000) : "";
  if (feedback === "" && comment === "") return null;
  return {
    reason: feedback === "" ? "" : reasonForStripeFeedback(feedback, configured),
    feedback: comment,
  };
}

/* ----------------------------------------------------------------- reports */

function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/**
 * The words a report prints for a reason key.
 *
 * The owner's current wording first, so renaming a reason renames its history
 * too. A reason since removed from the list still has past answers behind it,
 * and reads as the default wording or Stripe's before falling back to the key.
 */
export function cancelReasonLabel(key: string, configured: CancelReasonOption[]): string {
  if (key === "" || key === NO_REASON_GIVEN) return "No reason given";
  // Recorded by services/dunning when every scheduled retry fails.
  if (key === "payment_failed") return "Their payment kept failing";
  const found =
    configured.find((reason) => reason.value === key) ??
    DEFAULT_CANCEL_REASONS.find((reason) => reason.value === key);
  if (found) return found.label;
  return STRIPE_FEEDBACK_LABEL[key] ?? humanise(key);
}
