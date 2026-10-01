import { Seo } from "@/components/Seo";
import { Cta, Prose } from "@/components/home/luxe/ProgramSections";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useHashScroll } from "@/hooks/useHashScroll";
import { BenefitCards, FramedImage, LabelledList, LeadMagnetForm, Rise, SignupCard, type ImageSpec } from "./parts";

/** Every button on her page scrolled to the form block Kajabi called #two-step. */
const GET_THE_GUIDE = "two-step";

export interface GuideLandingContent {
  readonly seo: { readonly title: string; readonly description: string };
  readonly hero: {
    readonly eyebrow: string;
    readonly title: string;
    readonly titleAccent: string;
    readonly lede: string;
    readonly cta: string;
    readonly image: ImageSpec;
  };
  readonly helpImage: ImageSpec;
  readonly benefits: ReadonlyArray<{ readonly title: string; readonly body: string }>;
  readonly benefitsCta: string;
  readonly passion: {
    readonly title: string;
    readonly paragraphs: readonly string[];
    readonly whyTitle: string;
    readonly why: ReadonlyArray<{ readonly label: string; readonly body: string }>;
    readonly image: ImageSpec;
  };
  readonly grab: { readonly title: string; readonly body: string; readonly submit: string; readonly image: ImageSpec };
  readonly guide: {
    readonly eyebrow: string;
    readonly title: string;
    readonly paragraphs: readonly string[];
    readonly cta: string;
    readonly photo: ImageSpec;
  };
  readonly ps: { readonly title: string; readonly body: string };
}

/**
 * The shape both of her free-guide landing pages share (/business-plan-guide
 * and /kickstartguide): hero, what the guide helps with, "you're a therapist
 * with a passion for helping others", the sign-up, meet your guide, and a P.S.
 * Each page passes its own words and the form it posts to.
 */
export function GuideLanding({
  content: c,
  formSlug,
  next,
  mockup,
}: {
  content: GuideLandingContent;
  formSlug: string;
  /** Her Kajabi thank-you page, rebuilt at the same address. */
  next: string;
  /** The kickstart page also shows the guide on a laptop. */
  mockup?: ImageSpec;
}) {
  // Links to …#two-step arrive through the router, which does not scroll to
  // fragments on its own.
  useHashScroll();
  const toForm = `#${GET_THE_GUIDE}`;

  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} image={c.grab.image.src} />

      <LuxePageHero
        eyebrow={c.hero.eyebrow}
        title={c.hero.title}
        titleAccent={c.hero.titleAccent}
        lede={c.hero.lede}
        tone="violet"
        actions={<Cta label={c.hero.cta} to={toForm} />}
        aside={<FramedImage image={c.hero.image} priority className="mx-auto max-w-[22rem]" />}
      />

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.5} aria-label="What this guide helps you do" containerClassName="max-w-6xl">
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
          <Rise className="mx-auto w-full max-w-md space-y-6 lg:sticky lg:top-28">
            {mockup && <FramedImage image={mockup} />}
            <FramedImage image={c.helpImage} />
          </Rise>
          <div className="min-w-0">
            <BenefitCards items={c.benefits} />
            <Cta label={c.benefitsCta} to={toForm} className="mt-10" />
          </div>
        </div>
      </Section>

      <Section surface="deep" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.passion.title} containerClassName="max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <Rise className="min-w-0">
            <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">
              {c.passion.title}
            </h2>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.passion.paragraphs} className="mt-7" />
            <p className="mt-8 text-[0.76rem] font-bold uppercase tracking-[0.18em] text-gold">{c.passion.whyTitle}</p>
            <LabelledList items={c.passion.why} className="mt-5" />
          </Rise>
          <Rise delay={0.1} className="mx-auto w-full max-w-sm">
            <FramedImage image={c.passion.image} imgClassName="aspect-[4/5] object-top" />
          </Rise>
        </div>
      </Section>

      <Section
        id={GET_THE_GUIDE}
        surface="base"
        space="lg"
        aurora="mixed"
        auroraIntensity={0.85}
        aria-label={c.grab.title}
        className="scroll-mt-20"
        containerClassName="max-w-5xl"
      >
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Rise className="mx-auto w-full max-w-sm">
            <FramedImage image={c.grab.image} />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <SignupCard title={c.grab.title} body={c.grab.body}>
              <LeadMagnetForm slug={formSlug} submitLabel={c.grab.submit} next={next} />
            </SignupCard>
          </Rise>
        </div>
      </Section>

      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.guide.eyebrow} containerClassName="max-w-6xl">
        <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Rise className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
            <FramedImage image={c.guide.photo} imgClassName="aspect-[4/5] object-top" />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <span className="eyebrow-luxe">{c.guide.eyebrow}</span>
            <h2 className="font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">{c.guide.title}</h2>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.guide.paragraphs} className="mt-7" />
            <Cta label={c.guide.cta} to={toForm} className="mt-10 sm:items-start" />
          </Rise>
        </div>
      </Section>

      <Section surface="deep" space="lg" aurora="gold" auroraIntensity={0.6} aria-label="P.S." containerClassName="max-w-3xl">
        <Rise className="text-center">
          <GoldRule className="mx-auto" />
          <h2 className="mt-7 text-balance font-display text-[1.6rem] italic leading-[1.3] text-white sm:text-[2rem]">
            {c.ps.title}
          </h2>
          <p className="copy-luxe mx-auto mt-5 max-w-[46ch] text-pretty">{c.ps.body}</p>
        </Rise>
      </Section>
    </>
  );
}
