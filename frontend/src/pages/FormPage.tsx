import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect, LuxeTextarea } from "@/components/luxe/LuxeField";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import NotFound from "@/pages/NotFound";
import type { PublicForm, PublicFormField } from "@/types";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * The answers, keyed by the admin's own field keys. Only the checkbox holds a
 * boolean; every other control the builder offers is a string, so the shape is
 * known even though the keys are not.
 */
type FormValues = Record<string, string | boolean>;

/**
 * The three columns the public endpoint now serves that `PublicForm` does not
 * yet name: the admin's intro, and what she chose to happen after a send.
 *
 * Optional to a fault. The page has to render against a server that has not
 * been deployed yet — an SSR build and an API build are two artefacts and one
 * of them lands first — and a missing `postAction` has to mean "show the
 * message", which is what every form did before the choice was honoured at all.
 */
type PublicFormDelivery = PublicForm & {
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

  const retry = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setForm(undefined);
    setLoadError(null);
    setValues({});
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
    return typeof value === "string" ? value : "";
  }

  function checkedOf(field: PublicFormField): boolean {
    return values[field.key] === true;
  }

  function isMissing(field: PublicFormField): boolean {
    if (!field.required) return false;
    return field.type === "checkbox" ? !checkedOf(field) : !textOf(field).trim();
  }

  function setValue(key: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);

    // Required-ness is the only rule the builder can express, so one message
    // covers the whole set and the offending controls are flagged individually
    // for assistive tech below.
    if (form.fields.some((field) => isMissing(field))) {
      setError("Please fill in the fields marked with a star before submitting.");
      return;
    }

    // The endpoint's own `email` field, derived from the schema rather than
    // from a key: left to guess, the server looks for a field literally keyed
    // `email`, and the builder seeds new fields as `field_2`. An admin who
    // adds an email field without renaming its key would otherwise get a blank
    // address on the submission and — the point of the whole feature — no lead.
    const emailField = form.fields.find((f) => f.type === "email" || f.key === "email");
    const email = emailField ? textOf(emailField).trim() : "";

    // The server validates the address it is sent, and its 400 would reach the
    // reader as the generic failure below. A typo deserves better than that.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email address doesn't look right — please check it and try again.");
      return;
    }

    // Every field is sent, including the untouched optional ones: the
    // submissions inbox lists whatever keys arrive, and a form whose columns
    // change from row to row is unreadable there.
    const data: Record<string, unknown> = {};
    for (const field of form.fields) {
      data[field.key] = field.type === "checkbox" ? checkedOf(field) : textOf(field).trim();
    }

    setStatus("loading");
    try {
      const result = await api.submitForm(form.slug, data, email || undefined);

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
    } catch {
      setStatus("error");
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

  function renderField(field: PublicFormField) {
    const invalid = invalidSubmit && isMissing(field);
    // LuxeField applies its own aria-invalid before spreading props, so these
    // win — the same arrangement the lead form relies on.
    const a11y = {
      "aria-invalid": invalid ? true : undefined,
      "aria-describedby": invalid ? errorId : undefined,
    } as const;

    switch (field.type) {
      case "textarea":
        return (
          <LuxeTextarea
            key={field.key}
            label={field.label}
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
          <label
            key={field.key}
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
        );

      default:
        return (
          <LuxeInput
            key={field.key}
            label={field.label}
            name={field.key}
            type={field.type === "email" ? "email" : "text"}
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
              {form.fields.map(renderField)}

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
