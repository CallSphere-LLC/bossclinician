import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import { testimonials } from "@/content/testimonials";
import { Button, ErrorNotice } from "@/pages/admin/ui/primitives";
import { BrandLockup } from "@/pages/admin/ui/BrandMark";
import { useConsoleTheme } from "@/pages/admin/ui/theme";

/**
 * The sign-in screen.
 *
 * Built to the approved mockup: one full-bleed atmospheric field with the
 * brand story on the left and a glass sign-in card on the right, a Dark/Light
 * switch in the top corner, and the security reassurance centred at the foot.
 *
 * Two things it deliberately does *not* copy from the mockup, because the
 * platform behind it cannot honour them:
 *
 * - **No "Continue with Google".** There is no OAuth of any kind in this
 *   backend — `/admin/login` takes an email and a password and nothing else. A
 *   button that looks like a sign-in route and is not one is worse than no
 *   button; this console already lost a search box for the same reason.
 * - **No "Sign up".** Admin accounts are created by invitation
 *   (`/admin/invite/:token`), so a public sign-up link would lead nowhere an
 *   applicant could finish.
 *
 * The field is labelled "Email address" rather than the mockup's "Email or
 * Phone number" for the same reason: `admin_users` is keyed by email, and a
 * phone number typed into it can only ever fail.
 */

const FEATURES: { Icon: LucideIcon; label: string }[] = [
  { Icon: Users, label: "Manage Clients" },
  { Icon: CalendarDays, label: "Schedule Seamlessly" },
  { Icon: BarChart3, label: "Track Growth" },
  { Icon: ShieldCheck, label: "Secure & Reliable" },
];

/** A real client, from the testimonials the site already publishes. */
const FEATURED = testimonials.find((t) => t.published) ?? testimonials[0];

export default function Login() {
  const { user, loading, login } = useAuth();
  const reduceMotion = useReducedMotion();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/admin" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError("That email or password doesn't match. Check them and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div className="relative min-h-screen overflow-hidden bg-cream">
      <Atmosphere />

      <div className="relative flex min-h-screen flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex justify-end">
          <ThemeSwitch />
        </header>

        <main className="mx-auto flex w-full max-w-[78rem] flex-1 items-center py-8">
          <div className="grid w-full items-center gap-12 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:gap-16">
            {/* ── Brand story ─────────────────────────────────────────── */}
            <motion.section {...rise(0)} className="hidden lg:block">
              <BrandLockup />

              <h1 className="mt-10 font-display text-[2.35rem] leading-[1.12] text-ink">
                Run your coaching business.
                <br />
                <span className="text-accent">Elevate more lives.</span>
              </h1>

              <span aria-hidden className="mt-5 block h-[3px] w-14 rounded-full bg-accent" />

              <p className="mt-6 max-w-lg text-[0.95rem] leading-relaxed text-ink-soft">
                All-in-one platform to manage your programs, members, content, appointments and
                growth — seamlessly.
              </p>

              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-6">
                {FEATURES.map(({ Icon, label }, i) => (
                  <motion.li key={label} {...rise(0.12 + i * 0.07)} className="w-[7.5rem]">
                    <span className="grid size-12 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                      <Icon aria-hidden className="size-[1.35rem]" />
                    </span>
                    <p className="mt-2.5 text-[0.82rem] font-medium leading-snug text-ink">
                      {label}
                    </p>
                  </motion.li>
                ))}
              </ul>

              {FEATURED && (
                <motion.figure
                  {...rise(0.42)}
                  className="relative mt-11 max-w-lg rounded-2xl border border-hairline bg-surface/70 p-5 pr-16 backdrop-blur-sm"
                >
                  <span
                    aria-hidden
                    className="absolute left-5 top-4 font-display text-[2.4rem] leading-none text-accent/45"
                  >
                    &ldquo;
                  </span>
                  <blockquote className="pl-8 text-[0.92rem] leading-relaxed text-ink">
                    {FEATURED.quote}
                  </blockquote>
                  <figcaption className="mt-3 pl-8">
                    <span className="text-[0.86rem] font-semibold text-accent">
                      &ndash; {FEATURED.name}
                      {FEATURED.credential ? `, ${FEATURED.credential}` : ""}
                    </span>
                    {FEATURED.practice && (
                      <span className="mt-0.5 block text-[0.8rem] text-ink-soft">
                        {FEATURED.practice}
                      </span>
                    )}
                  </figcaption>
                </motion.figure>
              )}
            </motion.section>

            {/* ── Sign-in card ────────────────────────────────────────── */}
            <motion.section
              {...rise(0.08)}
              className="w-full rounded-2xl border border-hairline bg-surface-raised/85 p-7 shadow-console-pop backdrop-blur-xl sm:p-9"
            >
              {/* The lockup again for narrow screens, where the story column
                  is hidden and the card would otherwise be unbranded. */}
              <div className="mb-7 lg:hidden">
                <BrandLockup />
              </div>

              <h2 className="text-center font-display text-[1.7rem] leading-tight text-ink">
                Welcome back
              </h2>
              <p className="mt-1.5 text-center text-[0.9rem] text-ink-soft">
                Sign in to your Boss Clinician account
              </p>

              <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                <FieldWithIcon
                  id="admin-email"
                  label="Email address"
                  Icon={Mail}
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={setEmail}
                />

                <FieldWithIcon
                  id="admin-password"
                  label="Password"
                  Icon={Lock}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={setPassword}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:text-accent"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden className="size-4" />
                      ) : (
                        <Eye aria-hidden className="size-4" />
                      )}
                    </button>
                  }
                />

                {error && <ErrorNotice message={error} />}

                <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight />
                    </>
                  )}
                </Button>
              </form>

              {/* The mockup's "or / Continue with Google" sits here. See the
                  note at the top of this file: there is no OAuth to continue
                  with, so the space goes to the one recovery route that is
                  real. */}
              <p className="mt-6 text-center text-[0.82rem] leading-relaxed text-ink-soft">
                Accounts are created by invitation.
                <br />
                <Link to="/" className="font-semibold text-accent hover:underline">
                  Back to the website
                </Link>
              </p>
            </motion.section>
          </div>
        </main>

        <footer className="flex items-center justify-center gap-2 pb-2 text-[0.82rem] text-ink-soft">
          <Lock aria-hidden className="size-3.5" />
          Your data is secure and encrypted
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * A labelled field with a leading icon.
 *
 * The label is visible rather than replaced by the placeholder: a placeholder
 * disappears the moment someone types, which is exactly when a person checking
 * their work needs to know which box is which.
 */
function FieldWithIcon({
  id,
  label,
  Icon,
  trailing,
  value,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  Icon: LucideIcon;
  trailing?: React.ReactNode;
  value: string;
  onChange: (next: string) => void;
  type: string;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.82rem] font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <Icon
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 size-[1.05rem] -translate-y-1/2 text-ink-soft"
        />
        <input
          id={id}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-[3.1rem] w-full rounded-xl border border-hairline bg-raise pl-11 text-sm text-ink outline-none transition-all",
            "placeholder:text-ink-soft/70",
            "focus-visible:border-accent focus-visible:bg-surface focus-visible:ring-4 focus-visible:ring-accent/20",
            trailing ? "pr-12" : "pr-4",
          )}
          {...input}
        />
        {trailing && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>
        )}
      </div>
    </div>
  );
}

/**
 * The Dark / Light switch from the mockup's top corner.
 *
 * A two-option segmented control rather than the console's three-way menu:
 * this is the one screen where somebody may be deciding what the product looks
 * like before they have signed into it, and the choice writes the same
 * preference the rest of the console reads. Choosing either explicitly ends
 * "follow my machine", which is the honest consequence of a two-state switch.
 */
function ThemeSwitch() {
  const { theme, setPreference } = useConsoleTheme();
  const options = [
    { value: "dark" as const, label: "Dark", Icon: Moon },
    { value: "light" as const, label: "Light", Icon: Sun },
  ];

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="flex items-center gap-1 rounded-full border border-hairline bg-surface-raised/80 p-1 backdrop-blur-md"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setPreference(value)}
          aria-pressed={theme === value}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.82rem] font-medium transition-colors",
            theme === value
              ? "bg-accent-solid text-accent-on"
              : "text-ink-soft hover:text-ink",
          )}
        >
          <Icon aria-hidden className="size-[0.95rem]" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The atmospheric background.
 *
 * The mockup shows a blurred night cityscape through office glass. There is no
 * such photograph in this project and inventing one would mean shipping a
 * stock image nobody licensed, so the field is composed instead: a deep
 * gradient ground, a warm horizon, and a scatter of out-of-focus window lights
 * built from radial gradients. It costs no request, cannot fail to load, and —
 * unlike a photograph — has a light-theme counterpart, which the mockup's own
 * Dark/Light switch implies must exist.
 *
 * Entirely decorative, so it is hidden from assistive technology.
 */
function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Ground */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_0%,rgb(var(--c-sand))_0%,rgb(var(--c-cream))_55%,rgb(var(--atmo-floor))_100%)]" />

      {/* Ceiling light — the bright streak across the top of the mockup. */}
      <div className="absolute -top-24 left-1/4 h-48 w-[42rem] -rotate-6 rounded-full bg-warn/25 blur-[80px]" />

      {/* Bokeh: out-of-focus window lights, warm low and cool high. */}
      <div className="absolute left-[6%] top-[62%] size-72 rounded-full bg-warn/20 blur-[70px]" />
      <div className="absolute right-[8%] top-[18%] size-96 rounded-full bg-accent/20 blur-[90px]" />
      <div className="absolute bottom-[-8%] right-[26%] size-80 rounded-full bg-accent/15 blur-[80px]" />
      <div className="absolute bottom-[12%] left-[38%] size-40 rounded-full bg-warn/15 blur-[60px]" />

      {/* A faint window mullion grid, so the field reads as glass rather than
          as an untextured gradient. */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(var(--c-ink)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--c-ink)) 1px, transparent 1px)",
          backgroundSize: "14rem 9rem",
        }}
      />

      {/* Vignette, to settle the edges under the content. */}
      <div className="absolute inset-0 bg-[radial-gradient(100%_100%_at_50%_45%,transparent_35%,rgb(var(--atmo-floor)/var(--atmo-veil))_100%)]" />
    </div>
  );
}
