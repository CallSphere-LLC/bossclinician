import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { SubscribeForm } from "@/components/forms/SubscribeForm";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

/**
 * The Practice Reset Planner — the free 30-day lead magnet.
 *
 * The live page runs promise → planner cover → the four-phase path → who this
 * is for → opt-in, and this rebuild keeps that order and that copy word for
 * word. The only substitution is the capture itself: the .com sends both
 * "GET THE FREE PLANNER" buttons to a separate Kajabi opt-in page, so here the
 * hero and the mid-page CTA scroll to the form this site already owns, and the
 * source's button label survives as the heading over it.
 *
 * The planner cover is set in type rather than pulled from the source markup:
 * the .com's cover slot is still a Kajabi `placeholder.png`, and the words that
 * read as the cover are live DOM text on that page, not pixels in the image.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** Anchor both "GET THE FREE PLANNER" buttons land on. */
const OPT_IN_ID = "get-the-free-planner";

/* ── Copy, verbatim from bossclinician.com/practice-reset-planner ─────── */

const HERO_HEADLINE = "The Practice Reset Planner Work less. Earn more. Finally.";

const HERO_SUBHEAD = "30 days to work less, earn more, and rebuild your practice your way.";

const HERO_QUALIFIER =
  "If your schedule is full but your income still feels inconsistent — or you're exhausted from the pace and not sure how to change it — this planner is your starting point. Not more hustle. A reset.";

const REASSURANCE = "Free download · 30-day guided plan · No fluff · Instant access";

const PATH_HEADING = "30 days. A clear path forward.";

const PHASES: ReadonlyArray<{ number: string; title: string; body: string }> = [
  {
    number: "1",
    title: "Audit & Awareness",
    body: "Get honest about what's working — and what's costing you",
  },
  {
    number: "2",
    title: "Reposition & Redesign",
    body: "Rebuild around your goals, not your current limits",
  },
  {
    number: "3",
    title: "Build Scalable Income",
    body: "Stop trading all your time for money",
  },
  {
    number: "4",
    title: "Systems & Sustainability",
    body: "Protect your time, energy, and income long-term",
  },
];

const WHO_HEADING =
  "This planner is for the clinician who knows something needs to change — and is ready to do something about it.";

const WHO_BODY =
  "Whether you're just starting out, fully booked and burning out, or running a group practice that's grown beyond what you can manage alone — a reset isn't a sign that something went wrong. It's a sign you're ready to build something better. This planner gives you the structure to stop operating in reaction mode and start building a practice that actually works for your life — at any stage.";

const OPT_IN_HEADING = "Your 30-day reset starts here.";

const OPT_IN_BODY =
  "Enter your name and email below and we'll deliver The Practice Reset Planner directly to your inbox — free, instant, and ready to use today.";

const OPT_IN_LABEL = "SEND ME THE FREE PLANNER";

const PRIVACY_NOTE =
  "We respect your privacy. No spam — just your planner and occasional strategy content from Boss Clinician.";

/**
 * Break a headline at its natural turn so the second clause can be set in foil
 * italic on its own line. Splitting the source string rather than retyping the
 * halves keeps every headline byte-identical to the live page — only the space
 * at the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const [HERO_TITLE, HERO_ACCENT] = splitOnce(HERO_HEADLINE, " Work less.");
const [PATH_TITLE, PATH_ACCENT] = splitOnce(PATH_HEADING, " A clear path");
const [WHO_TITLE, WHO_ACCENT] = splitOnce(WHO_HEADING, " and is ready");
const [OPT_IN_TITLE, OPT_IN_ACCENT] = splitOnce(OPT_IN_HEADING, " starts here.");

/** One rise recipe for the page; only the delay changes. */
function rise(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/** Accents cycle so the four phases read as siblings, not as a ladder. */
const PHASE_ACCENTS: readonly Accent[] = ["green", "plum", "gold", "neutral"];

export default function PracticeResetPlanner() {
  return (
    <>
      <Seo
        title="Practice Reset Planner"
        description="30 days to work less, earn more, and rebuild your practice your way. A free step-by-step planner for therapists ready to reclaim their time, income, and energy."
      />

      <HeroBlock />
      <PathSection />
      <WhoSection />
      <OptInSection />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Planner cover
   ══════════════════════════════════════════════════════════════════════════ */

interface CoverProps {
  titleLines: readonly string[];
  subLines: readonly string[];
  className?: string;
}

/**
 * The cover plate. Same frame recipe the photographic plates elsewhere on the
 * site use — rounded, gold hairline, vignette, ambient bloom — but the artwork
 * is type, because the source page's cover slot holds a theme placeholder and
 * the words are real text sitting on top of it.
 */
function PlannerCover({ titleLines, subLines, className }: CoverProps) {
  return (
    <div className={cn("relative isolate mx-auto w-full max-w-[19rem] sm:max-w-[21rem]", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 50% 32%, rgba(123,94,167,0.42) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-night-deep shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(155deg, rgba(75,46,131,0.5) 0%, rgb(var(--c-night, 10 7 19) / 0.9) 55%, rgb(var(--c-night-deep, 6 4 11)) 100%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(112%_78%_at_50%_18%,transparent_18%,rgba(6,4,11,0.55)_68%,rgba(6,4,11,0.92)_100%)]"
        />
        {/* Inset foil keyline — the cover reads as a printed jacket. */}
        <div
          aria-hidden
          className="absolute inset-[0.7rem] rounded-xl border border-gold/20 sm:inset-3"
        />

        <div className="relative flex aspect-[4/5] flex-col items-center justify-center px-7 py-10 text-center sm:px-9">
          <p className="text-[0.72rem] font-semibold uppercase leading-none tracking-[0.16em] text-gold sm:text-[0.68rem] sm:tracking-[0.3em]">
            BOSS CLINICIAN
          </p>

          <GoldRule width="w-12" className="mt-5" />

          <p className="mt-5 text-balance font-display text-[1.7rem] font-normal leading-[1.14] text-white sm:text-[2rem]">
            {titleLines.map((line, i) => (
              <span key={line} className={cn("block", i > 0 && "mt-0.5")}>
                {line}
              </span>
            ))}
          </p>

          <p className="mt-5 text-pretty text-sm font-light leading-[1.7] text-orchid-dim">
            {subLines.map((line, i) => (
              <span key={line} className={cn("block", i > 0 && "mt-0.5")}>
                {line}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Offset registration marks — the plate reads as mounted, not pasted. */}
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

/* ══════════════════════════════════════════════════════════════════════════
   1 · Hero
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The source's "←" glyph becomes a drawn arrow, the same substitution the blog
 * makes, so it can travel on hover and keyboard focus while the words stay
 * exactly as written.
 */
function BackArrow() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 8"
      fill="none"
      className="h-2 w-5 shrink-0 -scale-x-100 transition-transform duration-300 ease-luxe group-hover:-translate-x-1"
    >
      <path
        d="M0 4h18M14.5 0.8 18.4 4l-3.9 3.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroBlock() {
  return (
    <LuxePageHero
      eyebrow="FREE 30-DAY PLANNER · BOSS CLINICIAN"
      title={HERO_TITLE}
      titleAccent={HERO_ACCENT}
      tone="violet"
      lede={
        <>
          <span className="block">{HERO_SUBHEAD}</span>
          <span className="mt-5 block">{HERO_QUALIFIER}</span>
        </>
      }
      actions={
        <>
          <LuxeButton variant="foil" size="lg" href={`#${OPT_IN_ID}`}>
            GET THE FREE PLANNER
          </LuxeButton>

          <LuxeButton
            variant="glass"
            size="sm"
            to="/resource-hub"
            className="min-h-[44px] tracking-[0.1em] sm:tracking-[0.16em]"
          >
            <BackArrow />
            BACK TO RESOURCE HUB
          </LuxeButton>

          {/* w-full breaks the reassurance onto its own row of the action
              flexbox instead of squeezing it beside the buttons on a phone. */}
          <p className="w-full text-pretty text-sm font-light leading-[1.7] text-orchid-faint">
            {REASSURANCE}
          </p>
        </>
      }
      aside={
        <PlannerCover
          titleLines={["The Practice Reset Planner"]}
          subLines={["30 Days to Work Less, Earn More, and Rebuild Your Practice Your Way"]}
        />
      }
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · The 30-day path
   ══════════════════════════════════════════════════════════════════════════ */

function PathSection() {
  return (
    <Section
      surface="raised"
      space="md"
      aurora="gold"
      auroraIntensity={0.5}
      aria-label="What is inside the planner"
    >
      <SectionTitle
        align="center"
        eyebrow="THE PRACTICE RESET PLANNER"
        title={
          <>
            {PATH_TITLE}{" "}
            <span className="text-foil font-display italic">{PATH_ACCENT}</span>
          </>
        }
      />

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:gap-10">
        <PlannerCover
          titleLines={["The Practice", "Reset Planner"]}
          subLines={["30 Days to Work Less, Earn More,", "and Rebuild Your Practice Your Way"]}
          className="lg:max-w-[23rem]"
        />

        {/* An ordered list carries the 1–4 sequence semantically, which lets the
            rendered numerals stay pure decoration instead of being read twice. */}
        <RevealGroup as="ol" className="grid list-none grid-cols-1 items-stretch gap-5">
          {PHASES.map((phase, i) => (
            <RevealItem key={phase.number} as="li" className="h-full">
              <GlassCard
                accent={PHASE_ACCENTS[i % PHASE_ACCENTS.length]}
                className="flex h-full items-start gap-5 overflow-hidden p-6 sm:gap-7 sm:p-7"
              >
                <span
                  aria-hidden
                  className="shrink-0 font-display text-[2.2rem] font-medium leading-none text-gold sm:text-[2.7rem]"
                >
                  {phase.number}
                </span>
                <div className="min-w-0">
                  <h3 className="text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.3rem]">
                    {phase.title}
                  </h3>
                  <p className="copy-luxe mt-2.5 text-pretty text-sm">{phase.body}</p>
                </div>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · Who this is for
   ══════════════════════════════════════════════════════════════════════════ */

function WhoSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="md"
      aurora="green"
      auroraIntensity={0.5}
      aria-label="Who this planner is for"
      containerClassName="max-w-3xl"
    >
      <SectionTitle
        align="center"
        eyebrow="WHO THIS IS FOR"
        className="mx-auto max-w-3xl"
        titleClassName="text-[1.6rem] sm:text-[2rem] lg:text-[2.4rem]"
        title={
          <>
            {WHO_TITLE}{" "}
            <span className="text-foil font-display italic">{WHO_ACCENT}</span>
          </>
        }
      />

      <motion.p {...rise(reduce, 0.1)} className="copy-luxe mx-auto mt-10 max-w-[62ch] text-pretty">
        {WHO_BODY}
      </motion.p>

      <motion.div {...rise(reduce, 0.18)} className="mt-10 text-center">
        <LuxeButton variant="foil" size="lg" href={`#${OPT_IN_ID}`}>
          GET THE FREE PLANNER
        </LuxeButton>
      </motion.div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · Opt-in
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The .com hands this off to a separate Kajabi form page; here the capture is
 * the site's own SubscribeForm, so the source's submit label becomes the
 * heading standing over it and nothing in the copy has to be reworded.
 */
function OptInSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id={OPT_IN_ID}
      surface="base"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.85}
      aria-label="Get the free planner"
      containerClassName="max-w-3xl"
      className="scroll-mt-24"
    >
      <SectionTitle
        align="center"
        title={
          <>
            {OPT_IN_TITLE}{" "}
            <span className="text-foil font-display italic">{OPT_IN_ACCENT}</span>
          </>
        }
        body={OPT_IN_BODY}
      />

      <motion.div {...rise(reduce, 0.12)} className="mx-auto mt-10 max-w-xl">
        <GlassCard accent="gold" interactive={false} className="p-7 text-center sm:p-9">
          <h3 className="text-[0.76rem] font-bold uppercase leading-[1.5] tracking-[0.14em] text-gold sm:text-[0.72rem] sm:tracking-[0.22em]">
            {OPT_IN_LABEL}
          </h3>

          <div className="mt-6 flex justify-center">
            <SubscribeForm source="practice-reset-planner" dark />
          </div>

          <div aria-hidden className="rule-faint mt-8 w-full" />

          <p className="mt-6 text-pretty text-sm font-light leading-[1.7] text-orchid-faint">
            {PRIVACY_NOTE}
          </p>
        </GlassCard>
      </motion.div>
    </Section>
  );
}
