import { describe, expect, it } from "vitest";
import {
  PROFILES,
  changePathway,
  collectionsDelta,
  elevationDefaults,
  finishCycle,
  generatePlan,
  nextMove,
  normaliseElevation,
} from "./practiceElevation";
import {
  answersFromPrototype,
  isComplete,
  normaliseSnapshot,
  scoreAnswers,
  snapshotPathway,
} from "./practiceSnapshot";

const allAnswers = (value: string, direction = "numbers"): Record<string, string> => {
  const answers: Record<string, string> = {};
  for (let i = 1; i <= 10; i += 1) answers[String(i)] = value;
  answers["11"] = direction;
  return answers;
};

describe("Practice Reset Snapshot in the course", () => {
  it("scores exactly like the public page (≤18 / ≤30 / above)", () => {
    expect(scoreAnswers(allAnswers("1"))).toBe("optimizer"); // 10
    expect(scoreAnswers(allAnswers("2"))).toBe("maxedout"); // 20
    expect(scoreAnswers(allAnswers("3"))).toBe("maxedout"); // 30
    expect(scoreAnswers(allAnswers("4"))).toBe("depleted"); // 40
  });

  it("needs questions 1–11; the reflection is optional", () => {
    const answers = allAnswers("2");
    expect(isComplete(answers)).toBe(true);
    delete answers["11"];
    expect(isComplete(answers)).toBe(false);
  });

  it("maps question 11 to the dashboard pathway and C/D answers to flags (prototype derive)", () => {
    expect(snapshotPathway(allAnswers("1", "rate"))).toEqual({ focus: "revenue", flags: [] });
    expect(snapshotPathway(allAnswers("1", "systems")).focus).toBe("systems");
    expect(snapshotPathway(allAnswers("1", "pay")).focus).toBe("owner");
    expect(snapshotPathway({}).focus).toBe("clarity");
    expect(snapshotPathway(allAnswers("3", "numbers")).flags).toEqual([
      "Current Model Audit first: effective rate is unclear.",
      "Platform/payer dependency needs evaluation.",
      "Consider reviewing the private-pay rate strategy.",
      "Owner pay needs attention.",
      "Systems gap: assess administrative workload.",
    ]);
  });

  it("drops answers that are not options and a result without answers", () => {
    const s = normaliseSnapshot({ answers: { "1": "9", "2": "3", "11": "rate" }, result: "depleted", reflection: 5 });
    expect(s.answers).toEqual({ "2": "3", "11": "rate" });
    expect(s.result).toBeNull();
    expect(s.reflection).toBe("");
  });

  it("reads a standalone-prototype backup's index answers", () => {
    const legacy = answersFromPrototype([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, "and I am tired"])!;
    expect(legacy.answers["1"]).toBe("1");
    expect(legacy.answers["4"]).toBe("4");
    expect(legacy.answers["11"]).toBe("pay");
    expect(legacy.reflection).toBe("and I am tired");
  });
});

describe("Practice Elevation dashboard", () => {
  it("generates the pathway's goals and twelve fresh tasks", () => {
    const s = generatePlan(elevationDefaults(), "systems", ["Systems gap: assess administrative workload."]);
    expect(s.snapshotDone).toBe(true);
    expect(s.goals).toEqual(PROFILES.systems.goals);
    expect(s.status).toHaveLength(12);
    expect(nextMove(s)).toBe("Log recurring administrative tasks");
    const one = { ...s, status: s.status.map((x, i) => (i === 0 ? ("Completed" as const) : x)) };
    expect(nextMove(one)).toBe("Choose one bottleneck");
  });

  it("archives the cycle and resets to clarity when advancing", () => {
    const start = { ...generatePlan(elevationDefaults(), "revenue", []), review: { wins: "Raised rate", direction: "advance" as const } };
    const next = finishCycle(start);
    expect(next.cycle).toBe(2);
    expect(next.history).toHaveLength(1);
    expect(next.history[0].review.wins).toBe("Raised rate");
    expect(next.focus).toBe("clarity");
    expect(next.review).toEqual({});
    expect(next.flags).toEqual(["Choose your next pathway based on this cycle’s progress and priorities."]);
    const kept = finishCycle({ ...start, review: { direction: "continue" } });
    expect(kept.focus).toBe("revenue");
    expect(kept.goals).toEqual(PROFILES.revenue.goals);
  });

  it("changing pathway replaces goals and clears flags", () => {
    const s = changePathway(generatePlan(elevationDefaults(), "revenue", ["x"]), "owner");
    expect(s.goals).toEqual(PROFILES.owner.goals);
    expect(s.flags).toEqual([]);
  });

  it("compares collections only when both numbers exist", () => {
    expect(collectionsDelta({ collectionsNow: 9000 })).toBe("Enter your baseline and target to compare.");
    expect(collectionsDelta({ collectionsNow: 9000, collectionsGoal: 10500 })).toBe(
      "Target difference: $1,500 (not a guarantee of achievable collections)",
    );
  });

  it("restores defensively", () => {
    const s = normaliseElevation({ focus: "bogus", status: ["Completed", "Nope"], cycle: "3", history: [{ focus: "owner" }] });
    expect(s.focus).toBe("clarity");
    expect(s.status[0]).toBe("Completed");
    expect(s.status[1]).toBe("Not started");
    expect(s.cycle).toBe(3);
    expect(s.history[0].focus).toBe("owner");
  });
});
