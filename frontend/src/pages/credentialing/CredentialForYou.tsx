import { Check } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { credentialForYou as copy, START_DATE_LINES } from "@/content/credentialForYou";
import { cn } from "@/lib/cn";

/**
 * /credential-for-you — the sales page for the done-for-you credentialing
 * service (sheet row 214), rebuilt natively from the HTML the owner supplied.
 * A supporting service reached from Resources, not a fourth program.
 *
 * Prices are in the body font, bold and tabular; the serif is for headings only.
 */

/** The label over a card, and over each block of the page's small print. */
const LABEL = "text-[0.68rem] font-bold uppercase tracking-[0.16em] text-gold";
const PRICE = "font-body text-[1.45rem] font-bold leading-snug tabular-nums text-gold";

function CheckList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("grid list-none gap-2.5", className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-orchid">
          <Check aria-hidden className="mt-1 size-3.5 flex-none text-gold" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BulletList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("list-disc space-y-2 pl-5 text-sm leading-relaxed text-orchid marker:text-gold", className)}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function CredentialForYou() {
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} />

      <LuxePageHero
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        titleAccent={copy.hero.titleAccent}
        tone="mixed"
        lede={copy.hero.lede}
        actions={
          <>
            <LuxeButton variant="foil" size="lg" href="#services" className="w-full sm:w-auto">
              {copy.hero.primary}
            </LuxeButton>
            <LuxeButton variant="glass" size="lg" href="#process" className="w-full sm:w-auto">
              {copy.hero.secondary}
            </LuxeButton>
            {/* Her mock-up's top-bar button, which she hides on a phone. */}
            <LuxeButton variant="quiet" size="sm" href="#services" className="hidden sm:inline-flex">
              {copy.hero.options}
            </LuxeButton>
          </>
        }
        aside={
          <GlassCard accent="gold" interactive={false} className="p-6 sm:p-8">
            <h2 className="font-display text-[1.35rem] font-medium leading-snug text-white">{copy.hero.cardTitle}</h2>
            <CheckList items={copy.hero.cardItems} className="mt-4" />
          </GlassCard>
        }
      />

      <Section surface="raised" space="lg" aria-label={copy.intro.title} containerClassName="max-w-6xl">
        <SectionTitle eyebrow={copy.intro.eyebrow} title={copy.intro.title} body={copy.intro.body} className="max-w-3xl" />
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {copy.intro.questions.map((question) => (
            <GlassCard key={question} accent="plum" interactive={false} className="p-6">
              <p className="font-display text-[1.08rem] leading-snug text-white">{question}</p>
            </GlassCard>
          ))}
        </div>
      </Section>

      <Section id="services" surface="base" space="lg" aria-label={copy.services.title} className="scroll-mt-24" containerClassName="max-w-6xl">
        <SectionTitle eyebrow={copy.services.eyebrow} title={copy.services.title} body={copy.services.body} className="max-w-3xl" />
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {copy.services.cards.map((card) => (
            <GlassCard
              key={card.title}
              as="article"
              accent={card.featured ? "gold" : "plum"}
              interactive={false}
              className={cn(
                "flex h-full flex-col p-6 sm:p-8",
                card.featured && "outline outline-1 -outline-offset-1 outline-gold/35",
              )}
            >
              <p className={LABEL}>{card.label}</p>
              <h3 className="mt-2 font-display text-[1.45rem] font-medium leading-snug text-white">{card.title}</h3>
              <p className={cn(PRICE, "mt-3")}>{card.price}</p>
              <p className="copy-luxe mt-4 text-pretty">{card.body}</p>
              <BulletList items={card.items} className="mb-7 mt-4" />
              <LuxeButton variant={card.featured ? "foil" : "gild"} size="md" to={card.cta.to} className="mt-auto w-full">
                {card.cta.label}
              </LuxeButton>
            </GlassCard>
          ))}
        </div>
      </Section>

      <Section surface="raised" space="lg" aria-label={copy.package.title} containerClassName="max-w-4xl">
        <GlassCard accent="gold" interactive={false} className="p-6 sm:p-10">
          <span className="eyebrow-luxe">{copy.package.eyebrow}</span>
          <h2 className="font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">{copy.package.title}</h2>
          <p className={cn(PRICE, "mt-4")}>{copy.package.price}</p>
          <p className="copy-luxe mt-4 text-pretty">{copy.package.body}</p>
          <CheckList items={copy.package.items} className="mt-6 sm:grid-cols-2 sm:gap-x-8" />
          <div className="copy-luxe mt-6 space-y-3 text-pretty">
            {copy.package.scope.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <LuxeButton variant="foil" size="lg" to={copy.package.cta.to} className="mt-7 w-full sm:w-auto">
            {copy.package.cta.label}
          </LuxeButton>
        </GlassCard>
      </Section>

      <Section surface="base" space="lg" aria-label={copy.additional.title} containerClassName="max-w-6xl">
        <SectionTitle eyebrow={copy.additional.eyebrow} title={copy.additional.title} />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {copy.additional.cards.map((card) => (
            <GlassCard key={card.title} accent="plum" interactive={false} className="flex h-full flex-col p-6">
              <h3 className="font-body text-[0.98rem] font-bold leading-snug text-white">{card.title}</h3>
              <p className="mb-6 mt-2 text-sm leading-relaxed text-orchid tabular-nums">{card.price}</p>
              <LuxeButton variant="gild" size="sm" to={card.to} className="mt-auto w-full">
                {card.cta}
              </LuxeButton>
            </GlassCard>
          ))}
        </div>
      </Section>

      <Section id="process" surface="raised" space="lg" aria-label={copy.process.title} className="scroll-mt-24" containerClassName="max-w-6xl">
        <SectionTitle eyebrow={copy.process.eyebrow} title={copy.process.title} className="max-w-3xl" />
        <ol className="mt-10 grid list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {copy.process.steps.map((step) => (
            <li key={step.number} className="border-t-[3px] border-gold pt-5">
              <span className="font-body text-[0.68rem] font-bold uppercase tracking-[0.16em] tabular-nums text-gold">{step.number}</span>
              <h3 className="mt-2 font-display text-[1.18rem] font-medium leading-snug text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-orchid">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mx-auto mt-10 max-w-3xl rounded-r-xl border-l-4 border-gold bg-gold/[0.08] px-6 py-5 text-[0.98rem] font-semibold leading-relaxed text-white">
          {START_DATE_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </Section>

      <Section surface="base" space="lg" aria-label={copy.prepare.eyebrow} containerClassName="max-w-6xl">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[copy.prepare, copy.role].map((box) => (
            <GlassCard key={box.title} accent="plum" interactive={false} className="p-6 sm:p-8">
              <p className={LABEL}>{box.eyebrow}</p>
              <h3 className="mt-2 font-display text-[1.45rem] font-medium leading-snug text-white">{box.title}</h3>
              <BulletList items={box.items} className="mt-4" />
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* The checkout's required box links here, so the id is part of migration 181. */}
      <Section id="disclaimer" surface="deep" space="lg" aria-label={copy.disclaimer.eyebrow} className="scroll-mt-24" containerClassName="max-w-4xl">
        <SectionTitle eyebrow={copy.disclaimer.eyebrow} title={copy.disclaimer.title} align="left" className="max-w-none" />
        <div className="copy-luxe mt-6 space-y-4 text-pretty">
          <p>{copy.disclaimer.body}</p>
          <p>{copy.disclaimer.lead}</p>
          <BulletList items={copy.disclaimer.items} />
          <p>{copy.disclaimer.closing}</p>
          <p>{copy.disclaimer.guarantee}</p>
          <p>{copy.disclaimer.refund}</p>
        </div>
      </Section>

      <Section surface="raised" space="lg" aurora="mixed" auroraIntensity={0.7} aria-label={copy.final.eyebrow} containerClassName="max-w-3xl">
        <SectionTitle eyebrow={copy.final.eyebrow} title={copy.final.title} body={copy.final.body} className="max-w-none" />
        <div className="mt-8 flex justify-center">
          <LuxeButton variant="foil" size="lg" href="#services" className="w-full sm:w-auto">
            {copy.final.cta}
          </LuxeButton>
        </div>
      </Section>
    </>
  );
}
