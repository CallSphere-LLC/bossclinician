import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OfferBump } from "@/lib/commerceApi";

interface OrderBumpsProps {
  bumps: OfferBump[];
  selected: number[];
  onToggle: (productId: number) => void;
  disabled?: boolean;
}

/**
 * The add-ons that ride along with this order.
 *
 * A real checkbox inside a real label, so the whole card is the tap target and
 * the browser's own keyboard handling applies. The price is stated on the card
 * itself rather than only appearing in the summary: ticking a box that quietly
 * raises the total is the pattern refunds come from.
 */
export function OrderBumps({ bumps, selected, onToggle, disabled = false }: OrderBumpsProps) {
  if (bumps.length === 0) return null;

  return (
    <ul className="space-y-3">
      {bumps.map((bump) => {
        const checked = selected.includes(bump.productId);
        const descriptionId = `bump-${bump.id}-description`;

        return (
          <li key={bump.id}>
            <label
              className={cn(
                "flex min-h-[3.5rem] cursor-pointer items-start gap-4 rounded-2xl border border-dashed p-4",
                "transition-colors duration-300 ease-luxe",
                checked
                  ? "border-gold/60 bg-gold/[0.08]"
                  : "border-white/20 bg-white/[0.02] hover:border-gold/40 hover:bg-white/[0.04]",
                disabled && "cursor-not-allowed opacity-60",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(bump.productId)}
                aria-describedby={bump.description ? descriptionId : undefined}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border transition-colors duration-300 ease-luxe",
                  checked
                    ? "border-gold bg-gold-foil text-night-deep"
                    : "border-white/25 text-transparent",
                )}
              >
                {checked ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4 text-orchid" />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-[0.95rem] font-medium text-white [overflow-wrap:anywhere]">
                    {bump.title}
                  </span>
                  <span className="text-[0.95rem] font-semibold text-gold">
                    + {bump.formattedAmount}
                  </span>
                </span>
                {bump.description && (
                  <span
                    id={descriptionId}
                    className="mt-1.5 block text-sm font-light leading-relaxed text-orchid-dim"
                  >
                    {bump.description}
                  </span>
                )}
              </span>

              {bump.product.thumbnailUrl && (
                <img
                  src={bump.product.thumbnailUrl}
                  alt=""
                  className="hidden h-14 w-14 flex-none rounded-lg border border-white/10 object-cover sm:block"
                />
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
