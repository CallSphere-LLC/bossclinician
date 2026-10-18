/**
 * The Boss Move — Private Practice Exit Planner: data and arithmetic.
 *
 * Ported line for line from Yvette's prototype (boss-move-exit-planner.html,
 * QA sheet row 102). Every formula, default, checklist item and sentence below
 * is the prototype's; the React component only draws it. Kept free of React so
 * the numbers can be pinned in exitPlanner.test.ts.
 */

export type ExitPath = "agency" | "platform" | "rebuild";
export type ExitPace = "gradual" | "full" | "explore";

export interface ExitPlannerState {
  path: ExitPath;
  practiceName: string;
  living: number;
  personalSavings: number;
  householdIncome: number;
  cushion: number;
  existingIncome: number;
  existingPracticeCollections: number;
  exitDate: string;
  pace: ExitPace;
  health: number;
  dental: number;
  disability: number;
  life: number;
  retirement: number;
  otherBenefits: number;
  employerMatch: number;
  employeePremium: number;
  reserves: number;
  months: number;
  startup: number;
  transitionCash: number;
  avgFee: number;
  sessions: number;
  workWeeks: number;
  completion: number;
  opex: number;
  payroll: number;
  taxRate: number;
  profit: number;
  nextAction: string;
  barrier: string;
  referralPlan: string;
  contingency: string;
  firstDeadline: string;
  milestoneGoal: string;
  checks: Record<string, boolean>;
}

export type NumericKey = {
  [K in keyof ExitPlannerState]: ExitPlannerState[K] extends number ? K : never;
}[keyof ExitPlannerState];

export const EXIT_DEFAULTS: ExitPlannerState = {
  path: "agency",
  practiceName: "",
  living: 3800,
  personalSavings: 300,
  householdIncome: 0,
  cushion: 250,
  existingIncome: 5000,
  existingPracticeCollections: 0,
  exitDate: "",
  pace: "gradual",
  health: 550,
  dental: 50,
  disability: 65,
  life: 25,
  retirement: 350,
  otherBenefits: 50,
  employerMatch: 250,
  employeePremium: 180,
  reserves: 12000,
  months: 4,
  startup: 2000,
  transitionCash: 1200,
  avgFee: 130,
  sessions: 18,
  workWeeks: 46,
  completion: 90,
  opex: 900,
  payroll: 0,
  taxRate: 25,
  profit: 300,
  nextAction: "",
  barrier: "",
  referralPlan: "",
  contingency: "",
  firstDeadline: "",
  milestoneGoal: "",
  checks: {},
};

export const exitDefaults = (): ExitPlannerState => ({ ...EXIT_DEFAULTS, checks: {} });

const PATHS: readonly ExitPath[] = ["agency", "platform", "rebuild"];
const PACES: readonly ExitPace[] = ["gradual", "full", "explore"];

/** Stored or restored data over the defaults, with every field the right type. */
export function normaliseExit(raw: unknown): ExitPlannerState {
  const base = exitDefaults();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base) as (keyof ExitPlannerState)[]) {
    const value = src[key];
    if (value === undefined) continue;
    const fallback = base[key];
    if (typeof fallback === "number") out[key] = Math.max(0, Number(value) || 0);
    else if (typeof fallback === "string") out[key] = typeof value === "string" ? value.slice(0, 5000) : fallback;
  }
  out.path = PATHS.includes(src.path as ExitPath) ? src.path : base.path;
  out.pace = PACES.includes(src.pace as ExitPace) ? src.pace : base.pace;
  const checks: Record<string, boolean> = {};
  if (src.checks && typeof src.checks === "object") {
    for (const [key, value] of Object.entries(src.checks as Record<string, unknown>)) {
      if (ALL_CHECK_KEYS.has(key)) checks[key] = value === true;
    }
  }
  out.checks = checks;
  return out as unknown as ExitPlannerState;
}

export const EXIT_SECTIONS = [
  { id: "dashboard", label: "Overview", title: "Your Exit Dashboard", sub: "A realistic plan for your next move—not a countdown to quitting." },
  { id: "income", label: "01 Income", title: "Your Freedom Number", sub: "Understand how much personal income your practice needs to support." },
  { id: "benefits", label: "02 Benefits", title: "Replace Your Benefits", sub: "Account for the real cost of leaving employer-provided benefits." },
  { id: "runway", label: "03 Runway", title: "Build Your Cash Runway", sub: "Prepare for slower months and the costs of getting started." },
  { id: "revenue", label: "04 Revenue", title: "Map Your Practice Revenue", sub: "Connect sustainable clinical capacity with required monthly collections." },
  { id: "readiness", label: "05 Readiness", title: "Your Practice Readiness", sub: "Track the important business milestones before making a change." },
  { id: "plan", label: "06 Exit Plan", title: "Your Boss Move Plan", sub: "Turn your financial assumptions into an actionable, exportable plan." },
] as const;

export type ExitSectionId = (typeof EXIT_SECTIONS)[number]["id"];

export interface CheckGroup {
  title: string;
  items: readonly (readonly [string, string])[];
}

export const CHECK_GROUPS: readonly CheckGroup[] = [
  {
    title: "Financial preparation",
    items: [
      ["fin1", "Created a realistic household budget and personal income goal"],
      ["fin2", "Researched health coverage and benefit replacements"],
      ["fin3", "Set a savings and business startup reserve target"],
      ["fin4", "Confirmed a sustainable average collected session fee"],
    ],
  },
  {
    title: "Business and legal foundations",
    items: [
      ["biz1", "Confirmed applicable licensing, entity, and business registration requirements"],
      ["biz2", "Established a business bank account and bookkeeping process"],
      ["biz3", "Arranged appropriate professional liability and business coverage"],
      ["biz4", "Prepared privacy, informed consent, documentation, and practice policies"],
    ],
  },
  {
    title: "Credentialing and billing",
    items: [
      ["bill1", "Selected private-pay, direct payer contracts, or mixed billing strategy"],
      ["bill2", "Confirmed effective dates, billing workflow, and payment collection process"],
      ["bill3", "Considered reimbursement delays, denials, and contract obligations"],
    ],
  },
  {
    title: "Visibility and client flow",
    items: [
      ["growth1", "Defined my ideal clients, services, and value proposition"],
      ["growth2", "Prepared my website or directory profiles"],
      ["growth3", "Established referral relationships and inquiry follow-up"],
      ["growth4", "Have evidence of sustainable client demand or a realistic growth plan"],
    ],
  },
  {
    title: "Transition and contingency",
    items: [
      ["exit1", "Reviewed employment or platform contracts and transition restrictions"],
      ["exit2", "Planned ethical client continuity, notice, and records responsibilities"],
      ["exit3", "Identified a realistic transition milestone or date"],
      ["exit4", "Created a contingency plan for lower-than-expected revenue"],
    ],
  },
  {
    title: "Personal and leadership readiness",
    items: [
      ["mind1", "Identified the support people or professional advisors I may need"],
      ["mind2", "Clarified my reasons for private practice beyond simply escaping my current role"],
    ],
  },
];

const ALL_CHECK_KEYS = new Set(CHECK_GROUPS.flatMap((g) => g.items.map(([k]) => k)));

/* ------------------------------------------------------------ arithmetic */

const num = (s: ExitPlannerState, k: NumericKey): number => Math.max(0, Number(s[k]) || 0);

export const benefit = (s: ExitPlannerState): number =>
  (["health", "dental", "disability", "life", "retirement", "otherBenefits"] as const).reduce((a, k) => a + num(s, k), 0);

/** Monthly personal income the practice needs to supply. */
export const take = (s: ExitPlannerState): number =>
  Math.max(0, num(s, "living") + num(s, "personalSavings") + num(s, "cushion") - num(s, "householdIncome"));

export const outlay = (s: ExitPlannerState): number => num(s, "opex") + num(s, "payroll");

export const tax = (s: ExitPlannerState): number => Math.min(0.7, num(s, "taxRate") / 100);

/** Target gross collections per month. */
export const revenueTarget = (s: ExitPlannerState): number =>
  (take(s) + benefit(s) + num(s, "profit")) / (1 - tax(s)) + outlay(s);

/** Projected collections per month. */
export const projected = (s: ExitPlannerState): number =>
  (num(s, "avgFee") * num(s, "sessions") * num(s, "workWeeks")) / 12;

const yearlySessions = (s: ExitPlannerState): number => num(s, "avgFee") * num(s, "workWeeks");

/** Required completed sessions per week; Infinity until a fee and weeks are set. */
export const requiredSessions = (s: ExitPlannerState): number =>
  yearlySessions(s) > 0 ? (revenueTarget(s) * 12) / yearlySessions(s) : Infinity;

/** Monthly shortfall to be covered by reserves. */
export const shortfall = (s: ExitPlannerState): number =>
  Math.max(
    0,
    num(s, "living") + num(s, "personalSavings") + num(s, "cushion") + benefit(s) + outlay(s) - num(s, "transitionCash"),
  );

export const reserveTarget = (s: ExitPlannerState): number =>
  shortfall(s) * Math.max(1, num(s, "months")) + num(s, "startup");

export const usable = (s: ExitPlannerState): number => Math.max(0, num(s, "reserves") - num(s, "startup"));

/** The checklist that counts: "Researched health coverage" only on the agency path. */
export const countedChecks = (s: ExitPlannerState): (readonly [string, string])[] =>
  CHECK_GROUPS.flatMap((g) => g.items).filter(([k]) => (s.path !== "agency" ? !["fin2"].includes(k) : true));

export const PROGRESS_AREAS = [
  { key: "financial", label: "Financial preparation", items: CHECK_GROUPS[0].items },
  { key: "operations", label: "Business operations", items: [...CHECK_GROUPS[1].items, ...CHECK_GROUPS[2].items] },
  { key: "clientFlow", label: "Client acquisition", items: CHECK_GROUPS[3].items },
  { key: "transition", label: "Transition milestones", items: [...CHECK_GROUPS[4].items, ...CHECK_GROUPS[5].items] },
] as const;

export function areaPercent(s: ExitPlannerState, items: readonly (readonly [string, string])[]): number {
  const done = items.filter(([key]) => s.checks?.[key]).length;
  return (100 * done) / items.length;
}

/* ------------------------------------------------------------- formatting */

export const usd = (v: number): string =>
  !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export const fixed = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : "—");

export const ceil = (v: number): string => (Number.isFinite(v) ? Math.ceil(v).toLocaleString() : "—");

/* ------------------------------------------------------------ derived copy */

export interface ExitSummary {
  benefitTotal: number;
  target: number;
  projectedRevenue: number;
  required: number;
  monthlyGap: number;
  reserveTarget: number;
  usable: number;
  done: number;
  counted: number;
  percentage: number;
}

export function summarise(s: ExitPlannerState): ExitSummary {
  const counted = countedChecks(s);
  const done = counted.filter(([k]) => s.checks?.[k]).length;
  return {
    benefitTotal: benefit(s),
    target: revenueTarget(s),
    projectedRevenue: projected(s),
    required: requiredSessions(s),
    monthlyGap: shortfall(s),
    reserveTarget: reserveTarget(s),
    usable: usable(s),
    done,
    counted: counted.length,
    percentage: counted.length ? (done / counted.length) * 100 : 0,
  };
}

/** Runway in months at the modeled cash draw, as the prototype words it. */
export const runwayLabel = (s: ExitPlannerState, none: string): string =>
  shortfall(s) > 0 ? `${fixed(usable(s) / shortfall(s))} months` : none;

export const premiumDelta = (s: ExitPlannerState): number =>
  num(s, "health") + num(s, "dental") - num(s, "employeePremium");

export function pathTip(path: ExitPath): string {
  return path === "agency"
    ? "Agency path: prioritize replacing employer benefits, reviewing resignation/transition requirements, and confirming cash-flow continuity."
    : path === "platform"
      ? "Platform path: prioritize independent referrals, payer contracts, billing systems, contract terms, and client transition responsibilities."
      : "Rebuild path: prioritize financial resilience, sustainable client flow, and operating systems before changing your work commitments.";
}

/** "Your next best moves": up to five, the prototype's three checks first. */
export function nextSteps(s: ExitPlannerState): string[] {
  const target = revenueTarget(s);
  const p = projected(s);
  const resT = reserveTarget(s);
  const actionable: string[] = [];
  if (num(s, "health") === 0 && s.path === "agency")
    actionable.push("Compare health coverage options and obtain actual premium quotes.");
  if (num(s, "reserves") < resT)
    actionable.push(`Review your reserve plan; current estimated gap is ${usd(Math.max(0, resT - num(s, "reserves")))}.`);
  if (p < target) actionable.push(`Review the projected revenue gap of ${usd(target - p)} per month.`);
  const first = countedChecks(s)
    .filter(([k]) => !s.checks?.[k])
    .slice(0, 3)
    .map(([, t]) => t);
  return [...actionable, ...first].slice(0, 5);
}

/** Download Exit Plan (.txt), verbatim from the prototype. */
export function summaryLines(s: ExitPlannerState): string[] {
  const count = countedChecks(s);
  const done = count.filter(([k]) => s.checks?.[k]);
  return [
    "BOSS CLINICIAN — MY PRIVATE PRACTICE EXIT PLAN",
    "",
    `Practice: ${s.practiceName || "Not specified"}`,
    `Path: ${s.path}`,
    `Transition approach: ${s.pace}`,
    `Target date: ${s.exitDate || "Not set"}`,
    "",
    "FINANCIAL ASSUMPTIONS",
    `Personal after-tax income needed: ${usd(take(s))}/month`,
    `Monthly benefits budget: ${usd(benefit(s))}`,
    `Monthly business operating and payroll expenses: ${usd(outlay(s))}`,
    `Tax planning reserve: ${num(s, "taxRate")}% of projected net business earnings`,
    `Planned retained business profit: ${usd(num(s, "profit"))}/month`,
    `Target gross monthly collections: ${usd(revenueTarget(s))}`,
    `Projected monthly collections: ${usd(projected(s))}`,
    `Average collected amount per completed session: ${usd(num(s, "avgFee"))}`,
    `Required completed sessions per week: ${ceil(requiredSessions(s))}`,
    `Projected completed sessions per week: ${num(s, "sessions")}`,
    "",
    "EXIT RUNWAY",
    `Reserves available: ${usd(num(s, "reserves"))}`,
    `One-time setup: ${usd(num(s, "startup"))}`,
    `Monthly projected cash shortfall: ${usd(shortfall(s))}`,
    `Target months: ${num(s, "months")}`,
    `Reserve target: ${usd(reserveTarget(s))}`,
    `Estimated runway after setup: ${shortfall(s) > 0 ? `${fixed(usable(s) / shortfall(s))} months` : "No modeled draw"}`,
    "",
    "READINESS",
    `${done.length} of ${count.length} milestones complete`,
    ...count.map(([k, t]) => `${s.checks?.[k] ? "[x]" : "[ ]"} ${t}`),
    "",
    "MY ACTION PLAN",
    `Next milestone: ${s.nextAction || ""}`,
    `Biggest uncertainty: ${s.barrier || ""}`,
    `Referral strategy: ${s.referralPlan || ""}`,
    `Contingency: ${s.contingency || ""}`,
    `Action deadline: ${s.firstDeadline || ""}`,
    `Graduation goal: ${s.milestoneGoal || ""}`,
    "",
    "Educational estimates only. Not a personalized recommendation to resign or financial, legal, tax, or benefits advice.",
  ];
}

export const numOf = num;
