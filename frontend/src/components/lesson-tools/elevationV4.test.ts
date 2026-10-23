import { describe, expect, it } from "vitest";
import {
  ELEVATION_FOCI,
  ELEVATION_ROUTES,
  allowedLessonSlugs,
  focusFromPathway,
  resolveRoutes,
  snapshotLessons,
  snapshotSuggestion,
  type OutlineLike,
} from "./elevationV4";

const outline: OutlineLike = {
  modules: [
    {
      title: "Find Out What Your Practice Is Actually Producing",
      lessons: [
        { id: 146, slug: "what-your-practice-is-really-paying-you", title: "What Your Practice Is REALLY Paying You" },
        { id: 147, slug: "current-model-audit-worksheet", title: "Current Model Audit Worksheet" },
      ],
    },
    {
      title: "Stop Letting Fear Set Your Rate | Let Your Numbers Do It",
      lessons: [{ id: 162, slug: "how-to-raise-your-rate-based-on-what-the-audit-showed-you", title: "How to Raise Your Rate" }],
    },
  ],
};

describe("Practice Elevation recommended module + lessons (row 170)", () => {
  it("every pathway names a Mod 0N module, a starting section and at least one lesson", () => {
    for (const focus of ELEVATION_FOCI) {
      const route = ELEVATION_ROUTES[focus];
      expect(route.module).toMatch(/^Mod 0[1-4] \| /);
      expect(route.section.length).toBeGreaterThan(0);
      expect(route.lessons.length).toBeGreaterThan(0);
    }
  });

  it("uses live titles and drops lessons the course no longer has", () => {
    const routes = resolveRoutes(outline);
    expect(routes.clarity.lessons.map((l) => l.title)).toEqual(["What Your Practice Is REALLY Paying You", "Current Model Audit Worksheet"]);
    expect(routes.revenue.lessons.map((l) => l.slug)).toEqual(["how-to-raise-your-rate-based-on-what-the-audit-showed-you"]);
    expect(routes.systems.lessons).toEqual([]);
    expect(resolveRoutes(null)).toBe(ELEVATION_ROUTES);
  });

  it("only lets the frame open the routes' lessons or lessons in the course", () => {
    const allowed = allowedLessonSlugs(null);
    expect(allowed.has("current-model-audit-worksheet")).toBe(true);
    expect(allowed.has("../../admin")).toBe(false);
  });
});

describe("Practice Reset Snapshot v2 suggestion", () => {
  it("maps the snapshot's words onto the dashboard's six pathways", () => {
    expect(focusFromPathway("revenue")).toBe("revenue");
    expect(focusFromPathway("rate")).toBe("revenue");
    expect(focusFromPathway("Owner Pay & Lifestyle")).toBe("owner");
    expect(focusFromPathway("Paying myself consistently and taking real time off")).toBe("owner");
    expect(focusFromPathway("Systems & Operations")).toBe("systems");
    expect(focusFromPathway("Client Flow & Referrals")).toBe("clients");
    expect(focusFromPathway("Practice Sustainability")).toBe("sustain");
    expect(focusFromPathway("Getting clear on my numbers")).toBe("clarity");
    expect(focusFromPathway("something else")).toBeNull();
    expect(focusFromPathway(3)).toBeNull();
  });

  it("prefers the member's own priority, keeps flags and lesson ids, and ignores junk", () => {
    const s = snapshotSuggestion({
      recommended_pathway: "systems",
      member_selected_priority: "revenue",
      flags: ["Platform dependence", { label: "Owner pay needs attention" }, 7],
      recommended_lesson_ids: [162, "147", -1, "x"],
      completed_at: "2026-10-23T12:00:00Z",
    });
    expect(s).toEqual({
      focus: "revenue",
      source: "member",
      flags: ["Platform dependence", "Owner pay needs attention"],
      lessonIds: [162, 147],
      completedAt: "2026-10-23T12:00:00Z",
    });
    expect(snapshotSuggestion({ recommended_pathway: "systems" })?.source).toBe("recommended");
    // The v2 snapshot's own shape: pathway names, a focus key, flag ids.
    const v2 = snapshotSuggestion({
      recommended_pathway: "Practice Clarity & Performance",
      recommended_focus: "clarity",
      member_selected_priority: "Owner Pay & Lifestyle",
      flags: ["financial_clarity", "owner_pay", "new_flag"],
      recommended_lesson_ids: [146, 147],
      completed_at: "2026-10-23T12:00:00Z",
    });
    expect(v2).toMatchObject({ focus: "owner", source: "member", flags: ["Complete the Current Model Audit", "Review owner pay and reserves", "New flag"] });
    // Before the first completion every field is null.
    expect(snapshotSuggestion({ recommended_pathway: null, recommended_focus: null, member_selected_priority: null, flags: [], recommended_lesson_ids: [] })).toBeNull();
    expect(snapshotSuggestion(null)).toBeNull();
    expect(snapshotSuggestion({ answers: {} })).toBeNull();
  });

  it("resolves the snapshot's lesson ids against the outline", () => {
    expect(snapshotLessons([162, 999, 146], outline).map((l) => l.slug)).toEqual([
      "how-to-raise-your-rate-based-on-what-the-audit-showed-you",
      "what-your-practice-is-really-paying-you",
    ]);
    expect(snapshotLessons([162], null)).toEqual([]);
  });
});
