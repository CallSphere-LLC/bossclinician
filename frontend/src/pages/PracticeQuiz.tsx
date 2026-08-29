import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

/**
 * Practice Set Up Quiz — the free 2-minute quiz landing page.
 *
 * The live page is a single screen: back link, eyebrow, headline, one
 * explanatory paragraph, a row of four reassurances, the button, and the fine
 * print under it. This rebuild keeps that order and that copy word for word and
 * spends nothing on filler — the source has no second act, so the page has no
 * second act either. Two bands: the promise, then the reassurances running
 * straight into the one action.
 *
 * The quiz engine itself has not moved yet: the .com serves the six questions
 * and the four results from its own page, so the single CTA is an absolute
 * bossclinician.com link opened in a new tab until that engine lands here.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/* ── Copy, verbatim from bossclinician.com/practice-quiz ──────────────── */

const HERO_EYEBROW = "FREE 2-MINUTE QUIZ · BOSS CLINICIAN";

const HERO_HEADLINE = "Is Your Practice Set Up to Pay You or Just Keep You Busy?";

const HERO_LEDE =
  "Answer 6 quick questions and find out what's really standing between you and a practice that works for your life plus discover exactly what type of practice builder you are.";

/** The source's link reads "← RESOURCE HUB"; the glyph is drawn, the words stand. */
const BACK_LABEL = "RESOURCE HUB";

const STATS: readonly string[] = [
  "6 questions",
  "2 minutes",
  "4 personalized results",
  "Your next step, clearly",
];

const CTA_LABEL = "TAKE THE FREE QUIZ →";

const CTA_NOTE = "No email required to start";

/**
 * The quiz engine (six questions, four results) still lives on the Kajabi site,
 * so this is deliberately an absolute .com URL rather than a local route.
 *
 * CUTOVER BLOCKER: the moment bossclinician.com points at this app, this URL
 * resolves to the page the visitor is already standing on — the button becomes
 * a no-op loop and the quiz is simply gone. It cannot be fixed with a redirect
 * (/practice-quiz is a real route here, so 004's self-row is inert), and it is
 * not one dead button: 004 funnels six legacy quiz URLs (/offer-quiz,
 * /hiring-quiz, /boss-assessment, /start-your-own-private-practice-quiz,
 * /practice-set-up-quiz, /practice-set-up-quiz-ty) plus /ready-quiz into this
 * page, so every quiz entry point in the redirect map ends here.
 *
 * Resolving it is a content decision, not a code one: either rebuild the quiz
 * as an assessment on this app (the machinery exists — see
 * backend/src/services/assessments.ts and the /quiz/:slug route) and point
 * QUIZ_URL at it, or keep the engine on a host that survives the cutover and
 * name that host here. Do not leave it pointing at the apex domain.
 */
const QUIZ_URL = "https://www.bossclinician.com/practice-quiz";

/**
 * Break the headline at its natural turn so the second clause can be set in foil
 * italic on its own line. Splitting the source string rather than retyping the
 * halves keeps the headline byte-identical to the live page — only the space at
 * the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const [HERO_TITLE, HERO_ACCENT] = splitOnce(HERO_HEADLINE, " or Just Keep You Busy?");

/**
 * Three of the four reassurances open with a count, so the count is lifted out
 * as the tile's figure and the rest becomes its caption. Derived from the source
 * string rather than retyped, so the words and their order are untouched; the
 * fourth reassurance has no count and takes a foil-free diamond in the same
 * slot, which keeps all four tiles on one baseline.
 */
interface Stat {
  figure?: string;
  caption: string;
}

function splitStat(text: string): Stat {
  const match = /^(\d+)\s+(.+)$/.exec(text);
  return match ? { figure: match[1], caption: match[2] } : { caption: text };
}

/** Accents cycle so the four tiles read as siblings, not as a ranking. */
const STAT_ACCENTS: readonly Accent[] = ["gold", "plum", "green", "neutral"];

/** One rise recipe for the page; only the delay changes. */
function rise(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

export default function PracticeQuiz() {
  return (
    <>
      <Seo
        title="Practice Set Up Quiz"
        description="Take this free 2-minute quiz to discover what's really standing between you and a private practice that pays you well and find out exactly what to do next."
      />

      <HeroBlock />
      <QuizSection />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · Hero
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The source's "←" glyph becomes a drawn arrow, the same substitution the blog
 * and the planner make, so it can travel on hover and keyboard focus while the
 * words stay exactly as written.
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

/**
 * Centred rather than the site's usual two-column hero: the source page has no
 * artwork of its own (its one image slot is still a Kajabi theme placeholder),
 * and a left-aligned column with an empty right half reads as a missing photo
 * rather than as a deliberate composition.
 */
function HeroBlock() {
  return (
    <LuxePageHero
      eyebrow={HERO_EYEBROW}
      title={HERO_TITLE}
      titleAccent={HERO_ACCENT}
      lede={HERO_LEDE}
      tone="violet"
      align="center"
      actions={
        <LuxeButton
          variant="glass"
          size="sm"
          to="/resource-hub"
          className="min-h-[44px] tracking-[0.1em] sm:tracking-[0.16em]"
        >
          <BackArrow />
          {BACK_LABEL}
        </LuxeButton>
      }
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · What it costs you, then the one action
   ══════════════════════════════════════════════════════════════════════════ */

function QuizSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="raised"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.75}
      aria-label="Take the free quiz"
    >
      {/* No heading over the tiles: the source has none, and inventing one to
          fill the slot would put words on the page the brand never wrote. */}
      <RevealGroup
        as="ul"
        className={cn(
          "mx-auto grid max-w-xs list-none grid-cols-1 items-stretch gap-5",
          "sm:max-w-3xl sm:grid-cols-2 sm:gap-6 lg:max-w-none lg:grid-cols-4",
        )}
      >
        {STATS.map((stat, i) => {
          const { figure, caption } = splitStat(stat);

          return (
            <RevealItem key={stat} as="li" className="h-full">
              <GlassCard
                accent={STAT_ACCENTS[i % STAT_ACCENTS.length]}
                className="flex h-full flex-col items-center overflow-hidden p-6 text-center sm:p-7"
              >
                {/* Fixed-height figure slot so a numeral and the diamond that
                    stands in for the missing fourth numeral share a baseline. */}
                <span className="flex h-12 items-center justify-center">
                  {figure ? (
                    <span className="font-display text-[2.4rem] font-medium leading-none text-gold sm:text-[2.8rem]">
                      {figure}
                    </span>
                  ) : (
                    <svg aria-hidden viewBox="0 0 8 8" fill="none" className="h-3.5 w-3.5 text-gold">
                      <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
                    </svg>
                  )}
                </span>

                <GoldRule width="w-8" className="mt-4" />

                <p className="mt-4 text-pretty font-display text-[1.05rem] font-medium leading-snug text-white">
                  {caption}
                </p>
              </GlassCard>
            </RevealItem>
          );
        })}
      </RevealGroup>

      {/* Major break: the page stops describing the quiz and asks for the tap. */}
      <motion.div {...rise(reduce, 0.1)} className="relative mt-12 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[16rem] w-[min(200%,44rem)] -translate-x-1/2 -translate-y-1/2 sm:h-[20rem]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(201,164,106,0.20) 0%, rgba(201,164,106,0.07) 36%, rgba(123,94,167,0.06) 58%, transparent 76%)",
          }}
        />

        <LuxeButton
          variant="foil"
          size="lg"
          href={QUIZ_URL}
          target="_blank"
          className="max-w-full px-7 text-center leading-[1.4] tracking-[0.1em] sm:px-10 sm:tracking-[0.2em]"
        >
          {CTA_LABEL}
        </LuxeButton>

        {/* copy-luxe rather than the site's usual `orchid-faint` caption tint:
            this line is a purchase objection being answered, not chrome, and it
            has to stay readable at 14px on a near-black band. */}
        <p className="copy-luxe mt-6 text-pretty text-sm">{CTA_NOTE}</p>
      </motion.div>
    </Section>
  );
}
