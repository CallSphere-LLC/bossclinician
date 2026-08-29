import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * One rise recipe for the stack; only the delay changes.
 *
 * `animate` rather than `whileInView`: this page is a single screen that is
 * already in frame on mount, and it is also rendered inline by BlogPost for a
 * missing slug — an observer-driven reveal there could land on an element that
 * never crosses the threshold. Reduced-motion users get `initial={false}`, i.e.
 * the final state on mount rather than a permanently invisible page.
 */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

/**
 * 404 — the dead-end, dressed.
 *
 * A wrong URL is still a brand moment, so the page gets the same material as
 * the rest of the site: aurora behind, foil numerals as the one gold accent,
 * and two ways out (home, or the page that actually sells). `min-h` on the
 * container keeps the footer at the bottom of the screen instead of floating
 * halfway up it on a desktop monitor.
 */
export default function NotFound() {
  const reduce = useEntranceMotion();

  return (
    <>
      {/* The status is the point: a dead URL that answers 200 stays in the
          index forever, and BlogPost renders this panel inline for a slug that
          exists nowhere, so the page is the only thing that knows. `noindex`
          covers the crawler that reaches it anyway. */}
      <Seo title="Page Not Found | Boss Clinician" httpStatus={404} noindex />

      <Section
        surface="deep"
        space="lg"
        aurora="violet"
        auroraIntensity={0.9}
        seam={false}
        aria-label="Page not found"
        containerClassName="flex min-h-[58vh] max-w-3xl flex-col items-center justify-center text-center"
      >
        <motion.div {...rise(reduce, 0)} className="relative">
          {/* Pool of light directly under the numerals so they read as lit
              metal rather than as a gradient pasted on flat black. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[13rem] w-[min(88vw,32rem)] -translate-x-1/2 -translate-y-1/2 sm:h-[17rem]"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(201,164,106,0.18) 0%, rgba(123,94,167,0.11) 44%, transparent 72%)",
            }}
          />
          <p className="text-foil relative font-display text-[4.5rem] font-normal italic leading-[0.95] tracking-[-0.01em] sm:text-[6.5rem] lg:text-[8rem]">
            404
          </p>
        </motion.div>

        <motion.div {...rise(reduce, 0.12)}>
          <GoldRule className="mt-8" />
        </motion.div>

        <motion.h1
          {...rise(reduce, 0.2)}
          className="mt-8 text-balance font-display text-[1.9rem] font-normal leading-[1.12] tracking-[-0.01em] text-white sm:text-[2.6rem] lg:text-[3rem]"
        >
          Looks like this page took a leap without a plan.
        </motion.h1>

        <motion.p {...rise(reduce, 0.3)} className="copy-luxe mt-6 max-w-md text-pretty">
          The page you're looking for doesn't exist. Let's get you back to building something
          sustainable.
        </motion.p>

        <motion.div
          {...rise(reduce, 0.4)}
          className="mt-10 flex w-full flex-wrap items-center justify-center gap-4"
        >
          <LuxeButton variant="foil" to="/" className="min-h-[44px]">
            Back to Home
          </LuxeButton>
          <LuxeButton variant="outline" to="/work-with-me" className="min-h-[44px]">
            Work With Me
          </LuxeButton>
        </motion.div>
      </Section>
    </>
  );
}
