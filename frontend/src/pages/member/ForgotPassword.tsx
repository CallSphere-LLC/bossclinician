import { useSearchParams } from "react-router";
import { recoveryDestination, withRecoveryNext } from "@/lib/passwordRecovery";
import { useState, type FormEvent } from "react";
import { MailCheck, Send } from "lucide-react";
import {
  AuthCard,
  AuthFormError,
  authErrorMessage,
  AuthLink,
  AuthSubmit,
} from "@/components/member/AuthCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { memberApi } from "@/lib/memberApi";

export default function ForgotPassword() {
  const [params] = useSearchParams();
  const destination = recoveryDestination("member", params.get("next"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await memberApi.forgotPassword(email.trim(), destination);
      setSent(true);
    } catch (err) {
      // Validation, rate limits and transport failures are independent of
      // account existence. Keep these actionable; only a 200 means accepted.
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        documentTitle="Check your email · Boss Clinician"
        eyebrow="Check your email"
        title="Check for your reset link"
        subtitle={
          <>
            If <span className="text-orchid">{email.trim()}</span> has an eligible account, we?ll send a reset link. It works once and expires in one hour.
          </>
        }
        footer={
          <>
            Remembered it? <AuthLink to={withRecoveryNext("/login", "member", destination)}>Back to sign in</AuthLink>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-gold/25 bg-gold/[0.07] px-4 py-3.5 text-sm leading-relaxed text-orchid">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
            <span>
              Nothing after a few minutes? Check your spam folder — then try again with
              the address you signed up with.
            </span>
          </div>

          <LuxeButton
            type="button"
            variant="outline"
            size="md"
            className="w-full"
            onClick={() => setSent(false)}
          >
            Try a different address
          </LuxeButton>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      documentTitle="Reset your password · Boss Clinician"
      description="Request a password reset link for your Boss Clinician account."
      title="Reset your password"
      subtitle="Tell us your email address and we'll send you a link to set a new one."
      footer={
        <>
          Remembered it? <AuthLink to={withRecoveryNext("/login", "member", destination)}>Back to sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <LuxeInput
          label="Email"
          type="email"
          maxLength={320}
          required
          autoComplete="email"
          autoFocus
          placeholder="you@yourpractice.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthFormError message={error} />

        <AuthSubmit pending={submitting} pendingLabel="Sending…">
          <Send className="size-4" aria-hidden />
          Send the reset link
        </AuthSubmit>
      </form>
    </AuthCard>
  );
}
