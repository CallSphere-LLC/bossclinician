import { useEffect, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useSiteTheme } from "@/lib/siteTheme";

/**
 * Whether to offer "Continue with Google" at all.
 *
 * Asked of the public settings rather than baked in at build time: the answer
 * is "are the two Google credentials set on the server", and that changes
 * without a deploy. False until the answer arrives and false if it never does —
 * a button that appears late is a small thing, a button that leads to a 404 is
 * not.
 */
export function useGoogleSignInEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((settings) => {
        if (!cancelled) setEnabled(googleEnabledIn(settings));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}

/** For a caller that already has the settings in hand (the sign-in page does). */
export function googleEnabledIn(settings: Record<string, unknown>): boolean {
  const signIn = settings.member_signin as { googleEnabled?: unknown } | undefined;
  return signIn?.googleEnabled === true;
}

/**
 * The sentences behind `/login?error=google_*`.
 *
 * The server only ever sends one of these codes — never a message — because the
 * value sits in a URL anybody can write, and this page should not repeat a
 * stranger's words back under our name. Anything unrecognised says nothing.
 */
const GOOGLE_ERRORS: Readonly<Record<string, string>> = {
  google_cancelled: "No problem — you can sign in with Google whenever you're ready, or use your email below.",
  google_unverified:
    "Google hasn't confirmed that email address yet. Please verify it with Google first, or sign in with your email and password.",
  google_failed: "We couldn't finish signing you in with Google. Please try again, or use your email below.",
  google_blocked: "This account can't sign in at the moment. Please get in touch and we'll help.",
  google_mismatch:
    "That email address is already connected to a different Google account. Please sign in with your email and password instead.",
  google_disabled: "Signing in with Google isn't available right now. Please use your email below.",
};

export function googleErrorMessage(code: string | null): string | null {
  // Own keys only: `?error=constructor` must say nothing rather than find
  // something on Object.prototype.
  if (!code || !Object.prototype.hasOwnProperty.call(GOOGLE_ERRORS, code)) return null;
  return GOOGLE_ERRORS[code] ?? null;
}

/**
 * Google's mark, inline. The four colours and the geometry are Google's and are
 * not to be restyled; it is inline rather than an image because the site's
 * Content-Security-Policy only draws images from our own origin.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px] shrink-0" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google", followed by the "or" rule that separates it from the
 * email form underneath.
 *
 * A plain link, not a button with a handler and not a router `<Link>`: the
 * destination is an API route that answers with a redirect to Google, so the
 * browser has to really navigate there. It also means the whole flow works with
 * no Google script on the page.
 *
 * The colours are fixed values rather than the site's palette on purpose.
 * Google's branding rules allow exactly two surfaces for this button — white
 * with a grey hairline, or near-black — and the site's own tokens shift with
 * the theme in ways that would land on neither. So the button follows the theme
 * by picking between Google's two, and ignores ours.
 */
export function GoogleButton({ next }: { next: string }) {
  const theme = useSiteTheme();

  return (
    <div className="mb-7">
      <a
        href={`${API_BASE}/auth/google/start?next=${encodeURIComponent(next)}`}
        // The API answers this one, not the app — keep any prefetching or
        // client-side routing that may be added later away from it.
        rel="nofollow"
        className={cn(
          "flex min-h-[44px] w-full items-center justify-center gap-3 rounded-full border px-5 py-2.5",
          "text-sm font-medium no-underline transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
          theme === "light"
            ? "border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f2f2f2]"
            : "border-[#8e918f] bg-[#131314] text-[#e3e3e3] hover:bg-[#1e1f20]",
        )}
      >
        <GoogleMark />
        <span>Continue with Google</span>
      </a>

      <div className="mt-7 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-ink/10" />
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-orchid-faint">
          or
        </span>
        <span className="h-px flex-1 bg-ink/10" />
      </div>
    </div>
  );
}
