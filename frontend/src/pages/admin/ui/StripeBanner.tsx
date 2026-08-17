import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { StripeStatus } from "@/types/admin";
import { Button } from "@/pages/admin/ui/primitives";

/**
 * Shown across the Sales section when payments can't actually be taken.
 *
 * Renders nothing in the healthy case — a persistent green "all good" banner
 * is noise that trains people to ignore the component entirely.
 *
 * The two unhealthy states are very different jobs for very different people,
 * so they say so: an unconnected account is work for whoever built the site,
 * while a connected-but-unverified account is paperwork only the owner can
 * finish. Neither message names a key or a variable — what she needs to know
 * is that nobody can pay her yet, and who fixes it.
 */
export function StripeBanner() {
  const [status, setStatus] = useState<StripeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .stripeStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus({ configured: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === null || (status.configured && status.chargesEnabled)) return null;

  const unconfigured = !status.configured;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/[0.10] px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/25 text-gold-muted">
        <AlertTriangle className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {unconfigured
            ? "Payments aren’t switched on yet"
            : "Your payment account still needs checking"}
        </p>
        <p className="text-xs text-ink-soft">
          {unconfigured
            ? "Nobody can buy a course, a plan or a membership from your site until your Stripe account is connected. Whoever set up your site can do it in a few minutes."
            : "Your Stripe account is connected, but Stripe won’t take real money until it has your bank and ID details. Finish those and everything here starts working."}
        </p>
      </div>
      {/* Unconnected sends the developer to where the connection is made;
          unverified sends her to the Stripe home page, which is where the
          "finish setting up" prompts actually live. */}
      <Button asChild variant="secondary" size="sm">
        <a
          href={unconfigured ? "https://dashboard.stripe.com/apikeys" : "https://dashboard.stripe.com/"}
          target="_blank"
          rel="noreferrer"
        >
          {unconfigured ? "Open Stripe" : "Finish in Stripe"}
          <ExternalLink />
        </a>
      </Button>
    </div>
  );
}
