import { Seo } from "@/components/Seo";
import { Cta, MarkedList, Prose } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { practicePrepVideo as c } from "@/content/practicePrepTraining";
import { FramedImage, RecordingPlayer, Rise } from "./parts";

/**
 * /preparing-for-pp-video — where the Practice Prep Training sign-up lands:
 * the recording, then her invitation into the Club (next step, what's inside,
 * the first month, and the enrolment button).
 *
 * The recording plays from this site's media library (/uploads/), so it needs
 * no third-party player or frame. Noindex: it is the page behind a sign-up.
 */
export default function PracticePrepVideo() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} noindex />

      <LuxePageHero
        eyebrow={c.hero.eyebrow}
        title={c.hero.title}
        lede={c.hero.lede}
        tone="mixed"
        align="center"
        actions={<p className="copy-luxe w-full text-pretty text-center italic">{c.hero.sub}</p>}
      />

      <Section surface="base" space="md" aria-label={c.video.title} containerClassName="max-w-4xl">
        <Rise>
          <RecordingPlayer url={c.video.url} poster={c.video.poster} captions={c.video.captions} title={c.video.title} />
        </Rise>
        <Rise delay={0.08} className="mt-8 text-center">
          <p className="copy-luxe mx-auto max-w-[52ch] text-pretty">{c.video.after}</p>
          <LuxeButton variant="foil" size="lg" to="/club" className="mt-8 w-full sm:w-auto">
            {c.video.cta}
          </LuxeButton>
        </Rise>
      </Section>

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.5} aria-label={c.nextStep.title} containerClassName="max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Rise className="mx-auto w-full max-w-xl">
            <FramedImage image={c.nextStep.image} />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <span className="eyebrow-luxe">{c.nextStep.eyebrow}</span>
            <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">
              {c.nextStep.title}
            </h2>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.nextStep.paragraphs} className="mt-7" />
            <p className="mt-5 text-pretty font-semibold text-white">{c.nextStep.strong}</p>
            <Cta label={c.nextStep.cta} to="/club" className="mt-9 sm:items-start" />
          </Rise>
        </div>
      </Section>

      <Section surface="base" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.support.eyebrow} containerClassName="max-w-6xl">
        <SectionTitle
          align="center"
          eyebrow={c.support.eyebrow}
          title={`${c.support.title} ${c.support.titleAccent}`}
        />
        <ul className="mt-12 grid list-none gap-5 sm:grid-cols-2">
          {c.support.items.map((item, i) => (
            <li key={item.title}>
              <Rise delay={0.05 * i} className="h-full">
                <GlassCard
                  accent={(["green", "plum", "gold", "green"] as const)[i % 4]}
                  interactive={false}
                  spotlight={false}
                  className="h-full p-6 sm:p-7"
                >
                  <h3 className="text-pretty font-display text-[1.2rem] font-medium leading-snug text-white sm:text-[1.35rem]">
                    {item.title}
                  </h3>
                  <p className="copy-luxe mt-3 text-pretty text-[0.95rem]">{item.body}</p>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="raised" space="lg" aurora="violet" auroraIntensity={0.5} aria-label={c.firstMonth.title} containerClassName="max-w-3xl">
        <Rise>
          <SectionTitle align="center" eyebrow={c.firstMonth.eyebrow} title={c.firstMonth.title} />
          <GlassCard accent="gold" interactive={false} spotlight={false} className="mt-10 p-6 sm:p-8">
            <MarkedList items={c.firstMonth.steps} variant="check" />
          </GlassCard>
          <p className="copy-luxe mx-auto mt-8 max-w-[52ch] text-pretty text-center">{c.firstMonth.body}</p>
        </Rise>
      </Section>

      <Section surface="deep" space="lg" aurora="mixed" auroraIntensity={0.9} aria-label={c.closing.title} containerClassName="max-w-3xl">
        <Rise className="text-center">
          <span className="eyebrow-luxe">{c.closing.eyebrow}</span>
          <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.8rem]">
            {c.closing.title}
          </h2>
          <GoldRule className="mx-auto mt-7" />
          <p className="copy-luxe mx-auto mt-7 max-w-[50ch] text-pretty">{c.closing.body}</p>
          <Cta label={c.closing.cta} to="/club" note={c.closing.note} className="mt-10" />
        </Rise>
      </Section>
    </>
  );
}
