import { recoveryDestination, withRecoveryNext } from "@/lib/passwordRecovery";
import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { adminApi, ApiError } from "@/lib/api";
import { Button, ErrorNotice, Field, Input } from "@/pages/admin/ui/primitives";
import { Monogram } from "@/pages/admin/ui/icons";
import { Seo } from "@/components/Seo";

export default function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const destination = recoveryDestination("admin", params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const incomplete = reset && !token;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (reset && password !== confirm) {
      setError("Those passwords don't match. Please try again.");
      return;
    }
    setPending(true);
    try {
      if (reset) await adminApi.resetPassword(token ?? "", password);
      else await adminApi.forgotPassword(email.trim(), destination);
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't reach the server. Check your connection and try again.");
    } finally { setPending(false); }
  }

  return (
    <main className="theme-console flex min-h-screen items-center justify-center bg-cream px-5 py-12">
      <meta name="referrer" content="no-referrer" />
      <Seo title="Admin password recovery | Boss Clinician" noindex />
      <section className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3"><Monogram className="size-10 text-xl" /><span className="font-display text-lg text-ink">Boss Clinician</span></div>
        <h1 className="font-display text-[1.75rem] text-ink">
          {done ? (reset ? "Password updated" : "Check your email") : incomplete ? "That link is incomplete" : reset ? "Choose a new admin password" : "Reset your admin password"}
        </h1>
        {done ? <p role="status" className="mt-4 text-sm text-ink-soft">
          {reset ? "Your admin sessions have been signed out. Sign in with your new password and your authentication code if enabled." : "If that address belongs to an active admin account, we'll send a reset link. It works once and expires in one hour. Check your spam folder too."}
        </p> : incomplete ? <p className="mt-4 text-sm text-ink-soft">Request a fresh link to continue.</p> : <>
          <p className="mt-2 text-sm text-ink-soft">{reset ? "Use at least 10 characters. Resetting your password keeps your two-factor authentication enabled." : "Enter the email address you use for the admin dashboard."}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {reset ? <>
              <Field label="New password" htmlFor="admin-new-password"><Input id="admin-new-password" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={password} onChange={e => setPassword(e.target.value)} /></Field>
              <Field label="Confirm new password" htmlFor="admin-confirm-password"><Input id="admin-confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
            </> : <Field label="Email" htmlFor="admin-recovery-email"><Input id="admin-recovery-email" type="email" autoComplete="email" maxLength={320} required value={email} onChange={e => setEmail(e.target.value)} /></Field>}
            {error && <ErrorNotice message={error} />}
            <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Please wait\u2026" : reset ? "Save new password" : "Send reset link"}</Button>
          </form>
        </>}
        {reset && !done && <Link to={withRecoveryNext("/admin/forgot-password", "admin", destination)} className="mt-4 flex min-h-11 items-center text-sm text-ink underline underline-offset-4">Request a new reset link</Link>}
        {done && !reset && <Button type="button" variant="ghost" className="mt-4" onClick={() => setDone(false)}>Try again or use another address</Button>}
        <Link reloadDocument to={withRecoveryNext("/admin/login", "admin", destination)} className="mt-4 flex min-h-11 items-center text-sm text-ink underline decoration-gold underline-offset-4">Back to admin sign in</Link>
      </section>
    </main>
  );
}
