import { useEffect, useId, useReducer, useRef } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePlayerSource } from "@/components/player/playerSource";
import {
  INCOME_INTRO,
  INCOME_QUESTIONS,
  INCOME_RESULT_NOTE,
  MODULE_02_RETURN_SLUG,
  QUESTION_COUNT,
  assessmentReducer,
  assessmentResult,
  initialAssessment,
  type AssessmentState,
  type Choice,
} from "./incomeStream";

/**
 * "Do You Actually Need This?" (sheet row 240): five questions, one per screen,
 * then one of three recommendations. Answers are held in memory for this visit
 * only; nothing is saved, sent or tracked. See incomeStream.ts for the copy and
 * the scoring rules.
 */

const button =
  "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors duration-200 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold " +
  "disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} bg-gold text-night-deep hover:bg-gold-bright disabled:hover:bg-gold`;
const secondary = `${button} border border-white/20 text-white/85 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white`;

export function IncomeStreamAssessment({ initialState = initialAssessment }: { initialState?: AssessmentState }) {
  const [state, dispatch] = useReducer(assessmentReducer, initialState);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStage = useRef(initialState.stage);
  const { productSlug = "" } = useParams();
  const { lessonPath, preview } = usePlayerSource();
  const id = useId();

  // Each screen change moves focus to its heading, so keyboard and screen
  // reader users land on the new question instead of a removed button.
  useEffect(() => {
    if (shownStage.current === state.stage) return; // not on first render
    shownStage.current = state.stage;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.stage]);

  const result = assessmentResult(state);
  const question = state.stage >= 0 && state.stage < QUESTION_COUNT ? INCOME_QUESTIONS[state.stage] : null;
  const selected = question ? state.answers[state.stage] : null;
  // Same-origin by construction: an in-app path, never a URL from the query.
  const returnHref = productSlug || preview ? lessonPath(productSlug, MODULE_02_RETURN_SLUG) : "/library";

  return (
    <section
      aria-label={`${INCOME_INTRO.title} ${INCOME_INTRO.subtitle}`}
      className="min-w-0 overflow-hidden rounded-2xl border border-gold/25 bg-white/[0.03] shadow-glass"
    >
      <header className="border-b border-white/10 bg-night-raised/70 px-5 py-6 sm:px-8 sm:py-7">
        <h2 className="text-balance font-display text-2xl leading-tight text-white sm:text-[2rem]">{INCOME_INTRO.title}</h2>
        <p className="mt-1.5 text-sm text-orchid">{INCOME_INTRO.subtitle}</p>
      </header>

      <div className="px-5 py-6 sm:px-8 sm:py-8">
        {state.stage === -1 && (
          <div className="max-w-[65ch]">
            <p className="text-sm font-semibold text-gold">{INCOME_INTRO.lead}</p>
            <h3 ref={headingRef} tabIndex={-1} className="mt-2 text-balance font-display text-xl leading-snug text-white outline-none sm:text-2xl">
              {INCOME_INTRO.heading}
            </h3>
            <p className="mt-3 leading-relaxed text-orchid">{INCOME_INTRO.body}</p>
            <p className="mt-3 text-sm text-orchid-dim">{INCOME_INTRO.note}</p>
            <button type="button" className={cn(primary, "mt-6")} onClick={() => dispatch({ type: "start" })}>
              {INCOME_INTRO.start}
              <ArrowRight aria-hidden className="size-4" />
            </button>
          </div>
        )}

        {question && (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-semibold text-gold">{question.category}</p>
              <p className="font-body text-sm font-bold tabular-nums text-orchid">
                Question {state.stage + 1} of {QUESTION_COUNT}
              </p>
            </div>
            <div
              role="progressbar"
              aria-label="Assessment progress"
              aria-valuemin={0}
              aria-valuemax={QUESTION_COUNT}
              aria-valuenow={state.stage}
              className="mt-3 grid grid-cols-5 gap-1.5"
            >
              {INCOME_QUESTIONS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-colors duration-300",
                    i < state.stage ? "bg-gold" : i === state.stage ? "bg-gold/45" : "bg-white/10",
                  )}
                />
              ))}
            </div>

            <fieldset className="mt-6 min-w-0">
              <legend className="contents">
                <h3
                  ref={headingRef}
                  tabIndex={-1}
                  id={`${id}-q`}
                  className="max-w-[60ch] text-balance font-display text-xl leading-snug text-white outline-none sm:text-2xl"
                >
                  {question.question}
                </h3>
              </legend>
              <div className="mt-5 flex flex-col gap-2.5">
                {question.options.map((option, i) => {
                  const checked = selected === i;
                  return (
                    <label
                      key={i}
                      className={cn(
                        "group flex min-h-[3.5rem] cursor-pointer items-start gap-3.5 rounded-xl border px-4 py-3.5 leading-relaxed transition-colors duration-200",
                        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold",
                        checked
                          ? "border-gold/70 bg-gold/[0.09] text-white"
                          : "border-white/12 text-orchid hover:border-gold/40 hover:bg-white/[0.04] hover:text-white",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-question-${state.stage}`}
                        value={i}
                        checked={checked}
                        onChange={() => dispatch({ type: "choose", choice: i as Choice })}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                          checked ? "border-gold bg-gold text-night-deep" : "border-white/30 group-hover:border-gold/60",
                        )}
                      >
                        {checked && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
              <button type="button" className={secondary} onClick={() => dispatch({ type: "back" })}>
                <ArrowLeft aria-hidden className="size-4" />
                Back
              </button>
              <button
                type="button"
                className={primary}
                disabled={selected === null}
                onClick={() => dispatch({ type: "next" })}
              >
                {state.stage === QUESTION_COUNT - 1 ? "See My Result" : "Continue"}
                <ArrowRight aria-hidden className="size-4" />
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="max-w-[68ch]">
            <p className="inline-flex rounded-full border border-gold/40 bg-gold/[0.1] px-3.5 py-1 text-sm font-semibold text-gold-bright">
              {result.title}
            </p>
            <h3 ref={headingRef} tabIndex={-1} className="mt-4 text-balance font-display text-xl leading-snug text-white outline-none sm:text-2xl">
              {result.headline}
            </h3>
            <p className="mt-4 leading-relaxed text-orchid">{result.body}</p>

            <h4 className="mt-8 font-semibold text-white">Your next steps</h4>
            <ol className="mt-3 flex flex-col gap-3">
              {result.steps.map((step, i) => (
                <li key={i} className="flex gap-3.5 leading-relaxed text-orchid">
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-gold/40 font-body text-sm font-bold tabular-nums text-gold"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <p className="mt-7 rounded-xl border border-white/10 bg-night-raised/60 px-4 py-3.5 text-sm leading-relaxed text-orchid">
              <strong className="font-semibold text-white">{INCOME_RESULT_NOTE.lead}</strong> {INCOME_RESULT_NOTE.body}
            </p>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
              <button type="button" className={secondary} onClick={() => dispatch({ type: "retake" })}>
                <RotateCcw aria-hidden className="size-4" />
                Retake Assessment
              </button>
              <Link to={returnHref} className={primary}>
                Back to Module 02
              </Link>
            </div>
          </div>
        )}
      </div>

      <p className="border-t border-white/10 px-5 py-3 text-xs text-orchid-dim sm:px-8">
        Your answers stay on this page during this visit. They are not saved or sent anywhere.
      </p>
    </section>
  );
}
