import { describe, expect, it } from "vitest";
import {
  benefitsFigures,
  boardroomDefaults,
  boardroomNumberProblem,
  capacityFigures,
  capacityScenario,
  cashFigures,
  guardrailNote,
  money,
  money2,
  normaliseBoardroom,
  ownerFigures,
  pct,
  rampModel,
  reportSections,
  scenarioFigures,
  snapshotFigures,
  teamFigures,
  versusGuardrail,
  type BoardroomNumberKey,
} from "./boardroom";

const base = () => ({ ...boardroomDefaults(), revenue: 50000, cogs: 25000, opex: 15000, cash: 30000 });

describe("Boardroom CEO dashboard", () => {
  it("starts blank: every result is a dash and the report is empty", () => {
    const s = boardroomDefaults();
    expect(money(snapshotFigures(s).profit)).toBe("—");
    expect(guardrailNote(s)).toBe("Enter your business numbers to see the comparison.");
    expect(rampModel(s)).toBeNull();
    expect(scenarioFigures(s).after).toBeNull();
    expect(reportSections(s)).toEqual([]);
  });

  it("CEO Snapshot: profit, margin and the 15% guardrail", () => {
    const f = snapshotFigures(base());
    expect(f.profit).toBe(10000);
    expect(pct(f.margin)).toBe("20.0%");
    expect(f.guardrail).toBe(7500);
    expect(guardrailNote(base())).toBe("Operating profit of $10,000 is $2,500 above your 15% guardrail of $7,500.");
  });

  it("capacity: utilization against the 85% guardrail and the proportional scenario", () => {
    const s = { ...base(), clinicians: 4, capTarget: 400, capScheduled: 360, capCompleted: 320, scenarioUtil: 85 };
    const c = capacityFigures(s);
    expect(c.booked).toBeCloseTo(0.9);
    expect(c.completed).toBeCloseTo(0.8);
    expect(c.perClinician).toBe(80);
    expect(versusGuardrail(c.booked, c.guard)).toBe("Above by 5.0 pts");
    expect(versusGuardrail(c.completed, c.guard)).toBe("Below by 5.0 pts");
    expect(capacityScenario(s).modeled).toBeCloseTo(53125);
  });

  it("capacity scenario: typed current utilization and revenue override the derived ones", () => {
    const s = { ...base(), capTarget: 400, capCompleted: 320, scenarioUtil: 85 };
    expect(capacityScenario({ ...s, capCurrentUtil: 68 }).modeled).toBeCloseTo(62500);
    expect(capacityScenario({ ...s, capRevenue: 40000 }).modeled).toBeCloseTo(42500);
    // No capacity data or snapshot at all: the three typed inputs are enough, as in the mockup.
    const typed = capacityScenario({ ...boardroomDefaults(), capCurrentUtil: 70, scenarioUtil: 84, capRevenue: 30000 });
    expect(typed.modeled).toBeCloseTo(36000);
    expect(typed.derivedCurrent).toBeNull();
    expect(reportSections({ ...boardroomDefaults(), capCurrentUtil: 70, scenarioUtil: 84, capRevenue: 30000 }).map((r) => r.title)).toEqual(["EHR + Capacity"]);
  });

  it("team pay by structure", () => {
    const hourly = { ...base(), teamCollections: 12000, teamTaxes: 600, teamBenefits: 400, clinRate: 45, clinHours: 100, nonclinRate: 25, nonclinHours: 20 };
    expect(teamFigures(hourly)).toMatchObject({ wages: 5000, total: 6000, contribution: 6000 });
    expect(teamFigures({ ...hourly, compStructure: "split", splitPct: 60 }).wages).toBe(7200);
    expect(teamFigures({ ...hourly, compStructure: "salary", salaryMonthly: 6500 }).total).toBe(7500);
    expect(teamFigures({ ...hourly, compStructure: "session", sessionRate: 60, sessionsPaid: 80, nonclinRate: null }).wages).toBe(4800);
  });

  it("hiring ramp: monthly rows, cumulative and breakeven", () => {
    const s = { ...base(), hireTarget: 100, hireAvgRevenue: 120, hireCost: 7000, hireOverhead: 500, hireM1: 30, hireM2: 55, hireM3: 75, hireSteady: 85 };
    const model = rampModel(s)!;
    expect(model.rows.map((r) => r.contribution)).toEqual([-3900, -900, 1500, 2700]);
    expect(model.rows[2].cumulative).toBe(-3300);
    expect(model.breakeven).toBe("Month 5 (at steady-state utilization from month 4)");
    expect(rampModel({ ...s, hireM1: 90 })!.breakeven).toBe("Month 1");
  });

  it("owner pay increase calculator", () => {
    const o = ownerFigures({ ...base(), ownerRate: 50, ownerHours: 30, ownerDesired: 9750 });
    expect(o.current).toBeCloseTo(6500);
    expect(o.additional).toBeCloseTo(3250);
    expect(o.rateNeeded).toBeCloseTo(75);
    expect(o.rateIncrease).toBeCloseTo(25);
    expect(o.projectedProfit).toBeCloseTo(6750);
    expect(pct(o.projectedMargin)).toBe("13.5%");
  });

  it("cash strategy falls back to the snapshot's costs", () => {
    const c = cashFigures({ ...base(), cashDebt: 1000 });
    expect(c.outflow).toBe(41000);
    expect(c.runway).toBeCloseTo(30000 / 41000);
    expect(c.target).toBe(123000);
    expect(c.gap).toBe(93000);
    expect(c.setAside).toBe(7750);
    expect(cashFigures({ ...base(), cashExpenses: 10000 }).outflow).toBe(10000);
  });

  it("benefits and scenario lab", () => {
    const b = benefitsFigures({ ...base(), benClinicians: 3, benHealth: 400, benRetirement: 100 });
    expect(b).toMatchObject({ perClinician: 500, monthly: 1500, annual: 18000, projectedProfit: 8500 });
    const sc = scenarioFigures({ ...base(), scRevenue: 5000, scCost: 2000, scDebt: 500 });
    expect(sc.after).toEqual({ revenue: 55000, profit: 12500, margin: 12500 / 55000 });
  });

  it("restores defensively", () => {
    const s = normaliseBoardroom({ revenue: 1000, cogs: "x", period: "yearly", compStructure: "split", extra: 1 });
    expect(s.revenue).toBe(1000);
    expect(s.cogs).toBeNull();
    expect(s.period).toBe("monthly");
    expect(s.compStructure).toBe("split");
    expect("extra" in s).toBe(false);
  });

  it("an entry saved before the capacity overrides existed still loads, with the new fields blank", () => {
    const s = normaliseBoardroom({ revenue: 1000, scenarioUtil: 90, capGuardrail: 80 });
    expect(s).toMatchObject({ revenue: 1000, scenarioUtil: 90, capGuardrail: 80, capCurrentUtil: null, capRevenue: null });
  });
});

describe("Boardroom financial review: worked examples and boundaries", () => {
  it("agrees with the supplied prototype's sample after mapping revenue, payroll and overhead", () => {
    // Prototype calc(): clinical 62,000 + other 3,200; payroll 29,000;
    // overhead 11,500. Its separate 4,500 owner draw is not deducted.
    const f = snapshotFigures({ ...boardroomDefaults(), revenue: 65200, cogs: 29000, opex: 11500 });
    expect(f.profit).toBe(24700);
    expect(f.margin).toBeCloseTo(0.3788343558);
    expect(f.guardrail).toBe(9780);
  });

  it("keeps losses visible and does not manufacture a margin on zero revenue", () => {
    const loss = snapshotFigures({ ...base(), revenue: 20000 });
    expect(loss.profit).toBe(-20000);
    expect(loss.margin).toBe(-1);
    expect(snapshotFigures({ ...base(), revenue: 0 })).toMatchObject({ profit: -40000, margin: null, guardrail: 0 });
    expect(guardrailNote({ ...base(), cogs: 27500 })).toContain("right at your 15% guardrail");
    expect(guardrailNote({ ...base(), cogs: 30000 })).toContain("$2,500 below");
  });

  it("distinguishes missing and zero capacity denominators from actual zero utilization", () => {
    const s = { ...base(), capScheduled: 0, capCompleted: 0, clinicians: 0, scenarioUtil: 85 };
    for (const capTarget of [null, 0]) {
      expect(capacityFigures({ ...s, capTarget })).toMatchObject({ booked: null, completed: null, perClinician: null });
    }
    expect(capacityFigures({ ...s, capTarget: 100 })).toMatchObject({ booked: 0, completed: 0 });
    expect(capacityScenario({ ...s, capTarget: 100 }).modeled).toBeNull();
    expect(capacityScenario({ ...s, capCurrentUtil: 0 }).modeled).toBeNull();
    expect(capacityScenario({ ...s, capCurrentUtil: 80, scenarioUtil: 0 }).modeled).toBe(0);
    expect(capacityScenario({ ...s, capCurrentUtil: 80, capRevenue: 0 }).modeled).toBe(0);
    expect(versusGuardrail(0.85, 0.85)).toBe("At guardrail");
  });

  it.each([
    { structure: "hourly" as const, wages: 5000, total: 6500, contribution: 5500 },
    { structure: "session" as const, wages: 5300, total: 6800, contribution: 5200 },
    { structure: "split" as const, wages: 7200, total: 8700, contribution: 3300 },
    { structure: "salary" as const, wages: 6500, total: 8000, contribution: 4000 },
  ])("includes all employer costs for $structure pay, without stale hidden wages", ({ structure, wages, total, contribution }) => {
    const f = teamFigures({
      ...base(), compStructure: structure, teamCollections: 12000,
      clinRate: 45, clinHours: 100, nonclinRate: 25, nonclinHours: 20,
      sessionRate: 60, sessionsPaid: 80, splitPct: 60, salaryMonthly: 6500,
      teamTaxes: 600, teamBenefits: 400, teamSupervision: 300, teamOther: 200,
    });
    expect(f).toMatchObject({ wages, total, contribution });
    expect(f.margin).toBeCloseTo(contribution / 12000);
  });

  it("keeps zero-collection employer losses but leaves their percentage undefined", () => {
    expect(teamFigures({ ...base(), compStructure: "salary", salaryMonthly: 1000, teamCollections: 0 }))
      .toEqual({ wages: 1000, total: 1000, contribution: -1000, margin: null });
  });

  it("hiring: recovers cumulative losses exactly in month 4 and does not round to month 5", () => {
    const s = { ...base(), hireTarget: 100, hireAvgRevenue: 100, hireCost: 6000, hireOverhead: 0,
      hireM1: 40, hireM2: 60, hireM3: 70, hireSteady: 70 };
    const m = rampModel(s)!;
    expect(m.rows.map((r) => r.sessions)).toEqual([40, 60, 70, 70]);
    expect(m.rows.map((r) => r.revenue)).toEqual([4000, 6000, 7000, 7000]);
    expect(m.rows.map((r) => r.cost)).toEqual([6000, 6000, 6000, 6000]);
    expect(m.rows.map((r) => r.cumulative)).toEqual([-2000, -2000, -1000, null]);
    expect(m.breakeven).toBe("Month 4 (at steady-state utilization from month 4)");
    expect(rampModel({ ...s, hireM3: 80 })!.breakeven).toBe("Month 3");
    expect(rampModel({ ...s, hireSteady: 60 })!.breakeven).toBe("Not reached at these assumptions");
    expect(rampModel({ ...s, hireSteady: 50 })!.breakeven).toBe("Not reached at these assumptions");
  });

  it("owner pay: zero hours do not produce an hourly rate; a pay reduction preserves its sign", () => {
    expect(ownerFigures({ ...base(), ownerRate: 50, ownerHours: 0, ownerDesired: 9750 }))
      .toMatchObject({ current: 0, additional: 9750, rateNeeded: null, rateIncrease: null, projectedProfit: 250 });
    const o = ownerFigures({ ...base(), ownerRate: 50, ownerHours: 30, ownerDesired: 5200 });
    expect(o.additional).toBeCloseTo(-1300);
    expect(o.rateNeeded).toBeCloseTo(40);
    expect(o.rateIncrease).toBeCloseTo(-10);
    expect(o.projectedProfit).toBeCloseTo(11300);
  });

  it("cash: an explicit zero expense override, a funded reserve and missing cash stay distinct", () => {
    expect(cashFigures({ ...base(), cashExpenses: 0, cashDebt: 0 }))
      .toMatchObject({ expenses: 0, outflow: 0, runway: null, target: 0, gap: 0, setAside: 0, usingSnapshot: false });
    expect(cashFigures({ ...base(), cash: 40000, cashExpenses: 10000 }))
      .toMatchObject({ runway: 4, target: 30000, gap: 0, setAside: 0 });
    expect(cashFigures({ ...base(), cash: null, cashExpenses: 10000 }))
      .toMatchObject({ runway: null, target: 30000, gap: null, setAside: null });
  });

  it("benefits: includes all six monthly components and annualizes once", () => {
    const s = { ...base(), benClinicians: 3, benHealth: 400, benRetirement: 100,
      benPto: 80, benCeu: 20, benSupervision: 50, benOther: 10 };
    expect(benefitsFigures(s)).toEqual({
      perClinician: 660, monthly: 1980, annual: 23760, projectedProfit: 8020, projectedMargin: 0.1604,
    });
    expect(benefitsFigures({ ...s, benClinicians: 0 })).toMatchObject({ monthly: 0, annual: 0, projectedProfit: 10000 });
  });

  it("scenario: includes all four deltas and divides by the new revenue", () => {
    expect(scenarioFigures({ ...base(), scRevenue: 5000, scCost: 2000, scDebt: 500, scBenefits: 1500 }).after)
      .toEqual({ revenue: 55000, profit: 11000, margin: 0.2 });
    expect(scenarioFigures({ ...base(), scRevenue: 0 }).after)
      .toEqual({ revenue: 50000, profit: 10000, margin: 0.2 });
    expect(scenarioFigures({ ...base(), revenue: 0, scCost: 0 }).after?.margin).toBeNull();
  });

  it("CEO Report preserves the worked figures from all eight calculator sections", () => {
    const s = {
      ...base(), clinicians: 4, capTarget: 400, capScheduled: 360, capCompleted: 320, scenarioUtil: 85,
      compStructure: "salary" as const, salaryMonthly: 6500, teamCollections: 12000,
      teamTaxes: 600, teamBenefits: 400, teamSupervision: 300, teamOther: 200,
      hireTarget: 100, hireAvgRevenue: 120, hireCost: 7000, hireOverhead: 500,
      hireM1: 30, hireM2: 55, hireM3: 75, hireSteady: 85,
      ownerRate: 50, ownerHours: 30, ownerDesired: 9750, cashDebt: 1000,
      benClinicians: 3, benHealth: 400, benRetirement: 100, benPto: 80, benCeu: 20, benSupervision: 50, benOther: 10,
      scRevenue: 5000, scCost: 2000, scDebt: 500, scBenefits: 1500,
    };
    const sections = reportSections(s);
    expect(sections.map((r) => r.title)).toEqual([
      "CEO Snapshot", "EHR + Capacity", "Team + Pay", "Hiring + Ramp-Up",
      "Owner Pay", "Cash Strategy", "Compensation + Benefits", "Scenario Lab",
    ]);
    const lines = sections.flatMap((r) => r.lines);
    expect(lines).toContain("Monthly revenue $50,000, operating profit $10,000 (20.0% margin).");
    expect(lines).toContain("Moving from 80.0% to 85.0% utilization models monthly revenue of $53,125 (from $50,000).");
    expect(lines).toContain("Base wages $6,500; total employer cost $8,000.");
    expect(lines).toContain("Cumulative breakeven: Month 5 (at steady-state utilization from month 4).");
    expect(lines).toContain("Projected operating profit $6,750 (13.5% margin).");
    expect(lines).toContain("Reserve target $123,000; gap $93,000; suggested set-aside $7,750/month to close it in 12 months.");
    expect(lines).toContain("$660 per clinician per month; $1,980 monthly, $23,760 annually.");
    expect(lines).toContain("After: $55,000 revenue, $11,000 profit, 20.0% margin.");
  });

  it("formats undefined results separately from zero and preserves cents on hourly pay", () => {
    expect(money(null)).toBe("—");
    expect(money(0)).toBe("$0");
    expect(money2(50.125)).toBe("$50.13");
    expect(pct(null)).toBe("—");
    expect(pct(0)).toBe("0.0%");
    expect(normaliseBoardroom({ revenue: NaN, cogs: Infinity, opex: -Infinity }))
      .toMatchObject({ revenue: null, cogs: null, opex: null });
  });
});

describe("Boardroom numeric input bounds", () => {
  it("rejects restored negative cash expenses without creating negative runway or reserves", () => {
    const restored = normaliseBoardroom({ ...base(), cashExpenses: -100 });
    expect(restored.cashExpenses).toBeNull();
    expect(boardroomNumberProblem("cashExpenses", -100)).toBe("Enter 0 or greater.");
    // Rejected override uses the existing snapshot fallback, not a new formula.
    expect(cashFigures(restored)).toMatchObject({
      expenses: 40000, outflow: 40000, runway: 0.75, target: 120000, usingSnapshot: true,
    });
    const missing = normaliseBoardroom({ cash: 30000, cashExpenses: -100 });
    expect(cashFigures(missing)).toMatchObject({ outflow: null, runway: null, target: null });
  });

  it("rejects restored negative utilization without creating negative modeled revenue", () => {
    const restored = normaliseBoardroom({ ...base(), capCurrentUtil: -20, scenarioUtil: 85 });
    expect(restored.capCurrentUtil).toBeNull();
    expect(capacityScenario(restored).modeled).toBeNull();
    const derived = normaliseBoardroom({ ...restored, capCurrentUtil: -20, capTarget: 400, capCompleted: 320 });
    expect(capacityScenario(derived).modeled).toBe(53125);
    expect(capacityScenario(normaliseBoardroom({ ...derived, scenarioUtil: -85 })).modeled).toBeNull();
    expect(capacityScenario(normaliseBoardroom({ ...derived, capRevenue: -50000 })).modeled).toBe(53125);
  });

  it("rejects negative magnitudes across every numeric input while preserving zero and blank", () => {
    const defaults = boardroomDefaults();
    const keys = (Object.keys(defaults) as (keyof typeof defaults)[])
      .filter((key) => typeof defaults[key] !== "string") as BoardroomNumberKey[];
    for (const key of keys) {
      expect(boardroomNumberProblem(key, -0.01), key).toBe("Enter 0 or greater.");
      expect(normaliseBoardroom({ [key]: -0.01 })[key], key).toBe(defaults[key]);
      expect(boardroomNumberProblem(key, 0), key).toBeNull();
      expect(normaliseBoardroom({ [key]: 0 })[key], key).toBe(0);
      expect(boardroomNumberProblem(key, null), key).toBeNull();
      expect(normaliseBoardroom({ [key]: null })[key], key).toBeNull();
    }
  });

  it.each(["guardrailPct", "capGuardrail", "capCurrentUtil", "scenarioUtil", "splitPct"] as const)(
    "enforces the existing 0–100 bound for %s", (key) => {
      expect(boardroomNumberProblem(key, 100.01)).toBe("Enter 100 or less.");
      expect(normaliseBoardroom({ [key]: 100.01 })[key]).toBe(boardroomDefaults()[key]);
      for (const value of [0, 33.33, 100]) {
        expect(boardroomNumberProblem(key, value)).toBeNull();
        expect(normaliseBoardroom({ [key]: value })[key]).toBe(value);
      }
    },
  );

  it("does not invent upper bounds or integer rounding for other inputs", () => {
    const restored = normaliseBoardroom({ hireM1: 120.5, hireM2: 110, hireM3: 105, hireSteady: 125,
      capTarget: 400, capCompleted: 480, clinicians: 2.5, revenue: 50000 });
    expect(restored).toMatchObject({ hireM1: 120.5, hireM2: 110, hireM3: 105, hireSteady: 125, clinicians: 2.5 });
    expect(capacityFigures(restored).completed).toBe(1.2);
    expect(boardroomNumberProblem("hireM1", 120.5)).toBeNull();
    expect(boardroomNumberProblem("revenue", 50000)).toBeNull();
  });

  it("rejects nonfinite and wrong-type values without changing absent/default behavior", () => {
    for (const value of [NaN, Infinity, -Infinity, "10", false, {}]) {
      expect(boardroomNumberProblem("cashExpenses", value)).toBe("Enter a finite number.");
      expect(normaliseBoardroom({ cashExpenses: value }).cashExpenses).toBeNull();
    }
    expect(normaliseBoardroom({ guardrailPct: undefined, cashReserveMonths: undefined })).toEqual(boardroomDefaults());
    expect(normaliseBoardroom(boardroomDefaults())).toEqual(boardroomDefaults());
  });

  it("enforces Additional/Extra scenario input magnitudes without clamping computed losses or reductions", () => {
    const restored = normaliseBoardroom({ ...base(), scRevenue: -500, scCost: -100, scDebt: -20, scBenefits: -50 });
    expect(restored).toMatchObject({ scRevenue: null, scCost: null, scDebt: null, scBenefits: null });
    expect(scenarioFigures(restored).after).toBeNull();
    expect(scenarioFigures(normaliseBoardroom({ ...base(), scCost: 15000 })).after)
      .toEqual({ revenue: 50000, profit: -5000, margin: -0.1 });
    const owner = ownerFigures(normaliseBoardroom({ ...base(), ownerRate: 50, ownerHours: 30, ownerDesired: 5200 }));
    expect(owner.additional).toBeCloseTo(-1300);
    expect(owner.rateIncrease).toBeCloseTo(-10);
  });
});
