import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { LeadForm } from "@/components/forms/LeadForm";
import { Section, SectionTitle, GoldRule } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { workWithMe } from "@/content/site";
import { cn } from "@/lib/cn";
import { faqPageNode } from "@/seo/schema";
import { useHeadContext } from "@/ssr/context";

/**
 * Work With Me — the Obsidian Luxe rebuild.
 *
 * The sales argument runs in exactly the order it always has (story → pain →
 * qualification → partnership → pathway → offers → process → proof → objections
 * → enquiry → close); only the material changed. Surfaces alternate base →
 * raised → deep the whole way down, because on a single-hue dark page
 * consecutive sections sharing an elevation read as one endless band.
 *
 * Every word on this page is content, not decoration — the copy comes verbatim
 * from `workWithMe` in content/site.ts and the handful of inline strings are
 * reproduced character for character from the previous build. The enquiry band
 * is the one addition: every call to action here pointed at /apply, so the
 * visitor who was one question short of applying had nowhere to put it.
 */
export default function WorkWithMe() {
  const { origin } = useHeadContext();

  return (
    <>
      {/* The six objections in the FAQ band are the page's own answers, so they
          are declared as an FAQPage: a clinician searching for "is this
          coaching or consulting" can be shown the answer this page already
          gives. The nodes are built from the same `workWithMe.faqs` the band
          renders, which is what stops the markup and the page disagreeing. */}
      <Seo
        title="Work With Me | The Boss Boardroom"
        description="An advanced mastermind for established practice owners who want higher-level strategy, peer collaboration, accountability, and support with scaling their business."
        image={HERO_PORTRAIT}
        jsonLd={[faqPageNode(origin, "/work-with-me", workWithMe.faqs)]}
      />

      <HeroBlock />
      <StorySection />
      <PainSection />
      <ReadySection />
      <PartnershipSection />
      <PathwaysSection />
      <OffersSection />
      <ProcessSection />
      <TestimonialsSection />
      <FaqSection />
      <EnquirySection />
      <ClosingSection />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Shared vocabulary
   ══════════════════════════════════════════════════════════════════════════ */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** The three accents cards cycle through, so a set reads as siblings. */
type Tone = "green" | "plum" | "gold";
const TONE_CYCLE: readonly Tone[] = ["green", "plum", "gold"];

/** Per-accent chrome the GlassCard recipe doesn't cover (ribbon, label, bloom). */
const TONE: Record<Tone, { label: string; ribbon: string; rgb: string }> = {
  green: { label: "text-green-bright", ribbon: "bg-green-bright/[0.09]", rgb: "107, 168, 145" },
  plum: { label: "text-lilac", ribbon: "bg-plum-bright/[0.14]", rgb: "167, 139, 196" },
  gold: { label: "text-gold", ribbon: "bg-gold/[0.10]", rgb: "201, 164, 106" },
};

const toneAt = (i: number): Tone => TONE_CYCLE[i % TONE_CYCLE.length];

/**
 * One rise recipe for the whole page; only the delay changes. Reduced-motion
 * users get `initial={false}` — the final state on mount, never a blank element
 * waiting on an observer that never usefully fires.
 */
function rise(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/** Foil numeral with a bloom behind it — flat foil reads dull at this size. */
function Numeral({ value, className }: { value: string; className?: string }) {
  return (
    <span className="relative inline-block shrink-0">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-8 -top-9 h-28 w-28 rounded-full blur-2xl"
        style={{
          background: "radial-gradient(circle, rgba(201,164,106,0.20) 0%, transparent 70%)",
        }}
      />
      <span
        aria-hidden
        className={cn(
          "text-foil relative block font-display font-medium leading-none tracking-tight",
          className,
        )}
      >
        {value}
      </span>
    </span>
  );
}

/* ── List marks. Decoration only, so every one of them is aria-hidden. ──── */

function Diamond({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 8"
      fill="none"
      className={cn("mt-[0.55rem] h-[7px] w-[7px] shrink-0", className)}
    >
      <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
    </svg>
  );
}

function Mark({ variant, className }: { variant: "check" | "cross"; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("mt-[0.2rem] h-4 w-4 shrink-0", className)}
    >
      {variant === "check" ? (
        <path d="M3 8.4 6.3 11.7 13 4.7" />
      ) : (
        <path d="M4.6 4.6 11.4 11.4M11.4 4.6 4.6 11.4" />
      )}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · Hero
   ══════════════════════════════════════════════════════════════════════════ */

/** Held once: the frame renders it and the page's share card points at it. */
const HERO_PORTRAIT = "/images/758479b0818b.png";

/** Keep the portrait in its original colors. */
function HeroPortrait() {
  return (
    <div className="relative isolate mx-auto max-w-[19rem] sm:max-w-sm lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 45% 30%, rgba(123,94,167,0.45) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src={HERO_PORTRAIT}
          alt="Yvette Howard, private practice strategist for therapists and clinicians"
          width={882}
          height={1440}
          decoding="async"
          className="aspect-[4/5] w-full max-w-full object-cover object-top"
        />
      </div>

      {/* Offset registration marks — the frame reads as a mounted plate. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-3 -right-3 h-12 w-12 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-16 sm:w-16"
      />
    </div>
  );
}

function HeroBlock() {
  return (
    <LuxePageHero
      eyebrow={workWithMe.eyebrow}
      title={workWithMe.heading}
      titleAccent={workWithMe.subheading}
      lede={workWithMe.intro}
      tone="violet"
      actions={
        <LuxeButton to="/apply" variant="foil" size="lg">
          Apply Now →
        </LuxeButton>
      }
      aside={<HeroPortrait />}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · Story
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Long-form reading, so the aurora is dropped low and the block takes one
 * entrance per movement rather than one per paragraph.
 */
function StorySection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="plum"
      auroraIntensity={0.4}
      aria-label="Yvette's story"
      containerClassName="max-w-3xl"
    >
      <motion.div {...rise(reduce, 0)} className="text-center">
        <p className="text-foil text-balance font-display text-[1.7rem] italic leading-[1.22] sm:text-[2.2rem]">
          {workWithMe.storyQuote}
        </p>
        <GoldRule className="mx-auto mt-8" />
        <p className="copy-luxe mx-auto mt-8 max-w-2xl text-balance italic text-orchid">
          {workWithMe.storyDetail}
        </p>
      </motion.div>

      <motion.div {...rise(reduce, 0.12)} className="mx-auto mt-10 max-w-[62ch] space-y-5">
        {workWithMe.story.map((p) => (
          <p key={p} className="copy-luxe text-pretty">
            {p}
          </p>
        ))}
      </motion.div>

      <motion.div {...rise(reduce, 0.2)} className="mt-10 text-center">
        <p className="mx-auto max-w-2xl text-balance font-display text-[1.15rem] italic leading-[1.6] text-orchid sm:text-[1.35rem]">
          {workWithMe.storyClose}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {workWithMe.credentials.map((c) => (
            <LuxePill key={c} accent="gold">
              {c}
            </LuxePill>
          ))}
        </div>
      </motion.div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · Pain
   ══════════════════════════════════════════════════════════════════════════ */

function PainSection() {
  return (
    <Section
      surface="raised"
      space="md"
      aurora="violet"
      auroraIntensity={0.45}
      aria-label="What is not working"
    >
      <SectionTitle align="center" title={workWithMe.painHeading} body={workWithMe.painIntro} />

      {/* An ordered list carries the 01–04 sequence semantically, which lets the
          rendered numerals stay pure decoration instead of being read twice. */}
      <RevealGroup
        as="ol"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-none sm:grid-cols-2"
      >
        {workWithMe.painPoints.map((point, i) => (
          <RevealItem key={point.number} as="li" className="h-full">
            <GlassCard
              accent={toneAt(i)}
              className="flex h-full flex-col overflow-hidden p-7 sm:p-8"
            >
              <Numeral value={point.number} className="text-[3rem] sm:text-[3.6rem]" />
              <GoldRule width="w-10" className="mt-5" />
              <h3 className="mt-5 text-pretty font-display text-[1.3rem] font-medium leading-snug text-white">
                {point.title}
              </h3>
              <p className="copy-luxe mt-3.5 text-pretty text-sm">{point.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · Qualification
   ══════════════════════════════════════════════════════════════════════════ */

function ReadySection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="md"
      aurora="green"
      auroraIntensity={0.5}
      aria-label="Who this work is for"
    >
      <SectionTitle align="center" title={workWithMe.readyHeading} />

      <div className="mx-auto mt-10 grid max-w-md grid-cols-1 items-stretch gap-6 sm:max-w-none sm:grid-cols-2">
        <motion.div {...rise(reduce, 0)} className="h-full">
          <GlassCard accent="green" className="flex h-full flex-col p-7 sm:p-8">
            <h3 className="text-pretty font-display text-[1.3rem] font-medium text-white">
              You're ready for this if…
            </h3>
            <GoldRule width="w-10" className="mt-5" />
            <ul className="mt-6 space-y-3.5">
              {workWithMe.readyYes.map((item) => (
                <li key={item} className="copy-luxe flex gap-3 text-pretty text-sm">
                  <Mark variant="check" className="text-green-bright" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </motion.div>

        <motion.div {...rise(reduce, 0.1)} className="h-full">
          <GlassCard accent="neutral" className="flex h-full flex-col p-7 sm:p-8">
            <h3 className="text-pretty font-display text-[1.3rem] font-medium text-white">
              You're not ready for this if…
            </h3>
            <div aria-hidden className="rule-faint mt-5 w-10" />
            <ul className="mt-6 space-y-3.5">
              {workWithMe.readyNo.map((item) => (
                <li key={item} className="copy-luxe flex gap-3 text-pretty text-sm">
                  <Mark variant="cross" className="text-orchid-faint" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </motion.div>
      </div>

      <motion.div {...rise(reduce, 0.18)} className="mt-10 text-center">
        <LuxeButton to="/apply" variant="foil" size="lg">
          Apply Now For Support
        </LuxeButton>
      </motion.div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · Partnership
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The comparison used to be a 640px-wide table in a horizontal scroller. Two
 * stacked glass panels say the same thing without ever making a phone scroll
 * sideways — and the winning column carries the only foil in the section.
 */
function PartnershipSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="plum"
      auroraIntensity={0.5}
      aria-label="How this partnership works"
    >
      <SectionTitle
        align="center"
        eyebrow="Introducing"
        title="This isn't hourly consulting. It's a strategic partnership."
        body={workWithMe.partnershipBody}
      />

      <div className="mx-auto mt-10 grid max-w-md grid-cols-1 items-stretch gap-6 sm:max-w-4xl sm:grid-cols-2">
        <motion.div {...rise(reduce, 0)} className="h-full">
          <GlassCard
            accent="neutral"
            spotlight={false}
            className="flex h-full flex-col p-7 sm:p-8"
          >
            <h3 className="font-display text-[1.2rem] font-medium text-orchid-dim">
              Hourly Consulting
            </h3>
            <div aria-hidden className="rule-faint mt-5 w-full" />
            <ul className="mt-6 space-y-3.5">
              {workWithMe.comparison.hourly.map((item) => (
                <li key={item} className="flex gap-3 text-pretty text-sm font-light leading-[1.7] text-orchid-faint">
                  <span aria-hidden className="mt-[0.7rem] h-px w-3 shrink-0 bg-ink/25" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </motion.div>

        <motion.div {...rise(reduce, 0.1)} className="h-full">
          <GlassCard accent="gold" className="flex h-full flex-col p-7 sm:p-8">
            <h3 className="text-foil font-display text-[1.2rem] font-medium">
              Boss Clinician Consulting
            </h3>
            <GoldRule className="mt-5" width="w-full" />
            <ul className="mt-6 space-y-3.5">
              {workWithMe.comparison.bossClinician.map((item) => (
                <li key={item} className="copy-luxe flex gap-3 text-pretty text-sm">
                  <Diamond className="text-gold" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </motion.div>
      </div>

      {/* Major break: the argument shifts from comparison to invitation. */}
      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-12 max-w-3xl">
        <GlassCard accent="plum" interactive={false} className="overflow-hidden p-7 sm:p-10">
          <div className="text-center">
            <span className="eyebrow-luxe">Introducing</span>
            <h3 className="text-balance font-display text-[1.45rem] font-medium leading-[1.24] text-white sm:text-[1.9rem]">
              {workWithMe.introducing}
            </h3>
            <p className="copy-luxe mx-auto mt-6 max-w-2xl text-pretty">
              {workWithMe.introducingBody}
            </p>
          </div>

          <ul className="mx-auto mt-8 grid max-w-xl grid-cols-1 gap-x-6 gap-y-3 text-left sm:grid-cols-2">
            {workWithMe.guideList.map((item) => (
              <li key={item} className="copy-luxe flex gap-3 text-pretty text-sm">
                <Diamond className="text-gold" />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · Pathways
   ══════════════════════════════════════════════════════════════════════════ */

type Pathway = (typeof workWithMe.pathways)[number];

/**
 * The chosen pathway, as its own keyed component.
 *
 * The panel is the one place on this page where the same animation serves two
 * purposes: the pathway the page opens on is part of the server-rendered first
 * screen, and every pathway after it is a reply to a tap. Keying the component
 * by label is what lets one hook answer both — the mount that hydrates against
 * static markup is painted in its final state, and each later mount, which no
 * markup is waiting on, fades in.
 */
function PathwayPanel({ pathway, panelId }: { pathway: Pathway; panelId: string }) {
  const reduce = useEntranceMotion();

  return (
    <motion.div
      id={panelId}
      role="region"
      aria-label={pathway.label}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.45, ease: EASE }}
      className="mt-10"
    >
      <div className="mx-auto max-w-3xl text-center">
        <h3 className="text-balance font-display text-[1.7rem] font-medium leading-[1.16] text-white sm:text-[2.2rem]">
          {pathway.title}
        </h3>
        <p className="copy-luxe mx-auto mt-6 max-w-2xl text-pretty">{pathway.body}</p>
      </div>

      <ol className="mt-8 grid list-none grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {pathway.milestones.map((m, i) => (
          <li key={m.title} className="h-full">
            <GlassCard
              accent={toneAt(i)}
              className="flex h-full flex-col overflow-hidden p-6 sm:p-7"
            >
              <Numeral value={`0${i + 1}`} className="text-[2.1rem] sm:text-[2.4rem]" />
              <h4 className="mt-4 text-pretty font-display text-[1.1rem] font-medium leading-snug text-white">
                {m.title}
              </h4>
              <p className="copy-luxe mt-2.5 text-pretty text-sm">{m.body}</p>
            </GlassCard>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

function PathwaysSection() {
  const reduce = useEntranceMotion();
  const uid = useId();
  const [active, setActive] = useState(1);
  const pathway = workWithMe.pathways[active];
  const panelId = `${uid}-pathway`;

  return (
    <Section
      surface="raised"
      space="md"
      aurora="gold"
      auroraIntensity={0.5}
      aria-label="Pathways"
    >
      <SectionTitle
        align="center"
        eyebrow="Find your path"
        title="Every clinician is at a different stage. Your strategy should reflect that."
        body="Boss Clinician Consulting isn't one-size-fits-all. Choose the pathway below that reflects your current season — and we'll build the rest together."
      />

      {/* Toggle buttons rather than an ARIA tablist: without roving-tabindex
          arrow-key handling a tablist is a broken promise, and three plain
          buttons are already reachable and announced correctly. */}
      <div className="mx-auto mt-10 flex max-w-2xl flex-wrap justify-center gap-3">
        {workWithMe.pathways.map((p, i) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setActive(i)}
            aria-pressed={active === i}
            aria-controls={panelId}
            className={cn(
              "inline-flex min-h-[44px] items-center rounded-full px-5 py-2.5",
              "text-[0.72rem] font-semibold uppercase tracking-[0.12em] sm:tracking-[0.16em]",
              "transition-all duration-300 ease-luxe",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
              active === i
                ? "bg-gold-foil text-night-deep shadow-[0_12px_30px_-14px_rgba(201,164,106,0.75)]"
                : "glass-soft text-orchid hover:border-gold/40 hover:text-white",
            )}
          >
            {p.label}
            {p.badge && (
              <span
                className={cn(
                  "ml-2.5 rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.08em]",
                  // On the foil pill the badge is a dark cut-out; off it, the
                  // badge has to supply its own gold or it disappears.
                  active === i ? "bg-[#06040b]/20" : "bg-gold/20 text-gold",
                )}
              >
                {p.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <PathwayPanel key={pathway.label} pathway={pathway} panelId={panelId} />

      <motion.div {...rise(reduce, 0.08)} className="mt-10 text-center">
        <p className="copy-luxe">Not sure which pathway is yours?</p>
        <h3 className="mt-2 text-balance font-display text-[1.35rem] font-medium text-white sm:text-[1.6rem]">
          That's exactly what the strategy call is for.
        </h3>
        <LuxeButton to="/apply" variant="foil" size="lg" className="mt-8">
          Apply Now — Let's Find Your Path
        </LuxeButton>
      </motion.div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · Offers
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One engagement, since the two one-to-one tiers this band used to carry were
 * withdrawn. The card keeps the geometry it had as one of three, because a
 * lone offer stretched across the old three-column grid reads as two cards
 * that failed to load; the grid is capped at a single centred column instead.
 *
 * The accent is pinned to gold rather than taken from the cycle: the Boardroom
 * is gold on the home page and in the store, and a flagship that changes colour
 * between surfaces reads as a different product.
 */
function OffersSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="mixed"
      auroraIntensity={0.7}
      aria-label="The Boss Boardroom"
    >
      <SectionTitle
        align="center"
        eyebrow="I don't sell calls. I build Bosses."
        title="The Boss Clinician Boardroom — Mastermind"
        body="An advanced mastermind for established practice owners who want higher-level strategy, peer collaboration, accountability, and support with scaling their business."
      />

      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-7 sm:max-w-xl"
      >
        {workWithMe.offers.map((offer) => {
          const tone = TONE.gold;

          return (
            <RevealItem key={offer.name} as="li" className="h-full">
              <GlassCard accent="gold" className="flex h-full flex-col overflow-hidden">
                {/* Duration ribbon, bled to the clipped corners so it reads as a
                    band printed on the panel rather than a chip inside it. */}
                <div className={cn("relative px-7 py-3.5 sm:px-8", tone.ribbon)}>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-16 left-0 h-28 w-2/3 blur-2xl"
                    style={{
                      background: `radial-gradient(ellipse at center, rgba(${tone.rgb},0.30) 0%, transparent 70%)`,
                    }}
                  />
                  <p
                    className={cn(
                      "relative flex items-center gap-2.5 text-[0.7rem] font-bold uppercase leading-none tracking-[0.14em] sm:text-[0.64rem] sm:tracking-[0.2em]",
                      tone.label,
                    )}
                  >
                    <svg aria-hidden viewBox="0 0 8 8" fill="none" className="h-[7px] w-[7px] shrink-0">
                      <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
                    </svg>
                    <span className="min-w-0">{offer.duration}</span>
                  </p>
                </div>
                <div
                  aria-hidden
                  className="h-px w-full"
                  style={{
                    backgroundImage: `linear-gradient(90deg, rgba(${tone.rgb},0.55), rgba(${tone.rgb},0.16) 55%, transparent)`,
                  }}
                />

                <div className="flex flex-1 flex-col p-7 sm:p-8">
                  <h3 className="text-balance font-display text-[1.6rem] font-medium leading-tight text-white">
                    {offer.name}
                  </h3>

                  {/* flex-1 on the list — not on a wrapper — is what keeps the
                      CTA pinned to the foot of the card however long the
                      feature list runs. */}
                  <ul className="mt-6 flex-1 space-y-3">
                    {offer.features.map((f) => (
                      <li key={f} className="copy-luxe flex gap-3 text-pretty text-sm">
                        <Diamond className={tone.label} />
                        <span className="min-w-0">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div aria-hidden className="rule-faint mt-8 w-full" />

                  <LuxeButton
                    to="/apply"
                    variant="glass"
                    size="sm"
                    className="mt-6 min-h-[44px] w-full"
                  >
                    Apply For This Offer
                  </LuxeButton>
                </div>
              </GlassCard>
            </RevealItem>
          );
        })}
      </RevealGroup>

      {/* Policies. Three across only from md: at 640px a third of the container
          is a ~130px measure, which is a gutter with words in it, not a column. */}
      <motion.ul
        {...rise(reduce, 0.1)}
        className="mx-auto mt-12 grid max-w-4xl list-none grid-cols-1 gap-5 md:grid-cols-3"
      >
        {workWithMe.policies.map((policy) => (
          <li key={policy.title} className="h-full">
            <GlassCard
              accent="neutral"
              interactive={false}
              spotlight={false}
              className="flex h-full flex-col p-6 text-center"
            >
              <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-gold sm:text-[0.66rem] sm:tracking-[0.2em]">
                {policy.title}
              </h3>
              <p className="copy-luxe mt-3 text-pretty text-sm">{policy.body}</p>
            </GlassCard>
          </li>
        ))}
      </motion.ul>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · Process
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Five steps as a vertical ladder rather than the old five-across grid: at
 * 1440px a fifth of the container is ~230px, which is not a column, it is a
 * gutter with words in it. Numeral left, copy right, one rung per step.
 */
function ProcessSection() {
  return (
    <Section
      surface="deep"
      space="md"
      aurora="violet"
      auroraIntensity={0.5}
      aria-label="How we work together"
    >
      <SectionTitle align="center" title="Simple, high-touch, and built around you." />

      <RevealGroup as="ol" className="mx-auto mt-10 grid max-w-3xl list-none gap-5">
        {workWithMe.process.map((step, i) => (
          <RevealItem key={step.title} as="li">
            <GlassCard
              accent={toneAt(i)}
              className="flex items-start gap-5 overflow-hidden p-6 sm:gap-7 sm:p-8"
            >
              <Numeral value={`0${i + 1}`} className="text-[2.4rem] sm:text-[3.2rem]" />
              <div className="min-w-0">
                <h3 className="text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.35rem]">
                  {step.title}
                </h3>
                <p className="copy-luxe mt-2.5 text-pretty text-sm">{step.body}</p>
              </div>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   9 · Proof
   ══════════════════════════════════════════════════════════════════════════ */

function TestimonialsSection() {
  return (
    <Section
      surface="raised"
      space="md"
      aurora="plum"
      auroraIntensity={0.45}
      aria-label="Testimonials"
    >
      <SectionTitle align="center" title="Clinicians who chose to build differently" />

      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-start gap-6 sm:max-w-none sm:grid-cols-2"
      >
        {workWithMe.testimonialQuotes.map((t, i) => {
          const tone = TONE[toneAt(i)];

          return (
            <RevealItem key={t.name} as="li">
              <GlassCard as="figure" accent={toneAt(i)} className="overflow-hidden p-7 sm:p-8">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-4 -top-8 h-32 w-32 rounded-full blur-2xl"
                  style={{
                    background: `radial-gradient(circle, rgba(${tone.rgb},0.16) 0%, transparent 70%)`,
                  }}
                />
                {/* Absolutely placed so the glyph acts as a printed drop-cap
                    instead of pushing the quote down by a 4rem line box. */}
                <span
                  aria-hidden
                  className="text-foil pointer-events-none absolute left-7 top-4 select-none font-display text-[3.6rem] leading-none sm:left-8"
                >
                  &ldquo;
                </span>

                <blockquote className="relative pt-9 font-display text-[1.02rem] italic leading-[1.75] text-orchid">
                  <p className="text-pretty">&ldquo;{t.quote}&rdquo;</p>
                </blockquote>

                <div aria-hidden className="rule-faint mt-7 w-full" />

                <figcaption
                  className={cn(
                    "mt-5 text-pretty text-[0.72rem] font-semibold uppercase tracking-[0.12em] sm:text-[0.68rem] sm:tracking-[0.18em]",
                    tone.label,
                  )}
                >
                  {t.name}
                </figcaption>
              </GlassCard>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   10 · FAQ
   ══════════════════════════════════════════════════════════════════════════ */

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduce = useReducedMotion();
  const uid = useId();

  return (
    <Section
      surface="base"
      space="md"
      aria-label="Frequently asked questions"
      containerClassName="max-w-3xl"
    >
      <SectionTitle align="center" title="Answers before you apply." />

      <div className="mt-10 space-y-3.5">
        {workWithMe.faqs.map((faq, i) => {
          const isOpen = openIndex === i;
          const panelId = `${uid}-faq-panel-${i}`;
          const buttonId = `${uid}-faq-button-${i}`;

          return (
            <GlassCard
              key={faq.q}
              accent={toneAt(i)}
              interactive={false}
              spotlight={false}
              className="overflow-hidden"
            >
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-6 py-5 text-left",
                    "min-h-[56px] transition-colors duration-300 ease-luxe hover:bg-white/[0.03]",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                  )}
                >
                  <span className="min-w-0 text-pretty text-[0.95rem] font-medium text-white">
                    {faq.q}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0 font-display text-2xl leading-none text-gold transition-transform duration-500 ease-luxe",
                      isOpen && "rotate-45",
                    )}
                  >
                    +
                  </span>
                </button>
              </h3>

              {/* No `role="region"` here: six named landmarks for six answers
                  is landmark proliferation, which the APG warns against. The
                  button's aria-expanded/aria-controls already describe the
                  relationship, and aria-hidden keeps the collapsed answer out
                  of the accessibility tree entirely. */}
              <motion.div
                id={panelId}
                aria-hidden={!isOpen}
                initial={false}
                animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
                className="overflow-hidden"
              >
                <div aria-hidden className="rule-faint mx-6 w-auto" />
                <p className="copy-luxe px-6 pb-6 pt-5 text-pretty text-sm">{faq.a}</p>
              </motion.div>
            </GlassCard>
          );
        })}
      </div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   11 · Enquiry
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The soft close, sitting between the objections and the hard one.
 *
 * The application is a commitment, and until now the only thing this page did
 * with a visitor who was still deciding was point them at it again. This band
 * posts to /api/leads with source "work-with-me", so the question lands in the
 * admin Leads inbox where it can actually be answered — and the visitor who
 * *is* ready still meets the foil "Apply" button one band further down.
 *
 * `id` + `scroll-mt-24` follow the retreat page's anchor convention, so
 * /work-with-me#enquire is linkable from anywhere on the site.
 */
function EnquirySection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="enquire"
      surface="raised"
      space="md"
      aurora="green"
      auroraIntensity={0.45}
      aria-label="Ask about working together"
      className="scroll-mt-24"
    >
      <SectionTitle
        align="center"
        eyebrow="Still deciding?"
        title="Not ready to apply? Ask me first."
        body="Tell me where your practice is right now and I'll tell you honestly whether the Boardroom is the right container for this season — and which pathway I'd put you in."
      />

      <motion.div {...rise(reduce, 0.12)} className="mx-auto mt-10 max-w-3xl">
        <LeadForm
          source="work-with-me"
          submitLabel="Send My Question"
          messageLabel="Where is your practice now, and what do you want it to look like?"
          messagePlaceholder="Your caseload, your income, the pathway you think you're in — and anything you want to know before you apply…"
          successTitle="Question received."
          successBody="I answer these myself — you'll hear back from me within 24 hours, and nothing about applying is decided before then."
        />
      </motion.div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   12 · Close
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The last frame. Every other band is lit from the edges by drifting aurora;
 * this one adds a fixed pool of gold low in the frame so the headline sits on a
 * horizon of light rather than on flat black.
 */
function ClosingSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="mixed"
      auroraIntensity={1.15}
      aria-label="Apply to work with Yvette"
      containerClassName="max-w-3xl text-center"
    >
      <div className="relative">
        <motion.div
          aria-hidden
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 1.8, ease: EASE }}
          className="pointer-events-none absolute left-1/2 top-[72%] -z-10 h-[22rem] w-[min(200%,58rem)] -translate-x-1/2 -translate-y-1/2 sm:h-[30rem]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(201,164,106,0.22) 0%, rgba(201,164,106,0.08) 34%, rgba(123,94,167,0.07) 56%, transparent 74%)",
          }}
        />

        {/* Both halves live in one h2 so the section keeps a single heading;
            the spans only carry the stagger and the change of voice. */}
        <h2 className="text-balance font-display font-normal leading-[1.06] tracking-tight text-white">
          <motion.span
            {...rise(reduce, 0.06)}
            className="block text-[2.1rem] sm:text-[3.1rem] lg:text-[3.7rem]"
          >
            You didn't come this far
          </motion.span>
          <motion.span
            {...rise(reduce, 0.18)}
            className="text-foil mt-1.5 block font-display text-[2rem] italic sm:text-[3rem] lg:text-[3.6rem]"
          >
            to stay burnt out and underpaid.
          </motion.span>
        </h2>

        <motion.p {...rise(reduce, 0.3)} className="copy-luxe mx-auto mt-8 max-w-xl text-pretty">
          {workWithMe.closing.body}
        </motion.p>

        <motion.div {...rise(reduce, 0.42)} className="mt-10">
          <LuxeButton to="/apply" variant="foil" size="lg">
            Apply to Work With Yvette
          </LuxeButton>
        </motion.div>

        <motion.p
          {...rise(reduce, 0.52)}
          className="mx-auto mt-6 max-w-xl text-pretty text-sm text-orchid-faint"
        >
          {workWithMe.closing.footnote}
        </motion.p>
      </div>
    </Section>
  );
}
