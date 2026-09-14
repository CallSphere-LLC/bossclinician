import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import {
  LuxeInput,
  LuxeSelect,
  LuxeTextarea,
  luxeControlClass,
} from "@/components/luxe/LuxeField";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
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
import { submitFormWithFiles } from "@/lib/publicFormUpload";
import { contactPage } from "@/content/site";
import NotFound from "@/pages/NotFound";
import type { PublicForm, PublicFormField } from "@/types";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const IDENTITY_NAME = "__contact_name";
const IDENTITY_EMAIL = "__contact_email";

/**
 * The answers, keyed by the admin's own field keys. The single tick box holds a
 * boolean, "tick any that apply" a list of the ticked choices, and every other
 * control a string. Files are held apart, in their own state.
 */
type FormValues = Record<string, string | boolean | string[]>;

/**
 * A question as the builder stores it. The public endpoint passes every stored
 * property through; `PublicFormField` names only the original few.
 */
type RenderedField = PublicFormField & {
  placeholder?: string;
  helpText?: string;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string;
  showIf?: ShowIf | null;
  fileTypes?: string[];
  maxSizeMb?: number;
};

const CAPTION = "text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid";
const TICK =
  "mt-0.5 h-4 w-4 shrink-0 accent-gold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70";

/** One tappable row for a tick box or a radio choice. */
function choiceRow(invalid: boolean): string {
  return cn(
    "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5",
    "transition-colors duration-300",
    invalid
      ? "border-red-400/60 bg-red-500/[0.06]"
      : "border-white/12 bg-white/[0.04] hover:border-white/20",
  );
}

/**
 * The three columns the public endpoint now serves that `PublicForm` does not
 * yet name: the admin's intro, and what she chose to happen after a send.
 *
 * Optional to a fault. The page has to render against a server that has not
 * been deployed yet — an SSR build and an API build are two artefacts and one
 * of them lands first — and a missing `postAction` has to mean "show the
 * message", which is what every form did before the choice was honoured at all.
 */
type PublicFormDelivery = Omit<PublicForm, "fields"> & {
  fields: RenderedField[];
  descriptionMd?: string;
  postAction?: "message" | "redirect" | "download";
  redirectUrl?: string;
};

/**
 * Where a form is allowed to send somebody.
 *
 * `redirectUrl` is a string an admin typed, and this page assigns it to
 * `location.href`. `javascript:` and `data:` URLs are both accepted there by
 * every browser, so an admin account — or anything that ever gets to write one
 * form row — would otherwise be a stored-XSS hole on the public site. Only an
 * absolute http(s) address or a path on this site survives; anything else falls
 * back to the thank-you message, which is a worse redirect and not a hole.
 */
export function safeRedirect(raw: string | undefined): string | null {
  const target = (raw ?? "").trim();
  if (!target) return null;
  if (target.startsWith("/") && !target.startsWith("//")) return target;
  try {
    const url = new URL(target);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Browsers can only autofill what they can name, and the builder has no
 * autocomplete setting — so the keys people actually use are inferred here.
 * Without it a form asking for a name and an email is a slower version of the
 * site's own lead form.
 */
function autoCompleteFor(field: PublicFormField): string | undefined {
  if (field.type === "email" || field.key === "email") return "email";
  if (/name/i.test(field.key)) return "name";
  if (/phone|tel/i.test(field.key)) return "tel";
  return undefined;
}

/** Older/newer builders may already store the two now-universal fields. */
export function isIdentityField(field: PublicFormField): boolean {
  return field.key === "name" || field.key === "email";
}

/**
 * A form built in the admin, rendered on the public site.
 *
 * The builder lets an admin invent fields at runtime, so this page is the one
 * public surface whose controls aren't known until the fetch lands. It is
 * still assembled from the same parts as the hand-written lead form — the same
 * card, the same field material, the same single error region — because a form
 * that looks generated is a form people abandon.
 */
export default function FormPage() {
  const { slug = "" } = useParams();
  const reduce = useReducedMotion();
  const errorId = useId();
  // `undefined` while the fetch is in flight, `null` once it has failed.
  const [form, setForm] = useState<PublicFormDelivery | null | undefined>(undefined);
  const [values, setValues] = useState<FormValues>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  // A shared link opened on flaky mobile data is not a dead URL, so a failed
  // fetch is held apart from a missing form and offered a retry. Bumping this
  // re-runs the effect.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Chosen files, held apart from the typed answers: a File can't be trimmed,
  // compared or sent as JSON. A question with nothing chosen has no entry.
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const fieldIds = useId();

  const retry = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setForm(undefined);
    setLoadError(null);
    setValues({});
    setFiles({});
    setFileErrors({});
    api
      .publicForm(slug)
      .then((result) => {
        if (!cancelled) setForm(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An unpublished form 404s exactly like one that never existed, and a
        // visitor is owed neither distinction — both are simply a dead URL.
        // Anything else is our problem, not the reader's, and is worth saying.
        if (err instanceof ApiError && err.status === 404) {
          setForm(null);
          return;
        }
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : "This form couldn't be loaded just now.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  // Reading the value defaults rather than seeding state from the fetch: an
  // untouched field has no entry, and a second effect to plant empty strings
  // would only be a way for the two to disagree.
  function textOf(field: PublicFormField): string {
    const value = values[field.key];
    if (typeof value === "string") return value;
    // A hidden question is "filled in for them" by the link that brought them
    // here: /f/<slug>?<key>=<value>, the way a campaign link carries its source.
    if (field.type === "hidden" && typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get(field.key) ?? "";
    }
    return "";
  }

  function checkedOf(field: PublicFormField): boolean {
    return values[field.key] === true;
  }

  function listOf(field: PublicFormField): string[] {
    const value = values[field.key];
    return Array.isArray(value) ? value : [];
  }

  function fileOf(field: PublicFormField): File | null {
    return files[field.key] ?? null;
  }

  function isMissing(field: PublicFormField): boolean {
    // Nobody can fill in a box they can't see, so it never blocks the reply.
    if (!field.required || field.type === "hidden") return false;
    if (field.type === "checkbox") return !checkedOf(field);
    if (field.type === "checkboxes") return listOf(field).length === 0;
    if (field.type === "file") return fileOf(field) === null;
    return !textOf(field).trim();
  }

  function setValue(key: string, value: string | boolean | string[]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * The answers as the show rules read them: what was typed or ticked, and a
   * marker for each question a file has been chosen for.
   */
  function answersForRules(): Record<string, unknown> {
    const answers: Record<string, unknown> = { ...values };
    for (const [key, file] of Object.entries(files)) if (file) answers[key] = { file: true };
    return answers;
  }

  /**
   * A file picked (or removed). The kind and size are checked here from the
   * name and the size, so a 30MB photo is refused before a slow upload rather
   * than after it; the server checks the bytes themselves either way.
   */
  function chooseFile(field: RenderedField, file: File | null) {
    const problem = file ? fileProblem(field, file) : null;
    setFileErrors((prev) => {
      const next = { ...prev };
      if (problem) next[field.key] = problem;
      else delete next[field.key];
      return next;
    });
    setFiles((prev) => ({ ...prev, [field.key]: problem ? null : file }));
    // A refused or removed file must not stay in the picker looking chosen.
    const input = fileInputs.current[field.key];
    if (input && (problem || !file)) input.value = "";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);

    // Only the questions this person is actually shown count: one whose show
    // rule isn't met is neither required nor sent. The server decides the same
    // thing again from the same rules (services/formLogic.ts).
    const visible = visibleQuestionKeys(form.fields, answersForRules());
    const shown = form.fields.filter((field) => !isIdentityField(field) && visible.has(field.key));

    // Required-ness gets one message for the whole set, and the offending
    // controls are flagged individually for assistive tech below.
    const name = String(values[IDENTITY_NAME] ?? "").trim();
    const email = String(values[IDENTITY_EMAIL] ?? "").trim().toLowerCase();
    if (!name || !email || shown.some((field) => isMissing(field))) {
      setError("Please fill in the fields marked with a star before submitting.");
      return;
    }

    // The endpoint's own `email` field, derived from the schema rather than
    // from a key: left to guess, the server looks for a field literally keyed
    // `email`, and the builder seeds new fields as `field_2`. An admin who
    // adds an email field without renaming its key would otherwise get a blank
    // address on the submission and — the point of the whole feature — no lead.
    // The server validates the address it is sent, and its 400 would reach the
    // reader as the generic failure below. A typo deserves better than that.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email address doesn't look right — please check it and try again.");
      return;
    }

    // The "More rules" on each question, and each chosen file, get a sentence
    // of their own: "fill in the starred fields" is no help when the problem is
    // a ZIP code with four digits in it.
    for (const field of shown) {
      const file = field.type === "file" ? fileOf(field) : null;
      const problem =
        field.type === "file"
          ? file && fileProblem(field, file)
          : field.type === "hidden"
            ? null
            : ruleProblem(field, values[field.key]);
      if (problem) {
        setError(problem);
        return;
      }
    }

    // Every shown field is sent, including the untouched optional ones: the
    // submissions inbox lists whatever keys arrive, and a form whose columns
    // change from row to row is unreadable there. Files travel separately.
    const data: Record<string, unknown> = {};
    const attached: Record<string, File> = {};
    for (const field of shown) {
      if (field.type === "file") {
        const file = fileOf(field);
        if (file) attached[field.key] = file;
        continue;
      }
      data[field.key] =
        field.type === "checkbox"
          ? checkedOf(field)
          : field.type === "checkboxes"
            ? listOf(field)
            : textOf(field).trim();
    }
    data.name = name;
    data.email = email;

    setStatus("loading");
    try {
      // JSON exactly as before unless a file is actually attached.
      const result =
        Object.keys(attached).length > 0
          ? await submitFormWithFiles(form.slug, data, email, attached)
          : await api.submitForm(form.slug, data, email);

      // What the admin chose should happen next. A form built to send people to
      // a booking page, a checkout or a download used to end on the thank-you
      // message regardless — the setting was stored, served and ignored, and
      // the whole point of that kind of form is the page after it.
      const destination = form.postAction === "redirect" ? safeRedirect(form.redirectUrl) : null;
      if (destination) {
        // `replace`, not `assign`: Back from the destination should return to
        // whatever brought them here, not to a filled-in form that resubmits.
        window.location.replace(destination);
        return;
      }

      setSuccessMessage(result.message || form.successMessage);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      // A refusal the server explains — a required answer, a file of the wrong
      // kind or size, too many uploads in an hour — is shown in its own words,
      // because "email us instead" is no help when the fix is on this page.
      if (
        err instanceof ApiError &&
        (err.status === 400 || err.status === 413 || err.status === 429) &&
        err.message &&
        err.message !== "Invalid submission"
      ) {
        setError(err.message);
        return;
      }
      setError(
        `Something went wrong submitting this form. Please email ${contactPage.email} directly.`,
      );
    }
  }

  if (loadError) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Form unavailable"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <h1 className="mt-6 text-balance font-display text-[1.6rem] font-medium leading-tight text-white sm:text-[2rem]">
          This form didn't load.
        </h1>
        <p role="alert" className="copy-luxe mx-auto mt-4 max-w-[46ch] text-pretty">
          {loadError} The link is fine — try again, or email {contactPage.email} and I'll take it
          from there.
        </p>
        <LuxeButton variant="foil" size="md" onClick={retry} className="mt-7 min-h-[44px]">
          Try again
        </LuxeButton>
      </Section>
    );
  }

  if (form === undefined) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Loading form"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <p role="status" className="copy-luxe mt-6">
          Loading form…
        </p>
      </Section>
    );
  }

  if (form === null) {
    return <NotFound />;
  }

  // Mirrors the lead form: the flag is derived at render rather than stored, so
  // a field stops being marked invalid the moment it is filled in.
  const invalidSubmit = error !== null && status !== "error";
  const name = String(values[IDENTITY_NAME] ?? "");
  const email = String(values[IDENTITY_EMAIL] ?? "");
  // Worked out on every render, so a question appears the moment the answer it
  // depends on is given and goes again the moment it is changed.
  const visible = visibleQuestionKeys(form.fields, answersForRules());

  function renderField(field: RenderedField) {
    const invalid = invalidSubmit && isMissing(field);
    // LuxeField applies its own aria-invalid before spreading props, so these
    // win — the same arrangement the lead form relies on.
    const a11y = {
      "aria-invalid": invalid ? true : undefined,
      "aria-describedby": invalid ? errorId : undefined,
    } as const;
    // The builder's "note under the question" and "faint text inside the box".
    const hint = field.helpText?.trim() || undefined;
    const placeholder = field.placeholder?.trim() || undefined;
    const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
    const star = field.required ? (
      <span aria-hidden className="ml-1 text-gold">
        *
      </span>
    ) : null;

    switch (field.type) {
      case "textarea":
        return (
          <LuxeTextarea
            key={field.key}
            label={field.label}
            hint={hint}
            placeholder={placeholder}
            name={field.key}
            rows={5}
            required={field.required}
            value={textOf(field)}
            onChange={(e) => setValue(field.key, e.target.value)}
            {...a11y}
          />
        );

      case "select":
        return (
          <LuxeSelect
            key={field.key}
            label={field.label}
            hint={hint}
            name={field.key}
            required={field.required}
            value={textOf(field)}
            onChange={(e) => setValue(field.key, e.target.value)}
            {...a11y}
          >
            {/* The empty first option is what keeps a required select an actual
                question instead of one already answered by its first option. */}
            <option value="">Choose one…</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </LuxeSelect>
        );

      case "checkbox":
        // A checkbox has no field shell: the label belongs beside the box, not
        // above it as an uppercase caption, and the whole row is the tap target.
        return (
          <div key={field.key} className="flex flex-col gap-2">
          <label
            className={cn(
              "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5",
              "transition-colors duration-300",
              invalid
                ? "border-red-400/60 bg-red-500/[0.06]"
                : "border-white/12 bg-white/[0.04] hover:border-white/20",
            )}
          >
            <input
              type="checkbox"
              name={field.key}
              checked={checkedOf(field)}
              onChange={(e) => setValue(field.key, e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70"
              {...a11y}
            />
            <span className="text-[0.95rem] leading-relaxed text-white/85">
              {field.label}
              {field.required && (
                <span aria-hidden className="ml-1 text-gold">
                  *
                </span>
              )}
            </span>
          </label>
          {hint && <p className="text-xs text-orchid-faint">{hint}</p>}
          </div>
        );

      case "radio":
      case "checkboxes": {
        // Choices as choices. Drawn as a free-text box before, which made a
        // "choose one" question something people had to spell exactly.
        const multiple = field.type === "checkboxes";
        const ticked = listOf(field);
        return (
          <fieldset key={field.key} className="flex flex-col gap-2">
            <legend className={cn(CAPTION, "mb-2")}>
              {field.label}
              {star}
            </legend>
            <div className="grid gap-2">
              {options.map((option) => (
                <label key={option} className={choiceRow(invalid)}>
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name={field.key}
                    value={option}
                    checked={multiple ? ticked.includes(option) : textOf(field) === option}
                    onChange={(e) =>
                      multiple
                        ? setValue(
                            field.key,
                            e.target.checked
                              ? [...ticked.filter((entry) => entry !== option), option]
                              : ticked.filter((entry) => entry !== option),
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
        const chosen = fileOf(field);
        const inputId = `${fieldIds}-${field.key}`;
        const refusal = fileErrors[field.key];
        const kinds = fileCategoriesOf(field)
          .map((category) => FILE_CATEGORY_LABEL[category])
          .join(", ");
        return (
          <div key={field.key} className="flex flex-col gap-2">
            <label htmlFor={inputId} className={CAPTION}>
              {field.label}
              {star}
            </label>
            <input
              id={inputId}
              ref={(element) => {
                fileInputs.current[field.key] = element;
              }}
              type="file"
              name={field.key}
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

      // "Filled in for them": carried with the reply, never shown as a box the
      // reader is left wondering whether to type into.
      case "hidden":
        return <input key={field.key} type="hidden" name={field.key} value={textOf(field)} />;

      default:
        return (
          <LuxeInput
            key={field.key}
            label={field.label}
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
            inputMode={field.type === "number" ? "decimal" : undefined}
            autoComplete={autoCompleteFor(field)}
            required={field.required}
            value={textOf(field)}
            onChange={(e) => setValue(field.key, e.target.value)}
            {...a11y}
          />
        );
    }
  }

  // What the admin wrote above the questions. The builder writes `descriptionMd`
  // and only ever wrote that; `description` is the older plain column, still
  // filled in by forms created through the API, and reading it second means the
  // intro appears either way rather than — as it did — never.
  const intro = form.descriptionMd || form.description;

  return (
    <>
      <Seo title={`${form.name} | Boss Clinician`} description={intro || undefined} />

      <LuxePageHero title={form.name} tone="violet" align="center" />

      <Section surface="base" space="md" aria-label={form.name} containerClassName="max-w-2xl">
        {status === "success" ? (
          <GlassCard accent="green" interactive={false} spotlight={false}>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
              role="status"
              className="px-6 py-10 text-center sm:px-10 sm:py-12"
            >
              <span
                aria-hidden
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.08] text-gold"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
                </svg>
              </span>

              {/* The confirmation is the admin's own success message, set as the
                  headline. The builder exposes exactly one line of copy for this
                  moment, and burying it under a canned "You're in" would make
                  the field pointless. */}
              <h2 className="mx-auto mt-6 max-w-[30ch] text-balance font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">
                {successMessage}
              </h2>

              <GoldRule className="mx-auto mt-6" />
            </motion.div>
          </GlassCard>
        ) : (
          <GlassCard accent="gold" interactive={false} className="p-6 sm:p-8">
            {intro && (
              // Admin-authored Markdown, proofed the way the funnel body is: it
              // sits in the card rather than in the hero's lede, because that
              // lede is a <p> and a paragraph of Markdown inside it is invalid
              // markup the SSR pass and the browser would disagree about.
              <div className="prose-boss mb-7 break-words [&_table]:block [&_table]:overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              noValidate
              aria-busy={status === "loading"}
              className="space-y-5"
            >
              <LuxeInput
                label="Your name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setValue(IDENTITY_NAME, event.target.value)}
                aria-invalid={invalidSubmit && !name.trim() ? true : undefined}
                aria-describedby={invalidSubmit && !name.trim() ? errorId : undefined}
              />
              <LuxeInput
                label="Email address"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setValue(IDENTITY_EMAIL, event.target.value)}
                aria-invalid={invalidSubmit && !email.trim() ? true : undefined}
                aria-describedby={invalidSubmit && !email.trim() ? errorId : undefined}
              />
              {form.fields
                .filter((field) => !isIdentityField(field) && visible.has(field.key))
                .map(renderField)}

              {error && (
                <motion.p
                  id={errorId}
                  role="alert"
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  >
                    <circle cx="12" cy="12" r="9.25" />
                    <path d="M12 7.5v5.25M12 16.25v.01" />
                  </svg>
                  {/* min-w-0 lets the fallback address wrap instead of forcing
                      the card wider than a 360px viewport. */}
                  <span className="min-w-0 break-words">{error}</span>
                </motion.p>
              )}

              <div className="pt-1">
                <LuxeButton
                  variant="foil"
                  size="md"
                  type="submit"
                  disabled={status === "loading"}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  {status === "loading" ? "Sending…" : form.submitLabel}
                  {status === "loading" ? (
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      className="h-4 w-4 animate-spin"
                    >
                      <circle cx="12" cy="12" r="9" opacity="0.3" />
                      <path d="M21 12a9 9 0 0 0-9-9" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5 transition-transform duration-500 ease-luxe group-hover:translate-x-1"
                    >
                      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
                    </svg>
                  )}
                </LuxeButton>
              </div>
            </form>
          </GlassCard>
        )}
      </Section>
    </>
  );
}
