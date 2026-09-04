import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeTextarea } from "@/components/luxe/LuxeField";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import {
  quizApi,
  type Quiz as QuizDefinition,
  type QuizOutcome,
  type QuizQuestion,
} from "@/lib/quizApi";
import NotFound from "@/pages/NotFound";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Long enough for a tapped answer to read as chosen, short enough to feel instant. */
const ADVANCE_MS = 260;

/**
 * "intro" holds the invitation, "working" the wait while the result is scored.
 * Keeping them in the same union as the questions is what makes the card below
 * the progress bar a single swap rather than four nested conditions.
 */
type Stage = "intro" | "questions" | "email" | "working" | "result";

type Choices = Record<number, number[]>;
type Texts = Record<number, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Only http(s) and root-relative addresses are ever put in an href.
 *
 * The call-to-action URL is a free-text field an admin types into, and
 * `javascript:` in it would otherwise become a working script on a page the
 * whole internet can reach.
 */
function safeHref(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** The intro, flattened enough to sit in a meta description. */
function summarise(markdown: string): string | undefined {
  const flat = markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return undefined;
  return flat.length > 155 ? `${flat.slice(0, 152)}…` : flat;
}

function hasAnswer(question: QuizQuestion, choices: Choices, texts: Texts): boolean {
  if (question.kind === "text") return (texts[question.id] ?? "").trim().length > 0;
  return (choices[question.id] ?? []).length > 0;
}

/**
 * Untouched questions are left out of the payload entirely rather than sent as
 * empty selections: the scorer counts a question as answered by the presence of
 * a response, and an empty one would read as a deliberate zero.
 */
function buildResponses(questions: QuizQuestion[], choices: Choices, texts: Texts) {
  const responses: { questionId: number; answerIds?: number[]; text?: string }[] = [];
  for (const question of questions) {
    if (question.kind === "text") {
      const text = (texts[question.id] ?? "").trim();
      if (text) responses.push({ questionId: question.id, text });
      continue;
    }
    const answerIds = choices[question.id] ?? [];
    if (answerIds.length > 0) responses.push({ questionId: question.id, answerIds });
  }
  return responses;
}

/**
 * The quiz, one question at a time.
 *
 * A quiz is not a form: a long scroll of every question at once is a wall
 * somebody closes, so exactly one question is on screen and the progress bar
 * carries the promise that it ends. Answers live in state keyed by question, so
 * stepping back and forward again shows what was already chosen rather than a
 * blank card — the fastest way to lose somebody two thirds of the way through.
 */
export default function Quiz() {
  const { slug = "" } = useParams();
  const reduce = useReducedMotion();
  const promptId = useId();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();

  // `undefined` while the fetch is in flight, `null` once it has 404ed.
  const [quiz, setQuiz] = useState<QuizDefinition | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [stage, setStage] = useState<Stage>("intro");
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [choices, setChoices] = useState<Choices>({});
  const [texts, setTexts] = useState<Texts>({});
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null);

  const advanceTimer = useRef<number | null>(null);
  const alive = useRef(true);
  // Turning the page swaps the whole card out from under the control that was
  // clicked, which drops focus to the body. Set on every deliberate move, read
  // by the new heading as it mounts, so a keyboard or screen reader arrives at
  // the new question rather than at the top of the document.
  const focusNext = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQuiz(undefined);
    setLoadError(null);
    setStage("intro");
    setIndex(0);
    setChoices({});
    setTexts({});
    setOutcome(null);
    setError(null);
    quizApi
      .get(slug)
      .then((result) => {
        if (!cancelled) setQuiz(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An unpublished quiz 404s exactly like one that never existed, and a
        // visitor is owed neither distinction — both are simply a dead URL.
        if (err instanceof ApiError && err.status === 404) {
          setQuiz(null);
          return;
        }
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : "This quiz couldn't be loaded just now.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  useEffect(() => {
    if (quiz?.kind !== "graded" || outcome?.passed !== true || window.parent === window) return;
    window.parent.postMessage({ type: "boss-assessment-passed", slug }, window.location.origin);
  }, [outcome?.passed, quiz?.kind, slug]);

  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);
  const current = stage === "questions" ? questions[index] : undefined;

  // A phone shows the card below the fold once the intro has been scrolled
  // past, so each new question is brought back to the top of the screen.
  useEffect(() => {
    if (window.scrollY < 40) return;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [stage, index, reduce]);

  function focusOnMount(el: HTMLElement | null) {
    if (!el || !focusNext.current) return;
    focusNext.current = false;
    el.focus();
  }

  function clearAdvance() {
    if (advanceTimer.current === null) return;
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  }

  async function submit(finalChoices: Choices, finalTexts: Texts, lead?: { email: string; name: string }) {
    if (!quiz) return;
    setStage("working");
    setError(null);
    try {
      const result = await quizApi.submit(slug, {
        responses: buildResponses(quiz.questions, finalChoices, finalTexts),
        email: lead?.email,
        name: lead?.name ? lead.name : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...honeypot(),
      });
      if (!alive.current) return;
      setOutcome(result);
      setStage("result");
    } catch (err: unknown) {
      if (!alive.current) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : `Your answers didn't go through. Please try again, or email ${contactPage.email}.`,
      );
      // Back to whatever they were last looking at, with the answers intact —
      // a failed submit must never cost somebody the quiz they just finished.
      setStage(quiz.requireEmail ? "email" : questions.length > 0 ? "questions" : "intro");
    }
  }

  /** Moves on from `from`, or finishes when there is nothing after it. */
  function goForward(from: number, nextChoices: Choices, nextTexts: Texts) {
    if (!quiz) return;
    clearAdvance();
    setDirection(1);
    setError(null);
    focusNext.current = true;
    const next = from + 1;
    if (next < questions.length) {
      setStage("questions");
      setIndex(next);
      return;
    }
    if (quiz.requireEmail) {
      setStage("email");
      return;
    }
    void submit(nextChoices, nextTexts);
  }

  function goBack() {
    clearAdvance();
    setDirection(-1);
    setError(null);
    focusNext.current = true;
    if (stage === "email") {
      if (questions.length === 0) {
        setStage("intro");
        return;
      }
      setStage("questions");
      setIndex(questions.length - 1);
      return;
    }
    if (index === 0) {
      setStage("intro");
      return;
    }
    setIndex(index - 1);
  }

  /** One tap is the whole answer, so it also turns the page. */
  function chooseOne(question: QuizQuestion, answerId: number) {
    const nextChoices: Choices = { ...choices, [question.id]: [answerId] };
    setChoices(nextChoices);
    setError(null);
    clearAdvance();
    const at = index;
    advanceTimer.current = window.setTimeout(
      () => {
        advanceTimer.current = null;
        goForward(at, nextChoices, texts);
      },
      reduce ? 0 : ADVANCE_MS,
    );
  }

  function toggleMany(question: QuizQuestion, answerId: number, on: boolean) {
    const previous = choices[question.id] ?? [];
    const nextIds = on ? [...previous, answerId] : previous.filter((id) => id !== answerId);
    setChoices({ ...choices, [question.id]: nextIds });
    setError(null);
  }

  function handleNext() {
    if (!current) return;
    if (current.required && !hasAnswer(current, choices, texts)) {
      setError(
        current.kind === "text"
          ? "Please type an answer before moving on."
          : "Please choose at least one answer before moving on.",
      );
      return;
    }
    goForward(index, choices, texts);
  }

  function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError("That email address doesn't look right — please check it and try again.");
      return;
    }
    void submit(choices, texts, { email: address, name: name.trim() });
  }

  if (loadError) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Quiz unavailable"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <h1 className="mt-6 text-balance font-display text-[1.6rem] font-medium leading-tight text-white sm:text-[2rem]">
          This quiz didn't load.
        </h1>
        <p role="alert" className="copy-luxe mx-auto mt-4 max-w-[46ch] text-pretty">
          {loadError} The link is fine — try again, or email {contactPage.email} and I'll take it
          from there.
        </p>
        <LuxeButton
          variant="foil"
          size="md"
          onClick={() => setReloadKey((n) => n + 1)}
          className="mt-7 min-h-[44px]"
        >
          Try again
        </LuxeButton>
      </Section>
    );
  }

  if (quiz === undefined) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Loading quiz"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <p role="status" className="copy-luxe mt-6">
          Loading the quiz…
        </p>
      </Section>
    );
  }

  if (quiz === null) {
    return <NotFound />;
  }

  const graded = quiz.kind === "graded";
  const total = questions.length;
  const progress =
    stage === "questions" && total > 0 ? (index + 1) / total : stage === "intro" ? 0 : 1;

  const swap = {
    initial: reduce ? false : { opacity: 0, x: direction * 28 },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, x: direction * -28 },
    transition: { duration: reduce ? 0 : 0.34, ease: EASE },
  };

  /* ── The result ──────────────────────────────────────────────────────── */

  if (stage === "result" && outcome) {
    const result = outcome.result;
    const ctaHref = result ? safeHref(result.ctaUrl) : null;
    const ctaLabel = result?.ctaLabel.trim() ?? "";
    const scored = outcome.maxScore > 0;
    const feedback = outcome.feedback.filter((item) => item.text.trim());

    return (
      <>
        <Seo
          title={`${result ? result.title : "Your result"} | Boss Clinician`}
          description={result ? summarise(result.bodyMd) : undefined}
        />

        <LuxePageHero
          eyebrow="Your result"
          title={result ? result.title : "Thank you — that's everything I needed."}
          tone="gold"
          align="center"
          lede={
            graded
              ? `You scored ${outcome.percent}%${
                  outcome.passed === null ? "" : outcome.passed ? " — a pass." : "."
                }`
              : undefined
          }
        />

        <Section surface="base" space="md" aria-label="Your result" containerClassName="max-w-2xl">
          <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
            {result?.imageUrl && (
              // A fixed ratio rather than the image's own: the height is known
              // before the file arrives, so the copy underneath never jumps.
              <div className="mb-7 aspect-[16/9] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <img
                  src={result.imageUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-contain"
                />
              </div>
            )}

            {result ? (
              <div className="prose-boss break-words [&_table]:block [&_table]:overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.bodyMd}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-center">
                <GoldRule className="mx-auto" />
                <p className="copy-luxe mx-auto mt-6 max-w-[46ch] text-pretty">
                  Your answers are safely with me.
                  {scored && ` You scored ${outcome.score} out of ${outcome.maxScore}.`}
                  {quiz.requireEmail
                    ? " I'll come back to you with what they tell me about your practice."
                    : " Thank you for taking the time to think it through."}
                </p>
              </div>
            )}

            {graded && scored && (
              <p className="mt-7 flex flex-wrap items-center gap-3">
                <LuxePill accent={outcome.passed === false ? "neutral" : "green"}>
                  {outcome.score} of {outcome.maxScore} · {outcome.percent}%
                </LuxePill>
                {outcome.passed !== null && (
                  <LuxePill accent={outcome.passed ? "green" : "gold"}>
                    {outcome.passed ? "Passed" : "Not quite yet"}
                  </LuxePill>
                )}
              </p>
            )}

            {result && ctaHref && ctaLabel && (
              <div className="mt-8">
                {ctaHref.startsWith("/") ? (
                  <LuxeButton variant="foil" size="md" to={ctaHref} className="min-h-[44px] w-full sm:w-auto">
                    {ctaLabel}
                  </LuxeButton>
                ) : (
                  <LuxeButton
                    variant="foil"
                    size="md"
                    href={ctaHref}
                    target="_blank"
                    className="min-h-[44px] w-full sm:w-auto"
                  >
                    {ctaLabel}
                  </LuxeButton>
                )}
              </div>
            )}
          </GlassCard>

          {graded && feedback.length > 0 && (
            <div className="mt-8">
              <h2 className="font-display text-[1.3rem] font-medium text-white">
                A note on your answers
              </h2>
              <ul className="mt-5 flex list-none flex-col gap-3">
                {feedback.map((item) => {
                  const question = questions.find((q) => q.id === item.questionId);
                  return (
                    <li
                      key={item.questionId}
                      className={cn(
                        "rounded-xl border px-4 py-3.5",
                        item.correct
                          ? "border-green-bright/25 bg-green-bright/[0.07]"
                          : "border-gold/25 bg-gold/[0.06]",
                      )}
                    >
                      {question && (
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-orchid">
                          {question.prompt}
                        </p>
                      )}
                      <p className="mt-2 text-[0.95rem] leading-relaxed text-white/85">
                        {item.text}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Section>
      </>
    );
  }

  /* ── The player ──────────────────────────────────────────────────────── */

  return (
    <>
      <Seo title={`${quiz.title} | Boss Clinician`} description={summarise(quiz.introMd)} />

      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label={quiz.title}
        containerClassName="max-w-2xl"
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/85">
            {stage === "questions" && total > 0
              ? `Question ${index + 1} of ${total}`
              : stage === "email"
                ? "One last step"
                : "A quick quiz"}
          </p>
          {stage === "intro" && (
            <span className="text-xs text-orchid-faint">
              {total} {total === 1 ? "question" : "questions"}
            </span>
          )}
        </div>

        <div aria-hidden className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full w-full rounded-full bg-gold-foil"
            style={{ transformOrigin: "left" }}
            initial={false}
            animate={{ scaleX: progress }}
            transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
          />
        </div>

        <div className="mt-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={stage === "questions" ? `q${index}` : stage} {...swap}>
              {stage === "intro" && (
                <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                  <h1
                    ref={focusOnMount}
                    tabIndex={-1}
                    className="text-balance font-display text-[1.8rem] font-medium leading-[1.15] text-white outline-none sm:text-[2.4rem]"
                  >
                    {quiz.title}
                  </h1>
                  <GoldRule className="mt-6" />
                  {quiz.introMd.trim() && (
                    <div className="prose-boss mt-6 break-words [&_table]:block [&_table]:overflow-x-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{quiz.introMd}</ReactMarkdown>
                    </div>
                  )}
                  {error && (
                    <p
                      role="alert"
                      className="mt-6 rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
                    >
                      {error}
                    </p>
                  )}

                  <div className="mt-8">
                    <LuxeButton
                      variant="foil"
                      size="md"
                      onClick={() => goForward(-1, choices, texts)}
                      className="min-h-[44px] w-full sm:w-auto"
                    >
                      Start
                      <svg
                        aria-hidden
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5 transition-transform duration-500 ease-luxe group-hover:translate-x-1"
                      >
                        <path d="M2.5 8h11M9.5 4l4 4-4 4" />
                      </svg>
                    </LuxeButton>
                  </div>
                </GlassCard>
              )}

              {stage === "questions" && current && (
                <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                  <h1
                    id={promptId}
                    ref={focusOnMount}
                    tabIndex={-1}
                    className="text-balance font-display text-[1.5rem] font-medium leading-[1.2] text-white outline-none sm:text-[1.9rem]"
                  >
                    {current.prompt}
                  </h1>
                  {current.helpText.trim() && (
                    <p className="copy-luxe mt-3 text-pretty">{current.helpText}</p>
                  )}

                  <div className="mt-7">
                    {current.kind === "text" ? (
                      <LuxeTextarea
                        label="Your answer"
                        rows={5}
                        value={texts[current.id] ?? ""}
                        onChange={(e) => {
                          setTexts({ ...texts, [current.id]: e.target.value });
                          setError(null);
                        }}
                        aria-describedby={error ? errorId : undefined}
                      />
                    ) : current.kind === "multiple" ? (
                      <div
                        role="group"
                        aria-labelledby={promptId}
                        className="flex flex-col gap-2.5"
                      >
                        {current.answers.map((answer) => {
                          const on = (choices[current.id] ?? []).includes(answer.id);
                          return (
                            <label
                              key={answer.id}
                              className={cn(
                                "flex min-h-[44px] cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3.5",
                                "text-[0.95rem] leading-relaxed transition-colors duration-300",
                                on
                                  ? "border-gold/55 bg-gold/[0.09] text-white"
                                  : "border-white/12 bg-white/[0.04] text-white/85 hover:border-white/25",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => toggleMany(current, answer.id, e.target.checked)}
                                className="h-4 w-4 shrink-0 accent-gold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70"
                              />
                              <span className="min-w-0">{answer.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      // Buttons rather than radios: an arrow key moves *and*
                      // selects inside a radio group, which on an auto-advancing
                      // question would turn one keystroke into a page turn.
                      <div
                        role="group"
                        aria-labelledby={promptId}
                        className={cn(
                          current.kind === "scale"
                            ? "flex flex-wrap gap-2.5"
                            : "flex flex-col gap-2.5",
                        )}
                      >
                        {current.answers.map((answer) => {
                          const on = (choices[current.id] ?? []).includes(answer.id);
                          return (
                            <button
                              key={answer.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() => chooseOne(current, answer.id)}
                              className={cn(
                                "flex min-h-[44px] items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left",
                                "text-[0.95rem] leading-relaxed transition-colors duration-300",
                                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
                                current.kind === "scale" ? "grow basis-[7rem] justify-center text-center" : "w-full",
                                on
                                  ? "border-gold/60 bg-gold/[0.10] text-white"
                                  : "border-white/12 bg-white/[0.04] text-white/85 hover:border-white/25 hover:bg-white/[0.06]",
                              )}
                            >
                              {current.kind !== "scale" && (
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
                              )}
                              <span className="min-w-0">{answer.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {error && (
                    <p
                      id={errorId}
                      role="alert"
                      className="mt-5 rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
                    >
                      {error}
                    </p>
                  )}

                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <LuxeButton
                      variant="outline"
                      size="sm"
                      onClick={goBack}
                      className="min-h-[44px]"
                    >
                      Back
                    </LuxeButton>
                    {/* A single-choice tap is already the answer and turns the
                        page by itself. The button appears anyway once there is
                        an answer, so somebody who stepped back can move forward
                        again without re-tapping a choice they already made. */}
                    {(current.kind !== "single" && current.kind !== "scale") ||
                    hasAnswer(current, choices, texts) ? (
                      <LuxeButton
                        variant="foil"
                        size="sm"
                        onClick={handleNext}
                        className="min-h-[44px]"
                      >
                        {index + 1 === total ? "See my result" : "Next"}
                      </LuxeButton>
                    ) : null}
                  </div>
                </GlassCard>
              )}

              {stage === "email" && (
                <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                  <h1
                    ref={focusOnMount}
                    tabIndex={-1}
                    className="text-balance font-display text-[1.5rem] font-medium leading-[1.2] text-white outline-none sm:text-[1.9rem]"
                  >
                    Where should I send your result?
                  </h1>
                  <p className="copy-luxe mt-3 text-pretty">
                    Your result opens on the next screen. Your email goes with it, so anything I
                    send you afterwards fits your answers instead of being the note everyone gets.
                  </p>

                  <form onSubmit={handleEmailSubmit} noValidate className="mt-7 space-y-5">
                    {honeypotField}

                    <LuxeInput
                      label="Your first name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="min-h-[44px]"
                    />

                    <LuxeInput
                      label="Email address"
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

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <LuxeButton
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={goBack}
                        className="min-h-[44px]"
                      >
                        Back
                      </LuxeButton>
                      <LuxeButton
                        variant="foil"
                        size="sm"
                        type="submit"
                        className="min-h-[44px]"
                      >
                        Show me my result
                      </LuxeButton>
                    </div>

                    <p className="text-xs leading-relaxed text-orchid-faint">
                      I'll never share your address, and you can unsubscribe from anything I send
                      in one click.
                    </p>
                  </form>
                </GlassCard>
              )}

              {stage === "working" && (
                <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
                  <div
                    role="status"
                    className="flex min-h-[9rem] flex-col items-center justify-center text-center"
                  >
                    <GoldRule className="mx-auto" />
                    <p className="copy-luxe mt-6">Working out your result…</p>
                  </div>
                </GlassCard>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </Section>
    </>
  );
}
