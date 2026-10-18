/**
 * Boardroom CEO Dashboard (QA sheet row 95): data and arithmetic.
 *
 * Built from Yvette's "Boardroom CEO Dashboard — Blank Interactive Mockup"
 * (spec captured 2026-10-17). A blank, member-ready version: every input
 * starts empty and every result reads "—" until the numbers it needs exist.
 * The mockup's Cash Strategy tab was empty; its calculator here is the
 * spec's suggestion (runway, reserve target, gap, monthly set-aside).
 */

export const BOARDROOM_KEY = "boardroom-ceo-dashboard";

export type Num = number | null;

export interface BoardroomState {
  // CEO Snapshot
  revenue: Num;
  cogs: Num;
  opex: Num;
  cash: Num;
  guardrailPct: Num;
  // EHR + Capacity
  dataSource: "ehr" | "manual";
  period: "weekly" | "monthly" | "quarterly";
  level: "practice" | "single" | "group";
  clinicians: Num;
  method: "sessions" | "hours";
  capTarget: Num;
  capScheduled: Num;
  capCompleted: Num;
  capGuardrail: Num;
  scenarioUtil: Num;
  // Team + Pay
  teamCollections: Num;
  teamTaxes: Num;
  teamBenefits: Num;
  teamSupervision: Num;
  teamOther: Num;
  compStructure: "hourly" | "session" | "split" | "salary";
  clinRate: Num;
  clinHours: Num;
  nonclinRate: Num;
  nonclinHours: Num;
  sessionRate: Num;
  sessionsPaid: Num;
  splitPct: Num;
  salaryMonthly: Num;
  // Hiring + Ramp-Up
  hireTarget: Num;
  hireAvgRevenue: Num;
  hireCost: Num;
  hireOverhead: Num;
  hireM1: Num;
  hireM2: Num;
  hireM3: Num;
  hireSteady: Num;
  // Owner Pay
  payMethod: "w2hourly" | "w2salary" | "draw" | "distributions";
  ownerRate: Num;
  ownerHours: Num;
  ownerDesired: Num;
  ownerClinical: "no" | "yes";
  // Cash Strategy
  cashExpenses: Num;
  cashReserveMonths: Num;
  cashDebt: Num;
  // Compensation + Benefits
  benClinicians: Num;
  benHealth: Num;
  benRetirement: Num;
  benPto: Num;
  benCeu: Num;
  benSupervision: Num;
  benOther: Num;
  // Scenario Lab
  scRevenue: Num;
  scCost: Num;
  scDebt: Num;
  scBenefits: Num;
}

export const boardroomDefaults = (): BoardroomState => ({
  revenue: null,
  cogs: null,
  opex: null,
  cash: null,
  guardrailPct: 15,
  dataSource: "ehr",
  period: "monthly",
  level: "practice",
  clinicians: null,
  method: "sessions",
  capTarget: null,
  capScheduled: null,
  capCompleted: null,
  capGuardrail: 85,
  scenarioUtil: null,
  teamCollections: null,
  teamTaxes: null,
  teamBenefits: null,
  teamSupervision: null,
  teamOther: null,
  compStructure: "hourly",
  clinRate: null,
  clinHours: null,
  nonclinRate: null,
  nonclinHours: null,
  sessionRate: null,
  sessionsPaid: null,
  splitPct: null,
  salaryMonthly: null,
  hireTarget: null,
  hireAvgRevenue: null,
  hireCost: null,
  hireOverhead: null,
  hireM1: null,
  hireM2: null,
  hireM3: null,
  hireSteady: null,
  payMethod: "w2salary",
  ownerRate: null,
  ownerHours: null,
  ownerDesired: null,
  ownerClinical: "no",
  cashExpenses: null,
  cashReserveMonths: 3,
  cashDebt: null,
  benClinicians: null,
  benHealth: null,
  benRetirement: null,
  benPto: null,
  benCeu: null,
  benSupervision: null,
  benOther: null,
  scRevenue: null,
  scCost: null,
  scDebt: null,
  scBenefits: null,
});

const CHOICES: Partial<Record<keyof BoardroomState, readonly string[]>> = {
  dataSource: ["ehr", "manual"],
  period: ["weekly", "monthly", "quarterly"],
  level: ["practice", "single", "group"],
  method: ["sessions", "hours"],
  compStructure: ["hourly", "session", "split", "salary"],
  payMethod: ["w2hourly", "w2salary", "draw", "distributions"],
  ownerClinical: ["no", "yes"],
};

export function normaliseBoardroom(raw: unknown): BoardroomState {
  const base = boardroomDefaults();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base) as (keyof BoardroomState)[]) {
    const value = src[key];
    if (value === undefined) continue;
    const choices = CHOICES[key];
    if (choices) {
      if (typeof value === "string" && choices.includes(value)) out[key] = value;
    } else if (value === null) {
      out[key] = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out as unknown as BoardroomState;
}

/* ------------------------------------------------------------- helpers */

const has = (n: Num): n is number => n !== null && Number.isFinite(n);
const z = (n: Num): number => (has(n) ? n : 0);
const ratio = (a: number, b: number): Num => (b > 0 ? a / b : null);

export const money = (n: Num): string =>
  has(n)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
    : "—";

export const money2 = (n: Num): string =>
  has(n)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    : "—";

/** A fraction (0.153) as "15.3%". */
export const pct = (fraction: Num): string => (has(fraction) ? `${(fraction * 100).toFixed(1)}%` : "—");

export const count = (n: Num, digits = 1): string =>
  has(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—";

/* ---------------------------------------------------------- CEO Snapshot */

export function snapshotFigures(s: BoardroomState) {
  if (!has(s.revenue)) return { revenue: null, profit: null, margin: null, guardrail: null };
  const profit = s.revenue - z(s.cogs) - z(s.opex);
  return {
    revenue: s.revenue,
    profit,
    margin: ratio(profit, s.revenue),
    guardrail: has(s.guardrailPct) ? (s.revenue * s.guardrailPct) / 100 : null,
  };
}

export function guardrailNote(s: BoardroomState): string {
  const f = snapshotFigures(s);
  if (f.profit === null || f.guardrail === null) return "Enter your business numbers to see the comparison.";
  const gap = f.profit - f.guardrail;
  if (Math.abs(gap) < 0.5) return `Operating profit of ${money(f.profit)} is right at your ${z(s.guardrailPct)}% guardrail.`;
  return gap > 0
    ? `Operating profit of ${money(f.profit)} is ${money(gap)} above your ${z(s.guardrailPct)}% guardrail of ${money(f.guardrail)}.`
    : `Operating profit of ${money(f.profit)} is ${money(-gap)} below your ${z(s.guardrailPct)}% guardrail of ${money(f.guardrail)}.`;
}

/* ------------------------------------------------------ EHR + Capacity */

export function capacityFigures(s: BoardroomState) {
  const target = z(s.capTarget);
  const booked = has(s.capScheduled) ? ratio(s.capScheduled, target) : null;
  const completed = has(s.capCompleted) ? ratio(s.capCompleted, target) : null;
  const perClinician = has(s.capCompleted) && z(s.clinicians) > 0 ? s.capCompleted / z(s.clinicians) : null;
  const guard = has(s.capGuardrail) ? s.capGuardrail / 100 : null;
  return { booked, completed, perClinician, guard };
}

/** "Above / below the 85% guardrail by n points". */
export function versusGuardrail(util: Num, guard: Num): string {
  if (!has(util) || !has(guard)) return "—";
  const diff = (util - guard) * 100;
  if (Math.abs(diff) < 0.05) return "At guardrail";
  return `${diff > 0 ? "Above" : "Below"} by ${Math.abs(diff).toFixed(1)} pts`;
}

/** Use existing capacity before hiring: revenue × scenario / current utilization. */
export function capacityScenario(s: BoardroomState) {
  const { completed } = capacityFigures(s);
  const scenario = has(s.scenarioUtil) ? s.scenarioUtil / 100 : null;
  const revenue = has(s.revenue) ? s.revenue : null;
  const modeled = revenue !== null && completed && scenario !== null ? (revenue * scenario) / completed : null;
  return { current: completed, scenario, revenue, modeled };
}

/* ---------------------------------------------------------- Team + Pay */

export function teamFigures(s: BoardroomState) {
  let wages: Num = null;
  switch (s.compStructure) {
    case "hourly":
      if (has(s.clinRate) || has(s.nonclinRate)) wages = z(s.clinRate) * z(s.clinHours) + z(s.nonclinRate) * z(s.nonclinHours);
      break;
    case "session":
      if (has(s.sessionRate)) wages = s.sessionRate * z(s.sessionsPaid) + z(s.nonclinRate) * z(s.nonclinHours);
      break;
    case "split":
      if (has(s.splitPct) && has(s.teamCollections)) wages = (s.teamCollections * s.splitPct) / 100;
      break;
    case "salary":
      if (has(s.salaryMonthly)) wages = s.salaryMonthly;
      break;
  }
  const total = wages === null ? null : wages + z(s.teamTaxes) + z(s.teamBenefits) + z(s.teamSupervision) + z(s.teamOther);
  const contribution = total !== null && has(s.teamCollections) ? s.teamCollections - total : null;
  return { wages, total, contribution, margin: contribution !== null && has(s.teamCollections) ? ratio(contribution, s.teamCollections) : null };
}

/* ------------------------------------------------------ Hiring + Ramp-Up */

export interface RampRow {
  label: string;
  utilization: number;
  sessions: number;
  revenue: number;
  cost: number;
  contribution: number;
  cumulative: number | null;
}

export function rampModel(s: BoardroomState): { rows: RampRow[]; breakeven: string } | null {
  if (!has(s.hireTarget) || !has(s.hireAvgRevenue) || !has(s.hireCost)) return null;
  const utils = [s.hireM1, s.hireM2, s.hireM3, s.hireSteady];
  if (!utils.some(has)) return null;
  const cost = s.hireCost + z(s.hireOverhead);
  let cumulative = 0;
  const rows: RampRow[] = utils.map((u, i) => {
    const utilization = z(u);
    const sessions = (s.hireTarget! * utilization) / 100;
    const revenue = sessions * s.hireAvgRevenue!;
    const contribution = revenue - cost;
    const steady = i === 3;
    if (!steady) cumulative += contribution;
    return {
      label: steady ? "Steady state (monthly)" : `Month ${i + 1}`,
      utilization,
      sessions,
      revenue,
      cost,
      contribution,
      cumulative: steady ? null : cumulative,
    };
  });
  const firstPositive = rows.slice(0, 3).findIndex((r) => (r.cumulative ?? -1) >= 0);
  let breakeven: string;
  if (firstPositive >= 0) breakeven = `Month ${firstPositive + 1}`;
  else if (rows[3].contribution > 0) {
    const extra = Math.ceil(-(rows[2].cumulative ?? 0) / rows[3].contribution);
    breakeven = `Month ${3 + extra} (at steady-state utilization from month 4)`;
  } else breakeven = "Not reached at these assumptions";
  return { rows, breakeven };
}

/* ------------------------------------------------------------ Owner Pay */

const WEEKS_PER_MONTH = 52 / 12;

export function ownerFigures(s: BoardroomState) {
  const current = has(s.ownerRate) && has(s.ownerHours) ? s.ownerRate * s.ownerHours * WEEKS_PER_MONTH : null;
  const desired = has(s.ownerDesired) ? s.ownerDesired : null;
  const additional = current !== null && desired !== null ? desired - current : null;
  const monthlyHours = has(s.ownerHours) ? s.ownerHours * WEEKS_PER_MONTH : 0;
  const rateNeeded = desired !== null && monthlyHours > 0 ? desired / monthlyHours : null;
  const rateIncrease = rateNeeded !== null && has(s.ownerRate) ? rateNeeded - s.ownerRate : null;
  const snap = snapshotFigures(s);
  const projectedProfit = snap.profit !== null && additional !== null ? snap.profit - additional : null;
  const projectedMargin = projectedProfit !== null && snap.revenue ? ratio(projectedProfit, snap.revenue) : null;
  return { current, desired, additional, rateNeeded, rateIncrease, projectedProfit, projectedMargin };
}

/* -------------------------------------------------------- Cash Strategy */

export function cashFigures(s: BoardroomState) {
  const expenses = has(s.cashExpenses) ? s.cashExpenses : has(s.cogs) || has(s.opex) ? z(s.cogs) + z(s.opex) : null;
  const outflow = expenses === null ? null : expenses + z(s.cashDebt);
  const cash = has(s.cash) ? s.cash : null;
  const runway = cash !== null && outflow ? cash / outflow : null;
  const target = outflow !== null && has(s.cashReserveMonths) ? outflow * s.cashReserveMonths : null;
  const gap = target !== null && cash !== null ? Math.max(0, target - cash) : null;
  return { expenses, outflow, cash, runway, target, gap, setAside: gap !== null ? gap / 12 : null, usingSnapshot: !has(s.cashExpenses) };
}

/* ------------------------------------------------- Compensation + Benefits */

export function benefitsFigures(s: BoardroomState) {
  const parts = [s.benHealth, s.benRetirement, s.benPto, s.benCeu, s.benSupervision, s.benOther];
  const perClinician = parts.some(has) ? parts.reduce<number>((a, n) => a + z(n), 0) : null;
  const monthly = perClinician !== null && has(s.benClinicians) ? perClinician * s.benClinicians : null;
  const snap = snapshotFigures(s);
  const projectedProfit = snap.profit !== null && monthly !== null ? snap.profit - monthly : null;
  return {
    perClinician,
    monthly,
    annual: monthly !== null ? monthly * 12 : null,
    projectedProfit,
    projectedMargin: projectedProfit !== null && snap.revenue ? ratio(projectedProfit, snap.revenue) : null,
  };
}

/* ---------------------------------------------------------- Scenario Lab */

export function scenarioFigures(s: BoardroomState) {
  const before = snapshotFigures(s);
  const touched = [s.scRevenue, s.scCost, s.scDebt, s.scBenefits].some(has);
  if (before.revenue === null || before.profit === null || !touched) {
    return { before, after: null };
  }
  const revenue = before.revenue + z(s.scRevenue);
  const profit = before.profit + z(s.scRevenue) - z(s.scCost) - z(s.scDebt) - z(s.scBenefits);
  return { before, after: { revenue, profit, margin: ratio(profit, revenue) } };
}

/* ------------------------------------------------------------ CEO Report */

/** Decision-prep bullets, one per tab that has enough information. */
export function reportSections(s: BoardroomState): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = [];
  const snap = snapshotFigures(s);
  if (snap.revenue !== null) {
    out.push({
      title: "CEO Snapshot",
      lines: [
        `Monthly revenue ${money(snap.revenue)}, operating profit ${money(snap.profit)} (${pct(snap.margin)} margin).`,
        guardrailNote(s),
        ...(has(s.cash) ? [`Cash on hand ${money(s.cash)}.`] : []),
      ],
    });
  }
  const cap = capacityFigures(s);
  if (cap.booked !== null || cap.completed !== null) {
    const lines = [
      `Booked utilization ${pct(cap.booked)} (${versusGuardrail(cap.booked, cap.guard).toLowerCase()}); completed utilization ${pct(cap.completed)} (${versusGuardrail(cap.completed, cap.guard).toLowerCase()}) against a ${count(s.capGuardrail)}% guardrail, ${s.period} period.`,
    ];
    if (cap.perClinician !== null) lines.push(`Average completed per clinician: ${count(cap.perClinician)} ${s.method}.`);
    const scen = capacityScenario(s);
    if (scen.modeled !== null) lines.push(`At ${pct(scen.scenario)} utilization, modeled monthly revenue is ${money(scen.modeled)} (from ${money(scen.revenue)}).`);
    out.push({ title: "EHR + Capacity", lines });
  }
  const team = teamFigures(s);
  if (team.total !== null) {
    out.push({
      title: "Team + Pay",
      lines: [
        `Base wages ${money(team.wages)}; total employer cost ${money(team.total)}.`,
        team.contribution !== null ? `Contribution after employer cost: ${money(team.contribution)} (${pct(team.margin)} of collections).` : "Enter clinician collections to see contribution.",
      ],
    });
  }
  const ramp = rampModel(s);
  if (ramp) {
    out.push({
      title: "Hiring + Ramp-Up",
      lines: [
        ...ramp.rows.map((r) => `${r.label}: ${count(r.sessions)} sessions, ${money(r.revenue)} revenue, ${money(r.contribution)} contribution.`),
        `Cumulative breakeven: ${ramp.breakeven}.`,
      ],
    });
  }
  const owner = ownerFigures(s);
  if (owner.current !== null || owner.desired !== null) {
    out.push({
      title: "Owner Pay",
      lines: [
        `Current monthly compensation ${money(owner.current)}; desired ${money(owner.desired)}; additional needed ${money(owner.additional)}.`,
        ...(owner.rateNeeded !== null ? [`Hourly rate needed ${money2(owner.rateNeeded)} (increase of ${money2(owner.rateIncrease)}).`] : []),
        ...(owner.projectedProfit !== null ? [`Projected operating profit ${money(owner.projectedProfit)} (${pct(owner.projectedMargin)} margin).`] : []),
      ],
    });
  }
  const cash = cashFigures(s);
  if (cash.runway !== null || cash.target !== null) {
    out.push({
      title: "Cash Strategy",
      lines: [
        `Runway ${cash.runway !== null ? `${count(cash.runway)} months` : "—"} at ${money(cash.outflow)} monthly outflow.`,
        `Reserve target ${money(cash.target)}; gap ${money(cash.gap)}; suggested set-aside ${money(cash.setAside)}/month to close it in 12 months.`,
      ],
    });
  }
  const ben = benefitsFigures(s);
  if (ben.monthly !== null) {
    out.push({
      title: "Compensation + Benefits",
      lines: [
        `${money(ben.perClinician)} per clinician per month; ${money(ben.monthly)} monthly, ${money(ben.annual)} annually.`,
        ...(ben.projectedProfit !== null ? [`Projected operating profit ${money(ben.projectedProfit)} (${pct(ben.projectedMargin)} margin).`] : []),
      ],
    });
  }
  const sc = scenarioFigures(s);
  if (sc.after) {
    out.push({
      title: "Scenario Lab",
      lines: [
        `Before: ${money(sc.before.revenue)} revenue, ${money(sc.before.profit)} profit, ${pct(sc.before.margin)} margin.`,
        `After: ${money(sc.after.revenue)} revenue, ${money(sc.after.profit)} profit, ${pct(sc.after.margin)} margin.`,
      ],
    });
  }
  return out;
}

export const BOARDROOM_DISCLAIMER =
  "Strategic planning mockup only. Results depend on the information entered and do not replace accounting, tax, payroll, HR, legal, or financial advice.";
