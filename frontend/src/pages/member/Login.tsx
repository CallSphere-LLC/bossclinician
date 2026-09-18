import { useEffect, useState, type FormEvent } from "react";
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
import { GoogleButton, googleEnabledIn, googleErrorMessage } from "@/components/member/GoogleButton";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { api } from "@/lib/api";
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

type MagicLinkState = "checking" | "offered" | "sending" | "sent" | "unavailable";

export default function Login() {
  const { member, loading, signIn } = useMember();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeDestination(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // A failed "Continue with Google" comes back here as `?error=google_…`. Read
  // once, as the initial value: the param is stripped from the address just
  // below, and the message should outlive it until the member tries again.
  const [error, setError] = useState<string | null>(() => googleErrorMessage(params.get("error")));
  const [submitting, setSubmitting] = useState(false);
  const [magicLink, setMagicLink] = useState<MagicLinkState>("checking");
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // Otherwise the error is part of the page's address: a refresh shows it again
  // after it has stopped being true, and a bookmark keeps it for good.
  // `replaceState`, so Back still goes wherever it went before. `next` stays.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.get("error")?.startsWith("google_")) return;
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Offered only when it is switched on. It used to be shown to everyone and
  // withdrawn after a failed click, which is a button that promises an email
  // the site has been told not to send.
  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((settings) => {
        if (cancelled) return;
        const signIn = settings.member_signin as { magicLinkEnabled?: unknown } | undefined;
        setMagicLink(signIn?.magicLinkEnabled === true ? "offered" : "unavailable");
        // Same request, second answer: whether the server has Google credentials.
        setGoogleEnabled(googleEnabledIn(settings));
      })
      .catch(() => {
        if (!cancelled) setMagicLink("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      {googleEnabled && <GoogleButton next={destination} />}

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

      {magicLink !== "unavailable" && magicLink !== "checking" && (
        <div className="mt-7">
          <div className="flex items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-ink/10" />
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-orchid-faint">
              or
            </span>
            <span className="h-px flex-1 bg-ink/10" />
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
                // One line inside the pill: the full sentence wrapped to two in
                // a 360px card and pushed the icon out to the side.
                className="w-full whitespace-nowrap px-4 text-[0.68rem] tracking-[0.1em] sm:px-6 sm:tracking-[0.12em]"
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
                    Email me a sign-in link
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
