import { Fragment, useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Aurora } from "@/components/luxe/Aurora";
import { GlassCard } from "@/components/luxe/GlassCard";
import { KineticText } from "@/components/luxe/KineticText";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { Container } from "@/components/ui/Container";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Kept as data so the separators can be rendered as decoration, not copy.
 *
 * `short` drops the shared "Boss Clinician" prefix for the desktop rail, where
 * the brand is printed once at the head of the strip — setting it three times
 * in a row is repetition, not branding. The full name still ships to assistive
 * tech and crawlers via an sr-only prefix, so nothing is lost by hoisting it.
 */
const TIERS = [
  { name: "Boss Clinician Club", short: "Club", tone: "text-orchid" },
  { name: "Boss Clinician Lounge", short: "Lounge", tone: "text-white/85" },
  {
    name: "Boss Clinician Boardroom Mastermind",
    short: "Boardroom Mastermind",
    tone: "text-gold-bright",
  },
];

/**
 * The hero is above the fold, so it rises on mount rather than on scroll — a
 * `whileInView` hero can sit at opacity 0 until the observer's first callback,
 * which reads as a blank page on a slow first paint.
 */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 26 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/** Assay-mark style seal for the credential plaque. */
function Hallmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={className} fill="none" stroke="currentColor">
      <circle cx="14" cy="14" r="12.25" strokeWidth="0.9" opacity="0.4" />
      <path d="M14 6.4 17.7 14 14 21.6 10.3 14Z" strokeWidth="1.1" />
      <path d="M6.4 14h15.2" strokeWidth="0.7" opacity="0.35" />
    </svg>
  );
}

export function LuxeHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  // The portrait trails the scroll by ~56px, so the copy appears to move past it.
  const portraitY = useTransform(scrollYProgress, [0, 1], [0, 56]);

  return (
    <section
      ref={sectionRef}
      aria-label="Hero"
      className="relative overflow-hidden bg-night-deep"
    >
      <Aurora tone="violet" />

      {/* Second light source: a warm key low and to the right, so the portrait
          is lit from the same direction the gold accents read from. */}
      <div
        aria-hidden
        className="animate-pulse-glow pointer-events-none absolute -bottom-[26%] -right-[14%] h-[78vw] max-h-[820px] w-[78vw] max-w-[820px] rounded-full blur-[110px]"
        style={{
          background:
            "radial-gradient(circle, rgba(201,164,106,0.26) 0%, rgba(201,164,106,0.07) 44%, transparent 72%)",
        }}
      />

      <Container>
        <div className="grid lg:min-h-[calc(100vh-5rem)] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-center lg:gap-x-10 xl:gap-x-14">
          {/* ── Copy ───────────────────────────────────────────────────── */}
          {/* lg padding is tighter than the 6rem the column used to carry: the
              tier rail now lives in this column, and on a 1536×864 laptop the
              old value pushed it past the fold. */}
          <div className="relative z-10 pb-4 pt-14 sm:pt-16 lg:py-20 xl:pr-10">
            <motion.div {...rise(reduce, 0.05)} className="flex items-center gap-4">
              <span aria-hidden className="rule-gold hidden w-10 shrink-0 sm:block" />
              {/* 0.6rem resolved to 9.6px on a phone — below the floor where a
                  wide-tracked uppercase label stays comfortably readable. */}
              <span className="eyebrow-luxe mb-0 text-[0.7rem] tracking-[0.16em] sm:text-[0.68rem] sm:tracking-[0.28em]">
                YVETTE HOWARD, LCSW // PRIVATE PRACTICE STRATEGIST
              </span>
            </motion.div>

            {/* Kinetic type: each word rises out of its own clipping mask, so
                the headline sets itself line by line rather than fading in as a
                block. The h1 itself no longer carries a rise — stacking a block
                fade under a per-word reveal reads as two competing animations.
                KineticText collapses to plain text under reduced motion. */}
            <h1 className="mt-6 text-balance font-display text-[3rem] font-normal leading-[1.03] tracking-[-0.02em] text-white sm:mt-7 sm:text-[3.6rem] md:text-[4.2rem] lg:text-[3.5rem] xl:text-[4.5rem] 2xl:text-[5.2rem]">
              <span className="block">
                <KineticText text="Own your practice." immediate delay={0.16} />
              </span>
              <span className="text-foil mt-1.5 block font-display italic">
                <KineticText text="Build your legacy." immediate delay={0.42} />
              </span>
            </h1>

            <motion.p
              {...rise(reduce, 0.24)}
              className="copy-luxe mt-7 max-w-[34rem] text-pretty sm:mt-8 sm:text-[1.04rem] lg:text-[1.08rem]"
            >
              The community, strategy, and structure therapists and clinicians need to build
              profitable, sustainable private practices, without platforms, without burnout,
              without doing it alone.
            </motion.p>

            <motion.div
              {...rise(reduce, 0.34)}
              className="mt-9 flex flex-wrap items-center gap-3 sm:mt-8 sm:gap-4"
            >
              <LuxeButton to="/work-with-me" variant="foil" size="lg">
                Find Your Path
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
              <LuxeButton to="/resources" variant="glass" size="lg">
                <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3" fill="currentColor">
                  <path d="M4.8 3.1 12.6 8l-7.8 4.9Z" />
                </svg>
                Watch Free Masterclass
              </LuxeButton>
            </motion.div>

            <motion.p
              {...rise(reduce, 0.44)}
              className="mt-9 flex items-center gap-4 text-[0.66rem] font-bold uppercase tracking-[0.32em] text-gold sm:mt-8 sm:text-[0.7rem]"
            >
              LEAD. HEAL. ELEVATE.
              <span aria-hidden className="rule-faint hidden w-16 shrink-0 sm:block" />
            </motion.p>

            {/* ── Tier rail (desktop) ─────────────────────────────────────
                Below lg the tiers stay on the portrait as a plaque, where
                there is dead space under the face. From lg the portrait is a
                full-height column and the plaque sat over the subject, so the
                tiers move here instead and read as the closing line of the
                pitch. One source of truth (TIERS) renders both; the inactive
                one is display:none, so screen readers only ever meet one. */}
            <motion.div {...rise(reduce, 0.54)} className="mt-6 hidden w-fit max-w-full lg:block">
              {/* Between lg and xl the column is too narrow for one line, and a
                  wrapped row orphans a separator at the end of line one — so the
                  brand head stacks above the tiers there and only sits inline
                  from xl, where the full row fits. */}
              <div className="glass-soft flex flex-col gap-2.5 rounded-2xl px-5 py-3 xl:flex-row xl:items-center xl:gap-5">
                <div className="flex items-center gap-3">
                  <Hallmark className="h-5 w-5 shrink-0 text-gold" />
                  <span
                    aria-hidden
                    className="shrink-0 text-[0.62rem] font-semibold uppercase leading-none tracking-[0.2em] text-gold/85"
                  >
                    Boss Clinician
                  </span>
                </div>
                <span aria-hidden className="hidden h-7 w-px shrink-0 bg-white/10 xl:block" />
                {/* Hairline separators, not dots, and a tone that warms toward
                    the flagship — the ladder (Club → Lounge → Boardroom) is
                    what the old single-colour dotted run flattened away. */}
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {TIERS.map((tier, i) => (
                    <Fragment key={tier.name}>
                      {i > 0 && <li aria-hidden className="h-3 w-px bg-white/10" />}
                      <li
                        className={`whitespace-nowrap text-[0.78rem] font-medium tracking-[0.07em] ${tier.tone}`}
                      >
                        <span className="sr-only">Boss Clinician </span>
                        {tier.short}
                      </li>
                    </Fragment>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>

          {/* ── Portrait ───────────────────────────────────────────────── */}
          <div className="relative -mx-5 mt-10 sm:-mx-8 lg:mx-0 lg:-mr-12 lg:mt-0 lg:self-stretch">
            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, delay: reduce ? 0 : 0.1, ease: EASE }}
              className="portrait-fade relative isolate h-[115vw] max-h-[540px] overflow-hidden sm:h-[80vw] sm:max-h-[600px] lg:h-full lg:max-h-none lg:min-h-[600px]"
            >
              {/* Layer is taller than its frame in both directions so the
                  parallax travel never exposes an edge, and so the image sits
                  low enough that the mask's top fade lands on hair, not face. */}
              <motion.div
                style={reduce ? undefined : { y: portraitY }}
                className="absolute inset-x-0 top-[7%] h-[112%] will-change-transform"
              >
                <img
                  src="/images/yvette-hero-portrait.jpg"
                  alt="Yvette Howard, LCSW, Private Practice Strategist and founder of Boss Clinician"
                  width={960}
                  height={1440}
                  decoding="async"
                  // React 18 does not map the camelCase `fetchPriority` prop to
                  // the DOM attribute — it warns and drops it. The lowercase
                  // spelling is passed through verbatim, which is what the
                  // preload scanner actually reads.
                  {...{ fetchpriority: "high" }}
                  className="h-full w-full object-cover object-top brightness-[0.76] contrast-[1.08] saturate-[0.66]"
                />
              </motion.div>

              {/* Vignette: keeps the daylight background from competing with
                  the near-black page, and pulls the eye to the face. */}
              <div
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(115%_78%_at_52%_22%,transparent_0%,rgba(6,4,11,0.5)_62%,rgba(6,4,11,0.94)_100%)]"
              />
              {/* Tint the daylight into the page's plum, then reintroduce the
                  gold key from the low-right orb as a rim light. */}
              <div aria-hidden className="absolute inset-0 bg-glow-violet/30 mix-blend-soft-light" />
              <div
                aria-hidden
                className="absolute inset-0 mix-blend-screen bg-[radial-gradient(62%_46%_at_86%_74%,rgba(201,164,106,0.20),transparent_70%)]"
              />
              {/* The mask dissolves top/bottom/left only; this closes the right
                  edge so the frame never hard-cuts on wide viewports. */}
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 w-[14%] bg-[linear-gradient(to_left,#06040B,transparent)]"
              />
            </motion.div>

            {/* Credential plaque — sits outside the masked frame so the glass
                keeps its full edge. Phone/tablet only: from lg the same tiers
                render as the rail under the headline copy. */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: reduce ? 0 : 0.7, ease: EASE }}
              className="absolute inset-x-4 bottom-5 z-20 sm:inset-x-auto sm:bottom-8 sm:left-8 sm:max-w-[21rem] lg:hidden"
            >
              <GlassCard accent="gold" spotlight={false} interactive={false} className="px-5 py-4">
                <div className="flex items-start gap-3.5">
                  <Hallmark className="mt-0.5 h-6 w-6 shrink-0 text-gold" />
                  {/* Flex-wrap, not inline runs: separating the tiers with a
                      margin-only dot leaves no break opportunity between them,
                      so the three names render as one unbreakable line and
                      overflow the plaque. Each tier being its own flex item
                      gives the browser somewhere to wrap. */}
                  <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] font-medium leading-[1.7] tracking-[0.08em] text-orchid sm:text-[0.66rem] sm:tracking-[0.13em]">
                    {TIERS.map((tier, i) => (
                      <Fragment key={tier.name}>
                        {i > 0 && (
                          <li aria-hidden className="text-gold/60">
                            &middot;
                          </li>
                        )}
                        <li>{tier.name}</li>
                      </Fragment>
                    ))}
                  </ul>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </Container>

      {/* Scroll cue: a light travelling down a hairline track. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-8 left-5 z-20 hidden sm:left-8 lg:left-12 lg:block"
      >
        <div className="relative h-20 w-px overflow-hidden bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.16)_35%,transparent)]">
          <span className="animate-scroll-cue absolute left-0 top-0 h-8 w-px bg-[linear-gradient(to_bottom,transparent,#E8CE9A,transparent)] will-change-transform" />
        </div>
      </div>
    </section>
  );
}
