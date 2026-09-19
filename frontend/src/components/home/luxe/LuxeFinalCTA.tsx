import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

// /freedom-masterclass does not exist as a route yet (the server 301s it to
// /resources, where the masterclass is actually hosted), so the button goes
// straight there. Repoint it when the dedicated route ships.
const MASTERCLASS_ROUTE = "/resources";
const QUIZ_ROUTE = "/practice-quiz";

/**
 * One rise recipe for the closing stack; only the delay changes. Reduced-motion
 * users get `initial={false}` — the final state on mount, never a blank element
 * waiting on an observer.
 */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 30 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

/**
 * The last frame of the film.
 *
 * The page's other sections are lit from the edges by drifting aurora. This one
 * adds a fixed, very wide pool of gold low in the frame plus a tighter specular
 * streak across it, so the headline sits on a horizon of light rather than on
 * flat black — the visual equivalent of a rising note at the end of a score. A
 * transparent-to-night-deep wash at the true bottom edge then extinguishes both
 * the aurora and the horizon so the section hands off to the footer cleanly
 * instead of leaking glow under it.
 */
export function LuxeFinalCTA() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="mixed"
      auroraIntensity={1.2}
      aria-label="Every stage has a next step"
      containerClassName="max-w-4xl text-center"
    >
      <div className="relative">
        {/* ── Horizon of light ───────────────────────────────────────────────
            Both layers are anchored to the content, not the section, so they
            stay put beneath the type while the aurora behind them drifts. They
            dawn on a long fade rather than snapping in with the copy. */}
        <motion.div
          aria-hidden
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 1.8, ease: EASE_LUXE }}
          className="pointer-events-none absolute left-1/2 top-[70%] -z-10 h-[24rem] w-[min(200%,60rem)] -translate-x-1/2 -translate-y-1/2 sm:h-[32rem]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(201,164,106,0.22) 0%, rgba(201,164,106,0.08) 34%, rgba(123,94,167,0.07) 56%, transparent 74%)",
          }}
        />
        <motion.div
          aria-hidden
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 2.2, delay: reduce ? 0 : 0.3, ease: EASE_LUXE }}
          className="pointer-events-none absolute left-1/2 top-[78%] -z-10 h-[8rem] w-[min(240%,76rem)] -translate-x-1/2 -translate-y-1/2 blur-[3px]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(232,206,154,0.17) 0%, rgba(201,164,106,0.06) 38%, transparent 70%)",
          }}
        />

        <motion.span {...rise(reduce, 0.04)} className="eyebrow-luxe">
          EVERY STAGE HAS A NEXT STEP. THIS IS YOURS.
        </motion.span>

        {/* The largest type on the page. Both lines live in one h2 so the
            section keeps a single heading; the spans carry the stagger. */}
        <h2 className="text-balance font-display text-[2.6rem] font-normal leading-[1.02] tracking-tight text-white sm:text-[4.2rem] lg:text-[5.6rem]">
          <motion.span {...rise(reduce, 0.14)} className="block">
            Build it. Sustain it.
          </motion.span>
          <motion.span
            {...rise(reduce, 0.28)}
            className="text-foil mt-1 block font-display italic sm:mt-1.5"
          >
            Lead it.
          </motion.span>
        </h2>

        <motion.p {...rise(reduce, 0.44)} className="copy-luxe mx-auto mt-8 max-w-xl text-pretty">
          Wherever you are in practice ownership, the goal is the same: a practice that supports
          your income, your energy, and your future, without depending on you for everything. Start
          with the stage you are in.
        </motion.p>

        <motion.div
          {...rise(reduce, 0.58)}
          className="mt-8 flex flex-wrap items-center justify-center gap-4"
        >
          <LuxeButton variant="foil" size="lg" href="#offers">
            Find Your Path
          </LuxeButton>
          <LuxeButton variant="outline" size="lg" to={MASTERCLASS_ROUTE}>
            Watch the Free Masterclass
          </LuxeButton>
        </motion.div>

        {/* Flex rather than an inline link: `quiet` renders as an inline-flex
            box, and laying the sentence out as flex items is what lets the link
            carry a 44px tap target without disturbing the line above it. */}
        <motion.p
          {...rise(reduce, 0.7)}
          className="mt-8 flex flex-wrap items-center justify-center gap-x-2.5 text-sm text-orchid-faint"
        >
          Not sure where you fit?
          <LuxeButton
            variant="quiet"
            to={QUIZ_ROUTE}
            className="min-h-[44px] text-[0.72rem] tracking-[0.14em]"
          >
            Take the 2-minute quiz →
          </LuxeButton>
        </motion.p>

        {/* Bottom hand-off. The offsets mirror the section's own vertical
            padding (py-28 / sm:py-40 / lg:py-52) so the wash lands exactly on
            the section's bottom edge, and w-screen carries it past the
            max-w-4xl container to the full bleed the fade needs. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 left-1/2 -z-10 h-44 w-screen -translate-x-1/2 bg-gradient-to-b from-transparent via-night-deep/75 via-[58%] to-night-deep sm:-bottom-40 lg:-bottom-52"
        />
      </div>
    </Section>
  );
}
