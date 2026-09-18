import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import {
  Cta,
  FounderLetter,
  MarkedList,
  ProgramFaq,
  Prose,
  Pull,
  QuoteCard,
  accentAt,
  rise,
} from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { CLUB_JOIN_ROUTE, club } from "@/content/club";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { ORGANIZATION_ID, absoluteUrl, faqPageNode } from "@/seo/schema";
import type { JsonLdNode } from "@/seo/types";
import { useHeadContext } from "@/ssr/context";

/**
 * The Boss Clinician Club — `/club`, at the path the source site sells it from.
 *
 * The argument runs in the source page's order: who it is for → the DIY years →
 * the warning → three starting points → the programme → five pillars → bonuses
 * → proof → pace → value → price → the next move → Yvette's letter →
 * objections. Copy lives in content/club.ts and is the published wording.
 *
 * Every mid-page action scrolls to the pricing band (`#join`), exactly as the
 * source's do; only the pricing band's own button leaves the page.
 */

const PORTRAIT = "/images/758479b0818b.png";
const JOIN_ANCHOR = "#join";

/**
 * The programme as a priced product, with both published payment options. The
 * prices are parsed out of the strings the pricing band prints, so the markup
 * cannot quote different money from the page.
 */
function productNode(origin: string): JsonLdNode {
  const offers: JsonLdNode[] = [];
  for (const option of club.pricing.options) {
    const match = /\$([\d,]+)/.exec(option.price);
    if (!match) continue;
    offers.push({
      "@type": "Offer",
      name: `${option.price} ${option.terms}`,
      price: match[1].replace(/,/g, ""),
      priceCurrency: "USD",
      url: absoluteUrl(origin, "/club"),
      availability: "https://schema.org/InStock",
      seller: { "@id": `${origin}/${ORGANIZATION_ID}` },
    });
  }

  return {
    "@type": "Product",
    name: "The Boss Clinician Club",
    description: club.seo.description,
    url: absoluteUrl(origin, "/club"),
    image: absoluteUrl(origin, PORTRAIT),
    brand: { "@id": `${origin}/${ORGANIZATION_ID}` },
    offers,
  };
}

export default function Club() {
  const { origin } = useHeadContext();

  return (
    <>
      <Seo
        title={club.seo.title}
        description={club.seo.description}
        image={PORTRAIT}
        jsonLd={[productNode(origin), faqPageNode(origin, "/club", club.faq.items)]}
      />

      <LuxePageHero
        eyebrow={club.hero.eyebrow}
        title={club.hero.title}
        titleAccent={club.hero.titleAccent}
        tone="mixed"
        align="center"
        lede={
          <>
            <span className="block">{club.hero.lede[0]}</span>
            <span className="mt-5 block">{club.hero.lede[1]}</span>
          </>
        }
        actions={
          <div className="flex w-full flex-col items-center gap-5">
            <LuxeButton
              variant="foil"
              size="lg"
              href={JOIN_ANCHOR}
              className="w-full tracking-[0.14em] sm:w-auto sm:tracking-[0.2em]"
            >
              {club.hero.cta}
            </LuxeButton>
            <p className="copy-luxe max-w-xl text-pretty text-sm">{club.hero.includes}</p>
            <LuxePill accent="gold">{club.hero.bonus}</LuxePill>
          </div>
        }
      />

      <AudienceBand />
      <TaughtSection />
      <StartSection />
      <HoldingBackSection />
      <WarningSection />
      <PersonasSection />
      <EnterSection />
      <PillarsSection />
      <BonusesSection />
      <TestimonialsSection />
      <PaceSection />
      <ValueSection />
      <NextMoveSection />
      <FounderLetter
        eyebrow={club.founder.eyebrow}
        title={club.founder.title}
        paragraphs={club.founder.paragraphs}
        signoff={club.founder.signoff}
        signature={club.founder.signature}
        image={PORTRAIT}
        imageAlt="Yvette Howard, LCSW"
      />
      <ProgramFaq title={club.faq.title} items={club.faq.items}>
        <Cta label={club.faq.cta} to={JOIN_ANCHOR} />
      </ProgramFaq>
      <AccreditationSection />
    </>
  );
}

/* ── Who this is for — the source's banner line ───────────────────────── */

function AudienceBand() {
  return (
    <Section surface="raised" space="sm" aria-label="Who the Club is for">
      <p className="mx-auto max-w-3xl text-balance text-center text-[0.78rem] font-semibold uppercase leading-[1.9] tracking-[0.16em] text-gold/90">
        {club.hero.banner}
      </p>
    </Section>
  );
}

/* ── 1 · Nobody taught you the business ───────────────────────────────── */

function TaughtSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aurora="plum" auroraIntensity={0.45} aria-label={club.taught.title}>
      <SectionTitle title={club.taught.title} className="max-w-3xl" />
      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-10 max-w-2xl">
        <Prose paragraphs={club.taught.paragraphs} align="center" />
      </motion.div>
      <Pull className="mt-12">{club.taught.closing}</Pull>
    </Section>
  );
}

/* ── 2 · Are you ever going to start? ─────────────────────────────────── */

function StartSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="raised" space="lg" aria-label={club.start.title} containerClassName="max-w-3xl">
      <SectionTitle title={club.start.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <Prose paragraphs={club.start.intro} />
        <GlassCard accent="plum" interactive={false} className="mt-8 p-7 sm:p-8">
          <MarkedList items={club.start.tried} />
        </GlassCard>
        <p className="mt-8 text-pretty font-display text-[1.25rem] italic leading-[1.45] text-white">
          {club.start.outro}
        </p>
      </motion.div>
    </Section>
  );
}

/* ── 3 · Why you keep holding back ────────────────────────────────────── */

function HoldingBackSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="lg"
      aurora="violet"
      auroraIntensity={0.5}
      aria-label={club.holdingBack.title}
      containerClassName="max-w-3xl"
    >
      <SectionTitle title={club.holdingBack.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <Prose paragraphs={club.holdingBack.paragraphs} />
      </motion.div>
      <Pull className="mt-12">&ldquo;{club.holdingBack.quote}&rdquo;</Pull>
      <Cta label={club.holdingBack.cta} to={JOIN_ANCHOR} className="mt-10" />
    </Section>
  );
}

/* ── 4 · The part nobody warns you about ──────────────────────────────── */

function WarningSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aria-label={club.warning.title} containerClassName="max-w-3xl">
      <SectionTitle title={club.warning.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <Prose paragraphs={club.warning.paragraphs} />
      </motion.div>

      <motion.div {...rise(reduce, 0.15)} className="mt-12">
        <GlassCard accent="gold" interactive={false} className="p-7 text-center sm:p-10">
          <h3 className="text-balance font-display text-[1.4rem] font-medium leading-[1.3] text-white sm:text-[1.7rem]">
            {club.warning.meetsYou}
          </h3>
          <GoldRule className="mx-auto mt-6" />
          <p className="copy-luxe mx-auto mt-6 max-w-xl text-pretty">{club.warning.meetsYouBody}</p>
          <p className="mt-7 text-[0.72rem] font-bold uppercase tracking-[0.2em] text-gold">
            {club.warning.closing}
          </p>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── 5 · Three starting points ────────────────────────────────────────── */

function PersonasSection() {
  return (
    <Section surface="raised" space="lg" aurora="mixed" auroraIntensity={0.5} aria-label={club.personas.title}>
      <SectionTitle title={club.personas.title} body={club.personas.subtitle} />

      <RevealGroup
        as="ul"
        className="mx-auto mt-12 grid max-w-md list-none grid-cols-1 items-stretch gap-6 lg:max-w-none lg:grid-cols-3"
      >
        {club.personas.items.map((persona, i) => (
          <RevealItem key={persona.label} as="li" className="h-full">
            <GlassCard as="article" accent={accentAt(i)} className="flex h-full flex-col p-7 sm:p-8">
              <LuxePill accent={accentAt(i)} className="self-start">
                {persona.label}
              </LuxePill>
              <h3 className="mt-5 text-balance font-display text-[1.35rem] font-medium leading-[1.25] text-white">
                {persona.title}
              </h3>
              <GoldRule width="w-10" className="mt-5" />
              <Prose paragraphs={persona.paragraphs} className="mt-5 flex-1 text-sm" />
              <p className="mt-7 font-display text-[1.05rem] italic text-gold">{persona.tagline}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <Pull className="mt-14">{club.personas.closing}</Pull>
    </Section>
  );
}

/* ── 6 · Enter the Club ───────────────────────────────────────────────── */

function EnterSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="lg"
      aurora="gold"
      auroraIntensity={0.4}
      aria-label={club.enter.title}
      containerClassName="max-w-3xl"
    >
      <SectionTitle eyebrow={club.enter.eyebrow} title={club.enter.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <Prose paragraphs={club.enter.paragraphs} />
      </motion.div>
      <Cta label={club.enter.cta} to={JOIN_ANCHOR} className="mt-12" />
    </Section>
  );
}

/* ── 7 · Five pillars ─────────────────────────────────────────────────── */

function PillarsSection() {
  return (
    <Section surface="base" space="lg" aria-label={club.pillars.title}>
      <SectionTitle
        eyebrow={club.pillars.eyebrow}
        title={club.pillars.title}
        body={club.pillars.body}
      />

      {/* Five items: the first spans the row so the remaining four sit 2 × 2
          instead of leaving an orphan under a 3-up grid. */}
      <RevealGroup as="ul" className="mt-12 grid list-none grid-cols-1 gap-6 md:grid-cols-2">
        {club.pillars.items.map((pillar, i) => (
          <RevealItem key={pillar.label} as="li" className={i === 0 ? "h-full md:col-span-2" : "h-full"}>
            <GlassCard as="article" accent={i === 0 ? "gold" : accentAt(i)} className="flex h-full flex-col p-7 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-gold/80">
                  {pillar.label}
                </span>
                {pillar.badge && <LuxePill accent="gold">{pillar.badge}</LuxePill>}
              </div>
              <h3 className="mt-4 text-balance font-display text-[1.4rem] font-medium leading-[1.25] text-white">
                {pillar.title}
              </h3>
              <p className="copy-luxe mt-4 text-pretty text-[0.95rem]">{pillar.body}</p>
              {pillar.finePrint && (
                <p className="mt-5 border-t border-white/[0.07] pt-5 text-pretty text-xs leading-[1.7] text-orchid">
                  {pillar.finePrint}
                </p>
              )}
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 8 · Bonuses ──────────────────────────────────────────────────────── */

function BonusesSection() {
  return (
    <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.35} aria-label={club.bonuses.title}>
      <SectionTitle title={club.bonuses.title} body={club.bonuses.body} />

      <RevealGroup
        as="ul"
        className="mx-auto mt-12 grid max-w-4xl list-none grid-cols-1 gap-6 md:grid-cols-2"
      >
        {club.bonuses.items.map((bonus, i) => (
          <RevealItem key={bonus.title} as="li" className="h-full">
            <GlassCard as="article" accent={i === 0 ? "gold" : "plum"} className="flex h-full flex-col p-7 sm:p-8">
              <LuxePill accent={i === 0 ? "gold" : "plum"} className="self-start">
                {bonus.label}
              </LuxePill>
              <h3 className="mt-5 text-balance font-display text-[1.35rem] font-medium leading-[1.25] text-white">
                {bonus.title}
              </h3>
              <p className="copy-luxe mt-4 flex-1 text-pretty text-[0.95rem]">{bonus.body}</p>
              <p className="mt-6 text-pretty text-xs font-semibold uppercase leading-[1.7] tracking-[0.12em] text-gold/85">
                {bonus.note}
              </p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <Pull className="mt-14">{club.bonuses.closing}</Pull>
      <Cta label={club.bonuses.cta} to={JOIN_ANCHOR} className="mt-10" />
    </Section>
  );
}

/* ── 9 · Proof ────────────────────────────────────────────────────────── */

function TestimonialsSection() {
  return (
    <Section surface="deep" space="lg" aria-label={club.testimonials.title}>
      <SectionTitle title={club.testimonials.title} />
      <RevealGroup
        as="ul"
        className="mx-auto mt-12 grid max-w-5xl list-none grid-cols-1 gap-6 md:grid-cols-2"
      >
        {club.testimonials.items.map((item, i) => (
          <RevealItem key={item.name} as="li" className="h-full">
            <QuoteCard quote={item.quote} name={item.name} accent={accentAt(i)} />
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 10 · Pace ────────────────────────────────────────────────────────── */

function PaceSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aria-label={club.pace.title} containerClassName="max-w-3xl">
      <SectionTitle eyebrow={club.pace.eyebrow} title={club.pace.title} body={club.pace.body} />

      {/* The source runs a slider here. Its one worked example is kept as a
          static figure; the numbers are the page's own. */}
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <GlassCard accent="green" interactive={false} className="p-7 text-center sm:p-10">
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-orchid">
            {club.pace.exampleLabel}
          </p>
          <p className="mt-6 text-[0.7rem] font-bold uppercase tracking-[0.2em] text-gold/80">
            {club.pace.exampleResultLabel}
          </p>
          <p className="text-foil mt-3 font-display text-[2.4rem] font-medium leading-none sm:text-[3rem]">
            {club.pace.exampleResult}
          </p>
          <p className="copy-luxe mx-auto mt-6 max-w-lg text-pretty text-sm">{club.pace.exampleBody}</p>
        </GlassCard>
        <Prose paragraphs={club.pace.paragraphs} align="center" className="mt-10" />
      </motion.div>

      <Pull className="mt-10">{club.pace.closing}</Pull>
    </Section>
  );
}

/* ── 11 · Value and price ─────────────────────────────────────────────── */

function ValueSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="join"
      surface="raised"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.55}
      aria-label={club.value.title}
      className="scroll-mt-24"
      containerClassName="max-w-4xl"
    >
      <SectionTitle eyebrow={club.value.eyebrow} title={club.value.title} />

      <motion.div {...rise(reduce, 0.1)} className="mt-12">
        <GlassCard accent="gold" interactive={false} className="p-7 sm:p-10">
          <h3 className="text-balance text-center font-display text-[1.45rem] font-medium leading-[1.3] text-white sm:text-[1.75rem]">
            {club.value.subtitle}
          </h3>
          <p className="copy-luxe mx-auto mt-5 max-w-2xl text-pretty text-center">{club.value.body}</p>

          <ul className="mt-9 divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {club.value.items.map((item) => (
              <li
                key={item.name}
                className="flex flex-col gap-1.5 py-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
              >
                <div className="min-w-0">
                  <p className="font-display text-[1.1rem] font-medium text-white">{item.name}</p>
                  <p className="copy-luxe mt-1 text-pretty text-sm">{item.detail}</p>
                </div>
                <p className="shrink-0 whitespace-nowrap text-sm font-semibold text-gold">{item.worth}</p>
              </li>
            ))}
          </ul>

          <h3 className="mt-10 text-balance text-center text-[0.74rem] font-bold uppercase tracking-[0.2em] text-gold/85">
            {club.pricing.title}
          </h3>

          <div className="mt-7 flex flex-col items-center justify-center gap-5 sm:flex-row sm:gap-10">
            {club.pricing.options.map((option, i) => (
              <div key={option.price} className="flex items-center gap-5 sm:gap-10">
                {i > 0 && (
                  <span aria-hidden className="hidden font-display text-lg italic text-orchid sm:block">
                    or
                  </span>
                )}
                <p className="text-center">
                  <span className="text-foil block font-display text-[2.4rem] font-medium leading-none tracking-tight sm:text-[2.9rem]">
                    {option.price}
                  </span>
                  <span className="mt-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-orchid">
                    {option.terms}
                  </span>
                </p>
              </div>
            ))}
          </div>

          <Cta label={club.pricing.cta} to={CLUB_JOIN_ROUTE} note={club.pricing.note} className="mt-10" />
          <p className="mt-5 text-center text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-green-bright">
            {club.pricing.guarantee}
          </p>
        </GlassCard>
      </motion.div>

      <motion.div {...rise(reduce, 0.15)} className="mx-auto mt-10 max-w-3xl">
        <QuoteCard
          quote={club.testimonials.closing.quote}
          name={club.testimonials.closing.name}
          accent="plum"
        />
      </motion.div>
    </Section>
  );
}

/* ── 12 · Your next move ──────────────────────────────────────────────── */

function NextMoveSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="lg"
      aurora="violet"
      auroraIntensity={0.6}
      aria-label={club.nextMove.title}
      containerClassName="max-w-3xl"
    >
      <SectionTitle eyebrow={club.nextMove.eyebrow} title={club.nextMove.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <Prose paragraphs={club.nextMove.paragraphs} align="center" />
      </motion.div>
      <Pull className="mt-12">{club.nextMove.closing}</Pull>
      <Cta label={club.nextMove.cta} to={JOIN_ANCHOR} className="mt-10" />
    </Section>
  );
}

/* ── 13 · Accreditation — the source page's closing statement ─────────── */

function AccreditationSection() {
  return (
    <Section surface="deep" space="sm" aria-label="Continuing education accreditation" containerClassName="max-w-3xl">
      <p className="text-balance text-center font-display text-[1.2rem] italic text-white sm:text-[1.4rem]">
        {club.footerLine}
      </p>
      <p className="mt-6 text-pretty text-center text-xs leading-[1.8] text-orchid">{club.nbcc}</p>
    </Section>
  );
}
