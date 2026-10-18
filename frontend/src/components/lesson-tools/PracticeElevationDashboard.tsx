import { useRef, useState } from "react";
import {
  ActionButton,
  AreaField,
  Callout,
  DashboardFrame,
  Grid,
  NumField,
  Panel,
  Pill,
  ProgressBar,
  RestoreButton,
  SelectField,
  TabBar,
  TextField,
  Tile,
  downloadFile,
  printReport,
  reportDocument,
} from "./DashboardKit";
import {
  ELEVATION_KEY,
  FOCUS_OPTIONS,
  PROFILES,
  TASK_STATUSES,
  WEEK_NAMES,
  changePathway,
  collectionsDelta,
  completedTasks,
  elevationDefaults,
  finishCycle,
  generatePlan,
  money,
  nextMove,
  normaliseElevation,
  planReportBody,
  resetStatuses,
  type ElevationState,
  type MetricKey,
  type ReviewDirection,
  type TaskStatus,
} from "./practiceElevation";
import {
  SNAPSHOT_KEY,
  answersFromPrototype,
  isComplete,
  normaliseSnapshot,
  scoreAnswers,
  snapshotDefaults,
  snapshotPathway,
} from "./practiceSnapshot";
import { SnapshotQuestions, scrollToMissing } from "./PracticeResetSnapshot";
import { useToolState } from "./useToolState";
import type { ElevationFocus } from "./practiceSnapshot";
import { cn } from "@/lib/cn";

/**
 * My Practice Elevation Dashboard (QA sheet row 103), a lesson in the Practice
 * Elevation orientation module. A native port of Yvette's prototype: Overview,
 * Practice Reset Snapshot, 30-Day Plan, Numbers & Goals, Monthly Review and
 * Growth History & Export, with the same pathways, goals, weekly tasks,
 * statuses and 30-day rollover (practiceElevation.ts).
 *
 * The snapshot answers are the Practice Reset Snapshot lesson's own saved
 * answers (row 101), so a member who took it in the previous lesson finds it
 * already filled in here and only has to generate the plan.
 */

type Page = "home" | "snapshot" | "plan" | "metrics" | "review" | "history";

const PAGES: readonly { id: Page; label: string }[] = [
  { id: "home", label: "▦ Overview" },
  { id: "snapshot", label: "◈ Practice Reset Snapshot" },
  { id: "plan", label: "☑ My 30-Day Plan" },
  { id: "metrics", label: "▥ Numbers & Goals" },
  { id: "review", label: "↻ Monthly Review" },
  { id: "history", label: "▤ Growth History & Export" },
];

const PAGE_TITLES: Record<Page, string> = {
  home: "Welcome back to your practice.",
  snapshot: "Practice Reset Snapshot",
  plan: "My 30-Day Growth Plan",
  metrics: "My Practice Numbers",
  review: "My 30-Day Elevation Review",
  history: "My Growth History & Exports",
};

const PAGE_SUBS: Record<Page, string> = {
  home: "One clear priority, three meaningful outcomes, and focused action every 30 days.",
  snapshot: "12 questions · Approximately 10 minutes. Your answers identify your first focus; you can edit the suggested plan afterward.",
  plan: "Three focused outcomes, organized into four implementation weeks. Your goals are editable.",
  metrics: "Track a simple, measurable baseline against this month's goal. These are business indicators, not client records.",
  review: "At the end of your cycle, reflect on what changed. Your previous plan stays in your growth history.",
  history: "Review previous cycles and keep a copy of your work when you leave the Lounge.",
};

const DIRECTION_OPTIONS: readonly { value: ReviewDirection; label: string }[] = [
  { value: "continue", label: "Continue — make more progress on this area" },
  { value: "advance", label: "Advance — choose a different area" },
  { value: "redirect", label: "Redirect — address a more urgent issue" },
];

export function PracticeElevationDashboard() {
  const dash = useToolState(ELEVATION_KEY, elevationDefaults, normaliseElevation);
  const snap = useToolState(SNAPSHOT_KEY, snapshotDefaults, normaliseSnapshot);
  const [page, setPage] = useState<Page>("home");
  const [warn, setWarn] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const snapRoot = useRef<HTMLDivElement>(null);

  const state = dash.state;
  const setState = dash.setState;
  const p = PROFILES[state.focus];
  const done = completedTasks(state);
  const snapshotReady = isComplete(snap.state.answers);

  const go = (next: Page) => {
    setPage(next);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const generate = () => {
    if (!snapshotReady) {
      setWarn(true);
      window.alert("Please answer Snapshot questions 1 to 11 (question 12 is optional).");
      scrollToMissing(snapRoot.current, snap.state.answers);
      return;
    }
    setWarn(false);
    const pathway = snapshotPathway(snap.state.answers);
    setState((prev) => generatePlan(prev, pathway.focus, pathway.flags));
    // Record the snapshot result too, so the orientation lesson shows it.
    if (!snap.state.result) {
      snap.setState((prev) => ({ ...prev, result: scoreAnswers(prev.answers), completedAt: new Date().toISOString() }));
    }
    go("plan");
  };

  const setMetric = (key: MetricKey) => (value: number | null) =>
    setState((prev) => {
      const metrics = { ...prev.metrics };
      if (value === null) delete metrics[key];
      else metrics[key] = value;
      return { ...prev, metrics };
    });

  const setReview = <K extends keyof ElevationState["review"]>(key: K, value: ElevationState["review"][K]) =>
    setState((prev) => ({ ...prev, review: { ...prev.review, [key]: value } }));

  const backup = () =>
    downloadFile(
      "boss-clinician-practice-elevation-backup.json",
      JSON.stringify({ ...state, snapshot: snap.state }, null, 2),
      "application/json",
    );

  const restore = (obj: unknown) => {
    try {
      const o = obj as Record<string, unknown> | undefined;
      if (!o || !Array.isArray(o.history) || typeof o.focus !== "string" || !(o.focus in PROFILES)) {
        throw new Error("Not a valid Practice Elevation backup");
      }
      if (!window.confirm("Restore this backup and replace your current dashboard data?")) return;
      setState(normaliseElevation(o));
      // This site's backups carry the snapshot as `snapshot`; the standalone
      // prototype's carried `answers` as a 12-item array.
      if (o.snapshot) snap.setState(normaliseSnapshot(o.snapshot));
      else {
        const legacy = answersFromPrototype(o.answers);
        if (legacy && Object.keys(legacy.answers).length > 0) snap.setState(normaliseSnapshot({ ...legacy }));
      }
      go("home");
    } catch (err) {
      window.alert(`Could not restore this file: ${err instanceof Error ? err.message : "unreadable file"}`);
    }
  };

  const ready = dash.ready && snap.ready;
  // One indicator for both documents: the worse of the two.
  const status = [dash.status, snap.status].find((s) => s === "offline" || s === "error" || s === "saving") ?? dash.status;

  return (
    <div ref={top} className="scroll-mt-24">
      <DashboardFrame
        eyebrow="Boss Clinician Lounge · Practice Elevation"
        title={page === "home" ? "My Practice Elevation Dashboard" : PAGE_TITLES[page]}
        subtitle={page === "home" ? "Your practice. Your priorities. Your next 30 days." : PAGE_SUBS[page]}
        status={status}
        savedAt={dash.savedAt}
        actions={
          <>
            <Pill>Cycle {state.cycle}</Pill>
            <Pill>Personal Growth Plan</Pill>
          </>
        }
        footer="© Boss Clinician · Practice Elevation · Educational business planning, not legal, tax or financial advice."
      >
        {!ready ? (
          <p className="text-sm text-orchid-dim">Loading your dashboard…</p>
        ) : (
          <>
            <TabBar label="Dashboard pages" tabs={PAGES} active={page} onChange={go} />

            {page === "home" && (
              <>
                <h3 className="font-display text-xl text-white">{PAGE_TITLES.home}</h3>
                <p className="-mt-3 text-sm text-orchid">{PAGE_SUBS.home}</p>
                <Grid cols={4}>
                  <Tile label="Current focus" value={state.snapshotDone ? p.name : "Take your Snapshot"} />
                  <Tile label="Goals completed" value={`${done} / 12 tasks`} />
                  <Tile label="Monthly collections goal" value={state.metrics.collectionsGoal !== undefined ? money(state.metrics.collectionsGoal) : "—"} />
                  <Tile label="Preferred sessions/week" value={state.metrics.sessionsGoal ?? "—"} />
                </Grid>
                <Panel title="30-Day progress">
                  <ProgressBar percent={(done / 12) * 100} label="30-day progress" />
                  <p className="text-xs text-orchid-dim">
                    {state.snapshotDone
                      ? `Cycle ${state.cycle} · ${done} of 12 implementation tasks complete. The three outcomes can be edited in your plan.`
                      : snapshotReady
                        ? "Your Practice Reset Snapshot answers are saved. Generate your personalized first cycle from them."
                        : "Start with the Practice Reset Snapshot to generate your personalized first cycle."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {!state.snapshotDone && snapshotReady ? (
                      <ActionButton primary onClick={generate}>Generate my personalized 30-day plan →</ActionButton>
                    ) : (
                      <ActionButton primary onClick={() => go("snapshot")}>Open Practice Reset Snapshot →</ActionButton>
                    )}
                    <ActionButton onClick={() => go("plan")}>View my growth plan</ActionButton>
                  </div>
                </Panel>
                <Grid>
                  <Panel eyebrow="Your recommended next move" title={nextMove(state)}>
                    <p className="text-sm text-orchid">
                      {state.snapshotDone ? p.why : "Your answers identify the most useful starting point for your practice."}
                    </p>
                    <p className="text-xs text-orchid-dim">
                      Course connection: {state.snapshotDone ? p.lesson : "Module 01 — Current Model Audit"}
                    </p>
                  </Panel>
                  <Panel eyebrow="Your monthly rhythm">
                    <ul className="flex flex-col gap-1.5 text-sm text-orchid">
                      {WEEK_NAMES.map((name, i) => (
                        <li key={name}>
                          <strong className="text-white">Week {i + 1}:</strong> {name}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </Grid>
                <Callout tone="sage">
                  The Practice Elevation is for clinicians improving an existing practice. Your snapshot, tasks, and progress are private to your own account. Do not enter client-identifying health information.
                </Callout>
              </>
            )}

            {page === "snapshot" && (
              <div ref={snapRoot} className="flex flex-col gap-5">
                {snap.state.completedAt && (
                  <Callout tone="sage">
                    These are your saved Practice Reset Snapshot answers from the orientation lesson. Change any answer here and regenerate your plan when your practice changes.
                  </Callout>
                )}
                <SnapshotQuestions
                  state={snap.state}
                  warn={warn}
                  onChange={(next) => {
                    snap.setState(next);
                    if (warn && isComplete(next.answers)) setWarn(false);
                  }}
                />
                <div>
                  <ActionButton primary onClick={generate}>Generate my personalized 30-day plan</ActionButton>
                </div>
                <p className="text-xs text-orchid-dim">
                  The Snapshot is intended for initial onboarding and major practice changes. Your monthly review is shorter.
                </p>
              </div>
            )}

            {page === "plan" && (
              <>
                <Panel eyebrow="Current pathway" title={state.snapshotDone ? p.name : "Take the Snapshot first"}>
                  {state.snapshotDone && (
                    <p className="text-sm text-orchid">{p.why + (state.flags.length ? ` ${state.flags.join(" ")}` : "")}</p>
                  )}
                  <Grid>
                    <SelectField
                      label="My primary focus"
                      value={state.focus}
                      options={FOCUS_OPTIONS}
                      onChange={(focus: ElevationFocus) => {
                        if (focus === state.focus) return;
                        if (!window.confirm("Change your pathway and replace the suggested goals and weekly tasks for this cycle?")) return;
                        setState((prev) => changePathway(prev, focus));
                      }}
                    />
                    <TextField type="date" label="Cycle start date" value={state.start} onChange={(v) => setState((prev) => ({ ...prev, start: v }))} />
                  </Grid>
                  <Callout tone="sage">Recommended course connection: {p.lesson}</Callout>
                </Panel>
                <Panel title="My three outcomes" intro="You can personalize these suggested outcomes; plan tasks update when you change pathways.">
                  {state.goals.length === 0 && <p className="text-sm text-orchid-dim">Generate your plan from the Snapshot to see your suggested outcomes.</p>}
                  {state.goals.map((goal, i) => (
                    <AreaField
                      key={i}
                      label={`Outcome ${i + 1}`}
                      value={goal}
                      onChange={(v) => setState((prev) => ({ ...prev, goals: prev.goals.map((g, at) => (at === i ? v : g)) }))}
                    />
                  ))}
                </Panel>
                <Panel title="Weekly action tracker">
                  {p.weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-2">
                      <h4 className="text-sm font-semibold text-white">
                        Week {wi + 1} — {WEEK_NAMES[wi]}
                      </h4>
                      {week.map((task, ti) => {
                        const ix = wi * 3 + ti;
                        const value = state.status[ix];
                        return (
                          <div
                            key={ix}
                            className={cn(
                              "flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
                              value === "Completed" ? "border-[#547376]/60 bg-[#547376]/[0.12]" : "border-white/10 bg-white/[0.03]",
                            )}
                          >
                            <strong className="flex-1 text-sm font-semibold text-white">{task}</strong>
                            <select
                              aria-label={`Status: ${task}`}
                              value={value}
                              onChange={(e) =>
                                setState((prev) => ({
                                  ...prev,
                                  status: prev.status.map((s, at) => (at === ix ? (e.target.value as TaskStatus) : s)),
                                }))
                              }
                              className="min-h-[2.5rem] rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white sm:w-40 [&>option]:bg-night-raised [&>option]:text-ink"
                            >
                              {TASK_STATUSES.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div>
                    <ActionButton
                      onClick={() => {
                        if (window.confirm("Reset this cycle’s task statuses?")) setState(resetStatuses);
                      }}
                    >
                      Reset statuses for this cycle
                    </ActionButton>
                  </div>
                </Panel>
              </>
            )}

            {page === "metrics" && (
              <>
                <Grid>
                  <Panel title="Monthly collections">
                    <NumField label="Current / baseline ($)" value={state.metrics.collectionsNow} onChange={setMetric("collectionsNow")} />
                    <NumField label="30-day target ($)" value={state.metrics.collectionsGoal} onChange={setMetric("collectionsGoal")} />
                    <p className="text-xs text-orchid-dim">{collectionsDelta(state.metrics)}</p>
                  </Panel>
                  <Panel title="Average sessions per week">
                    <NumField label="Current completed sessions/week" value={state.metrics.sessionsNow} onChange={setMetric("sessionsNow")} />
                    <NumField label="Preferred sustainable sessions/week" value={state.metrics.sessionsGoal} onChange={setMetric("sessionsGoal")} />
                    <p className="text-xs text-orchid-dim">More sessions are not automatically better. Choose a schedule you want to sustain.</p>
                  </Panel>
                  <Panel title="Administration time">
                    <NumField label="Current unpaid admin hours/week" value={state.metrics.adminNow} onChange={setMetric("adminNow")} />
                    <NumField label="Target admin hours/week" value={state.metrics.adminGoal} onChange={setMetric("adminGoal")} />
                  </Panel>
                  <Panel title="Consistent owner pay">
                    <NumField label="Current monthly owner distributions ($)" value={state.metrics.ownerNow} onChange={setMetric("ownerNow")} />
                    <NumField label="Target monthly owner distributions ($)" value={state.metrics.ownerGoal} onChange={setMetric("ownerGoal")} />
                    <p className="text-xs text-orchid-dim">Owner pay differs from collections. Consider expenses, taxes, and reserves before setting a target.</p>
                  </Panel>
                </Grid>
                <Panel title="My practice improvement notes">
                  <AreaField
                    label="What is creating the biggest gap today?"
                    value={state.metricsNotes}
                    onChange={(v) => setState((prev) => ({ ...prev, metricsNotes: v }))}
                    placeholder="E.g., lower-paying payer contracts, admin bottlenecks, unpredictable inquiries..."
                  />
                </Panel>
              </>
            )}

            {page === "review" && (
              <Panel>
                <Grid>
                  <AreaField label="What improved this month?" value={state.review.wins ?? ""} onChange={(v) => setReview("wins", v)} placeholder="Results, wins, discoveries..." />
                  <AreaField label="What remains difficult?" value={state.review.blockers ?? ""} onChange={(v) => setReview("blockers", v)} placeholder="Barriers, resources, decisions..." />
                </Grid>
                <Grid>
                  <NumField
                    label="Actual monthly collections ($) — optional"
                    value={state.review.actualCollections ? Number(state.review.actualCollections) : null}
                    onChange={(v) => setReview("actualCollections", v === null ? undefined : String(v))}
                  />
                  <NumField
                    label="Actual weekly admin hours — optional"
                    value={state.review.actualAdmin ? Number(state.review.actualAdmin) : null}
                    onChange={(v) => setReview("actualAdmin", v === null ? undefined : String(v))}
                  />
                </Grid>
                <SelectField
                  label="What should happen next?"
                  value={state.review.direction ?? "continue"}
                  options={DIRECTION_OPTIONS}
                  onChange={(v) => setReview("direction", v)}
                />
                <Callout tone="gold">
                  Closing a cycle archives its goals, tasks, metrics, and review, then starts a new 30-day cycle. This does not automatically change your course access or subscription.
                </Callout>
                <div>
                  <ActionButton
                    primary
                    onClick={() => {
                      if (!state.snapshotDone) {
                        window.alert("Complete the Snapshot before closing a cycle.");
                        return;
                      }
                      if (!window.confirm("Archive the current cycle and start a new 30-day plan?")) return;
                      setState(finishCycle);
                      go("plan");
                    }}
                  >
                    Save review & start my next 30 days →
                  </ActionButton>
                </div>
              </Panel>
            )}

            {page === "history" && (
              <>
                <Panel title="Completed growth cycles">
                  {state.history.length ? (
                    [...state.history].reverse().map((h, i) => (
                      <div key={`${h.cycle}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                        <strong className="text-sm font-semibold text-white">
                          Cycle {h.cycle} — {PROFILES[h.focus]?.name || h.focus}
                        </strong>
                        <p className="mt-0.5 text-xs text-orchid-dim">
                          Started {h.start} · Closed {h.closed} ·{" "}
                          <span className="font-body font-bold tabular-nums">{completedTasks(h)}/12</span> tasks completed
                        </p>
                        <p className="mt-2 text-sm text-orchid">{h.review?.wins || "No wins recorded"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-orchid-dim">Your completed cycles will appear here.</p>
                  )}
                </Panel>
                <Panel title="Take your plan with you">
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      icon="download"
                      primary
                      onClick={() =>
                        downloadFile("my-practice-elevation-plan.html", reportDocument("My Practice Elevation Plan", planReportBody(state)), "text/html")
                      }
                    >
                      Download readable 30-day plan (.html)
                    </ActionButton>
                    <ActionButton icon="download" onClick={backup}>Download full data backup (.json)</ActionButton>
                    <ActionButton icon="print" onClick={() => printReport("My Practice Elevation Plan", planReportBody(state))}>
                      Print / Save as PDF
                    </ActionButton>
                    <RestoreButton onFile={restore}>Restore a data backup</RestoreButton>
                  </div>
                  <p className="text-xs text-orchid-dim">
                    Your dashboard saves to your account automatically. The printable report and data backup are yours to keep after the program; restoring a backup replaces what is saved here.
                  </p>
                </Panel>
              </>
            )}
          </>
        )}
      </DashboardFrame>
    </div>
  );
}
