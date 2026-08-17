import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "light"
  | "gold"
  | "green"
  | "plum"
  | "outline-light";
type Size = "md" | "lg" | "sm";

/**
 * Re-skinned for the dark theme, API unchanged.
 *
 * Every page still calls `<Button variant="gold">` / `"secondary"` / etc., so
 * mapping the existing variant names onto the luxe materials re-themes ~40
 * call sites without touching them. `primary` had to change most: it was
 * `bg-dark` (navy on cream) and would now paint night-deep on night-deep — an
 * invisible button.
 */
const variantClasses: Record<Variant, string> = {
  primary: "sheen-host bg-gold-foil font-bold text-night-deep shadow-[0_14px_36px_-14px_rgba(201,164,106,0.6)]",
  gold: "sheen-host bg-gold-foil font-bold text-night-deep shadow-[0_14px_36px_-14px_rgba(201,164,106,0.6)]",
  secondary: "border border-white/25 bg-transparent text-white/85 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
  "outline-light": "border border-white/25 bg-transparent text-white/85 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
  light: "glass-soft text-white/90 hover:border-gold/45 hover:bg-white/[0.075] hover:text-white",
  ghost: "bg-transparent text-orchid underline-offset-[6px] hover:text-gold hover:underline",
  green: "border border-green-bright/40 bg-green-bright/[0.12] text-green-bright hover:bg-green-bright/20",
  plum: "border border-plum-bright/45 bg-plum-bright/[0.16] text-lilac hover:bg-plum-bright/25",
};

// min-h keeps every button a comfortable touch target on a phone.
const sizeClasses: Record<Size, string> = {
  sm: "min-h-[2.75rem] px-6 py-3 text-[0.7rem] tracking-[0.16em]",
  md: "min-h-[2.75rem] px-8 py-3.5 text-[0.74rem] tracking-[0.18em]",
  lg: "min-h-[3rem] px-9 py-4 text-[0.78rem] tracking-[0.2em]",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

type ConflictingHandlers =
  | "className"
  | "children"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

interface ButtonAsButton
  extends CommonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, ConflictingHandlers> {
  to?: undefined;
  href?: undefined;
}

interface ButtonAsLink extends CommonProps {
  to: string;
  href?: undefined;
  onClick?: () => void;
}

interface ButtonAsAnchor extends CommonProps {
  href: string;
  to?: undefined;
  target?: string;
  rel?: string;
  onClick?: () => void;
}

type Props = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

export function Button(props: Props) {
  const { variant = "primary", size = "md", className, children } = props;
  const classes = cn(
    "group relative inline-flex items-center justify-center gap-2 rounded-full font-semibold uppercase",
    "transition-all duration-300 ease-luxe",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );

  const motionProps = {
    whileHover: { y: -2 },
    whileTap: { y: 0 },
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const },
  };

  if ("to" in props && props.to) {
    return (
      <motion.div {...motionProps} className="inline-block">
        <Link to={props.to} onClick={props.onClick} className={classes}>
          {children}
        </Link>
      </motion.div>
    );
  }

  if ("href" in props && props.href) {
    return (
      <motion.div {...motionProps} className="inline-block">
        <a
          href={props.href}
          target={props.target}
          rel={props.rel}
          onClick={props.onClick}
          className={classes}
        >
          {children}
        </a>
      </motion.div>
    );
  }

  const { variant: _v, size: _s, className: _c, children: _ch, to: _to, href: _href, ...buttonProps } =
    props as ButtonAsButton;

  return (
    <motion.button {...motionProps} className={classes} {...buttonProps}>
      {children}
    </motion.button>
  );
}
