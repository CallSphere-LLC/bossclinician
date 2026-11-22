import { useId, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { TASK_STATUS_LABEL, type RetreatSectionId, type TaskStatus } from "@/lib/retreatsApi";

/**
 * Shared chrome for the FlourisHealer Retreat Dashboard (sheet row 248).
 * Obsidian Luxe: dark field, gold hairlines, display serif for headings only.
 * Figures use the body font bold with tabular numerals, never the serif.
 */

export const FIGURE = "font-body font-bold tabular-nums text-white";

export const INPUT =
  "w-full min-h-[2.75rem] rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 font-body text-[0.95rem] text-white outline-none placeholder:text-white/30 focus:border-gold/60 focus:bg-white/[0.07] disabled:opacity-60";

const BUTTON_BASE =
  "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-45";

export const BUTTON_PRIMARY = cn(BUTTON_BASE, "bg-gold text-night-deep hover:bg-gold/90");
export const BUTTON_OUTLINE = cn(BUTTON_BASE, "border border-white/20 text-white/85 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white");
export const LINK = "text-gold underline underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold";

const PILL: Record<TaskStatus, string> = {
  not_started: "border-white/15 bg-white/[0.04] text-white/70",
  in_progress: "border-lilac/40 bg-lilac/[0.10] text-lilac",
  submitted: "border-sky-300/40 bg-sky-400/[0.10] text-sky-200",
  verified: "border-emerald-300/40 bg-emerald-400/[0.10] text-emerald-200",
  needs_attention: "border-amber-300/50 bg-amber-400/[0.12] text-amber-200",
};

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em]",
        PILL[status],
      )}
    >
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

export function Section({
  id,
  title,
  eyebrow,
  status,
  children,
  tag,
}: {
  id: RetreatSectionId;
  title: string;
  eyebrow?: string;
  status?: TaskStatus;
  tag?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      tabIndex={-1}
      className="scroll-mt-32 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-glass outline-none focus-visible:border-gold/60 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p>}
          <h2 id={headingId} className="mt-1 font-display text-xl text-white sm:text-2xl">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tag && (
            <span className="rounded-full border border-dashed border-white/25 px-3 py-1 text-[0.7rem] text-orchid-dim">{tag}</span>
          )}
          {status && <StatusPill status={status} />}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-5 text-sm leading-relaxed text-orchid">{children}</div>
    </section>
  );
}

/** Owner-written Markdown, rendered as lesson notes are (LessonBody.tsx). */
export function RetreatMarkdown({ body, className }: { body: string; className?: string }) {
  return (
    <div className={cn("prose-boss break-words [&_table]:block [&_table]:overflow-x-auto", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

export function PreviewNote() {
  return <p className="text-xs italic text-orchid-dim">Preview — saving is turned off</p>;
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-white/90">
        {label}
        {required ? <span className="text-gold"> *</span> : <span className="font-normal text-orchid-dim"> (optional)</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="text-xs text-orchid-dim">{hint}</p>}
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-amber-200">{error}</p>
      )}
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** A radio group as a fieldset, so screen readers announce the question once. */
export function RadioGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  required,
  error,
  disabled,
}: {
  legend: string;
  name: string;
  options: ChoiceOption<T>[];
  value: T | undefined | null;
  onChange: (value: T) => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-white/90">
        {legend}
        {required ? <span className="text-gold"> *</span> : <span className="font-normal text-orchid-dim"> (optional)</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex min-h-[2.75rem] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition-colors",
              value === option.value ? "border-gold/70 bg-gold/[0.10] text-white" : "border-white/15 text-white/80 hover:border-gold/40",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="accent-[#C9A24B]"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-xs font-medium text-amber-200">{error}</p>}
    </fieldset>
  );
}

export function SaveStatus({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "error" | "success" }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "text-xs",
        tone === "error" ? "font-medium text-amber-200" : tone === "success" ? "text-emerald-200" : "text-orchid-dim",
      )}
    >
      {text}
    </p>
  );
}

export function formatSavedAt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The message a 409 from a stale form deserves. */
export const STALE_FORM = "This form was updated on another device — reload to continue.";

export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 409) return STALE_FORM;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Field-level corrections from a 400 refusal, if the server named any. */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  const details = error && typeof error === "object" && "details" in error ? (error as { details: unknown }).details : null;
  if (!details || typeof details !== "object") return {};
  const nested = (details as { fieldErrors?: unknown }).fieldErrors;
  const source = nested && typeof nested === "object" ? nested : details;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
  }
  return out;
}
