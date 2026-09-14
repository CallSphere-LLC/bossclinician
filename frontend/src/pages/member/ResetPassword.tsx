import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import {
  AuthCard,
  AuthFormError,
  AuthLink,
  AuthPasswordField,
  AuthSubmit,
  MIN_PASSWORD_LENGTH,
  authErrorMessage,
} from "@/components/member/AuthCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { memberApi } from "@/lib/memberApi";

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Please use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match. Have another go.");
      return;
    }

    setSubmitting(true);
    try {
      await memberApi.resetPassword(token ?? "", password);
      setDone(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthCard
        documentTitle="Link not valid · Boss Clinician"
        eyebrow="Something's missing"
        title="That link looks incomplete"
        subtitle="Reset links sometimes get cut in half by email apps. Ask for a fresh one and it'll only take a moment."
        footer={
          <>
            Remembered it? <AuthLink to="/login">Back to sign in</AuthLink>
          </>
        }
      >
        <LuxeButton to="/forgot-password" size="lg" className="w-full">
          Send me a new link
        </LuxeButton>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        documentTitle="Password updated · Boss Clinician"
        eyebrow="All done"
        title="Your new password is set"
        subtitle="For safety, anywhere you were already signed in has been signed out. Use your new password from here."
        footer={
          <>
            Trouble getting in? <AuthLink to="/forgot-password">Start again</AuthLink>
          </>
        }
      >
        <div className="space-y-5">
          <p className="flex items-start gap-3 rounded-xl border border-green-bright/25 bg-green-bright/[0.08] px-4 py-3.5 text-sm leading-relaxed text-orchid">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-bright" aria-hidden />
            <span>Password changed. Nothing else about your account has moved.</span>
          </p>

          <LuxeButton to="/login" size="lg" className="w-full">
            Sign in
          </LuxeButton>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      documentTitle="Choose a new password · Boss Clinician"
      title="Choose a new password"
      subtitle="Pick something you'll remember. You'll use it to sign in from now on."
      footer={
        <>
          Changed your mind? <AuthLink to="/login">Back to sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <AuthPasswordField
          label="New password"
          required
          strength
          autoFocus
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <AuthPasswordField
          label="Confirm new password"
          required
          autoComplete="new-password"
          hint="Type it once more so we know it's what you meant."
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <AuthFormError message={error} />

        <AuthSubmit pending={submitting} pendingLabel="Saving…">
          Save new password
        </AuthSubmit>
      </form>
    </AuthCard>
  );
}
