import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { starterConfirmed as copy } from "@/content/kajabiPages";
import { CtaButton, NumberedSteps, PhotoPlate, Prose, rise, type StepItem } from "./shared";

/**
 * Step 3's invite, as a mailto the buyer's own mail app opens. Built in the
 * click handler, so the server render never needs the site's origin.
 */
function InviteButton() {
  const onClick = () => {
    const url = `${window.location.origin}${copy.invite.path}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(copy.invite.subject)}&body=${encodeURIComponent(url)}`;
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="sheen-host inline-flex min-h-[44px] items-center justify-center rounded-full bg-gold-foil px-6 py-4 text-[0.74rem] font-bold uppercase tracking-[0.14em] text-night-deep shadow-[0_14px_36px_-14px_rgba(201,164,106,0.65)] transition-shadow duration-300 hover:shadow-[0_20px_50px_-14px_rgba(201,164,106,0.85)] sm:px-8"
    >
      {copy.invite.label} 💌
    </button>
  );
}

/**
 * /starterconfirmed — after buying the Private Practice Starter Suite.
 *
 * Kajabi's order: the Fully Booked offer, the congratulations, then three next
 * steps. The steps were square graphics with the words baked in; here they are
 * text, so they can be read aloud, searched and resized.
 */
export default function StarterConfirmed() {
  const reduce = useEntranceMotion();

  const steps: StepItem[] = copy.steps.map((step) => ({
    number: step.number,
    title: step.title,
    body: (
      <>
        {step.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {step.number === "03" && (
          <div className="pt-2">
            <InviteButton />
          </div>
        )}
      </>
    ),
    action: "action" in step ? step.action : undefined,
  }));

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} noindex />

      <LuxePageHero
        title={copy.upsell.title}
        tone="gold"
        align="center"
        lede={
          <>
            {copy.upsell.paragraphs.map((p, i) => (
              <span key={p} className={i ? "mt-4 block" : "block"}>
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

      <Section surface="raised" space="md" aurora="green" auroraIntensity={0.5} aria-label={copy.congrats.title} containerClassName="max-w-3xl">
        <SectionTitle title={copy.congrats.title} titleClassName="text-[1.6rem] sm:text-[2.1rem]" />
        <Prose className="mt-8 text-center">
          <p>{copy.congrats.body}</p>
        </Prose>
      </Section>

      <Section surface="base" space="md" aria-label={copy.stepsTitle} containerClassName="max-w-3xl">
        <SectionTitle title={copy.stepsTitle} titleClassName="text-[1.7rem] sm:text-[2.3rem]" />
        <NumberedSteps steps={steps} className="mt-10" />
      </Section>

      <Section surface="deep" space="md" aurora="violet" auroraIntensity={0.6} aria-label="Getting fully booked">
        <PhotoPlate src={copy.image.src} alt={copy.image.alt} className="max-w-4xl" />
        <motion.div {...rise(reduce, 0.1)} className="mt-10 text-center">
          <CtaButton href={copy.learnMore.href}>{copy.learnMore.label}</CtaButton>
        </motion.div>
      </Section>
    </>
  );
}
