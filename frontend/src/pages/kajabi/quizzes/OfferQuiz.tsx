import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { cn } from "@/lib/cn";
import {
  OFFER_QUIZ_EMAIL,
  OFFER_QUIZ_PAGE,
  OFFER_QUIZ_QUESTIONS,
  OFFER_QUIZ_RESULTS,
  scoreOfferQuiz,
  type OfferKey,
} from "@/content/offerQuiz";
import {
  AnswerButton,
  Arrow,
  BackLink,
  QuizProgress,
  ResultEmailForm,
  answersAsData,
  scrollToEl,
  useFocusOnChange,
  useSwap,
} from "./shared";

/**
 * /offer-quiz — "Which Boss Clinician Offer Is Right for You?"
 *
 * Rebuilt from the Kajabi page of the same path (content/offerQuiz.ts). As on
 * the source: one question at a time, a choice is committed by Next (no
 * auto-advance), Back keeps earlier choices, the bar shows the share of
 * questions already behind you and reads "Complete!" at the result, and the
 * result appears straight away with no email asked for. The optional form
 * under the result is this site's addition (see content/offerQuiz.ts).
 */

const TOTAL = OFFER_QUIZ_QUESTIONS.length;

const ACCENT: Record<OfferKey, Accent> = { club: "green", lounge: "plum", boardroom: "gold" };
const GLOW: Record<OfferKey, string> = {
  club: "rgba(74,124,107,0.38)",
  lounge: "rgba(123,94,167,0.38)",
  boardroom: "rgba(40,60,110,0.45)",
};
const DOT: Record<string, string> = { green: "bg-[#4a7c6b]", purple: "bg-[#7b5ea7]", navy: "bg-[#283c6e]" };

function emptyPicks(): (number | null)[] {
  return new Array<number | null>(TOTAL).fill(null);
}

export default function OfferQuiz() {
  const reduce = useReducedMotion();
  const { arm, focusOnMount } = useFocusOnChange();
  const progressRef = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [picks, setPicks] = useState<(number | null)[]>(emptyPicks);
  const [winner, setWinner] = useState<OfferKey | null>(null);
  const [round, setRound] = useState(0);
  const swap = useSwap(direction);

  const question = OFFER_QUIZ_QUESTIONS[index];
  const picked = picks[index];
  const isLast = index === TOTAL - 1;

  function go(nextIndex: number, dir: 1 | -1) {
    arm();
    setDirection(dir);
    setIndex(nextIndex);
    scrollToEl(progressRef.current, reduce);
  }

  function choose(answerIndex: number) {
    setPicks((prev) => {
      const next = [...prev];
      next[index] = answerIndex;
      return next;
    });
  }

  function handleNext() {
    if (picked === null) return;
    if (!isLast) {
      go(index + 1, 1);
      return;
    }
    arm();
    setDirection(1);
    setWinner(scoreOfferQuiz(picks).winner);
    scrollToEl(progressRef.current, reduce);
  }

  function retake() {
    setPicks(emptyPicks());
    setWinner(null);
    setRound((r) => r + 1);
    go(0, -1);
  }

  const pct = winner ? 100 : Math.round((index / TOTAL) * 100);
  const label = winner ? OFFER_QUIZ_PAGE.complete : `Question ${index + 1} of ${TOTAL}`;

  return (
    <>
      <Seo
        title="Which Boss Clinician Offer Is Right for You? | Free Quiz"
        description="Answer 6 quick questions about where you are in your practice and we'll match you to the right offer — no pressure, no pitch, just clarity."
        canonicalPath="/offer-quiz"
      />

      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Which Boss Clinician Offer Is Right for You?"
        containerClassName="max-w-2xl"
      >
        <BackLink to={OFFER_QUIZ_PAGE.backHref}>{OFFER_QUIZ_PAGE.backLabel}</BackLink>

        <header className="mt-6 text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{OFFER_QUIZ_PAGE.eyebrow}</p>
          <h1 className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.6rem]">
            {OFFER_QUIZ_PAGE.titleLead} <em className="italic text-gold">{OFFER_QUIZ_PAGE.titleAccent}</em>
          </h1>
          <p className="copy-luxe mx-auto mt-4 max-w-[52ch] text-pretty">{OFFER_QUIZ_PAGE.sub}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-orchid-faint">{OFFER_QUIZ_PAGE.meta}</p>
        </header>

        <ul className="mt-7 flex flex-wrap justify-center gap-2.5">
          {OFFER_QUIZ_PAGE.chips.map((chip) => (
            <li
              key={chip.label}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-white/85"
            >
              <span aria-hidden className={cn("h-2 w-2 rounded-full", DOT[chip.dot])} />
              {chip.label}
            </li>
          ))}
        </ul>

        <div ref={progressRef} className="mt-9">
          <QuizProgress label={label} right={`${pct}%`} pct={pct} />
        </div>

        <div className="mt-7">
          <motion.div key={winner ? `result-${round}` : `q${index}-${round}`} {...swap}>
            {!winner && question && (
              <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                  Question {index + 1} of {TOTAL}
                </p>
                <h2
                  id="offer-quiz-question"
                  ref={focusOnMount}
                  tabIndex={-1}
                  className="mt-3 text-balance font-display text-[1.5rem] font-medium leading-[1.2] text-white outline-none sm:text-[1.9rem]"
                >
                  {question.text}
                </h2>
                <div role="group" aria-labelledby="offer-quiz-question" className="mt-7 flex flex-col gap-2.5">
                  {question.answers.map((answer, ai) => (
                    <AnswerButton key={answer.text} on={picked === ai} onClick={() => choose(ai)}>
                      {answer.text}
                    </AnswerButton>
                  ))}
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  {index > 0 ? (
                    <LuxeButton variant="outline" size="sm" onClick={() => go(index - 1, -1)} className="min-h-[44px]">
                      <Arrow back />
                      Back
                    </LuxeButton>
                  ) : (
                    <span />
                  )}
                  <LuxeButton
                    variant="foil"
                    size="sm"
                    onClick={handleNext}
                    disabled={picked === null}
                    aria-disabled={picked === null}
                    className={cn("min-h-[44px]", picked === null && "pointer-events-none opacity-40")}
                  >
                    {isLast ? "See My Result" : "Next"}
                    <Arrow />
                  </LuxeButton>
                </div>
              </GlassCard>
            )}

            {winner && (
              <>
                <OfferResultCard type={winner} focusRef={focusOnMount} onRetake={retake} />
                <ResultEmailForm
                  formSlug={OFFER_QUIZ_RESULTS[winner].formSlug}
                  copy={OFFER_QUIZ_EMAIL}
                  data={() => {
                    const { totals } = scoreOfferQuiz(picks);
                    return {
                      result: OFFER_QUIZ_RESULTS[winner].headline,
                      scores: `Club ${totals.club} · Lounge ${totals.lounge} · Boardroom ${totals.boardroom}`,
                      ...answersAsData(OFFER_QUIZ_QUESTIONS, picks),
                    };
                  }}
                />
              </>
            )}
          </motion.div>
        </div>
      </Section>
    </>
  );
}

function OfferResultCard({
  type,
  focusRef,
  onRetake,
}: {
  type: OfferKey;
  focusRef: (el: HTMLElement | null) => void;
  onRetake: () => void;
}) {
  const r = OFFER_QUIZ_RESULTS[type];
  const page = OFFER_QUIZ_PAGE;
  return (
    <GlassCard accent={ACCENT[type]} interactive={false} spotlight={false} className="overflow-hidden">
      <div
        className="border-b border-white/10 px-6 py-9 text-center sm:px-10 sm:py-11"
        style={{ background: `radial-gradient(ellipse at top, ${GLOW[type]} 0%, transparent 72%)` }}
      >
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{page.resultEyebrow}</p>
        <p className="mt-4 inline-flex rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/85">
          {r.tag}
        </p>
        <h2
          ref={focusRef}
          tabIndex={-1}
          className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.1] text-white outline-none sm:text-[2.5rem]"
        >
          {r.headline}
        </h2>
        <p className="copy-luxe mx-auto mt-3 max-w-[44ch] text-pretty italic">{r.sub}</p>
      </div>

      <div className="px-6 py-8 sm:px-10 sm:py-10">
        <p className="copy-luxe text-pretty">{r.p1}</p>
        <p className="copy-luxe mt-4 text-pretty">{r.p2}</p>
        <GoldRule width="w-11" className="mt-7" />
        <h3 className="mt-6 text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-orchid">{r.getLabel}</h3>
        <ul className="mt-4 flex list-none flex-col gap-2.5">
          {r.getItems.map((item) => (
            <li key={item} className="flex items-start gap-3 text-[0.95rem] leading-relaxed text-white/85">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-1 h-4 w-4 shrink-0 text-gold"
              >
                <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
              </svg>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-9 text-center">
          <LuxeButton variant="foil" size="md" to={r.ctaLink} className="min-h-[44px] max-w-full text-center leading-[1.4]">
            {r.ctaText}
          </LuxeButton>
          <p className="mt-2.5 text-xs tracking-[0.06em] text-orchid-faint">{r.ctaUrl}</p>
          <p className="mt-6 text-sm leading-relaxed text-white/75">
            {page.bookLead}{" "}
            <a
              href={page.bookHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-orchid underline underline-offset-4 hover:text-gold"
            >
              {page.bookLabel}
            </a>{" "}
            {page.bookTail}
          </p>
          <div className="mt-5">
            <LuxeButton variant="quiet" size="sm" onClick={onRetake} className="min-h-[44px]">
              {page.retake}
            </LuxeButton>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
