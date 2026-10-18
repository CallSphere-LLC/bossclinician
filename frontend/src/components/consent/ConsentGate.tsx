import type { ReactNode } from "react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { useConsent } from "@/hooks/useConsent";
import { currentConsent, openCookiePreferences, saveConsent, type ConsentCategory } from "@/lib/consent";
import { cn } from "@/lib/cn";

/**
 * Renders `children` only once the visitor has allowed `category`; until then
 * (and on the server, and on the first client render) a placeholder says what
 * would load and offers to allow it. Children mount only when allowed, so a
 * third-party script injected from inside them never runs without consent.
 */
export function ConsentGate({
  category,
  what,
  fallbackLink,
  className,
  children,
}: {
  category: ConsentCategory;
  /** What is behind the gate, e.g. "our Instagram feed". */
  what: string;
  /** Somewhere to see the same thing without the embed. */
  fallbackLink?: { label: string; href: string };
  className?: string;
  children: ReactNode;
}) {
  const { consent, ready } = useConsent();
  if (ready && consent?.[category]) return <>{children}</>;

  const allow = () => {
    const now = currentConsent();
    saveConsent({ media: now?.media ?? false, analytics: now?.analytics ?? false, [category]: true });
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center sm:p-8",
        className,
      )}
    >
      <p className="copy-luxe max-w-[44ch] text-pretty text-sm">
        To show {what}, this page loads content from another company, which may set its own
        cookies. It stays off until you allow it.
      </p>
      <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
        <LuxeButton type="button" variant="glass" size="sm" onClick={allow} className="min-h-[44px]">
          Allow embedded content
        </LuxeButton>
        {fallbackLink && (
          <LuxeButton variant="outline" size="sm" href={fallbackLink.href} target="_blank" className="min-h-[44px]">
            {fallbackLink.label}
          </LuxeButton>
        )}
      </div>
      <button
        type="button"
        onClick={openCookiePreferences}
        className="text-xs text-orchid-faint underline decoration-white/20 underline-offset-4 hover:text-gold"
      >
        Cookie preferences
      </button>
    </div>
  );
}
