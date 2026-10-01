import { Seo } from "@/components/Seo";
import { Cta, Prose, Pull } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { fiveStepMarketing as c } from "@/content/leadMagnets";
import { cn } from "@/lib/cn";
import { FramedImage, Rise } from "./parts";

/** Both "Get the Free Marketing Plan" buttons go to the form page, as on Kajabi. */
const FORM_PAGE = "/marketing-step-form";

/**
 * /5-step-marketing — the 5-Step Marketing Plan landing page.
 *
 * Her Kajabi page section for section: hero with the plan's cover, what you
 * walk away with, who it is for, a note from Yvette, and the closing call.
 * Its buttons go to /marketing-step-form, where the sign-up is — the same split
 * her Kajabi pages had.
 */
export default function FiveStepMarketing() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} image={c.about.photo.src} />

      <LuxePageHero
        eyebrow={c.hero.eyebrow}
        title={c.hero.title}
        titleAccent={c.hero.titleAccent}
        lede={c.hero.lede}
        tone="violet"
        actions={
          <>
            <LuxeButton variant="foil" size="lg" to={FORM_PAGE}>
              {c.hero.cta}
            </LuxeButton>
            <LuxeButton variant="glass" size="sm" to="/resource-hub" className="min-h-[44px] tracking-[0.1em]">
              {c.back}
            </LuxeButton>
            <p className="w-full text-pretty text-sm font-light leading-[1.7] text-orchid-faint">{c.hero.meta}</p>
          </>
        }
        aside={<PlanCover />}
      />

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.5} aria-label={c.walkAway.eyebrow} containerClassName="max-w-4xl">
        <SectionTitle align="center" eyebrow={c.walkAway.eyebrow} title={c.walkAway.title} body={c.walkAway.body} />
        <ol className="mt-10 grid list-none gap-3 sm:grid-cols-5">
          {c.walkAway.steps.map((step, i) => (
            <li key={step}>
              <Rise delay={0.05 * i} className="h-full">
                <GlassCard accent="gold" interactive={false} spotlight={false} className="flex h-full flex-col items-center gap-3 p-5 text-center">
                  <span aria-hidden className="text-[1.6rem] font-bold leading-none tabular-nums text-gold">
                    {i + 1}
                  </span>
                  <span className="text-pretty text-sm font-semibold leading-snug text-white">{step}</span>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ol>
        <Pull className="mt-12">{c.walkAway.closing}</Pull>
      </Section>

      <Section surface="deep" space="lg" aurora="green" auroraIntensity={0.5} aria-label={c.who.eyebrow} containerClassName="max-w-3xl">
        <SectionTitle align="center" eyebrow={c.who.eyebrow} title={c.who.title} titleClassName="text-[1.6rem] sm:text-[2rem] lg:text-[2.3rem]" />
        <Rise delay={0.1}>
          <p className="copy-luxe mx-auto mt-8 max-w-[62ch] text-pretty text-center">{c.who.body}</p>
        </Rise>
      </Section>

      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.about.eyebrow} containerClassName="max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <Rise>
            <FramedImage image={c.about.photo} imgClassName="aspect-[3/2]" />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <span className="eyebrow-luxe">{c.about.eyebrow}</span>
            <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">
              {c.about.title}
            </h2>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.about.paragraphs} className="mt-7" />
            <p className="mt-7 text-[0.78rem] font-semibold uppercase leading-relaxed tracking-[0.12em] text-gold">
              {c.about.signature}
            </p>
          </Rise>
        </div>
      </Section>

      <Section surface="base" space="xl" aurora="mixed" auroraIntensity={0.85} aria-label={c.cta.eyebrow} containerClassName="max-w-2xl">
        <SectionTitle align="center" eyebrow={c.cta.eyebrow} title={c.cta.title} body={c.cta.body} />
        <Cta label={c.cta.button} to={FORM_PAGE} className="mt-10" note={c.cta.privacy} />
      </Section>
    </>
  );
}

/** The plan's cover, set in type the way her page draws it. */
function PlanCover({ className }: { className?: string }) {
  const { mockup } = c;
  return (
    <div className={cn("relative mx-auto w-full max-w-[21rem]", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{ background: "radial-gradient(62% 55% at 50% 32%, rgba(123,94,167,0.42) 0%, transparent 72%)" }}
      />
      <GlassCard accent="gold" interactive={false} spotlight={false} className="px-7 py-9 sm:px-9">
        <p className="text-balance font-display text-[1.7rem] leading-[1.12] text-white sm:text-[1.95rem]">{mockup.title}</p>
        <p className="mt-2 text-sm font-light text-orchid-dim">{mockup.sub}</p>
        <GoldRule className="mt-5" width="w-12" />
        <ol className="mt-5 list-none space-y-3">
          {mockup.steps.map((step, i) => (
            <li key={step} className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 text-[0.8rem] font-semibold text-gold"
              >
                {i + 1}
              </span>
              <span className="text-sm text-white">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-gold">{mockup.brand}</p>
      </GlassCard>
    </div>
  );
}
