import { motion, useReducedMotion } from "motion/react";
import { Marquee } from "@/components/luxe/Marquee";
import { cn } from "@/lib/cn";

const CREDENTIALS = [
  "MULTI-6-FIGURE GROUP PRACTICE OWNER",
  "DOCTORAL CANDIDATE",
  "LCSW",
  "PRIVATE PRACTICE STRATEGIST",
] as const;

/**
 * Marquee duplicates the track once and translates -50%, so the loop only
 * reads as seamless while a single un-duplicated pass is wider than the
 * viewport. Four short credentials measure ~1100px; three passes clears
 * 1920px with room to spare.
 */
const PASSES = 3;

/**
 * Authority strip directly beneath the hero.
 *
 * Deliberately a whisper: one thin band, hairlines top and bottom, ~58px tall.
 * The credentials scroll rather than wrap, which keeps the band a fixed height
 * at 390px instead of stacking into a four-line block.
 */
export function LuxeCredBar({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      role="region"
      aria-label="Credentials"
      initial={reduce ? false : { opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className={cn("relative isolate bg-night-raised", className)}
    >
      <div aria-hidden className="rule-faint absolute inset-x-0 top-0 z-[2] w-full" />

      {/* Light spilling down from the hero, so the band reads as lit from above
          rather than as a flat inserted stripe. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(120% 150% at 50% -45%, rgba(123,94,167,0.16), transparent 62%)",
        }}
      />

      <Marquee duration={42} className="relative z-[1] py-[1.15rem] sm:py-5">
        {Array.from({ length: PASSES }, (_, pass) => (
          <ul
            key={pass}
            className="flex shrink-0 items-center"
            // Only the first pass is exposed; the rest (and Marquee's own clone)
            // are visual filler, so a screen reader hears the list exactly once.
            aria-hidden={pass > 0 || undefined}
          >
            {CREDENTIALS.map((credential) => (
              <li
                key={credential}
                className="flex items-center gap-5 pr-5 sm:gap-7 sm:pr-7"
              >
                <span aria-hidden className="text-[0.55rem] leading-none text-gold/60">
                  ◆
                </span>
                {/* Wide tracking is what makes this strip read as engraved, but
                    at 0.68rem on a phone it costs more legibility than it buys.
                    Larger + tighter below sm, the editorial setting from sm up. */}
                <span className="whitespace-nowrap text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-orchid-dim transition-colors duration-500 ease-luxe hover:text-gold sm:text-[0.68rem] sm:tracking-[0.24em]">
                  {credential}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </Marquee>

      <div aria-hidden className="rule-faint absolute inset-x-0 bottom-0 z-[2] w-full" />
    </motion.div>
  );
}
