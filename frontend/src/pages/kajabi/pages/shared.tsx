import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "motion/react";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect, LuxeTextarea } from "@/components/luxe/LuxeField";
import { GoldRule } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * The shared kit for the pages rebuilt from bossclinician.com's one-off Kajabi
 * pages (thank-you pages, opt-ins, legal agreements, link hub).
 *
 * Kajabi built each of these from a different theme, so there is no one layout
 * to copy. What they share is a handful of shapes — a numbered "what happens
 * next" list, a stack of link cards, a framed photo, an opt-in form — and those
 * live here so thirty pages read as one site rather than thirty imports.
 */

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** One rise recipe for these pages; only the delay changes. */
export function rise(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? false : { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.75, delay: reduce ? 0 : delay, ease: EASE },
  };
}

export const INLINE_LINK = cn(
  "text-gold underline decoration-gold/40 underline-offset-4",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
);

/** True for addresses that leave the site (booking tools, contracts, socials). */
export function isExternal(href: string): boolean {
  return /^(https?:)?\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");
}

/**
 * A text link that picks the right element: a router `Link` for our own pages,
 * an anchor (new tab for the web) for everything else.
 */
export function SmartLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  if (isExternal(href)) {
    const web = /^(https?:)?\/\//i.test(href);
    return (
      <a
        href={href}
        className={className ?? INLINE_LINK}
        target={web ? "_blank" : undefined}
        rel={web ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className ?? INLINE_LINK}>
      {children}
    </Link>
  );
}

/** A primary/secondary CTA that is a route on this site or an external address. */
export function CtaButton({
  href,
  variant = "foil",
  size = "lg",
  className,
  children,
}: {
  href: string;
  variant?: "foil" | "glass" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  if (isExternal(href) || href.startsWith("#") || href.startsWith("/downloads/")) {
    const web = /^(https?:)?\/\//i.test(href) || href.startsWith("/downloads/");
    return (
      <LuxeButton
        variant={variant}
        size={size}
        href={href}
        target={web ? "_blank" : undefined}
        rel={web ? "noopener noreferrer" : undefined}
        className={className}
      >
        {children}
      </LuxeButton>
    );
  }
  return (
    <LuxeButton variant={variant} size={size} to={href} className={className}>
      {children}
    </LuxeButton>
  );
}

/* ── Framed photograph ─────────────────────────────────────────────────── */

/**
 * The plate treatment the rest of the site gives a photograph: rounded, gold
 * hairline, ambient bloom. Every image is self-hosted under
 * /images/kajabi-pages/ — the CSP allows no third-party image hosts.
 */
export function PhotoPlate({
  src,
  alt,
  className,
  imgClassName,
  ratio,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  /** e.g. "aspect-[4/5]". Omit to keep the image's own proportions. */
  ratio?: string;
}) {
  return (
    <div className={cn("relative isolate mx-auto w-full", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background: "radial-gradient(60% 55% at 50% 35%, rgba(123,94,167,0.38) 0%, transparent 72%)",
        }}
      />
      <div className="overflow-hidden rounded-2xl border border-gold/25 bg-night-deep shadow-[0_40px_90px_-36px_rgba(0,0,0,0.9)]">
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn("block h-auto w-full", ratio && cn(ratio, "object-cover"), imgClassName)}
        />
      </div>
    </div>
  );
}

/* ── Numbered steps ────────────────────────────────────────────────────── */

export interface StepItem {
  /** Defaults to the 1-based position. */
  number?: string;
  title: ReactNode;
  body?: ReactNode;
  /** Optional CTA under the step. */
  action?: { label: string; href: string };
  /** Optional icon/photo shown beside the step (self-hosted path). */
  image?: string;
}

const STEP_ACCENTS: readonly Accent[] = ["gold", "plum", "green", "neutral"];

/**
 * "What happens next" — the one structure every Kajabi thank-you page shares.
 * An ordered list, so the numbers are semantics and the drawn numerals stay
 * decoration.
 */
export function NumberedSteps({ steps, className }: { steps: readonly StepItem[]; className?: string }) {
  return (
    <RevealGroup as="ol" className={cn("grid list-none grid-cols-1 gap-5", className)}>
      {steps.map((step, i) => (
        <RevealItem key={i} as="li" className="h-full">
          <GlassCard
            accent={STEP_ACCENTS[i % STEP_ACCENTS.length]}
            interactive={false}
            className="flex h-full items-start gap-5 p-6 sm:gap-7 sm:p-8"
          >
            {step.image ? (
              <img
                src={step.image}
                alt=""
                aria-hidden
                loading="lazy"
                className="mt-1 h-12 w-12 shrink-0 rounded-xl object-contain sm:h-14 sm:w-14"
              />
            ) : (
              <span
                aria-hidden
                className="shrink-0 font-sans text-[2rem] font-bold tabular-nums leading-none text-gold sm:text-[2.4rem]"
              >
                {step.number ?? i + 1}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.35rem]">
                {step.title}
              </h3>
              {step.body && <div className="copy-luxe mt-2.5 space-y-3 text-pretty text-sm sm:text-base">{step.body}</div>}
              {step.action && (
                <div className="mt-5">
                  <CtaButton href={step.action.href} size="md">
                    {step.action.label}
                  </CtaButton>
                </div>
              )}
            </div>
          </GlassCard>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/* ── Link cards ────────────────────────────────────────────────────────── */

export interface LinkCardItem {
  eyebrow?: string;
  title: string;
  body?: string;
  href: string;
  /** Leading emoji/glyph, as the source pages set them. */
  glyph?: string;
}

/** A stack of whole-card links ("Keep Building", the link-in-bio list). */
export function LinkCards({
  items,
  className,
  columns = 1,
}: {
  items: readonly LinkCardItem[];
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <RevealGroup
      as="ul"
      className={cn(
        "grid list-none grid-cols-1 gap-4",
        columns === 2 && "md:grid-cols-2",
        columns === 3 && "md:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <RevealItem key={item.title} as="li" className="h-full">
          <SmartLink
            href={item.href}
            className={cn(
              "group block h-full rounded-2xl",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
            )}
          >
            <GlassCard accent="gold" className="flex h-full items-start gap-4 p-5 sm:p-6">
              {item.glyph && (
                <span aria-hidden className="shrink-0 text-[1.5rem] leading-none">
                  {item.glyph}
                </span>
              )}
              <span className="min-w-0 flex-1">
                {item.eyebrow && (
                  <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
                    {item.eyebrow}
                  </span>
                )}
                <span className="mt-1 block text-pretty font-display text-[1.12rem] font-medium leading-snug text-white sm:text-[1.25rem]">
                  {item.title}
                </span>
                {item.body && (
                  <span className="mt-2 block text-pretty text-sm leading-[1.7] text-orchid-dim">{item.body}</span>
                )}
              </span>
              <span
                aria-hidden
                className="mt-1 shrink-0 text-gold transition-transform duration-300 ease-luxe group-hover:translate-x-1"
              >
                &rarr;
              </span>
            </GlassCard>
          </SmartLink>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/* ── Prose ─────────────────────────────────────────────────────────────── */

/** Paragraphs at reading measure, revealed as one block. */
export function Prose({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useEntranceMotion();
  return (
    <motion.div {...rise(reduce, delay)} className={cn("copy-luxe mx-auto max-w-[65ch] space-y-5 text-pretty", className)}>
      {children}
    </motion.div>
  );
}

/** A centred signature block ("Cheering you on always, Yvette"). */
export function Signoff({ lines }: { lines: readonly string[] }) {
  return (
    <div className="mt-10 text-center">
      <GoldRule width="w-12" className="mx-auto mb-6" />
      {lines.map((line, i) => (
        <p
          key={line}
          className={cn(
            i === lines.length - 1
              ? "font-display text-[1.6rem] italic text-foil"
              : "text-sm font-light leading-[1.7] text-orchid-dim",
          )}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

/* ── Opt-in / feedback form ────────────────────────────────────────────── */

export interface KajabiFieldSpec {
  /** Must match a `key` in the form's `fields` jsonb (migration 100). */
  key: string;
  label: string;
  type: "text" | "email" | "select" | "textarea" | "radio";
  required?: boolean;
  options?: readonly string[];
  placeholder?: string;
  autoComplete?: string;
  /** Laid out half-width beside its neighbour from `sm` up. */
  half?: boolean;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * An opt-in or feedback form posting to our forms system
 * (`POST /api/forms/:slug/submit`), so every reply lands in Forms and on a
 * contact. The fields here and the form row in migration 100 are one contract:
 * the server drops any key the stored form does not declare and rejects a
 * missing required one.
 *
 * On success it navigates to `redirectTo` (the page's own thank-you page, as
 * Kajabi did) or, without one, replaces itself with `successMessage`.
 */
export function KajabiForm({
  formSlug,
  fields,
  submitLabel,
  redirectTo,
  successMessage = "Thank you — we got it.",
  consent,
  className,
}: {
  formSlug: string;
  fields: readonly KajabiFieldSpec[];
  submitLabel: string;
  redirectTo?: string;
  successMessage?: ReactNode;
  consent?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const [honeypot, trapField] = useHoneypot();
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const data: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.key] ?? "").trim();
      if (field.required && !value) {
        setError(`Please complete “${field.label}”.`);
        return;
      }
      if (value) data[field.key] = value;
    }
    const emailField = fields.find((f) => f.type === "email");
    const email = emailField ? data[emailField.key] ?? "" : "";
    if (emailField && !EMAIL_SHAPE.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setStatus("sending");
    setError(null);
    try {
      await api.submitForm(formSlug, data, email || undefined, honeypot());
      if (redirectTo) {
        navigate(redirectTo);
        return;
      }
      setStatus("done");
    } catch (err) {
      setStatus("idle");
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 429) && err.message
          ? err.message
          : "We couldn't send that just now. Please try again in a moment.",
      );
    }
  }

  if (status === "done") {
    return (
      <div role="status" className={cn("text-center text-base leading-[1.75] text-orchid", className)}>
        {successMessage}
      </div>
    );
  }

  const sending = status === "sending";

  return (
    <form onSubmit={handleSubmit} noValidate className={cn("relative grid grid-cols-1 gap-5 sm:grid-cols-2", className)}>
      {trapField}
      {fields.map((field) => {
        const span = field.half ? "" : "sm:col-span-2";
        const common = {
          label: field.label,
          required: field.required,
          disabled: sending,
          wrapperClassName: span,
        };
        if (field.type === "select") {
          return (
            <LuxeSelect
              key={field.key}
              {...common}
              name={field.key}
              value={values[field.key] ?? ""}
              onChange={(e) => set(field.key, e.target.value)}
            >
              <option value="">{field.placeholder ?? "Choose one"}</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </LuxeSelect>
          );
        }
        if (field.type === "textarea") {
          return (
            <LuxeTextarea
              key={field.key}
              {...common}
              name={field.key}
              rows={4}
              maxLength={5000}
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={(e) => set(field.key, e.target.value)}
            />
          );
        }
        if (field.type === "radio") {
          return (
            <fieldset key={field.key} className={cn("flex flex-col gap-3", span)} disabled={sending}>
              <legend className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                {field.label}
                {field.required && (
                  <span aria-hidden className="ml-1 text-gold">
                    *
                  </span>
                )}
              </legend>
              {(field.options ?? []).map((option) => {
                const checked = values[field.key] === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[0.95rem] leading-snug transition-colors duration-300",
                      checked
                        ? "border-gold/60 bg-gold/[0.08] text-white"
                        : "border-white/12 bg-white/[0.03] text-orchid hover:border-white/25",
                    )}
                  >
                    <input
                      type="radio"
                      name={field.key}
                      value={option}
                      checked={checked}
                      onChange={() => set(field.key, option)}
                      className="size-4 shrink-0 accent-[rgb(201,164,106)]"
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </fieldset>
          );
        }
        return (
          <LuxeInput
            key={field.key}
            {...common}
            name={field.key}
            type={field.type}
            inputMode={field.type === "email" ? "email" : undefined}
            autoComplete={field.autoComplete ?? (field.type === "email" ? "email" : undefined)}
            placeholder={field.placeholder}
            maxLength={field.type === "email" ? 320 : 200}
            value={values[field.key] ?? ""}
            onChange={(e) => set(field.key, e.target.value)}
          />
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-red-300 sm:col-span-2">
          {error}
        </p>
      )}

      <LuxeButton
        type="submit"
        variant="foil"
        size="lg"
        disabled={sending}
        aria-busy={sending || undefined}
        className="mt-1 w-full sm:col-span-2"
      >
        {sending ? "Sending…" : submitLabel}
      </LuxeButton>

      {consent && (
        <p className="text-pretty text-center text-xs leading-[1.7] text-orchid-faint sm:col-span-2">{consent}</p>
      )}
    </form>
  );
}

/**
 * The consent line Kajabi printed under its 2026 opt-ins, with the two
 * documents it names linked to this site's copies.
 */
export function OptInConsent() {
  return (
    <>
      By submitting this form you agree to receive emails from Boss Clinician, LLC. This resource is
      educational only and is not legal, financial, or clinical advice. You can unsubscribe anytime. See
      our{" "}
      <Link to="/privacy-policy" className={INLINE_LINK}>
        Privacy Policy
      </Link>{" "}
      and{" "}
      <Link to="/terms-of-use" className={INLINE_LINK}>
        Terms
      </Link>
      .
    </>
  );
}

/** Practice-length question both 2026 opt-ins ask (Kajabi custom_48). */
export const PRACTICE_LENGTH_OPTIONS = ["0-1 year", "2-3 years", "4-5+ years"] as const;

/** First name / last name / email / years in practice — the 2026 opt-in shape. */
export const OPT_IN_FIELDS: readonly KajabiFieldSpec[] = [
  { key: "name", label: "First Name", type: "text", required: true, autoComplete: "given-name", half: true },
  { key: "last_name", label: "Last Name", type: "text", required: true, autoComplete: "family-name", half: true },
  { key: "email", label: "Email", type: "email", required: true },
  {
    key: "years_in_practice",
    label: "How Long Have You Been In Practice",
    type: "select",
    required: true,
    options: PRACTICE_LENGTH_OPTIONS,
  },
];

/** The policy footer the 2026 custom-code pages carry (Privacy · Terms of Use · Disclaimer). */
export function PolicyLinks({ links }: { links?: readonly { label: string; to: string }[] }) {
  const items = links ?? [
    { label: "Privacy Policy", to: "/privacy-policy" },
    { label: "Terms of Use", to: "/terms-of-use" },
    { label: "Disclaimer", to: "/disclaimer" },
  ];
  return (
    <nav aria-label="Policies" className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-orchid-faint">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="min-h-[44px] content-center transition-colors duration-300 hover:text-gold"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
