import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Container } from "@/components/ui/Container";
import { Aurora } from "@/components/luxe/Aurora";
import { cn } from "@/lib/cn";

type Surface = "deep" | "base" | "raised";
type Space = "sm" | "md" | "lg" | "xl";

/** Three elevations only. More than three stops reading as a system. */
const SURFACE: Record<Surface, string> = {
  deep: "bg-night-deep",
  base: "bg-night",
  raised: "bg-night-raised",
};

/**
 * Vertical rhythm.
 *
 * Section padding is symmetric, so the visible gap between two sections is
 * double these numbers — the reason the first pass felt cavernous. `lg` at
 * py-40 meant a 320px void between blocks on desktop and turned the phone into
 * a ~22 screen scroll where a third of the travel was empty band. These values
 * still read generous (a 192px desktop gap at `lg`) without the page appearing
 * to have stalled. Airiness comes from measure and leading, not from gutters.
 *
 * Sections should not add their own large top margins on top of this; keep
 * internal gaps around mt-8/mt-10 so the scale stays the single source of
 * rhythm.
 *
 * `short:` is the wide-but-short window (see tailwind.config.js): desktop
 * gutters there are measured against a screen half the usual height.
 */
const SPACE: Record<Space, string> = {
  // Tightened again (Sep 2026): in a half-screen or zoomed window the sm tier is
  // what a laptop actually gets, and lg-into-xl there was a 176px void before
  // any decoration. The desktop tier keeps its air; the middle tier does not
  // need desktop gutters.
  // The generous tier starts at 2xl. A 1024-1535px window is as often a big
  // screen zoomed in or snapped to half as it is a small laptop, and 80px +
  // 96px between every pair of sections read there as the page having stalled.
  // Tightened once more (19 Sep 2026): measured on /club, every boundary was a
  // uniform 96-101px of nothing on a phone and 133px on a laptop — 17 of them
  // in a row is what reads as "a gap". A phone now gets 72px at `lg`.
  sm: "py-6 sm:py-8 lg:py-10 2xl:py-12 short:py-6",
  md: "py-8 sm:py-9 lg:py-11 2xl:py-14 short:py-8",
  lg: "py-9 sm:py-10 lg:py-12 2xl:py-16 short:py-9",
  xl: "py-10 sm:py-12 lg:py-14 2xl:py-20 short:py-10",
};

interface SectionProps {
  id?: string;
  surface?: Surface;
  space?: Space;
  aurora?: React.ComponentProps<typeof Aurora>["tone"] | false;
  auroraIntensity?: number;
  /** Hairline seam along the top edge. Default on — it is the page's rhythm. */
  seam?: boolean;
  className?: string;
  containerClassName?: string;
  /** Escape hatch for full-bleed sections that lay out their own container. */
  bleed?: boolean;
  /**
   * Full-bleed decoration painted behind the container — a photograph and the
   * veil over it. It sits outside the container on purpose: the container is
   * measured and padded, and a background must not be.
   *
   * A band that carries media is dark in BOTH themes, so pass
   * `data-media-surface` alongside it (see site-theme.css): it puts the night
   * palette back inside the section, which is what keeps a token-based veil
   * dark and white type white when the site is in its light theme.
   */
  backdrop?: ReactNode;
  "aria-label"?: string;
  /** Restores the night palette inside this section on the light theme. */
  "data-media-surface"?: boolean;
  /**
   * Narration markers for the voice concierge (see voice/contract.ts). They are
   * declared here rather than reached through a wrapper because `rest` already
   * lands on the `<section>` element, and a band the agent should read aloud —
   * or skip, as a scrolling logo strip should be — is a property of the section
   * itself.
   */
  "data-narrate"?: string;
  "data-narrate-label"?: string;
  "data-narrate-skip"?: string;
  children: ReactNode;
}

export function Section({
  id,
  surface = "base",
  space = "md",
  aurora = false,
  auroraIntensity = 1,
  seam = true,
  className,
  containerClassName,
  bleed = false,
  backdrop,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn("relative overflow-hidden", SURFACE[surface], SPACE[space], className)}
      {...rest}
    >
      {seam && (
        <div aria-hidden className="rule-faint absolute inset-x-0 top-0 z-[1] w-full" />
      )}
      {aurora && <Aurora tone={aurora} intensity={auroraIntensity} />}
      {backdrop}
      {bleed ? (
        <div className="relative z-[1]">{children}</div>
      ) : (
        <Container className={cn("relative z-[1]", containerClassName)}>{children}</Container>
      )}
    </section>
  );
}

/* ── Section header ──────────────────────────────────────────────────── */

interface SectionTitleProps {
  eyebrow?: string;
  /** Plain string, or JSX when part of the line is foiled/italic. */
  title: ReactNode;
  body?: ReactNode;
  align?: "left" | "center";
  rule?: boolean;
  className?: string;
  titleClassName?: string;
}

export function SectionTitle({
  eyebrow,
  title,
  body,
  align = "center",
  rule = true,
  className,
  titleClassName,
}: SectionTitleProps) {
  const reduce = useEntranceMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
      transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}
    >
      {eyebrow && <span className="eyebrow-luxe">{eyebrow}</span>}
      <h2
        className={cn(
          "text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem] lg:text-[3.1rem]",
          titleClassName,
        )}
      >
        {title}
      </h2>
      {body && <p className="copy-luxe mt-5 text-balance">{body}</p>}
      {rule && (
        <GoldRule className={cn("mt-6 sm:mt-8", align === "center" ? "mx-auto" : "")} />
      )}
    </motion.div>
  );
}

/** The brand's divider: a foil hairline that dissolves at both ends. */
export function GoldRule({ className, width = "w-20" }: { className?: string; width?: string }) {
  return <div aria-hidden className={cn("rule-gold", width, className)} />;
}
