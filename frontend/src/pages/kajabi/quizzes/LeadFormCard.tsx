import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect } from "@/components/luxe/LuxeField";
import { api } from "@/lib/api";
import { EMAIL_PATTERN, FormError, submitErrorMessage, useAlive } from "./shared";

/**
 * A Kajabi opt-in form as a builder form: First Name, Email, Last Name (the
 * order Kajabi lays them out in) and any drop-down questions, posted to
 * `/api/forms/:slug/submit`. The builder form (migration 099) tags the contact
 * and stores the drop-down answers on it.
 */

export interface LeadSelect {
  /** The builder form's field key. */
  key: string;
  label: string;
  options: readonly string[];
}

export interface LeadContact {
  firstName: string;
  lastName: string;
  email: string;
}

export function LeadFormCard({
  formSlug,
  selects,
  submitLabel,
  disclaimer,
  intro,
  onSuccess,
}: {
  formSlug: string;
  selects: readonly LeadSelect[];
  submitLabel: string;
  disclaimer: string;
  intro?: ReactNode;
  onSuccess: (contact: LeadContact) => void;
}) {
  const alive = useAlive();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
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
    const missing = selects.find((s) => !choices[s.key]);
    if (missing) {
      setError(`Please answer “${missing.label}”.`);
      return;
    }

    setSending(true);
    setError(null);
    try {
      await api.submitForm(
        formSlug,
        { first_name: first, last_name: last, email: address, ...choices },
        address,
        honeypot(),
      );
      if (!alive.current) return;
      onSuccess({ firstName: first, lastName: last, email: address });
    } catch (err) {
      if (alive.current) setError(submitErrorMessage(err));
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
      {intro}
      <form onSubmit={handleSubmit} noValidate className="relative space-y-5">
        {honeypotField}
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
        {selects.map((select) => (
          <LuxeSelect
            key={select.key}
            label={select.label}
            name={select.key}
            required
            value={choices[select.key] ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setChoices((prev) => ({ ...prev, [select.key]: value }));
              setError(null);
            }}
            className="min-h-[44px]"
          >
            <option value="" disabled>
              {select.label}
            </option>
            {select.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </LuxeSelect>
        ))}

        {error && <FormError id={errorId}>{error}</FormError>}

        <LuxeButton variant="foil" size="md" type="submit" disabled={sending} className="min-h-[44px] w-full">
          {sending ? "Sending…" : submitLabel}
        </LuxeButton>
        <p className="text-xs leading-relaxed text-orchid-faint">{disclaimer}</p>
      </form>
    </GlassCard>
  );
}
