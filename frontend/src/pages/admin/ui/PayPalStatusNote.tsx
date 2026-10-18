import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { PayPalStatus } from "@/types/admin";
import { Badge } from "@/pages/admin/ui/primitives";

/**
 * One line on the Payments page saying whether buyers are offered PayPal.
 *
 * Unlike StripeBanner this also shows the healthy state: PayPal is an extra,
 * and "is the PayPal button on?" is a question she will actually ask. It names
 * what is missing in plain words and never shows a key.
 */
export function PayPalStatusNote() {
  const [status, setStatus] = useState<PayPalStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .paypalStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === null) return null;

  const missing = [
    !status.credentials && "the PayPal app's Client ID and Secret",
    status.credentials && !status.environment && "which PayPal (sandbox or live) they belong to",
    !status.webhook && "the webhook ID",
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] px-4 py-3 text-sm">
      <span className="font-semibold text-ink">PayPal checkout</span>
      {status.enabled ? (
        <Badge tone={status.environment === "live" ? "green" : "gold"}>
          {status.environment === "live" ? "On — live payments" : "On — sandbox (test) payments"}
        </Badge>
      ) : (
        <Badge tone="slate">Off</Badge>
      )}
      <span className="min-w-0 flex-1 text-xs text-ink-soft">
        {status.enabled
          ? "Buyers can pay by PayPal for one-time purchases, memberships and payment plans."
          : missing.length > 0
            ? `Buyers only see card payment until whoever set up your site adds ${missing.join(", ")}.`
            : "Everything is in place; it is switched off until PayPal checkout is enabled on the server."}
        {status.merchantId && ` Merchant ID ${status.merchantId}.`}
      </span>
    </div>
  );
}
