/**
 * What stops an email from being saved, as field-by-field messages.
 *
 * A1. The campaign dialog used to lean on the browser for this: "Subject line
 * B" carried a `required` attribute, the Save button sits in the dialog footer
 * outside the form, and the browser's own "Please fill out this field" bubble
 * never appeared. The submit was cancelled before React saw it — no request, no
 * toast, no highlight, a dialog that simply did nothing. So every rule that can
 * block a save lives here instead, returns a sentence keyed to the field it is
 * about, and the forms render with `noValidate` so nothing else can veto the
 * submit without saying why.
 *
 * Pure and DOM-free so the frontend suite (node, no jsdom) can prove the
 * invariant that matters: a blocked save always carries a message, and that
 * message always belongs to a field the form shows it next to.
 */

export type CampaignSendMode = "manual" | "absolute" | "event_start" | "event_registration";

/** Every field a campaign save can be blocked on. Each has an error slot in the form. */
export const CAMPAIGN_FIELDS = [
  "name",
  "subject",
  "subjectB",
  "scheduledAt",
  "anchorEventId",
  "anchorOffsetMinutes",
] as const;

export type CampaignField = (typeof CAMPAIGN_FIELDS)[number];

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

/** The DOM id each field's control carries, so the first problem can be focused. */
export const CAMPAIGN_FIELD_IDS: Record<CampaignField, string> = {
  name: "campaign-name",
  subject: "campaign-subject",
  subjectB: "campaign-subject-b",
  scheduledAt: "campaign-scheduled-at",
  anchorEventId: "campaign-anchor-event",
  anchorOffsetMinutes: "campaign-anchor-offset",
};

export interface CampaignDraftShape {
  name?: string | null;
  subject?: string | null;
  subjectB?: string | null;
  abSplitPercent?: number | null;
  scheduledAt?: string | null;
  anchorEventId?: number | null;
  anchorOffsetMinutes?: number | null;
}

export interface CampaignValidationContext {
  sendMode: CampaignSendMode;
  /** Epoch ms. Passed in so the rule about "a minute from now" is testable. */
  now: number;
  /** The event the send is timed around, when there is one. */
  anchorEvent?: { title: string; startsAt: string | null } | null;
}

const blank = (value: string | null | undefined) => !value?.trim();

export function validateCampaignDraft(
  draft: CampaignDraftShape,
  { sendMode, now, anchorEvent }: CampaignValidationContext,
): FieldErrors<CampaignField> {
  const errors: FieldErrors<CampaignField> = {};

  if (blank(draft.name)) {
    errors.name = "Give this email a name so you can find it in your list.";
  }

  const testing = (draft.abSplitPercent ?? 0) > 0;
  if (testing && blank(draft.subjectB)) {
    errors.subjectB =
      "Write the second subject line to test, or untick “Test a second subject line”.";
  }
  if (testing && blank(draft.subject)) {
    errors.subject = "Add the first subject line — the test compares it with subject line B.";
  }

  if (sendMode === "absolute") {
    const at = draft.scheduledAt ? Date.parse(draft.scheduledAt) : Number.NaN;
    if (!draft.scheduledAt || !Number.isFinite(at)) {
      errors.scheduledAt = "Choose the date and time it should go out.";
    } else if (at <= now + 60_000) {
      errors.scheduledAt = "Choose a send time at least one minute from now.";
    }
  }

  if (sendMode === "event_start" || sendMode === "event_registration") {
    if (!draft.anchorEventId) {
      errors.anchorEventId = "Choose which event this is timed around.";
    }
    if (blank(draft.subject)) {
      errors.subject = errors.subject ?? "Add a subject line before scheduling this.";
    }
    if (sendMode === "event_start" && draft.anchorEventId && anchorEvent) {
      const starts = anchorEvent.startsAt ? Date.parse(anchorEvent.startsAt) : Number.NaN;
      if (!Number.isFinite(starts)) {
        errors.anchorEventId = `“${anchorEvent.title}” has no date yet, so there's nothing to count from. Give it a date first, or choose another event.`;
      } else {
        const offset = draft.anchorOffsetMinutes ?? -1440;
        if (starts + offset * 60_000 <= now) {
          errors.anchorOffsetMinutes = `That moment has already passed — “${anchorEvent.title}” starts too soon for this much notice. Choose a smaller gap, or send it now.`;
        }
      }
    }
  }

  return errors;
}

/* ------------------------------------------------------ sequence emails */

export const SEQUENCE_EMAIL_FIELDS = ["subject", "waitDays", "waitHours"] as const;
export type SequenceEmailField = (typeof SEQUENCE_EMAIL_FIELDS)[number];

export const SEQUENCE_EMAIL_FIELD_IDS: Record<SequenceEmailField, string> = {
  subject: "sequence-email-subject",
  waitDays: "sequence-email-wait-days",
  waitHours: "sequence-email-wait-hours",
};

/**
 * The same class of bug in the sequence email dialog: `required` on the subject
 * and `max={23}` on the hours box both cancelled the submit in the browser, so
 * "30 hours" or an empty subject made Save do nothing at all.
 */
export function validateSequenceEmailDraft(draft: {
  subject: string;
  waitDays: number;
  waitHours: number;
}): FieldErrors<SequenceEmailField> {
  const errors: FieldErrors<SequenceEmailField> = {};
  if (blank(draft.subject)) errors.subject = "Give this email a subject line.";
  if (!Number.isInteger(draft.waitDays) || draft.waitDays < 0 || draft.waitDays > 365) {
    errors.waitDays = "Use a whole number of days from 0 to 365.";
  }
  if (!Number.isInteger(draft.waitHours) || draft.waitHours < 0 || draft.waitHours > 23) {
    errors.waitHours = "Use 0 to 23 hours — anything longer belongs in the days box.";
  }
  return errors;
}

/* --------------------------------------------------------------- shared */

/** The fields that failed, in the order the form shows them. */
export function orderedErrors<F extends string>(
  errors: FieldErrors<F>,
  order: readonly F[],
): { field: F; message: string }[] {
  return order
    .filter((field) => Boolean(errors[field]))
    .map((field) => ({ field, message: errors[field] as string }));
}

/** One line for the toast that accompanies the inline messages. */
export function saveBlockedSummary<F extends string>(
  errors: FieldErrors<F>,
  order: readonly F[],
): string | null {
  const failed = orderedErrors(errors, order);
  if (failed.length === 0) return null;
  const [first] = failed;
  return failed.length === 1
    ? `Not saved yet: ${first.message}`
    : `Not saved yet — ${failed.length} things to fix. ${first.message}`;
}
