import { motion } from "motion/react";
import { Link } from "react-router";
import { Seo } from "@/components/Seo";
import {
  Cta,
  FounderLetter,
  MarkedList,
  ProgramFaq,
  Prose,
  Pull,
  accentAt,
  rise,
} from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { LOUNGE_MEMBER_ROUTE, LOUNGE_VIP_ROUTE, lounge } from "@/content/lounge";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import { ORGANIZATION_ID, absoluteUrl, faqPageNode } from "@/seo/schema";
import type { JsonLdNode } from "@/seo/types";
import { useHeadContext } from "@/ssr/context";

/**
 * The Boss Clinician Lounge — `/lounge`, at the path the source site sells it
 * from.
 *
 * Section order is the source page's: the fact → the good news → what becomes
 * possible → what it actually looks like → the Lounge → what is inside → why it
 * is different → four phases → it changes with you → who it is for → two tiers
 * → Yvette's letter → objections → the close. Copy lives in content/lounge.ts
 * and is the published wording.
 *
 * Mid-page actions scroll to the pricing band (`#join`), as the source's do;
 * only the tier buttons leave the page.
 *
 * The photographs are the source page's own, self-hosted under
 * /images/lounge and set in the section each one sits in there.
 */

const PORTRAIT = "/images/758479b0818b.png";
const JOIN_ANCHOR = "#join";

interface Photo {
  src: string;
  alt: string;
  /** Intrinsic size of the file served, so the slot is reserved before load. */
  width: number;
  height: number;
}

const PHOTOS = {
  hero: {
    src: "/images/lounge/hero-the-lounge-yvette-mug.webp",
    alt: "Yvette Howard holding a mug, set against the words The Lounge",
    width: 1200,
    height: 990,
  },
  seated: {
    src: "/images/lounge/yvette-seated-boss-clinician-tee.jpg",
    alt: "Yvette Howard seated, mid-conversation, in a Boss Clinician tee",
    width: 1165,
    height: 1440,
  },
  laptop: {
    src: "/images/lounge/yvette-working-at-laptop.jpg",
    alt: "Yvette Howard working at her laptop with a coffee beside her",
    width: 1170,
    height: 902,
  },
  oval: {
    src: "/images/lounge/yvette-laptop-oval.webp",
    alt: "Yvette Howard working on her laptop from the living-room floor",
    width: 800,
    height: 1000,
  },
  // Scene-setting stock photograph; the copy beside it carries the meaning.
  workspace: {
    src: "/images/lounge/desk-chair-workspace.jpg",
    alt: "",
    width: 972,
    height: 1200,
  },
  devices: {
    src: "/images/lounge/lounge-devices-mockup.webp",
    alt: "The Lounge member area shown on a desktop monitor, a laptop and a tablet",
    width: 1718,
    height: 916,
  },
  mug: {
    src: "/images/lounge/yvette-with-mug.jpg",
    alt: "Yvette Howard smiling, holding a business coach mug",
    width: 696,
    height: 1110,
  },
  founder: {
    src: "/images/lounge/yvette-founder-portrait.jpg",
    alt: "Yvette Howard, LCSW",
    width: 977,
    height: 1440,
  },
} as const satisfies Record<string, Photo>;

/** A photograph mounted the way FounderLetter mounts its portrait. */
function Plate({
  photo,
  className,
  imgClassName,
}: {
  photo: Photo;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <GlassCard interactive={false} spotlight={false} className={cn("overflow-hidden p-2", className)}>
      <img
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
        className={cn("h-auto w-full max-w-full rounded-xl object-cover", imgClassName)}
      />
    </GlassCard>
  );
}

const TIER_ROUTE: Record<string, string> = {
  member: LOUNGE_MEMBER_ROUTE,
  vip: LOUNGE_VIP_ROUTE,
};

/** Both tiers as offers on one product, priced from the strings the page prints. */
function productNode(origin: string): JsonLdNode {
  const offers: JsonLdNode[] = [];
  for (const tier of lounge.pricing.tiers) {
    const match = /\$([\d,]+)/.exec(tier.price);
    if (!match) continue;
    offers.push({
      "@type": "Offer",
      name: tier.name.replace(/^★\s*/, ""),
      description: tier.terms,
      price: match[1].replace(/,/g, ""),
      priceCurrency: "USD",
      url: absoluteUrl(origin, "/lounge"),
      availability: "https://schema.org/LimitedAvailability",
      seller: { "@id": `${origin}/${ORGANIZATION_ID}` },
    });
  }

  return {
    "@type": "Product",
    name: "The Boss Clinician Lounge",
    description: lounge.seo.description,
    url: absoluteUrl(origin, "/lounge"),
    image: absoluteUrl(origin, PORTRAIT),
    brand: { "@id": `${origin}/${ORGANIZATION_ID}` },
    offers,
  };
}

export default function Lounge() {
  const { origin } = useHeadContext();

  return (
    <>
      <Seo
        title={lounge.seo.title}
        description={lounge.seo.description}
        image={PORTRAIT}
        jsonLd={[productNode(origin), faqPageNode(origin, "/lounge", lounge.faq.items)]}
      />

      <LuxePageHero
        eyebrow="BOSS CLINICIAN LOUNGE · MEMBERSHIP"
        title={lounge.hero.title}
        titleAccent={lounge.hero.titleAccent}
        tone="violet"
        align="left"
        aside={
          // Transparent lockup — no frame, and above the fold so not lazy.
          <img
            src={PHOTOS.hero.src}
            alt={PHOTOS.hero.alt}
            width={PHOTOS.hero.width}
            height={PHOTOS.hero.height}
            decoding="async"
            className="mx-auto h-auto w-full max-w-[22rem] sm:max-w-md lg:max-w-none"
          />
        }
        lede={
          <>
            <span className="block">{lounge.hero.lede[0]}</span>
            <span className="mt-5 block">{lounge.hero.lede[1]}</span>
          </>
        }
        actions={
          <LuxeButton
            variant="foil"
            size="lg"
            href={JOIN_ANCHOR}
            className="w-full tracking-[0.14em] sm:w-auto sm:tracking-[0.2em]"
          >
            {lounge.hero.cta}
          </LuxeButton>
        }
      />

      <FoundingBand />
      <FactSection />
      <GoodNewsSection />
      <PossibleSection />
      <LooksLikeSection />
      <StepIntoSection />
      <InsideSection />
      <DifferentSection />
      <PhasesSection />
      <EvolvesSection />
      <FitSection />
      <PricingSection />
      <FounderLetter
        title={lounge.founder.title}
        paragraphs={lounge.founder.paragraphs}
        signature={lounge.founder.signature}
        image={PHOTOS.founder.src}
        imageAlt={PHOTOS.founder.alt}
      />
      <ProgramFaq eyebrow={lounge.faq.eyebrow} title={lounge.faq.title} items={lounge.faq.items}>
        <Cta label={lounge.faq.cta} to={JOIN_ANCHOR} />
      </ProgramFaq>
      <ClosingSection />
    </>
  );
}

/* ── Founding-rate banner — the source page's top strip ───────────────── */

function FoundingBand() {
  return (
    <Section surface="raised" space="sm" aria-label="Founding member pricing">
      <p className="mx-auto max-w-3xl text-balance text-center text-[0.78rem] font-semibold uppercase leading-[1.9] tracking-[0.16em] text-gold/90">
        {lounge.hero.banner}
      </p>
    </Section>
  );
}

/* ── 1 · The fact ─────────────────────────────────────────────────────── */

function FactSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="lg"
      aurora="plum"
      auroraIntensity={0.45}
      aria-label="The fact"
      containerClassName="max-w-5xl"
    >
      <SectionTitle
        title={lounge.fact.title}
        className="max-w-3xl"
        titleClassName="text-[1.6rem] sm:text-[2rem] lg:text-[2.3rem]"
      />

      {/* The source's two image rows: portrait beside the turn, then the
          laptop photograph beside the argument. Each stacks on a phone. */}
      <motion.div
        {...rise(reduce, 0.1)}
        className="mt-10 grid items-center gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14"
      >
        <Plate
          photo={PHOTOS.seated}
          className="mx-auto w-full max-w-[17rem] sm:max-w-xs"
          imgClassName="aspect-[4/5] object-top"
        />
        <div>
          <p className="text-pretty font-display text-[1.2rem] italic leading-[1.45] text-orchid">
            {lounge.fact.leadIn}
          </p>
          <p className="mt-3 text-pretty font-display text-[1.35rem] leading-[1.4] text-white sm:text-[1.55rem]">
            {lounge.fact.lead}
          </p>
        </div>
      </motion.div>

      <motion.div
        {...rise(reduce, 0.1)}
        className="mt-10 grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14"
      >
        <Prose paragraphs={lounge.fact.paragraphs} />
        <Plate photo={PHOTOS.laptop} className="mx-auto w-full max-w-md lg:max-w-none" />
      </motion.div>
      <Pull className="mt-12">
        <span className="not-italic text-[0.8em] font-semibold uppercase tracking-[0.14em] text-gold">
          {lounge.fact.closing}
        </span>
      </Pull>
    </Section>
  );
}

/* ── 2 · The good news ────────────────────────────────────────────────── */

function GoodNewsSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="raised" space="lg" aria-label={lounge.goodNews.title} containerClassName="max-w-5xl">
      <div className="grid items-center gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        {/* Desktop-only on the source too; a phone goes straight to the copy. */}
        <Plate photo={PHOTOS.workspace} className="hidden lg:block" imgClassName="aspect-[4/5]" />

        <div>
          {/* Cut to an oval with a transparent ground — it needs no frame. */}
          <motion.img
            {...rise(reduce)}
            src={PHOTOS.oval.src}
            alt={PHOTOS.oval.alt}
            width={PHOTOS.oval.width}
            height={PHOTOS.oval.height}
            loading="lazy"
            decoding="async"
            className="mx-auto mb-7 h-auto w-40 max-w-full sm:w-48"
          />
          <SectionTitle eyebrow={lounge.goodNews.eyebrow} title={lounge.goodNews.title} />
          <motion.div {...rise(reduce, 0.1)} className="mt-10">
            <Prose paragraphs={lounge.goodNews.paragraphs} />
          </motion.div>
        </div>
      </div>
      <Pull className="mt-12">{lounge.goodNews.closing}</Pull>
    </Section>
  );
}

/* ── 3 · What becomes possible ────────────────────────────────────────── */

function PossibleSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="deep" space="lg" aurora="mixed" auroraIntensity={0.5} aria-label={lounge.possible.title}>
      <SectionTitle title={lounge.possible.title} />
      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-10 max-w-2xl">
        <Prose paragraphs={lounge.possible.paragraphs} align="center" />
      </motion.div>

      <RevealGroup as="ul" className="mt-12 grid list-none grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {lounge.possible.items.map((item, i) => (
          <RevealItem key={item} as="li" className="h-full">
            <GlassCard accent={accentAt(i)} className="flex h-full gap-4 p-6 sm:p-7">
              <span
                aria-hidden
                className="text-foil shrink-0 font-display text-[1.6rem] font-medium leading-none"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="copy-luxe min-w-0 text-pretty text-[0.95rem]">{item}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <Cta label={lounge.possible.cta} to={JOIN_ANCHOR} className="mt-12" />
    </Section>
  );
}

/* ── 4 · What it actually looks like ──────────────────────────────────── */

function LooksLikeSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aria-label={lounge.looksLike.title} containerClassName="max-w-3xl">
      <SectionTitle title={lounge.looksLike.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <GlassCard accent="plum" interactive={false} className="p-7 sm:p-10">
          <p className="copy-luxe text-pretty">{lounge.looksLike.body}</p>
        </GlassCard>
      </motion.div>
      <Pull className="mt-12">{lounge.looksLike.closing}</Pull>
    </Section>
  );
}

/* ── 5 · Step into the Lounge ─────────────────────────────────────────── */

function StepIntoSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="gold"
      auroraIntensity={0.45}
      aria-label={lounge.stepInto.title}
      containerClassName="max-w-3xl text-center"
    >
      <motion.div {...rise(reduce)}>
        <span className="eyebrow-luxe">{lounge.stepInto.eyebrow}</span>
        <h2 className="text-foil font-display text-[3rem] font-normal italic leading-[1.02] sm:text-[4.2rem] lg:text-[5rem]">
          {lounge.stepInto.title}
        </h2>
        <GoldRule className="mx-auto mt-8" />
        <p className="mt-8 text-balance font-display text-[1.3rem] leading-[1.4] text-white sm:text-[1.55rem]">
          {lounge.stepInto.lead}
        </p>
        <p className="copy-luxe mx-auto mt-6 max-w-2xl text-pretty">{lounge.stepInto.body}</p>
      </motion.div>

      <Cta label={lounge.stepInto.cta} to={JOIN_ANCHOR} className="mt-10" />

      <motion.div {...rise(reduce, 0.1)} className="mt-14 text-left">
        <GlassCard accent="gold" interactive={false} className="p-7 sm:p-10">
          <img
            src={PHOTOS.devices.src}
            alt={PHOTOS.devices.alt}
            width={PHOTOS.devices.width}
            height={PHOTOS.devices.height}
            loading="lazy"
            decoding="async"
            className="mx-auto mb-7 h-auto w-full max-w-full"
          />
          <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-gold/80">
            {lounge.stepInto.curriculumEyebrow}
          </span>
          <h3 className="mt-4 text-balance font-display text-[1.4rem] font-medium leading-[1.3] text-white sm:text-[1.65rem]">
            {lounge.stepInto.curriculumTitle}
          </h3>
          <p className="copy-luxe mt-5 text-pretty">{lounge.stepInto.curriculumBody}</p>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── 6 · What you get inside ──────────────────────────────────────────── */

function InsideSection() {
  return (
    <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.4} aria-label={lounge.inside.title}>
      <SectionTitle title={lounge.inside.title} />
      <RevealGroup as="ul" className="mt-12 grid list-none grid-cols-1 gap-6 md:grid-cols-2">
        {lounge.inside.items.map((item, i) => (
          <RevealItem key={item.title} as="li" className="h-full">
            <GlassCard as="article" accent={accentAt(i)} className="flex h-full flex-col p-7 sm:p-8">
              <span
                aria-hidden
                className="text-foil font-display text-[1.9rem] font-medium leading-none"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-balance font-display text-[1.3rem] font-medium leading-[1.28] text-white">
                {item.title}
              </h3>
              <GoldRule width="w-10" className="mt-5" />
              <p className="copy-luxe mt-5 text-pretty text-[0.95rem]">{item.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 7 · Not like what you've tried ───────────────────────────────────── */

function DifferentSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aria-label={lounge.different.title} containerClassName="max-w-5xl">
      <SectionTitle title={lounge.different.title} />
      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
        <motion.div {...rise(reduce)} className="mx-auto w-full max-w-[17rem] sm:max-w-xs lg:sticky lg:top-28">
          {/* Natural ratio: a 4/5 crop would cut the mug out of the frame. */}
          <Plate photo={PHOTOS.mug} />
        </motion.div>

        <div>
          <motion.div {...rise(reduce, 0.1)}>
            <Prose paragraphs={lounge.different.paragraphs} />
          </motion.div>
          <Pull className="mt-10">{lounge.different.pivot}</Pull>
          <motion.div {...rise(reduce, 0.1)} className="mt-10">
            <Prose paragraphs={lounge.different.after} />
          </motion.div>
        </div>
      </div>
    </Section>
  );
}

/* ── 8 · Four phases ──────────────────────────────────────────────────── */

function PhasesSection() {
  return (
    <Section surface="deep" space="lg" aurora="violet" auroraIntensity={0.5} aria-label={lounge.phases.title}>
      <SectionTitle eyebrow={lounge.phases.eyebrow} title={lounge.phases.title} body={lounge.phases.body} />

      <RevealGroup as="ol" className="mt-12 grid list-none grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {lounge.phases.items.map((phase, i) => (
          // Two phases share the letter S, so the title is the key.
          <RevealItem key={phase.title} as="li" className="h-full">
            <GlassCard as="article" accent={accentAt(i)} className="flex h-full flex-col p-7">
              <span
                aria-hidden
                className="text-foil font-display text-[3.4rem] font-medium leading-none"
              >
                {phase.letter}
              </span>
              <h3 className="mt-5 text-balance font-display text-[1.15rem] font-medium leading-[1.3] text-white">
                {phase.title}
              </h3>
              <GoldRule width="w-10" className="mt-5" />
              <p className="copy-luxe mt-5 text-pretty text-sm">{phase.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <Cta label={lounge.phases.cta} to={JOIN_ANCHOR} className="mt-12" />
    </Section>
  );
}

/* ── 9 · It changes with you ──────────────────────────────────────────── */

function EvolvesSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="raised" space="lg" aria-label={lounge.evolves.title} containerClassName="max-w-3xl">
      <SectionTitle title={lounge.evolves.title} />
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <Prose paragraphs={lounge.evolves.paragraphs} />
      </motion.div>
    </Section>
  );
}

/* ── 10 · Who it is for ───────────────────────────────────────────────── */

function FitSection() {
  return (
    <Section surface="base" space="lg" aria-label={lounge.fit.title}>
      <SectionTitle title={lounge.fit.title} />
      <RevealGroup className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RevealItem className="h-full">
          <GlassCard accent="green" interactive={false} className="h-full p-7 sm:p-9">
            <h3 className="font-display text-[1.4rem] font-medium text-white">{lounge.fit.forTitle}</h3>
            <GoldRule width="w-10" className="mt-5" />
            <MarkedList items={lounge.fit.forItems} variant="check" className="mt-7" />
          </GlassCard>
        </RevealItem>
        <RevealItem className="h-full">
          <GlassCard accent="neutral" interactive={false} className="h-full p-7 sm:p-9">
            <h3 className="font-display text-[1.4rem] font-medium text-white">{lounge.fit.notTitle}</h3>
            <GoldRule width="w-10" className="mt-5" />
            <MarkedList items={lounge.fit.notItems} variant="cross" className="mt-7" />
            <p className="mt-7 text-sm">
              <Link
                to={lounge.fit.clubLink.to}
                className="text-orchid underline decoration-white/20 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
              >
                {lounge.fit.clubLink.label} &rarr;
              </Link>
            </p>
          </GlassCard>
        </RevealItem>
      </RevealGroup>
    </Section>
  );
}

/* ── 11 · Two tiers ───────────────────────────────────────────────────── */

function PricingSection() {
  return (
    <Section
      id="join"
      surface="raised"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.55}
      aria-label={lounge.pricing.title}
      className="scroll-mt-24"
    >
      <SectionTitle title={lounge.pricing.title} />

      <RevealGroup
        as="ul"
        className="mx-auto mt-12 grid max-w-5xl list-none grid-cols-1 items-stretch gap-6 lg:grid-cols-2"
      >
        {lounge.pricing.tiers.map((tier) => {
          const vip = tier.id === "vip";

          return (
            <RevealItem key={tier.id} as="li" className="h-full">
              <GlassCard as="article" accent={vip ? "gold" : "plum"} className="flex h-full flex-col p-7 sm:p-9">
                <h3 className="text-[0.74rem] font-bold uppercase tracking-[0.22em] text-gold">
                  {tier.name}
                </h3>
                {tier.tagline && (
                  <p className="mt-4 text-pretty font-display text-[1.1rem] italic leading-[1.4] text-white">
                    {tier.tagline}
                  </p>
                )}

                <p className="text-foil mt-6 font-display text-[2.8rem] font-medium leading-none tracking-tight sm:text-[3.3rem]">
                  {tier.price}
                </p>
                <p className="mt-4 text-pretty text-[0.72rem] font-semibold uppercase leading-[1.7] tracking-[0.12em] text-orchid">
                  {tier.terms}
                </p>
                <p className="mt-3">
                  <LuxePill accent={vip ? "gold" : "plum"} className="h-auto whitespace-normal text-left leading-[1.6]">
                    {tier.scarcity}
                  </LuxePill>
                </p>

                <div aria-hidden className="rule-faint mt-7 w-full" />
                <MarkedList items={tier.features} variant="check" className="mt-7 flex-1" />

                <LuxeButton
                  variant={vip ? "foil" : "glass"}
                  size="lg"
                  to={TIER_ROUTE[tier.id] ?? LOUNGE_MEMBER_ROUTE}
                  className="mt-9 min-h-[48px] w-full tracking-[0.16em]"
                >
                  {tier.cta}
                </LuxeButton>
              </GlassCard>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <p className="copy-luxe mx-auto mt-10 max-w-2xl text-pretty text-center text-sm">
        {lounge.pricing.commitment}
      </p>
    </Section>
  );
}

/* ── 12 · The close ───────────────────────────────────────────────────── */

function ClosingSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="violet"
      auroraIntensity={0.7}
      aria-label={lounge.closing.title}
      containerClassName="max-w-3xl text-center"
    >
      <motion.div {...rise(reduce)}>
        <h2 className="text-balance font-display text-[2.1rem] font-medium leading-[1.12] text-white sm:text-[2.8rem] lg:text-[3.3rem]">
          {lounge.closing.title}
          <span className="text-foil mt-1.5 block italic">{lounge.closing.titleAccent}</span>
        </h2>
        <GoldRule className="mx-auto mt-9" />
        <Prose paragraphs={lounge.closing.paragraphs} align="center" className="mx-auto mt-9 max-w-2xl" />
      </motion.div>

      <motion.div
        {...rise(reduce, 0.1)}
        className="mt-12 flex flex-col items-stretch justify-center gap-8 sm:flex-row sm:items-start"
      >
        <div className="flex flex-1 flex-col items-center">
          <LuxeButton variant="glass" size="lg" to={LOUNGE_MEMBER_ROUTE} className="w-full tracking-[0.16em] sm:w-auto">
            {lounge.pricing.tiers[0].cta}
          </LuxeButton>
          <p className="copy-luxe mt-4 max-w-xs text-pretty text-xs">{lounge.closing.memberNote}</p>
        </div>
        <div className="flex flex-1 flex-col items-center">
          <LuxeButton variant="foil" size="lg" to={LOUNGE_VIP_ROUTE} className="w-full tracking-[0.16em] sm:w-auto">
            {lounge.pricing.tiers[1].cta}
          </LuxeButton>
          <p className="copy-luxe mt-4 max-w-xs text-pretty text-xs">{lounge.closing.vipNote}</p>
        </div>
      </motion.div>

      <p className="copy-luxe mx-auto mt-10 max-w-2xl text-pretty text-sm">{lounge.pricing.commitment}</p>

      <p className="mt-10 text-sm text-orchid">
        {lounge.closing.contact}{" "}
        <a
          href={`mailto:${lounge.closing.email}`}
          className="break-all text-gold underline decoration-gold/35 underline-offset-4 transition-colors duration-300 ease-luxe hover:text-gold-bright"
        >
          {lounge.closing.email}
        </a>
      </p>
    </Section>
  );
}
