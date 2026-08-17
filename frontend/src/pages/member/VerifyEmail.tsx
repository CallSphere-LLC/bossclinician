import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  AuthCard,
  AuthFormError,
  AuthLink,
  AuthSubmit,
  authErrorMessage,
} from "@/components/member/AuthCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { memberApi } from "@/lib/memberApi";
import { useMember } from "@/hooks/useMember";

type Status = "pending" | "success" | "failed";

export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const { member, refreshMember } = useMember();

  const [status, setStatus] = useState<Status>("pending");
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");

  // Confirmation tokens are single-use, so a second call would report the link
  // as already spent and show a failure to someone who just succeeded. StrictMode
  // runs effects twice in development, hence the ref rather than a dependency list.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setError("That link looks incomplete — email apps sometimes cut them in half.");
      setStatus("failed");
      return;
    }

    void (async () => {
      try {
        await memberApi.verifyEmail(token);
      } catch (err) {
        setError(authErrorMessage(err));
        setStatus("failed");
        return;
      }
      setStatus("success");
      try {
        // Pulls the freshly stamped verification date into the cached profile so
        // a member who confirmed in this same browser stops being nudged about it.
        await refreshMember();
      } catch {
        // Confirming works from any browser, signed in or not. Not being signed
        // in here is ordinary, and says nothing about whether it worked.
      }
    })();
  }, [token, refreshMember]);

  async function handleResend(event: FormEvent) {
    event.preventDefault();
    setResend("sending");
    try {
      await memberApi.resendVerification(member ? undefined : resendEmail.trim());
    } catch {
      // Deliberately silent: this endpoint replies identically for every
      // address, and surfacing a failure would reveal which ones are real.
    } finally {
      setResend("sent");
    }
  }

  if (status === "pending") {
    return (
      <AuthCard
        documentTitle="Confirming your email · Boss Clinician"
        title="Confirming your email"
        subtitle="One moment — this usually takes a second or two."
      >
        <div
          className="flex flex-col items-center gap-4 py-4 text-sm text-orchid-dim"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-8 animate-spin text-gold" aria-hidden />
          <span>Checking your link…</span>
        </div>
      </AuthCard>
    );
  }

  if (status === "success") {
    return (
      <AuthCard
        documentTitle="Email confirmed · Boss Clinician"
        eyebrow="All done"
        title="Your email is confirmed"
        subtitle="Thank you. That's the last of the housekeeping — everything is open to you now."
      >
        <div className="space-y-5">
          <p className="flex items-start gap-3 rounded-xl border border-green-bright/25 bg-green-bright/[0.08] px-4 py-3.5 text-sm leading-relaxed text-orchid">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-bright" aria-hidden />
            <span>We'll use this address for your course access and receipts.</span>
          </p>

          {member ? (
            <LuxeButton to="/library" size="lg" className="w-full">
              Go to my library
            </LuxeButton>
          ) : (
            <LuxeButton to="/login" size="lg" className="w-full">
              Sign in
            </LuxeButton>
          )}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      documentTitle="Link didn't work · Boss Clinician"
      eyebrow="Hmm"
      title="That link didn't work"
      subtitle="Confirmation links expire, and they only work once. A new one will sort it."
      footer={
        <>
          Need a hand? <AuthLink to="/contact">Get in touch</AuthLink>
        </>
      }
    >
      {resend === "sent" ? (
        <div className="space-y-5" aria-live="polite">
          <p className="rounded-xl border border-gold/25 bg-gold/[0.07] px-4 py-3.5 text-sm leading-relaxed text-orchid">
            A fresh confirmation link is on its way. Open it from this device and
            you'll be all set.
          </p>
          <LuxeButton to={member ? "/library" : "/login"} variant="outline" size="md" className="w-full">
            {member ? "Back to my library" : "Back to sign in"}
          </LuxeButton>
        </div>
      ) : (
        <form onSubmit={handleResend} className="space-y-5" noValidate>
          <AuthFormError message={error} />

          {!member && (
            <LuxeInput
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourpractice.com"
              hint="The address you signed up with."
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
            />
          )}

          <AuthSubmit pending={resend === "sending"} pendingLabel="Sending…">
            Send me a new link
          </AuthSubmit>
        </form>
      )}
    </AuthCard>
  );
}
