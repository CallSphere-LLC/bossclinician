import { describe, expect, it } from "vitest";
import {
  ceil,
  countedChecks,
  exitDefaults,
  nextSteps,
  normaliseExit,
  projected,
  requiredSessions,
  reserveTarget,
  revenueTarget,
  runwayLabel,
  shortfall,
  summarise,
  take,
  benefit,
  usable,
  usd,
} from "./exitPlanner";

describe("Boss Move exit planner", () => {
  it("reproduces the prototype's figures for its example values", () => {
    const s = exitDefaults();
    expect(take(s)).toBe(4350);
    expect(benefit(s)).toBe(1090);
    expect(revenueTarget(s)).toBeCloseTo(8553.33, 2);
    expect(projected(s)).toBe(8970);
    expect(ceil(requiredSessions(s))).toBe("18");
    expect(shortfall(s)).toBe(5140);
    expect(reserveTarget(s)).toBe(22560);
    expect(usable(s)).toBe(10000);
    expect(runwayLabel(s, "No cash draw")).toBe("1.9 months");
    expect(usd(revenueTarget(s))).toBe("$8,553");
  });

  it("caps the tax reserve at 70% and needs a fee before counting sessions", () => {
    const s = { ...exitDefaults(), taxRate: 95 };
    expect(revenueTarget(s)).toBeCloseTo((4350 + 1090 + 300) / 0.3 + 900, 6);
    expect(requiredSessions({ ...exitDefaults(), avgFee: 0 })).toBe(Infinity);
    expect(ceil(Infinity)).toBe("—");
  });

  it("counts 'researched health coverage' only on the agency path", () => {
    expect(countedChecks(exitDefaults())).toHaveLength(21);
    expect(countedChecks({ ...exitDefaults(), path: "platform" })).toHaveLength(20);
    const s = { ...exitDefaults(), path: "rebuild" as const, checks: { fin1: true, fin2: true } };
    expect(summarise(s).done).toBe(1);
  });

  it("lists the reserve and revenue gaps before unchecked milestones", () => {
    const steps = nextSteps({ ...exitDefaults(), sessions: 10 });
    expect(steps[0]).toBe("Review your reserve plan; current estimated gap is $10,560.");
    expect(steps[1]).toMatch(/^Review the projected revenue gap of \$/);
    expect(steps).toHaveLength(5);
  });

  it("restores a backup over the defaults and drops what does not belong", () => {
    const s = normaliseExit({ path: "platform", living: "4100", sessions: -5, checks: { fin1: true, bogus: true }, extra: 1 });
    expect(s.path).toBe("platform");
    expect(s.living).toBe(4100);
    expect(s.sessions).toBe(0);
    expect(s.checks).toEqual({ fin1: true });
    expect("extra" in s).toBe(false);
    expect(normaliseExit({ path: "nope" }).path).toBe("agency");
  });
});
