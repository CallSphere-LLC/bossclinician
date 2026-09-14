import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { isMfaRequiredError } from "@/lib/api";
import { Button, ErrorNotice, Field, Input } from "@/pages/admin/ui/primitives";
import { RETURN_PARAM, safeReturnPath } from "@/pages/admin/adminReturnTo";

const HIGHLIGHTS = [
  "Courses, community and media in one place",
  "Take payments, run plans and hand out discount codes",
  "See what you've earned and who's getting in touch",
];

export default function Login() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchParams] = useSearchParams();

  if (!loading && user) {
    // Back to the page that sent them here, if it was an admin page.
    return <Navigate to={safeReturnPath(searchParams.get(RETURN_PARAM))} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, mfaRequired ? code : undefined);
    } catch (err) {
      if (isMfaRequiredError(err)) {
        setMfaRequired(true);
        setError(code ? "That code didn't match. Try the current code or a backup code." : null);
      } else {
        setError("That email or password doesn't match. Check them and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="theme-console grid min-h-screen bg-cream lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden border-r border-hairline bg-[var(--bg-base)] p-12 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -bottom-24 -right-16 size-96 rounded-full bg-gold/15 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-gold-foil font-display text-lg font-bold text-night-deep">
            B
          </span>
          <span className="font-display text-lg text-white">Boss Clinician</span>
        </div>

        <div className="relative mt-auto">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-md font-display text-[2.6rem] leading-[1.1] text-white"
          >
            Your whole practice, one dashboard.
          </motion.h1>

          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map((item, i) => (
              <motion.li
                key={item}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.09, duration: 0.15 }}
                className="flex items-center gap-3 text-sm text-white/75"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold/20 text-gold">
                  <ShieldCheck className="size-3.5" />
                </span>
                {item}
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative mt-10 text-xs text-white/35">
          © {new Date().getFullYear()} Boss Clinician. Admin access only.
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center bg-cream px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-gold-foil font-display text-lg font-bold text-night-deep">
              B
            </span>
            <span className="font-display text-lg text-ink">Boss Clinician</span>
          </div>

          <h2 className="font-display text-[1.75rem] text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-soft">
            {mfaRequired
              ? "Your password is right. Enter the code from your authenticator app."
              : "Welcome back. Enter your details to continue."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {!mfaRequired && <Field label="Email" htmlFor="admin-email">
              <Input
                id="admin-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@bossclinician.com"
              />
            </Field>}

            {!mfaRequired && <Field label="Password" htmlFor="admin-password">
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-ink-soft transition-colors hover:text-gold"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>}

            {mfaRequired && (
              <Field label="Authentication or backup code" htmlFor="admin-code">
                <Input
                  id="admin-code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  maxLength={16}
                  value={code}
                  onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
                  placeholder="123456 or ABCD-EFGH"
                  className="text-center font-mono tracking-[0.3em]"
                  autoFocus
                  required
                />
              </Field>
            )}

            {error && <ErrorNotice message={error} />}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || (mfaRequired && code.length < 6)}
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  {mfaRequired ? "Checking code…" : "Signing in…"}
                </>
              ) : (
                <>
                  {mfaRequired ? "Verify and sign in" : "Sign in"}
                  <ArrowRight />
                </>
              )}
            </Button>

            {mfaRequired && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setMfaRequired(false);
                  setCode("");
                  setError(null);
                }}
              >
                <ArrowLeft />
                Use a different account
              </Button>
            )}
          </form>

          <p className="mt-6 text-center text-xs text-ink-soft">
            Only you can get in here. If you leave it a while, you'll need to sign in again.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
