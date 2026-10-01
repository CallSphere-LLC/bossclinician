import { Fragment } from "react";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { leapAcceleratorThankYou as copy } from "@/content/kajabiPagesLeap";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { NumberedSteps, PhotoPlate, rise } from "./shared";

/**
 * /leap-accelerator-thank-you — where a Leap Accelerator purchase landed on
 * Kajabi, rebuilt with the source's copy: the congratulation, the three "what
 * happens next" steps, how to get the most from the programme, and the close.
 *
 * The two buttons Kajabi pointed off-site (its old mykajabi.com login, and a
 * community button with no link at all) go to this site's library and member
 * community. Not indexed: it is a post-purchase page.
 */

/** Renders the content file's `**bold**` marks as <strong>, nothing else. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-white">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export default function LeapAcceleratorThankYou() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} noindex />

      <LuxePageHero
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        titleAccent={copy.hero.titleAccent}
        tone="violet"
        lede={
          <>
            {copy.intro.map((p) => (
              <span key={p} className="mt-4 block first:mt-0">
                <RichText text={p} />
              </span>
            ))}
          </>
        }
        aside={<PhotoPlate src={copy.hero.image.src} alt={copy.hero.image.alt} className="max-w-[34rem]" />}
      />

      <Section surface="raised" space="md" aurora="gold" auroraIntensity={0.45} aria-label={copy.next.title} containerClassName="max-w-3xl">
        <SectionTitle title={copy.next.title} />
        <NumberedSteps
          className="mt-10"
          steps={copy.next.steps.map((step) => ({
            title: step.title,
            body: (
              <>
                {step.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </>
            ),
            action: "action" in step ? step.action : undefined,
          }))}
        />
      </Section>

      <Section surface="deep" space="md" aurora="plum" auroraIntensity={0.5} aria-label={copy.most.title} containerClassName="max-w-3xl">
        <SectionTitle title={copy.most.title} />
        <motion.div {...rise(reduce, 0.08)} className="mt-10">
          <GlassCard accent="plum" interactive={false} className="p-7 sm:p-9">
            <ul className="space-y-4">
              {copy.most.items.map((item) => (
                <li key={item.lead} className="flex gap-3.5">
                  <span aria-hidden className="shrink-0 text-gold">
                    &rarr;
                  </span>
                  <span className="copy-luxe min-w-0 text-pretty">
                    <strong className="font-semibold text-white">{item.lead}</strong>
                    {item.body}
                  </span>
                </li>
              ))}
            </ul>
            <div aria-hidden className="rule-faint my-7 w-full" />
            <p className="text-pretty font-semibold leading-[1.75] text-white">{copy.most.closing}</p>
          </GlassCard>
        </motion.div>
      </Section>

      <Section surface="base" space="lg" aurora="mixed" auroraIntensity={0.7} aria-label={copy.ready.title} containerClassName="max-w-3xl">
        <motion.div {...rise(reduce)} className="text-center">
          <h2 className="text-balance font-display text-[1.8rem] font-medium leading-[1.18] text-white sm:text-[2.3rem]">
            {copy.ready.title}
          </h2>
          <GoldRule className="mx-auto mt-6" />
          <p className="copy-luxe mx-auto mt-7 max-w-[62ch] text-pretty">
            <RichText text={copy.ready.body} />
          </p>
          <p className="mt-8 font-display text-[1.6rem] italic text-foil">{copy.ready.signoff}</p>
        </motion.div>
      </Section>
    </>
  );
}
