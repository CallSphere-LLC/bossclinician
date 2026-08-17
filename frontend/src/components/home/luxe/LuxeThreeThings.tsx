import { motion, useReducedMotion } from "motion/react";
import { Section, SectionTitle, GoldRule } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";

interface Thing {
  numeral: string;
  title: string;
  body: string;
}

const THINGS: readonly Thing[] = [
  {
    numeral: "01",
    title: "A community that actually gets it.",
    body: "Private practice is isolating by design, and that isolation keeps clinicians stuck. You need a room full of people who understand the billing, the burnout, the platforms, and the vision, building right alongside you.",
  },
  {
    numeral: "02",
    title: "A strategy built for your specific stage.",
    body: "There's no one-size-fits-all path. Whether you're building your foundation, scaling past the income ceiling, or leading a growing team, the strategy has to match where you actually are. Specific strategy gets you moving.",
  },
  {
    numeral: "03",
    title: "The tools to actually implement it.",
    body: "Strategy without implementation is just a good idea you never acted on. Boss Clinician delivers live coaching, done-for-you resources, monthly growth kits, and a mastermind for group practice owners, so the work gets done.",
  },
];

export function LuxeThreeThings() {
  const reduce = useReducedMotion();

  return (
    <Section
      surface="base"
      space="lg"
      aurora="plum"
      auroraIntensity={0.55}
      aria-label="What it takes to build a practice that lasts"
    >
      <SectionTitle
        align="center"
        eyebrow="What It Takes to Build a Practice That Lasts"
        title="You need three things, and they're all here."
      />

      {/*
        An ordered list carries the 01/02/03 sequence semantically, which lets
        the rendered numerals be pure decoration (aria-hidden) instead of being
        announced twice. Capped at max-w-xl below lg because the single-column
        stack otherwise runs a ~90-character measure on tablet.
      */}
      <RevealGroup
        as="ol"
        className="mx-auto mt-10 grid max-w-xl list-none grid-cols-1 items-stretch gap-6 sm:mt-10 lg:mt-12 lg:max-w-none lg:grid-cols-3 lg:gap-8"
      >
        {THINGS.map((thing) => (
          <RevealItem key={thing.numeral} as="li" className="h-full">
            {/* overflow-hidden clips the numeral's bloom to the rounded corner;
                it does not touch the card's own ambient shadow. */}
            <GlassCard
              accent="gold"
              className="flex h-full flex-col overflow-hidden p-8 lg:p-10"
            >
              <div className="relative">
                {/* Foil alone reads flat at this size; a soft gold bloom behind
                    the numeral gives the metal something to catch. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-10 -top-12 h-36 w-36 rounded-full blur-2xl"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(201,164,106,0.20) 0%, transparent 70%)",
                  }}
                />
                <span
                  aria-hidden
                  className="text-foil relative block font-display text-[4rem] font-medium leading-none tracking-tight lg:text-[5rem]"
                >
                  {thing.numeral}
                </span>
              </div>

              <GoldRule width="w-10" className="mt-6" />

              <h3 className="mt-6 text-pretty font-display text-[1.35rem] font-medium leading-snug text-white">
                {thing.title}
              </h3>

              <p className="copy-luxe mt-4 text-pretty text-sm">{thing.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="mt-10 flex justify-center sm:mt-10 lg:mt-12"
      >
        <LuxeButton variant="foil" size="lg" to="/work-with-me">
          Find Your Path
        </LuxeButton>
      </motion.div>
    </Section>
  );
}
