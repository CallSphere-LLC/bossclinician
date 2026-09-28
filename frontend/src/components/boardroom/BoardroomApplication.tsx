import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { ApiError, api } from "@/lib/api";
import {
  BOARDROOM_FORM_SLUG,
  SOCIAL_FOLLOW_UP,
  boardroom,
  type ApplicationField,
} from "@/content/boardroom";

const copy = boardroom.application;
const STEPS = copy.steps;
const LAST_STEP = STEPS.length - 1;

/** The same loose shape the forms page and the submit route accept. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "sending" | "sent" | "error";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isControl(target: EventTarget | null): target is Control {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Every answer, keyed exactly as the stored form keys it.
 *
 * Read from the form in one pass rather than mirrored into state as the reader
 * types: the six steps stay mounted (only the current one is displayed), so the
 * DOM already holds every answer, including the ones on steps they went back
 * past. Every question is sent, answered or not, because the submissions table
 * in the admin lists whatever keys arrive and a table whose columns change from
 * reply to reply is unreadable.
 */
function collectAnswers(form: HTMLFormElement): Record<string, unknown> {
  const values = new FormData(form);
  const data: Record<string, unknown> = {};
  for (const step of STEPS) {
    for (const field of step.fields) {
      if (field.type === "checkboxes") {
        data[field.key] = values.getAll(field.key).map(String);
      } else if (field.type === "checkbox") {
        data[field.key] = values.has(field.key);
      } else if (field.type === "number") {
        const raw = String(values.get(field.key) ?? "").trim();
        const count = Number(raw);
        data[field.key] = raw !== "" && Number.isFinite(count) ? count : raw;
      } else {
        data[field.key] = String(values.get(field.key) ?? "").trim();
      }
    }
  }
  data.email = String(data.email ?? "").toLowerCase();
  return data;
}

/** One question, drawn the way her page drew that kind of question. */
function Question({ field, groupId }: { field: ApplicationField; groupId: string }) {
  if (field.type === "checkboxes") {
    return (
      <div className="br-choice-group" role="group" aria-labelledby={groupId}>
        <p id={groupId}>
          {field.label} {field.hint && <span className="br-choice-hint">{field.hint}</span>}
        </p>
        {(field.options ?? []).map((option) => (
          <label key={option} className="br-choice">
            <input type="checkbox" name={field.key} value={option} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="br-choice br-commitment">
        <input type="checkbox" name={field.key} required={field.required} />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label>
        {field.label}
        <select className="br-field" name={field.key} required={field.required} defaultValue="">
          <option value="">Select one</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label>
        {field.label}
        <textarea
          className="br-field"
          name={field.key}
          required={field.required}
          placeholder={field.placeholder}
        />
      </label>
    );
  }

  return (
    <label>
      {field.label}
      <input
        className="br-field"
        type={field.type}
        name={field.key}
        required={field.required}
        placeholder={field.placeholder}
        autoComplete={field.autoComplete}
        min={field.min}
        inputMode={field.type === "number" ? "numeric" : undefined}
      />
    </label>
  );
}

/**
 * The Boardroom application: her six-step wizard, now sent for real.
 *
 * Her page validated one step at a time with the browser's own messages and
 * ended on "This form is a preview. Your answers are not sent or saved." The
 * steps, the questions and the checks are hers, unchanged — required answers,
 * "choose at least one" on the two tick-any questions, and a social profile
 * only when the follow-up is to be on Instagram or Facebook. What is new is the
 * end: the answers go to the `boardroom-application` form, which files them in
 * Forms, makes a contact and a lead, and emails the owner.
 *
 * The page's questions and the stored form's are the same list by construction
 * (content/boardroom.ts and migration 074), and the server re-checks every
 * answer against the stored one. If a question is later made required in the
 * admin but not here, the server's refusal names it, and that sentence is shown
 * as it is rather than swallowed into "something went wrong".
 */
export function BoardroomApplication() {
  const formRef = useRef<HTMLFormElement>(null);
  const stepRefs = useRef<(HTMLFieldSetElement | null)[]>([]);
  const successRef = useRef<HTMLDivElement>(null);
  // Set by a deliberate move between steps, so the effect below scrolls and
  // focuses only then — not on the first render, and not when the social
  // profile check sends the reader back to step one, where the browser's own
  // message is already holding focus on the field that needs them.
  const moveFocus = useRef(false);
  const idBase = useId();
  const [honeypot, trapField] = useHoneypot();

  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    formRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
    // The fieldset is focusable (tabIndex -1) so a screen reader announces the
    // new step's legend, which is its name.
    const target = status === "sent" ? successRef.current : stepRefs.current[step];
    target?.focus({ preventScroll: true });
  }, [step, status]);

  function goTo(index: number) {
    moveFocus.current = true;
    setError(null);
    setStep(index);
  }

  /**
   * Her `validateStep`, question for question: each check sets the browser's
   * own validity message, and the first control that fails reports it.
   */
  function validateStep(index: number): boolean {
    const fieldset = stepRefs.current[index];
    if (!fieldset) return true;

    for (const field of STEPS[index].fields) {
      const controls = Array.from(fieldset.querySelectorAll<Control>(`[name="${field.key}"]`));
      const first = controls[0];
      if (!first) continue;

      if (field.type === "checkboxes") {
        if (field.required) {
          const ticked = controls.some((box) => box instanceof HTMLInputElement && box.checked);
          first.setCustomValidity(ticked ? "" : (field.groupError ?? "Choose at least one."));
        }
        continue;
      }
      if (field.type === "checkbox" || field.type === "select" || field.type === "number") continue;

      // `required` alone accepts a box of spaces, which the server then refuses
      // as unanswered — after the last step, far from the empty question.
      const value = first.value;
      if (field.required && value !== "" && value.trim() === "") {
        first.setCustomValidity("Please fill in this field.");
      } else if (field.type === "email" && value.trim() !== "" && !EMAIL_SHAPE.test(value.trim())) {
        first.setCustomValidity("Please enter a valid email address.");
      }
    }

    return Array.from(fieldset.querySelectorAll<Control>("input, select, textarea")).every(
      (control) => control.reportValidity(),
    );
  }

  /**
   * A message set by the checks above is cleared the moment the reader changes
   * the answer, as hers were; a tick-any question keeps its message on its first
   * box, so a tick anywhere in the group clears it.
   */
  function clearMessage(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!isControl(target)) return;
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      formRef.current
        ?.querySelector<HTMLInputElement>(`input[name="${target.name}"]`)
        ?.setCustomValidity("");
      return;
    }
    target.setCustomValidity("");
  }

  function next() {
    if (validateStep(step)) goTo(step + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    // Enter in a field before the last step means "continue", never "send".
    if (step < LAST_STEP) {
      next();
      return;
    }
    if (!validateStep(step)) return;

    const form = event.currentTarget;
    const data = collectAnswers(form);

    // Her one cross-step rule: a follow-up on social needs somewhere to go. The
    // question is on step one, so the reader is taken back to it and the
    // browser points at the empty box, exactly as her page did.
    const social = form.elements.namedItem("social_profile");
    if (data.follow_up === SOCIAL_FOLLOW_UP && !data.social_profile && social instanceof HTMLInputElement) {
      social.setCustomValidity(copy.socialRequired);
      flushSync(() => {
        setError(null);
        setStep(0);
      });
      social.reportValidity();
      social.setCustomValidity("");
      return;
    }

    setStatus("sending");
    setError(null);
    try {
      const result = await api.submitForm(
        BOARDROOM_FORM_SLUG,
        data,
        String(data.email),
        honeypot(),
      );
      setSuccessMessage(result.message || copy.success.fallback);
      moveFocus.current = true;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      // A refusal the server explains — a required answer, a rate limit — is
      // worth reading as written: the fix is on this page. Anything else gets
      // the address to write to instead.
      if (
        err instanceof ApiError &&
        (err.status === 400 || err.status === 413 || err.status === 429) &&
        err.message &&
        err.message !== "Invalid submission"
      ) {
        setError(err.message);
        return;
      }
      setError(copy.failure);
    }
  }

  const sending = status === "sending";

  return (
    <form
      ref={formRef}
      id="boardroom-application"
      className="br-apply-form"
      aria-label="Application for The Boardroom"
      noValidate
      onSubmit={handleSubmit}
      onChange={clearMessage}
    >
      {trapField}

      {status === "sent" ? (
        <div ref={successRef} className="br-success" role="status" tabIndex={-1}>
          <span aria-hidden="true">✓</span>
          <h3>{copy.success.title}</h3>
          <p>{successMessage}</p>
        </div>
      ) : (
        <>
          <div className="br-progress" aria-hidden="true">
            <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <p className="sr-only" aria-live="polite">
            Step {step + 1} of {STEPS.length}
          </p>

          {STEPS.map((formStep, index) => (
            <fieldset
              key={formStep.legend}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              className={index === step ? "br-step is-active" : "br-step"}
              tabIndex={-1}
            >
              <legend>{formStep.legend}</legend>
              {formStep.fields.map((field) => (
                <Question key={field.key} field={field} groupId={`${idBase}-${field.key}`} />
              ))}
            </fieldset>
          ))}

          {error && (
            <p className="br-form-error" role="alert">
              {error}
            </p>
          )}

          <div className="br-form-actions">
            <button
              type="button"
              className={step === 0 ? "br-back is-hidden" : "br-back"}
              onClick={() => goTo(step - 1)}
              disabled={sending}
            >
              {copy.actions.back}
            </button>
            {step < LAST_STEP ? (
              <button type="button" className="br-next" onClick={next}>
                {copy.actions.next}
              </button>
            ) : (
              <button type="submit" className="br-next" disabled={sending}>
                {sending ? copy.actions.sending : copy.actions.submit}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
