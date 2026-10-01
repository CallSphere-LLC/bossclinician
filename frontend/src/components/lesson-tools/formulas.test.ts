import { describe, expect, it } from "vitest";
import { parseAmount, ptoSetAside, rampUpRate, rateComparison, usd } from "./formulas";

describe("lesson-tool formulas", () => {
  it("ramp-up rate reproduces the Kajabi defaults", () => {
    expect(rampUpRate({ annualSalary: 50000, sessionsPerWeek: 10, weeksPerYear: 50, annualExpenses: 10000 }))
      .toEqual({ billableHours: 500, rate: 120 });
  });

  it("ramp-up rate refuses zero billable hours", () => {
    expect(rampUpRate({ annualSalary: 50000, sessionsPerWeek: 0, weeksPerYear: 50, annualExpenses: 0 })).toBeNull();
    expect(rampUpRate({ annualSalary: Number.NaN, sessionsPerWeek: 10, weeksPerYear: 50, annualExpenses: 0 })).toBeNull();
  });

  it("rate comparison matches the figures Kajabi rendered", () => {
    expect(rateComparison(10, 100)).toEqual({ weekly: 1000, monthly: 4000, annual: 48000 });
    expect(rateComparison(10, 125)).toEqual({ weekly: 1250, monthly: 5000, annual: 60000 });
    expect(rateComparison(10, 150)).toEqual({ weekly: 1500, monthly: 6000, annual: 72000 });
  });

  it("PTO set-aside follows salary / 52 × weeks, spread over 12 months", () => {
    const result = ptoSetAside(6000, 4)!;
    expect(result.reserve).toBeCloseTo(5538.46, 2);
    expect(result.monthly).toBeCloseTo(461.54, 2);
  });

  it("formats and parses amounts", () => {
    expect(usd(48000)).toBe("48,000 USD");
    expect(usd(null)).toBe("—");
    expect(parseAmount("$1,250")).toBe(1250);
    expect(Number.isNaN(parseAmount(""))).toBe(true);
  });
});
