import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { clubThankYou as copy } from "@/content/kajabiPages";
import { NumberedSteps, Signoff, rise, type StepItem } from "./shared";

/**
 * /the-club-ty — the Boss Clinician Club welcome, after checkout.
 *
 * Kajabi's custom-code page: hero with a celebration GIF, four numbered steps,
 * the unlocked bonuses, a note on pace, and Yvette's sign-off. The GIF was a
 * Giphy iframe; this site's CSP admits no Giphy frame, so the same animation is
 * self-hosted as an image.
 */
export default function ClubThankYou() {
  const reduce = useEntranceMotion();
  const steps: StepItem[] = copy.steps.map((step) => ({
    title: step.title,
    body: <p>{step.body}</p>,
    action: "action" in step ? step.action : undefined,
  }));

  return (
    <>
      <Seo title={copy.seo.title} noindex />

      <LuxePageHero
        eyebrow={copy.eyebrow}
        title={copy.title}
        titleAccent={copy.titleAccent}
        tone="gold"
        align="center"
        lede={
          <span className="font-display italic">{copy.sub}</span>
        }
        actions={
          <figure className="mx-auto">
            <div className="overflow-hidden rounded-2xl border-[3px] border-gold bg-black shadow-[0_18px_46px_rgba(0,0,0,0.4)]">
              <img src={copy.gif.src} alt={copy.gif.alt} width={280} height={280} className="block size-[220px] sm:size-[280px]" />
            </div>
            <figcaption className="mt-2.5 text-[11px] text-orchid-faint">{copy.gif.credit}</figcaption>
          </figure>
        }
      />

      <Section surface="raised" space="md" aria-label={copy.stepsEyebrow} containerClassName="max-w-3xl">
        <SectionTitle eyebrow={copy.stepsEyebrow} title={copy.stepsTitle} titleClassName="text-[1.8rem] sm:text-[2.4rem]" />
        <NumberedSteps steps={steps} className="mt-10" />
      </Section>

      <Section surface="deep" space="md" aurora="gold" auroraIntensity={0.5} aria-label={copy.bonusesTitle} containerClassName="max-w-3xl">
        <SectionTitle title={copy.bonusesTitle} titleClassName="text-[1.7rem] sm:text-[2.2rem]" />
        <motion.ul {...rise(reduce, 0.08)} className="mt-10 space-y-4">
          {copy.bonuses.map((bonus) => (
            <li key={bonus.name}>
              <GlassCard accent="gold" interactive={false} className="flex items-start gap-4 p-5 sm:p-6">
                <span aria-hidden className="text-[1.4rem] leading-none">
                  🎁
                </span>
                <p className="text-pretty leading-[1.7] text-orchid">
                  <strong className="font-semibold text-white">{bonus.name}</strong>
                  {bonus.rest}
                </p>
              </GlassCard>
            </li>
          ))}
        </motion.ul>

        <motion.p {...rise(reduce, 0.12)} className="copy-luxe mx-auto mt-10 max-w-[62ch] text-pretty">
          <strong className="font-semibold text-gold">{copy.pace.label}</strong> {copy.pace.body}
        </motion.p>
      </Section>

      <Section surface="base" space="md" aria-label="A note from Yvette" containerClassName="max-w-3xl">
        <motion.div {...rise(reduce)} className="copy-luxe mx-auto max-w-[62ch] space-y-5 text-pretty text-center">
          {copy.closing.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </motion.div>
        <Signoff lines={[copy.signature]} />
      </Section>
    </>
  );
}
