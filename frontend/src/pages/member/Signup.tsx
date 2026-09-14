import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import {
  AuthCard,
  AuthFormError,
  AuthLink,
  AuthPasswordField,
  AuthSubmit,
  MIN_PASSWORD_LENGTH,
  authErrorMessage,
} from "@/components/member/AuthCard";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { useMember } from "@/hooks/useMember";
import { cn } from "@/lib/cn";

const AFTER_SIGNUP = "/library";

/** Kept inline-weight: the consent line is fine print, not a call to action. */
const legalLink = cn(
  "font-medium text-orchid underline decoration-white/25 underline-offset-4",
  "transition-colors hover:text-gold hover:decoration-gold/60",
);

export default function Signup() {
  const { member, loading, signUp } = useMember();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /**
   * Set when the address already had an account and the server emailed a link
   * rather than signing anyone in. The server answers identically whether that
   * account had a password or not, so this screen must not speculate about
   * which — it says "check your email" and nothing more.
   */
  const [checkEmail, setCheckEmail] = useState(false);

  if (!loading && member) return <Navigate to={AFTER_SIGNUP} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Please use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }

    setSubmitting(true);
    let signedIn: boolean;
    try {
      signedIn = await signUp({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
      });
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
      return;
    }

    if (!signedIn) {
      setCheckEmail(true);
      setSubmitting(false);
      return;
    }

    toast.success("You're in. Check your inbox — a confirmation email is on its way.");
    navigate(AFTER_SIGNUP, { replace: true });
  }

  if (checkEmail) {
    return (
      <AuthCard
        documentTitle="Check your email · Boss Clinician"
        description="Finish setting up your Boss Clinician account."
        title="Check your email"
        subtitle={`We've sent a link to ${email.trim()}.`}
        footer={
          <>
            Already know your password? <AuthLink to="/login">Sign in</AuthLink>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-orchid">
          Open it to finish setting up your account. If you already have one, the email will point
          you at signing in instead.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-orchid-faint">
          Nothing in your inbox after a few minutes? Check your spam folder, or{" "}
          <AuthLink to="/forgot-password">request a new link</AuthLink>.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      documentTitle="Create your account · Boss Clinician"
      description="Create your Boss Clinician account."
      title="Create your account"
      subtitle="A few details and your library is ready."
      footer={
        <>
          Already have an account? <AuthLink to="/login">Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <LuxeInput
            label="First name"
            required
            autoComplete="given-name"
            autoFocus
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <LuxeInput
            label="Last name"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        <LuxeInput
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourpractice.com"
          hint="This is where your course access and receipts go."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthPasswordField
          label="Password"
          required
          strength
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <AuthFormError message={error} />

        <AuthSubmit pending={submitting} pendingLabel="Creating your account…">
          Create account
          <ArrowRight className="size-4" aria-hidden />
        </AuthSubmit>

        <p className="text-center text-xs leading-relaxed text-orchid-faint">
          By creating an account you agree to the{" "}
          <Link to="/terms" className={legalLink}>
            Terms
          </Link>{" "}
          and the{" "}
          <Link to="/privacy-policy" className={legalLink}>
            Privacy Policy
          </Link>
          . We'll email you about your courses — never anything you didn't ask for.
        </p>
      </form>
    </AuthCard>
  );
}
