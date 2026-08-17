import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/12 bg-white/[0.045] px-3.5 py-1.5",
        "text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-orchid",
        className,
      )}
    >
      {children}
    </span>
  );
}
