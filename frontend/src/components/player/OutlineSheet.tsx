import { useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ListTree, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CourseProgress, OutlineModule } from "@/lib/libraryApi";
import { CourseOutline } from "@/components/player/CourseOutline";

interface OutlineSheetProps {
  modules: OutlineModule[];
  productSlug: string;
  courseTitle: string;
  activeLessonSlug?: string;
  progress: CourseProgress;
  className?: string;
}

/**
 * The outline on a phone.
 *
 * A sheet rather than a column, because the alternative on a 360px screen is a
 * squeezed sidebar that turns every lesson title into three words and a hyphen.
 * It opens from the bottom, where the thumb already is on a screen held one
 * handed, and it closes as soon as a lesson is chosen — this is a way through to
 * the content, not a place to stay.
 *
 * Radix owns the focus trap, the scroll lock, Esc and the ARIA wiring; the
 * portal escapes `.theme-luxe`, so the surface colours are named outright here
 * rather than taken from the themeable tokens, which would resolve to the light
 * palette and flash white.
 */
export function OutlineSheet({
  modules,
  productSlug,
  courseTitle,
  activeLessonSlug,
  progress,
  className,
}: OutlineSheetProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-xl",
            "border border-white/12 bg-white/[0.04] px-4 py-3 text-left",
            "transition-colors duration-300 hover:border-white/20",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <ListTree aria-hidden className="size-4 shrink-0 text-gold" />
            <span className="truncate text-sm font-medium text-white">Course outline</span>
          </span>
          <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
            {progress.lessonsCompleted} / {progress.lessonsTotal}
          </span>
        </button>
      </RadixDialog.Trigger>

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
                initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
                animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
                transition={
                  reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 34 }
                }
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 flex max-h-[86vh] flex-col",
                  "rounded-t-3xl border-t border-white/10 bg-[#100B1C]",
                  "shadow-[0_-24px_70px_-20px_rgba(0,0,0,0.9)]",
                )}
              >
                <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
                  <div className="min-w-0">
                    <RadixDialog.Title className="truncate font-display text-lg text-white">
                      {courseTitle}
                    </RadixDialog.Title>
                    <RadixDialog.Description className="mt-1 text-xs uppercase tracking-[0.14em] text-orchid-faint">
                      {progress.lessonsCompleted} of {progress.lessonsTotal} lessons finished
                    </RadixDialog.Description>
                  </div>
                  <RadixDialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Close the outline"
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

                {/* `pb-10` clears the home indicator on a modern phone, which
                    otherwise sits on top of the last lesson in the list. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 pt-4">
                  <CourseOutline
                    modules={modules}
                    productSlug={productSlug}
                    activeLessonSlug={activeLessonSlug}
                    onNavigate={() => setOpen(false)}
                  />
                </div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
