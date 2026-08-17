import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PublicOffer } from "@/lib/commerceApi";
import type { BillingWording } from "@/components/checkout/billingLanguage";
import type { QuoteState } from "@/components/checkout/useOfferQuote";

interface OrderSummaryProps {
  offer: PublicOffer;
  state: QuoteState;
  wording: BillingWording;
}

/**
 * What is being bought and what it costs.
 *
 * Collapsed on a phone with the total still showing, because most of this
 * audience checks out on one and a summary that eats the first screen pushes the
 * form below the fold. Open on desktop, where there is room for both.
 *
 * The figures are the server's own formatted strings. The only number this
 * component composes is a zero, for the one case where a trial means today's
 * charge really is nothing.
 */
export function OrderSummary({ offer, state, wording }: OrderSummaryProps) {
  const [open, setOpen] = useState(false);
  const { quote, coupon, pending } = state;

  const dueToday = wording.nothingDueToday
    ? formatCurrency(0, quote.currency)
    : quote.formatted.total;

  return (
    <GlassCard
      accent="gold"
      spotlight={false}
      interactive={false}
      className="overflow-hidden lg:sticky lg:top-28"
    >
      {/* Mobile handle. The total lives in the closed state on purpose: a
          collapsed summary that hides the price is the pattern people distrust. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="order-summary-detail"
        className={cn(
          "flex min-h-[3.25rem] w-full items-center justify-between gap-3 px-5 py-4 text-left lg:hidden",
          "transition-colors duration-300 ease-luxe hover:bg-white/[0.03]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
        )}
      >
        <span className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">
          Order summary
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 text-gold transition-transform duration-300 ease-luxe",
              open && "rotate-180",
            )}
          />
        </span>
        <span className="font-display text-lg text-white">{dueToday}</span>
      </button>

      <div
        id="order-summary-detail"
        className={cn("px-5 pb-6 lg:block lg:px-6 lg:pt-6", open ? "block" : "hidden")}
      >
        <h2 className="hidden text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid lg:block">
          Order summary
        </h2>

        <div className="mt-0 flex items-start gap-4 lg:mt-5">
          {offer.thumbnailUrl && (
            <img
              src={offer.thumbnailUrl}
              alt=""
              className="h-16 w-16 flex-none rounded-xl border border-white/10 object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="font-display text-lg leading-snug text-white [overflow-wrap:anywhere]">
              {offer.title}
            </p>
            <LuxePill accent="gold" className="mt-2">
              {wording.badge}
            </LuxePill>
          </div>
        </div>

        <div
          className={cn(
            "mt-6 transition-opacity duration-300 ease-luxe",
            pending && "opacity-60",
          )}
          aria-busy={pending}
        >
          <ul className="space-y-3 text-sm">
            {quote.lines.map((line, index) => (
              <li
                key={`${line.kind}-${line.productId ?? line.offerId ?? index}`}
                className="flex items-baseline justify-between gap-4"
              >
                <span className="text-orchid-dim [overflow-wrap:anywhere]">
                  {line.title}
                  {line.kind === "bump" && (
                    <span className="ml-2 text-xs uppercase tracking-[0.14em] text-gold/80">
                      added
                    </span>
                  )}
                </span>
                <span className="flex-none text-white">
                  {formatCurrency(line.amountCents, quote.currency)}
                </span>
              </li>
            ))}
          </ul>

          <div aria-hidden className="rule-faint my-5 w-full" />

          {/* One live region for the whole money block: a coupon that lands is
              announced once as a new total, not as four separate row changes. */}
          <div aria-live="polite">
            <dl className="space-y-2.5 text-sm">
              <Row label="Subtotal" value={quote.formatted.subtotal} />
              {quote.discountCents > 0 && (
                <Row
                  label={coupon ? `Discount (${coupon.code})` : "Discount"}
                  value={`−${quote.formatted.discount}`}
                  tone="gold"
                />
              )}
              {quote.taxCents > 0 && <Row label="Sales tax" value={quote.formatted.tax} />}
            </dl>

            <div className="rule-faint my-4 w-full" aria-hidden />

            <dl className="flex items-baseline justify-between gap-4">
              <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                {wording.totalLabel}
              </dt>
              <dd className="font-display text-2xl text-white">{dueToday}</dd>
            </dl>
          </div>

          {(wording.commitment || wording.detail) && (
            <div className="mt-5 rounded-xl border border-gold/25 bg-gold/[0.06] px-4 py-3.5">
              {wording.commitment && (
                <p className="text-sm font-medium leading-relaxed text-gold-bright">
                  {wording.commitment}
                </p>
              )}
              {wording.detail && (
                <p
                  className={cn(
                    "text-xs leading-relaxed text-orchid-dim",
                    wording.commitment && "mt-1.5",
                  )}
                >
                  {wording.detail}
                </p>
              )}
            </div>
          )}

          {state.error && (
            <p role="alert" className="mt-4 text-xs text-red-400">
              {state.error}
            </p>
          )}
        </div>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-orchid-faint">
          <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
          Payments are processed by Stripe over an encrypted connection. Your card details never
          touch this site.
        </p>
      </div>
    </GlassCard>
  );
}

function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "gold";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-orchid-dim">{label}</dt>
      <dd className={cn("flex-none", tone === "gold" ? "text-gold" : "text-white")}>{value}</dd>
    </div>
  );
}
