import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, GoldRule } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";
import type { AvatarSectionData } from "@/content/resourceHub";
import { ResourceCard } from "./ResourceCard";
import { glassAccent, TONE } from "./accents";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

type Surface = "base" | "deep" | "raised";
type AuroraTone = "plum" | "violet" | "gold" | "green" | "mixed";

interface AvatarSectionProps {
  section: AvatarSectionData;
  /** Elevation for this band. The page owns the alternation. */
  surface: Surface;
  aurora: AuroraTone;
}

/** One rise recipe for the block; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/**
 * One avatar block: editorial opener → card grid → closing invitation.
 *
 * The light theme drew each stage as a solid colour banner. On glass the same
 * job is done by the accent the whole band carries — eyebrow, card ribbons and
 * the closing panel all share one hue — so a reader arriving from the sort
 * pills still lands on a visibly distinct section without a block of flat
 * colour interrupting the page's depth.
 */
export function AvatarSection({ section, surface, aurora }: AvatarSectionProps) {
  const reduce = useEntranceMotion();
  const { accent, cards, cta, id } = section;
  const cardAccent = glassAccent[accent];
  const tone = TONE[cardAccent];

  return (
    <Section
      id={id}
      surface={surface}
      space="md"
      aurora={aurora}
      auroraIntensity={0.45}
      aria-label={section.eyebrow}
      className="scroll-mt-24"
      containerClassName="max-w-6xl"
    >
      {/* ── Opener ────────────────────────────────────────────────────────── */}
      <div className="max-w-3xl">
        <motion.span
          {...rise(reduce, 0)}
          className={cn(
            "mb-4 inline-block text-[0.74rem] font-semibold uppercase tracking-[0.16em] sm:mb-5 sm:text-[0.68rem] sm:tracking-[0.26em]",
            tone.label,
          )}
        >
          {section.eyebrow}
        </motion.span>

        <motion.h2
          {...rise(reduce, 0.08)}
          className="text-balance font-display text-[1.8rem] font-medium leading-[1.14] text-white sm:text-[2.2rem] lg:text-[2.6rem]"
        >
          {section.headline}
        </motion.h2>

        <motion.div {...rise(reduce, 0.16)}>
          <GoldRule className="mt-7" />
        </motion.div>

        <motion.p {...rise(reduce, 0.22)} className="copy-luxe mt-7 max-w-[58ch] text-pretty">
          {section.description}
        </motion.p>
      </div>

      {/* ── Resources ─────────────────────────────────────────────────────── */}
      <RevealGroup
        as="ul"
        className={cn(
          "mt-10 grid list-none grid-cols-1 items-stretch gap-6 sm:grid-cols-2 sm:gap-7",
          cards.length >= 3 && "lg:grid-cols-3",
        )}
      >
        {cards.map((card) => (
          <RevealItem key={card.id} as="li" className="h-full">
            <ResourceCard card={card} accent={accent} />
          </RevealItem>
        ))}
      </RevealGroup>

      {/* ── Closing invitation ────────────────────────────────────────────── */}
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <GlassCard
          accent={cardAccent}
          interactive={false}
          spotlight={false}
          className="flex flex-col items-stretch gap-6 overflow-hidden px-6 py-7 text-center sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:text-left"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-gold-bright via-gold to-gold/20"
          />
          <p className="copy-luxe mx-auto max-w-[52ch] text-pretty italic text-orchid lg:mx-0">
            {cta.body}
          </p>
          <LuxeButton
            to={cta.to}
            variant="foil"
            size="md"
            className="min-h-[44px] shrink-0 tracking-[0.12em] sm:tracking-[0.18em]"
          >
            {cta.label}
          </LuxeButton>
        </GlassCard>
      </motion.div>
    </Section>
  );
}
