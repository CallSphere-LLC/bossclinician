import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface MarqueeProps {
  children: ReactNode;
  /** Seconds for one full pass. Longer = calmer. */
  duration?: number;
  className?: string;
}

/**
 * Seamless horizontal ticker.
 *
 * The track holds the content twice and translates -50%, so the loop point
 * lands on an identical frame — no snap. The duplicate is `aria-hidden` and
 * the whole strip pauses on hover so a reader can actually read it.
 */
export function Marquee({ children, duration = 38, className }: MarqueeProps) {
  return (
    <div className={cn("marquee-mask group relative overflow-hidden", className)}>
      <div
        className="animate-marquee flex w-max will-change-transform group-hover:[animation-play-state:paused]"
        style={{ animationDuration: `${duration}s` }}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
