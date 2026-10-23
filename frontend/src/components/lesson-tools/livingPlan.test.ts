import { describe, expect, it } from "vitest";
import {
  BACKUP_TYPE,
  INPUT_MAX,
  PLAN_GROUPS,
  TEXTAREA_MAX,
  addReview,
  backupDocument,
  keepHistory,
  livingPlanDefaults,
  normaliseLivingPlan,
  planBytes,
  restoreFromBackup,
  reviewedCount,
  rollYear,
  setReviewed,
  setValue,
} from "./livingPlan";

describe("plan sections", () => {
  it("has the Executive Summary plus the ten sections", () => {
    expect(PLAN_GROUPS).toHaveLength(11);
    expect(PLAN_GROUPS[0].title).toBe("Executive Summary");
    expect(PLAN_GROUPS[10].title).toBe("10 · CEO Declaration");
    const keys = PLAN_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("normaliseLivingPlan", () => {
  it("starts on this year with nothing reviewed", () => {
    const s = normaliseLivingPlan(undefined);
    expect(s.annual.values.planYear).toBe(String(new Date().getFullYear()));
    expect(reviewedCount(s.annual)).toBe(0);
  });

  it("keeps only known fields, valid choices and capped text", () => {
    const s = normaliseLivingPlan({
      annual: {
        values: { legalName: "x".repeat(900), mission: "y".repeat(9000), entity: "LLC", deliveryModel: "Spaceship", annualTarget: "abc", reserveTarget: "25000", hacker: "<script>", planYear: "2027" },
        reviewed: { summary: true, identity: "yes", nope: true },
      },
      reviews: [{ date: "2026-10-01", type: "Annual review", notes: "Went well" }, { date: "bad", notes: "x" }, { date: "2026-10-02", notes: "" }],
      archives: [{ year: 2025, archivedAt: "2026-01-01T00:00:00.000Z", plan: { values: { mission: "old" }, reviewed: {} } }, { year: "soon" }],
    });
    expect(s.annual.values.legalName).toHaveLength(INPUT_MAX);
    expect(s.annual.values.mission).toHaveLength(TEXTAREA_MAX);
    expect(s.annual.values.entity).toBe("LLC");
    expect(s.annual.values.deliveryModel).toBeUndefined();
    expect(s.annual.values.annualTarget).toBeUndefined();
    expect(s.annual.values.reserveTarget).toBe("25000");
    expect(s.annual.values.hacker).toBeUndefined();
    expect(s.annual.values.planYear).toBe("2027");
    expect(s.annual.reviewed).toEqual({ summary: true });
    expect(s.reviews).toHaveLength(1);
    expect(s.reviews[0].savedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(s.archives).toHaveLength(1);
  });
});

describe("editing", () => {
  it("sets values and review marks", () => {
    let s = livingPlanDefaults();
    s = setValue(s, "annualTarget", "180000");
    s = setValue(s, "entity", "Not a choice");
    s = setReviewed(s, "financial", true);
    s = setReviewed(s, "unknown", true);
    expect(s.annual.values.annualTarget).toBe("180000");
    expect(s.annual.values.entity).toBeUndefined();
    expect(reviewedCount(s.annual)).toBe(1);
    expect(reviewedCount(setReviewed(s, "financial", false).annual)).toBe(0);
  });

  it("needs a date and notes for a strategic review", () => {
    const s = livingPlanDefaults();
    expect(addReview(s, { date: "", type: "Annual review", notes: "x" }, "2026-10-23T00:00:00.000Z")).toBeNull();
    expect(addReview(s, { date: "2026-10-23", type: "Annual review", notes: "  " }, "2026-10-23T00:00:00.000Z")).toBeNull();
    expect(addReview(s, { date: "2026-10-23", type: "Annual review", notes: "Q4" }, "2026-10-23T00:00:00.000Z")?.reviews).toHaveLength(1);
  });
});

describe("annual rollover", () => {
  it("archives the year and resets checkmarks and the declaration", () => {
    let s = livingPlanDefaults();
    s = setValue(s, "planYear", "2026");
    s = setValue(s, "mission", "Serve well");
    s = setValue(s, "signedName", "Yvette");
    s = setReviewed(s, "summary", true);
    const next = rollYear(s, "2026-12-31T00:00:00.000Z");
    expect(next.archives).toHaveLength(1);
    expect(next.archives[0].year).toBe(2026);
    expect(next.archives[0].plan.values.signedName).toBe("Yvette");
    expect(next.archives[0].plan.reviewed.summary).toBe(true);
    expect(next.annual.values.planYear).toBe("2027");
    expect(next.annual.values.mission).toBe("Serve well");
    expect(next.annual.values.signedName).toBe("");
    expect(next.annual.reviewed).toEqual({});
  });
});

describe("append-only history", () => {
  const withHistory = () => {
    const s = setValue(livingPlanDefaults(), "planYear", "2025");
    const rolled = rollYear(s, "2025-12-31T00:00:00.000Z");
    return addReview(rolled, { date: "2026-03-31", type: "Quarterly check-in", notes: "Q1" }, "2026-03-31T10:00:00.000Z")!;
  };

  it("keeps archives and reviews a later document dropped", () => {
    const previous = withHistory();
    const next = keepHistory(previous, { ...previous, archives: [], reviews: [] });
    expect(next.archives).toHaveLength(1);
    expect(next.reviews).toHaveLength(1);
  });

  it("restores the draft from a backup and merges, never drops, history", () => {
    const current = withHistory();
    const backup = backupDocument({
      version: 1,
      annual: { values: { planYear: "2024", mission: "From backup" }, reviewed: { summary: true } },
      reviews: [{ date: "2024-06-30", type: "Annual review", notes: "Old", savedAt: "2024-06-30T00:00:00.000Z" }],
      archives: [],
    });
    const restored = restoreFromBackup(current, JSON.parse(JSON.stringify(backup)))!;
    expect(restored.annual.values.mission).toBe("From backup");
    expect(restored.archives).toHaveLength(1);
    expect(restored.reviews.map((r) => r.notes)).toEqual(["Q1", "Old"]);
    expect(restoreFromBackup(restored, backup)!.reviews).toHaveLength(2);
  });

  it("rejects files that are not one of her backups", () => {
    const s = livingPlanDefaults();
    expect(restoreFromBackup(s, { type: "other", data: {} })).toBeNull();
    expect(restoreFromBackup(s, { type: BACKUP_TYPE, data: { annual: { values: {} } } })).toBeNull();
    expect(restoreFromBackup(s, null)).toBeNull();
  });

  it("restores a backup from the standalone prototype", () => {
    const prototype = { type: BACKUP_TYPE, version: 1, data: { annual: { values: { planYear: "2026", legalName: "Brighter Practice" }, reviewed: { identity: true } }, reviews: [{ date: "2026-10-01", type: "Major business change", notes: "Left a panel" }], archives: [] } };
    const restored = restoreFromBackup(livingPlanDefaults(), prototype)!;
    expect(restored.annual.values.legalName).toBe("Brighter Practice");
    expect(restored.reviews[0].type).toBe("Major business change");
  });

  it("measures the saved size", () => {
    expect(planBytes(livingPlanDefaults())).toBeGreaterThan(10);
  });
});
