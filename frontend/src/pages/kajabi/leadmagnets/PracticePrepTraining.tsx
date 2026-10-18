import { Seo } from "@/components/Seo";
import { Cta, MarkedList, Prose } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import {
  PRACTICE_PREP_FORM,
  PRACTICE_PREP_VIDEO_ROUTE,
  practicePrepTraining as c,
} from "@/content/practicePrepTraining";
import { useHashScroll } from "@/hooks/useHashScroll";
import { FramedImage, LeadMagnetForm, Rise, SignupCard } from "./parts";

/** Every button on her page jumps to the sign-up, which Kajabi called #register. */
const REGISTER = "register";

/**
 * /practicepreptraining — the free Practice Prep Training, "How to Prepare for
 * a Private Practice of Your Own" (the Club's free masterclass).
 *
 * Her page, section for section: the promise with the sign-up beside it, "does
 * this sound familiar?", the three things you'll learn, meet your host, and a
 * closing call. Signing up files a reply on the `practicepreptraining` form
 * (migration 122: a contact, the "Freebie: Practice Prep Training" tag, the
 * email with the link) and goes on to /preparing-for-pp-video, as her Kajabi
 * form did.
 */
export default function PracticePrepTraining() {
  // Links to …#register arrive through the router, which does not scroll to
  // fragments on its own.
  useHashScroll();
  const toForm = `#${REGISTER}`;

  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} image={c.host.photo.src} />

      <LuxePageHero
        eyebrow={c.hero.eyebrow}
        title={c.hero.title}
        titleAccent={c.hero.titleAccent}
        lede={c.hero.lede}
        tone="violet"
        actions={
          <div className="w-full">
            <p className="copy-luxe max-w-[40rem] text-pretty text-[0.95rem]">{c.hero.sub}</p>
            <ul className="mt-6 flex list-none flex-wrap gap-2.5">
              {c.hero.tags.map((tag) => (
                <li key={tag}>
                  <LuxePill accent="gold">{tag}</LuxePill>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[0.72rem] font-bold uppercase tracking-[0.18em] text-gold">{c.hero.host}</p>
          </div>
        }
        aside={
          <div id={REGISTER} className="mx-auto w-full max-w-md scroll-mt-24">
            <SignupCard eyebrow={c.signup.eyebrow} title={c.signup.title} body={c.signup.body}>
              <LeadMagnetForm
                slug={PRACTICE_PREP_FORM}
                submitLabel={c.signup.submit}
                next={PRACTICE_PREP_VIDEO_ROUTE}
                lastNameLabel="Last Name"
                question={c.signup.concern}
              />
            </SignupCard>
          </div>
        }
      />

      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.familiar.eyebrow} containerClassName="max-w-6xl">
        <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <Rise className="min-w-0">
            <span className="eyebrow-luxe">{c.familiar.eyebrow}</span>
            <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">
              {c.familiar.title}
              <span className="text-foil mt-1 block italic">{c.familiar.titleAccent}</span>
            </h2>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.familiar.paragraphs} className="mt-7" />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <GlassCard accent="green" interactive={false} spotlight={false} className="p-6 sm:p-8">
              <h3 className="text-balance font-display text-[1.3rem] font-medium leading-snug text-white sm:text-[1.5rem]">
                {c.familiar.forYouTitle}
              </h3>
              <MarkedList items={c.familiar.forYou} variant="check" className="mt-6" />
            </GlassCard>
          </Rise>
        </div>
        <Cta label={c.familiar.cta} to={toForm} className="mt-12" />
      </Section>

      <Section surface="base" space="lg" aurora="gold" auroraIntensity={0.5} aria-label={c.learn.title} containerClassName="max-w-6xl">
        <SectionTitle align="center" eyebrow={c.learn.eyebrow} title={c.learn.title} body={c.learn.body} />
        <ol className="mt-12 grid list-none gap-5 md:grid-cols-3">
          {c.learn.moves.map((move, i) => (
            <li key={move}>
              <Rise delay={0.06 * i} className="h-full">
                <GlassCard
                  accent={(["green", "plum", "gold"] as const)[i]}
                  interactive={false}
                  spotlight={false}
                  className="flex h-full flex-col p-6 sm:p-7"
                >
                  {/* The list is ordered, so the number is decoration. */}
                  <span aria-hidden className="font-body text-[1.6rem] font-bold tabular-nums leading-none text-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <GoldRule className="mt-5" width="w-10" />
                  <h3 className="mt-5 text-pretty font-display text-[1.2rem] font-medium leading-snug text-white sm:text-[1.3rem]">
                    {move}
                  </h3>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ol>
        <Cta label={c.learn.cta} to={toForm} className="mt-12" />
      </Section>

      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.host.eyebrow} containerClassName="max-w-6xl">
        <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Rise className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
            <FramedImage image={c.host.photo} imgClassName="aspect-[4/5] object-top" />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <span className="eyebrow-luxe">{c.host.eyebrow}</span>
            <h2 className="font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">{c.host.title}</h2>
            <p className="mt-3 text-[0.76rem] font-bold uppercase tracking-[0.18em] text-gold">{c.host.subtitle}</p>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.host.paragraphs} className="mt-7" />
            <Cta label={c.host.cta} to={toForm} className="mt-10 sm:items-start" />
          </Rise>
        </div>
      </Section>

      <Section surface="deep" space="lg" aurora="mixed" auroraIntensity={0.9} aria-label={c.closing.eyebrow} containerClassName="max-w-3xl">
        <Rise className="text-center">
          <span className="eyebrow-luxe">{c.closing.eyebrow}</span>
          <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.8rem]">
            {c.closing.title}
            <span className="text-foil mt-1 block italic">{c.closing.titleAccent}</span>
          </h2>
          <GoldRule className="mx-auto mt-7" />
          <p className="copy-luxe mx-auto mt-7 max-w-[46ch] text-pretty">{c.closing.body}</p>
          <div className="mt-10 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-center">
            <LuxeButton variant="foil" size="lg" href={toForm} className="tracking-[0.12em] sm:tracking-[0.18em]">
              {c.closing.cta}
            </LuxeButton>
            <LuxeButton variant="glass" size="lg" to={c.closing.secondary.to} className="tracking-[0.12em] sm:tracking-[0.18em]">
              {c.closing.secondary.label}
            </LuxeButton>
          </div>
        </Rise>
      </Section>
    </>
  );
}
