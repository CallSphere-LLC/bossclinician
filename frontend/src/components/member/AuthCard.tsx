import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { Aurora } from "@/components/luxe/Aurora";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeFieldShell, luxeControlClass } from "@/components/luxe/LuxeField";
import { MemberApiError } from "@/lib/memberApi";
import { cn } from "@/lib/cn";

/**
 * The shell every member auth screen renders into.
 *
 * These five pages sit outside both the marketing chrome and the member
 * dashboard: someone arriving here is either locked out or not yet in, and a
 * full nav bar only offers ways to wander off mid-task. So the shell carries
 * its own theme, background and wordmark rather than assuming a parent layout
 * supplies them — the pages stay correct wherever the router mounts them.
 */

interface AuthCardProps {
  /** Browser tab title. The on-page heading is usually shorter and warmer. */
  documentTitle: string;
  description?: string;
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Sibling action, shown under the card: sign up, sign in, start over. */
  footer?: ReactNode;
}

export function AuthCard({
  documentTitle,
  description,
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: AuthCardProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="theme-luxe grain-overlay relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-night-deep px-5 py-14">
      <Aurora tone="mixed" intensity={0.8} />

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[27rem]"
      >
        <Seo title={documentTitle} description={description} />

        <Link
          to="/"
          className="group mx-auto block w-fit text-center font-display text-[1.35rem] font-bold leading-[1.05] tracking-[0.03em] text-white"
        >
          Boss <em className="text-foil italic">Clinician</em>
          <span className="mt-1 block font-body text-[0.52rem] font-bold not-italic uppercase tracking-[0.34em] text-gold/70 transition-colors duration-300 group-hover:text-gold">
            Lead. Heal. Elevate.
          </span>
        </Link>

        <GlassCard
          accent="gold"
          spotlight={false}
          interactive={false}
          className="mt-8 p-6 sm:p-9"
        >
          {eyebrow && (
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-gold">
              {eyebrow}
            </p>
          )}
          <h1 className={cn("font-display text-[1.75rem] leading-tight text-white", eyebrow && "mt-3")}>
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 text-sm leading-relaxed text-orchid-dim">{subtitle}</p>
          )}

          <div className="mt-7">{children}</div>
        </GlassCard>

        {footer && (
          <p className="mt-6 text-center text-sm text-orchid-dim">{footer}</p>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Backend error copy is already written for members, so it is shown verbatim.
 * Anything that never reached the backend has no such copy, and a raw fetch
 * rejection ("Failed to fetch") reads as a fault the member caused.
 */
export function authErrorMessage(err: unknown): string {
  if (err instanceof MemberApiError) return err.message;
  return "We couldn't reach the server. Check your connection and try again.";
}

/**
 * The live region is mounted whether or not there is a message, because a
 * region that appears at the same moment as its text is announced
 * inconsistently across screen readers. The inner paragraph carries no
 * `role="alert"` of its own — that would be a second assertive region inside
 * this one, and some readers say the message twice.
 */
export function AuthFormError({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive" className="empty:hidden">
      {message && (
        <p className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/[0.08] px-4 py-3 text-sm leading-relaxed text-red-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}

export function AuthSubmit({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
}) {
  return (
    <LuxeButton type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </LuxeButton>
  );
}

/** Inline text link sized to stay a comfortable tap target on a phone. */
export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex min-h-[2.75rem] items-center rounded-lg px-1 font-semibold text-gold",
        "underline decoration-gold/40 underline-offset-[6px] transition-colors",
        "hover:text-gold-bright hover:decoration-gold",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      {children}
    </Link>
  );
}

/** Matches the backend's minimum, so the form can say so before it submits. */
export const MIN_PASSWORD_LENGTH = 10;

interface Strength {
  filled: number;
  label: string;
  bar: string;
}

function strengthOf(value: string): Strength {
  if (value.length === 0) {
    return {
      filled: 0,
      label: `At least ${MIN_PASSWORD_LENGTH} characters — a short phrase works well.`,
      bar: "bg-white/15",
    };
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    const remaining = MIN_PASSWORD_LENGTH - value.length;
    return {
      filled: 1,
      label: `${remaining} more character${remaining === 1 ? "" : "s"} to go.`,
      bar: "bg-red-400",
    };
  }
  // Length is worth more than symbol-juggling, so the top rung is earned by a
  // long passphrase as readily as by mixing in anything beyond lowercase.
  if (value.length >= 16 || /[^a-z]/.test(value)) {
    return { filled: 3, label: "Strong password.", bar: "bg-green-bright" };
  }
  return { filled: 2, label: "Good. A second word would make it stronger.", bar: "bg-gold" };
}

/** All-inline markup: the field shell renders its hint inside a paragraph. */
function PasswordStrength({ value }: { value: string }) {
  const { filled, label, bar } = strengthOf(value);

  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="flex h-1 w-14 shrink-0 gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "h-full flex-1 rounded-full transition-colors duration-300",
              i < filled ? bar : "bg-white/12",
            )}
          />
        ))}
      </span>
      <span aria-live="polite">{label}</span>
    </span>
  );
}

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Replaces the hint with the live strength meter. New passwords only. */
  strength?: boolean;
};

/**
 * Built from the field shell rather than `LuxeInput` because the reveal toggle
 * has to be positioned against the input alone, not the whole labelled group.
 */
export function AuthPasswordField({
  label,
  hint,
  error,
  strength = false,
  className,
  required,
  ...props
}: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const value = typeof props.value === "string" ? props.value : "";

  return (
    <LuxeFieldShell
      label={label}
      htmlFor={id}
      required={required}
      hint={strength ? <PasswordStrength value={value} /> : hint}
      error={error}
    >
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(luxeControlClass, "pr-12", error && "border-red-400/60", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className={cn(
            "absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl",
            "text-orchid-dim transition-colors hover:text-gold",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </LuxeFieldShell>
  );
}
