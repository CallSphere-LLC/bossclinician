import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

// Kept for backwards-compat with any imports elsewhere.
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
export const staggerItem = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol";
}

/**
 * Container that reveals its children with a staggered fade/slide-in.
 *
 * IMPORTANT: reveal is driven per-item (each RevealItem runs its own
 * `whileInView`), NOT by parent variant orchestration. Parent-orchestrated
 * `whileInView + once` breaks when children are swapped in asynchronously
 * (e.g. useCollection replacing fallback data with API data): the newly
 * mounted children never receive the "show" signal and stay at opacity 0
 * ("loads then vanishes"). Per-item triggers reveal late-mounting items too.
 */
export function RevealGroup({ children, className, as = "div" }: RevealProps) {
  const MotionTag = motion[as];
  let i = 0;
  return (
    <MotionTag className={cn(className)}>
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child as React.ReactElement<{ index?: number }>, {
              index: i++,
            })
          : child,
      )}
    </MotionTag>
  );
}

interface RevealItemProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
  /** Injected by RevealGroup for staggering; also settable directly. */
  index?: number;
}

export function RevealItem({
  children,
  className,
  as = "div",
  index = 0,
}: RevealItemProps) {
  const MotionTag = motion[as];
  const reduce = useReducedMotion();

  return (
    <MotionTag
      // `initial={false}` under reduced motion means the element mounts in its
      // final state instead of at opacity 0 waiting for an observer that the
      // reduced-motion path never needs. Without it, "no animation" turns into
      // "permanently invisible" for anyone with the OS setting on.
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{
        duration: reduce ? 0 : 0.55,
        delay: reduce ? 0 : Math.min(index, 8) * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(className)}
    >
      {children}
    </MotionTag>
  );
}
