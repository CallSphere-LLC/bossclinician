import { describe, expect, it } from "vitest";
import { BOARDROOM_DOMAINS, scoreBoardroomAssessment, boardroomQuarter, validatedBoardroomTimezone } from "./boardroomAssessment";

describe("CEO assessment scoring v1", () => {
  it.each([[1,25,2],[4,100,8]])("scores boundary answers %i", (answer, overall, domain) => {
    const score = scoreBoardroomAssessment(Array(12).fill(answer));
    expect(score.overallScore).toBe(overall);
    expect(score.domains.map(d => d.score)).toEqual(Array(6).fill(domain));
    expect(score.priorities.map(d => d.id)).toEqual(["finance", "team", "operations"]);
    expect(score.firstAction).toBe(BOARDROOM_DOMAINS[0].action);
  });
  it("rounds the total and breaks ties in the original domain order", () => {
    const score = scoreBoardroomAssessment([4,4,1,2,1,1,2,1,4,4,1,1]);
    expect(score.overallScore).toBe(54);
    expect(score.priorities.map(d => d.id)).toEqual(["operations", "capacity", "team"]);
    expect(score.domains.map(d => d.name)).toEqual([
      "Financial Leadership", "Team & Leadership", "Operational Independence",
      "Strategic Growth", "Risk & Protection", "CEO Capacity & Vision",
    ]);
    expect(score.firstAction).toBe("Document one owner-dependent operational process and assign a responsible role.");
  });
  it.each(BOARDROOM_DOMAINS)("selects the source action for $id", (domain) => {
    const responses = Array(12).fill(4);
    const i = BOARDROOM_DOMAINS.indexOf(domain);
    responses[i * 2] = responses[i * 2 + 1] = 1;
    expect(scoreBoardroomAssessment(responses).firstAction).toBe(domain.action);
  });
  it.each([null, [], Array(11).fill(1), Array(13).fill(1), Array(12).fill(0),
    Array(12).fill(5), Array(12).fill(1.5), Array(12).fill("1"), Array(12).fill(null),
    Array(12).fill(NaN), Array(12).fill(Infinity), new Array(12), { responses: Array(12).fill(1) },
  ])("rejects invalid responses %#", (responses) => {
    expect(() => scoreBoardroomAssessment(responses)).toThrow();
  });
  it.each([
    ["2026-04-01T00:30:00Z", "America/Los_Angeles", "2026-Q1"],
    ["2026-04-01T00:30:00Z", "UTC", "2026-Q2"],
    ["2026-01-01T00:30:00Z", "America/Los_Angeles", "2025-Q4"],
    ["2026-12-31T23:30:00Z", "Pacific/Auckland", "2027-Q1"],
    ["2026-07-01T12:00:00Z", "UTC", "2026-Q3"],
  ])("assigns %s in %s to %s", (timestamp, timezone, expected) => {
    expect(boardroomQuarter(new Date(timestamp), timezone)).toBe(expected);
  });
  it("validates timezone values before using them", () => {
    expect(validatedBoardroomTimezone(" America/Los_Angeles ")).toBe("America/Los_Angeles");
    for (const value of ["bad-zone", "", null, 7]) expect(validatedBoardroomTimezone(value)).toBe("America/New_York");
  });
});
