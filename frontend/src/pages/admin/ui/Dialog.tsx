import { useCallback, useRef, useState, type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/pages/admin/ui/primitives";

/**
 * Modal built on Radix Dialog — focus trapping, scroll locking, Esc handling
 * and correct ARIA come from the primitive; we only own the look and motion.
 */
export function Modal({
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
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const reduceMotion = useReducedMotion();

  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
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
                className="theme-console fixed inset-0 z-50 bg-night-deep/75 backdrop-blur-sm"
              />
            </RadixDialog.Overlay>

            <RadixDialog.Content
              asChild
              forceMount
              /* A click that lands outside the panel is far more often a slip
                 than a decision, and every editor in this console throws its
                 draft away when the dialog closes: a 600-word email or a
                 half-written testimonial used to vanish on one stray click.
                 Escape and the close button still cancel — both are deliberate. */
              onPointerDownOutside={(event) => event.preventDefault()}
            >
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                /* Motion writes the whole `transform` inline, which wipes the
                   `-translate-*` centring classes below — it settles on
                   `transform: none` and the panel drops to the bottom-right corner of
                   the screen. Re-apply the centring in front of whatever Motion built. */
                transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`}
                className={cn(
                  /*
                   * `theme-console` again, because the portal puts this on
                   * <body> — outside the layout that carries it. Without it
                   * every token here resolves to the light marketing palette and
                   * the admin gets a white form floating over a dark console:
                   * fields the wrong colour, and a <select> whose chosen value
                   * she cannot read.
                   */
                  "theme-console fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface-raised shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)]",
                  widths[size],
                )}
              >
                <div className="flex items-start justify-between gap-4 border-b border-hairline/70 px-6 py-4">
                  <div className="min-w-0">
                    <RadixDialog.Title className="font-display text-lg text-ink">
                      {title}
                    </RadixDialog.Title>
                    {description && (
                      <RadixDialog.Description className="mt-1 text-sm text-ink-soft">
                        {description}
                      </RadixDialog.Description>
                    )}
                  </div>
                  <RadixDialog.Close asChild>
                    <Button variant="ghost" size="iconSm" aria-label="Close without saving">
                      <X />
                    </Button>
                  </RadixDialog.Close>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

                {footer && (
                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-hairline/70 bg-cream/50 px-6 py-4">
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

interface ConfirmOptions {
  /** Ask the real question: "Delete this post?" — never "Are you sure?". */
  title: string;
  /** Say what actually happens, in her terms. Defaults to the undo warning. */
  description?: string;
  /** Name the action on the button ("Yes, delete it") so it reads on its own. */
  confirmLabel?: string;
  destructive?: boolean;
}

/**
 * Promise-based confirmation, so call sites read like the `window.confirm`
 * they replace:
 *
 *   if (!(await confirm({ title: "Delete this post?" }))) return;
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  ReactNode,
] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const dialog = (
    <Modal
      open={options !== null}
      // Covers Esc and the close button — both mean "cancel".
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={options?.title ?? ""}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => settle(false)}>
            Never mind
          </Button>
          <Button
            variant={options?.destructive ? "danger" : "primary"}
            size="sm"
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? "Yes, go ahead"}
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        {options?.destructive && (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-300">
            <AlertTriangle className="size-5" />
          </span>
        )}
        <p className="text-sm leading-relaxed text-ink-soft">
          {options?.description ?? "You won't be able to undo this."}
        </p>
      </div>
    </Modal>
  );

  return [confirm, dialog];
}
