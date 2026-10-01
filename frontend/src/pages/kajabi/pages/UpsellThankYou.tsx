import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { practicePlannerThankYou, protectionPackThanks } from "@/content/kajabiPages";
import { CtaButton, PhotoPlate, rise } from "./shared";

type UpsellCopy = typeof practicePlannerThankYou | typeof protectionPackThanks;

/**
 * The "WAIT BEFORE YOU GO..." thank-you layout two Kajabi pages share: the
 * Fully Booked Toolkit offer first, then the confirmation of what was just
 * unlocked. The $67 button is the toolkit's checkout on this site.
 */
function UpsellThankYou({ copy, library }: { copy: UpsellCopy; library?: { label: string; href: string } }) {
  const reduce = useEntranceMotion();
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} noindex />

      <LuxePageHero
        eyebrow={copy.upsell.eyebrow}
        title={copy.upsell.title}
        tone="gold"
        align="center"
        lede={
          <>
            <span className="block font-medium text-white">{copy.upsell.unlocked}</span>
            {copy.upsell.body.map((p) => (
              <span key={p} className="mt-4 block">
                {p}
              </span>
            ))}
          </>
        }
        actions={
          <CtaButton href={copy.upsell.cta.href} className="mx-auto">
            {copy.upsell.cta.label}
          </CtaButton>
        }
      />

      <Section surface="raised" space="md" aurora="violet" auroraIntensity={0.5} aria-label={copy.confirm.title}>
        <motion.p
          {...rise(reduce)}
          className="mx-auto max-w-3xl text-balance text-center font-display text-[1.8rem] leading-tight text-foil sm:text-[2.4rem]"
        >
          {copy.banner}
        </motion.p>
        <div className="mt-10 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <PhotoPlate src={copy.image} alt="A therapist at her desk celebrating with both fists raised" className="max-w-xl" />
          <motion.div {...rise(reduce, 0.1)}>
            <GlassCard accent="gold" interactive={false} className="p-7 sm:p-9">
              <h2 className="text-balance font-display text-[1.6rem] font-medium leading-snug text-white sm:text-[2rem]">
                {copy.confirm.title}
              </h2>
              <div className="copy-luxe mt-5 space-y-4 text-pretty">
                {copy.confirm.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
              {library && (
                <div className="mt-7">
                  <CtaButton href={library.href} variant="glass" size="md">
                    {library.label}
                  </CtaButton>
                </div>
              )}
            </GlassCard>
          </motion.div>
        </div>
      </Section>
    </>
  );
}

/** /practice-planner-thank-you — after the free Profitable Practice Planner opt-in. */
export function PracticePlannerThankYou() {
  return <UpsellThankYou copy={practicePlannerThankYou} />;
}

/** /protectionpackthanks — after buying the Private Practice Protection Pack. */
export function ProtectionPackThanks() {
  return <UpsellThankYou copy={protectionPackThanks} library={protectionPackThanks.library} />;
}
