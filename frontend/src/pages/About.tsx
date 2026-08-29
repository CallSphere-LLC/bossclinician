import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * Paragraphs at or under this length are the narrative's punch lines — "You
 * cannot scale on top of a broken structure." — not body copy. Ranking them by
 * size and setting them in Playfair italic is what turns a wall of equal
 * paragraphs into a story with beats. Derived from the copy's own shape rather
 * than hand-tagged, so an edit upstream still lands in the right voice.
 */
const BEAT_MAX = 55;

type Surface = React.ComponentProps<typeof Section>["surface"];
type AuroraTone = React.ComponentProps<typeof Section>["aurora"];
type Accent = React.ComponentProps<typeof GlassCard>["accent"];

/** Card grids cycle the three brand accents in this order. */
const ACCENTS = ["green", "plum", "gold"] as const satisfies readonly Accent[];

/* ── Routes & outbound links ──────────────────────────────────────────────
   /offer-quiz has no counterpart on this site yet, so it stays an absolute
   link to the Kajabi page and opens in a new tab. The three community CTAs
   all resolve to /work-with-me, which is where the Club, Lounge and Boardroom
   live here. */
const QUIZ_URL = "https://www.bossclinician.com/offer-quiz";
const WORK_WITH_ME = "/work-with-me";
const BRIGHTER_TOMORROW = "https://brightertomorrowtherapy.com/";
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

const LINK_CLASS = cn(
  "rounded-sm text-orchid underline decoration-white/20 underline-offset-[5px]",
  "transition-colors duration-300 hover:text-gold hover:decoration-gold/60",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
);

/* ── Copy ─────────────────────────────────────────────────────────────── */

const CREDENTIALS = [
  "LCSW",
  "GROUP PRACTICE OWNER",
  "DOCTORAL CANDIDATE",
  "PRIVATE PRACTICE STRATEGIST",
  "FOUNDER · BOSS CLINICIAN",
] as const;

const FEATURED = [
  {
    label: "BOSS Network",
    href: "https://bringingoutsuccessfulsisters.blogspot.com/2024/05/boss-member-spotlight-yvette-howard.html",
  },
  {
    label: "Bold Journey",
    href: "https://boldjourney.com/story-lesson-highlights-with-yvette-howard-highlight/",
  },
  {
    label: "News 13",
    href: "https://www.ktnv.com/news/fighting-the-stigma-importance-of-getting-more-black-americans-to-seek-mental-health-treatment",
  },
  { label: "Brighter Tomorrow Therapy", href: BRIGHTER_TOMORROW },
] as const;

const ORIGIN = [
  "I was supposed to stay in my stable part-time job at a dialysis clinic and work for an agency. Follow the safe path. Keep waiting for the right moment to start living my purpose.",
  "But every day, I watched patients sitting hooked up to machines for hours alone, scared, and emotionally drained yet no one was tending to the part of them that hurt the most. They were treated. But they weren't seen.",
  "I didn't know it then, but that's where my real journey began. Not in a textbook. Not in grad school. But in a dialysis center, surrounded by the very real emotional pain that illness, trauma, and life can bring.",
  '"What started as a job… awakened a calling."',
  "Becoming a therapist wasn't just a career shift it felt like stepping into purpose. But I learned quickly that therapy wasn't just about diagnosis and treatment plans. It was about dignity. About sitting with people in their hardest moments and reminding them of their strength.",
  "And while I loved the work... I didn't love the system. The agency hours. The productivity quotas. The endless paperwork. The burnout. I was helping others heal while slowly abandoning my own.",
] as const;

const LEAP = [
  "In 2018, while still working at the dialysis clinic, I started seeing therapy clients on the side. By the time I left in 2019, I had built a caseload of 15 to 20 clients, a Vistaprint website I put together because I didn't really know what a niche was, headshots I booked off Groupon, I had a minimal business plan of just making sure I had clients with a mission statement to help my community.",
  "I made every mistake you can imagine. I undercharged, overworked, skipped systems, and didn't even know what documentation auditors were looking for until I was audited and nearly lost thousands.",
  "I was accidentally running a practice. Behind closed doors, I was praying it would all work out.",
  "And it did. But not before I pushed myself to 25 to 30 clients a week and hit a wall so hard I couldn't ignore it anymore. A full caseload didn't equal financial peace. It didn't equal freedom. It just meant more of me to give away and less left for the life I was building it all for.",
] as const;

const TRUTH = [
  "I joined Talkspace looking for volume. What I got was an 80 to 100 client messaging caseload, constant anxiety about crisis risk I couldn't properly assess, and an income that still didn't feel stable. I couldn't do good clinical work in that environment. I left.",
  "I joined Alma with my group practice hoping for referrals and a billing structure that worked for my team. The referrals were minimal, and the billing model didn't fit what I had built. I left that too.",
  "Here's what I learned: platforms are not a business model. They are a temporary solution that creates a permanent dependency. Every clinician I talk to who is struggling is struggling for the same reason they built their income on top of someone else's structure. And that structure was never designed for them to win.",
] as const;

const PLATFORMS = [
  {
    name: "TALKSPACE",
    body: "80 to 100 clients. Messaging anxiety. Crisis risk I couldn't properly assess. An income that still didn't feel stable.",
  },
  {
    name: "ALMA",
    body: "Minimal referrals. A billing structure that didn't fit my team. Promises that didn't match the reality of running a group practice.",
  },
] as const;

const SHIFT = [
  "The moment everything changed was when I stopped operating as a therapist who happened to have a private practice and started leading like a CEO who happened to be a therapist.",
] as const;

const SHIFT_LEAD_IN = ["That shift created everything I have today:"] as const;

interface Win {
  text: string;
  link?: { phrase: string; href: string };
}

const SHIFT_WINS: readonly Win[] = [
  {
    text: "A thriving multi-six-figure group practice Brighter Tomorrow Counseling Services",
    link: { phrase: "Brighter Tomorrow Counseling Services", href: BRIGHTER_TOMORROW },
  },
  { text: "A W2 team of therapists and admin staff I lead with heart" },
  {
    text: "Systems, workflows, billing, credentialing, and compliance processes that actually work",
  },
  { text: "The freedom to work 3 days a week and run my business from anywhere" },
  {
    text: "And eventually Boss Clinician, LLC the coaching company I wish I'd had when I started",
  },
];

const SHIFT_CLOSE = [
  "You cannot scale on top of a broken structure.",
  "That's not a tagline. It's the lesson I learned the hard way through Talkspace, through Alma, through a full caseload that still left me financially anxious, and through building a group practice with no roadmap. Everything I teach comes from the road I already walked.",
] as const;

const NOW_BODY = [
  "You're likely here because you're ready to build something of your own. Not just a practice a business, a legacy, a life. You're tired of guessing your way through decisions. Tired of building something that looks successful on paper but doesn't feel good in real life.",
  "And deep down you're asking: Can I build a practice that is both profitable and purposeful? Can I make money without abandoning my heart? Can I actually do this without burning out?",
  "The answer is yes. You can. And you don't have to do it alone.",
] as const;

const BELIEFS = [
  "Therapists deserve to thrive not just survive",
  "Profit and purpose can exist in the same space",
  "You don't need social media burnout to run a successful practice",
  "You can build a business that honors your values, your family, and your peace",
  "When therapists rise entire communities rise with them",
] as const;

const BUILD = [
  {
    title: "PRIVATE PAY OR HYBRID PRACTICE",
    body: "Consistency, clarity, and confidence without depending on platforms to send you clients.",
  },
  {
    title: "ETHICAL, SCALABLE SYSTEMS",
    body: "Credentialing, billing, compliance, documentation, and workflows that work without you in the room.",
  },
  {
    title: "SUSTAINABLE REVENUE",
    body: "Priced correctly, structured intentionally, and protected legally so your income reflects your expertise.",
  },
  {
    title: "LEADERSHIP IDENTITY",
    body: "Moving from therapist to CEO and eventually to employer, mentor, and group practice owner.",
  },
  {
    title: "A BUSINESS THAT SUPPORTS YOUR LIFE",
    body: "Not the other way around. Three days a week, a team that runs without you in every conversation, and a practice you're proud of on your terms.",
  },
] as const;

const TESTIMONIAL = {
  quote:
    '"Yvette is the mentor every therapist needs. She\'s built exactly what I\'m trying to create, and her experience showed me how to avoid the mistakes most of us make alone. Her guidance gave me the confidence and clarity to move forward with my group practice. Investing in her was an easy yes."',
  name: "Ashley B., LCSW",
  role: "Group Practice Owner",
} as const;

const PERSONAL = [
  "I'm a mom. A business owner. A leader. A therapist. A coach. A doctoral student. And a woman who just like you wanted more freedom, fulfillment, and purpose.",
  "When I'm not mentoring therapists or leading my team, you'll find me sipping iced chai tea, planning my next retreat, dancing with my son in the kitchen, or reminding other women that they are capable of so much more than they've been told.",
  "I didn't build Boss Clinician because I had it all figured out. I built it because I needed it and no one had built it yet.",
  "Everything I teach comes from the road I already walked. The burnout, the platforms, the pregnancy, the audit, the group practice all of it. I'm not teaching theory. I'm teaching the path I took to get from where you are to where you want to be.",
] as const;

/** One rise recipe for the page; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.85, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

export default function About() {
  return (
    <>
      {/* The hero portrait is this page's share card. The sitewide Person node
          already names /about as Yvette's URL, so the page has no structured
          data left of its own to declare. */}
      <Seo
        title="About Yvette"
        description="Yvette Howard is an LCSW, group practice owner, doctoral candidate, and Private Practice Strategist helping therapists and clinicians build sustainable, profitable practices."
        image="/images/af3deab11f02.jpg"
      />

      <LuxePageHero
        eyebrow="MEET YVETTE"
        title="I'm Yvette Howard."
        titleAccent="I've been exactly where you are."
        lede="LCSW. Group practice owner. Doctoral candidate. Private Practice Strategist. And a therapist who once had 80 clients and still couldn't pay herself fairly."
        tone="violet"
        aside={
          <Portrait
            src="/images/af3deab11f02.jpg"
            alt="Yvette Howard, LCSW, Private Practice Strategist and founder of Boss Clinician"
            width={977}
            height={1440}
          />
        }
        actions={
          <div className="flex w-full flex-col gap-7">
            <ul className="flex list-none flex-wrap gap-2 sm:gap-2.5">
              {CREDENTIALS.map((credential, i) => (
                <li key={credential}>
                  <LuxePill
                    accent={i === CREDENTIALS.length - 1 ? "gold" : "neutral"}
                    className="text-[0.7rem] tracking-[0.12em] sm:text-[0.64rem] sm:tracking-[0.16em]"
                  >
                    {credential}
                  </LuxePill>
                </li>
              ))}
            </ul>

            <div>
              <LuxeButton
                variant="foil"
                size="lg"
                href={QUIZ_URL}
                {...EXTERNAL}
                className="w-full sm:w-auto"
              >
                FIND YOUR NEXT STEP →
              </LuxeButton>
            </div>
          </div>
        }
      />

      {/* ── Featured in ───────────────────────────────────────────────────── */}
      <Section surface="base" space="sm" aria-label="Featured in">
        <div className="text-center">
          <span className="eyebrow-luxe">FEATURED IN</span>
          <RevealGroup
            as="ul"
            className="flex list-none flex-wrap items-center justify-center gap-x-8 gap-y-0 sm:gap-x-12"
          >
            {FEATURED.map((item) => (
              <RevealItem as="li" key={item.label}>
                <a
                  href={item.href}
                  {...EXTERNAL}
                  className={cn(
                    "inline-flex min-h-[44px] items-center rounded-sm px-1 font-display text-[1.05rem] italic text-orchid-dim",
                    "transition-colors duration-300 hover:text-gold sm:text-[1.15rem]",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
                  )}
                >
                  {item.label}
                </a>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </Section>

      {/* ── The founder narrative, in four acts ──────────────────────────────
          Each act keeps its eyebrow + heading in a sticky left rail while its
          paragraphs scroll past — the magazine chapter-title device. */}
      <StoryAct
        eyebrow="THE ORIGIN"
        heading="I wasn't supposed to become a therapist."
        body={ORIGIN}
        surface="raised"
        aurora="plum"
        auroraIntensity={0.32}
        dropCap
      />

      <StoryAct
        eyebrow="THE LEAP"
        heading="So I took the leap nervous, unprepared, and pregnant."
        body={LEAP}
        surface="base"
        aurora="violet"
        auroraIntensity={0.3}
      />

      <StoryAct
        eyebrow="THE TRUTH NOBODY TOLD ME"
        heading="I tried every shortcut the industry offered. None of them worked the way they promised."
        body={TRUTH}
        surface="raised"
        aurora={false}
      >
        <RevealGroup
          as="ul"
          className="mt-8 grid list-none grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6"
        >
          {PLATFORMS.map((platform, i) => (
            <RevealItem as="li" key={platform.name} className="h-full">
              <GlassCard
                accent={i === 0 ? "plum" : "gold"}
                className="flex h-full flex-col p-6 sm:p-7"
              >
                <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-gold sm:tracking-[0.2em]">
                  {platform.name}
                </h3>
                <div aria-hidden className="rule-faint mt-4 w-full" />
                <p className="copy-luxe mt-4 text-pretty text-sm">{platform.body}</p>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </StoryAct>

      <StoryAct
        eyebrow="THE SHIFT"
        heading="I stopped running a practice by accident and started running one by design."
        body={SHIFT}
        surface="base"
        aurora="gold"
        auroraIntensity={0.4}
      >
        {/* `beatMax={0}` keeps this line as plain body copy: it is a lead-in to
            the list beneath it, not one of the narrative's punch lines. */}
        <Prose paragraphs={SHIFT_LEAD_IN} beatMax={0} className="mt-5 max-w-[62ch]" />

        <RevealGroup as="ul" className="mt-6 max-w-[62ch] list-none space-y-4">
          {SHIFT_WINS.map((win) => (
            <RevealItem as="li" key={win.text} className="flex items-start gap-3.5">
              <Check className="mt-[0.55rem] text-gold" />
              <span className="copy-luxe min-w-0 text-pretty text-sm">
                <WinText win={win} />
              </span>
            </RevealItem>
          ))}
        </RevealGroup>

        <Prose paragraphs={SHIFT_CLOSE} className="mt-8 max-w-[62ch]" />
      </StoryAct>

      {/* ── Now ───────────────────────────────────────────────────────────── */}
      <Section
        surface="deep"
        space="lg"
        aurora="violet"
        auroraIntensity={0.85}
        aria-label="Now"
        containerClassName="text-center"
      >
        <SectionTitle
          align="center"
          eyebrow="NOW"
          title="Now I help therapists build profitable, heart-led private practices without losing themselves in the process."
          className="max-w-4xl"
          titleClassName="text-[1.55rem] sm:text-[2rem] lg:text-[2.35rem]"
        />

        <Prose
          paragraphs={NOW_BODY}
          payoff
          className="mx-auto mt-8 max-w-[58ch] text-center"
        />

        <RevealGroup className="mx-auto mt-10 max-w-3xl">
          <RevealItem>
            <GlassCard
              accent="plum"
              spotlight={false}
              interactive={false}
              className="p-6 text-left sm:p-8"
            >
              <ul className="list-none space-y-4">
                {BELIEFS.map((belief) => (
                  <li key={belief} className="flex items-start gap-3.5">
                    <Diamond className="mt-[0.55rem] text-lilac" />
                    <span className="copy-luxe min-w-0 text-pretty text-sm">{belief}</span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </RevealItem>
        </RevealGroup>
      </Section>

      {/* ── What I help you build ─────────────────────────────────────────── */}
      <Section
        surface="base"
        space="md"
        aurora="green"
        auroraIntensity={0.35}
        aria-label="What I help you build"
      >
        <SectionTitle
          align="left"
          eyebrow="WHAT I HELP YOU BUILD"
          title="A practice built around your life not the other way around."
          className="max-w-3xl"
          titleClassName="text-[1.7rem] sm:text-[2.1rem] lg:text-[2.5rem]"
        />

        <RevealGroup
          as="ul"
          className="mt-8 grid list-none grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:mt-10 lg:grid-cols-3"
        >
          {BUILD.map((item, i) => (
            <RevealItem as="li" key={item.title} className="h-full">
              <GlassCard
                accent={ACCENTS[i % ACCENTS.length]}
                className="flex h-full flex-col p-6 sm:p-7"
              >
                <h3 className="text-[0.72rem] font-semibold uppercase leading-[1.6] tracking-[0.14em] text-gold sm:tracking-[0.18em]">
                  {item.title}
                </h3>
                <div aria-hidden className="rule-faint mt-4 w-full" />
                <p className="copy-luxe mt-4 text-pretty text-sm">{item.body}</p>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      {/* ── What clinicians say ───────────────────────────────────────────── */}
      <Section
        surface="raised"
        space="md"
        aurora="plum"
        auroraIntensity={0.35}
        aria-label="What clinicians say"
        containerClassName="text-center"
      >
        <SectionTitle
          align="center"
          eyebrow="WHAT CLINICIANS SAY"
          title="Real results from real clinicians."
          titleClassName="text-[1.7rem] sm:text-[2.1rem] lg:text-[2.5rem]"
        />

        <RevealGroup className="mx-auto mt-8 max-w-3xl">
          <RevealItem>
            <GlassCard
              as="figure"
              accent="gold"
              spotlight={false}
              interactive={false}
              className="p-6 text-left sm:p-9"
            >
              <p aria-hidden className="text-[1rem] tracking-[0.28em] text-gold">
                ★★★★★
              </p>

              <blockquote className="mt-5">
                <p className="text-pretty font-display text-[1.1rem] italic leading-[1.65] text-orchid sm:text-[1.25rem]">
                  {TESTIMONIAL.quote}
                </p>
              </blockquote>

              <figcaption className="mt-7 flex items-center gap-4">
                <img
                  src="/images/e342b1098928.jpeg"
                  alt={TESTIMONIAL.name}
                  width={320}
                  height={400}
                  loading="lazy"
                  decoding="async"
                  className="h-14 w-14 shrink-0 rounded-full object-cover object-top ring-1 ring-gold/30"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">
                    {TESTIMONIAL.name}
                  </span>
                  <span className="mt-1 block text-[0.72rem] uppercase tracking-[0.14em] text-orchid-dim sm:tracking-[0.18em]">
                    {TESTIMONIAL.role}
                  </span>
                </span>
              </figcaption>
            </GlassCard>
          </RevealItem>
        </RevealGroup>
      </Section>

      {/* ── A little personal ─────────────────────────────────────────────── */}
      <StoryAct
        eyebrow="A LITTLE PERSONAL"
        heading="Because therapists are humans, too."
        body={PERSONAL}
        surface="base"
        aurora="mixed"
        auroraIntensity={0.5}
        portrait={
          <Portrait
            src="/images/yvette-hero-seated.jpg"
            alt="Yvette Howard, LCSW, away from the therapy room"
            width={960}
            height={1309}
          />
        }
      >
        <div className="mt-10">
          <LuxeButton
            variant="foil"
            size="lg"
            href={QUIZ_URL}
            {...EXTERNAL}
            className="w-full sm:w-auto"
          >
            FIND YOUR OFFER →
          </LuxeButton>
        </div>
      </StoryAct>

      {/* ── Ready to build? ───────────────────────────────────────────────── */}
      <Section
        surface="deep"
        space="lg"
        aurora="mixed"
        auroraIntensity={1}
        aria-label="Ready to build?"
        containerClassName="text-center"
      >
        <SectionTitle
          align="center"
          eyebrow="READY TO BUILD?"
          title="You didn't come this far to stay burnt out and underpaid."
          className="max-w-3xl"
          titleClassName="text-[1.75rem] sm:text-[2.1rem] lg:text-[2.5rem]"
        />

        <ClosingCta />
      </Section>
    </>
  );
}

/* ── Narrative act ────────────────────────────────────────────────────── */

interface StoryActProps {
  eyebrow: string;
  heading: string;
  body: readonly string[];
  surface: Surface;
  aurora: AuroraTone;
  auroraIntensity?: number;
  dropCap?: boolean;
  /** Optional graded photograph pinned under the heading in the left rail. */
  portrait?: ReactNode;
  /** Extra blocks rendered under the prose in the reading column. */
  children?: ReactNode;
}

function StoryAct({
  eyebrow,
  heading,
  body,
  surface,
  aurora,
  auroraIntensity = 0.4,
  dropCap = false,
  portrait,
  children,
}: StoryActProps) {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface={surface}
      space="md"
      aurora={aurora}
      auroraIntensity={auroraIntensity}
      aria-label={heading}
    >
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-14">
        {/* `self-stretch` overrides the grid's `items-start` for this column
            only: a sticky child needs a containing block taller than itself,
            and a content-sized grid item gives it nowhere to travel. */}
        <div className="lg:self-stretch">
          <div className="lg:sticky lg:top-28">
            <motion.div {...rise(reduce, 0.04)}>
              <span className="eyebrow-luxe">{eyebrow}</span>
              <h2 className="text-balance font-display text-[1.6rem] font-medium leading-[1.16] text-white sm:text-[1.9rem] lg:text-[2.05rem]">
                {heading}
              </h2>
            </motion.div>

            <motion.div {...rise(reduce, 0.12)}>
              <GoldRule className="mt-6" />
            </motion.div>

            {portrait && (
              <motion.div
                {...rise(reduce, 0.2)}
                className="mx-auto mt-9 w-full max-w-[17rem] sm:max-w-xs lg:mt-10 lg:max-w-none"
              >
                {portrait}
              </motion.div>
            )}
          </div>
        </div>

        {/* One entrance per act rather than per paragraph: long-form reading
            should not have to wait on six separate observers. */}
        <motion.div {...rise(reduce, 0.16)}>
          <Prose paragraphs={body} dropCap={dropCap} className="max-w-[62ch]" />
          {children}
        </motion.div>
      </div>
    </Section>
  );
}

/* ── Prose ────────────────────────────────────────────────────────────── */

interface ProseProps {
  paragraphs: readonly string[];
  /** Foil drop cap on the first paragraph. Once per page, at the story's open. */
  dropCap?: boolean;
  /** Lift the final paragraph the way a beat is lifted — for closing lines. */
  payoff?: boolean;
  /** Length below which a paragraph is set as a beat. 0 disables lifting. */
  beatMax?: number;
  className?: string;
}

const BEAT_CLASS =
  "text-pretty py-1.5 font-display text-[1.15rem] italic leading-[1.6] text-orchid sm:text-[1.3rem]";

function Prose({
  paragraphs,
  dropCap = false,
  payoff = false,
  beatMax = BEAT_MAX,
  className,
}: ProseProps) {
  return (
    <div className={cn("space-y-5", className)}>
      {paragraphs.map((paragraph, i) => {
        const lifted =
          paragraph.length <= beatMax || (payoff && i === paragraphs.length - 1);

        if (lifted) {
          return (
            <p key={paragraph} className={BEAT_CLASS}>
              {paragraph}
            </p>
          );
        }

        return (
          <p key={paragraph} className="copy-luxe text-pretty">
            {dropCap && i === 0 ? (
              <>
                {/* Float, not ::first-letter: the cap is its own one-glyph box,
                    so the rest of the line stays in normal inline flow beside
                    it. The leading space of the remainder is trimmed because a
                    line box drops white space at its start — without that the
                    next word would sit flush against the cap. */}
                <span className="text-foil float-left mr-[0.1em] mt-1 font-display text-[3.25rem] font-medium leading-[0.8] sm:text-[3.5rem]">
                  {paragraph.slice(0, 1)}
                </span>
                {paragraph.slice(1).replace(/^\s+/, "")}
              </>
            ) : (
              paragraph
            )}
          </p>
        );
      })}
    </div>
  );
}

/** Splits a win at its linked phrase so the anchor keeps the line verbatim. */
function WinText({ win }: { win: Win }) {
  if (!win.link) return <>{win.text}</>;

  const at = win.text.indexOf(win.link.phrase);
  if (at < 0) return <>{win.text}</>;

  return (
    <>
      {win.text.slice(0, at)}
      <a href={win.link.href} {...EXTERNAL} className={LINK_CLASS}>
        {win.link.phrase}
      </a>
      {win.text.slice(at + win.link.phrase.length)}
    </>
  );
}

/* ── Portrait ─────────────────────────────────────────────────────────── */

/**
 * The sources are high-key studio shots on near-white backdrops: dropped onto
 * near-black at full brightness they read as lit rectangles pasted on the page.
 * Grading them down, closing the corners with a vignette and passing a violet
 * soft-light over their whites seats them *in* the dark instead.
 *
 * Deliberately motionless: every caller already wraps it in an animated
 * container whose `initial` is guarded by `useEntranceMotion`.
 */
function Portrait({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <div className="relative isolate mx-auto w-full max-w-[17rem] sm:max-w-xs lg:max-w-none">
      {/* Plum bloom behind the frame. Without a light source of its own the
          portrait reads as a rectangle cut out of the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 44% 34%, rgba(123,94,167,0.42) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          className="aspect-[4/5] w-full max-w-full object-cover object-top brightness-[0.76] contrast-[1.08] saturate-[0.76]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(112%_78%_at_50%_26%,transparent_24%,rgba(10,7,19,0.55)_66%,rgba(6,4,11,0.92)_100%)]"
        />
        <div aria-hidden className="absolute inset-0 bg-glow-violet/20 mix-blend-soft-light" />
      </div>

      {/* Offset crop marks — a printer's registration frame sitting a few
          pixels outside the photograph, so the eye reads a mounted plate. */}
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

/* ── Closing CTA ──────────────────────────────────────────────────────── */

function ClosingCta() {
  const reduce = useEntranceMotion();

  return (
    <>
      <motion.p
        {...rise(reduce, 0.1)}
        className="copy-luxe mx-auto mt-8 max-w-[52ch] text-pretty"
      >
        Find the community that matches your season and let's build the practice you
        actually came here for.
      </motion.p>

      {/* Stacked on phones so the longest label never has to fit a 320px line
          box; a single foil weight keeps the primary action unambiguous. */}
      <motion.div
        {...rise(reduce, 0.18)}
        className="mx-auto mt-10 flex max-w-sm flex-col items-stretch gap-4 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center"
      >
        <LuxeButton variant="foil" size="md" to={WORK_WITH_ME} className="w-full sm:w-auto">
          JOIN THE CLUB
        </LuxeButton>
        <LuxeButton variant="glass" size="md" to={WORK_WITH_ME} className="w-full sm:w-auto">
          JOIN THE LOUNGE
        </LuxeButton>
        <LuxeButton
          variant="outline"
          size="md"
          to={WORK_WITH_ME}
          className="w-full sm:w-auto"
        >
          APPLY FOR THE BOARDROOM
        </LuxeButton>
      </motion.div>

      <motion.div
        {...rise(reduce, 0.26)}
        className="mt-8 flex flex-wrap items-center justify-center gap-x-2"
      >
        <span className="copy-luxe text-sm">Not sure which is right for you?</span>
        <a
          href={QUIZ_URL}
          {...EXTERNAL}
          className={cn(LINK_CLASS, "inline-flex min-h-[44px] items-center text-sm")}
        >
          Take the free 2-minute quiz →
        </a>
      </motion.div>
    </>
  );
}

/* ── Marks ────────────────────────────────────────────────────────────── */

function Diamond({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 8"
      fill="none"
      className={cn("h-2 w-2 shrink-0", className)}
    >
      <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5 shrink-0", className)}
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}
