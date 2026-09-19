import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, GoldRule } from "@/components/luxe/Section";
import { cn } from "@/lib/cn";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

interface Paragraph {
  text: string;
  className: string;
  delay: number;
}

const PARAGRAPHS: readonly Paragraph[] = [
  {
    text: "Your income still depends too heavily on your clinical hours. Taking time off feels expensive. You're carrying too many roles. And as your practice grows, the decisions get bigger, but nobody taught you how to build a business that can evolve with your life and career.",
    // Larger and brighter than its sibling: this is the accusation, and it has
    // to land before the reassurance does.
    className: "mt-10 text-[1.05rem] leading-[1.9] text-orchid sm:text-[1.15rem]",
    delay: 0.52,
  },
  {
    text: "Whether you're just starting, completely maxed out, or leading a team, the answer is the same: structure, strategy, and the right community for the stage you are in.",
    // Ranked second by size alone. `orchid-dim` (the .copy-luxe default) is the
    // darkest body colour that still clears 4.5:1 on night-deep, so buying more
    // hierarchy by dimming further is not on the table.
    className: "mt-6 text-[0.9rem] sm:text-[0.95rem]",
    delay: 0.62,
  },
];

/**
 * One rise recipe for the whole stack; only the delay changes. Reduced-motion
 * users get `initial={false}`, i.e. the final state on mount — never a blank
 * element waiting on an observer.
 */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 26 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.9, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

/**
 * The page's emotional pivot. Pure typography, no cards, no call to action —
 * the reader is meant to sit in the question, not be sold to inside it.
 */
export function LuxeKeepItReal() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="violet"
      auroraIntensity={1}
      aria-label="Who this is for"
      containerClassName="max-w-4xl text-center"
    >
      {/* Hairline dropping in from above: the curtain-raise that tells the eye
          a different kind of moment is starting. */}
      <motion.span
        aria-hidden
        initial={reduce ? false : { opacity: 0, scaleY: 0 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 1.1, ease: EASE_LUXE }}
        className="mx-auto mb-8 hidden h-12 w-px origin-top bg-gradient-to-b from-transparent to-ink/25 2xl:block"
      />

      <motion.span {...rise(reduce, 0.08)} className="eyebrow-luxe">
        THIS IS A KEEP IT REAL ZONE.
      </motion.span>

      <h2 className="relative text-balance font-display font-medium text-white">
        {/* Violet bloom sitting behind the type only — the section-wide aurora
            drifts, so the headline needs its own fixed pool of light to be lit
            from rather than merely placed on black. */}
        <motion.span
          aria-hidden
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 1.6, delay: reduce ? 0 : 0.15, ease: EASE_LUXE }}
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[150%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(123,94,167,0.20) 0%, transparent 68%)",
          }}
        />

        <motion.span
          {...rise(reduce, 0.2)}
          className="relative block text-[2.1rem] leading-[1.08] sm:text-[3.2rem] lg:text-[4.2rem] lg:tracking-[-0.015em]"
        >
          You became a therapist to build a career on your terms.
        </motion.span>

        <motion.span
          {...rise(reduce, 0.32)}
          className="text-foil relative mt-3 block font-display italic text-[1.95rem] leading-[1.12] sm:text-[3rem] lg:text-[3.95rem] lg:tracking-[-0.015em]"
        >
          So why does running your practice still feel like someone else is in charge?
        </motion.span>
      </h2>

      {/* Drawn open from the centre rather than faded in: a hairline that grows
          reads as a ruled line on a page, not as a shape appearing. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, scaleX: 0 }}
        whileInView={{ opacity: 1, scaleX: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 1, delay: reduce ? 0 : 0.44, ease: EASE_LUXE }}
        className="mx-auto mt-10 w-20 origin-center"
      >
        <GoldRule width="w-full" />
      </motion.div>

      {PARAGRAPHS.map((paragraph) => (
        <motion.p
          key={paragraph.text}
          {...rise(reduce, paragraph.delay)}
          className={cn("copy-luxe mx-auto max-w-2xl text-pretty", paragraph.className)}
        >
          {paragraph.text}
        </motion.p>
      ))}

      {/* Mirror of the opening hairline, carrying the thought down the page. */}
      <motion.span
        aria-hidden
        initial={reduce ? false : { opacity: 0, scaleY: 0 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 1.1, delay: reduce ? 0 : 0.75, ease: EASE_LUXE }}
        className="mx-auto mt-8 hidden h-12 w-px origin-top bg-gradient-to-b from-ink/20 to-transparent 2xl:block"
      />
    </Section>
  );
}
