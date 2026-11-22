/**
 * The Boss Move Dashboard: income planning and cash reserves (QA sheet row
 * 238, 21 Nov 2026 — "Developer Update: Income Planning & Cash Reserve
 * Improvements").
 *
 * Extends the existing Exit Planner (exitPlanner.ts) rather than replacing it.
 * Everything new lives under one nested key, `freedom`, in the same saved
 * document (member_tool_state, tool_key 'boss-move-exit-planner'), so a
 * member's existing entries load exactly as before and simply gain an empty
 * `freedom` block. Four inputs the doc asks for already exist in the planner
 * with the same meaning and are shared rather than duplicated, so the two
 * halves can never disagree:
 *
 *   workWeeks   working weeks per year
 *   sessions    completed and paid sessions per week
 *   completion  expected completed/paid appointment percentage
 *   avgFee      current average collections per paid session
 *
 * Every figure is a pretax planning estimate. Blank, zero or nonsensical input
 * gives `null` (shown as a prompt), never NaN or Infinity.
 *
 * Kept free of React so the arithmetic is pinned in incomePlanner.test.ts.
 */

import type { ExitPlannerState } from "./exitPlanner";

export type PlanMode = "income" | "schedule";
export type ReserveMonths = 3 | 4 | 6;

export interface FreedomPlanState {
  /** Desired annual pretax owner income. */
  ownerIncome: number | null;
  /** Estimated annual practice operating expenses. */
  annualOpex: number | null;
  /** Annual health insurance / employee-benefit replacement costs not counted elsewhere. */
  annualBenefits: number | null;
  /** Planned annual contributions to business reserves not counted elsewhere. */
  annualReserve: number | null;
  /** Which way the schedule is worked out: A (income first) or B (schedule first). */
  mode: PlanMode;
  daysPerWeek: number | null;
  /** Appointments scheduled per working day. */
  sessionsPerDay: number | null;
  /** Business reserve calculator. */
  reserveExpenses: number | null;
  reserveMonths: ReserveMonths;
  reserveSaved: number | null;
  reserveMonthly: number | null;
  /** Personal transition savings, kept apart from the business reserve. */
  personalLiving: number | null;
  personalBenefits: number | null;
  personalMonths: number | null;
  personalSaved: number | null;
  personalMonthly: number | null;
}

/** Anything larger is treated as this, so a stray extra zero cannot overflow a figure. */
export const MAX_AMOUNT = 1_000_000_000;

export const RESERVE_MONTH_OPTIONS: readonly ReserveMonths[] = [3, 4, 6];

export const freedomDefaults = (): FreedomPlanState => ({
  ownerIncome: null,
  annualOpex: null,
  annualBenefits: null,
  annualReserve: null,
  mode: "income",
  daysPerWeek: null,
  sessionsPerDay: null,
  reserveExpenses: null,
  reserveMonths: 3,
  reserveSaved: null,
  reserveMonthly: null,
  personalLiving: null,
  personalBenefits: null,
  personalMonths: null,
  personalSaved: null,
  personalMonthly: null,
});

const AMOUNT_KEYS = [
  "ownerIncome",
  "annualOpex",
  "annualBenefits",
  "annualReserve",
  "daysPerWeek",
  "sessionsPerDay",
  "reserveExpenses",
  "reserveSaved",
  "reserveMonthly",
  "personalLiving",
  "personalBenefits",
  "personalMonths",
  "personalSaved",
  "personalMonthly",
] as const;

export type FreedomAmountKey = (typeof AMOUNT_KEYS)[number];

/** A stored or typed amount: null when blank or unusable, otherwise 0…MAX_AMOUNT. */
export function cleanAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_AMOUNT, Math.max(0, n));
}

/** The `freedom` block of a saved planner, over the defaults; never throws. */
export function normaliseFreedom(raw: unknown): FreedomPlanState {
  const base = freedomDefaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const src = raw as Record<string, unknown>;
  for (const key of AMOUNT_KEYS) base[key] = cleanAmount(src[key]);
  base.mode = src.mode === "schedule" ? "schedule" : "income";
  base.reserveMonths = RESERVE_MONTH_OPTIONS.includes(Number(src.reserveMonths) as ReserveMonths)
    ? (Number(src.reserveMonths) as ReserveMonths)
    : 3;
  return base;
}

/* ------------------------------------------------------------ arithmetic */

const amount = (v: number | null | undefined): number => cleanAmount(v) ?? 0;
const positive = (v: number | null | undefined): v is number => cleanAmount(v) !== null && (v as number) > 0;
const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || b <= 0 ? null : a / b;

/** Working weeks as a year can hold them: 0…52. */
export const clampWeeks = (weeks: number | null | undefined): number => Math.min(52, amount(weeks));

/** Planned PTO / vacation weeks implied by the working weeks, and back. */
export const ptoWeeks = (workWeeks: number | null | undefined): number => 52 - clampWeeks(workWeeks);
export const workWeeksFromPto = (pto: number | null | undefined): number => 52 - Math.min(52, amount(pto));

/** Completed/paid share of booked appointments, 0…1; null when not set. */
const paidRate = (completionPct: number | null | undefined): number | null =>
  positive(completionPct) ? Math.min(100, completionPct) / 100 : null;

export interface FreedomInputs {
  ownerIncome: number | null;
  annualOpex: number | null;
  annualBenefits: number | null;
  annualReserve: number | null;
  workWeeks: number | null;
  paidSessionsPerWeek: number | null;
  completionPct: number | null;
  currentRate: number | null;
}

export interface FreedomResult {
  /** Desired pretax owner income + operating expenses + separately identified benefits + reserve contributions. */
  requiredRevenue: number | null;
  annualPaidSessions: number | null;
  weeklyPaidSessions: number | null;
  /** Required average collected amount per paid session. */
  requiredRate: number | null;
  /** Weekly appointments to schedule after allowing for cancellations / unpaid sessions. */
  weeklyAppointments: number | null;
  annualAppointments: number | null;
  /** Paid sessions × weeks × current average collections. */
  projectedRevenue: number | null;
  /** projectedRevenue − requiredRevenue: positive is a surplus, negative a gap. */
  difference: number | null;
}

/** Mode A, "My Freedom Number": start with the income goal. */
export function freedomNumber(i: FreedomInputs): FreedomResult {
  // Each category is entered once and added once: nothing is double counted.
  const requiredRevenue =
    i.ownerIncome === null || cleanAmount(i.ownerIncome) === null
      ? null
      : amount(i.ownerIncome) + amount(i.annualOpex) + amount(i.annualBenefits) + amount(i.annualReserve);
  const weeks = clampWeeks(i.workWeeks);
  const weekly = positive(i.paidSessionsPerWeek) ? amount(i.paidSessionsPerWeek) : null;
  const annualPaidSessions = weekly !== null && weeks > 0 ? weekly * weeks : null;
  const rate = paidRate(i.completionPct);
  const weeklyAppointments = weekly !== null && rate !== null ? weekly / rate : null;
  const projectedRevenue =
    annualPaidSessions !== null && positive(i.currentRate) ? annualPaidSessions * amount(i.currentRate) : null;
  return {
    requiredRevenue,
    annualPaidSessions,
    weeklyPaidSessions: weekly,
    requiredRate: div(requiredRevenue, annualPaidSessions),
    weeklyAppointments,
    annualAppointments: weeklyAppointments !== null && weeks > 0 ? weeklyAppointments * weeks : null,
    projectedRevenue,
    difference: projectedRevenue !== null && requiredRevenue !== null ? projectedRevenue - requiredRevenue : null,
  };
}

export interface ScheduleInputs {
  daysPerWeek: number | null;
  sessionsPerDay: number | null;
  workWeeks: number | null;
  completionPct: number | null;
  currentRate: number | null;
  requiredRevenue: number | null;
}

export interface ScheduleResult {
  /** Booked appointments a week: days × appointments per day. */
  weeklyScheduled: number | null;
  /** Completed and paid sessions a week: booked × completion rate. */
  weeklyPaidSessions: number | null;
  annualPaidSessions: number | null;
  /** Annual practice gross collections at the current average. */
  annualCollections: number | null;
  /** annualCollections − requiredRevenue. */
  difference: number | null;
  /** Average collections per paid session needed to keep this schedule. */
  requiredRate: number | null;
}

/** Mode B, "My Ideal Work Schedule": start with the preferred schedule. */
export function idealSchedule(i: ScheduleInputs): ScheduleResult {
  const weeklyScheduled =
    positive(i.daysPerWeek) && positive(i.sessionsPerDay) ? Math.min(7, amount(i.daysPerWeek)) * amount(i.sessionsPerDay) : null;
  const rate = paidRate(i.completionPct);
  const weeklyPaidSessions = weeklyScheduled !== null && rate !== null ? weeklyScheduled * rate : null;
  const weeks = clampWeeks(i.workWeeks);
  const annualPaidSessions = weeklyPaidSessions !== null && weeks > 0 ? weeklyPaidSessions * weeks : null;
  const annualCollections =
    annualPaidSessions !== null && positive(i.currentRate) ? annualPaidSessions * amount(i.currentRate) : null;
  const required = i.requiredRevenue;
  return {
    weeklyScheduled,
    weeklyPaidSessions,
    annualPaidSessions,
    annualCollections,
    difference: annualCollections !== null && required !== null ? annualCollections - required : null,
    requiredRate: div(required, annualPaidSessions),
  };
}

export interface SavingsInputs {
  /** Monthly amount the savings must cover. */
  monthlyNeed: number | null;
  months: number | null;
  saved: number | null;
  monthlyContribution: number | null;
}

export interface SavingsResult {
  target: number | null;
  saved: number;
  /** max(0, target − saved): never negative. */
  remaining: number | null;
  /** 0…100, or null until there is a target. */
  percent: number | null;
  /** Whole months at the chosen contribution; 0 once reached; null with no contribution. */
  monthsToTarget: number | null;
  /** The month the target is reached at that pace, or null. */
  targetDate: Date | null;
}

/** Shared by the business reserve and the personal transition savings: target = monthly need × months. */
export function savingsPlan(i: SavingsInputs, today: Date = new Date()): SavingsResult {
  const target = positive(i.monthlyNeed) && positive(i.months) ? amount(i.monthlyNeed) * amount(i.months) : null;
  const saved = amount(i.saved);
  const remaining = target === null ? null : Math.max(0, target - saved);
  const percent = target === null ? null : Math.min(100, (saved / target) * 100);
  const monthsToTarget =
    remaining === null
      ? null
      : remaining === 0
        ? 0
        : positive(i.monthlyContribution)
          ? Math.ceil(remaining / amount(i.monthlyContribution))
          : null;
  let targetDate: Date | null = null;
  if (monthsToTarget !== null && monthsToTarget <= 1200) {
    targetDate = new Date(today.getFullYear(), today.getMonth() + monthsToTarget, 1);
  }
  return { target, saved, remaining, percent, monthsToTarget, targetDate };
}

export const NO_CONTRIBUTION = "Add a monthly contribution to estimate a completion date";

/* ------------------------------------------------------- status and labels */

export type GoalStatusKey = "reached" | "progress" | "review";

export interface GoalStatus {
  key: GoalStatusKey;
  label: "Goal reached" | "Progress toward goal" | "Needs review";
}

/**
 * Where a figure stands against its goal. "Needs review" when either side is
 * missing or nothing is in place yet; never a verdict on resigning.
 */
export function goalStatus(current: number | null, goal: number | null): GoalStatus {
  if (current === null || goal === null || goal <= 0 || !Number.isFinite(current)) return { key: "review", label: "Needs review" };
  if (current >= goal) return { key: "reached", label: "Goal reached" };
  if (current > 0) return { key: "progress", label: "Progress toward goal" };
  return { key: "review", label: "Needs review" };
}

/* ------------------------------------------------------------- formatting */

/** Whole dollars, "—" for a figure that cannot be worked out yet. */
export const dollars = (v: number | null): string =>
  v === null || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

/** Dollars and cents, for per-session amounts ($141.30). */
export const cents = (v: number | null): string =>
  v === null || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** A count, rounded to one decimal place where it is not whole. */
export const count = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-US");

/** Signed gap/surplus wording. */
export function gapLabel(difference: number | null): string {
  if (difference === null) return "—";
  if (Math.abs(difference) < 0.5) return "On target";
  return difference > 0 ? `${dollars(difference)} surplus` : `${dollars(-difference)} gap`;
}

export const monthYear = (d: Date | null): string =>
  d ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—";

/* ------------------------------------------------- the planner as a whole */

/** Every new figure for one saved planner. */
export function freedomFigures(s: ExitPlannerState, today: Date = new Date()) {
  const f = s.freedom;
  const income = freedomNumber({
    ownerIncome: f.ownerIncome,
    annualOpex: f.annualOpex,
    annualBenefits: f.annualBenefits,
    annualReserve: f.annualReserve,
    workWeeks: s.workWeeks,
    paidSessionsPerWeek: s.sessions,
    completionPct: s.completion,
    currentRate: s.avgFee,
  });
  const schedule = idealSchedule({
    daysPerWeek: f.daysPerWeek,
    sessionsPerDay: f.sessionsPerDay,
    workWeeks: s.workWeeks,
    completionPct: s.completion,
    currentRate: s.avgFee,
    requiredRevenue: income.requiredRevenue,
  });
  const reserve = savingsPlan(
    { monthlyNeed: f.reserveExpenses, months: f.reserveMonths, saved: f.reserveSaved, monthlyContribution: f.reserveMonthly },
    today,
  );
  const personalNeed =
    f.personalLiving === null && f.personalBenefits === null ? null : amount(f.personalLiving) + amount(f.personalBenefits);
  const personal = savingsPlan(
    { monthlyNeed: personalNeed, months: f.personalMonths, saved: f.personalSaved, monthlyContribution: f.personalMonthly },
    today,
  );
  // The proposed practice model is whichever mode the member is working in.
  const model =
    f.mode === "schedule"
      ? {
          projectedRevenue: schedule.annualCollections,
          difference: schedule.difference,
          weeklyPaid: schedule.weeklyPaidSessions,
          weeklyBooked: schedule.weeklyScheduled,
          requiredRate: schedule.requiredRate ?? income.requiredRate,
        }
      : {
          projectedRevenue: income.projectedRevenue,
          difference: income.difference,
          weeklyPaid: income.weeklyPaidSessions,
          weeklyBooked: income.weeklyAppointments,
          requiredRate: income.requiredRate,
        };
  const currentRate = positive(s.avgFee) ? amount(s.avgFee) : null;
  return { income, schedule, reserve, personal, personalNeed, model, currentRate, weeks: clampWeeks(s.workWeeks) };
}

export type FreedomFigures = ReturnType<typeof freedomFigures>;

export interface SnapshotRow {
  label: string;
  value: string;
  /** null for a row that describes a plan rather than measures progress. */
  status: GoalStatus | null;
  note: string;
}

const STATUS_NOTE: Record<GoalStatusKey, string> = {
  reached: "Your current entries meet this planning goal.",
  progress: "You have made progress; the remaining distance is shown.",
  review: "Some entries are missing or below the goal. Review the related section.",
};

/** "My Exit Readiness Snapshot": one row per area, each with a status label. */
export function snapshotRows(s: ExitPlannerState, fig: FreedomFigures = freedomFigures(s)): SnapshotRow[] {
  const { income, model, reserve, personal, currentRate } = fig;
  const scheduleText =
    s.freedom.mode === "schedule"
      ? `${count(s.freedom.daysPerWeek)} days × ${count(s.freedom.sessionsPerDay)} appointments = ${count(model.weeklyBooked)} booked; about ${count(model.weeklyPaid)} paid sessions a week`
      : `${count(model.weeklyPaid)} paid sessions a week; schedule about ${count(model.weeklyBooked)} appointments`;
  const row = (label: string, value: string, status: GoalStatus | null, extra?: string): SnapshotRow => ({
    label,
    value,
    status,
    note: status === null ? (extra ?? "") : extra ? `${STATUS_NOTE[status.key]} ${extra}` : STATUS_NOTE[status.key],
  });
  const review: GoalStatus = { key: "review", label: "Needs review" };
  return [
    row(
      "Annual owner-income goal and required practice revenue",
      `${dollars(s.freedom.ownerIncome)} pretax owner income → ${dollars(income.requiredRevenue)} practice revenue`,
      income.requiredRevenue === null ? review : null,
      income.requiredRevenue === null ? "Enter your desired annual pretax owner income." : "Your planning target for the practice.",
    ),
    row(
      "Projected annual revenue from the proposed practice model",
      dollars(model.projectedRevenue),
      goalStatus(model.projectedRevenue, income.requiredRevenue),
    ),
    row(
      "Desired weekly schedule and estimated sessions",
      scheduleText,
      model.weeklyPaid === null ? review : null,
      model.weeklyPaid === null ? "Complete your schedule entries." : "Booked appointments and completed/paid sessions are counted separately.",
    ),
    row(
      "Required vs. current average collections per paid session",
      `${cents(model.requiredRate)} required · ${cents(currentRate)} current`,
      goalStatus(currentRate, model.requiredRate),
    ),
    row("Estimated revenue gap or surplus", gapLabel(model.difference), goalStatus(model.projectedRevenue, income.requiredRevenue)),
    row(
      "Business reserve target and progress",
      `${dollars(reserve.saved)} of ${dollars(reserve.target)}${reserve.percent === null ? "" : ` (${Math.round(reserve.percent)}%)`}`,
      goalStatus(reserve.saved, reserve.target),
    ),
    row(
      "Personal transition savings target and progress",
      `${dollars(personal.saved)} of ${dollars(personal.target)}${personal.percent === null ? "" : ` (${Math.round(personal.percent)}%)`}`,
      goalStatus(personal.saved, personal.target),
    ),
  ];
}

export const SNAPSHOT_PROMPT =
  "Before acting on these numbers, separately evaluate taxes, debt, health insurance, retirement and benefits, your actual referral patterns, how predictable your collections are, and any other obligations.";

export const SNAPSHOT_DISCLAIMER =
  "These are pretax planning estimates, not take-home pay. A “Goal reached” label means your entries meet a planning goal; it does not mean you are financially ready or cleared to resign.";

export const CASH_RESERVE_EXPLANATION =
  "Cash reserves are money you set aside to help your practice continue operating when income decreases or unexpected expenses arise. Think of them as your practice’s financial safety net. Examples include a slower season, delayed insurance payments, unexpected practice bills, or an interruption in revenue.";

const savingsLine = (r: SavingsResult): string =>
  r.monthsToTarget === null
    ? r.target === null
      ? "Not set"
      : NO_CONTRIBUTION
    : r.monthsToTarget === 0
      ? "Target reached"
      : `${r.monthsToTarget} months (about ${monthYear(r.targetDate)})`;

/** The new sections of the printable / downloadable summary. */
export function freedomSummaryLines(s: ExitPlannerState, today: Date = new Date()): string[] {
  const fig = freedomFigures(s, today);
  const { income, schedule, reserve, personal } = fig;
  const f = s.freedom;
  return [
    "MY FREEDOM NUMBER",
    "All amounts are pretax planning estimates, not after-tax take-home pay.",
    `Desired annual pretax owner income: ${dollars(f.ownerIncome)}`,
    `Annual operating expenses: ${dollars(f.annualOpex)}`,
    `Annual benefit replacement costs (not counted elsewhere): ${dollars(f.annualBenefits)}`,
    `Annual business reserve contributions (not counted elsewhere): ${dollars(f.annualReserve)}`,
    `Required annual practice revenue: ${dollars(income.requiredRevenue)}`,
    `Working weeks per year: ${count(fig.weeks)} (${count(ptoWeeks(s.workWeeks))} weeks off)`,
    `Paid sessions per week: ${count(income.weeklyPaidSessions)}; per year: ${count(income.annualPaidSessions)}`,
    `Required average collections per paid session: ${cents(income.requiredRate)}`,
    `Weekly appointments to schedule (at ${count(s.completion)}% completed/paid): ${count(income.weeklyAppointments)}`,
    `Current average collections per paid session: ${cents(fig.currentRate)}`,
    `Projected annual revenue at that average: ${dollars(income.projectedRevenue)} (${gapLabel(income.difference)})`,
    "",
    "MY IDEAL WORK SCHEDULE",
    `Planning mode: ${f.mode === "schedule" ? "Start with my preferred schedule" : "Start with my income goal"}`,
    `Days worked weekly: ${count(f.daysPerWeek)}; appointments per day: ${count(f.sessionsPerDay)}`,
    `Booked appointments per week: ${count(schedule.weeklyScheduled)}; paid sessions per week: ${count(schedule.weeklyPaidSessions)}`,
    `Paid sessions per year: ${count(schedule.annualPaidSessions)}`,
    `Annual practice gross collections: ${dollars(schedule.annualCollections)} (${gapLabel(schedule.difference)})`,
    `Average collections per paid session needed for this schedule: ${cents(schedule.requiredRate)}`,
    "",
    "MY CASH RESERVE PLAN",
    `Essential monthly business expenses: ${dollars(f.reserveExpenses)} × ${f.reserveMonths} months`,
    `Business reserve target: ${dollars(reserve.target)}; saved: ${dollars(reserve.saved)}; remaining: ${dollars(reserve.remaining)}`,
    `Business reserve progress: ${reserve.percent === null ? "—" : `${Math.round(reserve.percent)}%`}; time to target: ${savingsLine(reserve)}`,
    `Personal transition savings target: ${dollars(personal.target)}; saved: ${dollars(personal.saved)}; remaining: ${dollars(personal.remaining)}`,
    `Personal savings progress: ${personal.percent === null ? "—" : `${Math.round(personal.percent)}%`}; time to target: ${savingsLine(personal)}`,
    "",
    "MY EXIT READINESS SNAPSHOT",
    ...snapshotRows(s, fig).map((r) => `${r.label}: ${r.value}${r.status ? ` [${r.status.label}]` : ""}`),
    SNAPSHOT_PROMPT,
    SNAPSHOT_DISCLAIMER,
    "",
  ];
}
