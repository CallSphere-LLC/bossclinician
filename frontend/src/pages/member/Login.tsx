import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import {
  AuthCard,
  AuthFormError,
  AuthLink,
  AuthPasswordField,
  AuthSubmit,
  authErrorMessage,
} from "@/components/member/AuthCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { MemberApiError, memberApi } from "@/lib/memberApi";
import { useMember } from "@/hooks/useMember";

const DEFAULT_DESTINATION = "/library";

/**
 * `?next=` is attacker-supplied by definition — it arrives on a link someone
 * else can write. Anything other than a plain same-site path is discarded:
 * `//example.com` and `/\example.com` are both read as protocol-relative URLs
 * by browsers, which would turn our own sign-in page into a redirect to a
 * lookalike site at the exact moment the member has just typed their password.
 */
function safeDestination(raw: string | null): string {
  if (!raw) return DEFAULT_DESTINATION;
  if (!raw.startsWith("/")) return DEFAULT_DESTINATION;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_DESTINATION;
  return raw;
}

type MagicLinkState = "offered" | "sending" | "sent" | "unavailable";

export default function Login() {
  const { member, loading, signIn } = useMember();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeDestination(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [magicLink, setMagicLink] = useState<MagicLinkState>("offered");

  if (!loading && member) return <Navigate to={destination} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
      return;
    }
    navigate(destination, { replace: true });
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setError("Add your email address above and we'll send the link there.");
      return;
    }
    setError(null);
    setMagicLink("sending");
    try {
      await memberApi.requestMagicLink(email.trim());
      setMagicLink("sent");
    } catch (err) {
      // A 404 means Yvette has this switched off, which is a setting and not a
      // failure — the offer simply disappears rather than reporting a problem.
      if (err instanceof MemberApiError && err.status === 404) {
        setMagicLink("unavailable");
        return;
      }
      setMagicLink("offered");
      setError(authErrorMessage(err));
    }
  }

  return (
    <AuthCard
      documentTitle="Sign in · Boss Clinician"
      description="Sign in to your Boss Clinician account."
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          New here? <AuthLink to="/signup">Create your account</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <LuxeInput
          label="Email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          placeholder="you@yourpractice.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthPasswordField
          label="Password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="-mt-1 text-right">
          <AuthLink to="/forgot-password">Forgot your password?</AuthLink>
        </div>

        <AuthFormError message={error} />

        <AuthSubmit pending={submitting} pendingLabel="Signing in…">
          Sign in
          <ArrowRight className="size-4" aria-hidden />
        </AuthSubmit>
      </form>

      {magicLink !== "unavailable" && (
        <div className="mt-7">
          <div className="flex items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-orchid-faint">
              or
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <div className="mt-5" aria-live="polite">
            {magicLink === "sent" ? (
              <p className="rounded-xl border border-gold/25 bg-gold/[0.07] px-4 py-3 text-center text-sm leading-relaxed text-orchid">
                If that address has an account, a sign-in link is on its way. It
                works once, and only for the next hour.
              </p>
            ) : (
              <LuxeButton
                type="button"
                variant="outline"
                size="md"
                className="w-full"
                disabled={magicLink === "sending"}
                onClick={() => void sendMagicLink()}
              >
                {magicLink === "sending" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className="size-4" aria-hidden />
                    Email me a sign-in link instead
                  </>
                )}
              </LuxeButton>
            )}
          </div>
        </div>
      )}
    </AuthCard>
  );
}
