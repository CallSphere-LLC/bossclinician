import type { ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Modal for the member area.
 *
 * Radix owns focus trapping, scroll locking, Esc and the ARIA wiring; this only
 * owns the look. It cannot reuse `pages/admin/ui/Dialog.tsx`, which paints on
 * the light admin palette and pulls in the admin button primitives — the member
 * area is the Obsidian Luxe product, not the workplace.
 *
 * The portal escapes `.theme-luxe`, so the surface colours are named outright
 * here rather than taken from the themeable `bg-surface` tokens, which would
 * otherwise resolve to the light palette and flash white.
 */
export function LuxeDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const reduceMotion = useReducedMotion();
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];

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
                className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
              />
            </RadixDialog.Overlay>

            <RadixDialog.Content asChild forceMount>
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-1.75rem)]",
                  "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl",
                  "border border-white/10 bg-[#100B1C] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)]",
                  width,
                )}
              >
                <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <RadixDialog.Title className="font-display text-lg text-white">
                      {title}
                    </RadixDialog.Title>
                    {description && (
                      <RadixDialog.Description className="mt-1.5 text-sm leading-relaxed text-orchid">
                        {description}
                      </RadixDialog.Description>
                    )}
                  </div>
                  <RadixDialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Close without changing anything"
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-full text-orchid-dim",
                        "transition-colors duration-300 hover:bg-white/[0.07] hover:text-white",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      )}
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </RadixDialog.Close>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

                {footer && (
                  <div className="flex flex-col-reverse gap-2.5 border-t border-white/[0.08] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
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
