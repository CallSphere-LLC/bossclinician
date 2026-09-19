import { useCallback, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Accent = "gold" | "plum" | "green" | "neutral";

/** RGB triplets feed the `--spot` custom property consumed by `.spotlight`. */
const SPOT: Record<Accent, string> = {
  gold: "201, 164, 106",
  plum: "141, 110, 190",
  green: "107, 168, 145",
  neutral: "185, 162, 214",
};

/** Tint pushed into the glass gradient itself, so accents read at rest too. */
const TINT: Record<Accent, string> = {
  gold: "222, 196, 150",
  plum: "160, 132, 210",
  green: "128, 190, 166",
  neutral: "255, 255, 255",
};

const HOVER_RING: Record<Accent, string> = {
  gold: "hover:shadow-glow-gold",
  plum: "hover:shadow-glow-plum",
  green: "hover:shadow-glow-green",
  neutral: "hover:shadow-glass-lg",
};

interface GlassCardProps {
  as?: ElementType;
  accent?: Accent;
  /** Cursor-tracked radial highlight. Off for large static panels. */
  spotlight?: boolean;
  /** Lift + accent ring on hover. Off for non-interactive panels. */
  interactive?: boolean;
  className?: string;
  style?: CSSProperties;
  /**
   * Narration markers for the voice concierge (see voice/contract.ts). A card is
   * the unit the page reader and the pointer both want to treat as one thing —
   * a stat tile, a plan, an account area — so the markers belong on the card
   * rather than on something wrapped around it.
   */
  "data-narrate"?: string;
  "data-narrate-label"?: string;
  "data-narrate-skip"?: string;
  children: ReactNode;
}

/**
 * The page's one card material.
 *
 * Every panel on the dark theme is this component — the recipe (blur, tinted
 * gradient, masked gradient edge, ambient shadow, inner top highlight) lives
 * in `.glass`/`.glass-edge` in index.css so a dozen sections can't drift
 * apart. Accent only shifts colour; geometry and depth stay identical.
 */
export function GlassCard({
  as: Tag = "div",
  accent = "neutral",
  spotlight = true,
  interactive = true,
  className,
  style,
  children,
  ...narration
}: GlassCardProps) {
  // Pointer position is written straight to CSS custom properties rather than
  // React state: hover must not re-render a card that contains an entire
  // section's worth of copy.
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <Tag
      {...narration}
      onPointerMove={spotlight ? onPointerMove : undefined}
      style={
        {
          "--spot": SPOT[accent],
          "--glass-tint": TINT[accent],
          ...style,
        } as CSSProperties
      }
      className={cn(
        "glass glass-edge relative isolate rounded-2xl",
        spotlight && "spotlight",
        interactive &&
          cn(
            "transition-[transform,box-shadow] duration-500 ease-luxe hover:-translate-y-1.5",
            HOVER_RING[accent],
          ),
        className,
      )}
    >
      {children}
    </Tag>
  );
}
