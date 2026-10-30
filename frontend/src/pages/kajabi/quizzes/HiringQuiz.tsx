import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { Section } from "@/components/luxe/Section";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  HIRE_FORM,
  HIRING_CONTACT_STORAGE_KEY,
  HIRING_QUIZ_EMAIL,
  HIRING_QUIZ_MAX_SCORE,
  HIRING_QUIZ_PAGE,
  HIRING_QUIZ_QUESTIONS,
  HIRING_QUIZ_RESULTS,
  scoreHiringQuiz,
  type HiringContact,
  type HiringResultKey,
} from "@/content/hiringQuiz";
import {
  AnswerButton,
  Arrow,
  QuizProgress,
  ResultEmailForm,
  answersAsData,
  scrollToEl,
  useAlive,
  useFocusOnChange,
  useSwap,
} from "./shared";
import { LeadFormCard, type LeadContact } from "./LeadFormCard";

/**
 * /hiring-quiz — "Are You Ready to Hire Your First Clinician?"
 *
 * Rebuilt from the Kajabi page of the same path (content/hiringQuiz.ts). As on
 * the source: seven statements, one at a time; a choice is committed by "Next
 * Question" (no auto-advance), Back keeps earlier choices, the bar fills with
 * the share of questions behind you and the counter reads "Complete!" at the
 * result. The result is the total against the 70% / 40% thresholds.
 *
 * The page opens on the opt-in: the same `hire-form` builder form /hire-form
 * has always filed (tag "Hiring Quiz", the two practice questions on the
 * contact). Submitting it swaps the quiz in, on this same address. Someone who
 * opted in earlier in this browser tab goes straight to the quiz. /hire-form is
 * this page too, so old links still work.
 *
 * Their result is filed under the matching result form as soon as it is shown,
 * which tags them and emails them the result — what "Enter your name and email
 * to get your results!" promises. If that filing fails, an optional form under
 * the result offers it again.
 */

const TOTAL = HIRING_QUIZ_QUESTIONS.length;

const ACCENT: Record<HiringResultKey, Accent> = { ready: "green", almost: "plum", notYet: "neutral" };

/**
 * The doc's navy into purple, for its hero and "Not Yet" result. Fixed colours,
 * not tokens: `plum` and `plum-deep` turn pale lilac on the dark theme, and this
 * band stays dark in both. Needs `data-media-surface`.
 */
const NIGHT_BAND = "bg-gradient-to-br from-[#0F1E3A] to-[#2a1060]";

/** The result header's band: green, purple or navy, as in the doc, in both themes. */
const RESULT_BAND: Record<HiringResultKey, string> = { ready: "bg-green", almost: "bg-plum-bright", notYet: NIGHT_BAND };

/** Figures inside a serif question ("60–90", "W2", "1099") in the body font. */
function plainNumbers(text: string) {
  return text.split(/(W?\d+(?:–\d+)?)/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-body font-bold tabular-nums">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function emptyPicks(): (number | null)[] {
  return new Array<number | null>(TOTAL).fill(null);
}

function readContact(): HiringContact | null {
  try {
    const raw = window.sessionStorage.getItem(HIRING_CONTACT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HiringContact>;
    if (!parsed.email || !parsed.firstName) return null;
    return { firstName: parsed.firstName, lastName: parsed.lastName ?? "", email: parsed.email };
  } catch {
    return null;
  }
}

type FilingState = "idle" | "sending" | "sent" | "failed";

export default function HiringQuiz() {
  const reduce = useReducedMotion();
  const alive = useAlive();
  const { arm, focusOnMount } = useFocusOnChange();
  const progressRef = useRef<HTMLDivElement>(null);
  // Only the fill-time half: the automatic filing below has no visible form to trap.
  const [honeypot] = useHoneypot();

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [picks, setPicks] = useState<(number | null)[]>(emptyPicks);
  const [result, setResult] = useState<HiringResultKey | null>(null);
  const [round, setRound] = useState(0);
  // Read after mount: the server has no sessionStorage, and the first client
  // render has to match the server's markup.
  const [contact, setContact] = useState<HiringContact | null>(null);
  const [filing, setFiling] = useState<FilingState>("idle");
  const swap = useSwap(direction);

  useLayoutEffect(() => {
    setContact(readContact());
  }, []);

  function handleOptIn(person: LeadContact) {
    try {
      window.sessionStorage.setItem(HIRING_CONTACT_STORAGE_KEY, JSON.stringify(person));
    } catch {
      // Private browsing: the quiz still runs for this visit, from state.
    }
    arm();
    setContact(person);
    scrollToEl(progressRef.current, reduce);
  }

  const question = HIRING_QUIZ_QUESTIONS[index];
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

  function resultData(key: HiringResultKey, total: number): Record<string, unknown> {
    return {
      result: HIRING_QUIZ_RESULTS[key].label,
      score: `${total} of ${HIRING_QUIZ_MAX_SCORE}`,
      ...answersAsData(HIRING_QUIZ_QUESTIONS, picks),
    };
  }

  async function fileFor(person: HiringContact, key: HiringResultKey, total: number) {
    setFiling("sending");
    try {
      await api.submitForm(
        HIRING_QUIZ_RESULTS[key].formSlug,
        {
          first_name: person.firstName,
          last_name: person.lastName,
          email: person.email,
          ...resultData(key, total),
        },
        person.email,
        honeypot(),
      );
      if (alive.current) setFiling("sent");
    } catch {
      // The result is on screen either way; offer the form instead.
      if (alive.current) setFiling("failed");
    }
  }

  function handleNext() {
    if (picked === null) return;
    if (!isLast) {
      go(index + 1, 1);
      return;
    }
    const scored = scoreHiringQuiz(picks);
    arm();
    setDirection(1);
    setResult(scored.result);
    scrollToEl(progressRef.current, reduce);
    if (contact) void fileFor(contact, scored.result, scored.total);
  }

  function retake() {
    setPicks(emptyPicks());
    setResult(null);
    setFiling("idle");
    setRound((r) => r + 1);
    go(0, -1);
  }

  const pct = result ? 100 : Math.round((index / TOTAL) * 100);
  const counter = result ? HIRING_QUIZ_PAGE.complete : `Question ${index + 1} of ${TOTAL}`;
  const total = result ? scoreHiringQuiz(picks).total : 0;
  const showOptionalForm = result && filing === "failed";

  return (
    <>
      <Seo
        title="Are You Ready to Hire Your First Clinician? | Free Quiz"
        description="Take this free 5-minute quiz to find out if your group practice is ready to hire — and exactly what to do next based on where you are."
        canonicalPath="/hiring-quiz"
      />

      <Section
        surface="deep"
        space="lg"
        seam={false}
        data-media-surface
        backdrop={<div aria-hidden className={cn("absolute inset-0", NIGHT_BAND)} />}
        aria-label="Are You Ready to Hire Your First Clinician?"
        containerClassName="max-w-2xl"
      >
        <Link
          to={HIRING_QUIZ_PAGE.backHref}
          className="inline-flex min-h-[44px] items-center text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/70 transition-colors duration-300 hover:text-white"
        >
          {HIRING_QUIZ_PAGE.backLabel}
        </Link>

        {/* A div, not a <header>: the light theme paints every header white. */}
        <div className="mt-4 text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-orchid">{HIRING_QUIZ_PAGE.eyebrow}</p>
          <h1 className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.6rem]">
            {HIRING_QUIZ_PAGE.title} <em className="block italic text-gold">{HIRING_QUIZ_PAGE.titleAccent}</em>
          </h1>
          <p className="mx-auto mt-4 max-w-[52ch] text-pretty text-[1.03rem] leading-[1.75] text-white/80">{HIRING_QUIZ_PAGE.sub}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/60">{HIRING_QUIZ_PAGE.meta}</p>
        </div>
      </Section>

      <Section surface="deep" space="md" seam={false} containerClassName="max-w-2xl">
        <div ref={progressRef}>
          {!contact ? (
            <LeadFormCard
              formSlug={HIRE_FORM.formSlug}
              selects={[
                { key: "years_in_practice", ...HIRE_FORM.practiceYears },
                { key: "years_group_owner", ...HIRE_FORM.groupOwnerYears },
              ]}
              submitLabel={HIRE_FORM.submit}
              disclaimer={HIRE_FORM.disclaimer}
              intro={<p className="mb-6 text-center font-semibold text-white">{HIRE_FORM.lead}</p>}
              onSuccess={handleOptIn}
            />
          ) : (
            <QuizProgress label={HIRING_QUIZ_PAGE.progressLabel} right={counter} pct={pct} />
          )}
        </div>

        {contact && <div className="mt-7">
          <motion.div key={result ? `result-${round}` : `q${index}-${round}`} {...swap}>
            {!result && question && (
              <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                <p className="text-[0.7rem] font-bold uppercase tabular-nums tracking-[0.18em] text-orchid">
                  Question {index + 1} of {TOTAL}
                </p>
                <h2
                  id="hiring-quiz-question"
                  ref={focusOnMount}
                  tabIndex={-1}
                  className="mt-3 text-balance font-display text-[1.35rem] font-medium leading-[1.25] text-white outline-none sm:text-[1.7rem]"
                >
                  {plainNumbers(question.text)}
                </h2>
                <div role="group" aria-labelledby="hiring-quiz-question" className="mt-7 flex flex-col gap-2.5">
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
                    {isLast ? "See My Results" : "Next Question"}
                    <Arrow />
                  </LuxeButton>
                </div>
              </GlassCard>
            )}

            {result && (
              <>
                <HiringResultCard type={result} focusRef={focusOnMount} onRetake={retake} />

                {contact && (filing === "sending" || filing === "sent") && (
                  <p role="status" className="mt-6 text-center text-sm leading-relaxed text-white/75">
                    {HIRING_QUIZ_EMAIL.onItsWay} <strong className="font-semibold text-white">{contact.email}</strong>.
                  </p>
                )}

                {showOptionalForm && (
                  <ResultEmailForm
                    formSlug={HIRING_QUIZ_RESULTS[result].formSlug}
                    copy={HIRING_QUIZ_EMAIL}
                    data={() => resultData(result, total)}
                  />
                )}
              </>
            )}
          </motion.div>
        </div>}
      </Section>
    </>
  );
}

function HiringResultCard({
  type,
  focusRef,
  onRetake,
}: {
  type: HiringResultKey;
  focusRef: (el: HTMLElement | null) => void;
  onRetake: () => void;
}) {
  const r = HIRING_QUIZ_RESULTS[type];
  return (
    <GlassCard accent={ACCENT[type]} interactive={false} spotlight={false} className="overflow-hidden">
      <div data-media-surface className={cn("px-6 py-9 text-center sm:px-10 sm:py-11", RESULT_BAND[type])}>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/95">{r.eyebrow}</p>
        <h2
          ref={focusRef}
          tabIndex={-1}
          className="mt-4 text-balance font-display text-[1.8rem] font-medium leading-[1.15] text-white outline-none sm:text-[2.3rem]"
        >
          {r.headline}
        </h2>
        <p className="mx-auto mt-3 max-w-[46ch] text-pretty text-[0.95rem] italic leading-relaxed text-white/95">{r.sub}</p>
      </div>

      <div className="px-6 py-8 sm:px-10 sm:py-10">
        <p className="copy-luxe text-pretty">{r.p1}</p>
        <p className="copy-luxe mt-4 text-pretty">{r.p2}</p>

        <div className="mt-7 rounded-xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
          <h3 className="text-[0.75rem] font-bold uppercase tracking-[0.12em] text-white">{HIRING_QUIZ_PAGE.stepsLabel}</h3>
          <ul className="mt-3.5 flex list-none flex-col gap-2.5">
            {r.steps.map((step) => (
              <li key={step} className="flex items-start gap-2.5">
                <span aria-hidden className="shrink-0 font-bold leading-relaxed text-lilac">
                  →
                </span>
                <p className="min-w-0 text-[0.95rem] leading-relaxed text-white/85">{step}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 text-center">
          <p className="copy-luxe mx-auto max-w-[52ch] text-pretty text-[0.95rem]">{r.ctaCopy}</p>
          <LuxeButton variant="foil" size="md" to={r.ctaLink} className="mt-6 min-h-[44px] w-full text-center leading-[1.4]">
            {r.ctaBtn}
          </LuxeButton>
          <p className="mt-2.5 text-xs tracking-[0.06em] text-orchid-faint">{r.ctaUrl}</p>
        </div>

        <div className="mt-6 text-center">
          <LuxeButton variant="quiet" size="sm" onClick={onRetake} className="min-h-[44px]">
            {HIRING_QUIZ_PAGE.retake}
          </LuxeButton>
        </div>
      </div>
    </GlassCard>
  );
}
