import { motion } from "motion/react";
import { Link } from "react-router";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { linkInBio as copy } from "@/content/kajabiPages";
import { LinkCards, rise } from "./shared";

/**
 * /link-in-bio — the Instagram link hub.
 *
 * Kajabi's custom-code page, top to bottom: portrait and promise, the four
 * groups of links, four testimonials, a short bio, socials and policies. One
 * narrow column, because the reader is on a phone that just left Instagram.
 */
export default function LinkInBio() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} />

      <Section surface="deep" space="lg" aurora="violet" auroraIntensity={0.85} aria-label={copy.name} containerClassName="max-w-2xl">
        <motion.div {...rise(reduce)} className="text-center">
          <div className="mx-auto w-36 overflow-hidden rounded-full border-2 border-gold/50 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] sm:w-44">
            <img src={copy.portrait.src} alt={copy.portrait.alt} className="block aspect-square w-full object-cover object-top" />
          </div>
          <h1 className="mt-8 text-balance font-display text-[2.1rem] font-normal leading-[1.1] text-white sm:text-[2.7rem]">
            {copy.title}
          </h1>
          <p className="mt-5 text-lg font-semibold text-white">{copy.name}</p>
          <p className="text-sm text-gold">{copy.handle}</p>
          <p className="copy-luxe mx-auto mt-5 max-w-[52ch] text-pretty">{copy.bio}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {copy.credentials.map((c) => (
              <LuxePill key={c} accent="gold">
                {c}
              </LuxePill>
            ))}
          </div>
          <p className="mt-7 font-display text-[1.35rem] italic text-foil">{copy.tagline}</p>
          <p className="mx-auto mt-4 max-w-[52ch] text-pretty text-sm leading-[1.7] text-orchid-dim">{copy.intro}</p>
        </motion.div>

        {copy.groups.map((group) => (
          <div key={group.heading} className="mt-12">
            <h2 className="text-center text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-gold">
              {group.heading}
            </h2>
            <GoldRule width="w-10" className="mx-auto mt-3" />
            <LinkCards items={group.links} className="mt-6" />
          </div>
        ))}
      </Section>

      <Section surface="raised" space="md" aria-label={copy.testimonialsHeading} containerClassName="max-w-4xl">
        <h2 className="text-center font-display text-[1.8rem] text-white sm:text-[2.2rem]">{copy.testimonialsHeading}</h2>
        <RevealGroup className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {copy.testimonials.map((t) => (
            <RevealItem key={t.name} className="h-full">
              <GlassCard accent="plum" interactive={false} className="flex h-full flex-col p-6 sm:p-7">
                <p aria-label="Five stars" className="text-gold">
                  ★★★★★
                </p>
                <blockquote className="mt-4 flex-1 text-pretty leading-[1.75] text-orchid">{t.quote}</blockquote>
                <div className="mt-6 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold/15 font-sans font-bold text-gold"
                  >
                    {t.initial}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{t.name}</span>
                    <span className="block text-xs text-orchid-dim">{t.practice}</span>
                  </span>
                </div>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section surface="base" space="md" aria-label={copy.about.eyebrow} containerClassName="max-w-2xl">
        <motion.div {...rise(reduce)} className="text-center">
          <span className="eyebrow-luxe">{copy.about.eyebrow}</span>
          <p className="font-display text-[1.6rem] text-white">{copy.about.name}</p>
          <p className="text-sm text-gold">{copy.about.role}</p>
          <p className="copy-luxe mt-6 text-pretty">{copy.about.body}</p>

          <ul className="mt-8 flex flex-wrap justify-center gap-3">
            {copy.socials.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center rounded-full border border-white/20 px-5 text-sm text-white/85 transition-colors duration-300 hover:border-gold/60 hover:text-white"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>

          <nav aria-label="Policies" className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-orchid-faint">
            {copy.policies.map((p) => (
              <Link key={p.to} to={p.to} className="min-h-[44px] content-center transition-colors duration-300 hover:text-gold">
                {p.label}
              </Link>
            ))}
          </nav>
        </motion.div>
      </Section>
    </>
  );
}
