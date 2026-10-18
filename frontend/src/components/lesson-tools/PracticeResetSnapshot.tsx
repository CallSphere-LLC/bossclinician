import { useId, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { usePlayerSource } from "@/components/player/playerSource";
import { snapshot as copy, type BoldLead, type SnapshotQuestion } from "@/content/kajabiPagesQuiz";
import {
  ActionButton,
  Callout,
  DashboardFrame,
  ProgressBar,
  escapeHtml,
  printReport,
} from "./DashboardKit";
import { PROFILES } from "./practiceElevation";
import {
  ELEVATION_DASHBOARD_LESSON_SLUG,
  SNAPSHOT_KEY,
  answeredCount,
  firstMissing,
  isComplete,
  normaliseSnapshot,
  scoreAnswers,
  snapshotDefaults,
  snapshotPathway,
  type SnapshotState,
} from "./practiceSnapshot";
import { useToolState } from "./useToolState";

/**
 * The Practice Reset Snapshot inside the Practice Elevation course (QA sheet
 * row 101), on the orientation lesson "Take the Practice Reset Snapshot".
 *
 * The questions, scoring and three results are the public page's
 * (pages/kajabi/pages/PracticeResetSnapshot.tsx, verbatim from Kajabi). What
 * the lesson adds: answers save to the member's account, the result stays on
 * the lesson when they come back, and the result names the suggested pathway
 * the Practice Elevation dashboard will build their first 30-day plan from.
 */

const QUESTION_ID = (scope: string, n: number) => `${scope}-snapshot-q${n}`;

function Bold({ lead }: { lead: BoldLead }) {
  return (
    <>
      <strong className="font-semibold text-white">{lead.strong}</strong>
      {lead.text}
    </>
  );
}

/** The twelve questions, bound to a saved snapshot. Shared with the dashboard. */
export function SnapshotQuestions({
  state,
  onChange,
  warn,
}: {
  state: SnapshotState;
  onChange: (next: SnapshotState) => void;
  warn?: boolean;
}) {
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const answered = answeredCount(state.answers);
  const reflectionId = `${scope}-snapshot-q12`;

  const choose = (question: number, value: string) =>
    // Changing an answer after seeing results asks for them again.
    onChange({ ...state, answers: { ...state.answers, [String(question)]: value }, result: null, completedAt: null });

  return (
    <div className="flex flex-col gap-6" data-snapshot-scope={scope}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-orchid">
          <span>{copy.progressLabel}</span>
          <span className="font-body font-bold tabular-nums text-gold" aria-live="polite">
            {answered} of {copy.requiredCount} answered
          </span>
        </div>
        <ProgressBar percent={(answered / copy.requiredCount) * 100} label={copy.progressLabel} />
      </div>

      {copy.sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-4">
          <h3 className="font-display text-lg text-white sm:text-xl">{section.heading}</h3>
          {section.questions.map((q) => (
            <QuestionCard
              key={q.number}
              id={QUESTION_ID(scope, q.number)}
              question={q}
              value={state.answers[String(q.number)]}
              missing={Boolean(warn) && !state.answers[String(q.number)]}
              onChoose={(value) => choose(q.number, value)}
            />
          ))}
        </div>
      ))}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">{copy.reflection.number}</p>
        <label htmlFor={reflectionId} className="mt-2 block text-base font-semibold leading-snug text-white">
          {copy.reflection.text}
        </label>
        <p className="mt-1 text-sm italic text-orchid-dim">{copy.reflection.sub}</p>
        <textarea
          id={reflectionId}
          rows={4}
          value={state.reflection}
          onChange={(e) => onChange({ ...state, reflection: e.target.value })}
          placeholder={copy.reflection.placeholder}
          className={cn(luxeControlClass, "mt-4 resize-y leading-relaxed")}
        />
      </div>
    </div>
  );
}

/** Scrolls to the first unanswered question of the list rendered under `root`. */
export function scrollToMissing(root: HTMLElement | null, answers: Record<string, string>) {
  const missing = firstMissing(answers);
  if (missing === null || !root) return;
  const scope = root.querySelector<HTMLElement>("[data-snapshot-scope]")?.dataset.snapshotScope;
  if (!scope) return;
  document.getElementById(QUESTION_ID(scope, missing))?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function QuestionCard({
  id,
  question,
  value,
  missing,
  onChoose,
}: {
  id: string;
  question: SnapshotQuestion;
  value: string | undefined;
  missing: boolean;
  onChoose: (value: string) => void;
}) {
  const answered = value !== undefined;
  return (
    <fieldset
      id={id}
      className={cn(
        "scroll-mt-40 rounded-xl border p-4 transition-colors duration-300 sm:p-5",
        answered ? "border-gold/30 bg-gold/[0.04]" : missing ? "border-rose-400/50 bg-white/[0.03]" : "border-white/10 bg-white/[0.03]",
      )}
    >
      <legend className="contents">
        <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
          Question <span className="font-body font-bold tabular-nums">{question.number}</span>
        </span>
        <span className="mt-2 block text-pretty text-base font-semibold leading-snug text-white">{question.text}</span>
      </legend>
      {question.sub && <p className="mt-1.5 text-sm leading-relaxed text-orchid-dim">{question.sub}</p>}
      <div className="mt-4 grid gap-2.5">
        {question.options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[0.92rem] leading-snug transition-colors duration-300",
                checked ? "border-gold/60 bg-gold/[0.08] text-white" : "border-white/12 bg-white/[0.03] text-orchid hover:border-white/25",
              )}
            >
              <input
                type="radio"
                name={id}
                value={option.value}
                checked={checked}
                onChange={() => onChoose(option.value)}
                className="size-4 shrink-0 accent-[rgb(201,164,106)]"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Where the dashboard lesson lives, for a member or in the admin preview. */
export function useDashboardHref(): string {
  const params = useParams();
  const source = usePlayerSource();
  return source.lessonPath(params.productSlug ?? "", ELEVATION_DASHBOARD_LESSON_SLUG);
}

/** One of the three results, its five moves, and the suggested pathway. */
export function SnapshotResult({
  state,
  onRetake,
  dashboardLink,
}: {
  state: SnapshotState;
  onRetake: () => void;
  dashboardLink?: string | null;
}) {
  if (!state.result) return null;
  const r = copy.results[state.result];
  const pathway = snapshotPathway(state.answers);
  const profile = PROFILES[pathway.focus];
  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <div className="text-center">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-gold">{copy.resultEyebrow}</p>
        <h3 className="mt-2 text-balance font-display text-2xl text-white sm:text-3xl">{r.title}</h3>
        <p className="mt-2 font-display text-lg italic text-gold">{r.tag}</p>
      </div>
      <p className="text-pretty text-[0.95rem] leading-relaxed text-orchid">{r.lead}</p>

      <div>
        <h4 className="text-center text-[0.74rem] font-bold uppercase tracking-[0.2em] text-gold">{copy.movesTitle}</h4>
        <ol className="mt-4 grid list-none gap-3">
          {r.moves.map((move, i) => (
            <li key={move.strong} className="flex items-start gap-4 rounded-xl border border-gold/25 bg-white/[0.03] p-4">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-gold/40 font-body text-sm font-bold tabular-nums text-gold"
              >
                {i + 1}
              </span>
              <p className="text-pretty text-sm leading-relaxed text-orchid sm:text-[0.95rem]">
                <Bold lead={move} />
              </p>
            </li>
          ))}
        </ol>
      </div>

      <Callout tone="plum">
        <Bold lead={r.close} />
      </Callout>

      <div className="rounded-xl border border-[#547376]/50 bg-[#547376]/[0.10] p-4 sm:p-5">
        <p className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-gold/90">Your suggested Practice Elevation pathway</p>
        <h4 className="mt-1 text-lg font-semibold text-white">{profile.name}</h4>
        <p className="mt-1.5 text-sm leading-relaxed text-orchid">{profile.why}</p>
        {pathway.flags.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-orchid">
            {pathway.flags.map((flag) => (
              <li key={flag}>• {flag}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-orchid-dim">Recommended course connection: {profile.lesson}</p>
        {dashboardLink && (
          <Link
            to={dashboardLink}
            className="mt-4 inline-flex min-h-[2.5rem] items-center gap-2 rounded-full border border-gold/70 bg-gold/[0.18] px-4 text-[0.8rem] font-semibold text-white transition-colors hover:bg-gold/[0.28] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Build my 30-day plan in my Practice Elevation Dashboard
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <ActionButton onClick={onRetake}>{copy.retakeLabel}</ActionButton>
        <ActionButton icon="print" onClick={() => printSnapshot(state)}>
          Print / Save PDF
        </ActionButton>
      </div>
    </div>
  );
}

function printSnapshot(state: SnapshotState) {
  if (!state.result) return;
  const r = copy.results[state.result];
  const pathway = snapshotPathway(state.answers);
  const profile = PROFILES[pathway.focus];
  printReport(
    "My Practice Reset Snapshot",
    `<small>${escapeHtml(copy.resultEyebrow.toUpperCase())}</small><h1>${escapeHtml(r.title)}</h1><p><em>${escapeHtml(r.tag)}</em></p><p>${escapeHtml(
      r.lead,
    )}</p><section><h2>${escapeHtml(copy.movesTitle)}</h2><ol>${r.moves
      .map((m) => `<li><b>${escapeHtml(m.strong)}</b>${escapeHtml(m.text)}</li>`)
      .join("")}</ol><p><b>${escapeHtml(r.close.strong)}</b>${escapeHtml(r.close.text)}</p></section><section><h2>Suggested Practice Elevation pathway: ${escapeHtml(
      profile.name,
    )}</h2><p>${escapeHtml(profile.why)}</p>${pathway.flags.map((f) => `<p>• ${escapeHtml(f)}</p>`).join("")}</section>${
      state.reflection.trim()
        ? `<section><h2>“I built a full practice, and...”</h2><p>${escapeHtml(state.reflection)}</p></section>`
        : ""
    }`,
  );
}

export function PracticeResetSnapshotTool() {
  const { state, setState, status, ready, savedAt } = useToolState(SNAPSHOT_KEY, snapshotDefaults, normaliseSnapshot);
  const [warn, setWarn] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dashboardHref = useDashboardHref();

  const seeResults = () => {
    if (!isComplete(state.answers)) {
      setWarn(true);
      scrollToMissing(root.current, state.answers);
      return;
    }
    setWarn(false);
    setState({ ...state, result: scoreAnswers(state.answers), completedAt: new Date().toISOString() });
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const retake = () => {
    if (!window.confirm("Clear your answers and take the snapshot again?")) return;
    setWarn(false);
    setState(snapshotDefaults());
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={root} className="scroll-mt-24">
      <DashboardFrame
        eyebrow={copy.hero.eyebrow}
        title={`${copy.hero.title}: ${copy.hero.tagline}`}
        subtitle={copy.hero.intro}
        status={status}
        savedAt={savedAt}
        footer={
          <>
            <strong className="font-semibold text-orchid">{copy.footer.strong}</strong> · {copy.footer.text}. Your answers are private to your account. Do not enter client-identifying information.
          </>
        }
      >
        {!ready ? (
          <p className="text-sm text-orchid-dim">Loading your snapshot…</p>
        ) : state.result ? (
          <SnapshotResult state={state} onRetake={retake} dashboardLink={dashboardHref} />
        ) : (
          <>
            <SnapshotQuestions
              state={state}
              warn={warn}
              onChange={(next) => {
                setState(next);
                if (warn && isComplete(next.answers)) setWarn(false);
              }}
            />
            <div className="flex flex-col items-center gap-3 text-center">
              <ActionButton primary onClick={seeResults}>
                {copy.submitLabel}
              </ActionButton>
              {warn && (
                <p role="alert" className="text-sm text-rose-400">
                  {copy.warning}
                </p>
              )}
            </div>
          </>
        )}
      </DashboardFrame>
    </div>
  );
}
