import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { useConsent } from "@/hooks/useConsent";
import {
  OPEN_PREFERENCES_EVENT,
  saveConsent,
  type ConsentCategory,
} from "@/lib/consent";
import { cn } from "@/lib/cn";

/** The optional categories, as the preferences panel lists them. */
const CATEGORIES: { key: ConsentCategory; title: string; body: string }[] = [
  {
    key: "media",
    title: "Embedded content and social media",
    body: "Our Instagram feed and any video players hosted by other companies (YouTube, Vimeo, Loom, Wistia). Those companies may set their own cookies when the content loads.",
  },
  {
    key: "analytics",
    title: "Analytics and marketing",
    body: "Measurement and advertising tools such as Google Analytics or the Meta pixel. We do not run any today; if we add them, they stay off unless you allow them here.",
  },
];

/**
 * The cookie banner and the preferences panel, mounted once in Layout.
 *
 * Nothing optional runs until the visitor chooses (see lib/consent.ts). The
 * banner offers Accept all, Reject non-essential, and Preferences as equal,
 * one-click choices; the footer's "Cookie preferences" link reopens the panel
 * at any time. Rendered only after mount — the stored choice lives in this
 * browser, so the server render cannot know whether to show it.
 */
export function CookieConsent() {
  const { consent, ready } = useConsent();
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const open = () => setPanelOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, open);
  }, []);

  if (!ready) return null;

  const decide = (choice: Record<ConsentCategory, boolean>) => {
    saveConsent(choice);
    setPanelOpen(false);
  };

  // The page shell isolates its decorative grain layer. Render the fixed
  // consent UI at the document level so chat and other floating controls
  // cannot cover its actions on narrow screens.
  return createPortal(
    <div className="theme-luxe">
      {!consent && !panelOpen && (
        <Banner
          onAccept={() => decide({ media: true, analytics: true })}
          onReject={() => decide({ media: false, analytics: false })}
          onPreferences={() => setPanelOpen(true)}
        />
      )}
      {panelOpen && (
        <PreferencesPanel
          initial={{ media: consent?.media ?? false, analytics: consent?.analytics ?? false }}
          onSave={decide}
          onAcceptAll={() => decide({ media: true, analytics: true })}
          onRejectAll={() => decide({ media: false, analytics: false })}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}

function Banner({
  onAccept,
  onReject,
  onPreferences,
}: {
  onAccept: () => void;
  onReject: () => void;
  onPreferences: () => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[90] mx-auto max-w-[68rem] sm:inset-x-5 sm:bottom-5"
    >
      <div className="rounded-xl border border-gold/25 bg-night-deep/[0.98] p-4 shadow-[0_20px_55px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-5 lg:flex lg:items-center lg:gap-6">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-display text-base font-medium text-white">
            Your privacy, your choice
          </h2>
          <p className="copy-luxe mt-1 text-pretty text-[0.82rem] leading-relaxed">
            Essential cookies keep sign-in, cart and checkout working. With your permission, we
            also load content such as Instagram that may set cookies. Optional content stays off
            until you allow it.{" "}
            <Link
              to="/cookie-policy"
              className="whitespace-nowrap text-gold underline decoration-gold/40 underline-offset-4 hover:text-gold-bright"
            >
              Cookie Policy
            </Link>
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:mt-0 lg:shrink-0 lg:flex-nowrap">
          <LuxeButton type="button" variant="foil" size="sm" onClick={onAccept} className="min-h-[44px] px-4 py-2 text-[0.66rem] tracking-[0.08em]">
            Accept all
          </LuxeButton>
          <LuxeButton type="button" variant="outline" size="sm" onClick={onReject} className="min-h-[44px] px-4 py-2 text-[0.66rem] tracking-[0.08em]">
            Reject non-essential
          </LuxeButton>
          <LuxeButton type="button" variant="glass" size="sm" onClick={onPreferences} className="col-span-2 min-h-[44px] px-4 py-2 text-[0.66rem] tracking-[0.08em]">
            Preferences
          </LuxeButton>
        </div>
      </div>
    </section>
  );
}

function PreferencesPanel({
  initial,
  onSave,
  onAcceptAll,
  onRejectAll,
  onClose,
}: {
  initial: Record<ConsentCategory, boolean>;
  onSave: (choice: Record<ConsentCategory, boolean>) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState(initial);
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus moves into the panel, Escape closes it, Tab stays inside it, and
  // focus goes back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div aria-hidden className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-gold/25 bg-night-deep p-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)] sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[1.4rem] font-medium text-white focus:outline-none"
          >
            Cookie preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cookie preferences"
            className="-mr-2 -mt-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
          >
            &times;
          </button>
        </div>
        <p className="copy-luxe mt-2 text-pretty text-sm">
          Choose what this site may load in this browser. You can change this at any time from
          “Cookie preferences” at the foot of every page.{" "}
          <Link
            to="/cookie-policy"
            onClick={onClose}
            className="text-gold underline decoration-gold/40 underline-offset-4 hover:text-gold-bright"
          >
            Read the Cookie Policy
          </Link>
        </p>

        <ul className="mt-6 space-y-3">
          <li className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Essential</p>
                <p className="copy-luxe mt-1 text-pretty text-[0.82rem]">
                  Sign-in, your cart, checkout and payment security, your light or dark theme, and
                  this choice. The site cannot work without them, so they are always on.
                </p>
              </div>
              <span className="w-fit shrink-0 rounded-full border border-gold/30 px-3 py-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-gold">
                Always on
              </span>
            </div>
          </li>
          {CATEGORIES.map((category) => (
            <li key={category.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="flex cursor-pointer items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{category.title}</span>
                  <span className="copy-luxe mt-1 block text-pretty text-[0.82rem]">{category.body}</span>
                </span>
                <Switch
                  checked={choice[category.key]}
                  onChange={(next) => setChoice((current) => ({ ...current, [category.key]: next }))}
                />
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <LuxeButton type="button" variant="foil" size="sm" onClick={() => onSave(choice)} className="min-h-[44px]">
            Save my choices
          </LuxeButton>
          <LuxeButton type="button" variant="outline" size="sm" onClick={onAcceptAll} className="min-h-[44px]">
            Accept all
          </LuxeButton>
          <LuxeButton type="button" variant="outline" size="sm" onClick={onRejectAll} className="min-h-[44px]">
            Reject non-essential
          </LuxeButton>
        </div>
      </div>
    </div>
  );
}

/** A checkbox drawn as a switch; the <label> around it carries its name. */
function Switch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <span className="relative mt-0.5 inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
      />
      <span
        aria-hidden
        className={cn(
          "flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors duration-200",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold",
          checked ? "border-gold/70 bg-gold/80" : "border-white/25 bg-white/[0.06]",
        )}
      >
        <span
          className={cn(
            "h-[1.1rem] w-[1.1rem] rounded-full shadow transition-transform duration-200",
            checked ? "translate-x-5 bg-night-deep" : "translate-x-0 bg-white/70",
          )}
        />
      </span>
    </span>
  );
}
