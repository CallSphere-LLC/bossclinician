import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";

/**
 * Pieces the rebuilt Kajabi quizzes share: the answer button, the progress
 * bar, and the name-and-email form that files a quiz result under its builder
 * form. Same look and mechanics as the Practice Set Up Quiz
 * (pages/PracticeQuizTake.tsx), which these quizzes sit beside.
 */

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True while the component is mounted; async work checks it before touching state. */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/**
 * Moves focus to the new heading after a screen change, so keyboard and
 * screen-reader users land on it. Call `arm()` before the change and give the
 * heading `ref={focusOnMount}` and `tabIndex={-1}`.
 */
export function useFocusOnChange() {
  const pending = useRef(false);
  return {
    arm: () => {
      pending.current = true;
    },
    focusOnMount: (el: HTMLElement | null) => {
      if (!el || !pending.current) return;
      pending.current = false;
      el.focus({ preventScroll: true });
    },
  };
}

/** Smooth-scrolls to an element (or the top), as the sources do on every screen change. */
export function scrollToEl(el: HTMLElement | null, reduce: boolean | null) {
  if (typeof window === "undefined") return;
  const top = el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - 96) : 0;
  window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}

export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5 shrink-0", back && "-scale-x-100")}
    >
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-[44px] items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid transition-colors duration-300 hover:text-gold"
    >
      {children}
    </Link>
  );
}

/** "Question 2 of 6 ……… 17%" over a gold bar. */
export function QuizProgress({ label, right, pct }: { label: string; right: string; pct: number }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/85">{label}</p>
        <span className="text-xs font-semibold tabular-nums text-orchid-faint">{right}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Quiz progress"
        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10"
      >
        <motion.div
          className="h-full w-full rounded-full bg-gold-foil"
          style={{ transformOrigin: "left" }}
          initial={false}
          animate={{ scaleX: pct / 100 }}
          transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
        />
      </div>
    </div>
  );
}

/** One answer. A button rather than a radio, as on the sources: Next commits it. */
export function AnswerButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left",
        "text-[0.95rem] leading-relaxed transition-colors duration-300",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
        on
          ? "border-gold/60 bg-gold/[0.10] text-white"
          : "border-white/12 bg-white/[0.04] text-white/85 hover:border-white/25 hover:bg-white/[0.06]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
          on ? "border-gold bg-gold/25 text-gold" : "border-white/25",
        )}
      >
        {on && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
          >
            <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
          </svg>
        )}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/** The Kajabi forms' small print, identical on every one of them. */
export const FORM_DISCLAIMER =
  "By submitting this form you agree to receive emails from Boss Clinician, LLC. This resource is educational only and is not legal, financial, or clinical advice. You can unsubscribe anytime. See our Privacy Policy and Terms.";

/** The message a failed submission shows: the server's own words for a 4xx it explains, ours otherwise. */
export function submitErrorMessage(err: unknown): string {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 404
    ? err.message
    : `Something went wrong sending this. Please try again, or email ${contactPage.email}.`;
}

export interface ResultEmailCopy {
  eyebrow: string;
  heading: string;
  sub: string;
  submit: string;
  sent: string;
}

/**
 * The optional "email me my result" form under a quiz result.
 *
 * Files the taker under the result's builder form (migration 099), with the
 * result and their answers as the form's hidden questions; the form tags the
 * contact and its automation emails them the result. Never stands between
 * anyone and the result itself, which is already on screen above it.
 */
export function ResultEmailForm({
  formSlug,
  copy,
  data,
}: {
  formSlug: string;
  copy: ResultEmailCopy;
  /** The hidden answers: result, score, q1…qN. */
  data: () => Record<string, unknown>;
}) {
  const alive = useAlive();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const first = firstName.trim();
    const last = lastName.trim();
    const address = email.trim().toLowerCase();
    if (!first || !last) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!EMAIL_PATTERN.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.submitForm(formSlug, { first_name: first, last_name: last, email: address, ...data() }, address, honeypot());
      if (alive.current) setSent(true);
    } catch (err) {
      if (alive.current) setError(submitErrorMessage(err));
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="mt-6 p-6 sm:p-8">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">{copy.eyebrow}</p>
      <h2 className="mt-2 text-balance font-display text-[1.35rem] font-medium leading-tight text-white sm:text-[1.6rem]">
        {copy.heading}
      </h2>
      {sent ? (
        <p role="status" className="copy-luxe mt-4 text-pretty">
          {copy.sent}
        </p>
      ) : (
        <>
          <p className="copy-luxe mt-3 text-pretty text-[0.95rem]">{copy.sub}</p>
          <form onSubmit={handleSubmit} noValidate className="relative mt-6 space-y-5">
            {honeypotField}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <LuxeInput
                label="First Name"
                name="first_name"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px]"
              />
              <LuxeInput
                label="Last Name"
                name="last_name"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px]"
              />
            </div>
            <LuxeInput
              label="Email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-describedby={error ? errorId : undefined}
              className="min-h-[44px]"
            />
            {error && <FormError id={errorId}>{error}</FormError>}
            <LuxeButton variant="foil" size="md" type="submit" disabled={sending} className="min-h-[44px]">
              {sending ? "Sending…" : copy.submit}
            </LuxeButton>
            <p className="text-xs leading-relaxed text-orchid-faint">{FORM_DISCLAIMER}</p>
          </form>
        </>
      )}
    </GlassCard>
  );
}

export function FormError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
    >
      {children}
    </p>
  );
}

/** The answers as the result forms' hidden questions: q1…qN, each the chosen answer's words. */
export function answersAsData(
  questions: readonly { answers: readonly { text: string }[] }[],
  picks: readonly (number | null)[],
): Record<string, string> {
  const data: Record<string, string> = {};
  questions.forEach((q, qi) => {
    const pick = picks[qi];
    if (pick !== null && pick !== undefined && q.answers[pick]) data[`q${qi + 1}`] = q.answers[pick].text;
  });
  return data;
}

/** The slide a question card makes when it is swapped for the next one. */
export function useSwap(direction: 1 | -1) {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? false : { opacity: 0, x: direction * 28 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: reduce ? 0 : 0.34, ease: EASE },
  } as const;
}
