import { Fragment, type ReactNode } from "react";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { ProgramFaq } from "@/components/home/luxe/ProgramSections";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import {
  LEAP_ENROL_PATH,
  LEAP_SCALE_ID,
  LEAP_TIERS_ID,
  leapAccelerator as copy,
} from "@/content/kajabiPagesLeap";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import { PhotoPlate, rise } from "./shared";

/**
 * Profitable Private Practice Leap Accelerator — the on-site rebuild of the
 * Kajabi sales page at /profitable-private-practice-leap-accelerator, at the
 * same address.
 *
 * Section order and wording follow the source: hero → "are you ready" → why →
 * your future → meet Yvette → breaking through → the blueprint → the Boss
 * Builders teaser → the two tiers → FAQ. Every mid-page "Join Now" scrolls to
 * the tiers band; only the tiers' own buttons leave the page. Neither tier has
 * an offer on this site yet, so those go to the application page rather than a
 * checkout quoting a different price (see content/kajabiPagesLeap.ts).
 */

const ACCENTS: readonly Accent[] = ["gold", "plum", "green", "neutral"];
const accentAt = (i: number) => ACCENTS[i % ACCENTS.length];

/** Renders the content file's `**bold**` marks as <strong>, nothing else. */
function RichText({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-white">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Prices are figures: body font, bold, tabular — never the display serif. */
function Investment({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <p className={cn("text-pretty text-[0.95rem] leading-[1.7] text-orchid", className)}>
      <span className="font-semibold uppercase tracking-[0.14em] text-gold">{label}</span>{" "}
      <span className="font-sans font-bold tabular-nums text-white">{value}</span>
    </p>
  );
}

function Check() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/[0.1] text-gold"
    >
      <svg viewBox="0 0 12 10" className="h-2.5 w-3" fill="none">
        <path d="M1 5.2 4.3 8.4 11 1.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** A bulleted point whose lead-in is bold, as the source sets them. */
function LeadList({
  items,
  className,
}: {
  items: readonly { lead: string; body: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-4", className)}>
      {items.map((item) => (
        <li key={item.lead} className="flex gap-3.5">
          <Check />
          <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">
            <strong className="font-semibold text-white">{item.lead}</strong>
            {item.body ? (/^[\s–(:]/.test(item.body) || item.lead.endsWith(" ") ? item.body : ` ${item.body}`) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AnchorCta({ label, to, variant = "foil" }: { label: string; to: string; variant?: "foil" | "glass" }) {
  const classes = "w-full max-w-full text-center leading-[1.4] tracking-[0.12em] sm:w-auto sm:tracking-[0.18em]";
  return to.startsWith("#") ? (
    <LuxeButton variant={variant} size="lg" href={to} className={classes}>
      {label}
    </LuxeButton>
  ) : (
    <LuxeButton variant={variant} size="lg" to={to} className={classes}>
      {label}
    </LuxeButton>
  );
}

export default function LeapAccelerator() {
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} />
      <Hero />
      <ReadySection />
      <WhySection />
      <FutureSection />
      <FounderSection />
      <BreakingSection />
      <BlueprintSection />
      <ScaleSection />
      <TiersSection />
      <ProgramFaq title={copy.faq.title} items={copy.faq.items} />
    </>
  );
}

/* ── 1 · Hero ─────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <LuxePageHero
      eyebrow={copy.announcement}
      title="Profitable Private Practice"
      titleAccent="Leap Accelerator"
      tone="violet"
      lede={
        <>
          {copy.hero.subtitleLines.map((line) => (
            <span key={line} className="block font-display text-[1.25rem] leading-snug text-white sm:text-[1.45rem]">
              {line}
            </span>
          ))}
          <span className="mt-5 block">{copy.hero.note}</span>
        </>
      }
      actions={<AnchorCta label={copy.hero.cta} to={`#${LEAP_TIERS_ID}`} />}
      aside={
        <PhotoPlate
          src={copy.hero.image.src}
          alt={copy.hero.image.alt}
          className="max-w-[17rem] sm:max-w-[19rem]"
          imgClassName="bg-gradient-to-b from-plum/30 to-night-deep"
        />
      }
    />
  );
}

/* ── 2 · Are you ready ────────────────────────────────────────────────── */

function ReadySection() {
  const reduce = useEntranceMotion();
  return (
    <Section surface="raised" space="md" aurora="gold" auroraIntensity={0.45} aria-label={copy.ready.title}>
      <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <PhotoPlate src={copy.ready.image.src} alt={copy.ready.image.alt} className="max-w-[22rem]" />
        <motion.div {...rise(reduce)}>
          <h2 className="text-balance font-display text-[1.8rem] font-medium leading-[1.18] text-white sm:text-[2.3rem]">
            {copy.ready.title}
          </h2>
          <GoldRule className="mt-6" />
          <p className="copy-luxe mt-7 text-pretty">
            <RichText text={copy.ready.body} />
          </p>
        </motion.div>
      </div>
    </Section>
  );
}

/* ── 3 · Why ──────────────────────────────────────────────────────────── */

function WhySection() {
  const reduce = useEntranceMotion();
  return (
    <Section surface="deep" space="md" aurora="plum" auroraIntensity={0.5} aria-label="Why the Leap Accelerator">
      <SectionTitle
        title={
          <>
            {copy.why.title}{" "}
            <span className="text-foil font-display italic">{copy.why.titleAccent}</span>
          </>
        }
      />
      <motion.div {...rise(reduce, 0.08)} className="mx-auto mt-8 max-w-[62ch] space-y-5 text-center">
        {copy.why.paragraphs.map((p) => (
          <p key={p} className="copy-luxe text-pretty">
            <RichText text={p} />
          </p>
        ))}
      </motion.div>
      <RevealGroup as="ul" className="mt-10 grid list-none grid-cols-1 gap-5 md:grid-cols-2">
        {copy.why.points.map((point, i) => (
          <RevealItem key={point.lead} as="li" className="h-full">
            <GlassCard accent={accentAt(i)} className="flex h-full gap-4 p-6 sm:p-7">
              <Check />
              <p className="copy-luxe min-w-0 text-pretty text-[0.95rem]">
                <strong className="font-semibold text-white">{point.lead}</strong> {point.body}
              </p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 4 · Your future ──────────────────────────────────────────────────── */

function FutureSection() {
  const reduce = useEntranceMotion();
  return (
    <Section surface="base" space="md" aurora="green" auroraIntensity={0.45} aria-label={copy.future.title}>
      <SectionTitle title={copy.future.title} />
      <motion.div {...rise(reduce, 0.08)} className="mx-auto mt-8 max-w-[62ch] space-y-5 text-center">
        <p className="text-pretty text-[0.8rem] font-semibold uppercase leading-[1.7] tracking-[0.16em] text-gold">
          {copy.future.kicker}
        </p>
        <p className="copy-luxe text-pretty">{copy.future.intro}</p>
        <p className="text-pretty font-semibold text-white">{copy.future.lead}</p>
      </motion.div>
      <RevealGroup as="ul" className="mt-10 grid list-none grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {copy.future.items.map((item, i) => (
          <RevealItem key={item.title} as="li" className="h-full">
            <GlassCard accent={accentAt(i)} className="flex h-full flex-col items-center p-6 text-center sm:p-7">
              {/* The icons are purple line art drawn for a white page, so they
                  sit on a pale tile rather than straight on the night surface. */}
              <span className="flex size-20 items-center justify-center rounded-2xl bg-white/90 p-2 shadow-[0_14px_30px_-16px_rgba(0,0,0,0.8)]">
                <img src={item.icon} alt="" aria-hidden loading="lazy" className="h-full w-full object-contain" />
              </span>
              <h3 className="mt-5 text-balance font-display text-[1.2rem] font-medium leading-snug text-white">
                {item.title}
              </h3>
              <p className="copy-luxe mt-3 text-pretty text-sm">{item.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
      <motion.p {...rise(reduce, 0.1)} className="copy-luxe mx-auto mt-10 max-w-[62ch] text-pretty text-center">
        <RichText text={copy.future.closing} />
      </motion.p>
    </Section>
  );
}

/* ── 5 · Meet Yvette ──────────────────────────────────────────────────── */

function FounderSection() {
  const reduce = useEntranceMotion();
  return (
    <Section surface="raised" space="md" aurora="mixed" auroraIntensity={0.5} aria-label="Meet Yvette Howard">
      <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <PhotoPlate src={copy.founder.image.src} alt={copy.founder.image.alt} className="max-w-[22rem] lg:sticky lg:top-28" />
        <motion.div {...rise(reduce)}>
          <span className="eyebrow-luxe">{copy.founder.eyebrow}</span>
          <h2 className="text-balance font-display text-[2.1rem] font-medium leading-[1.12] text-white sm:text-[2.7rem]">
            {copy.founder.title}
          </h2>
          <GoldRule className="mt-6" />
          <div className="mt-7 space-y-5">
            {copy.founder.paragraphs.map((p) => (
              <p key={p} className="copy-luxe text-pretty">
                <RichText text={p} />
              </p>
            ))}
          </div>
          <div className="mt-8">
            <AnchorCta label={copy.founder.cta.label} to={copy.founder.cta.to} variant="glass" />
          </div>
        </motion.div>
      </div>
    </Section>
  );
}

/* ── 6 · Breaking through ─────────────────────────────────────────────── */

function BreakingSection() {
  const reduce = useEntranceMotion();
  return (
    <Section surface="deep" space="md" aurora="violet" auroraIntensity={0.5} aria-label={copy.breaking.title}>
      <SectionTitle title={copy.breaking.title} body={copy.breaking.intro} />
      <div className="mt-10 grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <PhotoPlate src={copy.breaking.image.src} alt={copy.breaking.image.alt} className="max-w-[22rem]" />
        <motion.div {...rise(reduce, 0.08)}>
          <h3 className="text-pretty font-display text-[1.3rem] font-medium leading-snug text-white sm:text-[1.5rem]">
            {copy.breaking.lead}
          </h3>
          <ul className="mt-6 space-y-4">
            {copy.breaking.points.map((point) => (
              <li key={point.lead} className="flex gap-3.5">
                <Check />
                <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">
                  <strong className="font-semibold text-white">{point.lead}</strong> – {point.body}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
      <motion.p {...rise(reduce, 0.1)} className="copy-luxe mx-auto mt-10 max-w-[65ch] text-pretty text-center">
        <RichText text={copy.breaking.closing} />
      </motion.p>
      <motion.div {...rise(reduce, 0.16)} className="mt-9 flex justify-center">
        <AnchorCta label={copy.breaking.cta} to={`#${LEAP_TIERS_ID}`} />
      </motion.div>
    </Section>
  );
}

/* ── 7 · The blueprint ────────────────────────────────────────────────── */

function BlueprintSection() {
  const reduce = useEntranceMotion();
  return (
    <Section surface="base" space="md" aurora="gold" auroraIntensity={0.45} aria-label={copy.blueprint.title}>
      <SectionTitle
        title={copy.blueprint.title}
        body={<RichText text={copy.blueprint.intro} />}
      />
      <RevealGroup as="ul" className="mt-10 grid list-none grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {copy.blueprint.items.map((item, i) => (
          <RevealItem key={item.title} as="li" className="h-full">
            <GlassCard accent={accentAt(i)} className="h-full p-6 sm:p-7">
              <div className="flex items-start gap-3.5">
                <Check />
                <h3 className="min-w-0 text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.25rem]">
                  {item.title}
                </h3>
              </div>
              <p className="copy-luxe mt-3.5 text-pretty text-sm">{item.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
      <motion.p
        {...rise(reduce, 0.1)}
        className="mx-auto mt-10 max-w-2xl text-balance text-center font-display text-[1.35rem] italic leading-snug text-foil sm:text-[1.6rem]"
      >
        {copy.blueprint.closing}
      </motion.p>
    </Section>
  );
}

/* ── 8 · Boss Builders teaser ─────────────────────────────────────────── */

function ScaleSection() {
  const reduce = useEntranceMotion();
  return (
    <Section
      id={LEAP_SCALE_ID}
      surface="raised"
      space="md"
      aurora="plum"
      auroraIntensity={0.55}
      aria-label={copy.scale.title}
      containerClassName="max-w-3xl"
      className="scroll-mt-24"
    >
      <motion.div {...rise(reduce)}>
        <GlassCard accent="plum" interactive={false} className="p-7 text-center sm:p-10">
          <h2 className="text-balance font-display text-[1.8rem] font-medium leading-[1.15] text-white sm:text-[2.3rem]">
            {copy.scale.title}
          </h2>
          <GoldRule className="mx-auto mt-6" />
          <div className="mt-7 space-y-5">
            {copy.scale.paragraphs.map((p) => (
              <p key={p} className="copy-luxe text-pretty">
                <RichText text={p} />
              </p>
            ))}
          </div>
          <Investment label={copy.scale.investmentLabel} value={copy.scale.investment} className="mt-7" />
          <div className="mt-8 flex justify-center">
            <AnchorCta label={copy.scale.cta} to={`#${LEAP_TIERS_ID}`} />
          </div>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── 9 · The two tiers ────────────────────────────────────────────────── */

function TierCard({
  accent,
  eyebrow,
  title,
  children,
}: {
  accent: Accent;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <GlassCard accent={accent} interactive={false} className="flex h-full flex-col p-7 sm:p-9">
      <LuxePill accent={accent === "plum" ? "plum" : "gold"} className="self-start">
        {eyebrow}
      </LuxePill>
      <h3 className="mt-5 text-balance font-display text-[1.5rem] font-medium leading-[1.2] text-white sm:text-[1.8rem]">
        {title}
      </h3>
      <GoldRule width="w-12" className="mt-5" />
      <div className="mt-6 flex flex-1 flex-col">{children}</div>
    </GlassCard>
  );
}

function BonusBlock({ title, items }: { title: string; items: readonly { lead: string; body: string }[] }) {
  return (
    <div className="mt-7">
      <p className="font-semibold text-white">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item.lead} className="flex gap-3 text-[0.95rem] leading-[1.6] text-orchid">
            <span aria-hidden className="mt-[0.6rem] size-1.5 shrink-0 rotate-45 bg-gold" />
            <span className="min-w-0">
              <strong className="font-semibold text-white">{item.lead}</strong>
              {item.body && (
                <>
                  {" "}
                  <span className="font-sans tabular-nums">{item.body}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TiersSection() {
  const reduce = useEntranceMotion();
  const { tier1, tier2 } = copy.tiers;
  return (
    <Section
      id={LEAP_TIERS_ID}
      surface="deep"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.8}
      aria-label={copy.tiers.title}
      className="scroll-mt-24"
    >
      <SectionTitle title={copy.tiers.title} body={copy.tiers.intro} />
      <motion.p
        {...rise(reduce, 0.06)}
        className="mt-8 text-center text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-gold"
      >
        {copy.tiers.lead}
      </motion.p>

      <div className="mt-8 grid items-stretch gap-6 lg:grid-cols-2">
        <motion.div {...rise(reduce, 0.08)} className="h-full">
          <TierCard accent="gold" eyebrow={tier1.eyebrow} title={tier1.title}>
            <LeadList items={tier1.points} />
            <BonusBlock title={tier1.bonusesTitle} items={tier1.bonuses} />
            <p className="mt-6 font-sans font-bold tabular-nums text-gold">{tier1.totalValue}</p>
            <div className="mt-auto pt-7">
              <Investment label={copy.tiers.investmentLabel} value={tier1.investment} />
              <div className="mt-6">
                <AnchorCta label={tier1.cta} to={LEAP_ENROL_PATH} />
              </div>
            </div>
          </TierCard>
        </motion.div>

        <motion.div {...rise(reduce, 0.14)} className="h-full">
          <TierCard accent="plum" eyebrow={tier2.eyebrow} title={tier2.title}>
            <p className="font-semibold text-white">{tier2.kicker}</p>
            <p className="copy-luxe mt-4 text-pretty text-[0.95rem]">{tier2.body}</p>
            <p className="mt-6 font-semibold text-white">{tier2.includesTitle}</p>
            <LeadList items={tier2.points} className="mt-4" />
            <BonusBlock title={tier2.bonusesTitle} items={tier2.bonuses} />
            <p className="mt-6 font-sans font-bold tabular-nums text-gold">{tier2.totalValue}</p>
            <div className="mt-auto pt-7">
              <Investment label={copy.tiers.investmentLabel} value={tier2.investment} />
              <div className="mt-6">
                <AnchorCta label={tier2.cta} to={LEAP_ENROL_PATH} />
              </div>
            </div>
          </TierCard>
        </motion.div>
      </div>

      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-12 max-w-[62ch] space-y-5 text-center">
        <p className="text-pretty font-semibold leading-[1.75] text-white">{copy.tiers.closing}</p>
        <p className="text-pretty text-sm leading-[1.7] text-orchid-faint">
          <strong className="font-semibold text-orchid">{copy.tiers.disclaimerLead}</strong>
          {copy.tiers.disclaimer}
        </p>
      </motion.div>
    </Section>
  );
}
