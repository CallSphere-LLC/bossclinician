import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

type Variant = "foil" | "glass" | "outline" | "quiet";
type Size = "sm" | "md" | "lg";

/**
 * `foil` is the page's single primary action — brushed gold with a specular
 * sweep on hover. `glass` is the secondary; `outline` the tertiary; `quiet`
 * is an inline text action. Anything beyond four weights stops being a
 * hierarchy and starts being noise.
 */
const VARIANT: Record<Variant, string> = {
  foil: cn(
    "sheen-host bg-gold-foil text-night-deep font-bold",
    "shadow-[0_14px_36px_-14px_rgba(201,164,106,0.65)]",
    "hover:shadow-[0_20px_50px_-14px_rgba(201,164,106,0.85)]",
  ),
  glass: cn(
    "glass-soft text-white/90",
    "hover:border-gold/45 hover:bg-white/[0.075] hover:text-white",
  ),
  outline: cn(
    "border border-white/25 text-white/85",
    "hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
  ),
  quiet: "text-orchid hover:text-gold underline underline-offset-[6px] decoration-white/20 hover:decoration-gold/60",
};

const SIZE: Record<Size, string> = {
  sm: "px-6 py-3 text-[0.7rem] tracking-[0.16em]",
  md: "px-8 py-4 text-[0.74rem] tracking-[0.18em]",
  lg: "px-10 py-[1.15rem] text-[0.78rem] tracking-[0.2em]",
};

interface Common {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

type Clash =
  | "className"
  | "children"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

interface AsButton extends Common, Omit<ButtonHTMLAttributes<HTMLButtonElement>, Clash> {
  to?: undefined;
  href?: undefined;
}
interface AsLink extends Common {
  to: string;
  href?: undefined;
  onClick?: () => void;
}
interface AsAnchor extends Common {
  href: string;
  to?: undefined;
  target?: string;
  rel?: string;
  onClick?: () => void;
}

type Props = AsButton | AsLink | AsAnchor;

export function LuxeButton(props: Props) {
  const { variant = "foil", size = "md", className, children } = props;

  const classes = cn(
    "group relative inline-flex items-center justify-center gap-2.5 rounded-full",
    "font-semibold uppercase transition-all duration-300 ease-luxe",
    "hover:-translate-y-0.5 active:translate-y-0",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
    "disabled:pointer-events-none disabled:opacity-50",
    variant !== "quiet" && SIZE[size],
    VARIANT[variant],
    className,
  );

  // The label sits above the sheen pseudo-element, which is z-index 1.
  const inner = <span className="relative z-[2] inline-flex items-center gap-2.5">{children}</span>;

  if ("to" in props && props.to) {
    return (
      <Link to={props.to} onClick={props.onClick} className={classes}>
        {inner}
      </Link>
    );
  }

  if ("href" in props && props.href) {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel ?? (props.target === "_blank" ? "noopener noreferrer" : undefined)}
        onClick={props.onClick}
        className={classes}
      >
        {inner}
      </a>
    );
  }

  const {
    variant: _v,
    size: _s,
    className: _c,
    children: _ch,
    to: _to,
    href: _h,
    ...rest
  } = props as AsButton;

  return (
    <button className={classes} {...rest}>
      {inner}
    </button>
  );
}

/** Small uppercase pill used for credentials, tags and audience labels. */
export function LuxePill({
  children,
  className,
  accent = "neutral",
}: {
  children: ReactNode;
  className?: string;
  accent?: "neutral" | "gold" | "plum" | "green";
}) {
  const tone = {
    neutral: "border-white/12 bg-white/[0.045] text-orchid",
    gold: "border-gold/30 bg-gold/[0.09] text-gold",
    plum: "border-plum-bright/35 bg-plum-bright/[0.12] text-lilac",
    green: "border-green-bright/30 bg-green-bright/[0.10] text-green-bright",
  }[accent];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3.5 py-1.5",
        "text-[0.64rem] font-semibold uppercase tracking-[0.16em]",
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}
