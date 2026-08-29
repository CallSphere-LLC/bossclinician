import { Fragment } from "react";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";

interface Stage {
  label: string;
  /** Colour + matching bloom. A 6px dot reads muddy on near-black without one. */
  dot: string;
}

/** Green → gold → plum, so the three stages read as one progression. */
const STAGES: readonly Stage[] = [
  {
    label: "Just Starting Out",
    dot: "bg-green-bright shadow-[0_0_10px_rgba(107,168,145,0.6)]",
  },
  {
    label: "Fully Booked and Burning Out",
    dot: "bg-gold shadow-[0_0_10px_rgba(201,164,106,0.6)]",
  },
  {
    label: "Running a Group Practice",
    dot: "bg-plum-bright shadow-[0_0_10px_rgba(123,94,167,0.75)]",
  },
];

const META = [
  "No email required to start",
  "2 minutes",
  "4 personalized results",
] as const;

const EASE_LUXE = [0.22, 1, 0.36, 1] as const;
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * Quiz band.
 *
 * A single centred column on a raised surface — no card. The band's whole job
 * is to funnel to one action, so the only competing shapes are three low-weight
 * chips; anything with more visual weight would rival the foil button.
 */
export function LuxeQuiz() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="raised"
      space="md"
      aurora="gold"
      auroraIntensity={0.8}
      aria-label="Practice quiz"
      containerClassName="max-w-3xl text-center"
    >
      {/* Stage light centred on the headline. The section aurora drifts and is
          off-axis by design; this stays put so the column reads as lit, not
          just as sitting in a coloured field. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-18%] -z-10 h-[26rem] w-[26rem] -translate-x-1/2 rounded-full blur-[110px] sm:h-[34rem] sm:w-[34rem]"
        style={{
          background:
            "radial-gradient(circle, rgba(201,164,106,0.14) 0%, transparent 68%)",
        }}
      />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 26 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.75, ease: EASE_LUXE }}
      >
        <span className="eyebrow-luxe">FREE 2-MINUTE QUIZ</span>

        <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.12] text-white sm:text-[2.6rem] lg:text-[3rem]">
          Is Your Practice Set Up to{" "}
          <span className="text-foil italic">Pay You</span>, or Just Keep You
          Busy?
        </h2>

        <p className="copy-luxe mx-auto mt-6 max-w-xl text-pretty">
          Find out exactly what type of practice builder you are and get 3
          specific next steps for your stage, in 2 minutes.
        </p>
      </motion.div>

      <RevealGroup
        as="ul"
        className="mt-9 flex list-none flex-wrap items-center justify-center gap-2.5 sm:gap-3"
      >
        {STAGES.map((stage) => (
          <RevealItem key={stage.label} as="li">
            <span className="glass-soft inline-flex min-h-[2.75rem] items-center gap-2.5 rounded-full px-5 py-2.5 text-sm text-orchid transition-colors duration-500 ease-luxe hover:text-white">
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stage.dot)}
              />
              {stage.label}
            </span>
          </RevealItem>
        ))}
      </RevealGroup>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.7, delay: 0.12, ease: EASE_LUXE }}
      >
        {/* The quiz landing page now exists on this site, so this keeps the
            visitor in the app instead of bouncing them to the old Kajabi
            property mid-funnel. */}
        <LuxeButton variant="foil" size="lg" className="mt-10" to="/practice-quiz">
          Take the Free Quiz
          {/* Decorative: the arrow is a direction cue, not part of the link's
              accessible name. */}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 shrink-0 transition-transform duration-500 ease-luxe group-hover:translate-x-1"
          >
            <path d="M4 12h14" />
            <path d="m12 6 6 6-6 6" />
          </svg>
        </LuxeButton>

        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs tracking-wide text-orchid-faint">
          {META.map((item, i) => (
            <Fragment key={item}>
              {i > 0 && (
                <span aria-hidden className="text-orchid-faint/60">
                  ·
                </span>
              )}
              <span className="whitespace-nowrap">{item}</span>
            </Fragment>
          ))}
        </p>
      </motion.div>
    </Section>
  );
}
