import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { usePlayerSource } from "@/components/player/playerSource";
import { ActionButton, Callout, DashboardFrame, Panel, Pill, ProgressBar, SelectField, downloadFile } from "./DashboardKit";
import {
  CHOICE_LABELS,
  COURSE_LESSONS,
  COURSE_MODULES,
  DASHBOARD_LESSON,
  FLAG_COPY,
  NARRATIVE_MAX,
  PATHWAYS,
  PATHWAY_NAMES,
  SNAPSHOT_QUESTIONS_V2,
  SNAPSHOT_SECTIONS,
  SNAPSHOT_V2_KEY,
  completeSnapshot,
  focusOf,
  missingIn,
  normaliseSnapshotV2,
  pathwayTarget,
  selectPriority,
  snapshotV2Defaults,
  type PathwayName,
  type SnapshotAnswers,
  type SnapshotQuestionV2,
  type SnapshotRecommendation,
  type SnapshotV2State,
} from "./snapshotRouting";
import { useVersionedToolState } from "./useVersionedToolState";

/**
 * The Practice Reset Snapshot, membership edition (QA sheet rows 158 + 170), on
 * the orientation lesson "The Practice Reset Snapshot" directly above the
 * Practice Elevation dashboard.
 *
 * The owner's standalone package, ported natively so it can open real lessons:
 * her twelve questions in four steps, her scoring, and a results page that names
 * the recommended module and the specific lesson with links into the course
 * player (and into the admin preview when previewed). Answers save to the
 * member's account through the revision-checked tool state — never
 * localStorage — so a retake on another device cannot silently overwrite;
 * finishing a retake moves the previous result to the history below it.
 */

const LOCKED = ["readonly", "conflict", "offline", "loading"];

function useLessonHref() {
  const params = useParams();
  const source = usePlayerSource();
  return (slug: string) => source.lessonPath(params.productSlug ?? "", slug);
}

const linkClass =
  "inline-flex min-h-[2.5rem] items-center gap-2 rounded-full border px-4 text-[0.8rem] font-semibold transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold print:hidden";

function LessonLink({ lessonId, primary, children }: { lessonId: number; primary?: boolean; children?: ReactNode }) {
  const href = useLessonHref();
  const lesson = COURSE_LESSONS[lessonId];
  if (!lesson) return null;
  return (
    <Link
      to={href(lesson.slug)}
      className={cn(
        linkClass,
        primary ? "border-gold/70 bg-gold/[0.18] text-white hover:bg-gold/[0.28]" : "border-white/20 bg-white/[0.03] text-white/90 hover:border-gold/50 hover:text-white",
      )}
    >
      {children ?? `Open: ${lesson.title}`}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

/** "Module 01 · Find Out What Your Practice Is Actually Producing". */
const moduleLine = (moduleId: number) => {
  const m = COURSE_MODULES[moduleId];
  return m ? `${m.section} · ${m.title}` : "";
};

/* ------------------------------------------------------------------ form */

function QuestionField({
  scope,
  question,
  answers,
  disabled,
  onChange,
}: {
  scope: string;
  question: SnapshotQuestionV2;
  answers: SnapshotAnswers;
  disabled: boolean;
  onChange: (value: number | string) => void;
}) {
  const value = answers[String(question.id)];
  const legend = (
    <span className="block text-pretty text-base font-semibold leading-snug text-white">
      <span className="font-body font-bold tabular-nums text-gold">{question.id}.</span> {question.prompt}
    </span>
  );
  if (!question.options) {
    const id = `${scope}-q${question.id}`;
    return (
      <div className="flex flex-col gap-3">
        <label htmlFor={id}>{legend}</label>
        <textarea
          id={id}
          rows={5}
          maxLength={NARRATIVE_MAX}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          placeholder="Share your perspective..."
          onChange={(e) => onChange(e.target.value)}
          className={cn(luxeControlClass, "resize-y py-2.5 leading-relaxed")}
        />
      </div>
    );
  }
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3">{legend}</legend>
      <div className="grid gap-2.5">
        {question.options.map((option, i) => {
          const checked = value === i;
          return (
            <label
              key={option}
              className={cn(
                "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-[0.92rem] leading-snug transition-colors duration-300",
                checked ? "border-[#547376]/70 bg-[#547376]/[0.16] text-white" : "border-white/12 bg-white/[0.03] text-orchid hover:border-white/25",
                disabled && "cursor-not-allowed opacity-70",
              )}
            >
              <input
                type="radio"
                name={`${scope}-q${question.id}`}
                value={i}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(i)}
                className="mt-0.5 size-4 shrink-0 accent-[#547376]"
              />
              <span>
                <strong className="font-semibold text-white">{CHOICE_LABELS[i]}.</strong> {option}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* --------------------------------------------------------------- results */

function Recommendation({ item }: { item: SnapshotRecommendation }) {
  const copy = item.id === "first_audit" ? { label: "Start with the Current Model Audit", why: "" } : FLAG_COPY[item.id];
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-gold/90">{COURSE_MODULES[item.module_id]?.section}</p>
      <p className="font-semibold text-white">{copy.label}</p>
      {copy.why && <p className="text-sm leading-relaxed text-orchid">{copy.why}</p>}
      <ul className="flex flex-col gap-1.5 text-sm text-orchid">
        {item.lesson_ids.map((id) => (
          <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="min-w-0">
              <span className="text-orchid-dim">{COURSE_MODULES[COURSE_LESSONS[id]?.moduleId]?.title} → </span>
              <span className="text-white/90">{COURSE_LESSONS[id]?.title}</span>
            </span>
            <LessonLink lessonId={id}>Open lesson</LessonLink>
          </li>
        ))}
      </ul>
    </li>
  );
}

function StartHere({ moduleId, lessonIds, eyebrow }: { moduleId: number; lessonIds: readonly number[]; eyebrow: string }) {
  const [first, ...rest] = lessonIds;
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/[0.07] p-4 sm:p-5">
      <p className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-gold">{eyebrow}</p>
      <p className="mt-1 text-sm text-orchid">{moduleLine(moduleId)}</p>
      <p className="mt-2 text-lg font-semibold text-white">{COURSE_LESSONS[first]?.title}</p>
      <div className="mt-3">
        <LessonLink lessonId={first} primary>
          Open this lesson
        </LessonLink>
      </div>
      {rest.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 text-sm text-orchid">
          <p className="text-orchid-dim">Also recommended:</p>
          {rest.map((id) => (
            <div key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-white/90">{COURSE_LESSONS[id]?.title}</span>
              <span className="text-orchid-dim">({moduleLine(COURSE_LESSONS[id]?.moduleId)})</span>
              <LessonLink lessonId={id}>Open lesson</LessonLink>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function resultsJson(state: SnapshotV2State): string {
  const lessonTitle = (id: number) => COURSE_LESSONS[id]?.title ?? String(id);
  return JSON.stringify(
    {
      assessment: "Practice Reset Snapshot",
      version: state.assessment_version,
      completedAt: state.completed_at,
      answers: Object.fromEntries(
        SNAPSHOT_QUESTIONS_V2.map((q) => {
          const v = state.answers[String(q.id)];
          return [q.id, { question: q.prompt, response: q.options ? q.options[v as number] : v, choiceIndex: q.options ? v : null }];
        }),
      ),
      narrative: state.answers["12"],
      profile: state.profile,
      primaryPathway: state.recommended_pathway,
      primaryModule: state.recommended_module_id ? moduleLine(state.recommended_module_id) : null,
      primaryLessons: state.recommended_lesson_ids.map(lessonTitle),
      selfIdentifiedPriority: state.self_identified_priority,
      memberSelectedPriority: state.member_selected_priority,
      flags: state.flags.map((id) => ({ id, ...FLAG_COPY[id] })),
      recommendations: state.recommendations.map((r) => ({
        id: r.id,
        module: moduleLine(r.module_id),
        lessons: r.lesson_ids.map(lessonTitle),
      })),
    },
    null,
    2,
  );
}

function Results({
  state,
  locked,
  onChange,
  onRetake,
}: {
  state: SnapshotV2State;
  locked: boolean;
  onChange: (next: SnapshotV2State) => void;
  onRetake: () => void;
}) {
  const href = useLessonHref();
  if (!state.completed_at || !state.recommended_pathway || !state.recommended_module_id) return null;
  const focus = state.recommended_focus ?? "clarity";
  const auditFirst = state.flags.includes("financial_clarity");
  const selected = state.member_selected_priority ?? state.recommended_pathway;
  const selectedTarget = selected !== state.recommended_pathway ? pathwayTarget(focusOf(selected), state.answers) : null;
  const narrative = typeof state.answers["12"] === "string" ? state.answers["12"] : "";

  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <div>
        <Pill>Snapshot complete</Pill>
        <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">Your Practice Starting Point</h3>
        <p className="mt-1 text-xs text-orchid-dim">
          Completed {new Date(state.completed_at).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {narrative && (
        <Panel title="Here's where you're starting">
          <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-orchid">“I built a full practice, and… {narrative}”</p>
        </Panel>
      )}

      <Panel eyebrow={state.profile ?? undefined} title={state.recommended_pathway} intro={auditFirst ? "First establish your true effective hourly rate; then return to your selected priority." : PATHWAYS[focus].focus}>
        <StartHere moduleId={state.recommended_module_id} lessonIds={state.recommended_lesson_ids} eyebrow={`Start with: ${PATHWAYS[focus].section}`} />
        {state.recommended_pathway !== state.self_identified_priority && (
          <p className="text-sm leading-relaxed text-orchid-dim">
            You chose {state.self_identified_priority} as your priority. We're recommending a financial baseline first so your 30-day goal is grounded in real numbers.
          </p>
        )}
      </Panel>

      <Panel title="Your focus for the next 30 days" intro="Your Practice Elevation Dashboard starts your first 30-day plan from this focus. You can refine it there.">
        <SelectField<PathwayName>
          label="My priority"
          value={selected}
          onChange={(value) => !locked && onChange(selectPriority(state, value))}
          options={PATHWAY_NAMES.map((name) => ({ value: name, label: name === state.recommended_pathway ? `${name} (recommended)` : name }))}
        />
        {selectedTarget && <StartHere moduleId={selectedTarget.moduleId} lessonIds={selectedTarget.lessonIds} eyebrow={`Where ${selected} starts`} />}
      </Panel>

      <div>
        <h4 className="text-base font-semibold text-white">Recommended next steps</h4>
        <ul className="mt-3 grid list-none gap-3">
          {state.recommendations.map((item) => (
            <Recommendation key={item.id} item={item} />
          ))}
        </ul>
      </div>

      <Callout tone="sage">
        Next, open your <strong className="font-semibold text-white">Practice Elevation Dashboard</strong>, enter your current metrics and target numbers, and create a measurable 30-day plan.
      </Callout>

      <div className="flex flex-wrap gap-2">
        <Link to={href(DASHBOARD_LESSON.slug)} className={cn(linkClass, "border-gold/70 bg-gold/[0.18] text-white hover:bg-gold/[0.28]")}>
          Open Practice Elevation Dashboard
          <ArrowRight aria-hidden className="size-4" />
        </Link>
        <ActionButton icon="download" onClick={() => downloadFile("boss-clinician-practice-reset-snapshot.json", resultsJson(state), "application/json")}>
          Download my results
        </ActionButton>
        <ActionButton onClick={onRetake} disabled={locked}>
          Review my answers / retake
        </ActionButton>
      </div>

      <p className="text-xs leading-relaxed text-orchid-dim">
        The recommendations are educational starting points, not a diagnosis or a substitute for reviewing your business numbers.
      </p>

      {state.history.length > 0 && (
        <Panel title="Earlier snapshots" intro="Each time you finish a retake with changed answers, the result it replaces is kept here.">
          <ul className="flex flex-col gap-2 text-sm text-orchid">
            {[...state.history].reverse().map((r) => (
              <li key={r.completed_at} className="flex flex-wrap gap-x-3 border-b border-white/10 pb-2 last:border-0">
                <span className="font-body font-bold tabular-nums text-white/90">{new Date(r.completed_at).toLocaleDateString()}</span>
                <span>{r.recommended_pathway}</span>
                <span className="text-orchid-dim">Start: {COURSE_LESSONS[r.recommended_lesson_ids[0]]?.title}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ tool */

export function PracticeResetSnapshotV2() {
  const tool = useVersionedToolState(SNAPSHOT_V2_KEY, snapshotV2Defaults, normaliseSnapshotV2);
  const { state, setState, status, savedAt, ready } = tool;
  const locked = LOCKED.includes(status);
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const resumed = useRef(false);

  // Resume an unfinished snapshot on the step it was left on (once, after load).
  useEffect(() => {
    if (!ready || resumed.current || status === "loading") return;
    resumed.current = true;
    setStep(state.draft?.step ?? 0);
  }, [ready, status, state.draft]);

  const draftAnswers = state.draft?.answers ?? {};
  const showForm = !!state.draft || !state.completed_at;
  const section = SNAPSHOT_SECTIONS[step];
  const top = () => root.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const answer = (question: number, value: number | string) => {
    setError("");
    setState({ ...state, draft: { answers: { ...draftAnswers, [String(question)]: value }, step } });
  };

  const next = () => {
    const missing = missingIn(section, draftAnswers);
    if (missing !== null) {
      setError(missing === 12 ? "Please complete question 12." : `Please select an answer for question ${missing}.`);
      return;
    }
    setError("");
    if (step < SNAPSHOT_SECTIONS.length - 1) {
      setStep(step + 1);
      setState({ ...state, draft: { answers: draftAnswers, step: step + 1 } });
    } else {
      setState(completeSnapshot(state, draftAnswers, new Date().toISOString()));
      setStep(0);
    }
    top();
  };

  const back = () => {
    setError("");
    if (step > 0) setStep(step - 1);
    top();
  };

  const retake = () => {
    setError("");
    setStep(0);
    setState({ ...state, draft: { answers: { ...state.answers }, step: 0 } });
    top();
  };

  const cancelRetake = () => {
    setError("");
    setState({ ...state, draft: null });
    top();
  };

  return (
    <div ref={root} className="scroll-mt-24">
      <DashboardFrame
        eyebrow="Boss Clinician Lounge · The Practice Elevation"
        title="Practice Reset Snapshot"
        subtitle="Your Starting Point in the Boss Clinician Lounge"
        status={status}
        savedAt={savedAt}
        footer={
          <>
            © Boss Clinician, LLC · Private practice business education. Your answers are private to your account. Do not enter client-identifying information.
          </>
        }
      >
        {status === "conflict" && (
          <div role="alert" className="flex flex-wrap gap-3">
            <ActionButton icon="download" onClick={() => downloadFile("practice-reset-snapshot-local-copy.json", JSON.stringify(state, null, 2), "application/json")}>
              Download my local copy
            </ActionButton>
            <ActionButton
              onClick={() => {
                if (window.confirm("Load the latest saved version? Download your local copy first if you need to keep these unsaved answers.")) void tool.reload();
              }}
            >
              Load latest saved version
            </ActionButton>
          </div>
        )}
        {status === "offline" && <ActionButton onClick={() => void tool.reload()}>Retry loading my snapshot</ActionButton>}

        {!ready ? (
          <p className="text-sm text-orchid-dim">Loading your snapshot…</p>
        ) : !showForm ? (
          <Results state={state} locked={locked} onChange={setState} onRetake={retake} />
        ) : (
          <div className="flex flex-col gap-5">
            <Callout tone="plum">
              Before you open Module 01, take the Practice Reset Snapshot. Your answers will help identify your most urgent starting point and recommend where to begin in The Practice Elevation. Answer honestly—the more accurate your answers, the more useful your next steps.{" "}
              <strong className="font-semibold text-white">About 10 minutes.</strong>
            </Callout>
            <div className="flex flex-col gap-2">
              <ProgressBar percent={((step + 1) / SNAPSHOT_SECTIONS.length) * 100} label="Assessment progress" />
              <div className="flex justify-between gap-3 text-[0.78rem] text-orchid-dim">
                <span>{section.title}</span>
                <span className="font-body font-bold tabular-nums">
                  Step {step + 1} of {SNAPSHOT_SECTIONS.length}
                </span>
              </div>
            </div>
            <h3 className="font-display text-xl text-white">{section.title}</h3>
            {section.questions.map((q) => (
              <QuestionField key={q.id} scope={scope} question={q} answers={draftAnswers} disabled={locked} onChange={(value) => answer(q.id, value)} />
            ))}
            <p role="alert" className="min-h-[1.25rem] text-sm font-semibold text-rose-400">
              {error}
            </p>
            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {step > 0 && <ActionButton onClick={back}>Back</ActionButton>}
                {state.completed_at && (
                  <ActionButton onClick={cancelRetake} disabled={locked}>
                    Back to my results
                  </ActionButton>
                )}
              </div>
              {/* Paging stays open read-only (an admin viewing as the member); only answers are locked. */}
              <ActionButton primary onClick={next} disabled={status === "loading" || (locked && step === SNAPSHOT_SECTIONS.length - 1)}>
                {step === SNAPSHOT_SECTIONS.length - 1 ? "See My Starting Point" : "Continue"}
              </ActionButton>
            </div>
          </div>
        )}
      </DashboardFrame>
    </div>
  );
}
