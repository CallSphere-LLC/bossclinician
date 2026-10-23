/**
 * The Practice Reset Snapshot, membership edition (QA sheet rows 158 + 170):
 * the owner's standalone package "Practice_Reset_Snapshot_CallSphere"
 * (index.html + DEVELOPER_README.md), as data and pure functions.
 *
 * Questions and choices are hers verbatim (the original 12 JotForm questions;
 * Q11 now reads "in the next 30 days"). The scoring is her prototype's
 * `buildResult()`; what this file adds is the README's routing table resolved to
 * the real modules and lessons of The Practice Elevation (course 61), so the
 * results page can name — and open — the module and the specific lesson.
 *
 * Saved per member under tool key `practice-reset-snapshot-v2`
 * (useVersionedToolState → member_tool_state). The Practice Elevation dashboard
 * reads the same document to prefill its first plan, so the top-level field
 * names below are a contract: see `SnapshotV2State`.
 */

export const SNAPSHOT_V2_KEY = "practice-reset-snapshot-v2";
export const ASSESSMENT_VERSION = "membership_12_question_30_day";

/** Lesson 316, the separate Growth Dashboard the results hand over to. */
export const DASHBOARD_LESSON = { id: 316, slug: "my-practice-elevation-dashboard", title: "My Practice Elevation Dashboard" } as const;

/* ---------------------------------------------------------------- questions */

export interface SnapshotQuestionV2 {
  id: number;
  prompt: string;
  /** Four choices, A–D, saved as their index 0–3. Absent for the free-text Q12. */
  options?: readonly string[];
}

export interface SnapshotSectionV2 {
  title: string;
  questions: readonly SnapshotQuestionV2[];
}

export const SNAPSHOT_SECTIONS: readonly SnapshotSectionV2[] = [
  {
    title: "Your Practice Today",
    questions: [
      { id: 1, prompt: "Which best describes your practice right now?", options: ["Fully booked or close to it, with a waitlist or steady inquiries", "Mostly full, but my caseload has ups and downs I cannot predict", "Full on paper, but a lot of my slots are low-paying or misaligned clients", "I have room in my caseload and want more clients"] },
      { id: 2, prompt: "How many clinical sessions do you personally deliver in a typical week?", options: ["Under 15", "15 to 22", "23 to 28", "29 or more"] },
      { id: 3, prompt: "When you think about your current session load, which is most true?", options: ["It is sustainable. I could do this for years.", "It is manageable, but I have no margin for anything unexpected.", "I am tired most weeks and running on willpower.", "I am past my limit and something has to change soon."] },
    ],
  },
  {
    title: "Your Income",
    questions: [
      { id: 4, prompt: "Do you know your real effective hourly rate? (What you actually keep per clinical hour after platform cuts, billing costs, and unpaid admin time.)", options: ["Yes, I know the exact number", "I have a rough idea", "No, but I know what I bill", "No, and I avoid looking at my numbers"] },
      { id: 5, prompt: "What percentage of your income comes from insurance panels or platforms (Alma, Headway, Grow, Rula, etc.)?", options: ["0 to 25 percent", "26 to 50 percent", "51 to 75 percent", "76 to 100 percent"] },
      { id: 6, prompt: "When did you last raise your private pay rate?", options: ["Within the last 12 months", "1 to 2 years ago", "More than 2 years ago", "I have never raised it, or I do not have a private pay rate"] },
      { id: 7, prompt: "At the end of a typical month, which is most true about your income?", options: ["I pay myself a consistent salary and the practice holds a buffer", "I take what is left over, and the amount changes month to month", "I cover my bills, but there is nothing consistent left for me", "Some months I put my own money into the practice to keep it going"] },
    ],
  },
  {
    title: "Your Systems",
    questions: [
      { id: 8, prompt: "How many hours per week do you spend on unpaid admin (billing, claims, scheduling, messages, paperwork)?", options: ["Under 3 hours", "3 to 7 hours", "8 to 12 hours", "More than 12 hours"] },
      { id: 9, prompt: "If you took two full weeks off tomorrow, what would happen to your practice?", options: ["It would run. My systems and support would hold things down.", "It would mostly hold, but a few things would pile up.", "Things would fall through the cracks. Nothing runs without me.", "I honestly cannot imagine taking two full weeks off."] },
      { id: 10, prompt: "Who handles your billing and admin?", options: ["A biller, admin, or VA handles most of it", "Software automation handles most of it, I handle the rest", "I do all of it myself, but it is organized", "I do all of it myself, and it is held together by memory and late nights"] },
    ],
  },
  {
    title: "Your Direction",
    questions: [
      { id: 11, prompt: "What is the ONE area of your practice you would most like to make meaningful progress on in the next 30 days?", options: ["Getting paid what my work is actually worth (rates, panels, platforms)", "Getting the operations off my plate (systems, billing, admin, hiring support)", "Paying myself consistently and taking real time off", "Getting clear on my numbers so I know what to fix first"] },
      { id: 12, prompt: "Complete this sentence honestly: “I built a full practice, and…”" },
    ],
  },
];

export const SNAPSHOT_QUESTIONS_V2: readonly SnapshotQuestionV2[] = SNAPSHOT_SECTIONS.flatMap((s) => s.questions);
export const CHOICE_LABELS = ["A", "B", "C", "D"] as const;
export const NARRATIVE_MAX = 1500;

/** "1"–"11" → choice index 0–3 (0 = A … 3 = D); "12" → the member's own words. */
export type SnapshotAnswers = Record<string, number | string>;

/* ------------------------------------------------------------- course map */

export type CourseSection = "Module 01" | "Module 02" | "Module 03" | "Module 04";

export interface CourseModuleRef {
  id: number;
  title: string;
  /** The course section the module sits under, as the README names it. */
  section: CourseSection;
}

export interface CourseLessonRef {
  id: number;
  slug: string;
  title: string;
  moduleId: number;
}

/**
 * The Practice Elevation's modules and lessons the routing points at, as they
 * are in course 61 on 23 Oct 2026 (course_modules / course_lessons). Ids are the
 * stable reference saved with a member's result; the slug is how the course
 * player opens the lesson.
 */
export const COURSE_MODULES: Readonly<Record<number, CourseModuleRef>> = {
  56: { id: 56, title: "Find Out What Your Practice Is Actually Producing", section: "Module 01" },
  62: { id: 62, title: "Stop Letting Fear Set Your Rate | Let Your Numbers Do It", section: "Module 02" },
  63: { id: 63, title: "Find Out Which Insurance Panels Are Worth Keeping", section: "Module 02" },
  64: { id: 64, title: "Get Clients Off Platforms That Are Underpaying You", section: "Module 02" },
  71: { id: 71, title: "Get Billing and Admin Off Your Plate", section: "Module 03" },
  72: { id: 72, title: "Build Systems So Nothing Falls Apart When You Step Back", section: "Module 03" },
  73: { id: 73, title: "Choose the Right Tools Without Overpaying for Platforms You Don't Need", section: "Module 03" },
  78: { id: 78, title: "Pay Yourself Consistently | Not Just When the Account Looks Good", section: "Module 04" },
};

export const COURSE_LESSONS: Readonly<Record<number, CourseLessonRef>> = {
  146: { id: 146, moduleId: 56, slug: "what-your-practice-is-really-paying-you", title: "What Your Practice Is Really Paying You" },
  147: { id: 147, moduleId: 56, slug: "current-model-audit-worksheet", title: "Current Model Audit Worksheet" },
  162: { id: 162, moduleId: 62, slug: "how-to-raise-your-rate-based-on-what-the-audit-showed-you", title: "How to Raise Your Rate Based on What the Audit Showed You" },
  163: { id: 163, moduleId: 62, slug: "raise-your-rate-guide", title: "Raise Your Rate Guide" },
  165: { id: 165, moduleId: 63, slug: "what-each-panel-is-actually-paying-you-per-hour", title: "What Each Panel Is Actually Paying You Per Hour" },
  166: { id: 166, moduleId: 63, slug: "insurance-panel-audit-tracker", title: "Insurance Panel Audit Tracker" },
  169: { id: 169, moduleId: 64, slug: "what-it-actually-takes-to-leave-a-platform-without-your-caseload-collapsing", title: "What It Actually Takes to Leave a Platform Without Your Caseload Collapsing" },
  170: { id: 170, moduleId: 64, slug: "platform-exit-roadmap-step-by-step-timeline", title: "Platform Exit Roadmap | Step-by-Step Timeline" },
  191: { id: 191, moduleId: 71, slug: "what-to-automate-what-to-delegate-what-only-you-can-do", title: "What to Automate, What to Delegate, What Only You Can Do" },
  192: { id: 192, moduleId: 71, slug: "ehr-and-billing-audit-checklist", title: "EHR and Billing Audit Checklist" },
  193: { id: 193, moduleId: 71, slug: "is-it-time-to-hire-a-biller-or-admin-how-to-know-you-re-ready", title: "Is It Time to Hire a Biller or Admin? | How to Know You're Ready" },
  196: { id: 196, moduleId: 72, slug: "sop-template-pack", title: "SOP Template Pack" },
  197: { id: 197, moduleId: 73, slug: "the-systems-stack-that-works-for-a-solo-or-small-practice", title: "The Systems Stack That Works for a Solo or Small Practice" },
  198: { id: 198, moduleId: 73, slug: "systems-stack-recommendation-guide", title: "Systems Stack Recommendation Guide" },
  211: { id: 211, moduleId: 78, slug: "why-most-practice-owners-don-t-pay-themselves", title: "Why Most Practice Owners Don't Pay Themselves" },
  212: { id: 212, moduleId: 78, slug: "pay-yourself-salary-planning-worksheet", title: "Pay Yourself Salary Planning Worksheet" },
};

/* --------------------------------------------------------------- pathways */

export type PathwayName = "Revenue Restructure" | "Systems & Operations" | "Owner Pay & Lifestyle" | "Practice Clarity & Performance";
/** The Practice Elevation dashboard's focus keys for the same four pathways. */
export type FocusKey = "revenue" | "systems" | "owner" | "clarity";

export const PATHWAYS: Readonly<Record<FocusKey, { name: PathwayName; section: CourseSection; focus: string }>> = {
  revenue: { name: "Revenue Restructure", section: "Module 02", focus: "Evaluate rates, payers, and how your current practice model produces income." },
  systems: { name: "Systems & Operations", section: "Module 03", focus: "Identify the operations consuming your time and choose one workflow to improve." },
  owner: { name: "Owner Pay & Lifestyle", section: "Module 04", focus: "Review compensation consistency, buffers, and your ability to take time off." },
  clarity: { name: "Practice Clarity & Performance", section: "Module 01", focus: "Complete the Current Model Audit before choosing a structural change." },
};

/** Q11 A/B/C/D → Module 02 / 03 / 04 / 01 (README "Routing and QA"). */
const FOCUS_BY_Q11: readonly FocusKey[] = ["revenue", "systems", "owner", "clarity"];

export const PATHWAY_NAMES: readonly PathwayName[] = (Object.keys(PATHWAYS) as FocusKey[]).map((k) => PATHWAYS[k].name);
export const focusOf = (name: PathwayName): FocusKey => (Object.keys(PATHWAYS) as FocusKey[]).find((k) => PATHWAYS[k].name === name) ?? "clarity";

/* ------------------------------------------------------------------ flags */

export type FlagId = "financial_clarity" | "payer_dependency" | "rate_review" | "owner_pay" | "systems_gap";
export const FLAG_IDS: readonly FlagId[] = ["financial_clarity", "payer_dependency", "rate_review", "owner_pay", "systems_gap"];

export const FLAG_COPY: Readonly<Record<FlagId, { label: string; why: string }>> = {
  financial_clarity: { label: "Complete the Current Model Audit", why: "Your responses suggest your effective clinical earnings need clarification." },
  payer_dependency: { label: "Review insurance and platform dependence", why: "A substantial share of your revenue comes from panels or platforms." },
  rate_review: { label: "Evaluate your private-pay rate", why: "Your private-pay rate may need a strategic review." },
  owner_pay: { label: "Review owner pay and reserves", why: "Your responses suggest inconsistent owner compensation or a limited financial buffer." },
  systems_gap: { label: "Improve your systems and delegation plan", why: "Administrative time or owner dependence appears to be limiting sustainability." },
};

const choice = (answers: SnapshotAnswers, question: number): number | null => {
  const v = answers[String(question)];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
};

/** Answered C or D — the prototype's `a[k] >= 2`. */
const heavy = (answers: SnapshotAnswers, question: number): boolean => (choice(answers, question) ?? -1) >= 2;

export function snapshotFlags(answers: SnapshotAnswers): FlagId[] {
  const flags: FlagId[] = [];
  if (heavy(answers, 4)) flags.push("financial_clarity");
  if (heavy(answers, 5)) flags.push("payer_dependency");
  if (heavy(answers, 6)) flags.push("rate_review");
  if (heavy(answers, 7)) flags.push("owner_pay");
  if ([8, 9, 10].some((q) => heavy(answers, q))) flags.push("systems_gap");
  return flags;
}

/** What the member picked in Q11. */
export const selfIdentifiedFocus = (answers: SnapshotAnswers): FocusKey => FOCUS_BY_Q11[choice(answers, 11) ?? 3];

/** Q4 C/D sends everyone to the Current Model Audit first; otherwise Q11 decides. */
export const recommendedFocus = (answers: SnapshotAnswers): FocusKey => (heavy(answers, 4) ? "clarity" : selfIdentifiedFocus(answers));

/* ---------------------------------------------------------------- routing */

export interface RouteTarget {
  /** The module that holds the first lesson. */
  moduleId: number;
  /** In reading order; the first is "start here". */
  lessonIds: number[];
}

const target = (...lessonIds: number[]): RouteTarget => ({ moduleId: COURSE_LESSONS[lessonIds[0]].moduleId, lessonIds });

/** The systems lessons a member's own answers point at: Q8 admin hours, Q10 who does billing, Q9 two weeks off. */
function systemsLessons(answers: SnapshotAnswers): number[] {
  const lessons: number[] = [];
  if (heavy(answers, 8)) lessons.push(191);
  if (heavy(answers, 10)) lessons.push(193);
  if (heavy(answers, 9)) lessons.push(196);
  return lessons;
}

/**
 * Where a pathway starts in the course, refined by the member's answers:
 * revenue → the rate module, or the panel module when the payer share is the
 * heavy answer and the rate is not; systems → the module for the heaviest
 * systems answer (Q8, then Q10, then Q9), else the systems-stack lesson the
 * dashboard already recommends.
 */
export function pathwayTarget(focus: FocusKey, answers: SnapshotAnswers): RouteTarget {
  switch (focus) {
    case "clarity":
      return target(147, 146);
    case "revenue":
      return heavy(answers, 5) && !heavy(answers, 6) ? target(165, 166) : target(162, 163);
    case "systems": {
      const lessons = systemsLessons(answers);
      if (!lessons.length) return target(197, 198);
      return target(...lessons, ...(lessons[0] === 191 || lessons[0] === 193 ? [192] : []));
    }
    case "owner":
      return target(212, 211);
  }
}

export function flagTarget(flag: FlagId, answers: SnapshotAnswers): RouteTarget {
  switch (flag) {
    case "financial_clarity":
      return target(147, 146);
    case "payer_dependency":
      // Q5 asks about panels and platforms together, so both modules.
      return target(165, 169);
    case "rate_review":
      return target(162, 163);
    case "owner_pay":
      return target(212, 211);
    case "systems_gap": {
      const lessons = systemsLessons(answers);
      return lessons.length ? target(...lessons) : target(197);
    }
  }
}

export interface SnapshotRecommendation {
  /** "first_audit" (always first, as in the prototype) or a FlagId. */
  id: "first_audit" | FlagId;
  module_id: number;
  lesson_ids: number[];
}

/** The prototype's "Recommended next steps": the audit, then one per flag — without listing the same lesson twice. */
export function snapshotRecommendations(answers: SnapshotAnswers, flags: readonly FlagId[]): SnapshotRecommendation[] {
  const list: SnapshotRecommendation[] = [];
  const seen = new Set<number>();
  const add = (id: SnapshotRecommendation["id"], route: RouteTarget) => {
    if (seen.has(route.lessonIds[0])) return;
    route.lessonIds.forEach((l) => seen.add(l));
    list.push({ id, module_id: route.moduleId, lesson_ids: route.lessonIds });
  };
  add("first_audit", target(147, 146));
  for (const flag of flags) add(flag, flagTarget(flag, answers));
  return list;
}

/* --------------------------------------------------------------- profiles */

export type ProfileLabel = "Strong foundation" | "Classic Maxed Out profile" | "Focused restructuring opportunities";

/** Approximate labels only — not a clinical or validated score (README). */
export function snapshotProfile(answers: SnapshotAnswers): ProfileLabel {
  const scored = [4, 5, 6, 7, 8, 9, 10].map((q) => choice(answers, q));
  const aCount = scored.filter((v) => v === 0).length;
  if (aCount >= 5 && (choice(answers, 4) ?? 3) <= 1) return "Strong foundation";
  return scored.filter((v) => v === 1 || v === 2).length >= 4 ? "Classic Maxed Out profile" : "Focused restructuring opportunities";
}

/* ------------------------------------------------------------------ state */

/** One completed snapshot. */
export interface SnapshotRecord {
  assessment_version: string;
  answers: SnapshotAnswers;
  /** Pathway name; Q4 C/D overrides Q11 to "Practice Clarity & Performance". */
  recommended_pathway: PathwayName;
  /** The same pathway as a dashboard focus key. */
  recommended_focus: FocusKey;
  /** What the member chose to focus on (defaults to the recommendation; editable on the results page). */
  member_selected_priority: PathwayName;
  /** Their Q11 answer as a pathway name. */
  self_identified_priority: PathwayName;
  flags: FlagId[];
  profile: ProfileLabel;
  /**
   * The course module (course_modules.id in course 61) that holds the first
   * recommended lesson — the content module, e.g. 56 "Find Out What Your
   * Practice Is Actually Producing", not the "Mod 01" section header. The
   * section label ("Module 01") is COURSE_MODULES[id].section.
   */
  recommended_module_id: number;
  /** course_lessons.id, in reading order; the first is where to start. */
  recommended_lesson_ids: number[];
  recommendations: SnapshotRecommendation[];
  /** ISO timestamp. */
  completed_at: string;
}

/**
 * The saved document. The top level is the member's latest completed snapshot
 * (every field null / empty until the first completion — check `completed_at`),
 * so the Practice Elevation dashboard can read it directly.
 */
export interface SnapshotV2State {
  assessment_version: string;
  answers: SnapshotAnswers;
  recommended_pathway: PathwayName | null;
  recommended_focus: FocusKey | null;
  member_selected_priority: PathwayName | null;
  self_identified_priority: PathwayName | null;
  flags: FlagId[];
  profile: ProfileLabel | null;
  recommended_module_id: number | null;
  recommended_lesson_ids: number[];
  recommendations: SnapshotRecommendation[];
  completed_at: string | null;
  /** A first take or retake in progress; the completed result above stays until it is finished. */
  draft: { answers: SnapshotAnswers; step: number } | null;
  /** Earlier completed snapshots, oldest first. */
  history: SnapshotRecord[];
}

export const HISTORY_LIMIT = 40;

export const snapshotV2Defaults = (): SnapshotV2State => ({
  assessment_version: ASSESSMENT_VERSION,
  answers: {},
  recommended_pathway: null,
  recommended_focus: null,
  member_selected_priority: null,
  self_identified_priority: null,
  flags: [],
  profile: null,
  recommended_module_id: null,
  recommended_lesson_ids: [],
  recommendations: [],
  completed_at: null,
  draft: null,
  history: [],
});

/** Only the twelve answers, each of the right kind. */
export function cleanAnswers(raw: unknown): SnapshotAnswers {
  const out: SnapshotAnswers = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const q of SNAPSHOT_QUESTIONS_V2) {
    if (!Object.hasOwn(src, String(q.id))) continue;
    const v = src[String(q.id)];
    if (q.options) {
      if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < q.options.length) out[String(q.id)] = v;
    } else if (typeof v === "string") out[String(q.id)] = v.slice(0, NARRATIVE_MAX);
  }
  return out;
}

/** The first question of a section left unanswered, or null. Q12 must not be blank (as in the prototype). */
export function missingIn(section: SnapshotSectionV2, answers: SnapshotAnswers): number | null {
  for (const q of section.questions) {
    const v = answers[String(q.id)];
    if (q.options ? choice(answers, q.id) === null : typeof v !== "string" || !v.trim()) return q.id;
  }
  return null;
}

export const isSnapshotComplete = (answers: SnapshotAnswers): boolean => SNAPSHOT_SECTIONS.every((s) => missingIn(s, answers) === null);

/** Scores a complete set of answers. */
export function buildSnapshotRecord(rawAnswers: SnapshotAnswers, completedAt: string, selected?: PathwayName | null): SnapshotRecord {
  const answers = cleanAnswers(rawAnswers);
  const focus = recommendedFocus(answers);
  const flags = snapshotFlags(answers);
  const route = pathwayTarget(focus, answers);
  return {
    assessment_version: ASSESSMENT_VERSION,
    answers,
    recommended_pathway: PATHWAYS[focus].name,
    recommended_focus: focus,
    member_selected_priority: selected && PATHWAY_NAMES.includes(selected) ? selected : PATHWAYS[focus].name,
    self_identified_priority: PATHWAYS[selfIdentifiedFocus(answers)].name,
    flags,
    profile: snapshotProfile(answers),
    recommended_module_id: route.moduleId,
    recommended_lesson_ids: route.lessonIds,
    recommendations: snapshotRecommendations(answers, flags),
    completed_at: completedAt,
  };
}

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** A saved record re-scored from its answers, so stored routing can never drift from the code. */
function cleanRecord(raw: unknown): SnapshotRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const answers = cleanAnswers(src.answers);
  if (!isSnapshotComplete(answers) || !isIso(src.completed_at)) return null;
  return buildSnapshotRecord(answers, src.completed_at, src.member_selected_priority as PathwayName);
}

export function normaliseSnapshotV2(raw: unknown): SnapshotV2State {
  const base = snapshotV2Defaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const src = raw as Record<string, unknown>;
  const current = cleanRecord(src);
  const history = Array.isArray(src.history)
    ? src.history.map(cleanRecord).filter((r): r is SnapshotRecord => r !== null).slice(-HISTORY_LIMIT)
    : [];
  let draft: SnapshotV2State["draft"] = null;
  if (src.draft && typeof src.draft === "object" && !Array.isArray(src.draft)) {
    const d = src.draft as Record<string, unknown>;
    const step = typeof d.step === "number" && Number.isInteger(d.step) ? Math.max(0, Math.min(SNAPSHOT_SECTIONS.length - 1, d.step)) : 0;
    draft = { answers: cleanAnswers(d.answers), step };
  }
  return { ...base, ...(current ?? {}), draft, history };
}

/**
 * Finishing the snapshot: the new result becomes the top level and the one it
 * replaces moves to history — unless nothing was changed, so re-saving the same
 * answers does not pile up identical entries.
 */
export function completeSnapshot(state: SnapshotV2State, answers: SnapshotAnswers, now: string): SnapshotV2State {
  const record = buildSnapshotRecord(answers, now);
  const previous = cleanRecord(state);
  const changed = !previous || JSON.stringify(previous.answers) !== JSON.stringify(record.answers);
  if (!changed && previous) return { ...state, draft: null };
  const history = previous ? [...state.history, previous].slice(-HISTORY_LIMIT) : state.history;
  return { ...state, ...record, draft: null, history };
}

/** Changing the focus on the results page. */
export function selectPriority(state: SnapshotV2State, priority: PathwayName): SnapshotV2State {
  if (!state.completed_at || !PATHWAY_NAMES.includes(priority)) return state;
  return { ...state, member_selected_priority: priority };
}
