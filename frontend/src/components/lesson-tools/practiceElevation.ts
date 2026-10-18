import type { ElevationFocus } from "./practiceSnapshot";

/**
 * My Practice Elevation dashboard (QA sheet row 103): data and rules, ported
 * from Yvette's prototype (practice-elevation-dashboard.html). Pathway copy,
 * goals, weekly tasks, statuses, the 30-day rollover and the readable plan
 * export are the prototype's. The snapshot answers live under the Practice
 * Reset Snapshot's own key (practiceSnapshot.ts) rather than in this document,
 * so the orientation lesson and the dashboard share one set of answers.
 */

export const ELEVATION_KEY = "practice-elevation-dashboard";

export interface ElevationProfile {
  name: string;
  lesson: string;
  why: string;
  goals: readonly string[];
  weeks: readonly (readonly string[])[];
}

export const PROFILES: Record<ElevationFocus, ElevationProfile> = {
  revenue: {
    name: "Revenue Restructure",
    lesson: "Module 02 — Revenue and Platform Restructure",
    why: "Evaluate effective rates, payer mix and platform concentration before making changes.",
    goals: [
      "Calculate effective collections per clinical session and identify lower-paying payer relationships",
      "Review payer/platform concentration and choose one opportunity to evaluate",
      "Develop one measurable and realistic revenue improvement action",
    ],
    weeks: [
      ["Complete your current model audit", "Record collected fees and payer mix", "Select a single priority revenue gap"],
      ["Compare rate and payer scenarios", "Review platform dependence and transition constraints", "Set a measurable improvement target"],
      ["Take one revenue restructuring action", "Track inquiries, collections or payer developments", "Document what you learn"],
      ["Compare results with baseline", "Review tradeoffs and next steps", "Prepare your next 30-day decision"],
    ],
  },
  systems: {
    name: "Systems & Operations",
    lesson: "Module 03 — Systems & Operations",
    why: "Reduce time lost to recurring administrative tasks and increase practice resilience.",
    goals: [
      "Track administrative hours and identify the largest recurring bottleneck",
      "Document one repeatable business workflow",
      "Implement or delegate one process and measure time saved",
    ],
    weeks: [
      ["Log recurring administrative tasks", "Choose one bottleneck", "Define target hours saved"],
      ["Document the existing workflow", "Design a simpler repeatable process", "Choose an appropriate tool or person"],
      ["Test the new process", "Track issues and time spent", "Improve instructions"],
      ["Measure time saved", "Document what worked", "Set the next operational priority"],
    ],
  },
  owner: {
    name: "Owner Pay & Lifestyle",
    lesson: "Module 04 — Owner Pay & Lifestyle",
    why: "Build compensation and scheduling practices that support consistent, sustainable ownership.",
    goals: [
      "Review collections, expenses and actual owner distributions",
      "Establish a proposed owner pay and reserves routine",
      "Test a sustainable weekly clinical and administrative schedule",
    ],
    weeks: [
      ["Review your business cash flow", "Calculate current owner distributions", "Review your desired working schedule"],
      ["Set an owner-pay policy to review with financial professionals", "Identify cash reserve needs", "Redesign one part of your schedule"],
      ["Test or implement one feasible change", "Track compensation and time", "Notice where the new plan feels unsustainable"],
      ["Review financial and lifestyle impact", "Refine targets", "Choose next month’s priority"],
    ],
  },
  clarity: {
    name: "Practice Clarity & Performance",
    lesson: "Module 01 — Current Model Audit",
    why: "Get a reliable starting point before making rate, staffing or operational changes.",
    goals: [
      "Complete the Current Model Audit",
      "Record the practice’s financial and operational baseline",
      "Identify the most important improvement priority for the next cycle",
    ],
    weeks: [
      ["List the numbers you currently know", "Identify what is missing", "Complete current model audit"],
      ["Fill gaps in collections and expense tracking", "Record workload and admin baseline", "Identify the largest uncertainty"],
      ["Investigate the highest-impact business gap", "Review alternatives", "Choose an actionable improvement"],
      ["Summarize findings", "Record the baseline", "Select your next priority"],
    ],
  },
};

export const FOCUS_OPTIONS: readonly { value: ElevationFocus; label: string }[] = [
  { value: "clarity", label: "Practice Clarity & Performance" },
  { value: "revenue", label: "Revenue Restructure" },
  { value: "systems", label: "Systems & Operations" },
  { value: "owner", label: "Owner Pay & Lifestyle" },
];

export const WEEK_NAMES = ["Assess & prioritize", "Restructure", "Implement & measure", "Review & elevate"] as const;

export const TASK_STATUSES = ["Not started", "In progress", "Completed", "Blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type ReviewDirection = "continue" | "advance" | "redirect";

export const METRIC_KEYS = [
  "collectionsNow",
  "collectionsGoal",
  "sessionsNow",
  "sessionsGoal",
  "adminNow",
  "adminGoal",
  "ownerNow",
  "ownerGoal",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface ElevationReview {
  wins?: string;
  blockers?: string;
  actualCollections?: string;
  actualAdmin?: string;
  direction?: ReviewDirection;
}

export interface ElevationCycle {
  cycle: number;
  start: string;
  closed: string;
  focus: ElevationFocus;
  goals: string[];
  status: TaskStatus[];
  metrics: Partial<Record<MetricKey, number>>;
  review: ElevationReview;
  notes: string;
}

export interface ElevationState {
  cycle: number;
  start: string;
  focus: ElevationFocus;
  snapshotDone: boolean;
  flags: string[];
  goals: string[];
  status: TaskStatus[];
  metrics: Partial<Record<MetricKey, number>>;
  metricsNotes: string;
  review: ElevationReview;
  history: ElevationCycle[];
}

export const today = (): string => new Date().toISOString().slice(0, 10);

const freshStatuses = (): TaskStatus[] => Array<TaskStatus>(12).fill("Not started");

export const elevationDefaults = (): ElevationState => ({
  cycle: 1,
  start: today(),
  focus: "clarity",
  snapshotDone: false,
  flags: [],
  goals: [],
  status: freshStatuses(),
  metrics: {},
  metricsNotes: "",
  review: {},
  history: [],
});

const isFocus = (v: unknown): v is ElevationFocus => typeof v === "string" && v in PROFILES;
const str = (v: unknown, max = 5000): string => (typeof v === "string" ? v.slice(0, max) : "");
const statuses = (v: unknown): TaskStatus[] => {
  const list = Array.isArray(v) ? v : [];
  return Array.from({ length: 12 }, (_, i) =>
    (TASK_STATUSES as readonly string[]).includes(list[i]) ? (list[i] as TaskStatus) : "Not started",
  );
};
const metrics = (v: unknown): Partial<Record<MetricKey, number>> => {
  const out: Partial<Record<MetricKey, number>> = {};
  if (!v || typeof v !== "object") return out;
  for (const key of METRIC_KEYS) {
    const n = (v as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isFinite(n)) out[key] = n;
  }
  return out;
};
const review = (v: unknown): ElevationReview => {
  if (!v || typeof v !== "object") return {};
  const r = v as Record<string, unknown>;
  const out: ElevationReview = {};
  if (typeof r.wins === "string") out.wins = str(r.wins);
  if (typeof r.blockers === "string") out.blockers = str(r.blockers);
  if (r.actualCollections !== undefined && r.actualCollections !== null) out.actualCollections = str(String(r.actualCollections), 40);
  if (r.actualAdmin !== undefined && r.actualAdmin !== null) out.actualAdmin = str(String(r.actualAdmin), 40);
  if (r.direction === "continue" || r.direction === "advance" || r.direction === "redirect") out.direction = r.direction;
  return out;
};

export function normaliseElevation(raw: unknown): ElevationState {
  const base = elevationDefaults();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  const focus = isFocus(src.focus) ? src.focus : base.focus;
  return {
    cycle: Math.max(1, Math.floor(Number(src.cycle) || 1)),
    start: str(src.start, 10) || base.start,
    focus,
    snapshotDone: src.snapshotDone === true,
    flags: Array.isArray(src.flags) ? src.flags.filter((f): f is string => typeof f === "string").slice(0, 10) : [],
    goals: Array.isArray(src.goals) ? src.goals.slice(0, 3).map((g) => str(g)) : [],
    status: statuses(src.status),
    metrics: metrics(src.metrics),
    metricsNotes: str(src.metricsNotes),
    review: review(src.review),
    history: Array.isArray(src.history)
      ? src.history.slice(-60).flatMap((h): ElevationCycle[] => {
          if (!h || typeof h !== "object") return [];
          const c = h as Record<string, unknown>;
          return [
            {
              cycle: Math.max(1, Math.floor(Number(c.cycle) || 1)),
              start: str(c.start, 10),
              closed: str(c.closed, 10),
              focus: isFocus(c.focus) ? c.focus : "clarity",
              goals: Array.isArray(c.goals) ? c.goals.slice(0, 3).map((g) => str(g)) : [],
              status: statuses(c.status),
              metrics: metrics(c.metrics),
              review: review(c.review),
              notes: str(c.notes),
            },
          ];
        })
      : [],
  };
}

/* --------------------------------------------------------------- actions */

/** "Generate my personalized 30-day plan" from the snapshot's pathway. */
export function generatePlan(prev: ElevationState, focus: ElevationFocus, flags: string[]): ElevationState {
  return {
    ...prev,
    focus,
    goals: [...PROFILES[focus].goals],
    status: freshStatuses(),
    snapshotDone: true,
    flags,
    start: today(),
  };
}

/** Changing pathway replaces the suggested goals and resets the tasks. */
export function changePathway(prev: ElevationState, focus: ElevationFocus): ElevationState {
  return { ...prev, focus, goals: [...PROFILES[focus].goals], status: freshStatuses(), flags: [] };
}

export function resetStatuses(prev: ElevationState): ElevationState {
  return { ...prev, status: freshStatuses() };
}

/** "Save review & start my next 30 days": archive this cycle, open the next. */
export function finishCycle(prev: ElevationState): ElevationState {
  const closed = today();
  const archived: ElevationCycle = {
    cycle: prev.cycle,
    start: prev.start,
    closed,
    focus: prev.focus,
    goals: [...prev.goals],
    status: [...prev.status],
    metrics: { ...prev.metrics },
    review: { ...prev.review },
    notes: prev.metricsNotes,
  };
  const direction = prev.review.direction || "continue";
  const switching = direction === "advance" || direction === "redirect";
  const focus: ElevationFocus = switching ? "clarity" : prev.focus;
  return {
    ...prev,
    history: [...prev.history, archived],
    cycle: prev.cycle + 1,
    start: today(),
    review: {},
    status: freshStatuses(),
    focus,
    flags: switching ? ["Choose your next pathway based on this cycle’s progress and priorities."] : prev.flags,
    goals: [...PROFILES[focus].goals],
  };
}

/* ------------------------------------------------------------- derived */

export const completedTasks = (s: { status: readonly string[] }): number => s.status.filter((x) => x === "Completed").length;

export function nextMove(s: ElevationState): string {
  if (!s.snapshotDone) return "Complete your Snapshot";
  const p = PROFILES[s.focus];
  return p.weeks.flat().find((_, i) => s.status[i] !== "Completed") || "Review this cycle";
}

export const money = (n: unknown): string =>
  n !== "" && n !== undefined && n !== null && Number.isFinite(Number(n)) ? `$${Math.round(Number(n)).toLocaleString()}` : "—";

export function collectionsDelta(m: Partial<Record<MetricKey, number>>): string {
  return m.collectionsNow !== undefined && m.collectionsGoal !== undefined
    ? `Target difference: ${money(m.collectionsGoal - m.collectionsNow)} (not a guarantee of achievable collections)`
    : "Enter your baseline and target to compare.";
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const METRIC_LABELS: Record<MetricKey, string> = {
  collectionsNow: "Monthly collections — current / baseline",
  collectionsGoal: "Monthly collections — 30-day target",
  sessionsNow: "Current completed sessions/week",
  sessionsGoal: "Preferred sustainable sessions/week",
  adminNow: "Current unpaid admin hours/week",
  adminGoal: "Target admin hours/week",
  ownerNow: "Current monthly owner distributions",
  ownerGoal: "Target monthly owner distributions",
};

/** Body of "Download readable 30-day plan (.html)" and of the printout. */
export function planReportBody(s: ElevationState): string {
  const p = PROFILES[s.focus];
  const metricRows = METRIC_KEYS.filter((k) => s.metrics[k] !== undefined)
    .map((k) => `<p>${esc(METRIC_LABELS[k])}: ${esc(s.metrics[k])}</p>`)
    .join("");
  return `<small>BOSS CLINICIAN LOUNGE · PRACTICE ELEVATION</small><h1>My 30-Day Growth Plan</h1><p>Cycle ${s.cycle} · Started ${esc(s.start)}</p><h2>${esc(p.name)}</h2><p>${esc(p.why)}</p><section><h2>Three priority outcomes</h2><ol>${s.goals
    .map((g) => `<li>${esc(g)}</li>`)
    .join("")}</ol></section><section><h2>Weekly actions</h2>${p.weeks
    .map(
      (tasks, i) =>
        `<h3>Week ${i + 1}</h3><ul>${tasks.map((t, j) => `<li>${esc(t)} — ${esc(s.status[i * 3 + j])}</li>`).join("")}</ul>`,
    )
    .join("")}</section><section><h2>Practice numbers</h2>${metricRows}<p>${esc(s.metricsNotes)}</p></section><section><h2>Cycle review</h2><p>Wins: ${esc(
    s.review.wins,
  )}</p><p>Challenges: ${esc(s.review.blockers)}</p></section><p><small>Practice planning estimates; not legal, tax, clinical, or financial advice.</small></p>`;
}
