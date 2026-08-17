import { useState, type FormEvent } from "react";
import { MailCheck, Send } from "lucide-react";
import {
  AuthCard,
  AuthLink,
  AuthSubmit,
} from "@/components/member/AuthCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { memberApi } from "@/lib/memberApi";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await memberApi.forgotPassword(email.trim());
    } catch {
      // Swallowed on purpose. The endpoint answers identically for a registered
      // address and a stranger's, and a visible failure here would undo that:
      // anyone could learn which of Yvette's members exist by watching which
      // addresses produce an error. The member is told to check their inbox
      // either way, and the link back to sign in is right there if nothing
      // arrives.
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        documentTitle="Check your email · Boss Clinician"
        eyebrow="Check your email"
        title="The reset link is on its way"
        subtitle={
          <>
            If <span className="text-orchid">{email.trim()}</span> has an account, the
            link is in that inbox now. It works once, and only for the next hour.
          </>
        }
        footer={
          <>
            Remembered it? <AuthLink to="/login">Back to sign in</AuthLink>
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
          Remembered it? <AuthLink to="/login">Back to sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <LuxeInput
          label="Email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@yourpractice.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthSubmit pending={submitting} pendingLabel="Sending…">
          <Send className="size-4" aria-hidden />
          Send the reset link
        </AuthSubmit>
      </form>
    </AuthCard>
  );
}
