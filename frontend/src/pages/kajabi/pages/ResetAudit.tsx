import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { resetAudit as copy } from "@/content/kajabiPages";
import { PhotoPlate, Prose, rise } from "./shared";

/**
 * /reset-audit — the Practice Reset Audit sales page for the free workbook.
 *
 * Kajabi's custom-code page, in its order: hero → "the truth nobody tells you"
 * with its four outcomes → who it is for → a note from Yvette → the closing
 * call. Both "Get the Free Audit" buttons go to /reset-audit-form, as they did.
 */
export default function ResetAudit() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} />

      <LuxePageHero
        eyebrow={copy.eyebrow}
        title={copy.title}
        titleAccent={copy.titleAccent}
        tone="violet"
        lede={
          <>
            <span className="block">{copy.lede}</span>
            <span className="mt-4 block">{copy.note}</span>
          </>
        }
        actions={
          <>
            <LuxeButton variant="foil" size="lg" to={copy.cta.href}>
              {copy.cta.label}
            </LuxeButton>
            <LuxeButton variant="glass" size="sm" to={copy.back.href} className="min-h-[44px]">
              {copy.back.label}
            </LuxeButton>
            <p className="w-full text-sm font-light leading-[1.7] text-orchid-faint">{copy.meta}</p>
          </>
        }
      />

      <Section surface="raised" space="md" aurora="gold" auroraIntensity={0.5} aria-label={copy.truth.eyebrow}>
        <SectionTitle
          eyebrow={copy.truth.eyebrow}
          title={
            <>
              {copy.truth.title}{" "}
              <span className="text-foil font-display italic">{copy.truth.titleAccent}</span>
            </>
          }
        />
        <Prose className="mt-10">
          {copy.truth.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </Prose>
        <RevealGroup as="ul" className="mx-auto mt-10 grid max-w-4xl list-none grid-cols-1 gap-4 sm:grid-cols-2">
          {copy.truth.bullets.map((bullet) => (
            <RevealItem key={bullet} as="li" className="h-full">
              <GlassCard accent="gold" interactive={false} className="flex h-full items-start gap-4 p-5 sm:p-6">
                <span aria-hidden className="mt-0.5 text-gold">
                  ✓
                </span>
                <span className="text-pretty text-[0.98rem] leading-[1.65] text-orchid">{bullet}</span>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section surface="deep" space="md" aurora="green" auroraIntensity={0.45} aria-label={copy.who.eyebrow} containerClassName="max-w-3xl">
        <SectionTitle
          eyebrow={copy.who.eyebrow}
          title={copy.who.title}
          titleClassName="text-[1.55rem] sm:text-[2rem] lg:text-[2.3rem]"
          className="max-w-3xl"
        />
        <Prose className="mt-10">
          <p>{copy.who.body}</p>
        </Prose>
        <motion.figure {...rise(reduce, 0.12)} className="mx-auto mt-12 max-w-xl text-center">
          <blockquote className="font-display text-[1.7rem] italic leading-snug text-white sm:text-[2rem]">
            {copy.who.quote}
          </blockquote>
          <figcaption className="mt-4 text-sm text-orchid-dim">{copy.who.quoteBy}</figcaption>
        </motion.figure>
      </Section>

      <Section surface="base" space="md" aria-label={copy.yvette.eyebrow}>
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <PhotoPlate src={copy.yvette.image} alt={copy.yvette.imageAlt} className="max-w-xl" />
          <div>
            <SectionTitle align="left" eyebrow={copy.yvette.eyebrow} title={copy.yvette.title} />
            <motion.div {...rise(reduce, 0.1)} className="copy-luxe mt-8 space-y-5 text-pretty">
              {copy.yvette.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <p className="text-sm text-orchid-dim">{copy.yvette.signature}</p>
            </motion.div>
          </div>
        </div>
      </Section>

      <Section surface="raised" space="lg" aurora="mixed" auroraIntensity={0.8} aria-label={copy.close.eyebrow} containerClassName="max-w-3xl">
        <SectionTitle eyebrow={copy.close.eyebrow} title={copy.close.title} body={copy.close.body} />
        <motion.div {...rise(reduce, 0.12)} className="mt-10 text-center">
          <LuxeButton variant="foil" size="lg" to={copy.cta.href}>
            {copy.cta.label}
          </LuxeButton>
          <p className="mx-auto mt-6 max-w-md text-pretty text-sm font-light leading-[1.7] text-orchid-faint">
            {copy.close.privacy}
          </p>
        </motion.div>
      </Section>
    </>
  );
}
