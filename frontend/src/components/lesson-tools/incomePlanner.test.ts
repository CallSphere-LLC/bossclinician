import { describe, expect, it } from "vitest";
import { exitDefaults, normaliseExit, summaryLines } from "./exitPlanner";
import {
  MAX_AMOUNT,
  NO_CONTRIBUTION,
  cents,
  dollars,
  freedomFigures,
  freedomNumber,
  gapLabel,
  goalStatus,
  idealSchedule,
  normaliseFreedom,
  ptoWeeks,
  savingsPlan,
  snapshotRows,
  workWeeksFromPto,
} from "./incomePlanner";

const illustration = {
  ownerIncome: 100_000,
  annualOpex: 30_000,
  annualBenefits: null,
  annualReserve: null,
  workWeeks: 46,
  paidSessionsPerWeek: 20,
  completionPct: 90,
  currentRate: 130,
};

describe("My Freedom Number", () => {
  it("reproduces the doc's illustrative scenario", () => {
    const r = freedomNumber(illustration);
    expect(r.requiredRevenue).toBe(130_000);
    expect(r.annualPaidSessions).toBe(920);
    expect(r.requiredRate).toBeCloseTo(141.3043, 4);
    expect(cents(r.requiredRate)).toBe("$141.30");
    expect(dollars(r.requiredRevenue)).toBe("$130,000");
  });

  it("adds each cost category exactly once", () => {
    const r = freedomNumber({ ...illustration, annualBenefits: 8_000, annualReserve: 2_000 });
    expect(r.requiredRevenue).toBe(140_000);
  });

  it("schedules extra appointments for cancellations and unpaid sessions", () => {
    const r = freedomNumber(illustration);
    expect(r.weeklyAppointments).toBeCloseTo(20 / 0.9, 6);
    expect(r.annualAppointments).toBeCloseTo((20 / 0.9) * 46, 6);
    // Paid sessions are not the same as booked appointments.
    expect(r.weeklyPaidSessions).toBe(20);
  });

  it("compares current projected revenue with the target", () => {
    const r = freedomNumber(illustration);
    expect(r.projectedRevenue).toBe(920 * 130);
    expect(r.difference).toBe(119_600 - 130_000);
    expect(gapLabel(r.difference)).toBe("$10,400 gap");
    expect(gapLabel(5_000)).toBe("$5,000 surplus");
  });

  it("handles blank and zero denominators without NaN or Infinity", () => {
    const blank = freedomNumber({ ...illustration, ownerIncome: null });
    expect(blank.requiredRevenue).toBeNull();
    expect(blank.requiredRate).toBeNull();
    expect(cents(blank.requiredRate)).toBe("—");

    const noWeeks = freedomNumber({ ...illustration, workWeeks: 0 });
    expect(noWeeks.annualPaidSessions).toBeNull();
    expect(noWeeks.requiredRate).toBeNull();

    const noSessions = freedomNumber({ ...illustration, paidSessionsPerWeek: 0 });
    expect(noSessions.requiredRate).toBeNull();
    expect(noSessions.weeklyAppointments).toBeNull();

    const noRate = freedomNumber({ ...illustration, completionPct: 0 });
    expect(noRate.weeklyAppointments).toBeNull();

    const noFee = freedomNumber({ ...illustration, currentRate: 0 });
    expect(noFee.projectedRevenue).toBeNull();
    expect(noFee.difference).toBeNull();
  });

  it("caps impossible weeks, percentages and huge amounts", () => {
    expect(freedomNumber({ ...illustration, workWeeks: 60 }).annualPaidSessions).toBe(20 * 52);
    expect(freedomNumber({ ...illustration, completionPct: 250 }).weeklyAppointments).toBe(20);
    const huge = freedomNumber({ ...illustration, ownerIncome: 1e15, annualOpex: -5 });
    expect(huge.requiredRevenue).toBe(MAX_AMOUNT);
    expect(Number.isFinite(huge.requiredRate)).toBe(true);
  });

  it("keeps working weeks and vacation weeks consistent", () => {
    expect(ptoWeeks(46)).toBe(6);
    expect(workWeeksFromPto(6)).toBe(46);
    expect(ptoWeeks(70)).toBe(0);
    expect(workWeeksFromPto(80)).toBe(0);
  });
});

describe("My Ideal Work Schedule (start with the schedule)", () => {
  it("derives paid sessions, collections and the rate the schedule needs", () => {
    const r = idealSchedule({ daysPerWeek: 4, sessionsPerDay: 6, workWeeks: 46, completionPct: 90, currentRate: 130, requiredRevenue: 130_000 });
    expect(r.weeklyScheduled).toBe(24);
    expect(r.weeklyPaidSessions).toBeCloseTo(21.6, 6);
    expect(r.annualPaidSessions).toBeCloseTo(993.6, 6);
    expect(r.annualCollections).toBeCloseTo(129_168, 4);
    expect(r.difference).toBeCloseTo(-832, 4);
    expect(r.requiredRate).toBeCloseTo(130_000 / 993.6, 6);
  });

  it("returns blanks rather than errors when inputs are missing", () => {
    const r = idealSchedule({ daysPerWeek: null, sessionsPerDay: 6, workWeeks: 46, completionPct: 90, currentRate: 130, requiredRevenue: null });
    expect(r.weeklyScheduled).toBeNull();
    expect(r.annualCollections).toBeNull();
    expect(r.requiredRate).toBeNull();
  });
});

describe("My Cash Reserve Plan", () => {
  const today = new Date(2026, 10, 21);

  it("calculates the target, remaining amount, percentage and months to target", () => {
    const r = savingsPlan({ monthlyNeed: 2_500, months: 3, saved: 1_500, monthlyContribution: 1_000 }, today);
    expect(r.target).toBe(7_500);
    expect(r.remaining).toBe(6_000);
    expect(r.percent).toBe(20);
    expect(r.monthsToTarget).toBe(6);
    expect(r.targetDate?.getFullYear()).toBe(2027);
    expect(r.targetDate?.getMonth()).toBe(4); // May 2027
  });

  it("never lets the remaining amount go negative", () => {
    const r = savingsPlan({ monthlyNeed: 2_500, months: 6, saved: 50_000, monthlyContribution: 0 }, today);
    expect(r.remaining).toBe(0);
    expect(r.percent).toBe(100);
    expect(r.monthsToTarget).toBe(0);
  });

  it("asks for a contribution instead of dividing by zero", () => {
    const r = savingsPlan({ monthlyNeed: 2_500, months: 4, saved: 0, monthlyContribution: 0 }, today);
    expect(r.target).toBe(10_000);
    expect(r.monthsToTarget).toBeNull();
    expect(r.targetDate).toBeNull();
    expect(NO_CONTRIBUTION).toBe("Add a monthly contribution to estimate a completion date");
  });

  it("has no target until expenses are entered", () => {
    const r = savingsPlan({ monthlyNeed: null, months: 3, saved: 500, monthlyContribution: 100 }, today);
    expect(r.target).toBeNull();
    expect(r.remaining).toBeNull();
    expect(r.percent).toBeNull();
  });

  it("keeps business reserves and personal savings separate", () => {
    const s = exitDefaults();
    s.freedom = {
      ...s.freedom,
      reserveExpenses: 2_000,
      reserveMonths: 3,
      reserveSaved: 3_000,
      personalLiving: 4_000,
      personalBenefits: 600,
      personalMonths: 6,
      personalSaved: 10_000,
    };
    const fig = freedomFigures(s, today);
    expect(fig.reserve.target).toBe(6_000);
    expect(fig.reserve.saved).toBe(3_000);
    expect(fig.personal.target).toBe(27_600);
    expect(fig.personal.saved).toBe(10_000);
  });
});

describe("My Exit Readiness Snapshot", () => {
  it("labels goals without declaring anyone ready to resign", () => {
    expect(goalStatus(150, 141.3).label).toBe("Goal reached");
    expect(goalStatus(100, 141.3).label).toBe("Progress toward goal");
    expect(goalStatus(0, 141.3).label).toBe("Needs review");
    expect(goalStatus(100, null).label).toBe("Needs review");

    const rows = snapshotRows(exitDefaults());
    expect(rows).toHaveLength(7);
    const text = rows.map((r) => `${r.value} ${r.note} ${r.status?.label ?? ""}`).join(" ").toLowerCase();
    expect(text).not.toMatch(/cleared to resign|ready to resign|safe to quit/);
  });
});

describe("saved planners", () => {
  it("loads a planner saved before the update exactly as it was", () => {
    const legacy = { path: "platform", living: 4100, avgFee: 150, workWeeks: 44, checks: { fin1: true } };
    const s = normaliseExit(legacy);
    expect(s.path).toBe("platform");
    expect(s.living).toBe(4100);
    expect(s.avgFee).toBe(150);
    expect(s.workWeeks).toBe(44);
    expect(s.checks).toEqual({ fin1: true });
    expect(s.freedom.ownerIncome).toBeNull();
    expect(s.freedom.mode).toBe("income");
  });

  it("round-trips the new entries and drops bad values", () => {
    const f = normaliseFreedom({ ownerIncome: "100000", annualOpex: -3, mode: "schedule", reserveMonths: 5, daysPerWeek: "abc", junk: 1 });
    expect(f.ownerIncome).toBe(100_000);
    expect(f.annualOpex).toBe(0);
    expect(f.mode).toBe("schedule");
    expect(f.reserveMonths).toBe(3);
    expect(f.daysPerWeek).toBeNull();
    expect("junk" in f).toBe(false);
    expect(normaliseFreedom(normaliseFreedom({ reserveMonths: 6 })).reserveMonths).toBe(6);
  });

  it("puts the member's own figures in the printable summary", () => {
    const s = exitDefaults();
    s.sessions = 20;
    s.workWeeks = 46;
    s.freedom = { ...s.freedom, ownerIncome: 100_000, annualOpex: 30_000 };
    const text = summaryLines(s).join("\n");
    expect(text).toContain("Required annual practice revenue: $130,000");
    expect(text).toContain("Required average collections per paid session: $141.30");
    expect(text).toContain("MY EXIT READINESS SNAPSHOT");
    expect(text).toContain("not after-tax take-home pay");
  });
});
