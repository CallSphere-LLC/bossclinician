import { useId, useRef, useState } from "react";
import {
  memberRetreatsApi,
  type FeedbackAnswers,
  type FeedbackLabels,
  type FeedbackView,
  type TestimonialConsent,
} from "@/lib/retreatsApi";
import {
  BUTTON_OUTLINE,
  BUTTON_PRIMARY,
  errorMessage,
  Field,
  fieldErrorsFrom,
  formatSavedAt,
  INPUT,
  PreviewNote,
  RadioGroup,
  SaveStatus,
} from "./retreatUi";

/**
 * The private post-retreat reflection, with a separate optional testimonial.
 *
 * Two choices that must never blur: (A) private feedback, which is never
 * published, and (B) an optional public testimonial with its own explicit
 * consent. Nothing here is required beyond the rating, and nothing is gated on
 * a positive answer.
 */

export function validateReflection(answers: FeedbackAnswers, consent: TestimonialConsent, text: string, role: string) {
  const errors: Record<string, string> = {};
  if (!answers.rating || answers.rating < 1 || answers.rating > 5) errors.rating = "Choose a rating from 1 to 5.";
  if (consent !== "no" && !text.trim()) errors.testimonialText = "Write your testimonial, or choose “No” below.";
  if (consent === "first_name_role" && !role.trim()) errors.testimonialRole = "Add the professional role you'd like shown.";
  return errors;
}

const YES_MAYBE_NO = [
  { value: "yes" as const, label: "Yes" },
  { value: "maybe" as const, label: "Maybe" },
  { value: "no" as const, label: "No" },
];

export function ReflectionForm({
  slug,
  labels,
  initial,
  readOnly,
  onSaved,
}: {
  slug: string;
  labels: FeedbackLabels;
  initial: FeedbackView;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [answers, setAnswers] = useState<FeedbackAnswers>(() => ({ ...initial.answers }));
  const [testimonialText, setText] = useState(initial.testimonialText ?? "");
  const [testimonialConsent, setConsent] = useState<TestimonialConsent>(initial.testimonialConsent ?? "no");
  const [testimonialRole, setRole] = useState(initial.testimonialRole ?? "");
  const [current, setCurrent] = useState<FeedbackView>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "neutral" | "error" | "success" }>(() =>
    initial.state === "submitted"
      ? { text: `Submitted ${formatSavedAt(initial.submittedAt)}. You can update it any time.`, tone: "success" }
      : initial.state === "draft"
        ? { text: `Draft saved ${formatSavedAt(initial.updatedAt)}`, tone: "neutral" }
        : { text: "", tone: "neutral" },
  );
  const inFlight = useRef(false);
  const set = <K extends keyof FeedbackAnswers>(key: K, value: FeedbackAnswers[K]) => setAnswers((prev) => ({ ...prev, [key]: value }));

  async function save(submit: boolean) {
    if (readOnly || inFlight.current) return;
    if (submit) {
      const local = validateReflection(answers, testimonialConsent, testimonialText, testimonialRole);
      setErrors(local);
      if (Object.keys(local).length) {
        setMessage({ text: "Please check the questions marked below.", tone: "error" });
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await memberRetreatsApi.saveFeedback(slug, {
        answers,
        testimonialText,
        testimonialConsent,
        testimonialRole,
        submit,
      });
      if (result.fieldErrors && Object.keys(result.fieldErrors).length) {
        setErrors(result.fieldErrors);
        setMessage({ text: "Please check the questions marked below.", tone: "error" });
        return;
      }
      setCurrent(result.current);
      setErrors({});
      setMessage(
        submit
          ? { text: "Thank you for sharing your reflection. It means so much.", tone: "success" }
          : { text: `Draft saved ${formatSavedAt(result.current.updatedAt)}`, tone: "neutral" },
      );
      onSaved?.();
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setMessage({ text: errorMessage(error, "That didn't save. Please try again."), tone: "error" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const area = (key: keyof FeedbackAnswers) => ({
    id: `${id}-${key}`,
    rows: 4,
    maxLength: 5000,
    disabled: readOnly,
    value: (answers[key] as string | undefined) ?? "",
    onChange: (event: { target: { value: string } }) => set(key, event.target.value as never),
    className: INPUT,
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save(true);
      }}
    >
      <p>This reflection is optional and private. Your private feedback is never published. Sharing a testimonial is optional and separate.</p>

      <RadioGroup
        legend={labels.rating}
        name={`${id}-rating`}
        required
        disabled={readOnly}
        value={answers.rating ? String(answers.rating) : undefined}
        onChange={(value) => set("rating", Number(value))}
        error={errors.rating}
        options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))}
      />
      <Field id={`${id}-ratingWhy`} label="Would you like to tell us why?">
        <textarea {...area("ratingWhy")} rows={3} />
      </Field>
      <Field id={`${id}-favoriteMoment`} label={labels.favoriteMoment}>
        <textarea {...area("favoriteMoment")} />
      </Field>
      <Field id={`${id}-appreciated`} label={labels.appreciated}>
        <textarea {...area("appreciated")} />
      </Field>
      <Field id={`${id}-expectations`} label={labels.expectations}>
        <textarea {...area("expectations")} />
      </Field>
      <Field id={`${id}-improve`} label={labels.improve}>
        <textarea {...area("improve")} />
      </Field>
      <RadioGroup legend={labels.attendAgain} name={`${id}-attendAgain`} disabled={readOnly} value={answers.attendAgain} onChange={(v) => set("attendAgain", v)} options={YES_MAYBE_NO} />
      <Field id={`${id}-attendAgainWhere`} label="Destinations or experiences you'd love">
        <textarea {...area("attendAgainWhere")} rows={2} />
      </Field>
      <RadioGroup legend={labels.recommend} name={`${id}-recommend`} disabled={readOnly} value={answers.recommend} onChange={(v) => set("recommend", v)} options={YES_MAYBE_NO} />
      <Field id={`${id}-recommendWhy`} label="Why?">
        <textarea {...area("recommendWhy")} rows={2} />
      </Field>

      <fieldset className="flex flex-col gap-5 rounded-2xl border border-dashed border-gold/30 p-5" disabled={readOnly}>
        <legend className="px-2 text-sm font-semibold text-gold">Optional public testimonial</legend>
        <p className="text-xs text-orchid-dim">
          Only if you'd like to. In your own words — there's no need for it to be positive. Nothing is published unless you
          say yes below and our team approves the wording with you.
        </p>
        <Field id={`${id}-testimonialText`} label={labels.testimonialText} error={errors.testimonialText}>
          <textarea id={`${id}-testimonialText`} rows={4} maxLength={3000} value={testimonialText} onChange={(e) => setText(e.target.value)} className={INPUT} />
        </Field>
        <RadioGroup<TestimonialConsent>
          legend={labels.testimonialConsent}
          name={`${id}-consent`}
          value={testimonialConsent}
          onChange={setConsent}
          options={[
            { value: "no", label: "No" },
            { value: "first_name", label: "Yes, first name only" },
            { value: "first_name_role", label: "Yes, first name + professional role" },
            { value: "full_name", label: "Yes, full name (subject to approved wording)" },
          ]}
        />
        {testimonialConsent === "first_name_role" && (
          <Field id={`${id}-role`} label="Professional role to show" required error={errors.testimonialRole}>
            <input id={`${id}-role`} type="text" maxLength={200} value={testimonialRole} onChange={(e) => setRole(e.target.value)} className={INPUT} />
          </Field>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_OUTLINE} disabled={readOnly || busy} onClick={() => void save(false)}>
          Save &amp; Finish Later
        </button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={readOnly || busy}>
          {current.state === "submitted" ? "Update my reflection" : "Submit my reflection"}
        </button>
      </div>
      {readOnly ? <PreviewNote /> : <SaveStatus text={message.text} tone={message.tone} />}
    </form>
  );
}
