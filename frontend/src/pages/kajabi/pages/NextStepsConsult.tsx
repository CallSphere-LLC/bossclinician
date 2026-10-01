import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { nextStepsConsult as copy } from "@/content/kajabiPages";
import { CtaButton, INLINE_LINK, PhotoPlate, rise } from "./shared";

/**
 * /next-steps-consult — onboarding for a new 1:1 consulting client.
 *
 * Five steps in Kajabi's order, the rescheduling note, the Psychology Today
 * guide (Kajabi linked a Google Drive copy; the same PDF is self-hosted here),
 * Yvette's note and the Instagram strip. The coaching-portal buttons open this
 * site's coaching area rather than Kajabi's one-on-one coaching URL.
 */
export default function NextStepsConsult() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} noindex />

      <Section surface="deep" space="lg" aurora="mixed" auroraIntensity={0.9} aria-label={copy.title}>
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <motion.div {...rise(reduce)} className="text-center lg:text-left">
            <h1 className="text-balance font-display text-[2.6rem] font-normal leading-[1.06] text-white sm:text-[3.4rem]">
              {copy.title}
            </h1>
            <p className="mt-4 font-display text-[1.5rem] italic text-foil sm:text-[1.8rem]">{copy.sub}</p>
            <p className="copy-luxe mt-8 text-pretty text-lg">{copy.intro}</p>
          </motion.div>
          <PhotoPlate src={copy.portrait.src} alt={copy.portrait.alt} className="hidden max-w-sm lg:block" />
        </div>
      </Section>

      <Section surface="raised" space="md" aria-label="Your next steps" containerClassName="max-w-4xl">
        <RevealGroup as="ol" className="grid list-none grid-cols-1 gap-6">
          {copy.steps.map((step) => (
            <RevealItem key={step.number} as="li">
              <GlassCard accent="gold" interactive={false} className="grid gap-6 p-6 sm:grid-cols-[6rem_1fr] sm:gap-8 sm:p-9">
                <img
                  src={step.icon}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="size-20 rounded-2xl bg-white/[0.06] object-contain p-2 sm:size-24"
                />
                <div className="min-w-0">
                  <p className="text-[0.72rem] font-bold uppercase tracking-[0.2em] text-gold">{step.number}</p>
                  <h2 className="mt-2 text-balance font-display text-[1.45rem] font-medium leading-snug text-white sm:text-[1.8rem]">
                    {step.title}
                  </h2>
                  <div className="copy-luxe mt-4 space-y-4 text-pretty">
                    {step.paragraphs.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    {"portalLabel" in step && (
                      <>
                        <p>
                          <span aria-hidden>📌 </span>
                          <strong className="font-semibold text-white">{step.portalLabel}</strong>
                        </p>
                        <p>{step.after}</p>
                      </>
                    )}
                  </div>
                  {"action" in step && (
                    <div className="mt-6">
                      <CtaButton href={step.action.href} size="md">
                        {step.action.label}
                      </CtaButton>
                    </div>
                  )}
                </div>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>

        <motion.div {...rise(reduce, 0.05)} className="mt-8">
          <GlassCard accent="plum" interactive={false} className="p-6 sm:p-8">
            <h2 className="font-display text-[1.35rem] text-white">{copy.note.title}</h2>
            <p className="copy-luxe mt-3 text-pretty">{copy.note.body}</p>
          </GlassCard>
        </motion.div>
      </Section>

      <Section surface="deep" space="md" aurora="gold" auroraIntensity={0.55} aria-label={copy.bonus.title} containerClassName="max-w-3xl">
        <motion.div {...rise(reduce)} className="text-center">
          <img src={copy.bonus.icon} alt="" aria-hidden loading="lazy" className="mx-auto size-24 object-contain" />
          <h2 className="mt-6 text-balance font-display text-[1.8rem] font-medium leading-tight text-white sm:text-[2.4rem]">
            {copy.bonus.title}
          </h2>
          <div className="mt-8">
            <CtaButton href={copy.bonus.action.href}>{copy.bonus.action.label}</CtaButton>
          </div>
        </motion.div>
      </Section>

      <Section surface="base" space="md" aria-label={copy.here.title} containerClassName="max-w-3xl">
        <motion.div {...rise(reduce)} className="text-center">
          <img
            src={copy.here.avatar.src}
            alt={copy.here.avatar.alt}
            loading="lazy"
            className="mx-auto size-32 rounded-full border-2 border-gold/50 object-cover sm:size-40"
          />
          <SectionTitle title={copy.here.title} titleClassName="text-[1.8rem] sm:text-[2.3rem]" className="mt-8" />
          <div className="copy-luxe mx-auto mt-8 max-w-[60ch] space-y-4 text-pretty">
            <p>
              {copy.here.lead}
              <a href={copy.here.handle.href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
                <strong>{copy.here.handle.label}</strong>
              </a>
            </p>
            {copy.here.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </motion.div>
      </Section>

      {/* Desktop-only on Kajabi too. */}
      <Section surface="raised" space="md" aria-label={copy.follow.title} className="hidden md:block">
        <h2 className="text-center font-display text-[1.8rem] text-white sm:text-[2.2rem]">{copy.follow.title}</h2>
        <ul className="mt-10 grid grid-cols-5 gap-4">
          {copy.follow.images.map((src, i) => (
            <li key={src}>
              <a
                href={copy.follow.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Instagram post ${i + 1} from @profitwithyvette`}
                className="block overflow-hidden rounded-xl border border-gold/20 transition-transform duration-500 ease-luxe hover:-translate-y-1"
              >
                <img src={src} alt="" loading="lazy" className="block aspect-[764/972] w-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
