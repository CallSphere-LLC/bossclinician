import { describe, expect, it } from "vitest";
import { emptyVipHealth, normaliseVipHealth, vipHealthResult } from "./vipPracticeHealth";

describe("Lounge VIP Practice Health Check", () => {
  it("requires six answers and a 90-day priority", () => {
    expect(vipHealthResult(emptyVipHealth())).toBeNull();
    expect(vipHealthResult({ ...emptyVipHealth(), scores: [1, 2, 3, 4, 1, 2] })).toBeNull();
  });

  it("uses the owner's six-area formula and first-lowest tie rule", () => {
    const result = vipHealthResult({
      scores: [1, 2, 3, 4, 1, 2],
      challenges: ["Inconsistent referrals"],
      priority: "Build steadier client flow",
      completedAt: "2026-10-25T00:00:00.000Z",
    });
    expect(result?.score).toBe(54);
    expect(result?.areas.map((area) => area.score)).toEqual([1, 2, 3, 4, 1, 2]);
    expect(result?.action).toContain("revenue, overhead and owner-pay");
    expect(result?.challenges).toEqual(["Inconsistent referrals"]);
  });

  it("normalises old or malformed saved data without carrying unknown fields into a report", () => {
    const restored = normaliseVipHealth({
      scores: [4, 5, 2, 0, 1, "4"],
      challenges: ["Owner pay or profitability", "Someone else's answer"],
      priority: "Unknown goal",
      completedAt: "invalid",
      memberId: 999,
    });
    expect(restored).toEqual({
      scores: [4, null, 2, null, 1, null],
      challenges: ["Owner pay or profitability"],
      priority: "",
      completedAt: null,
    });
    expect(vipHealthResult(restored)).toBeNull();
  });
});
