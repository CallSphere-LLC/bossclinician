import { useEffect, useId, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import {
  memberQuestionnaireFileUrl,
  memberRetreatsApi,
  uploadQuestionnaireFile,
  type GuestQuestion,
  type GuestQuestionnaire,
  type QuestionnaireFile,
} from "@/lib/retreatsApi";
import { cn } from "@/lib/cn";
import {
  BUTTON_OUTLINE,
  BUTTON_PRIMARY,
  FIGURE,
  Field,
  INPUT,
  LINK,
  PreviewNote,
  RadioGroup,
  SaveStatus,
  errorMessage,
  fieldErrorsFrom,
  formatSavedAt,
} from "./retreatUi";
import { answeredCount, answersToSend, missingRequired, visibleSections } from "./questionnaireRules";

/**
 * One owner-built retreat questionnaire (Retreat Profile, Flight Preferences,
 * Flight Details, …) rendered from its definition. Answers live on the
 * server: "Save progress" keeps a draft that survives a logout or another
 * device; "Submit" checks the required questions. She can come back and
 * update at any time. In the owner's preview nothing can be saved or uploaded.
 */
export function QuestionnaireForm({
  slug,
  questionnaire,
  readOnly,
  showAudienceTags,
  onSaved,
}: {
  slug: string;
  questionnaire: GuestQuestionnaire;
  readOnly: boolean;
  /** Owner preview of every question: mark the ones only some guests see. */
  showAudienceTags?: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => ({ ...questionnaire.response.answers }));
  const [response, setResponse] = useState(questionnaire.response);
  const [files, setFiles] = useState<QuestionnaireFile[]>(questionnaire.files);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "neutral" | "error" | "success" }>(() => initialMessage(questionnaire.response));
  const inFlight = useRef(false);

  const set = (questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setErrors((prev) => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const sections = visibleSections(questionnaire.definition, answers);
  const progress = answeredCount(questionnaire.definition, answers);

  async function save(submit: boolean) {
    if (readOnly || inFlight.current) return;
    if (submit) {
      const local = missingRequired(questionnaire.definition, answers);
      setErrors(local);
      if (Object.keys(local).length > 0) {
        setMessage({ text: "Please answer the questions marked below before submitting.", tone: "error" });
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const saved = await memberRetreatsApi.saveQuestionnaire(slug, questionnaire.key, answersToSend(questionnaire.definition, answers), submit, response.revision);
      setResponse(saved.response);
      setAnswers({ ...saved.response.answers });
      setFiles(saved.files);
      setErrors({});
      setMessage(
        submit
          ? { text: `Submitted ${formatSavedAt(saved.response.submittedAt)}. Thank you! You can update your answers at any time.`, tone: "success" }
          : { text: `Progress saved ${formatSavedAt(saved.response.updatedAt)}. Come back any time to finish.`, tone: "neutral" },
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

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save(true);
      }}
    >
      {questionnaire.definition.intro && <p className="whitespace-pre-wrap text-white/90">{questionnaire.definition.intro}</p>}
      {questionnaire.reviewNote && (
        <p className="rounded-xl border border-amber-200/30 bg-amber-200/[0.06] px-4 py-3 text-sm font-medium text-amber-200">
          From our team: {questionnaire.reviewNote}
        </p>
      )}
      <p className="text-xs text-orchid-dim">
        <span className={FIGURE}>{progress.answered}</span> of <span className={FIGURE}>{progress.total}</span> questions answered
        {questionnaire.dueDate ? ` · Please complete by ${formatDue(questionnaire.dueDate)}` : ""}
      </p>

      {sections.map((section) => (
        <fieldset key={section.id} className="flex min-w-0 flex-col gap-5 border-t border-white/10 pt-5">
          {section.title && <legend className="sr-only">{section.title}</legend>}
          {section.title && <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">{section.title}</h3>}
          {section.description && <p className="whitespace-pre-wrap rounded-xl border border-white/10 px-4 py-3 text-xs text-orchid-dim">{section.description}</p>}
          {section.questions.map((question) => (
            <div key={question.id} className="flex flex-col gap-1.5">
              {showAudienceTags && question.showTo !== "all" && (
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-gold">
                  {question.showTo === "shared_room" ? "Shown only to shared-room guests" : "Shown only to private-room guests"}
                </p>
              )}
              <QuestionInput
                inputId={`${id}-${question.id}`}
                question={question}
                value={answers[question.id]}
                error={errors[question.id]}
                readOnly={readOnly}
                onChange={(value) => set(question.id, value)}
                file={files.find((f) => f.id === answers[question.id]) ?? null}
                onUpload={async (file) => {
                  const uploaded = await uploadQuestionnaireFile(slug, questionnaire.key, question.id, file);
                  setFiles((prev) => [...prev, uploaded]);
                  set(question.id, uploaded.id);
                }}
                openFile={(fileId) => memberQuestionnaireFileUrl(slug, questionnaire.key, fileId)}
              />
            </div>
          ))}
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
        <button type="button" className={BUTTON_OUTLINE} disabled={readOnly || busy} onClick={() => void save(false)}>
          Save progress
        </button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={readOnly || busy}>
          {response.state === "submitted" ? "Update my answers" : "Submit"}
        </button>
      </div>
      {readOnly ? <PreviewNote /> : <SaveStatus text={message.text} tone={message.tone} />}
    </form>
  );
}

function initialMessage(response: GuestQuestionnaire["response"]): { text: string; tone: "neutral" | "error" | "success" } {
  if (response.state === "draft" && response.updatedAt) return { text: `Progress saved ${formatSavedAt(response.updatedAt)}`, tone: "neutral" };
  if (response.state === "submitted" && response.submittedAt) return { text: `Submitted ${formatSavedAt(response.submittedAt)}`, tone: "success" };
  return { text: "", tone: "neutral" };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function formatDue(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

function QuestionInput({
  inputId,
  question,
  value,
  error,
  readOnly,
  onChange,
  file,
  onUpload,
  openFile,
}: {
  inputId: string;
  question: GuestQuestion;
  value: unknown;
  error?: string;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  file: QuestionnaireFile | null;
  onUpload: (file: File) => Promise<void>;
  openFile: (fileId: number) => Promise<string>;
}) {
  const text = typeof value === "string" ? value : "";
  const describedBy = [question.help ? `${inputId}-hint` : "", error ? `${inputId}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id: inputId, disabled: readOnly, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } as const;

  switch (question.type) {
    case "short_text":
      return (
        <Field id={inputId} label={question.label} required={question.required} hint={question.help || undefined} error={error}>
          <input type="text" maxLength={500} className={INPUT} value={text} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case "long_text":
      return (
        <Field id={inputId} label={question.label} required={question.required} hint={question.help || undefined} error={error}>
          <textarea rows={4} maxLength={5000} className={cn(INPUT, "min-h-[6rem]")} value={text} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case "date":
      return (
        <Field id={inputId} label={question.label} required={question.required} hint={question.help || undefined} error={error}>
          <input type="date" className={INPUT} value={text} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case "time":
      return (
        <Field id={inputId} label={question.label} required={question.required} hint={question.help || undefined} error={error}>
          <input type="time" className={INPUT} value={text} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case "dropdown":
      return (
        <Field id={inputId} label={question.label} required={question.required} hint={question.help || undefined} error={error}>
          <select className={INPUT} value={text} onChange={(e) => onChange(e.target.value)} {...common}>
            <option value="">Choose…</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
      );
    case "single_choice":
    case "yes_no": {
      const options = question.type === "yes_no" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : question.options.map((o) => ({ value: o, label: o }));
      return (
        <div className="flex flex-col gap-1.5">
          <RadioGroup
            legend={question.label}
            name={inputId}
            required={question.required}
            disabled={readOnly}
            value={text || undefined}
            onChange={(v) => onChange(v)}
            error={error}
            options={options}
          />
          {question.help && <p className="text-xs text-orchid-dim">{question.help}</p>}
        </div>
      );
    }
    case "multiple_choice": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="flex min-w-0 flex-col gap-2" disabled={readOnly}>
          <legend className="mb-1 text-sm font-semibold text-white/90">
            {question.label}
            {question.required ? <span className="text-gold"> *</span> : <span className="font-normal text-orchid-dim"> (optional)</span>}
          </legend>
          {question.help && <p className="text-xs text-orchid-dim">{question.help}</p>}
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const on = chosen.includes(option);
              return (
                <label
                  key={option}
                  className={cn(
                    "inline-flex min-h-[2.75rem] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                    on ? "border-gold/70 bg-gold/[0.10] text-white" : "border-white/15 text-white/80 hover:border-gold/40",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-[#C9A24B]"
                    checked={on}
                    onChange={(e) => onChange(e.target.checked ? [...chosen, option] : chosen.filter((c) => c !== option))}
                  />
                  {option}
                </label>
              );
            })}
          </div>
          {error && <p role="alert" className="text-xs font-medium text-amber-200">{error}</p>}
        </fieldset>
      );
    }
    case "checkbox":
      return (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3 text-sm text-white/90">
            <input
              type="checkbox"
              className="mt-1 accent-[#C9A24B]"
              checked={value === true}
              disabled={readOnly}
              onChange={(e) => onChange(e.target.checked)}
              aria-invalid={error ? true : undefined}
            />
            <span>
              {question.label}
              {question.required && <span className="text-gold"> *</span>}
            </span>
          </label>
          {question.help && <p className="pl-7 text-xs text-orchid-dim">{question.help}</p>}
          {error && <p role="alert" className="text-xs font-medium text-amber-200">{error}</p>}
        </div>
      );
    case "file":
      return (
        <FileQuestion inputId={inputId} question={question} file={file} error={error} readOnly={readOnly} onUpload={onUpload} onClear={() => onChange(undefined)} openFile={openFile} />
      );
  }
}

function FileQuestion({
  inputId,
  question,
  file,
  error,
  readOnly,
  onUpload,
  onClear,
  openFile,
}: {
  inputId: string;
  question: GuestQuestion;
  file: QuestionnaireFile | null;
  error?: string;
  readOnly: boolean;
  onUpload: (file: File) => Promise<void>;
  onClear: () => void;
  openFile: (fileId: number) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    setPreviewUrl(null);
    if (file && file.mime.startsWith("image/") && !readOnly) {
      openFile(file.id)
        .then((url) => {
          revoked = url;
          setPreviewUrl(url);
        })
        .catch(() => undefined);
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
    // openFile is stable for a given questionnaire; the file id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, readOnly]);

  return (
    <Field id={inputId} label={question.label} required={question.required} hint={question.help || undefined} error={error || problem || undefined}>
      <div className="flex flex-wrap items-center gap-3">
        {previewUrl && <img src={previewUrl} alt="" className="size-16 rounded-xl border border-white/10 object-cover" />}
        {file ? (
          <p className="flex items-center gap-2 text-white/90">
            <Paperclip aria-hidden className="size-4 text-gold" />
            {file.name || "Uploaded file"}
          </p>
        ) : (
          <p className="text-orchid-dim">No file yet.</p>
        )}
        <label className={cn(BUTTON_OUTLINE, (readOnly || busy) && "pointer-events-none opacity-60")}>
          {busy ? "Uploading…" : file ? "Replace" : "Upload a photo or PDF"}
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            disabled={readOnly || busy}
            onChange={async (event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              setBusy(true);
              setProblem("");
              try {
                await onUpload(chosen);
              } catch (e) {
                setProblem(errorMessage(e, "That upload didn't go through. Please try again."));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {file && !readOnly && (
          <button type="button" className={LINK} onClick={onClear}>
            Remove
          </button>
        )}
      </div>
      {file && !readOnly && <p className="text-xs text-orchid-dim">Save progress or submit to keep this change.</p>}
    </Field>
  );
}
