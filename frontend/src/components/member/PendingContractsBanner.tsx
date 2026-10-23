import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { FileSignature } from "lucide-react";
import { memberContractsApi } from "@/lib/contractsApi";
import { cn } from "@/lib/cn";

/**
 * "You have a contract to sign" — shown across the member area while any
 * assigned contract (manual, or from a purchase: QA row 164) is unsigned.
 *
 * A reminder, not a gate: access to what they bought is never held back. It
 * renders nothing on the Contracts page itself, when nothing is pending, and
 * when the list cannot be loaded (a banner that errors is worse than none).
 */
export function PendingContractsBanner({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const [pending, setPending] = useState<string[]>([]);
  const onContracts = pathname === "/contracts";

  useEffect(() => {
    if (onContracts) return;
    let live = true;
    memberContractsApi
      .list()
      .then((data) => {
        if (live) setPending(data.contracts.filter((c) => c.status === "pending").map((c) => c.title));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [onContracts]);

  if (onContracts || pending.length === 0) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/[0.08] px-5 py-4 text-sm text-white",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <FileSignature className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
        <span>
          {pending.length === 1 ? (
            <>Please review and sign <strong>{pending[0]}</strong>.</>
          ) : (
            <>You have {pending.length} contracts waiting for your signature.</>
          )}
        </span>
      </span>
      <Link to="/contracts" className="rounded-xl bg-gold px-4 py-2 font-semibold text-night-deep">
        Review and sign
      </Link>
    </div>
  );
}
