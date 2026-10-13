import { describe, expect, it } from "vitest";
import { lessonStatusOf, scheduledSummary } from "./courseRelease";

/**
 * Kajabi gives a lesson exactly one status. The builder reads it back from the
 * columns the same way the server resolves them, so reopening a lesson shows
 * the status members actually get.
 */
describe("lessonStatusOf", () => {
  it("reads an unpublished lesson as Draft, whatever else it holds", () => {
    expect(lessonStatusOf({ published: false, publishAtLocal: "2026-10-20T09:00", dripDays: 7 })).toBe("draft");
  });

  it("reads a publish time as Scheduled", () => {
    expect(lessonStatusOf({ published: true, publishAtLocal: "2026-10-20T09:00" })).toBe("scheduled");
  });

  it("reads a day count or a drip date as Drip", () => {
    expect(lessonStatusOf({ published: true, dripDays: 7 })).toBe("drip");
    expect(lessonStatusOf({ published: true, dripDateLocal: "2026-11-01" })).toBe("drip");
  });

  it("reads everything else as Published", () => {
    expect(lessonStatusOf({ published: true, dripDays: 0 })).toBe("published");
    expect(lessonStatusOf({})).toBe("published");
  });
});

describe("scheduledSummary", () => {
  it("prints the owner's own wall-clock figures, not the browser's", () => {
    expect(scheduledSummary("2026-10-20T09:00")).toBe("Opens Oct 20, 9:00 AM");
  });

  it("says nothing for an unscheduled lesson", () => {
    expect(scheduledSummary(null)).toBeNull();
    expect(scheduledSummary("")).toBeNull();
  });
});
