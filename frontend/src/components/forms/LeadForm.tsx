import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { GoldRule } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeTextarea } from "@/components/luxe/LuxeField";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { TurnstileField, type TurnstileHandle } from "@/components/forms/TurnstileField";
import { api } from "@/lib/api";
import type { LeadPayload } from "@/types";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Matches the `phone` cap in backend/src/validation/schemas.ts → leadSchema. */
const PHONE_MAX = 40;

const CAPTCHA_PROMPT = "Please complete the quick security check above the button, then send again.";

/**
 * Deliberately loose: digits with the usual punctuation and an optional
 * extension, and enough digits to be dialled. Anything stricter starts
 * rejecting real international numbers.
 */
function isPlausiblePhone(value: string): boolean {
  if (!/^[\d\s()+.\-/#*a-z]*$/i.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 20;
}

/**
 * The Turnstile site key, when Settings → Forms asks for Turnstile on the
 * contact form. Read from the public settings endpoint in an effect (the page
 * renders on the server, and the key may change without a rebuild); null means
 * "no widget" and the form behaves exactly as it does with the honeypot alone.
 */
function useContactTurnstileKey(source: LeadPayload["source"]): string | null {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  useEffect(() => {
    if (source !== "contact") return;
    let cancelled = false;
    api
      .settings()
      .then((settings) => {
        const fs = settings.form_settings as { spamProtection?: unknown; turnstileSiteKey?: unknown } | undefined;
        const key = typeof fs?.turnstileSiteKey === "string" ? fs.turnstileSiteKey.trim() : "";
        if (!cancelled && fs?.spamProtection === "turnstile" && key) setSiteKey(key);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source]);
  return source === "contact" ? siteKey : null;
}

interface LeadFormProps {
  source: LeadPayload["source"];
  submitLabel?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  showPhone?: boolean;
  /**
   * What the confirmation card says. The default is application language,
   * because /apply is where this form started; a page that asks a question
   * rather than takes an application should say so instead.
   */
  successTitle?: string;
  successBody?: string;
}

/**
 * The site's one lead capture form (application + contact).
 *
 * It owns its own GlassCard rather than expecting each page to supply a panel:
 * the form is the densest, most consequential surface on any page it appears
 * on, and a shared card guarantees the field material, the focus ring and the
 * foil submit read identically wherever it is dropped in.
 */
export function LeadForm({
  source,
  submitLabel = "Submit Application",
  messageLabel = "What's your biggest challenge in your practice right now?",
  messagePlaceholder = "Tell me a bit about where you are and what you're building…",
  showPhone = true,
  successTitle = "You're in. 🎉",
  successBody = "Thank you for reaching out — I review every application myself and you'll hear back from me within 24 hours.",
}: LeadFormProps) {
  const reduce = useReducedMotion();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const turnstileSiteKey = useContactTurnstileKey(source);
  const captchaActive = turnstileSiteKey !== null;
  const turnstile = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Please share your name and email so I can reach you back.");
      return;
    }
    if (showPhone && phone.trim() && !isPlausiblePhone(phone.trim())) {
      setError("That phone number doesn't look right. Please check it, or leave it blank.");
      return;
    }
    if (captchaActive && !turnstileToken) {
      setError(CAPTCHA_PROMPT);
      return;
    }
    setStatus("loading");
    const payload: LeadPayload & { turnstileToken?: string } = {
      name: name.trim(),
      email: email.trim(),
      phone: (showPhone && phone.trim()) || undefined,
      message: message.trim() || undefined,
      source,
      ...honeypot(),
      ...(captchaActive && turnstileToken ? { turnstileToken } : {}),
    };
    try {
      await api.submitLead(payload);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      // A 400 carries a message meant for the visitor — including the
      // `captcha_failed` answer when the security check did not verify.
      const failure = err as { status?: number; message?: string };
      setError(failure.status === 400 && failure.message
        ? failure.message
        : "Something went wrong submitting your form. Please email bossclinician@gmail.com directly.");
    } finally {
      // Turnstile tokens are single-use; the next attempt needs a fresh one.
      if (captchaActive) turnstile.current?.reset();
    }
  }

  if (status === "success") {
    return (
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

          <h3 className="mt-6 text-balance font-display text-[1.6rem] font-medium leading-tight text-white sm:text-[1.9rem]">
            {successTitle}
          </h3>

          <GoldRule className="mx-auto mt-6" />

          <p className="copy-luxe mx-auto mt-6 max-w-[46ch] text-pretty">{successBody}</p>
        </motion.div>
      </GlassCard>
    );
  }

  // The form's validation rules, mirrored here so the offending controls can
  // be flagged for assistive tech without repeating the message under each
  // field. Each flag clears itself as soon as the field is put right.
  const invalidSubmit = error !== null && status !== "error";
  const nameInvalid = invalidSubmit && !name.trim();
  const emailInvalid = invalidSubmit && !email.trim();
  const phoneInvalid =
    invalidSubmit && !nameInvalid && !emailInvalid && !!phone.trim() && !isPlausiblePhone(phone.trim());

  return (
    <GlassCard accent="gold" interactive={false} className="p-6 sm:p-8">
      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={status === "loading"}
        className="relative space-y-5"
      >
        {honeypotField}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <LuxeInput
            label="Full name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby={nameInvalid ? errorId : undefined}
          />
          <LuxeInput
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailInvalid ? true : undefined}
            aria-describedby={emailInvalid ? errorId : undefined}
          />
        </div>

        {showPhone && (
          <LuxeInput
            label="Phone (optional)"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={PHONE_MAX}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneInvalid ? true : undefined}
            aria-describedby={phoneInvalid ? errorId : undefined}
          />
        )}

        <LuxeTextarea
          label={messageLabel}
          name="message"
          rows={5}
          placeholder={messagePlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        {turnstileSiteKey && (
          <TurnstileField
            ref={turnstile}
            siteKey={turnstileSiteKey}
            onToken={(token) => {
              setTurnstileToken(token);
              if (token) setError((current) => (current === CAPTCHA_PROMPT ? null : current));
            }}
          />
        )}

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
            {/* min-w-0 lets a long address (bossclinician@gmail.com) wrap
                instead of forcing the card wider than a 360px viewport. */}
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
            {status === "loading" ? "Sending…" : submitLabel}
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
  );
}
