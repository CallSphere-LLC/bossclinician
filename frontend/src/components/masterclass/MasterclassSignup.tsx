import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { freedomMasterclass as copy } from "@/content/freedomMasterclass";
import { ApiError, api } from "@/lib/api";
import { MASTERCLASS_FORM_SLUG, watchNowPath } from "@/lib/masterclass";
import { cn } from "@/lib/cn";

/** The same loose check the Boardroom application makes before it sends. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "sending" | "failed";

/**
 * First name and email, then straight on to the masterclass.
 *
 * Posts to the `freedom-masterclass` form (migration 077) through the same
 * public route the Boardroom application uses, so a registration is a reply in
 * Forms, a contact tagged "Freedom Masterclass", and nothing else — no lead, no
 * email to the owner, no welcome email from this path. Then it goes to
 * /watch-now with the name and address in the query, as her Kajabi page did.
 *
 * A refusal the server explains (a bad address, the rate limit) is shown as it
 * was written: the fix is in this box. Anything else — the API down, the form
 * not yet created on this database — must not stand between somebody and a
 * free video they just asked for, so the message says their details did not
 * save and offers the page anyway, beside a retry.
 */
export function MasterclassSignup({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [honeypot, trapField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const name = firstName.trim();
    const address = email.trim();
    if (!name) {
      setError("Please enter your first name.");
      return;
    }
    if (!EMAIL_SHAPE.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }

    setStatus("sending");
    setError(null);
    setFallback(null);
    try {
      await api.submitForm(MASTERCLASS_FORM_SLUG, { name, email: address }, address, honeypot());
      navigate(watchNowPath(name, address));
    } catch (err) {
      setStatus("failed");
      if (err instanceof ApiError && (err.status === 400 || err.status === 429) && err.message) {
        setError(err.message);
        return;
      }
      setError("We couldn't save your details just now. Please try again.");
      setFallback(watchNowPath(name, address));
    }
  }

  const sending = status === "sending";

  return (
    <form onSubmit={handleSubmit} noValidate className={cn("relative flex flex-col gap-4", className)}>
      {trapField}
      <LuxeInput
        label={copy.register.card.firstName}
        name="first_name"
        autoComplete="given-name"
        required
        maxLength={80}
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        disabled={sending}
      />
      <LuxeInput
        label={copy.register.card.email}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        maxLength={320}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={sending}
      />

      {error && (
        <div role="alert" className="text-sm text-red-300">
          <p>{error}</p>
          {fallback && (
            <p className="mt-2 text-orchid">
              <Link
                to={fallback}
                className="underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60"
              >
                Continue to the masterclass anyway &rarr;
              </Link>
            </p>
          )}
        </div>
      )}

      <LuxeButton
        type="submit"
        variant="foil"
        size="lg"
        disabled={sending}
        className="mt-2 w-full"
        aria-busy={sending || undefined}
      >
        {sending ? copy.register.card.sending : (
          <>
            {copy.register.card.submit}
            <span aria-hidden>&rarr;</span>
          </>
        )}
      </LuxeButton>

      <p className="text-center text-xs text-orchid-faint">{copy.register.card.privacy}</p>
    </form>
  );
}
