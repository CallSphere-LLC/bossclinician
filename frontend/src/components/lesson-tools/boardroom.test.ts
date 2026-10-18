import { describe, expect, it } from "vitest";
import {
  benefitsFigures,
  boardroomDefaults,
  capacityFigures,
  capacityScenario,
  cashFigures,
  guardrailNote,
  money,
  normaliseBoardroom,
  ownerFigures,
  pct,
  rampModel,
  reportSections,
  scenarioFigures,
  snapshotFigures,
  teamFigures,
  versusGuardrail,
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
});
