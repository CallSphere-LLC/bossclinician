import { ProgramFounderVideo } from "@/components/luxe/ProgramFounderVideo";
import { useState } from "react";
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
import { LOUNGE_MEMBER_ROUTE, LOUNGE_VIP_ROUTE, lounge, loungeMembershipV2Enabled } from "@/content/lounge";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import { ORGANIZATION_ID, absoluteUrl, faqPageNode } from "@/seo/schema";
import type { JsonLdNode } from "@/seo/types";
import { useHeadContext } from "@/ssr/context";

/**
 * The Boss Clinician Lounge — `/lounge`, at the path the source site sells it
 * from.
 *
 * Offer configuration, pricing, and FAQs come from content/lounge.ts.
 * The public positioning sections follow the latest website handoff.
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
    if (!loungeMembershipV2Enabled) {
      const match = /\$([\d,]+)/.exec(tier.price);
      if (match) offers.push({ "@type": "Offer", name: tier.name.replace(/^★\s*/, ""), description: tier.terms, price: match[1].replace(/,/g, ""), priceCurrency: "USD", url: absoluteUrl(origin, "/lounge"), availability: "https://schema.org/LimitedAvailability", seller: { "@id": `${origin}/${ORGANIZATION_ID}` } });
      continue;
    }
    for (const mode of ["monthly", "annual"] as const) {
      const match = /\$([\d,]+)/.exec(mode === "monthly" ? tier.monthlyPrice : tier.annualPrice);
      if (!match) continue;
      offers.push({
      "@type": "Offer",
      name: `${tier.name} — ${mode === "monthly" ? "Monthly" : "Annual"} Membership`,
      description: mode === "monthly" ? tier.monthlyTerms : `${tier.annualTerms} ${lounge.pricing.annualRenewal}`,
      price: match[1].replace(/,/g, ""),
      priceCurrency: "USD",
      url: absoluteUrl(origin, `${TIER_ROUTE[tier.id]}?membership=${mode}`),
      availability: "https://schema.org/LimitedAvailability",
      seller: { "@id": `${origin}/${ORGANIZATION_ID}` },
      });
    }
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
        description="Build a financially secure private practice without relying on a packed caseload. The Lounge helps established clinicians make clearer business decisions."
        image={PORTRAIT}
        jsonLd={[productNode(origin), faqPageNode(origin, "/lounge", lounge.faq.items)]}
      />

      <LuxePageHero
        eyebrow="BOSS CLINICIAN LOUNGE | MEMBERSHIP"
        title="Your Practice Is Working."
        titleAccent="But Can You Keep Working Like This?"
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
            <span className="block">Build a financially secure practice without relying on a packed caseload.</span>
            <span className="mt-5 block">
              Work fewer days.<br />
              Make clearer business decisions.<br />
              Create more room for your life.
            </span>
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

      <LoungePracticeReframe />
      <ProgramFounderVideo program="lounge" />
      <FoundingBand />
      <GoodNewsSection />
      <LoungeDecisions />
      <PossibleSection />
      <LoungeFirstMonth />
      <LoungeOutcomes />
      <LooksLikeSection />
      <StepIntoSection />
      <LoungeFourNumbers />
      <InsideSection />
      <LoungeInsuranceApproach />
      <DifferentSection />
      <PhasesSection />
      <EvolvesSection />
      <FitSection />
      <CaseStudiesSection />
      <PricingSection />
      <FounderLetter
        title={lounge.founder.title}
        paragraphs={lounge.founder.paragraphs}
        signature={lounge.founder.signature}
        image={PHOTOS.founder.src}
        imageAlt={PHOTOS.founder.alt}
      />
      <Section surface="raised" space="sm" aria-label="More questions about the Lounge">
        <SectionTitle align="center" title="Have More Questions?" body="Get clarity on the commitment, support, pricing, and what to expect inside." />
        <Cta label="View FAQs" to="#faq" className="mt-6" />
      </Section>
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

function LoungePracticeReframe() {
  return (
    <>
      <Section surface="base" space="lg" aurora="plum" auroraIntensity={0.45} containerClassName="max-w-5xl">
        <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14">
          <div>
            <SectionTitle title="You May Not Be Tired of Private Practice. You May Be Tired of the Way You’re Currently Running It." />
            <Prose className="mt-7" paragraphs={["Maybe you are:"]} />
            <MarkedList className="mt-4" variant="check" items={[
              "seeing 22–25+ clients a week and still not feeling financially secure",
              "doing billing and admin long after your last session",
              "checking your work email from vacation",
              "panicking when two clients discharge",
              "nervous every summer when referrals slow down",
              "thinking about joining another payer panel",
              "wondering whether you need another income stream",
              "scrolling Indeed at night wondering if working for someone else would honestly be easier",
            ]} />
            <Prose className="mt-7" paragraphs={[
              "You built this practice for autonomy.",
              "Somewhere along the way, it started requiring more and more of you just to feel safe.",
            ]} />
          </div>
          <Plate photo={PHOTOS.seated} className="mx-auto w-full max-w-[17rem] sm:max-w-xs" imgClassName="aspect-[4/5] object-top" />
        </div>
      </Section>
      <Section surface="raised" space="lg" containerClassName="max-w-5xl">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <div>
            <SectionTitle title="Maybe You Don’t Need More Clients." />
            <Prose className="mt-7" paragraphs={[
              "If you are already seeing 24 clients a week and still do not feel financially stable, another directory may not fix the problem.",
              "Before you market harder, look at:",
            ]} />
            <MarkedList className="mt-4" variant="check" items={[
              "what the practice costs to run", "your lowest and highest payer rates", "your payer mix",
              "how much you need to pay yourself", "how many sessions you actually need",
              "how much unpaid admin time you are carrying", "what could appropriately be delegated",
              "whether another service actually makes sense",
            ]} />
            <Prose className="mt-7" paragraphs={[
              "The problem may not be your marketing.",
              "The problem may be the model underneath your caseload.",
            ]} />
          </div>
          <Plate photo={PHOTOS.laptop} className="mx-auto w-full max-w-md lg:max-w-none" />
        </div>
      </Section>
      <Section surface="deep" space="lg" aurora="plum" containerClassName="max-w-4xl">
        <SectionTitle title={lounge.fact.closing} align="center" />
        <Prose className="mt-8" paragraphs={["You may not need:"]} />
        <MarkedList className="mt-4" variant="cross" items={[
          "another certification", "another insurance panel", "another directory", "a coaching business",
          "a course", "a bigger team", "an entirely new career",
        ]} />
        <Prose className="mt-7" paragraphs={[
          "Sometimes the answer is adding something.",
          "Sometimes the answer is changing what is already there.",
          "That is what we figure out inside The Lounge.",
        ]} />
      </Section>
    </>
  );
}

function LoungeDecisions() {
  return (
    <Section surface="base" space="lg" containerClassName="max-w-4xl">
      <SectionTitle title="Stop Making Every Major Practice Decision Alone." />
      <Prose className="mt-7" paragraphs={["These are the kinds of questions we work through:"]} />
      <MarkedList className="mt-4" variant="check" items={[
        "Can I afford to reduce my caseload?",
        "Which insurance panels actually make sense to keep?",
        "Should I stay with Alma or Headway, credential independently, or use a combination of both?",
        "How do I reduce my dependence on Alma, Headway, or other third-party platforms without destabilizing my income?",
        "Should I hire an admin or another clinician?",
        "Can I work three days and still pay myself what I need?",
        "Do I need another income stream — or do I need to fix my current practice model?",
        "Should I go cash pay, stay insurance-based, or build a hybrid model?",
        "Does a group make sense for my client population?",
        "Can supervision become part of my practice without adding more chaos?",
        "What should I focus on for the next 90 days?",
      ]} />
      <Prose className="mt-7" paragraphs={[
        "The Lounge is not about giving you more things to do.",
        "It is about helping you decide what actually deserves your attention.",
      ]} />
    </Section>
  );
}

function LoungeFirstMonth() {
  return (
    <Section surface="raised" space="lg" containerClassName="max-w-4xl">
      <SectionTitle title="Your First Month: Get Out of Reaction Mode." />
      <Prose className="mt-7" paragraphs={[
        "You will not leave your first month with 47 new tasks.",
        "You will identify 3–5 business goals for the next 90 days.",
        "Then we will help you choose one priority first.",
        "Your focus may be:",
      ]} />
      <MarkedList className="mt-4" variant="check" items={[
        "reducing your caseload", "increasing owner pay", "changing payer mix", "dropping a low-paying panel",
        "reducing dependence on third-party platforms", "hiring admin support", "building a 3-day workweek",
        "creating a vacation fund", "deciding whether a group or supervision makes sense",
      ]} />
      <Prose className="mt-7" paragraphs={[
        "The goal is not to add more to your plate.",
        "The goal is to decide what should come off it.",
      ]} />
    </Section>
  );
}

function LoungeOutcomes() {
  return (
    <Section surface="base" space="lg" containerClassName="max-w-4xl">
      <SectionTitle title="What This Work Can Look Like in Real Life" />
      <Prose className="mt-7" paragraphs={["Depending on your practice and goals, your work inside The Lounge may include:"]} />
      <MarkedList className="mt-4" variant="check" items={[
        "moving from 25 sessions a week toward 18", "increasing consistent owner pay",
        "dropping or reducing dependence on a low-paying payer",
        "creating a plan to move away from or reduce reliance on Alma, Headway, or similar platforms",
        "delegating billing or admin", "building a 3-day workweek", "creating a vacation fund",
        "starting an appropriate therapy group", "creating a 90-day financial plan",
        "confidently evaluating whether students or pre-licensed clinicians fit your practice",
      ]} />
      <Prose className="mt-7" paragraphs={["These are examples, not guaranteed outcomes."]} />
      <Cta label="I’m Ready to Build Differently" to={JOIN_ANCHOR} className="mt-8" />
    </Section>
  );
}

function LoungeFourNumbers() {
  return (
    <Section surface="deep" space="lg" aurora="plum" containerClassName="max-w-5xl">
      <SectionTitle align="center" title="Four Numbers Can Tell You a Lot About Whether Your Practice Is Working for You." />
      <Prose className="mt-7" align="center" paragraphs={["Inside The Lounge, we keep coming back to:"]} />
      <ul className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {["Sessions per week", "Profit", "Owner pay", "Days worked"].map((name) => (
          <li key={name}>
            <GlassCard accent="plum" interactive={false} className="h-full p-5 text-center">
              <span className="font-display text-lg font-medium text-white">{name}</span>
            </GlassCard>
          </li>
        ))}
      </ul>
      <Prose className="mt-7" align="center" paragraphs={[
        "Because the goal is not simply more revenue.",
        "The goal is a practice where you can work fewer days, see fewer clients, pay yourself appropriately, and still maintain a healthy business.",
      ]} />
    </Section>
  );
}

function LoungeInsuranceApproach() {
  return (
    <Section surface="base" space="lg" containerClassName="max-w-4xl">
      <SectionTitle title="This Is Not a “Get Off Insurance” Program." />
      <Prose className="mt-7" paragraphs={["I am not going to tell you that every clinician should:"]} />
      <MarkedList className="mt-4" variant="cross" items={[
        "go cash pay", "hire", "raise rates", "create a course", "start coaching", "build a group practice",
      ]} />
      <Prose className="mt-7" paragraphs={["Your strategy depends on:"]} />
      <MarkedList className="mt-4" variant="check" items={[
        "your numbers", "your values", "your client population", "your capacity", "your goals", "your season",
      ]} />
      <Prose className="mt-7" paragraphs={[
        "There is no one correct practice model.",
        "There is the model that works for you.",
      ]} />
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
            <h3 className="font-display text-[1.4rem] font-medium text-white">The Lounge is for an established clinician or practice owner who:</h3>
            <GoldRule width="w-10" className="mt-5" />
            <MarkedList items={[
              "already has a functioning practice", "wants ongoing access to experienced judgment",
              "has recurring business decisions coming up", "is tired of reacting to every problem alone",
              "wants to reduce dependence on a packed caseload", "is willing to look at the numbers",
              "is willing to implement over several months", "wants a practice that supports life outside of work",
            ]} variant="check" className="mt-7" />
          </GlassCard>
        </RevealItem>
        <RevealItem className="h-full">
          <GlassCard accent="neutral" interactive={false} className="h-full p-7 sm:p-9">
            <h3 className="font-display text-[1.4rem] font-medium text-white">It is not for someone who:</h3>
            <GoldRule width="w-10" className="mt-5" />
            <MarkedList items={[
              "has not started a practice yet", "only wants more referrals", "wants guaranteed income results",
              "wants someone to do everything for them", "refuses to look at the numbers",
              "wants a quick fix without implementation", "only wants another certification to collect",
            ]} variant="cross" className="mt-7" />
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

/* ── 11 · Coaching case studies ───────────────────────────────────────── */

function CaseStudiesSection() {
  return (
    <Section surface="base" space="lg" aria-label={lounge.caseStudies.title}>
      <SectionTitle align="center" title={lounge.caseStudies.title} />
      <RevealGroup className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2">
        {lounge.caseStudies.items.map((study) => (
          <RevealItem key={study.title} className="h-full">
            <GlassCard as="article" accent="plum" interactive={false} className="h-full p-7 sm:p-9">
              <h3 className="text-balance font-display text-[1.55rem] font-medium leading-[1.2] text-white">
                {study.title}
              </h3>
              <GoldRule width="w-10" className="mt-5" />
              <Prose className="mt-6" paragraphs={study.paragraphs} />
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 12 · Two tiers ───────────────────────────────────────────────────── */

function PricingSection() {
  return loungeMembershipV2Enabled ? <MembershipPricingSection /> : <LegacyPricingSection />;
}

function MembershipPricingSection() {
  const [plans, setPlans] = useState<Record<string, "monthly" | "annual">>({ member: "monthly", vip: "monthly" });
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
      <SectionTitle title={lounge.pricing.title} body={lounge.pricing.intro} />

      <RevealGroup
        as="ul"
        className="mx-auto mt-12 grid max-w-5xl list-none grid-cols-1 items-stretch gap-6 lg:grid-cols-2"
      >
        {lounge.pricing.tiers.map((tier) => {
          const vip = tier.id === "vip";
          const plan = plans[tier.id];

          return (
            <RevealItem key={tier.id} as="li" className="h-full">
              <GlassCard as="article" accent={vip ? "gold" : "plum"} className="flex h-full flex-col p-7 sm:p-9">
                <h3 className="text-[0.74rem] font-bold uppercase tracking-[0.22em] text-gold">
                  {tier.name}
                </h3>
                {vip ? (
                  <Prose className="mt-4" paragraphs={[
                    "Choose VIP if you want me to look at what’s happening in your practice and help you decide what to do next. Maybe you want Fridays off, but you’re unsure what that would mean for your take-home pay. Or you’ve rewritten your pricing page three times and want another set of eyes on it before you publish.",
                    "Bring the schedule decision to a private strategy call. Send me the pricing page for recorded feedback. And at your 90-day review, we’ll look at what you tried, what changed, and what needs adjusting.",
                  ]} />
                ) : tier.tagline && (
                  <p className="mt-4 text-pretty font-display text-[1.1rem] italic leading-[1.4] text-white">
                    {tier.tagline}
                  </p>
                )}

                <fieldset className="mt-6">
                  <legend className="text-sm font-semibold text-white">Choose your {tier.name} payment option</legend>
                  <div className="mt-3 space-y-3">
                    {(["monthly", "annual"] as const).map((mode) => (
                      <label key={mode} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed", plan === mode ? "border-gold bg-gold/10" : "border-white/20")}>
                        <input type="radio" name={`${tier.id}-membership`} checked={plan === mode} onChange={() => setPlans((current) => ({ ...current, [tier.id]: mode }))} className="mt-1 size-4 shrink-0 accent-[#c9a46a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-white">{mode === "monthly" ? `Monthly Membership: ${tier.monthlyPrice}` : `Annual Membership: ${tier.annualPrice}`}</span>
                          <span className="mt-2 block text-orchid">{mode === "monthly" ? tier.monthlyTerms : tier.annualTerms}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="mt-3">
                  <LuxePill accent={vip ? "gold" : "plum"} className="h-auto whitespace-normal text-left leading-[1.6]">
                    {tier.scarcity}
                  </LuxePill>
                </p>

                <div aria-hidden className="rule-faint mt-7 w-full" />
                <h4 className="mt-7 text-base font-semibold text-white">{vip ? "Your VIP membership includes everything in Lounge Member, plus:" : "Your membership includes:"}</h4>
                <MarkedList items={tier.features} variant="check" className="mt-7 flex-1" />

                <LuxeButton
                  variant={vip ? "foil" : "glass"}
                  size="lg"
                  to={`${TIER_ROUTE[tier.id] ?? LOUNGE_MEMBER_ROUTE}?membership=${plan}`}
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
      <p className="copy-luxe mx-auto mt-4 max-w-2xl text-pretty text-center text-sm">{lounge.pricing.foundingRate}</p>
      <p className="copy-luxe mx-auto mt-4 max-w-2xl text-pretty text-center text-sm">
        {lounge.pricing.annualRenewal} View the <a href="/terms" className="text-gold underline underline-offset-4">membership billing and 7-day guarantee terms</a>.
      </p>
      <div className="mx-auto mt-12 max-w-3xl">
        <h3 className="font-display text-2xl text-white">Which Membership Is Right for Me?</h3>
        <div className="copy-luxe mt-5 space-y-4">
          <p><strong className="text-white">Choose Lounge Member</strong> if you like working through the tools at your own pace and bringing questions to the monthly group Strategy Session.</p>
          <p><strong className="text-white">Choose Lounge VIP</strong> if you want that same support plus time to talk through your decisions privately, get feedback on something you’ve created, and revisit your progress with me.</p>
        </div>
      </div>
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

function LegacyPricingSection() {
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
