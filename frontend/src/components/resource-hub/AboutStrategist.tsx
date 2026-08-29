import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, GoldRule } from "@/components/luxe/Section";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { strategistCreds, strategistParagraphs } from "@/content/resourceHub";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** One rise recipe for the block; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.85, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/**
 * The page's editorial spread: the story on the left, the person telling it
 * mounted on the right. Aurora is dropped low and there is one entrance per
 * movement rather than one per paragraph, because this block is read rather
 * than scanned.
 */
export function AboutStrategist() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="plum"
      auroraIntensity={0.45}
      aria-label="About your strategist"
      containerClassName="max-w-6xl"
    >
      <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div>
          <motion.span {...rise(reduce, 0)} className="eyebrow-luxe">
            About Your Strategist
          </motion.span>

          <motion.h2
            {...rise(reduce, 0.08)}
            className="text-balance font-display text-[1.8rem] font-medium leading-[1.16] text-white sm:text-[2.2rem] lg:text-[2.5rem]"
          >
            I built these resources from the mistakes I made, so you don't have to make them.
          </motion.h2>

          <motion.div {...rise(reduce, 0.16)}>
            <GoldRule className="mt-7" />
          </motion.div>

          <motion.div {...rise(reduce, 0.22)} className="mt-7 max-w-[60ch] space-y-5">
            {strategistParagraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 24)} className="copy-luxe text-pretty">
                {paragraph}
              </p>
            ))}
          </motion.div>

          <motion.div
            {...rise(reduce, 0.3)}
            className="mt-8 flex flex-wrap items-center gap-2.5"
          >
            {strategistCreds.map((cred) => (
              <LuxePill
                key={cred}
                accent="gold"
                className="text-[0.7rem] tracking-[0.1em] sm:text-[0.64rem] sm:tracking-[0.16em]"
              >
                {cred}
              </LuxePill>
            ))}
          </motion.div>

          {/* items-stretch lets the button go full-bleed on a phone, where a
              240px pill floating in a 320px column reads as an afterthought. */}
          <motion.div
            {...rise(reduce, 0.38)}
            className="mt-8 flex flex-col items-stretch sm:items-start"
          >
            <LuxeButton to="/about" variant="outline" size="md" className="min-h-[44px]">
              Read My Full Story
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="h-3.5 w-3.5 transition-transform duration-500 ease-luxe group-hover:translate-x-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 8h11M9.5 4l4 4-4 4" />
              </svg>
            </LuxeButton>
          </motion.div>
        </div>

        {/* ── Portrait ──────────────────────────────────────────────────────
            Graded to the same recipe as the home page: dimmed, desaturated,
            vignetted, then passed under a violet soft-light so the photograph
            sits *in* the dark instead of on top of it. */}
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.95, delay: reduce ? 0 : 0.14, ease: EASE }}
          className="relative isolate mx-auto w-full max-w-sm lg:max-w-none"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
            style={{
              background:
                "radial-gradient(62% 55% at 45% 32%, rgba(123,94,167,0.45) 0%, transparent 72%)",
            }}
          />

          <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
            <img
              src="/images/yvette-meet-portrait.jpg"
              alt="Yvette Howard, LCSW — Private Practice Strategist, Boss Clinician"
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] w-full max-w-full object-cover object-top brightness-[0.8] contrast-[1.06] saturate-[0.8]"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(112%_78%_at_50%_24%,transparent_24%,rgba(10,7,19,0.5)_66%,rgba(6,4,11,0.9)_100%)]"
            />
            <div aria-hidden className="absolute inset-0 bg-glow-violet/20 mix-blend-soft-light" />
          </div>

          <span
            aria-hidden
            className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-3 -right-3 h-12 w-12 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-16 sm:w-16"
          />
        </motion.div>
      </div>
    </Section>
  );
}
