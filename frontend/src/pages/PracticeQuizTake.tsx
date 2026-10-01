import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import {
  PRACTICE_QUIZ_GATE,
  PRACTICE_QUIZ_QUESTIONS,
  PRACTICE_QUIZ_RESULTS,
  PRACTICE_QUIZ_RESULT_COPY,
  scorePracticeQuiz,
  type BuilderType,
} from "@/content/practiceQuiz";

/**
 * The Practice Set Up Quiz itself — six questions, the name-and-email step,
 * and the result — at /practice-quiz/take.
 *
 * On bossclinician.com the quiz runs inline on /practice-quiz and, after the
 * sixth answer, hands the visitor to one of four Kajabi forms (one per builder
 * type) whose submission tags the contact. Here the same four forms exist as
 * builder forms (migration 091), so a quiz taker lands in Forms → replies and
 * on the contact list with the same tag Kajabi would have given them, and the
 * result is shown on the next screen instead of only by email.
 *
 * Mirrors the source's mechanics: one question on screen, an answer is a
 * selection that the Next button commits (no auto-advance), Back keeps earlier
 * choices, the progress bar reads the share of questions already behind you,
 * and ties between types go to the earlier type.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Stage = "questions" | "email" | "result";

const TOTAL = PRACTICE_QUIZ_QUESTIONS.length;

/** The source tints each result in its own colour; these are the site's nearest accents. */
const RESULT_ACCENT: Record<BuilderType, Accent> = { V: "green", C: "plum", S: "gold", R: "neutral" };

const RESULT_GLOW: Record<BuilderType, string> = {
  V: "rgba(74,124,107,0.35)",
  C: "rgba(123,94,167,0.35)",
  S: "rgba(201,164,106,0.30)",
  R: "rgba(40,60,110,0.40)",
};

function emptyPicks(): (number | null)[] {
  return new Array<number | null>(TOTAL).fill(null);
}

/** "The Visionary Builder" → ["The", "Visionary Builder"], as the source sets it. */
function splitArchetype(archetype: string): [string, string] {
  const match = /^(The )(.+)$/.exec(archetype);
  return match ? [match[1].trim(), match[2]] : ["", archetype];
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5 shrink-0", back && "-scale-x-100")}
    >
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  );
}

export default function PracticeQuizTake() {
  const reduce = useReducedMotion();
  const promptId = useId();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();

  const [stage, setStage] = useState<Stage>("questions");
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [picks, setPicks] = useState<(number | null)[]>(emptyPicks);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [winner, setWinner] = useState<BuilderType | null>(null);
  const [copied, setCopied] = useState(false);

  // Each move swaps the card out from under the button that was pressed; the
  // new heading takes focus so keyboard and screen-reader users arrive on it.
  const focusNext = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function focusOnMount(el: HTMLElement | null) {
    if (!el || !focusNext.current) return;
    focusNext.current = false;
    el.focus({ preventScroll: true });
  }

  /** The source scrolls to the top on every screen change; a long answer list on a phone needs it. */
  function moveTo(next: Stage, nextIndex: number, dir: 1 | -1) {
    focusNext.current = true;
    setDirection(dir);
    setError(null);
    setStage(next);
    setIndex(nextIndex);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    }
  }

  const question = PRACTICE_QUIZ_QUESTIONS[index];
  const picked = picks[index];
  const isLast = index === TOTAL - 1;

  function choose(answerIndex: number) {
    setPicks((prev) => {
      const next = [...prev];
      next[index] = answerIndex;
      return next;
    });
    setError(null);
  }

  function handleNext() {
    if (picked === null) return;
    if (!isLast) {
      moveTo("questions", index + 1, 1);
      return;
    }
    setWinner(scorePracticeQuiz(picks).winner);
    moveTo("email", index, 1);
  }

  function handleBack() {
    if (stage === "email") {
      moveTo("questions", TOTAL - 1, -1);
      return;
    }
    if (index > 0) moveTo("questions", index - 1, -1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !winner) return;

    const first = firstName.trim();
    const last = lastName.trim();
    const address = email.trim().toLowerCase();
    if (!first || !last) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!EMAIL_PATTERN.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }

    const result = PRACTICE_QUIZ_RESULTS[winner];
    const { totals } = scorePracticeQuiz(picks);
    // The answers ride along as the form's hidden questions (migration 091), so
    // the reply in Forms reads as the quiz the person actually took.
    const data: Record<string, unknown> = {
      first_name: first,
      last_name: last,
      email: address,
      result: result.archetype,
      scores: `Visionary ${totals.V} · Careful ${totals.C} · Steady ${totals.S} · Reluctant ${totals.R}`,
    };
    PRACTICE_QUIZ_QUESTIONS.forEach((q, qi) => {
      const pick = picks[qi];
      if (pick !== null && q.answers[pick]) data[`q${qi + 1}`] = q.answers[pick].text;
    });

    setSending(true);
    setError(null);
    try {
      await api.submitForm(result.formSlug, data, address, honeypot());
      if (!alive.current) return;
      moveTo("result", index, 1);
    } catch (err) {
      if (!alive.current) return;
      setError(
        err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 404
          ? err.message
          : `Something went wrong sending your result. Please try again, or email ${contactPage.email}.`,
      );
    } finally {
      if (alive.current) setSending(false);
    }
  }

  function retake() {
    setPicks(emptyPicks());
    setFirstName("");
    setLastName("");
    setEmail("");
    setWinner(null);
    setCopied(false);
    moveTo("questions", 0, -1);
  }

  function copyLink() {
    const url = `${window.location.origin}/practice-quiz`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        if (!alive.current) return;
        setCopied(true);
        window.setTimeout(() => alive.current && setCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  // The share of questions already behind you, as the source computes it; the
  // name-and-email step comes after the last one, so it reads full.
  const pct = stage === "questions" ? Math.round((index / TOTAL) * 100) : 100;
  const progressLabel = stage === "questions" ? `Question ${index + 1} of ${TOTAL}` : PRACTICE_QUIZ_GATE.eyebrow;

  const swap = {
    initial: reduce ? false : { opacity: 0, x: direction * 28 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: reduce ? 0 : 0.34, ease: EASE },
  };

  return (
    <>
      <Seo
        title="Practice Set Up Quiz"
        description="Take this free 2-minute quiz to discover what's really standing between you and a private practice that pays you well and find out exactly what to do next."
        canonicalPath="/practice-quiz"
        noindex
      />

      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Practice Set Up Quiz"
        containerClassName="max-w-2xl"
      >
        <Link
          to="/practice-quiz"
          className="inline-flex min-h-[44px] items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid transition-colors duration-300 hover:text-gold"
        >
          <Arrow back />
          Practice Set Up Quiz
        </Link>

        {stage !== "result" && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/85">
                {progressLabel}
              </p>
              <span className="text-xs font-semibold tabular-nums text-orchid-faint">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Quiz progress"
              className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10"
            >
              <motion.div
                className="h-full w-full rounded-full bg-gold-foil"
                style={{ transformOrigin: "left" }}
                initial={false}
                animate={{ scaleX: pct / 100 }}
                transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
              />
            </div>
          </div>
        )}

        <div className="mt-7">
          <motion.div key={stage === "questions" ? `q${index}` : stage} {...swap}>
            {stage === "questions" && question && (
              <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                  Question {index + 1} of {TOTAL} · {question.topic}
                </p>
                <h1
                  id={promptId}
                  ref={focusOnMount}
                  tabIndex={-1}
                  className="mt-3 text-balance font-display text-[1.5rem] font-medium leading-[1.2] text-white outline-none sm:text-[1.9rem]"
                >
                  {question.text}
                </h1>

                {/* Buttons rather than radios, as in the source: a selection
                    is only committed by Next, and arrow keys never turn pages. */}
                <div role="group" aria-labelledby={promptId} className="mt-7 flex flex-col gap-2.5">
                  {question.answers.map((answer, ai) => {
                    const on = picked === ai;
                    return (
                      <button
                        key={answer.text}
                        type="button"
                        aria-pressed={on}
                        onClick={() => choose(ai)}
                        className={cn(
                          "flex min-h-[44px] w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left",
                          "text-[0.95rem] leading-relaxed transition-colors duration-300",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
                          on
                            ? "border-gold/60 bg-gold/[0.10] text-white"
                            : "border-white/12 bg-white/[0.04] text-white/85 hover:border-white/25 hover:bg-white/[0.06]",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
                            on ? "border-gold bg-gold/25 text-gold" : "border-white/25",
                          )}
                        >
                          {on && (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-3 w-3"
                            >
                              <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
                            </svg>
                          )}
                        </span>
                        <span className="min-w-0">{answer.text}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  {index > 0 ? (
                    <LuxeButton variant="outline" size="sm" onClick={handleBack} className="min-h-[44px]">
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

            {stage === "email" && (
              <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                  {PRACTICE_QUIZ_GATE.eyebrow}
                </p>
                <h1
                  ref={focusOnMount}
                  tabIndex={-1}
                  className="mt-3 text-balance font-display text-[1.6rem] font-medium leading-[1.2] text-white outline-none sm:text-[2.1rem]"
                >
                  {PRACTICE_QUIZ_GATE.heading}
                </h1>
                <GoldRule className="mt-5" />
                <p className="copy-luxe mt-5 text-pretty">{PRACTICE_QUIZ_GATE.sub}</p>

                <form onSubmit={handleSubmit} noValidate className="relative mt-7 space-y-5">
                  {honeypotField}

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <LuxeInput
                      label={PRACTICE_QUIZ_GATE.firstName}
                      name="first_name"
                      type="text"
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        setError(null);
                      }}
                      className="min-h-[44px]"
                    />
                    <LuxeInput
                      label={PRACTICE_QUIZ_GATE.lastName}
                      name="last_name"
                      type="text"
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        setError(null);
                      }}
                      className="min-h-[44px]"
                    />
                  </div>

                  <LuxeInput
                    label={PRACTICE_QUIZ_GATE.email}
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    aria-describedby={error ? errorId : undefined}
                    className="min-h-[44px]"
                  />

                  {error && (
                    <p
                      id={errorId}
                      role="alert"
                      className="rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
                    >
                      {error}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <LuxeButton
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={handleBack}
                      className="min-h-[44px]"
                    >
                      <Arrow back />
                      Back
                    </LuxeButton>
                    <LuxeButton
                      variant="foil"
                      size="md"
                      type="submit"
                      disabled={sending}
                      className="min-h-[44px]"
                    >
                      {sending ? "Sending…" : PRACTICE_QUIZ_GATE.submit}
                    </LuxeButton>
                  </div>

                  <p className="text-xs leading-relaxed text-orchid-faint">{PRACTICE_QUIZ_GATE.disclaimer}</p>
                </form>
              </GlassCard>
            )}

            {stage === "result" && winner && (
              <ResultCard
                type={winner}
                focusRef={focusOnMount}
                onRetake={retake}
                onCopy={copyLink}
                copied={copied}
              />
            )}
          </motion.div>
        </div>
      </Section>
    </>
  );
}

function ResultCard({
  type,
  focusRef,
  onRetake,
  onCopy,
  copied,
}: {
  type: BuilderType;
  focusRef: (el: HTMLElement | null) => void;
  onRetake: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const result = PRACTICE_QUIZ_RESULTS[type];
  const copy = PRACTICE_QUIZ_RESULT_COPY;
  const [lead, name] = splitArchetype(result.archetype);

  return (
    <GlassCard accent={RESULT_ACCENT[type]} interactive={false} spotlight={false} className="overflow-hidden">
      {/* Header band: the source gives each type its own colour here. */}
      <div
        className="relative border-b border-white/10 px-6 py-9 text-center sm:px-10 sm:py-11"
        style={{
          background: `radial-gradient(ellipse at top, ${RESULT_GLOW[type]} 0%, transparent 72%)`,
        }}
      >
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{result.tag}</p>
        <h1
          ref={focusRef}
          tabIndex={-1}
          className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.1] text-white outline-none sm:text-[2.6rem]"
        >
          {lead && <span className="block">{lead}</span>}
          <em className="block italic text-gold">{name}</em>
        </h1>
        <p className="copy-luxe mx-auto mt-4 max-w-[44ch] text-pretty">{result.tagline}</p>
      </div>

      <div className="px-6 py-8 sm:px-10 sm:py-10">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">{copy.whatLabel}</p>
        <p className="mt-3 text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.3rem]">
          {result.what}
        </p>
        <GoldRule width="w-11" className="mt-6" />
        <p className="copy-luxe mt-6 text-pretty">{result.desc}</p>

        <ol className="mt-7 flex list-none flex-col gap-2.5">
          {result.steps.map((step, i) => (
            <li
              key={step.bold}
              className="flex items-start gap-3.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-foil text-[0.8rem] font-bold tabular-nums text-night-deep"
              >
                {i + 1}
              </span>
              <p className="min-w-0 text-[0.95rem] leading-relaxed text-white/85">
                <strong className="font-semibold text-white">{step.bold}</strong> {step.text}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-2xl border border-gold/30 bg-gold/[0.07] p-6 text-center sm:p-8">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{copy.offerEyebrow}</p>
          <h2 className="mt-3 font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">
            {result.offerName}
          </h2>
          <p className="copy-luxe mx-auto mt-3 max-w-[52ch] text-pretty text-[0.95rem]">{result.offerDesc}</p>
          <LuxeButton
            variant="foil"
            size="md"
            to={result.offerLink}
            className="mt-6 min-h-[44px] max-w-full text-center leading-[1.4]"
          >
            {result.offerBtn}
          </LuxeButton>
        </div>

        <p className="mt-6 text-center text-sm leading-relaxed text-white/75">
          {copy.secondaryLead}{" "}
          <Link to={copy.offerQuizHref} className="font-semibold text-orchid underline underline-offset-4 hover:text-gold">
            {copy.offerQuizLabel}
          </Link>{" "}
          {copy.secondaryJoin}{" "}
          <Link
            to={copy.callHref}
            className="font-semibold text-orchid underline underline-offset-4 hover:text-gold"
          >
            {copy.callLabel}
          </Link>
          .
        </p>

        <div className="mt-6 text-center">
          <LuxeButton variant="quiet" size="sm" onClick={onRetake} className="min-h-[44px]">
            {copy.retake}
          </LuxeButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-4 sm:px-10">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-orchid-faint">{copy.shareLabel}</span>
        <div className="flex items-center gap-4 text-sm">
          <a
            href={copy.instagramHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center font-semibold text-orchid hover:text-gold"
          >
            Instagram
          </a>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-[44px] items-center font-semibold text-orchid hover:text-gold"
          >
            <span aria-live="polite">{copied ? "Copied!" : "Copy Link"}</span>
          </button>
        </div>
      </div>
    </GlassCard>
  );
}
