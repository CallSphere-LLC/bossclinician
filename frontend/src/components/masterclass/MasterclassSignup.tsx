import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect } from "@/components/luxe/LuxeField";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { freedomMasterclass as copy } from "@/content/freedomMasterclass";
import { ApiError, api } from "@/lib/api";
import { MASTERCLASS_FORM_SLUG, watchNowPath } from "@/lib/masterclass";
import { cn } from "@/lib/cn";

/** The same loose check the Boardroom application makes before it sends. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "sending" | "failed" | "confirm";

/**
 * First name, email and her two practice questions; then a confirmation email.
 *
 * Posts to the `freedom-masterclass` form (migrations 077 and 123) through the
 * same public route the Boardroom application uses, so a registration is a
 * reply in Forms, a contact tagged "Freedom Masterclass", and nothing else —
 * no lead, no email to the owner. The form has `double_opt_in`, so the server
 * emails a link that proves the address and opens /watch-now; the box then
 * says "check your inbox". Should the server report it could not send that
 * email, the visitor goes to /watch-now at once, as before — a sign-up must
 * never end on a promise of an email that is not coming.
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
  const [stage, setStage] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const card = copy.register.card;

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
    if (!stage || !goal) {
      setError(copy.register.card.chooseOne);
      return;
    }

    setStatus("sending");
    setError(null);
    setFallback(null);
    try {
      const result = await api.submitForm(
        MASTERCLASS_FORM_SLUG,
        { name, email: address, [card.stage.key]: stage, [card.goal.key]: goal },
        address,
        honeypot(),
      );
      if (result.confirmationRequired) {
        setStatus("confirm");
        return;
      }
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

  if (status === "confirm") {
    return (
      <div role="status" aria-live="polite" className={cn("relative flex flex-col gap-4", className)}>
        <h3 className="font-display text-[1.35rem] font-medium leading-snug text-white">{card.confirmTitle}</h3>
        <p className="copy-luxe text-pretty text-[0.95rem]">
          {card.confirmBody.replace("{email}", email.trim())}
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="self-start text-sm text-orchid underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60"
        >
          {card.confirmAgain}
        </button>
      </div>
    );
  }

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
      <LuxeSelect
        label={card.stage.label}
        name={card.stage.key}
        required
        value={stage}
        onChange={(e) => setStage(e.target.value)}
        disabled={sending}
      >
        <option value="">{card.stage.placeholder}</option>
        {card.stage.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </LuxeSelect>
      <LuxeSelect
        label={card.goal.label}
        name={card.goal.key}
        required
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={sending}
      >
        <option value="">{card.goal.placeholder}</option>
        {card.goal.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </LuxeSelect>

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
