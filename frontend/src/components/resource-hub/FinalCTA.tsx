import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { finalCtaLinks } from "@/content/resourceHub";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * Only the Boardroom application carries foil — one primary action per band.
 * The two memberships are glass, which is the page's secondary weight, so the
 * three CTAs still read as a set rather than as three competing primaries.
 */
const VARIANT = {
  gold: "foil",
  green: "glass",
  plum: "glass",
} as const;

/** One rise recipe for the closing stack; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/**
 * The last frame. Every other band is lit from the edges by drifting aurora;
 * this one adds a fixed pool of gold low in the frame so the headline sits on a
 * horizon of light rather than on flat black.
 */
export function FinalCTA() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="mixed"
      auroraIntensity={1.1}
      aria-label="Ready to go beyond free resources?"
      containerClassName="max-w-4xl text-center"
    >
      <div className="relative">
        <motion.div
          aria-hidden
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 1.8, ease: EASE }}
          className="pointer-events-none absolute left-1/2 top-[74%] -z-10 h-[22rem] w-[min(200%,58rem)] -translate-x-1/2 -translate-y-1/2 sm:h-[30rem]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(201,164,106,0.22) 0%, rgba(201,164,106,0.08) 34%, rgba(123,94,167,0.07) 56%, transparent 74%)",
          }}
        />

        <motion.span {...rise(reduce, 0.04)} className="eyebrow-luxe">
          Ready to go beyond free resources?
        </motion.span>

        {/* Both sentences live in one h2 so the section keeps a single heading;
            the spans only carry the stagger and the change of voice. */}
        <h2 className="text-balance font-display font-normal leading-[1.06] tracking-tight text-white">
          <motion.span
            {...rise(reduce, 0.14)}
            className="block text-[2.1rem] sm:text-[3rem] lg:text-[3.6rem]"
          >
            Find your community.
          </motion.span>
          <motion.span
            {...rise(reduce, 0.26)}
            className="text-foil mt-1.5 block font-display text-[2rem] italic sm:text-[2.9rem] lg:text-[3.5rem]"
          >
            Build your legacy.
          </motion.span>
        </h2>

        <motion.div
          {...rise(reduce, 0.4)}
          className="mt-10 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:flex-wrap sm:items-center"
        >
          {finalCtaLinks.map((link) => (
            <LuxeButton
              key={link.label}
              to={link.to}
              variant={VARIANT[link.variant]}
              size="md"
              className="min-h-[44px] tracking-[0.12em] sm:tracking-[0.18em]"
            >
              {link.label}
            </LuxeButton>
          ))}
        </motion.div>

        {/* Bottom hand-off. The offsets mirror the section's own vertical
            padding (py-16 / sm:py-24 / lg:py-32) so the wash lands exactly on
            the section's bottom edge, and w-screen carries it past the
            max-w-4xl container to the full bleed the fade needs. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 left-1/2 -z-10 h-32 w-screen -translate-x-1/2 bg-gradient-to-b from-transparent via-night-deep/75 via-[58%] to-night-deep sm:-bottom-24 lg:-bottom-32"
        />
      </div>
    </Section>
  );
}
