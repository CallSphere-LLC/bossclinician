import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { MASTERCLASS_REVIEW_FIELDS, masterclassReview as copy } from "@/content/kajabiPages";
import { KajabiForm, PhotoPlate, rise } from "./shared";

/**
 * /masterclass-review-sheet — feedback after the Freedom Masterclass.
 *
 * Kajabi framed in a seven-question assessment (2148148279) one question per
 * screen. Here the same questions are one form posting to `masterclass-review`
 * (migration 100), so every reply lands in Forms with the testimonial
 * permission beside it.
 */
export default function MasterclassReviewSheet() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} />

      <Section surface="deep" space="lg" aurora="violet" auroraIntensity={0.85} aria-label={copy.title}>
        <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <motion.div {...rise(reduce)}>
            <h1 className="text-balance font-display text-[2.4rem] font-normal leading-[1.08] text-white sm:text-[3.1rem]">
              {copy.title}
            </h1>
            <div className="copy-luxe mt-8 space-y-5 text-pretty">
              {copy.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <div className="mt-8">
              <p className="text-sm font-light text-orchid-dim">{copy.signoff[0]}</p>
              <p className="font-display text-[1.6rem] italic text-foil">{copy.signoff[1]}</p>
            </div>
          </motion.div>
          <PhotoPlate src={copy.portrait.src} alt={copy.portrait.alt} className="max-w-sm lg:sticky lg:top-28" />
        </div>
      </Section>

      <Section surface="raised" space="md" aria-label={copy.formTitle} containerClassName="max-w-3xl">
        <SectionTitle title={copy.formTitle} titleClassName="text-[1.6rem] sm:text-[2.1rem]" />
        <motion.div {...rise(reduce, 0.1)} className="mt-10">
          <GlassCard accent="gold" interactive={false} className="p-6 sm:p-9">
            <KajabiForm
              formSlug={copy.formSlug}
              fields={MASTERCLASS_REVIEW_FIELDS}
              submitLabel={copy.submit}
              successMessage={
                <div className="space-y-4">
                  {copy.thanks.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              }
            />
          </GlassCard>
        </motion.div>
      </Section>
    </>
  );
}
