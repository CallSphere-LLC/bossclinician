import { useId, useState, type FormEvent } from "react";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { retreatsPublicApi } from "@/lib/retreatsPublicApi";
import { retreatInterest as copy, UPCOMING_RETREATS_PATH } from "@/content/retreatInterest";

/**
 * The FlourisHealer retreat announcement sign-up (Yvette's item 6): one
 * component for /retreat-interest and the empty state of /upcoming-retreats,
 * so both always explain the same thing and post to the same list.
 *
 * Styled by the retreat page's own sheet (pages/retreats.css, `.retreat-form`),
 * and must sit inside a `.retreat-page`.
 *
 * Sends nothing but the sign-up: the API stores the contact and the
 * "retreat-announcements" tag and emails no one.
 */
export function RetreatInterestForm({
  retreat,
  showUpcomingLink = true,
}: {
  /** The retreat page the visitor came from, if any (stored with the sign-up). */
  retreat?: string;
  showUpcomingLink?: boolean;
}) {
  const id = useId();
  const [honeypot, trapField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    if (!email.trim()) {
      setError(copy.form.emailRequired);
      return;
    }
    if (!consent) {
      setError(copy.form.consentRequired);
      return;
    }
    setError(null);
    setStatus("sending");
    try {
      await retreatsPublicApi.signUp({
        email: email.trim(),
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        consent: true,
        ...(retreat && /^[a-z0-9-]+$/.test(retreat) ? { retreat } : {}),
        ...honeypot(),
      });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : copy.form.genericError);
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="retreat-form retreat-form-done" role="status">
        <h3>{copy.success.title}</h3>
        <p>{copy.success.body}</p>
        {showUpcomingLink && (
          <a className="retreat-text-link" href={UPCOMING_RETREATS_PATH}>
            {copy.success.cta}
          </a>
        )}
      </div>
    );
  }

  return (
    <form className="retreat-form" onSubmit={onSubmit} noValidate aria-describedby={error ? `${id}-error` : undefined}>
      {trapField}
      <label htmlFor={`${id}-first`}>{copy.form.firstNameLabel}</label>
      <input
        id={`${id}-first`}
        name="firstName"
        type="text"
        autoComplete="given-name"
        maxLength={100}
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <label htmlFor={`${id}-email`}>{copy.form.emailLabel}</label>
      <input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={320}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label className="retreat-form-consent" htmlFor={`${id}-consent`}>
        <input
          id={`${id}-consent`}
          name="consent"
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{copy.form.consentLabel}</span>
      </label>
      {error && (
        <p id={`${id}-error`} className="retreat-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="retreat-button" type="submit" disabled={status === "sending"}>
        {status === "sending" ? copy.form.submitting : copy.form.submit}
      </button>
      <p className="retreat-form-note">
        {copy.form.privacyLead}
        <a className="retreat-text-link" href={copy.form.privacyHref}>
          {copy.form.privacyLink}
        </a>
        .
      </p>
    </form>
  );
}
