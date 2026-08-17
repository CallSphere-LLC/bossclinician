import { useId, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { cn } from "@/lib/cn";

/**
 * The wrapper every rail panel shares.
 *
 * Each panel loads on its own, so each needs its own way of saying "still
 * fetching" and "that failed" without the other three disappearing with it.
 * Keeping the three states in one place is what stops the events panel and the
 * leaderboard drifting into two different ideas of what a loading rail looks
 * like — and `spotlight={false}` because a cursor-tracked highlight on four
 * stacked panels is four pointer handlers doing nothing anyone asked for.
 */

interface SidebarPanelProps {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  error?: string;
  /** Rendered instead of children when the panel loaded and has nothing in it. */
  empty?: string;
  isEmpty?: boolean;
  children?: ReactNode;
  className?: string;
}

export function SidebarPanel({
  title,
  icon,
  action,
  loading = false,
  error = "",
  empty,
  isEmpty = false,
  children,
  className,
}: SidebarPanelProps) {
  const headingId = useId();

  return (
    <GlassCard
      as="section"
      spotlight={false}
      interactive={false}
      className={cn("p-5", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={headingId}
          className="flex items-center gap-2 font-display text-[1.05rem] leading-none text-white"
        >
          {icon}
          {title}
        </h2>
        {action}
      </div>

      <div aria-live="polite" className="mt-4">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading…
          </p>
        )}
        {!loading && error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!loading && !error && isEmpty && empty && (
          <p className="text-sm leading-relaxed text-orchid-dim">{empty}</p>
        )}
        {!loading && !error && !isEmpty && children}
      </div>
    </GlassCard>
  );
}
