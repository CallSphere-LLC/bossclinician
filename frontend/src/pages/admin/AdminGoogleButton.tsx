import { useEffect, useState } from "react";
import { adminApi, API_BASE } from "@/lib/api";
import { GoogleMark } from "@/components/member/GoogleButton";

/**
 * Whether to offer "Continue with Google" on the admin sign-in page.
 *
 * Asked of the server rather than baked in at build time, for the same reason
 * the member page asks: the answer is "are the Google credentials set, and is
 * admin sign-in with Google switched on", and that changes without a deploy.
 * False until the answer arrives and false if it never does — a button that
 * appears late is a small thing, a button that leads to a 404 is not.
 *
 * Its own question rather than the member one (`useGoogleSignInEnabled`): that
 * reads the public site settings, and the two can differ.
 */
export function useAdminGoogleEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .signinOptions()
      .then((options) => {
        if (!cancelled) setEnabled(options.googleEnabled === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}

/**
 * The sentences behind `/admin/login?error=google_*`.
 *
 * The server only ever sends one of these codes — never a message — because the
 * value sits in a URL anybody can write, and this page should not repeat a
 * stranger's words back under our name. Anything unrecognised says nothing.
 */
const ADMIN_GOOGLE_ERRORS: Readonly<Record<string, string>> = {
  google_cancelled: "No problem. You can sign in with Google whenever you're ready, or use your email below.",
  google_unverified:
    "Google hasn't confirmed that email address yet. Verify it with Google first, or sign in with your email and password.",
  google_failed: "We couldn't finish signing you in with Google. Try again, or use your email below.",
  google_mismatch:
    "That email address is already connected to a different Google account. Sign in with your email and password instead.",
  google_disabled: "Signing in with Google isn't available right now. Use your email below.",
  google_no_account:
    "That Google account isn't set up as an admin here. Sign in with your email and password, or ask the owner to invite that address.",
  google_mfa:
    "This account uses two-step sign-in, so Google can't be used for it. Sign in with your email, password and code.",
};

export function adminGoogleErrorMessage(code: string | null): string | null {
  // Own keys only: `?error=constructor` must say nothing rather than find
  // something on Object.prototype.
  if (!code || !Object.prototype.hasOwnProperty.call(ADMIN_GOOGLE_ERRORS, code)) return null;
  return ADMIN_GOOGLE_ERRORS[code] ?? null;
}

/**
 * "Continue with Google", followed by the "or" rule that separates it from the
 * email form underneath.
 *
 * A plain link, not a button with a handler and not a router `<Link>`: the
 * destination is an API route that answers with a redirect to Google, so the
 * browser has to really navigate there.
 *
 * The surface is Google's near-black one, fixed, and not the console's tokens.
 * Google's branding rules allow exactly two surfaces for this button — white
 * with a grey hairline, or near-black — and the member button picks between
 * them by theme. Here there is nothing to pick: the console's White appearance
 * is applied by ConsoleThemeToggle, which lives in AdminLayout and removes
 * `<html data-console-theme>` when it unmounts, so the sign-in page is always
 * the default Dark palette whatever was chosen inside. If the sign-in page ever
 * learns to follow that choice, this is the place to follow it too.
 */
export function AdminGoogleButton({ next }: { next: string }) {
  return (
    <div className="mt-8">
      <a
        href={`${API_BASE}/admin/google/start?next=${encodeURIComponent(next)}`}
        // The API answers this one, not the app — keep any prefetching or
        // client-side routing that may be added later away from it.
        rel="nofollow"
        className={
          "flex min-h-[44px] w-full items-center justify-center gap-3 rounded-xl border px-5 py-2.5 " +
          "text-sm font-medium no-underline transition-colors " +
          // Colour comes from the console's own `:focus-visible` rule.
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
          "border-[#8e918f] bg-[#131314] text-[#e3e3e3] hover:bg-[#1e1f20]"
        }
      >
        <GoogleMark />
        <span>Continue with Google</span>
      </a>

      <div className="mt-6 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-ink-soft">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>
    </div>
  );
}
