import type { ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/pages/admin/ui/primitives";

/**
 * The side drawer — Part II §44.
 *
 * "Drawers should preserve dashboard context": the point of this surface, as
 * against the modal next to it, is that the screen behind stays readable. So
 * the scrim is deliberately light and un-blurred — enough to say the drawer is
 * modal, not enough to hide the row the drawer is about.
 *
 * Built on Radix Dialog for the same reasons the modal is: focus trapping,
 * scroll locking, Esc, `aria-modal` and the labelled title all come from the
 * primitive, and hand-rolling those is how a back office ends up with a panel
 * a keyboard cannot leave.
 *
 * Unlike `Modal`, a click outside **does** close this. A drawer is a preview —
 * order details, a contact card, an event — and dismissing it loses nothing.
 * The modal blocks outside clicks because it holds half-written drafts.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const reduceMotion = useReducedMotion();

  const widths = {
    sm: "sm:max-w-sm",
    md: "sm:max-w-md",
    lg: "sm:max-w-xl",
  } as const;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.18 }}
                className="fixed inset-0 z-50 bg-black/35"
              />
            </RadixDialog.Overlay>

            <RadixDialog.Content asChild forceMount>
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { x: "100%" }}
                animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38 }}
                className={cn(
                  // Full width on a phone, where a 24rem panel beside a 20rem
                  // viewport is just a modal with a worse shape (§52).
                  "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-hairline bg-surface-raised shadow-console-pop",
                  widths[width],
                )}
              >
                <div className="flex items-start justify-between gap-4 border-b border-hairline/70 px-5 py-4">
                  <div className="min-w-0">
                    <RadixDialog.Title className="truncate font-display text-lg text-ink">
                      {title}
                    </RadixDialog.Title>
                    {description && (
                      <RadixDialog.Description className="mt-0.5 truncate text-sm text-ink-soft">
                        {description}
                      </RadixDialog.Description>
                    )}
                  </div>
                  <RadixDialog.Close asChild>
                    <Button variant="ghost" size="iconSm" aria-label="Close">
                      <X />
                    </Button>
                  </RadixDialog.Close>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

                {footer && (
                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-hairline/70 px-5 py-4">
                    {footer}
                  </div>
                )}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

/**
 * A label/value pair, the shape almost every drawer body is made of.
 *
 * `<dl>` rather than a grid of divs so a screen reader announces "Customer,
 * Jane Cooper" as a pair rather than as two unrelated strings.
 */
export function DrawerFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-hairline/60">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="shrink-0 text-[0.78rem] text-ink-soft">{item.label}</dt>
          <dd className="min-w-0 text-right text-[0.85rem] text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
