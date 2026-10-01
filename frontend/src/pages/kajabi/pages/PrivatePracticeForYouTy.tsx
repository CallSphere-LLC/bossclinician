import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { readinessThankYou as copy } from "@/content/kajabiPagesQuiz";
import { LinkCards, NumberedSteps, PolicyLinks, rise } from "./shared";

/**
 * /private-practice-for-you-ty — where the readiness quiz lands after its
 * opt-in. Copy verbatim from the Kajabi custom-code page; its Resource Hub
 * and Club cards point at this site's own pages.
 */
export default function PrivatePracticeForYouTy() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} noindex />

      <Section surface="deep" space="lg" aurora="violet" auroraIntensity={0.85} containerClassName="max-w-3xl">
        <motion.div {...rise(reduce)}>
          <GlassCard accent="gold" interactive={false} className="p-7 text-center sm:p-12">
            <span
              aria-hidden
              className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold/50 bg-gold/[0.1] text-[1.4rem] font-bold text-gold"
            >
              ✓
            </span>
            <span className="eyebrow-luxe mt-6 block">{copy.eyebrow}</span>
            <h1 className="text-balance font-display text-[2.2rem] font-normal leading-[1.08] text-white sm:text-[3rem]">
              {copy.title}
            </h1>
            <GoldRule className="mx-auto mt-6" />
            <p className="copy-luxe mx-auto mt-6 max-w-[52ch] text-pretty">{copy.lede}</p>
            <p className="mx-auto mt-6 inline-block rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-sm text-orchid">
              {copy.inboxNote}
            </p>
          </GlassCard>
        </motion.div>

        <Divider label={copy.nextHeading} />
        <NumberedSteps steps={copy.steps} />

        <Divider label={copy.waitHeading} />
        <LinkCards items={copy.links} />

        <PolicyLinks />
      </Section>
    </>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="mb-6 mt-14 flex items-center gap-4">
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-transparent to-gold/40" />
      <h2 className="text-[0.72rem] font-bold uppercase tracking-[0.2em] text-gold">{label}</h2>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-l from-transparent to-gold/40" />
    </div>
  );
}
