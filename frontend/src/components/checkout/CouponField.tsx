import { useId } from "react";
import { Loader2, TicketPercent } from "lucide-react";
import { LuxeFieldShell, luxeControlClass } from "@/components/luxe/LuxeField";
import { cn } from "@/lib/cn";
import type { AppliedCoupon } from "@/lib/commerceApi";

interface CouponFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** True while the code is being checked against the server. */
  pending: boolean;
  applied: AppliedCoupon | null;
  /** Why the typed code did not apply. Advisory — the order is still fine. */
  error: string | null;
  /** The discount the server worked out, already formatted. */
  discount: string | null;
  disabled?: boolean;
}

/**
 * The coupon field.
 *
 * Validated live against `/quote`, so there is no Apply button to forget to
 * press — the summary changes as the code lands. A code that does not apply is
 * reported here in a sentence and never blocks the checkout: the order stands at
 * full price and the buyer decides what to do about it.
 */
export function CouponField({
  value,
  onChange,
  pending,
  applied,
  error,
  discount,
  disabled = false,
}: CouponFieldProps) {
  const id = useId();

  const message = pending
    ? "Checking your code…"
    : applied
      ? discount
        ? `${applied.code} applied — ${discount} off.`
        : `${applied.code} applied.`
      : error;

  const tone = pending ? "muted" : applied ? "good" : error ? "bad" : "muted";

  return (
    <LuxeFieldShell label="Discount code" htmlFor={id}>
      <div className="relative">
        <TicketPercent
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-orchid-faint"
        />
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={`${id}-result`}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Have a code?"
          className={cn(
            luxeControlClass,
            "pl-11 pr-11 uppercase tracking-[0.08em] placeholder:normal-case placeholder:tracking-normal",
            applied && "border-gold/50",
            error && "border-red-400/70 bg-red-950/20 focus:border-red-300",
          )}
        />
        {pending && (
          <Loader2
            aria-hidden
            className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gold"
          />
        )}
      </div>

      {/* Polite rather than assertive: the buyer is still typing, and an
          interruption per keystroke is worse than hearing the result a beat late. */}
      <p
        id={`${id}-result`}
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={cn(
          "min-h-[1.75rem] rounded-lg px-2 py-1 text-xs",
          tone === "good" && "bg-gold/10 font-medium text-gold",
          tone === "bad" && "border border-red-400/30 bg-red-950/30 font-medium text-red-300",
          tone === "muted" && "text-orchid-faint",
        )}
      >
        {message}
      </p>
    </LuxeFieldShell>
  );
}
