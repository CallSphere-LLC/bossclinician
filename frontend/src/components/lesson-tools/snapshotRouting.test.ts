import { describe, expect, it } from "vitest";
import {
  COURSE_LESSONS,
  COURSE_MODULES,
  DASHBOARD_LESSON,
  HISTORY_LIMIT,
  NARRATIVE_MAX,
  PATHWAYS,
  SNAPSHOT_QUESTIONS_V2,
  SNAPSHOT_SECTIONS,
  buildSnapshotRecord,
  cleanAnswers,
  completeSnapshot,
  flagTarget,
  isSnapshotComplete,
  missingIn,
  normaliseSnapshotV2,
  pathwayTarget,
  recommendedFocus,
  selectPriority,
  snapshotFlags,
  snapshotProfile,
  snapshotRecommendations,
  snapshotV2Defaults,
  type SnapshotAnswers,
} from "./snapshotRouting";

/** Q1–Q10 all `value`, Q11 `direction`, Q12 text. */
const answers = (value: number, direction = 3, overrides: Record<number, number> = {}): SnapshotAnswers => {
  const out: SnapshotAnswers = { "12": "I built a full practice, and I am tired." };
  for (let q = 1; q <= 10; q += 1) out[String(q)] = overrides[q] ?? value;
  out["11"] = direction;
  return out;
};

describe("snapshot questions", () => {
  it("has the owner's twelve questions in four steps, Q11 on the 30-day wording", () => {
    expect(SNAPSHOT_SECTIONS).toHaveLength(4);
    expect(SNAPSHOT_QUESTIONS_V2.map((q) => q.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(SNAPSHOT_QUESTIONS_V2.filter((q) => q.options).every((q) => q.options!.length === 4)).toBe(true);
    expect(SNAPSHOT_QUESTIONS_V2[10].prompt).toContain("in the next 30 days");
    expect(SNAPSHOT_QUESTIONS_V2[11].options).toBeUndefined();
  });

  it("requires every answer, including the Q12 sentence", () => {
    expect(isSnapshotComplete(answers(0))).toBe(true);
    expect(isSnapshotComplete({ ...answers(0), "12": "   " })).toBe(false);
    expect(missingIn(SNAPSHOT_SECTIONS[1], { ...answers(0), "6": 7 })).toBe(6);
  });

  it("keeps only valid indices and caps the narrative", () => {
    const cleaned = cleanAnswers(JSON.parse(`{"1":2,"2":9,"3":"1","4":1.5,"12":"${"x".repeat(5000)}","99":1,"__proto__":{"5":1}}`));
    expect(cleaned).toEqual({ "1": 2, "12": "x".repeat(NARRATIVE_MAX) });
  });
});

describe("pathway and flags (README routing)", () => {
  it("maps Q11 A/B/C/D to Module 02/03/04/01", () => {
    expect([0, 1, 2, 3].map((d) => PATHWAYS[recommendedFocus(answers(0, d))].section)).toEqual(["Module 02", "Module 03", "Module 04", "Module 01"]);
  });

  it("sends Q4 C/D to the Current Model Audit whatever Q11 says", () => {
    const record = buildSnapshotRecord(answers(0, 2, { 4: 3 }), "2026-10-23T00:00:00.000Z");
    expect(record.recommended_pathway).toBe("Practice Clarity & Performance");
    expect(record.self_identified_priority).toBe("Owner Pay & Lifestyle");
    expect(record.member_selected_priority).toBe("Practice Clarity & Performance");
    expect(record.recommended_module_id).toBe(56);
    expect(record.recommended_lesson_ids[0]).toBe(147);
    expect(COURSE_LESSONS[147].slug).toBe("current-model-audit-worksheet");
  });

  it("flags C/D answers by question", () => {
    expect(snapshotFlags(answers(0))).toEqual([]);
    expect(snapshotFlags(answers(1))).toEqual([]);
    expect(snapshotFlags(answers(2))).toEqual(["financial_clarity", "payer_dependency", "rate_review", "owner_pay", "systems_gap"]);
    expect(snapshotFlags(answers(0, 0, { 9: 3 }))).toEqual(["systems_gap"]);
  });

  it("routes each flag to its real module", () => {
    const a = answers(2);
    expect(flagTarget("payer_dependency", a)).toEqual({ moduleId: 63, lessonIds: [165, 169] });
    expect(COURSE_LESSONS[169].moduleId).toBe(64);
    expect(flagTarget("rate_review", a).moduleId).toBe(62);
    expect(flagTarget("owner_pay", a).moduleId).toBe(78);
    expect(flagTarget("systems_gap", answers(0, 0, { 9: 2 }))).toEqual({ moduleId: 72, lessonIds: [196] });
    expect(flagTarget("systems_gap", answers(0, 0, { 8: 3, 10: 2 }))).toEqual({ moduleId: 71, lessonIds: [191, 193] });
  });

  it("refines a pathway's start lesson from the answers", () => {
    expect(pathwayTarget("revenue", answers(0, 0)).lessonIds[0]).toBe(162);
    expect(pathwayTarget("revenue", answers(0, 0, { 5: 3 })).lessonIds[0]).toBe(165);
    expect(pathwayTarget("revenue", answers(0, 0, { 5: 3, 6: 3 })).lessonIds[0]).toBe(162);
    expect(pathwayTarget("systems", answers(0, 1)).lessonIds[0]).toBe(197);
    expect(pathwayTarget("systems", answers(0, 1, { 10: 3 })).lessonIds).toEqual([193, 192]);
    expect(pathwayTarget("owner", answers(0, 2))).toEqual({ moduleId: 78, lessonIds: [212, 211] });
  });

  it("lists the audit first and never the same lesson twice", () => {
    const list = snapshotRecommendations(answers(3), snapshotFlags(answers(3)));
    expect(list.map((r) => r.id)).toEqual(["first_audit", "payer_dependency", "rate_review", "owner_pay", "systems_gap"]);
    const firsts = list.map((r) => r.lesson_ids[0]);
    expect(new Set(firsts).size).toBe(firsts.length);
  });

  it("labels profiles approximately", () => {
    expect(snapshotProfile(answers(0))).toBe("Strong foundation");
    expect(snapshotProfile(answers(1))).toBe("Classic Maxed Out profile");
    expect(snapshotProfile(answers(3))).toBe("Focused restructuring opportunities");
  });
});

describe("course map", () => {
  it("every routed lesson resolves to a module in the map", () => {
    for (const lesson of Object.values(COURSE_LESSONS)) {
      expect(COURSE_MODULES[lesson.moduleId], `lesson ${lesson.id}`).toBeDefined();
      expect(lesson.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    for (let q11 = 0; q11 < 4; q11 += 1) {
      for (const value of [0, 1, 2, 3]) {
        const r = buildSnapshotRecord(answers(value, q11), "2026-10-23T00:00:00.000Z");
        expect(COURSE_MODULES[r.recommended_module_id]).toBeDefined();
        for (const id of [...r.recommended_lesson_ids, ...r.recommendations.flatMap((x) => x.lesson_ids)]) expect(COURSE_LESSONS[id]).toBeDefined();
      }
    }
    expect(DASHBOARD_LESSON.slug).toBe("my-practice-elevation-dashboard");
  });
});

describe("saved state", () => {
  it("defaults to nothing completed", () => {
    const s = normaliseSnapshotV2(null);
    expect(s.completed_at).toBeNull();
    expect(s.recommended_pathway).toBeNull();
    expect(s.assessment_version).toBe("membership_12_question_30_day");
  });

  it("re-scores a stored result from its answers instead of trusting stored routing", () => {
    const stored = { ...buildSnapshotRecord(answers(0, 0), "2026-10-23T00:00:00.000Z"), recommended_module_id: 999, recommended_lesson_ids: [1], flags: ["bogus"] };
    const s = normaliseSnapshotV2(stored);
    expect(s.recommended_module_id).toBe(62);
    expect(s.flags).toEqual([]);
  });

  it("drops a result whose answers are incomplete", () => {
    const s = normaliseSnapshotV2({ answers: { "1": 0 }, completed_at: "2026-10-23T00:00:00.000Z", recommended_pathway: "Revenue Restructure" });
    expect(s.completed_at).toBeNull();
    expect(s.recommended_pathway).toBeNull();
  });

  it("keeps a member's chosen focus but rejects unknown values", () => {
    const record = buildSnapshotRecord(answers(0, 0), "2026-10-23T00:00:00.000Z");
    expect(normaliseSnapshotV2({ ...record, member_selected_priority: "Systems & Operations" }).member_selected_priority).toBe("Systems & Operations");
    expect(normaliseSnapshotV2({ ...record, member_selected_priority: "<b>x</b>" }).member_selected_priority).toBe("Revenue Restructure");
    const s = normaliseSnapshotV2(record);
    expect(selectPriority(s, "Owner Pay & Lifestyle").member_selected_priority).toBe("Owner Pay & Lifestyle");
    expect(selectPriority(snapshotV2Defaults(), "Owner Pay & Lifestyle").member_selected_priority).toBeNull();
  });

  it("moves the previous result to history on a changed retake", () => {
    const first = completeSnapshot(snapshotV2Defaults(), answers(0, 0), "2026-10-01T00:00:00.000Z");
    expect(first.history).toHaveLength(0);
    expect(first.completed_at).toBe("2026-10-01T00:00:00.000Z");
    const same = completeSnapshot({ ...first, draft: { answers: answers(0, 0), step: 3 } }, answers(0, 0), "2026-10-02T00:00:00.000Z");
    expect(same.history).toHaveLength(0);
    expect(same.completed_at).toBe("2026-10-01T00:00:00.000Z");
    expect(same.draft).toBeNull();
    const second = completeSnapshot(first, answers(3, 2), "2026-10-23T00:00:00.000Z");
    expect(second.history).toHaveLength(1);
    expect(second.history[0].recommended_pathway).toBe("Revenue Restructure");
    expect(second.recommended_pathway).toBe("Practice Clarity & Performance");
    expect(normaliseSnapshotV2(JSON.parse(JSON.stringify(second))).history).toHaveLength(1);
  });

  it("caps history and clamps the draft step", () => {
    const record = buildSnapshotRecord(answers(0, 0), "2026-10-01T00:00:00.000Z");
    const s = normaliseSnapshotV2({ ...record, history: Array(HISTORY_LIMIT + 5).fill(record), draft: { answers: { "1": 1 }, step: 12 } });
    expect(s.history).toHaveLength(HISTORY_LIMIT);
    expect(s.draft).toEqual({ answers: { "1": 1 }, step: 3 });
  });
});
