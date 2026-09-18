import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Container } from "@/components/ui/Container";
import { Aurora } from "@/components/luxe/Aurora";
import { GoldRule } from "@/components/luxe/Section";
import { KineticText } from "@/components/luxe/KineticText";
import { cn } from "@/lib/cn";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface LuxePageHeroProps {
  eyebrow?: string;
  /** Plain white portion of the headline. */
  title: string;
  /** Optional second line, set in foil italic. */
  titleAccent?: string;
  lede?: ReactNode;
  /** Buttons / chips rendered under the lede. */
  actions?: ReactNode;
  /** Extra content (image, stat row) placed in a right-hand column at lg. */
  aside?: ReactNode;
  tone?: React.ComponentProps<typeof Aurora>["tone"];
  align?: "left" | "center";
  className?: string;
}

/**
 * The entry band every interior page opens with.
 *
 * One component rather than a per-page hero so depth reads consistently: the
 * user always lands on the same eyebrow → foil headline → rule → lede
 * structure, and only the copy changes. It also guarantees the sticky header
 * always has a dark, tall band beneath it on every route.
 */
export function LuxePageHero({
  eyebrow,
  title,
  titleAccent,
  lede,
  actions,
  aside,
  tone = "violet",
  align = "left",
  className,
}: LuxePageHeroProps) {
  const reduce = useEntranceMotion();
  const centered = align === "center" && !aside;

  return (
    <section
      className={cn("relative overflow-hidden bg-night-deep", className)}
      aria-label="Page header"
    >
      <Aurora tone={tone} intensity={0.85} />
      {/* Hands off to whatever surface the next section uses without a seam. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-night"
      />

      <Container className="relative z-[1] py-14 sm:py-16 lg:py-20 2xl:py-28 short:py-14">
        <div
          className={cn(
            aside && "grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16",
          )}
        >
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
            className={cn(centered && "mx-auto max-w-3xl text-center")}
          >
            {eyebrow && <span className="eyebrow-luxe">{eyebrow}</span>}

            <h1 className="text-balance font-display text-[2.4rem] font-normal leading-[1.06] tracking-[-0.015em] text-white sm:text-[3.2rem] lg:text-[3.9rem]">
              <KineticText text={title} immediate delay={0.12} />
              {titleAccent && (
                <span className="text-foil mt-1.5 block font-display italic">
                  <KineticText text={titleAccent} immediate delay={0.34} />
                </span>
              )}
            </h1>

            <GoldRule className={cn("mt-8", centered && "mx-auto")} />

            {lede && (
              <p
                className={cn(
                  "copy-luxe mt-7 text-pretty sm:text-[1.05rem]",
                  centered ? "mx-auto max-w-2xl" : "max-w-[46rem]",
                )}
              >
                {lede}
              </p>
            )}

            {actions && (
              <div
                className={cn(
                  "mt-10 flex flex-wrap items-center gap-4",
                  centered && "justify-center",
                )}
              >
                {actions}
              </div>
            )}
          </motion.div>

          {aside && (
            <motion.div
              initial={reduce ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, delay: reduce ? 0 : 0.15, ease: EASE }}
            >
              {aside}
            </motion.div>
          )}
        </div>
      </Container>
    </section>
  );
}
