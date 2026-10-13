import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2 } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect, LuxeTextarea, luxeControlClass } from "@/components/luxe/LuxeField";
import { usePlayerSource } from "@/components/player/playerSource";
import { memberRequest } from "@/lib/memberApi";
import { formsApi } from "@/lib/formsApi";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate } from "@/lib/format";
import {
  FILE_CATEGORY_LABEL,
  acceptAttribute,
  fileCategoriesOf,
  fileProblem,
  maxSizeMbOf,
  ruleProblem,
  visibleQuestionKeys,
  type ShowIf,
} from "@/lib/formLogic";

/**
 * A form of ours, answered inside a lesson (migration 112).
 *
 * The lesson carries it as `toolKey = "form-<slug>"`; the questions are an
 * ordinary form built in Admin → Forms. A signed-in member answers as
 * themselves — no name or email boxes: the server fills both from the account
 * and files the reply against their contact, so the owner sees each student's
 * replies in Forms. They can send it again whenever they need to (the Lounge
 * forms are monthly), and the page says when they last did.
 *
 * In the admin's "Preview as student" there is no member, so the questions are
 * read through the admin's own session and the form is shown disabled —
 * nothing is sent from a preview.
 */

interface LessonFormField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string;
  showIf?: ShowIf | null;
  fileTypes?: string[];
  maxSizeMb?: number;
}

interface LessonFormDefinition {
  slug: string;
  name: string;
  descriptionMd: string;
  fields: LessonFormField[];
  submitLabel: string;
  successMessage: string;
}

interface LessonFormResponse {
  form: LessonFormDefinition;
  member: { name: string; email: string };
  replies: { id: number; createdAt: string }[];
}

type Values = Record<string, string | boolean | string[]>;

const path = (slug: string) => `/member/lesson-forms/${encodeURIComponent(slug)}`;

const CAPTION = "text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid";
const TICK =
  "mt-0.5 h-4 w-4 shrink-0 accent-gold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70";

function choiceRow(invalid: boolean): string {
  return cn(
    "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors duration-300",
    invalid ? "border-red-400/60 bg-red-500/[0.06]" : "border-white/12 bg-white/[0.04] hover:border-white/20",
  );
}

/** The admin-side read for the preview: the same questions, minus the two the account answers. */
async function loadForPreview(slug: string): Promise<LessonFormResponse> {
  const summary = (await formsApi.list()).find((form) => form.slug === slug);
  if (!summary) throw new Error("This lesson's form was not found. It may have been deleted in Forms.");
  const detail = await formsApi.get(summary.id);
  return {
    form: {
      slug: detail.slug,
      name: detail.name,
      descriptionMd: detail.descriptionMd || detail.description || "",
      fields: (detail.fields as unknown as LessonFormField[]).filter(
        (field) => field.key !== "name" && field.key !== "email",
      ),
      submitLabel: detail.submitLabel,
      successMessage: detail.successMessage,
    },
    member: { name: "The student", email: "their account email" },
    replies: [],
  };
}

export function LessonForm({ slug }: { slug: string }) {
  const { preview } = usePlayerSource();
  const errorId = useId();
  const fieldIds = useId();
  const [loaded, setLoaded] = useState<LessonFormResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState<Values>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const startedAt = useRef(Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setLoadError("");
    setValues({});
    setFiles({});
    setSent(null);
    const load = preview ? loadForPreview(slug) : memberRequest<LessonFormResponse>(path(slug));
    load
      .then((result) => {
        if (active) setLoaded(result);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error && err.message ? err.message : "This form couldn't be loaded.");
      });
    return () => {
      active = false;
    };
  }, [slug, preview]);

  if (loadError) {
    return (
      <p role="alert" className="rounded-2xl border border-gold/25 bg-gold/[0.06] px-5 py-6 text-sm text-orchid">
        {loadError}
      </p>
    );
  }
  if (!loaded) {
    return (
      <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-orchid-dim">
        Loading the form…
      </p>
    );
  }

  const { form, member, replies } = loaded;

  const text = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : "");
  const list = (key: string) => (Array.isArray(values[key]) ? (values[key] as string[]) : []);
  const setValue = (key: string, value: string | boolean | string[]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const answersForRules = (): Record<string, unknown> => {
    const answers: Record<string, unknown> = { ...values };
    for (const [key, file] of Object.entries(files)) if (file) answers[key] = { file: true };
    return answers;
  };
  const visible = visibleQuestionKeys(form.fields, answersForRules());
  const shown = form.fields.filter((field) => visible.has(field.key) && field.type !== "hidden");

  function isMissing(field: LessonFormField): boolean {
    if (!field.required) return false;
    if (field.type === "checkbox") return values[field.key] !== true;
    if (field.type === "checkboxes") return list(field.key).length === 0;
    if (field.type === "file") return !files[field.key];
    return !text(field.key).trim();
  }

  function chooseFile(field: LessonFormField, file: File | null) {
    const problem = file ? fileProblem(field, file) : null;
    setFileErrors((current) => {
      const next = { ...current };
      if (problem) next[field.key] = problem;
      else delete next[field.key];
      return next;
    });
    setFiles((current) => ({ ...current, [field.key]: problem ? null : file }));
    const input = fileInputs.current[field.key];
    if (input && (problem || !file)) input.value = "";
  }

  function startAgain() {
    setValues({});
    setFiles({});
    setFileErrors({});
    setError("");
    setTriedSubmit(false);
    setSent(null);
    startedAt.current = Date.now();
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (preview || busy) return;
    setError("");
    setTriedSubmit(true);
    if (shown.some(isMissing)) {
      setError("Please answer the questions marked with a star.");
      return;
    }
    for (const field of shown) {
      const file = field.type === "file" ? files[field.key] ?? null : null;
      const problem = field.type === "file" ? file && fileProblem(field, file) : ruleProblem(field, values[field.key]);
      if (problem) {
        setError(problem);
        return;
      }
    }

    const data: Record<string, unknown> = {};
    const attached: Record<string, File> = {};
    for (const field of shown) {
      if (field.type === "file") {
        const file = files[field.key];
        if (file) attached[field.key] = file;
        continue;
      }
      data[field.key] =
        field.type === "checkbox"
          ? values[field.key] === true
          : field.type === "checkboxes"
            ? list(field.key)
            : text(field.key).trim();
    }
    const envelope = { data, elapsedMs: Date.now() - startedAt.current };

    setBusy(true);
    try {
      let body: BodyInit;
      if (Object.keys(attached).length > 0) {
        const multipart = new FormData();
        multipart.append("payload", JSON.stringify(envelope));
        for (const [key, file] of Object.entries(attached)) multipart.append(key, file, file.name);
        body = multipart;
      } else {
        body = JSON.stringify(envelope);
      }
      const result = await memberRequest<{ ok: true; message: string; submittedAt: string }>(
        `${path(slug)}/submit`,
        { method: "POST", body },
      );
      setLoaded((current) =>
        current
          ? { ...current, replies: [{ id: -Date.now(), createdAt: result.submittedAt }, ...current.replies] }
          : current,
      );
      setSent(result.message || form.successMessage);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Your answers couldn't be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const lastSent = replies[0]?.createdAt ?? null;

  if (sent) {
    return (
      <div ref={rootRef} role="status" className="rounded-2xl border border-gold/25 bg-gold/[0.06] px-5 py-8 text-center sm:px-8">
        <CheckCircle2 aria-hidden className="mx-auto size-8 text-gold" />
        <p className="mx-auto mt-4 max-w-[46ch] text-balance text-base leading-relaxed text-white">{sent}</p>
        <p className="mt-2 text-xs text-orchid-dim">Sent as {member.name} · {member.email}</p>
        <LuxeButton variant="outline" size="md" type="button" onClick={startAgain} className="mt-6 min-h-[44px]">
          Send another
        </LuxeButton>
      </div>
    );
  }

  function renderField(field: LessonFormField) {
    const invalid = triedSubmit && isMissing(field);
    const a11y = {
      "aria-invalid": invalid ? true : undefined,
      "aria-describedby": invalid ? errorId : undefined,
    } as const;
    const hint = field.helpText?.trim() || undefined;
    const placeholder = field.placeholder?.trim() || undefined;
    const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
    const star = field.required ? (
      <span aria-hidden className="ml-1 text-gold">
        *
      </span>
    ) : null;
    const label = field.label;

    switch (field.type) {
      case "textarea":
        return (
          <LuxeTextarea
            key={field.key}
            label={label}
            hint={hint}
            placeholder={placeholder}
            name={field.key}
            rows={5}
            required={field.required}
            disabled={Boolean(preview)}
            value={text(field.key)}
            onChange={(e) => setValue(field.key, e.target.value)}
            {...a11y}
          />
        );
      case "select":
        return (
          <LuxeSelect
            key={field.key}
            label={label}
            hint={hint}
            name={field.key}
            required={field.required}
            disabled={Boolean(preview)}
            value={text(field.key)}
            onChange={(e) => setValue(field.key, e.target.value)}
            {...a11y}
          >
            <option value="">Choose one…</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </LuxeSelect>
        );
      case "checkbox":
        return (
          <label key={field.key} className={choiceRow(invalid)}>
            <input
              type="checkbox"
              name={field.key}
              disabled={Boolean(preview)}
              checked={values[field.key] === true}
              onChange={(e) => setValue(field.key, e.target.checked)}
              className={TICK}
              {...a11y}
            />
            <span className="text-[0.95rem] leading-relaxed text-white/85">
              {label}
              {star}
              {hint && <span className="mt-0.5 block text-xs text-orchid-faint">{hint}</span>}
            </span>
          </label>
        );
      case "radio":
      case "checkboxes": {
        const multi = field.type === "checkboxes";
        const ticked = list(field.key);
        return (
          <fieldset key={field.key} className="flex flex-col gap-2">
            <legend className={cn(CAPTION, "mb-2")}>
              {label}
              {star}
            </legend>
            <div className="flex flex-col gap-2">
              {options.map((option) => (
                <label key={option} className={choiceRow(invalid)}>
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={field.key}
                    value={option}
                    disabled={Boolean(preview)}
                    checked={multi ? ticked.includes(option) : text(field.key) === option}
                    onChange={(e) =>
                      multi
                        ? setValue(
                            field.key,
                            e.target.checked ? [...ticked, option] : ticked.filter((entry) => entry !== option),
                          )
                        : setValue(field.key, option)
                    }
                    className={TICK}
                    aria-describedby={a11y["aria-describedby"]}
                  />
                  <span className="text-[0.95rem] leading-relaxed text-white/85">{option}</span>
                </label>
              ))}
            </div>
            {hint && <p className="text-xs text-orchid-faint">{hint}</p>}
          </fieldset>
        );
      }
      case "file": {
        const chosen = files[field.key] ?? null;
        const inputId = `${fieldIds}-${field.key}`;
        const refusal = fileErrors[field.key];
        const kinds = fileCategoriesOf(field)
          .map((category) => FILE_CATEGORY_LABEL[category])
          .join(", ");
        return (
          <div key={field.key} className="flex flex-col gap-2">
            <label htmlFor={inputId} className={CAPTION}>
              {label}
              {star}
            </label>
            <input
              id={inputId}
              ref={(element) => {
                fileInputs.current[field.key] = element;
              }}
              type="file"
              name={field.key}
              disabled={Boolean(preview)}
              accept={acceptAttribute(field)}
              onChange={(e) => chooseFile(field, e.target.files?.[0] ?? null)}
              className={cn(
                luxeControlClass,
                "cursor-pointer file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-gold/15 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gold",
                (invalid || refusal) && "border-red-400/60",
              )}
              aria-invalid={invalid || refusal ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
            />
            <p className="text-xs text-orchid-faint">
              {hint ? `${hint} ` : ""}
              {kinds}, up to {maxSizeMbOf(field)} MB.
            </p>
            {chosen && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75">
                <span className="min-w-0 break-all">
                  {chosen.name} · {formatBytes(chosen.size)}
                </span>
                <button
                  type="button"
                  onClick={() => chooseFile(field, null)}
                  className="font-semibold text-gold underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              </p>
            )}
            {refusal && (
              <p role="alert" className="text-xs font-medium text-red-400">
                {refusal}
              </p>
            )}
          </div>
        );
      }
      default:
        return (
          <LuxeInput
            key={field.key}
            label={label}
            hint={hint}
            placeholder={placeholder}
            name={field.key}
            type={
              field.type === "email"
                ? "email"
                : field.type === "phone"
                  ? "tel"
                  : field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : "text"
            }
            required={field.required}
            disabled={Boolean(preview)}
            value={text(field.key)}
            onChange={(e) => setValue(field.key, e.target.value)}
            {...a11y}
          />
        );
    }
  }

  return (
    <div
      ref={rootRef}
      className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-glass sm:p-7"
    >
      <div className="mb-6 flex flex-col gap-1.5">
        <p className={CAPTION}>{form.name.replace(/^[^:]*:\s*/, "") || form.name}</p>
        <p className="text-xs text-orchid-dim">
          {preview
            ? "Preview: students answer here under their own name and email. Sending is off in a preview."
            : `Sending as ${member.name} · ${member.email}`}
        </p>
        {lastSent && (
          <p className="text-xs text-orchid-dim">
            You last sent this on {formatDate(lastSent)}
            {replies.length > 1 ? ` · ${replies.length} times so far` : ""}.
          </p>
        )}
      </div>

      {form.descriptionMd.trim() && (
        <div className="prose-boss mb-6 break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.descriptionMd}</ReactMarkdown>
        </div>
      )}

      <form onSubmit={submit} noValidate aria-busy={busy} className="space-y-5">
        {shown.map(renderField)}

        {error && (
          <p
            id={errorId}
            role="alert"
            className="rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
          >
            {error}
          </p>
        )}

        <div className="pt-1">
          <LuxeButton
            variant="foil"
            size="md"
            type="submit"
            disabled={busy || Boolean(preview)}
            className="min-h-[44px] w-full sm:w-auto"
          >
            {busy ? "Sending…" : form.submitLabel || "Submit"}
          </LuxeButton>
        </div>
      </form>
    </div>
  );
}
